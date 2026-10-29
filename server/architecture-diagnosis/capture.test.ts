import { describe, expect, it } from 'vitest';
import type { ArchitectureEvidence } from '../../src/core/architecture-diagnosis-types.js';
import { analyzeProtocol } from '../proxy/protocol-analysis.js';
import { extractCaptureFacts, pairCaptureResults } from './capture.js';
import { analyzeArchitectureDiagnosis } from '../../src/core/architecture-diagnosis-analysis.js';
function writer() { const refs: ArchitectureEvidence[] = []; return { refs, add(value: Omit<ArchitectureEvidence, 'id' | 'taskId'>) { const id = String(refs.length); refs.push({ ...value, id, taskId: 'collected:s' }); return id; } }; }
async function source(request: unknown, response: unknown = {}, id = 1) { const requestBody = JSON.stringify(request); return { id, callSequence: null, streamId: 'capture:stream', agentId: null, sessionKey: null, order: id,
  analysis: await analyzeProtocol({ format: 'openai_responses' as const, requestBody, responseBody: JSON.stringify(response), streaming: false }), requestBody, requestComplete: true }; }
describe('capture architecture facts', () => {
  it('retains exact different schemas and actual proposal arguments, flattening callable namespaces', async () => {
    const data = await source({ input: [], tools: [{ type: 'function', name: 'Read', parameters: { type: 'object', required: ['path'] } }, { type: 'function', name: 'Read', parameters: { type: 'object', required: ['url'] } },
      { type: 'namespace', name: 'files', tools: [{ type: 'function', name: 'write', parameters: { type: 'object' } }] }], tool_choice: { type: 'function', name: 'Read' } },
    { id: 'r', status: 'completed', output: [{ type: 'function_call', call_id: 'c', name: 'Read', arguments: '{}' }] });
    const w = writer(), facts = extractCaptureFacts(data, w);
    expect(facts.context?.tools.map(value => value.name)).toEqual(['Read', 'Read', 'files.write']);
    expect(facts.context?.tools[0]?.signature).not.toBe(facts.context?.tools[1]?.signature);
    expect(facts.context?.proposals).toMatchObject([{ id: 'c', argumentKeys: [], argumentsComplete: true }]);
    expect(facts.context?.toolChoice).toEqual({ mode: 'named', name: 'Read' });
    expect(w.refs.some(value => value.path === 'tools[2].tools[0]')).toBe(true);
  });
  it('keeps built-in catalogs unknown and previous-response payloads partial', async () => {
    const facts = extractCaptureFacts(await source({ previous_response_id: 'before', input: [{ role: 'user', content: 'delta' }], tools: [{ type: 'web_search' }] }), writer());
    expect(facts.context).toMatchObject({ contextComplete: false, toolCatalogComplete: false }); expect(facts.reasons).toContain('incremental_request_context');
  });
  it('pairs a returned result only in the same source stream with a unique earlier actual proposal', async () => {
    const a = extractCaptureFacts(await source({ input: [] }, { output: [{ type: 'function_call', call_id: 'call', name: 'Read', arguments: '{}' }] }), writer());
    const b = extractCaptureFacts(await source({ input: [{ type: 'function_call_output', call_id: 'call', output: '{"error":{"code":"unknown_tool"}}' }] }, {}, 2), writer());
    const calls = a.calls.map(call => ({ scope: 'capture:stream', call }));
    expect(pairCaptureResults(calls, b.results)).toMatchObject([{ callId: 'call', errorClass: 'unknown_tool', status: 'error' }]);
    expect(pairCaptureResults(calls, b.results.map(value => ({ ...value, scope: 'another' })))).toEqual([]);
  });
  it('locates recorded native usage and distinguishes additive context input from the raw input field', async () => {
    const data = await source({ input: [] });
    data.analysis.usage = { ...data.analysis.usage, inputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5, accounting: 'anthropic_additive_input' };
    const http = writer(), facts = extractCaptureFacts(data, http);
    expect(facts.context?.contextTokens).toBe(35);
    expect(http.refs.find(value => value.id === facts.context?.refId)).toMatchObject({ path: 'analysis.usage', excerpt: expect.stringContaining('inputTokens=20;') });
    expect(http.refs.find(value => value.id === facts.context?.refId)?.excerpt).toContain('contextInputTokens=35');
    const codex = writer(), logical = extractCaptureFacts({ ...data, callSequence: 2 }, codex);
    expect(codex.refs.find(value => value.id === logical.context?.refId)?.path).toBe('call.usage');
    const unavailable = writer(), noUsage = extractCaptureFacts({ ...data, analysis: { ...data.analysis, usage: { ...data.analysis.usage, inputTokens: null } } }, unavailable);
    expect(unavailable.refs.find(value => value.id === noUsage.context?.refId)?.path).toBe('request');
  });
  it.each([
    [{ type: 'auto' }, { mode: 'auto', name: null }],
    [{ type: 'none' }, { mode: 'none', name: null }],
    [{ type: 'any', disable_parallel_tool_use: true }, { mode: 'required', name: null }],
    [{ type: 'tool', name: 'Read', disable_parallel_tool_use: false }, { mode: 'named', name: 'Read' }],
    [{ type: 'function', function: { name: 'Read' } }, { mode: 'named', name: 'Read' }],
    [{ type: 'function', name: 'Read' }, { mode: 'named', name: 'Read' }],
    [{ type: 'custom', name: 'Read' }, { mode: 'named', name: 'Read' }],
    ['auto', { mode: 'auto', name: null }], ['none', { mode: 'none', name: null }], ['required', { mode: 'required', name: null }],
  ])('retains supported provider tool-choice semantics %j', async (choice, expected) => {
    expect(extractCaptureFacts(await source({ input: [], tool_choice: choice }), writer()).context?.toolChoice).toEqual(expected);
  });
  it.each([
    null, [], {}, { name: 'Read' }, { type: 'future', name: 'Read' }, { type: 'required' },
    { type: 'auto', name: 'Read' }, { type: 'none', function: { name: 'Read' } },
    { type: 'tool', name: '' }, { type: 'tool', name: 'Read', disable_parallel_tool_use: 'true' },
    { type: 'function', function: { name: 'Read' }, name: 'Write' },
    { type: 'function', function: { name: 'Read', unsupported: true } },
    { type: 'tool', name: 'Read', unsupported: true },
  ])('keeps malformed or unsupported tool-choice objects unknown %j', async choice => {
    expect(extractCaptureFacts(await source({ input: [], tool_choice: choice }), writer()).context?.toolChoice).toEqual({ mode: 'unknown', name: null });
  });
  it('checks an actual Anthropic proposal against none while auto remains allowed and unsupported choices remain unknown', async () => {
    for (const choice of [{ type: 'none' }, { type: 'auto' }, { type: 'future' }]) {
      const requestBody = JSON.stringify({ model: 'recorded-model', max_tokens: 256, messages: [{ role: 'user', content: 'Read the file' }],
        tools: [{ name: 'Read', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }], tool_choice: choice });
      const analysis = await analyzeProtocol({ format: 'anthropic_messages', requestBody, streaming: false,
        responseBody: JSON.stringify({ id: 'message', type: 'message', role: 'assistant', model: 'recorded-model', stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'call', name: 'Read', input: { path: '/repo/file' } }], usage: { input_tokens: 20, output_tokens: 5 } }) });
      const w = writer(), facts = extractCaptureFacts({ id: 1, callSequence: null, streamId: 'capture:1', agentId: null, sessionKey: null,
        order: 1, analysis, requestBody, requestComplete: true }, w);
      expect(facts.context?.proposals).toHaveLength(1);
      const report = analyzeArchitectureDiagnosis({ version: 1, taskId: 'collected:s', title: 'Retained Anthropic call', member: 'all', origin: 'collected', revision: '1',
        evidence: w.refs, contexts: [facts.context!], outcomes: [], handoffs: [],
        coverage: { context: 'complete', tools: 'complete', handoffs: 'unavailable', nativeEvents: 0, nativeEventTotal: 0, captures: 1, logicalCalls: 1, omitted: 0, reasons: [] } });
      expect(report.findings.some(finding => finding.rule === 'forced_tool_choice_mismatch')).toBe(choice.type === 'none');
      if (choice.type === 'auto') expect(report.categories.tool_conflict).toBe('not_observed');
      if (choice.type === 'future') expect(report.categories.tool_conflict).toBe('insufficient');
    }
  });
});
