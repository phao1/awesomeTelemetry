import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeClaudeSample } from '../../src/adapters/claude-code.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { initSchema } from './schema.js';
import { writeNativeIdentities } from './trace-links.js';
import { hookTotals, insertClaudeHook, listClaudeHooks, projectClaudeHook } from './claude-hooks.js';

const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
const stamp = '2026-10-20T00:00:00.000Z';
function fixture() { const db = new Database(':memory:'); dbs.push(db); initSchema(db); return db; }
function seed(db: Database.Database, key: string, native = 'native', complete = true) {
  const record = normalizeClaudeSample({ sourceAgent: 'Claude', session: {}, events: [{ type: 'assistant', sessionId: native, timestamp: stamp, message: { id: 'msg', content: [{ type: 'text', text: 'PRIVATE_NATIVE_BODY' }] } }] }, 'fixture://' + key);
  storeTraceRecord(db, record, 'fixture://' + key, key);
  if (!complete) writeNativeIdentities(db, { source: 'scan', key }, { ...record.nativeIdentities!, completeness: { complete: false, omittedCount: 1, reasons: ['source_truncated'] } }, stamp);
}
function insert(db: Database.Database, session = 'native', agent: string | null = null) {
  return insertClaudeHook(db, projectClaudeHook({ session_id: session, agent_id: agent, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'same' }),
    { id: '00000000-0000-0000-0000-000000000001', bytes: 100, sha256: 'a'.repeat(64), status: 'complete', error: null }, stamp);
}
describe('CH-003/004 immutable observations and native identity scope', () => {
  it('preserves repeated deliveries, exact root/agent/session filters and descending keyset pages without raw', () => {
    const db = fixture(); insert(db); insert(db, 'other'); insert(db, 'native', 'child'); insert(db);
    const first = listClaudeHooks(db, { limit: 1 }); expect(first).toMatchObject({ items: [{ id: 4 }], hasMore: true, nextCursor: 4 });
    expect(listClaudeHooks(db, { limit: 1, cursor: first.nextCursor! }).items[0]?.id).toBe(3);
    expect(listClaudeHooks(db, { limit: 50, sessionId: 'native', toolUseId: 'same', agentId: '' }).items.map(item => item.id)).toEqual([4, 1]);
    expect(listClaudeHooks(db, { limit: 50, sessionId: 'native', toolUseId: 'same', agentId: 'child' }).items.map(item => item.id)).toEqual([3]);
    expect(JSON.stringify(first)).not.toMatch(/payload_ref|rawJson|sha256/); expect(hookTotals(db)).toEqual({ receivedCount: 4, lastReceivedAt: stamp });
  });
  it('resolves only exact unique complete retained Claude scan identities, detects late ambiguity and never writes native records', () => {
    const db = fixture(); insert(db); seed(db, 'one');
    const before = db.prepare('SELECT total_changes() AS n').get();
    expect(listClaudeHooks(db, { limit: 50 }).items[0]).toMatchObject({ nativeSessionKey: 'one', nativeSessionState: 'unique' });
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    seed(db, 'two'); expect(listClaudeHooks(db, { limit: 50 }).items[0]).toMatchObject({ nativeSessionKey: null, nativeSessionState: 'ambiguous' });
    insert(db, 'incomplete'); seed(db, 'inc', 'incomplete', false);
    expect(listClaudeHooks(db, { limit: 1 }).items[0]).toMatchObject({ nativeSessionKey: null, nativeSessionState: 'manifest_incomplete' });
    insert(db, 'absent'); expect(listClaudeHooks(db, { limit: 1 }).items[0]?.nativeSessionState).toBe('unresolved');
    expect(JSON.stringify(listClaudeHooks(db, { limit: 50 }))).not.toContain('PRIVATE_NATIVE_BODY');
  });
  it('preserves reported duration only on terminal tool hooks, optional IDs and empty internal agent types', () => {
    expect(projectClaudeHook({ session_id: 's', hook_event_name: 'SubagentStop', agent_id: 'internal', agent_type: '' })).toMatchObject({ agentId: 'internal', agentType: '', nativeDurationMs: null });
    expect(projectClaudeHook({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Read', duration_ms: 500 })).toMatchObject({ toolUseId: null, nativeDurationMs: null });
    expect(projectClaudeHook({ session_id: 's', hook_event_name: 'PostToolUseFailure', tool_name: 'Read', duration_ms: 12.5, is_interrupt: true })).toMatchObject({ nativeDurationMs: 12.5 });
    for (const value of [{ hook_event_name: 'SubagentStart' }, { hook_event_name: 'PreToolUse' }, { hook_event_name: 'PostToolUse', tool_name: 'Read', duration_ms: -1 }, { hook_event_name: 'Stop', agent_id: '' }]) expect(() => projectClaudeHook({ session_id: 's', ...value })).toThrow('BAD_REQUEST');
  });
});
