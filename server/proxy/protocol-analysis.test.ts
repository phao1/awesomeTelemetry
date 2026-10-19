import { describe, expect, it } from 'vitest';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

import { analyzeProtocol, CAPTURE_METRIC_VERSION, CAPTURE_PARSER_VERSION } from './protocol-analysis.js';
import { deriveProxyInsights } from '../../src/core/proxy-insights.js';

// Entirely synthetic fixtures. Protocol field references (not copied traffic):
// https://developers.openai.com/api/reference/resources/responses/streaming-events
// https://developers.openai.com/api/docs/guides/function-calling
// https://platform.claude.com/docs/en/build-with-claude/streaming

const sse = (...frames: unknown[]): string => frames.map(frame =>
  'data: ' + (typeof frame === 'string' ? frame : JSON.stringify(frame)) + '\n\n',
).join('');

const qoder = (frame: unknown, statusCode = 'OK') => ({ headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(frame), statusCode });
const qoderChunk = (choices: unknown[], extra: Record<string, unknown> = {}) => ({ object: 'chat.completion.chunk', id: 'qoder-native-response', model: 'synthetic-model', choices, ...extra });

it('exports distinct current parser and capture usage metric versions without changing protocol behavior', async () => {
  expect(CAPTURE_PARSER_VERSION).toBe(3); expect(CAPTURE_METRIC_VERSION).toBe(1);
  expect((await analyzeProtocol({ format: 'unknown', requestBody: '{}', responseBody: '{}', streaming: false })).parserVersion).toBe(CAPTURE_PARSER_VERSION);
});

it('never interprets a multi-turn WS connection as one HTTP model call, even with valid-looking JSON', async () => {
  const result = await analyzeProtocol({ format: 'openai_responses', streaming: false, requestBody: '{"model":"not-one-call","input":[]}',
    responseBody: '{"status":"completed","usage":{"input_tokens":100,"output_tokens":20}}',
    transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 101,
      websocket: { version: 1, scope: 'connection', archive: 'awsp1', requestMessages: 2, responseMessages: 16, clientCloseCode: 1000, upstreamCloseCode: 1000 } } });
  expect(result).toMatchObject({ state: 'unknown', requestFormat: 'unknown', model: null, items: [], completeness: { complete: false, reasons: ['websocket_connection_not_model_call'] } });
  expect(result.usage.inputTokens).toBeNull(); expect(result.usage.totalTokens).toBeNull();
});

describe('Qoder nested SSE response evidence', () => {
  it('uses explicit response evidence without inventing unknown encoded request context or double-counting usage', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } };
    const input = { format: 'unknown' as const, streaming: true, requestBody: 'Encode=1&opaque=synthetic', responseBody: sse(
      qoder(qoderChunk([{ index: 0, delta: { content: '中文', reasoning_content: '公开推理', tool_calls: [{ index: 1, id: 'call:7', function: { name: 'Read', arguments: '{"path":' } }] } }])),
      qoder(qoderChunk([{ index: 0, delta: { content: '🙂', tool_calls: [{ index: 1, function: { arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }])),
      qoder(qoderChunk([], { usage })), qoder(qoderChunk([], { usage })), '[DONE]',
    ) };
    const before = JSON.stringify(input);
    const result = await analyzeProtocol(input);
    expect(result).toMatchObject({ parserVersion: 3, requestFormat: 'unknown', model: 'synthetic-model', responseId: 'qoder-native-response', state: 'completed', system: null, stopReason: 'tool_calls' });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'text', content: '中文🙂', sourcePath: 'events[0].body.choices[0]', complete: true }),
      expect.objectContaining({ kind: 'reasoning', content: '公开推理' }),
      expect.objectContaining({ kind: 'tool_call', callId: 'call:7', name: 'Read', content: '{"path":"x"}', index: 1, choiceIndex: 0, sourcePath: 'events[0].body.choices[0].tool_calls[1]', complete: true }),
    ]));
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, totalTokens: 120, accounting: 'openai_subsets' });
    expect(result.usage.snapshots.map(item => item.eventIndex)).toEqual([2, 3]);
    expect(result.unknownEvents).toBe(0);
    expect(result.completeness.reasons).toContain('request_unavailable_or_invalid');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('mixes standard and wrapped frames only under explicit Chat request semantics', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', streaming: true, requestBody: '{"messages":[]}', responseBody: sse(
      { choices: [{ index: 0, delta: { content: 'standard-' } }] },
      qoder(qoderChunk([{ index: 0, delta: { content: 'wrapped' }, finish_reason: 'stop' }])),
      { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }, '[DONE]',
    ) });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ content: 'standard-wrapped', complete: true });
    expect(result.usage.totalTokens).toBe(0);
    expect(result.state).toBe('completed');
    expect(result.completeness.complete).toBe(true);
  });

  it('keeps valid nested output incomplete when no terminal marker was observed', async () => {
    const result = await analyzeProtocol({ format: 'unknown', streaming: true, requestBody: '{}', responseBody: sse(qoder(qoderChunk([{ index: 0, delta: { content: 'partial' } }]))) });
    expect(result.state).toBe('incomplete');
    expect(result.items[0]).toMatchObject({ content: 'partial', complete: false });
  });

  it.each([
    ['qoder_body_invalid', { headers: {}, statusCode: 'OK', body: '{broken' }],
    ['qoder_inner_shape', qoder({ body: JSON.stringify(qoderChunk([])), headers: {}, statusCode: 'OK' })],
  ] as const)('does not conceal %s with a later finish or DONE', async (reason, invalid) => {
    const result = await analyzeProtocol({ format: 'openai_chat', streaming: true, requestBody: '{"messages":[]}', responseBody: sse(
      qoder(qoderChunk([{ index: 0, delta: { content: 'observed' } }])), invalid,
      qoder(qoderChunk([{ index: 0, delta: {}, finish_reason: 'stop' }])), '[DONE]',
    ) });
    expect(result.state).toBe('incomplete');
    expect(result.completeness.reasons).toContain(reason);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: reason, sourcePath: 'events[1].body' }));
    expect(result.unknownEvents).toBe(1);
    expect(result.items[0]?.content).toBe('observed');
  });

  it('retains failed wrapper status over later protocol success and DONE', async () => {
    const result = await analyzeProtocol({ format: 'unknown', streaming: true, requestBody: '{}', responseBody: sse(
      qoder(qoderChunk([]), 'ERROR'), qoder(qoderChunk([{ index: 0, delta: { content: 'late' }, finish_reason: 'stop' }])), '[DONE]',
    ) });
    expect(result.state).toBe('failed');
    expect(result.errors).toContainEqual({ code: 'qoder_status', message: 'Qoder gateway status: ERROR', sourcePath: 'events[0].statusCode' });
    expect(result.completeness.reasons).toContain('qoder_status');
  });

  it('retains a native inner error exactly once at its body locator despite later success', async () => {
    const result = await analyzeProtocol({ format: 'unknown', streaming: true, requestBody: '{}', responseBody: sse(
      qoder(qoderChunk([], { error: { code: 'gateway-model-error', message: 'synthetic failure' } })),
      qoder(qoderChunk([{ index: 0, delta: { content: 'late' }, finish_reason: 'stop' }])), '[DONE]',
    ) });
    expect(result.state).toBe('failed');
    expect(result.errors).toEqual([{ code: 'gateway-model-error', message: 'synthetic failure', sourcePath: 'events[0].body.error' }]);
  });

  it('does not certify a nested response when a later SSE frame is truncated after a valid finish', async () => {
    const result = await analyzeProtocol({ format: 'unknown', streaming: true, requestBody: '{}', responseBody:
      sse(qoder(qoderChunk([{ index: 0, delta: { content: 'observed' }, finish_reason: 'stop' }])))
      + 'data: ' + JSON.stringify(qoder(qoderChunk([], { usage: { prompt_tokens: 999 } }))),
    });
    expect(result.state).toBe('incomplete');
    expect(result.items[0]).toMatchObject({ content: 'observed', complete: false });
    expect(result.usage.inputTokens).toBeNull();
    expect(result.completeness.reasons).toContain('sse_incomplete_frame');
  });

  it.each(['anthropic_messages', 'openai_responses'] as const)('does not mix wrapped Chat usage into explicit %s evidence', async format => {
    const result = await analyzeProtocol({ format, streaming: true, requestBody: format === 'openai_responses' ? '{"input":[]}' : '{"messages":[]}', responseBody: sse(qoder(qoderChunk([{ index: 0, delta: { content: 'conflicting' }, finish_reason: 'stop' }], { usage: { prompt_tokens: 100 } }))) });
    expect(result.requestFormat).toBe(format);
    expect(result.items).toHaveLength(0);
    expect(result.usage.inputTokens).toBeNull();
    expect(result.unknownEvents).toBe(1);
    expect(result.completeness.reasons).toContain('qoder_protocol_conflict');
  });

  it.each([true, false])('does not upgrade ordinary unknown payloads when streaming=%s', async streaming => {
    const frame = qoderChunk([{ index: 0, delta: { content: 'do-not-guess' }, finish_reason: 'stop' }]);
    const result = await analyzeProtocol({ format: 'unknown', streaming, requestBody: '{}', responseBody: streaming ? sse(frame, '[DONE]') : JSON.stringify(qoder(frame)) });
    expect(result.requestFormat).toBe('unknown');
    expect(result.items).toHaveLength(0);
    expect(result.state).not.toBe('completed');
    expect(result.usage.accounting).toBe('unknown');
  });
});

describe('Chat protocol evidence', () => {
  it('projects a single error at its actual event locator rather than duplicating metadata/protocol extraction', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', requestBody: '{"messages":[]}', streaming: true,
      responseBody: sse({ type: 'ping' }, { type: 'error', error: { type: 'overloaded_error', message: 'synthetic' } }),
    });
    expect(result.errors).toEqual([{ code: 'overloaded_error', message: 'synthetic', sourcePath: 'events[1].error' }]);
  });
  it.each(['openai_chat', 'openai_responses', 'anthropic_messages'] as const)('preserves an error outcome over later terminal markers for %s', async format => {
    const frames = format === 'openai_chat' ? [{ error: { code: 'synthetic_failure', message: 'failed' } }, { choices: [{ index: 0, delta: { content: 'observed' }, finish_reason: 'stop' }] }, '[DONE]']
      : format === 'openai_responses' ? [{ type: 'response.failed', response: { status: 'failed', error: { code: 'synthetic_failure', message: 'failed' } } }, { type: 'response.completed', response: { status: 'completed' } }]
        : [{ type: 'error', error: { type: 'synthetic_failure', message: 'failed' } }, { type: 'message_stop' }];
    const result = await analyzeProtocol({ format, requestBody: format === 'openai_responses' ? '{"input":"test"}' : '{"messages":[]}', streaming: true, responseBody: sse(...frames) });
    expect(result.state).toBe('failed'); expect(result.errors).toHaveLength(1);
  });
  it.each(['http_error', 'network_error', 'timeout', 'cancelled', 'interrupted'] as const)('preserves terminal/usage evidence but does not claim call completion after %s', async state => {
    const result = await analyzeProtocol({ format: 'openai_chat', requestBody: '{"messages":[]}', streaming: true,
      responseBody: sse({ choices: [{ index: 0, delta: { content: 'observed' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }, '[DONE]'),
      transport: { version: 1, state, error: state === 'http_error' ? 'HTTP_ERROR' : 'ECONNRESET', requestEnded: true, responseEnded: state === 'http_error', statusCode: state === 'http_error' ? 500 : 200 },
    });
    expect(result.state).toBe(state === 'http_error' ? 'failed' : 'incomplete');
    expect(result.items[0]?.content).toBe('observed'); expect(result.usage.inputTokens).toBe(3);
    expect(result.errors).toContainEqual({ code: state === 'http_error' ? 'HTTP_ERROR' : 'ECONNRESET', message: 'Observed network outcome: ' + state, sourcePath: 'capture.transport' });
    if (state !== 'http_error') expect(result.completeness.reasons).toContain('transport:' + state);
  });
  it('discards an unterminated terminal frame and its usage rather than treating EOF as dispatch', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', requestBody: '{"messages":[]}', streaming: true,
      responseBody: sse({ choices: [{ index: 0, delta: { content: '中文🙂' } }] })
        + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":999}}\n',
    });
    expect(result.state).toBe('incomplete');
    expect(result.items[0]).toMatchObject({ content: '中文🙂', complete: false });
    expect(result.usage.inputTokens).toBeNull();
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.reasons).toContain('sse_incomplete_frame');
  });
  it('supports legacy functions and JSON tool output without inventing execution', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', streaming: false,
      requestBody: JSON.stringify({ messages: [{ role: 'function', name: 'lookup', content: 'history result' }], functions: [{ name: 'lookup', parameters: { type: 'object' } }] }),
      responseBody: JSON.stringify({ choices: [{ index: 0, message: { function_call: { name: 'lookup', arguments: '{"key":"中文"}' } }, finish_reason: 'function_call' }], usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    });
    expect(result.declarations[0]?.name).toBe('lookup');
    expect(result.items.find(item => item.phase === 'request')).toMatchObject({ kind: 'tool_result', name: 'lookup', content: 'history result' });
    expect(result.items.find(item => item.phase === 'response')).toMatchObject({ kind: 'tool_call', name: 'lookup', content: '{"key":"中文"}', complete: true });
    expect(result.usage.totalTokens).toBe(0);
  });
  it('separates declarations/history/results and public reasoning without altering request values', async () => {
    const result = await analyzeProtocol({
      format: 'openai_chat',
      requestBody: JSON.stringify({ model: 'demo', messages: [
        { role: 'system', content: [{ type: 'text', text: '系统' }] },
        { role: 'developer', content: 'developer' },
        { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'shell', arguments: '{"cmd":"pwd"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '/project' },
      ], tools: [{ type: 'function', function: { name: 'shell', parameters: { type: 'object' } } }] }),
      responseBody: JSON.stringify({ id: 'chat-1', model: 'demo', choices: [{ index: 0, message: { content: 'answer', reasoning_content: '公开推理' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } } }),
      streaming: false,
    });
    expect(result.system).toBe('系统\ndeveloper');
    expect(result.declarations[0]?.name).toBe('shell');
    expect(result.items.find(item => item.kind === 'tool_result')).toMatchObject({ phase: 'request', callId: 'call-1', content: '/project' });
    expect(result.items.filter(item => item.phase === 'response').map(item => [item.kind, item.content])).toEqual([['text', 'answer'], ['reasoning', '公开推理']]);
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, totalTokens: 120, accounting: 'openai_subsets' });
    expect(result.state).toBe('completed');
  });

  it('reconstructs parallel tool fragments by choice and tool index, not arrival order', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } };
    const result = await analyzeProtocol({ format: 'openai_chat', requestBody: '{"messages":[]}', streaming: true,
      responseBody: sse(
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'read', arguments: '{"b":' } }, { index: 0, id: 'a', function: { name: 'write', arguments: '{"a":' } }] } }] },
        { choices: [{ index: 1, delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'other', arguments: '{}' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }, { index: 1, function: { arguments: '2}' } }] }, finish_reason: 'tool_calls' }, { index: 1, delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage }, { choices: [], usage }, '[DONE]',
      ),
    });
    const calls = result.items.filter(item => item.kind === 'tool_call');
    expect(calls).toHaveLength(3);
    expect(calls.find(item => item.id === 'a')).toMatchObject({ content: '{"a":1}', choiceIndex: 0, index: 0, complete: true });
    expect(calls.find(item => item.id === 'b')).toMatchObject({ content: '{"b":2}', choiceIndex: 0, index: 1, complete: true });
    expect(calls.find(item => item.id === 'c')).toMatchObject({ content: '{}', choiceIndex: 1, index: 0 });
    expect(result.usage.totalTokens).toBe(120);
    expect(result.usage.snapshots).toHaveLength(2);
  });
  it('does not equate clean EOF or a partial argument with successful completion', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', requestBody: '{"messages":[]}', streaming: true,
      responseBody: sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'shell', arguments: '{"cmd":' } }] } }] }),
    });
    expect(result.state).toBe('incomplete');
    expect(result.items[0]).toMatchObject({ content: '{"cmd":', complete: false });
    expect(result.usage.inputTokens).toBeNull();
  });
});

describe('Responses protocol evidence', () => {
  it('reconstructs public summary fragments by output/summary index', async () => {
    const result = await analyzeProtocol({ format: 'openai_responses', streaming: true, requestBody: '{"input":"hello"}',
      responseBody: sse(
        { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, item_id: 'rs-1', delta: '公开' },
        { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, item_id: 'rs-1', delta: '摘要' },
        { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, item_id: 'rs-1', text: '公开摘要' },
        { type: 'response.completed', response: { status: 'completed' } },
      ),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'reasoning', id: 'rs-1', content: '公开摘要', complete: true });
  });
  it('replaces fragmented output with final snapshots without duplicated text or tool arguments', async () => {
    const call = { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'shell', arguments: '{"cmd":"pwd"}', status: 'completed' };
    const message = { type: 'message', id: 'msg-1', content: [{ type: 'output_text', text: 'hello' }], status: 'completed' };
    const result = await analyzeProtocol({ format: 'openai_responses', streaming: true,
      requestBody: '{"instructions":"system","input":[{"type":"function_call_output","call_id":"prior-call","output":"ok"}],"tools":[{"type":"function","name":"shell","parameters":{"type":"object"}}]}',
      responseBody: sse(
        { type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '', status: 'in_progress' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc-1', delta: '{"cmd":' },
        { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc-1', delta: '"pwd"}' },
        { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc-1', arguments: '{"cmd":"pwd"}' },
        { type: 'response.output_text.delta', output_index: 1, content_index: 0, item_id: 'msg-1', delta: 'hello' },
        { type: 'response.completed', response: { id: 'response-1', status: 'completed', output: [call, message], usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 5 } } } },
      ),
    });
    expect(result.system).toBe('system');
    expect(result.state).toBe('completed');
    expect(result.responseId).toBe('response-1');
    expect(result.items.filter(item => item.kind === 'tool_call')).toHaveLength(1);
    expect(result.items.find(item => item.kind === 'tool_call')).toMatchObject({ id: 'fc-1', callId: 'call-1', content: '{"cmd":"pwd"}' });
    expect(result.items.filter(item => item.kind === 'text').map(item => item.content)).toEqual(['hello']);
    expect(result.items.find(item => item.kind === 'tool_result')).toMatchObject({ phase: 'request', callId: 'prior-call', content: 'ok' });
    expect(result.usage.totalTokens).toBe(120);
  });
  it.each(['incomplete', 'failed'] as const)('preserves %s terminal state and partial output', async state => {
    const result = await analyzeProtocol({ format: 'openai_responses', streaming: true, requestBody: '{"input":"hello"}',
      responseBody: sse({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'partial' }, { type: 'response.' + state, response: { status: state, incomplete_details: { reason: 'max_output_tokens' }, error: state === 'failed' ? { code: 'server_error', message: 'failed synthetic' } : null } }),
    });
    expect(result.state).toBe(state);
    expect(result.items[0]?.content).toBe('partial');
    if (state === 'failed') expect(result.errors[0]).toMatchObject({ code: 'server_error', message: 'failed synthetic' });
    else expect(result.stopReason).toBe('max_output_tokens');
  });
  it('retains only public reasoning summaries and function output history', async () => {
    const result = await analyzeProtocol({ format: 'openai_responses', streaming: false, requestBody: '{"input":"hello"}',
      responseBody: JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', id: 'rs-1', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: 'public summary' }] }] }),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'reasoning', content: 'public summary' });
    expect(JSON.stringify(result)).not.toContain('opaque');
  });
});

describe('Messages protocol evidence', () => {
  it.each([true, false, undefined, null, 'true', 1, {}, []].map(native => ({ native })))('preserves only a native boolean tool-result flag, independently from plain content and protocol state: $native', async ({ native }) => {
    const input = { format: 'anthropic_messages' as const, streaming: false,
      requestBody: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'native-tool', is_error: native, content: 'ENOENT' }] }] }),
      responseBody: JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'ack', is_error: true }], stop_reason: 'end_turn' }) };
    const before = JSON.stringify(input); const result = await analyzeProtocol(input);
    expect(result.parserVersion).toBe(3);
    expect(result.items[0]).toMatchObject({ phase: 'request', kind: 'tool_result', callId: 'native-tool', content: 'ENOENT', toolResultIsError: typeof native === 'boolean' ? native : null, sourcePath: 'messages[0].content[0]' });
    expect(result.items[1]?.toolResultIsError).toBeNull();
    expect(deriveProxyInsights(result).toolResultSignals).toEqual(native === true ? [{ signal: 'is_error=true', sourcePath: 'messages[0].content[0].is_error', evidenceKey: 'item-0' }] : []);
    expect(result.state).toBe('completed'); expect(result.errors).toEqual([]); expect(JSON.stringify(input)).toBe(before);
  });
  it('preserves per-block flags without assigning a tool-use or response flag and leaves structured content projection unchanged', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', streaming: false,
      requestBody: JSON.stringify({ messages: [{ role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', is_error: true, content: [{ type: 'text', text: 'first' }, { type: 'text', text: '中文' }] },
        { type: 'tool_result', tool_use_id: 'b', is_error: false, content: [{ type: 'text', text: 'second' }] },
        { type: 'tool_result', tool_use_id: 'c', content: { status: 'unknown' } },
        { type: 'tool_use', id: 'd', name: 'Read', input: {}, is_error: true },
      ] }] }), responseBody: JSON.stringify({ type: 'message', content: [{ type: 'tool_result', tool_use_id: 'response-only', is_error: true, content: 'result' }], stop_reason: 'end_turn' }) });
    expect(result.items.map(item => [item.content, item.toolResultIsError, item.sourcePath])).toEqual([
      ['first中文', true, 'messages[0].content[0]'], ['second', false, 'messages[0].content[1]'],
      ['{"status":"unknown"}', null, 'messages[0].content[2]'], ['{}', null, 'messages[0].content[3]'], ['result', null, 'response.content[0]'],
    ]);
    expect(deriveProxyInsights(result).toolResultSignals).toEqual([{ signal: 'is_error=true', sourcePath: 'messages[0].content[0].is_error', evidenceKey: 'item-0' }]);
  });
  it.each(['openai_chat', 'openai_responses', 'unknown'] as const)('never treats a generic or %s request field as a native Messages flag', async format => {
    const block = { type: 'tool_result', tool_use_id: 'not-messages', is_error: true, content: 'ENOENT' };
    const result = await analyzeProtocol({ format, streaming: false, requestBody: JSON.stringify({ messages: [{ role: 'user', content: [block] }], input: [{ type: 'function_call_output', call_id: 'x', output: 'ENOENT', is_error: true }] }), responseBody: '{}' });
    expect(result.items.length).toBeGreaterThan(0); expect(result.items.every(item => item.toolResultIsError === null)).toBe(true);
  });
  it('keeps the native flag when content projection is bounded and explicitly reports omitted block evidence', async () => {
    const limited = await analyzeProtocol({ format: 'anthropic_messages', streaming: false,
      requestBody: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'large', is_error: true, content: 'x'.repeat(40000) }] }] }), responseBody: null });
    expect(limited.items[0]?.toolResultIsError).toBe(true); expect(limited.items[0]?.content).toBe('x'.repeat(32768));
    expect(limited.completeness.reasons).toContain('value_limit'); expect(limited.completeness.reasons).toContain('response_missing');
    const many = await analyzeProtocol({ format: 'anthropic_messages', streaming: false,
      requestBody: JSON.stringify({ messages: [{ role: 'user', content: Array.from({ length: 1025 }, (_, index) => ({ type: 'tool_result', tool_use_id: 'tool-' + index, is_error: true, content: 'x' })) }] }), responseBody: null });
    expect(many.items).toHaveLength(1024); expect(many.items.every(item => item.toolResultIsError === true)).toBe(true);
    expect(many.items[1023]?.sourcePath).toBe('messages[0].content[1023]'); expect(many.completeness.reasons).toContain('record_limit');
    expect(Buffer.byteLength(JSON.stringify(many))).toBeLessThanOrEqual(1_000_000);
    expect(deriveProxyInsights(many).toolResultSignals[1023]).toEqual({ signal: 'is_error=true', sourcePath: 'messages[0].content[1023].is_error', evidenceKey: 'item-1023' });
  });
  it('does not conflate native tool failure with independent network or protocol failure', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', streaming: false,
      requestBody: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'native-tool', is_error: true, content: 'ENOENT' }] }] }),
      responseBody: JSON.stringify({ type: 'message', content: [], stop_reason: 'end_turn' }),
      transport: { version: 1, state: 'network_error', error: 'SYNTHETIC_NETWORK_ERROR', requestEnded: true, responseEnded: false, statusCode: 200 } });
    expect(result.items[0]?.toolResultIsError).toBe(true); expect(result.state).toBe('incomplete');
    expect(result.errors).toEqual([{ code: 'SYNTHETIC_NETWORK_ERROR', message: 'Observed network outcome: network_error', sourcePath: 'capture.transport' }]);
    expect(deriveProxyInsights(result).toolResultSignals).toEqual([{ signal: 'is_error=true', sourcePath: 'messages[0].content[0].is_error', evidenceKey: 'item-0' }]);
  });
  it('does not let an observed false tool flag turn a protocol error into overall success', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', streaming: true,
      requestBody: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'native-tool', is_error: false, content: 'ok' }] }] }),
      responseBody: sse({ type: 'error', error: { type: 'overloaded_error', message: 'synthetic error' } }, { type: 'message_stop' }) });
    expect(result.items[0]).toMatchObject({ content: 'ok', toolResultIsError: false });
    expect(result.state).toBe('failed'); expect(result.errors).toEqual([{ code: 'overloaded_error', message: 'synthetic error', sourcePath: 'events[0].error' }]);
    expect(deriveProxyInsights(result).toolResultSignals).toEqual([]);
  });
  it('retains the exact structural native-flag locator after tool declarations exhaust the display-content budget', async () => {
    const input = { format: 'anthropic_messages' as const, streaming: false,
      requestBody: JSON.stringify({ tools: Array.from({ length: 8 }, (_, index) => ({ name: 'tool-' + index, input_schema: { description: 'x'.repeat(40000) } })),
        messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'native-tool', is_error: true, content: 'ENOENT' }] }] }),
      responseBody: JSON.stringify({ type: 'message', content: [], stop_reason: 'end_turn' }) };
    const original = input.requestBody, sha = createHash('sha256').update(original).digest('hex');
    const result = await analyzeProtocol(input);
    expect(result.items[0]).toMatchObject({ kind: 'tool_result', content: '', toolResultIsError: true, sourcePath: 'messages[0].content[0]' });
    expect(deriveProxyInsights(result).toolResultSignals).toEqual([{ signal: 'is_error=true', sourcePath: 'messages[0].content[0].is_error', evidenceKey: 'item-0' }]);
    expect(result.completeness.complete).toBe(false); expect(result.completeness.reasons).toContain('content_limit');
    expect(result.declarations.reduce((sum, declaration) => sum + declaration.definition.length, 0) + result.items.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(262144);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1_000_000);
    expect(input.requestBody).toBe(original); expect(createHash('sha256').update(input.requestBody).digest('hex')).toBe(sha);
  });
  it('handles JSON content blocks and preserves missing cache counters as unknown', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', streaming: false, requestBody: '{"system":"system","messages":[]}',
      responseBody: JSON.stringify({ id: 'msg-1', type: 'message', stop_reason: 'tool_use', content: [{ type: 'text', text: 'answer' }, { type: 'tool_use', id: 't-1', name: 'shell', input: { cmd: 'pwd' } }], usage: { input_tokens: 12, output_tokens: 7 } }),
    });
    expect(result.state).toBe('completed');
    expect(result.items[1]).toMatchObject({ kind: 'tool_call', callId: 't-1', content: '{"cmd":"pwd"}', complete: true });
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 7, cacheReadTokens: null, totalTokens: null });
  });
  it('merges split usage snapshots and block-indexed text/thinking/tool JSON', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', streaming: true,
      requestBody: JSON.stringify({ system: [{ type: 'text', text: '系统' }], messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old-call', content: [{ type: 'text', text: 'old result' }] }] }], tools: [{ name: 'shell', input_schema: { type: 'object' } }] }),
      responseBody: sse(
        { type: 'message_start', message: { id: 'msg-1', model: 'demo', usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'public thinking' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-1', name: 'shell', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"cmd":' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"pwd"}' } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
        { type: 'message_delta', usage: { output_tokens: 20 } }, { type: 'message_stop' },
      ),
    });
    expect(result.system).toBe('系统');
    expect(result.items.filter(item => item.phase === 'response').map(item => [item.kind, item.content])).toEqual([['text', 'answer'], ['reasoning', 'public thinking'], ['tool_call', '{"cmd":"pwd"}']]);
    expect(result.items.find(item => item.kind === 'tool_result')).toMatchObject({ callId: 'old-call', content: 'old result', phase: 'request' });
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 10, totalTokens: 170, accounting: 'anthropic_additive_input' });
    expect(result.state).toBe('completed');
    expect(result.stopReason).toBe('tool_use');
  });
});

describe('bounded and forward-compatible evidence', () => {
  it('bounds oversized identifiers and tool names as well as body text', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', streaming: false, requestBody: '{"messages":[]}',
      responseBody: JSON.stringify({ id: 'x'.repeat(150_000), model: 'x'.repeat(150_000), choices: [{ message: { tool_calls: [{ id: 'x'.repeat(150_000), function: { name: 'x'.repeat(150_000), arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }),
    });
    expect(result.responseId?.length).toBeLessThanOrEqual(32_768);
    expect(result.model?.length).toBeLessThanOrEqual(32_768);
    expect(result.items[0]?.name?.length).toBeLessThanOrEqual(32_768);
    expect(result.completeness.complete).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
  });
  it('yields while analyzing a near-limit stream and bounds event-loop delay', async () => {
    const frame = sse({ choices: [{ index: 0, delta: { content: '字'.repeat(40) } }] });
    const responseBody = frame.repeat(Math.floor(1_900_000 / Buffer.byteLength(frame)));
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks += 1; }, 1);
    try {
      const result = await analyzeProtocol({ format: 'openai_chat', streaming: true, requestBody: '{"messages":[]}', responseBody });
      expect(ticks).toBeGreaterThan(3);
      expect(histogram.percentile(99) / 1e6).toBeLessThan(50);
      expect(result.items[0]?.content.length).toBeLessThanOrEqual(32_768);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
    } finally {
      clearInterval(heartbeat);
      histogram.disable();
    }
  });
  it('does not declare every choice complete while another observed choice is still streaming', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', streaming: true, requestBody: '{"messages":[]}',
      responseBody: sse({ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }, { index: 1, delta: { content: 'partial' } }] }),
    });
    expect(result.state).toBe('incomplete');
    expect(result.items.find(item => item.choiceIndex === 1)?.complete).toBe(false);
  });
  it('keeps valid content around malformed/unknown frames and preserves explicit errors', async () => {
    const result = await analyzeProtocol({ format: 'anthropic_messages', streaming: true, requestBody: '{"messages":[]}',
      responseBody: sse('{invalid', { type: 'future_event', x: 1 }, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
    });
    expect(result.unknownEvents).toBe(2);
    expect(result.state).toBe('failed');
    expect(result.errors[0]).toMatchObject({ code: 'overloaded_error', message: 'busy' });
  });
  it('bounds large text and reports projection incompleteness without mutating inputs', async () => {
    const input = { format: 'openai_chat' as const, streaming: false, requestBody: '{"messages":[]}', responseBody: JSON.stringify({ choices: [{ message: { content: '中'.repeat(40_000) }, finish_reason: 'stop' }] }) };
    const before = JSON.stringify(input);
    const result = await analyzeProtocol(input);
    expect(result.items[0]?.content.length).toBe(32_768);
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.reasons).toContain('value_limit');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('does not turn unknown or negative counters into zero', async () => {
    const result = await analyzeProtocol({ format: 'openai_chat', streaming: false, requestBody: '{"messages":[]}', responseBody: '{"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":0}}' });
    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.outputTokens).toBe(0);
    expect(result.usage.totalTokens).toBeNull();
  });
});
