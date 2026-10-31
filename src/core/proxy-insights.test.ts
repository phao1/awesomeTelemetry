import { describe, expect, it } from 'vitest';

import { deriveProxyInsights } from './proxy-insights.js';
import type { ProxyProtocolAnalysis, ProxyProtocolItem } from './trace-types.js';

function fixture(): ProxyProtocolAnalysis {
  return { parserVersion: 1, requestFormat: 'openai_chat', model: null, responseId: null,
    state: 'completed', stopReason: null, system: null, declarations: [], items: [], errors: [], unknownEvents: 0,
    usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: null, reasoningTokens: null,
      nativeTotalTokens: 130, totalTokens: 130, accounting: 'openai_subsets', snapshots: [] },
    completeness: { complete: true, omittedCount: 0, reasons: [] } };
}
function result(content: string, sourcePath = 'messages[2]'): ProxyProtocolItem {
  return { phase: 'request', kind: 'tool_result', id: null, callId: 'call-1', name: null,
    index: 2, choiceIndex: null, content, toolResultIsError: null, complete: true, sourcePath };
}

describe('single-call evidence insights', () => {
  it.each([true, false, null])('links a projected Messages boolean flag without parsing ordinary text as failure: %j', native => {
    // Actual wire block → parser → derive is covered in protocol-analysis.test.ts.
    const analysis = fixture(); analysis.requestFormat = 'anthropic_messages';
    analysis.items = [{ ...result('ENOENT', 'messages[0].content[0]'), toolResultIsError: native }];
    const before = JSON.stringify(analysis);
    expect(deriveProxyInsights(analysis).toolResultSignals).toEqual(native === true ? [{ signal: 'is_error=true', sourcePath: 'messages[0].content[0].is_error', evidenceKey: 'item-0' }] : []);
    expect(analysis.items[0]?.content).toBe('ENOENT'); expect(analysis.errors).toEqual([]); expect(analysis.state).toBe('completed'); expect(JSON.stringify(analysis)).toBe(before);
  });
  it('emits one exact native source signal when content also reports an error, without losing independent content signals for observed false', () => {
    const analysis = fixture(); analysis.requestFormat = 'anthropic_messages';
    analysis.items = [{ ...result('{"status":"error"}'), toolResultIsError: true }, { ...result('{"exit_code":2}'), toolResultIsError: false }];
    expect(deriveProxyInsights(analysis).toolResultSignals).toEqual([
      { signal: 'is_error=true', sourcePath: 'messages[2].is_error', evidenceKey: 'item-0' },
      { signal: 'exit_code=2', sourcePath: 'messages[2]', evidenceKey: 'item-1' },
    ]);
  });
  it('uses OpenAI input including cached subset, without adding cache or reasoning again', () => {
    const analysis = fixture();
    analysis.usage.reasoningTokens = 25;
    expect(deriveProxyInsights(analysis).cache).toEqual({ ratio: 0.4, readTokens: 40, inputTokens: 100, reason: 'known' });
  });
  it('includes all three Anthropic input categories in the denominator', () => {
    const analysis = fixture(); Object.assign(analysis.usage, { accounting: 'anthropic_additive_input', inputTokens: 10, cacheReadTokens: 70, cacheWriteTokens: 20 });
    expect(deriveProxyInsights(analysis).cache).toEqual({ ratio: 0.7, readTokens: 70, inputTokens: 100, reason: 'known' });
  });
  it('keeps an absent Anthropic cache-write counter unknown rather than assuming zero', () => {
    const analysis = fixture(); analysis.usage.accounting = 'anthropic_additive_input';
    expect(deriveProxyInsights(analysis).cache).toMatchObject({ ratio: null, inputTokens: null, reason: 'missing' });
  });
  it('keeps zero cache reads valid but a zero input denominator undefined', () => {
    const analysis = fixture(); analysis.usage.cacheReadTokens = 0;
    expect(deriveProxyInsights(analysis).cache.ratio).toBe(0);
    analysis.usage.inputTokens = 0;
    expect(deriveProxyInsights(analysis).cache).toMatchObject({ ratio: null, reason: 'zero_input' });
  });
  it.each([null, -1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1])('rejects missing/invalid cache count %s', value => {
    const analysis = fixture(); analysis.usage.cacheReadTokens = value;
    expect(deriveProxyInsights(analysis).cache.ratio).toBeNull();
  });
  it('does not clamp an inconsistent OpenAI cached subset to an apparently valid percentage', () => {
    const analysis = fixture(); analysis.usage.cacheReadTokens = 101;
    expect(deriveProxyInsights(analysis).cache).toMatchObject({ ratio: null, reason: 'inconsistent' });
  });
  it('does not derive a rate for unknown accounting or an unsafe additive denominator', () => {
    const analysis = fixture(); analysis.usage.accounting = 'unknown';
    expect(deriveProxyInsights(analysis).cache.reason).toBe('unknown_accounting');
    Object.assign(analysis.usage, { accounting: 'anthropic_additive_input', inputTokens: Number.MAX_SAFE_INTEGER, cacheWriteTokens: 1 });
    expect(deriveProxyInsights(analysis).cache.ratio).toBeNull();
  });
  it('ranks projected UTF-16 characters with source evidence, without inventing whole-context totals', () => {
    const analysis = fixture(); analysis.system = '🤖';
    analysis.declarations = [{ name: 'read', type: 'function', definition: 'abcdefghij', sourcePath: 'tools[0]' }];
    analysis.items = [result('12345')];
    expect(deriveProxyInsights(analysis).sizes).toEqual([
      { kind: 'declaration', chars: 10, sourcePath: 'tools[0]', evidenceKey: 'declaration-0' },
      { kind: 'tool_result', chars: 5, sourcePath: 'messages[2]', evidenceKey: 'item-0' },
      { kind: 'system', chars: 2, sourcePath: 'analysis.system', evidenceKey: 'system' },
    ]);
  });
  it.each(['{"is_error":true}', '{"isError":true}', '{"status":"error"}', '{"status":"failed"}', '{"exit_code":2}', '{"error":"ENOENT"}'])('retains an explicit result-content signal and its exact source: %s', content => {
    const analysis = fixture(); analysis.items = [result(content)];
    expect(deriveProxyInsights(analysis).toolResultSignals).toHaveLength(1);
    expect(deriveProxyInsights(analysis).toolResultSignals[0]).toMatchObject({ sourcePath: 'messages[2]', evidenceKey: 'item-0' });
  });
  it('does not classify natural-language mentions, malformed payloads or successful JSON as failed tool execution', () => {
    const analysis = fixture(); analysis.items = ['error: example from documentation', '{"is_error":', '{"is_error":false,"error":null,"exit_code":0}', '{"error":0}', '{"error":{}}', '[]'].map(value => result(value));
    expect(deriveProxyInsights(analysis).toolResultSignals).toEqual([]);
  });
  it('counts response proposals separately from historical tool calls and never assigns executions', () => {
    const analysis = fixture(); analysis.items = [{ ...result('{}'), kind: 'tool_call', phase: 'response' }, { ...result('{}'), kind: 'tool_call' }];
    expect(deriveProxyInsights(analysis).proposalCount).toBe(1);
    expect(deriveProxyInsights(analysis).toolResultSignals).toEqual([]);
  });
  it('does not mutate partial protocol evidence or replay/sum usage snapshots', () => {
    const analysis = fixture(); analysis.completeness = { complete: false, omittedCount: 1, reasons: ['value_limit'] };
    analysis.usage.snapshots = [{ eventIndex: 1, value: '{"prompt_tokens":100}' }, { eventIndex: 2, value: '{"prompt_tokens":100}' }];
    const before = JSON.stringify(analysis);
    expect(deriveProxyInsights(analysis).cache.ratio).toBe(0.4);
    expect(JSON.stringify(analysis)).toBe(before);
  });
});
