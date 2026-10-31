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
  it('retains Codex event-side tool ids verbatim and scopes them to their own explicit session', () => {
    const result = collectCodexIdentities([
      { type: 'session_meta', payload: { id: 's-a' } },
      { type: 'event_msg', payload: { type: 'mcp_tool_call_end', session_id: 's-a', turn_id: 't-a', call_id: 'call:7' } },
      { type: 'event_msg', payload: { type: 'web_search_end', session_id: 's-b', turn_id: 't-b', call_id: 'call:7' } },
    ]);
    expect(result.items.filter(item => item.kind === 'tool_call')).toEqual([
      { namespace: 'protocol:openai', kind: 'tool_call', value: 'call:7', scope: 's-a', eventId: null, sourcePath: 'events[1].payload.call_id' },
      { namespace: 'protocol:openai', kind: 'tool_call', value: 'call:7', scope: 's-b', eventId: null, sourcePath: 'events[2].payload.call_id' },
    ]);
    expect(result.items.filter(item => item.kind === 'turn').map(item => item.scope)).toEqual(['s-a', 's-b']);
  });
  it('does not borrow a Codex scope when explicit metadata contains different native session ids', () => {
    const result = collectCodexIdentities([
      { type: 'session_meta', payload: { id: 'child', session_id: 'parent', parent_thread_id: 'parent' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'unscoped' } },
    ]);
    expect(result.items.find(item => item.kind === 'tool_call')?.scope).toBeNull();
    expect(result.items.find(item => item.kind === 'parent_session')).toMatchObject({ value: 'parent', scope: 'child' });
  });
  it('scopes OpenCode parent-session evidence to the child without reinterpreting parent-message IDs', () => {
    const result = collectOpencodeIdentities({ id: 'child', parentID: 'parent' }, [{ id: 'reply', sessionID: 'child', parentID: 'user-message', content: [] }], 'opencode');
    expect(result.items.find(item => item.kind === 'parent_session')).toMatchObject({ value: 'parent', scope: 'child', sourcePath: 'session.parentID' });
    expect(result.items.some(item => item.value === 'user-message')).toBe(false);
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
