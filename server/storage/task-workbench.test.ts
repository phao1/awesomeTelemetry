import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeNativeIdentities } from './trace-links.js';
import { initSchema } from './schema.js';
import { getTask, listTasks, taskRecords } from './task-workbench.js';
let db: Database.Database;
const when = '2026-10-25T00:00:00.000Z';
function session(id: string, title = id) {
  db.prepare('INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES(?,?,?,?,?,?,?,1)').run(id, 'codex', 'Codex', title, when, when, '/fixture/' + id);
}
function agent(id: string, key: string, root: boolean) {
  db.prepare('INSERT INTO team_agents(id,run_id,native_id,display_name,role_class,session_keys_json) VALUES(?,?,?,?,?,?)').run(id, 'run1', root ? 'native-root' : id, id, root ? 'leader' : 'subagent', JSON.stringify([key]));
}
function event(key: string, n: number, status = 'success', title = 'Read source') {
  db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,duration_ms,status,actor,input_summary,output_summary) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(key, 'e' + n, n, 'tool', 'implement', title, new Date(Date.parse(when) + n * 1000).toISOString(), 10, status, 'Read', 'SECRET INPUT', 'SECRET OUTPUT');
}
beforeEach(() => { db = new Database(':memory:'); initSchema(db); });
afterEach(() => db.close());
describe('task read projection', () => {
  it('keeps a native task identity stable when members join; resolves child and run links', () => {
    session('root', 'Fix a bug');
    expect(listTasks(db, {}).items.map(item => item.id)).toEqual(['collected:root']);
    session('child');
    db.prepare('INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES(?,?,?,?,?)').run('run1', 'codex', 'native-root', when, when);
    agent('a-root', 'root', true); agent('a-child', 'child', false);
    const list = listTasks(db, {}); expect(list.total).toBe(1); expect(list.items[0]?.memberCount).toBe(2);
    expect(getTask(db, 'collected:child').task.id).toBe('collected:root');
    expect(getTask(db, 'run:run1').task.id).toBe('collected:root');
    expect(getTask(db, 'collected:root').members).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain('SECRET');
  });
  it('does not group independent sessions with the same title; labels missing intake provenance', () => {
    session('one', 'Same title'); session('two', 'Same title');
    expect(listTasks(db, {}).total).toBe(2);
    expect(getTask(db, 'collected:one').warnings).toContain('origin_unconfirmed');
  });
  it('does not choose an arbitrary root from conflicting root evidence', () => {
    session('root'); session('other');
    db.prepare('INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES(?,?,?,?,?)').run('run1', 'codex', 'native-root', when, when);
    agent('a-root', 'root', true); agent('a-other', 'other', true);
    expect(listTasks(db, {}).total).toBe(2);
    expect(() => getTask(db, 'run:run1')).toThrow('unique main session');
  });
  it('filters after root grouping and paginates without body fields', () => {
    session('one', 'Fix 100%'); session('two', 'Other'); event('one', 1);
    expect(listTasks(db, { q: '100%' }).total).toBe(1);
    const first = listTasks(db, { limit: 1 }); expect(first.hasMore).toBe(true);
    expect(listTasks(db, { limit: 1, offset: 1 }).items[0]?.id).not.toBe(first.items[0]?.id);
    const page = taskRecords(db, getTask(db, 'collected:one'), {});
    const encoded = JSON.stringify(page); expect(encoded).not.toContain('SECRET'); expect(encoded).not.toContain('inputSummary'); expect(encoded).not.toContain('outputSummary');
  });
  it('serves a selected member directly even when another member fills the latest page', () => {
    session('root'); session('child');
    db.prepare('INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES(?,?,?,?,?)').run('run1', 'codex', 'native-root', when, when);
    agent('a-root', 'root', true); agent('a-child', 'child', false);
    for (let i = 1; i <= 210; i++) event('root', i);
    event('child', 1, 'error', 'Child failure');
    const context = getTask(db, 'collected:root');
    const all = taskRecords(db, context, { member: 'all' }); expect(all.total).toBe(211); expect(all.items.every(row => row.sessionKey === 'root')).toBe(true);
    const child = taskRecords(db, context, { member: 'a-child' }); expect(child.total).toBe(1); expect(child.items[0]?.event?.title).toBe('Child failure');
    expect(() => taskRecords(db, context, { member: 'foreign' })).toThrow('does not belong');
  });
  it('freezes paging at source sequence ceilings and refreshes explicitly', () => {
    session('one'); for (let i = 1; i <= 205; i++) event('one', i);
    const context = getTask(db, 'collected:one'), first = taskRecords(db, context, {});
    expect(first.offset).toBe(5); expect(first.items).toHaveLength(200);
    event('one', 206);
    const older = taskRecords(db, context, { offset: 0, window: first.window }); expect(older.total).toBe(205);
    expect(taskRecords(db, context, {}).total).toBe(206);
    expect(() => taskRecords(db, context, { q: 'different', window: first.window })).toThrow('scope mismatch');
  });
  it('loads only a bounded window around an exact event and reports unavailable anchors', () => {
    session('one'); for (let i = 1; i <= 250; i++) event('one', i);
    const context = getTask(db, 'collected:one');
    const page = taskRecords(db, context, { anchor: 'one:event:e42', limit: 100 });
    expect(page.items.some(row => row.event?.id === 'e42')).toBe(true); expect(page.items.length).toBeLessThanOrEqual(100);
    expect(() => taskRecords(db, context, { anchor: 'other:event:e42' })).toThrow('unavailable');
  });
  it('uses distinct content-based identities for imported history and keeps original occurrence time', () => {
    session('native');
    const id = 'a'.repeat(64), importedAt = '2026-10-25T12:00:00.000Z';
    const metadata = { id, fileName: 'historical.json', sourceMember: null, importedAt, source: { id: 'body', bytes: 10 }, nativeSessionId: 'native', ideType: 'Codex', model: null, title: 'Fix a bug', startedAt: when, endedAt: null, turnCount: 1 };
    db.prepare('INSERT INTO trace_log_imports(id,imported_at,metadata_json,session_offset,session_length,session_sha256) VALUES(?,?,?,0,10,?)').run(id, importedAt, JSON.stringify(metadata), id);
    const turn = { sequence: 0, turnId: 't', turnNumber: 1, model: null, requestTime: when, responseTime: null, isError: null, reported: {}, hasOutput: false };
    db.prepare('INSERT INTO trace_log_turns(import_id,sequence,metadata_json,byte_offset,byte_length,body_sha256) VALUES(?,0,?,0,10,?)').run(id, JSON.stringify(turn), id);
    expect(listTasks(db, { origin: 'collected' }).total).toBe(1);
    const imported = listTasks(db, { origin: 'imported' }); expect(imported.items[0]?.id).toBe('imported:' + id);
    expect(imported.items[0]?.startedAt).toBe(when); expect(imported.items[0]?.updatedAt).toBe(importedAt);
    const context = getTask(db, imported.items[0]!.id); expect(context.task.recordedStatus).toBe('historical');
    expect(taskRecords(db, context, {}).items[0]?.importedTurn?.isError).toBeNull();
  });
  it('pages imported records beyond 2000 without silently dropping history or filtered anchors', () => {
    const id = 'b'.repeat(64), metadata = { id, fileName: 'large.json', importedAt: when, startedAt: when, turnCount: 2105 };
    db.prepare('INSERT INTO trace_log_imports(id,imported_at,metadata_json,session_offset,session_length,session_sha256) VALUES(?,?,?,0,10,?)').run(id, when, JSON.stringify(metadata), id);
    const insert = db.prepare('INSERT INTO trace_log_turns(import_id,sequence,metadata_json,byte_offset,byte_length,body_sha256) VALUES(?,?,?,0,10,?)');
    db.transaction(() => { for (let sequence = 0; sequence < 2105; sequence++) insert.run(id, sequence, JSON.stringify({ sequence, turnId: 'turn-' + sequence, model: 'model', isError: sequence === 2104 }), id); })();
    const context = getTask(db, 'imported:' + id), latest = taskRecords(db, context, {});
    expect(latest.total).toBe(2105); expect(latest.offset).toBe(1905); expect(latest.items.at(-1)?.id).toBe('import:2104');
    expect(taskRecords(db, context, { anchor: 'import:2104', limit: 100 }).items.some(row => row.id === 'import:2104')).toBe(true);
    const errors = taskRecords(db, context, { status: 'error' }); expect(errors.total).toBe(1);
    expect(() => taskRecords(db, context, { q: 'changed', window: errors.window })).toThrow('scope mismatch');
    expect(taskRecords(db, context, { q: 'turn-2104' }).total).toBe(1);
    expect(() => taskRecords(db, context, { anchor: 'import:9999' })).toThrow('unavailable');
  });
  it('rejects oversized windows and invalid pagination', () => {
    session('one'); const context = getTask(db, 'collected:one');
    expect(() => taskRecords(db, context, { window: 'x'.repeat(32769) })).toThrow('too large');
    expect(() => listTasks(db, { limit: 101 })).toThrow('pagination');
    expect(() => taskRecords(db, context, { offset: -1 })).toThrow('pagination');
  });
});


describe('native parent evidence outside team projections', () => {
  function identities(key: string, native: string, parent?: string) {
    writeNativeIdentities(db, { source: 'scan', key }, { parserVersion: 3, items: [
      { namespace: 'agent:codex', kind: 'session', value: native, scope: null, eventId: null, sourcePath: 'session.id' },
      ...(parent ? [{ namespace: 'agent:codex', kind: 'parent_session' as const, value: parent, scope: native, eventId: null, sourcePath: 'session.parent' }] : []),
    ], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  }
  it('groups an explicit parent chain without requiring a team adapter', () => {
    session('root'); session('child'); session('grandchild');
    identities('root', 'n-root'); identities('child', 'n-child', 'n-root'); identities('grandchild', 'n-grandchild', 'n-child');
    expect(listTasks(db, {}).total).toBe(1);
    const context = getTask(db, 'collected:grandchild');
    expect(context.task.id).toBe('collected:root'); expect(context.members).toHaveLength(3);
    expect(context.members.find(member => member.sessionKey === 'grandchild')?.parentId).toBe('child');
  });
  it('retains unresolved, duplicate and cyclic parent claims as separate sessions', () => {
    session('a'); session('b'); session('c');
    identities('a', 'same'); identities('b', 'same'); identities('c', 'child', 'same');
    expect(listTasks(db, {}).total).toBe(3);
    db.prepare('DELETE FROM trace_identity_sources').run();
    identities('a', 'a', 'b'); identities('b', 'b', 'a'); identities('c', 'c', 'missing');
    expect(listTasks(db, {}).total).toBe(3);
  });
});
