import { describe, expect, it } from 'vitest';
import type { ArchitectureEvidence } from '../../src/core/architecture-diagnosis-types.js';
import { extractNativeFacts, linkNativeHandoffs, type NativeBody } from './native.js';
const body = (eventId: string, value: unknown, overrides: Partial<NativeBody> = {}): NativeBody => ({ sessionKey: 's', eventId, agentId: 'main', order: Number(eventId), raw: JSON.stringify(value),
  input: null, output: null, rawComplete: true, inputComplete: true, outputComplete: true, status: 'success', ...overrides });
function writer() { const refs: ArchitectureEvidence[] = []; return { refs, add(value: Omit<ArchitectureEvidence, 'id' | 'taskId'>) { const id = String(refs.length); refs.push({ ...value, id, taskId: 'collected:s' }); return id; } }; }
const call = (id: string, name: string, args: unknown) => ({ type: 'response_item', payload: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) } });
const result = (id: string, output: unknown) => ({ type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: JSON.stringify(output) } });
describe('native architecture evidence', () => {
  it('uses explicit last-call usage and Claude additive usage; never cumulative or generic event totals', async () => {
    const facts = await extractNativeFacts([
      body('1', { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 120 }, total_token_usage: { input_tokens: 99999 } } } }),
      body('2', { type: 'assistant', message: { id: 'claude-message', usage: { input_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }, content: [] } }),
      body('3', { tokens: { input: 99999 }, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 99999 } } } }),
    ], writer());
    expect(facts.contexts.map(value => [value.contextTokens, value.tokenBasis])).toEqual([[120, 'last_call_usage'], [35, 'request_usage']]);
    expect(facts.contexts.every(value => value.contextChars === null && !value.contextComplete)).toBe(true);
  });
  it('does not turn declarations into calls and requires unique exact call IDs for failure outcomes', async () => {
    const facts = await extractNativeFacts([body('1', { tools: [{ name: 'spawn_agent', parameters: {} }] }), body('2', call('x', 'Read', {})),
      body('3', result('wrong', { error: { code: 'unknown_tool' } })), body('4', result('x', { error: { code: 'invalid_arguments' } }))], writer());
    expect(facts.calls.map(value => value.name)).toEqual(['Read']);
    expect(facts.outcomes).toMatchObject([{ callId: 'x', status: 'error', errorClass: 'invalid_arguments' }]);
    const ambiguous = await extractNativeFacts([body('1', call('x', 'Read', {})), body('2', call('x', 'Read', {})), body('3', result('x', { error: { code: 'unknown_tool' } }))], writer());
    expect(ambiguous.outcomes).toEqual([]); expect(ambiguous.reasons).toContain('native_tool_identity_ambiguous');
  });
  it('links actual spawn result to confirmed child initial input and preserves a missing reference', async () => {
    const facts = await extractNativeFacts([body('1', call('spawn', 'spawn_agent', { message: 'Read /repo/contract.ts and preserve CODE-123.' })),
      body('2', result('spawn', { agent_id: 'child-native' })),
      body('3', { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read the repo.' }] } }, { agentId: 'child', sessionKey: 'child-session', initialInput: true })], writer());
    const targets = [{ nativeId: 'child-native', agentId: 'child', sessionKey: 'child-session', parentId: 'main' }];
    expect(linkNativeHandoffs(facts.calls, facts.inputs, targets)).toMatchObject([{ linkage: 'explicit', recipientAgentId: 'child', sentComplete: true, receivedComplete: true, receivedText: 'Read the repo.' }]);
    expect(linkNativeHandoffs(facts.calls, facts.inputs, [{ ...targets[0]!, parentId: 'other' }])).toMatchObject([{ linkage: 'unresolved', receivedRefId: null }]);
    expect(linkNativeHandoffs(facts.calls, facts.inputs, [...targets, { ...targets[0]!, agentId: 'other' }])).toMatchObject([{ linkage: 'ambiguous', recipientAgentId: null }]);
  });
  it('keeps send receiver unresolved without explicit receipt, and rejects truncated/declaration text', async () => {
    const facts = await extractNativeFacts([body('1', call('send', 'send_input', { id: 'child-native', message: 'Keep /repo/config.ts' })),
      body('2', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'not a delegation' }] } }, { agentId: 'child', initialInput: true }),
      body('3', call('broken', 'spawn_agent', { message: 'x' }), { rawComplete: false })], writer());
    expect(facts.inputs).toEqual([]); expect(facts.calls).toHaveLength(1);
    expect(linkNativeHandoffs(facts.calls, facts.inputs, [{ nativeId: 'child-native', agentId: 'child', sessionKey: 'child', parentId: 'main' }])).toMatchObject([{ linkage: 'unresolved', receivedComplete: false }]);
    expect(facts.reasons).toContain('native_body_limit');
  });
  it('never upgrades a failed spawn result containing an agent ID to confirmed receipt', async () => {
    const targets = [{ nativeId: 'child-native', agentId: 'child', sessionKey: 'child', parentId: 'main' }];
    for (const output of [{ type: 'tool_result', tool_use_id: 'spawn', is_error: true, content: '{"agent_id":"child-native"}' },
      { type: 'function_call_output', call_id: 'spawn', output: '{"agent_id":"child-native","error":{"message":"failed"}}' }]) {
      const facts = await extractNativeFacts([body('1', call('spawn', 'spawn_agent', { message: 'Read /repo/file.ts' })), body('2', output),
        body('3', { type: 'user', message: { content: 'Read /repo/file.ts' } }, { agentId: 'child', initialInput: true })], writer());
      expect(linkNativeHandoffs(facts.calls, facts.inputs, targets)).toMatchObject([{ linkage: 'unresolved', receivedComplete: false }]);
    }
  });
  it('counts one Claude message once across mirrored parts and streaming usage updates; missing IDs stay unavailable', async () => {
    const facts = await extractNativeFacts([
      body('1', { type: 'assistant', message: { id: 'same-message', content: [{ type: 'thinking', text: 'first' }], usage: { input_tokens: 100 } } }),
      body('2', { type: 'assistant', message: { id: 'same-message', content: [{ type: 'text', text: 'second' }], usage: { input_tokens: 100 } } }),
      body('3', { type: 'assistant', message: { id: 'same-message', content: [{ type: 'text', text: 'updated' }], usage: { input_tokens: 400 } } }),
      body('4', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: {} }], usage: { input_tokens: 99999 } } }),
    ], writer());
    expect(facts.contexts).toHaveLength(1); expect(facts.contexts[0]).toMatchObject({ contextTokens: 400, order: 3 });
    expect(facts.calls).toMatchObject([{ id: 'tool', name: 'Read' }]); expect(facts.reasons).toContain('native_call_identity_missing');
  });
});
