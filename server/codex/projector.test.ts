import { describe, expect, it } from 'vitest';
import { projectCodex } from './projector.js';
import { codexIdentity, type CodexSource } from './source.js';
import type { DirectedRecord } from './archive.js';

const ref = { id: '11111111-1111-4111-8111-111111111111', bytes: 0, sha256: '0'.repeat(64), status: 'complete' as const, error: null };
const source: CodexSource = { requestId: 'synthetic', active: false, directory: '', startedAt: '2026-10-16T00:00:00.000Z', headers: {}, request: ref, response: ref };
const meta = { session_id: 'native-session', thread_id: 'native-session', turn_id: 'turn-1', 'x-codex-turn-metadata': JSON.stringify({ session_id: 'native-session', thread_id: 'native-session' }) };
function fixture(entries: Array<['request' | 'response', unknown]>): AsyncIterable<DirectedRecord> {
  return { async *[Symbol.asyncIterator]() {
    let sequence = 0;
    for (const [direction, payload] of entries) { sequence += 1; yield { direction, payload: Buffer.from(JSON.stringify(payload)), sequence, elapsedMs: sequence * 10, kind: 'message' as const, binary: false }; }
  } };
}
const create = (extra = {}) => ({ type: 'response.create', model: 'synthetic', client_metadata: meta, input: [{ role: 'user', content: 'hello' }], ...extra });
const created = (id: string, extra = {}) => ({ type: 'response.created', response: { id, status: 'in_progress' }, ...extra });
const completed = (id: string, extra = {}) => ({ type: 'response.completed', response: { id, status: 'completed', output: [], usage: {
  input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120, ...extra } } });

describe('Codex Responses per-call projection', () => {
  it('projects custom tool input/output and compares only explicitly linked transmitted payloads', async () => {
    const result = await projectCodex(source, 1, fixture([
      ['request', create({ instructions: 'SYNTHETIC_SYSTEM', input: [{ type: 'message', role: 'user', content: 'x'.repeat(1000) }], tools: [{ type: 'custom', name: 'patch', format: { type: 'text' } }] })],
      ['response', created('custom-one')],
      ['response', { type: 'response.output_item.added', response_id: 'custom-one', item: { type: 'custom_tool_call', call_id: 'custom-tool', id: 'custom-item', name: 'patch', input: '' } }],
      ['response', { type: 'response.custom_tool_call_input.delta', response_id: 'custom-one', item_id: 'custom-item', delta: 'SYNTHETIC_PATCH_INPUT' }],
      ['response', completed('custom-one')],
      ['request', create({ previous_response_id: 'custom-one', input: [{ type: 'custom_tool_call_output', call_id: 'custom-tool', output: 'SYNTHETIC_PATCH_RESULT' }] })],
      ['response', created('custom-two')], ['response', completed('custom-two')],
    ]));
    expect(result.detail?.analysis.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool_result', callId: 'custom-tool', content: 'SYNTHETIC_PATCH_RESULT' })]));
    expect(result.detail?.toolReferences).toEqual([{ callId: 'custom-tool', proposalSequence: 0 }]);
    expect(result.detail?.contextDiff).toMatchObject({ baseSequence: 0, indicators: [], growth: { inputTokenDelta: 0 } });
    expect(result.detail?.contextDiff?.growth.deltaChars).toBeLessThan(0);
    const first = await projectCodex(source, 0, fixture([
      ['request', create()], ['response', created('custom-one')],
      ['response', { type: 'response.output_item.added', response_id: 'custom-one', item: { type: 'custom_tool_call', call_id: 'custom-tool', id: 'custom-item', name: 'patch', input: '' } }],
      ['response', { type: 'response.custom_tool_call_input.delta', response_id: 'custom-one', item_id: 'custom-item', delta: 'SYNTHETIC_PATCH_INPUT' }],
      ['response', completed('custom-one')],
    ]));
    expect(first.detail?.analysis.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool_call', name: 'patch', callId: 'custom-tool', content: 'SYNTHETIC_PATCH_INPUT' })]));
  });
  it('separates warmup, models and tool continuation; repeated usage is a snapshot, not a charge', async () => {
    const result = await projectCodex(source, 2, fixture([
      ['request', create({ generate: false })], ['response', created('warm')], ['response', completed('warm', { input_tokens: 0, output_tokens: 0 })],
      ['request', create({ previous_response_id: 'warm', instructions: 'SYSTEM' })], ['response', created('one')],
      ['response', { type: 'response.output_item.done', response_id: 'one', output_index: 0, item: { type: 'function_call', name: 'read', call_id: 'tool-1', arguments: '{"path":"synthetic"}' } }],
      ['response', completed('one')], ['response', completed('one')],
      ['request', create({ previous_response_id: 'one', input: [{ type: 'function_call_output', call_id: 'tool-1', output: 'SYNTHETIC_FILE' }] })],
      ['response', created('two')], ['response', { type: 'response.output_text.delta', response_id: 'two', delta: 'OK', output_index: 0 }],
      ['response', completed('two')],
    ]));
    expect(result.page.items).toHaveLength(3);
    expect(result.page.items[0]?.warmup).toBe(true);
    expect(result.page.items[1]?.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, totalTokens: 120 });
    expect(result.page.items[2]).toMatchObject({ predecessorSequence: 1, nativeSessionId: 'native-session', nativeTurnId: 'turn-1', firstContentMs: 20, durationMs: 30 });
    expect(result.detail?.toolReferences).toEqual([{ callId: 'tool-1', proposalSequence: 1 }]);
    expect(result.detail?.analysis.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool_result', callId: 'tool-1', content: 'SYNTHETIC_FILE' }), expect.objectContaining({ kind: 'text', content: 'OK' })]));
    expect(JSON.stringify(result.page)).not.toContain('SYNTHETIC_FILE');
    expect(result.page.complete).toBe(true);
  });
  it('keeps interleaved named lanes and cross-lane explicit lineage separate', async () => {
    const a = { stream_id: 'a' }, b = { stream_id: 'b' };
    const result = await projectCodex(source, 1, fixture([
      ['request', create(a)], ['request', create(b)], ['response', created('ra', a)], ['response', created('rb', b)],
      ['response', { ...completed('rb'), ...b }], ['response', { ...completed('ra'), ...a }],
      ['request', create({ ...b, previous_response_id: 'ra' })], ['response', created('rc', b)], ['response', { ...completed('rc'), ...b }],
    ]));
    expect(result.page.items.map(call => [call.streamId, call.responseId, call.predecessorSequence])).toEqual([['a', 'ra', null], ['b', 'rb', null], ['b', 'rc', 0]]);
    expect(result.page.complete).toBe(true);
  });
  it('does not assign an unscoped error to a named lane', async () => {
    const result = await projectCodex(source, undefined, fixture([
      ['request', create({ stream_id: 'a' })], ['response', created('r', { stream_id: 'a' })], ['response', { type: 'error', error: { code: 'synthetic' } }],
    ]));
    expect(result.page.unassignedEvents).toBe(1);
    expect(result.page.items[0]?.state).toBe('incomplete');
    expect(result.page.items[0]?.usage.totalTokens).toBeNull();
  });
  it('marks reused response IDs ambiguous rather than silently counting both', async () => {
    const result = await projectCodex(source, 1, fixture([
      ['request', create()], ['response', created('same')], ['response', completed('same')],
      ['request', create({ previous_response_id: 'same' })], ['response', created('same')], ['response', completed('same')],
    ]));
    expect(result.page.items.every(call => call.reasons.includes('response_id_reused') && call.usage.totalTokens === null)).toBe(true);
    expect(result.page.items[1]?.predecessorSequence).toBeNull();
    expect(result.detail?.analysis.state).toBe('unknown');
  });
  it('preserves a completed call when the overall connection is interrupted', async () => {
    const result = await projectCodex({ ...source, request: { ...ref, status: 'interrupted' }, response: { ...ref, status: 'interrupted' } }, 0,
      fixture([['request', create()], ['response', created('r')], ['response', completed('r')]]));
    expect(result.page.items[0]?.state).toBe('completed');
    expect(result.detail?.analysis.state).toBe('completed');
  });
  it('keeps active calls pending with unknown timing/usage, not zero', async () => {
    const result = await projectCodex({ ...source, active: true }, 0, fixture([['request', create()], ['response', created('r')]]));
    expect(result.page.items[0]).toMatchObject({ state: 'pending', durationMs: null, firstContentMs: null, usage: { totalTokens: null } });
    expect(result.page.complete).toBe(false);
  });
  it('does not treat previous_response_id as a retry or manufacture missing context', async () => {
    const result = await projectCodex(source, 0, fixture([['request', create({ previous_response_id: 'external' })], ['response', created('r')], ['response', completed('r')]]));
    expect(result.page.items[0]).toMatchObject({ predecessorSequence: null, reasons: ['previous_response_outside_capture'] });
    expect(result.detail?.requestPreview).not.toContain('unknown history');
  });
  it('preserves failed protocol state and error evidence', async () => {
    const result = await projectCodex(source, 0, fixture([['request', create()], ['response', created('r')], ['response', { type: 'error', error: { code: 'SYNTHETIC_ERROR', message: 'synthetic failure' } }]]));
    expect(result.page.items[0]?.state).toBe('failed');
    expect(result.detail?.analysis.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SYNTHETIC_ERROR' })]));
  });
  it('rejects a lane mismatch instead of attaching a nearby event', async () => {
    const result = await projectCodex(source, undefined, fixture([['request', create({ stream_id: 'a' })], ['response', created('r', { stream_id: 'a' })], ['response', completed('r')]]));
    expect(result.page.unassignedEvents).toBe(1); expect(result.page.items[0]?.reasons).toContain('response_lane_conflict');
    expect(result.page.items[0]?.usage.totalTokens).toBeNull();
  });
  it('pages a long connection inside the projector and resolves selected late lineage/tools without body fan-out', async () => {
    const entries: Array<['request' | 'response', unknown]> = [];
    for (let i = 0; i < 300; i += 1) entries.push(
      ['request', create({ ...(i > 0 ? { previous_response_id: 'r-' + (i - 1) } : {}), input: [{ type: 'function_call_output', call_id: 't-' + (i - 1), output: 'ONLY_SELECTED_BODY_' + i }] })],
      ['response', created('r-' + i)],
      ['response', { type: 'response.output_item.done', response_id: 'r-' + i, item: { type: 'function_call', call_id: 't-' + i, name: 'read', arguments: '{}' } }],
      ['response', completed('r-' + i)],
    );
    const page = await projectCodex(source, undefined, fixture(entries), { offset: 280, limit: 20 });
    expect(page.page.items.map(call => call.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => 280 + i));
    expect(page.page.total).toBe(300); expect(page.page.complete).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64 * 1024);
    expect(JSON.stringify(page)).not.toContain('ONLY_SELECTED_BODY');
    const selected = await projectCodex(source, 299, fixture(entries), { detailOnly: true });
    expect(selected.page.items).toEqual([]);
    expect(selected.detail?.call).toMatchObject({ sequence: 299, predecessorSequence: 298, state: 'completed' });
    expect(selected.detail?.toolReferences).toEqual([{ callId: 't-298', proposalSequence: 298 }]);
    expect(selected.detail?.requestPreview).toContain('ONLY_SELECTED_BODY_299');
    expect(selected.detail?.contextDiff?.baseSequence).toBe(298);
  });
  it('enforces the new call bound and still consumes the full archive', async () => {
    let consumed = 0;
    const records = { async *[Symbol.asyncIterator]() {
      for await (const record of fixture(Array.from({ length: 4100 }, () => ['request', create()]))) { consumed += 1; yield record; }
    } };
    await expect(projectCodex(source, undefined, records)).rejects.toMatchObject({ code: 'CODEX_INSPECTION_LIMIT' });
    expect(consumed).toBe(4100);
  });
  it('bounds the retained metadata index separately from call count, without accepting a partial result', async () => {
    const entries: Array<['request' | 'response', unknown]> = [];
    for (let i = 0; i < 300; i += 1) entries.push(['request', create({ input: Array.from({ length: 64 }, (_, j) => ({ type: 'function_call_output', call_id: i + '-' + j + '-'.repeat(240), output: '' })) })]);
    await expect(projectCodex(source, undefined, fixture(entries))).rejects.toMatchObject({ code: 'CODEX_INSPECTION_LIMIT' });
  });
});
describe('explicit Codex scope', () => {
  it('accepts matching body declarations and ignores a handshake turn', () => {
    expect(codexIdentity({ 'x-codex-turn-metadata': JSON.stringify({ session_id: 'native-session', turn_id: 'wrong-turn' }) }, create())).toEqual({ sessionId: 'native-session', turnId: 'turn-1', conflict: false });
    expect(codexIdentity({ 'x-codex-turn-metadata': JSON.stringify({ session_id: 'native-session', turn_id: 'wrong-turn' }) }, {})).toEqual({ sessionId: 'native-session', turnId: null, conflict: false });
  });
  it('refuses contradictions and unlabeled generic session fields', () => {
    expect(codexIdentity({ 'thread-id': 'another' }, create())).toMatchObject({ sessionId: null, turnId: null, conflict: true });
    expect(codexIdentity({ 'session-id': 'generic' }, {})).toMatchObject({ sessionId: null });
  });
});
