import { describe, expect, it } from 'vitest';
import { collectClaudeIdentities, collectCodexIdentities, collectOpencodeIdentities, createIdentityCollector } from './native-identities.js';

describe('explicit native identities', () => {
  it('retains Claude session/request/message/tool ids with native scopes without deriving user turns', () => {
    const rows = [{ type: 'assistant', uuid: 'uuid-1', sessionId: 's1', requestId: 'req-1', message: { id: 'msg-1', content: [{ type: 'tool_use', id: 'tool-1' }] } }, { type: 'user', sessionId: 's1', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] } }];
    const before = JSON.stringify(rows);
    const result = collectClaudeIdentities(rows);
    expect(result.items.find(item => item.kind === 'session')).toMatchObject({ namespace: 'agent:claude', value: 's1', scope: null, sourcePath: 'events[0].sessionId' });
    expect(result.items.find(item => item.kind === 'response')).toMatchObject({ value: 'msg-1', scope: 's1' });
    expect(result.items.filter(item => item.kind === 'tool_call')).toHaveLength(1);
    expect(result.items.some(item => item.kind === 'turn')).toBe(false);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('keeps conflicting native session ids rather than silently choosing one', () => {
    const result = collectClaudeIdentities([{ sessionId: 'a' }, { sessionId: 'b' }]);
    expect(result.items.filter(item => item.kind === 'session').map(item => item.value)).toEqual(['a', 'b']);
  });
  it('uses the wrapper provider namespace', () => {
    expect(collectClaudeIdentities([{ sessionId: 's1' }], 'codeagent').items[0]?.namespace).toBe('agent:codeagent');
  });
  it('retains Codex native metadata id, parent thread, turns and call ids without treating item ids as response ids', () => {
    const result = collectCodexIdentities([
      { type: 'session_meta', payload: { id: 'native-session', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } } },
      { type: 'turn_context', payload: { turn_id: 'turn-1' } },
      { type: 'response_item', payload: { id: 'item-1', type: 'function_call', call_id: 'call-1' } },
    ]);
    expect(result.items.find(item => item.kind === 'session')?.value).toBe('native-session');
    expect(result.items.find(item => item.kind === 'parent_session')?.value).toBe('parent');
    expect(result.items.find(item => item.kind === 'turn')).toMatchObject({ value: 'turn-1', scope: 'native-session' });
    expect(result.items.some(item => item.kind === 'response')).toBe(false);
    expect(result.items.find(item => item.kind === 'tool_call')?.value).toBe('call-1');
  });
  it('preserves OpenCode-family session/message/call IDs under the exact provider namespace', () => {
    const result = collectOpencodeIdentities({ id: 's1', parentID: 'parent' }, [{ id: 'm1', sessionID: 's1', content: [{ type: 'tool', callID: 'c1' }] }], 'codearts');
    expect(result.items.find(item => item.kind === 'session')?.namespace).toBe('agent:codearts');
    expect(result.items.find(item => item.kind === 'tool_call')).toMatchObject({ value: 'c1', scope: 's1' });
  });
  it('does not manufacture an identity when native fields are absent', () => {
    expect(collectCodexIdentities([{ type: 'response_item', payload: { role: 'assistant', content: 'hello' } }])).toMatchObject({ items: [], completeness: { complete: false, reasons: ['no_native_identifiers'] } });
  });
  it('bounds count and oversized identifiers without truncating matching keys', () => {
    const collector = createIdentityCollector(1);
    collector.add('agent:claude', 'session', 'x'.repeat(1025), 'sessionId');
    collector.add('agent:claude', 'session', 'first', 'sessionId');
    collector.add('agent:claude', 'session', 'second', 'sessionId');
    const result = collector.finish();
    expect(result.items.map(item => item.value)).toEqual(['first']);
    expect(result.completeness).toEqual({ complete: false, omittedCount: 2, reasons: ['identifier_limit', 'identity_limit'] });
  });
});
