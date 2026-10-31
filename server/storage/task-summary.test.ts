import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { initSchema } from './schema.js';
import { getTask } from './task-workbench.js';
import { sessionUsage, taskMetrics } from './task-summary.js';
let db: Database.Database;
let queries: string[];
beforeEach(() => { queries = []; db = new Database(':memory:', { verbose: sql => queries.push(String(sql)) }); initSchema(db); });
afterEach(() => db.close());
function seed() {
  db.prepare(`INSERT INTO sessions(id,provider,source_agent,started_at,updated_at,source_path,detail_loaded,token_input,token_output,token_cache_read,token_cache_write,cost_usd,cost_source,primary_model,total_duration_ms,duration_source) VALUES('s','codex','Codex','2026-10-31T00:00:00Z','2026-10-31T00:00:05Z','/not-read',1,60,20,30,10,1.25,'reported','test-model',5000,'derived')`).run();
}
it('corrects normalized inclusive-cache Codex and exclusive-cache Claude without adding reasoning twice', () => {
  // Codex adapter stores 100 raw inclusive input as60 uncached +30 read +10 write;
  // Claude reports60 uncached directly, with the same separate cache counters.
  for (const provider of ['codex', 'claude']) expect(sessionUsage({ provider, token_input: 60, token_output: 20, token_cache_read: 30, token_cache_write: 10 })).toEqual({ input: 60, output: 20, cacheRead: 30, total: 120 });
  expect(sessionUsage({ provider: 'codearts', token_input: 60, token_output: 20, token_cache_read: 30, token_cache_write: 10 }).total).toBeNull();
});
it('keeps absent/default zero and unsupported conventions unknown', () => {
  seed(); db.prepare('UPDATE sessions SET token_input=0,token_cache_write=0,cost_source=?').run('estimated');
  const m = getTask(db, 'collected:s').metrics!;
  expect(m.input).toBeNull(); expect(m.correctedTotal).toBeNull(); expect(m.costUsd).toBeNull(); expect(m.output).toBe(20);
  db.prepare('UPDATE sessions SET detail_loaded=0').run();
  expect(getTask(db, 'collected:s').metrics).toMatchObject({ input: null, toolCalls: null, errors: null, durationMs: null });
});
it('counts indexed tool inputs/errors and reuses a revision without aggregation; changes invalidate it', () => {
  seed();
  db.prepare(`INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status,input_len) VALUES('s','call',1,'tool','implement','2026-10-31T00:00:01Z','success',10),('s','result',2,'tool','implement','2026-10-31T00:00:02Z','error',0)`).run();
  const context = getTask(db, 'collected:s');
  expect(context.metrics).toMatchObject({ durationMs: 5000, input: 60, output: 20, cacheRead: 30, correctedTotal: 120, toolCalls: 1, errors: 1, costUsd: 1.25, models: ['test-model'] });
  queries.length = 0; const cached = taskMetrics(db, context); cached.models.push('mutated');
  expect(queries.every(q => q.includes('data_version') || q.includes('total_changes'))).toBe(true);
  expect(taskMetrics(db, context).models).toEqual(['test-model']);
  db.prepare('UPDATE sessions SET token_input=70').run();
  expect(taskMetrics(db, context).correctedTotal).toBe(130);
  for (const sql of ["SELECT COUNT(1) FROM events WHERE session_id='s' AND kind='tool' AND input_len>0", "SELECT COUNT(1) FROM events WHERE session_id='s' AND status='error'"]) {
    const plan = JSON.stringify(db.prepare('EXPLAIN QUERY PLAN ' + sql).all());
    expect(plan).toContain('COVERING INDEX'); expect(plan).not.toContain('SCAN events');
  }
});
it('uses only TraceLog session endpoints/model for imports, leaving absent session counters unknown', () => {
  const context = { task: { id: 'imported:i' }, members: [], warnings: [], importSession: { startedAt: '2026-10-31T00:00:00Z', endedAt: '2026-10-31T00:00:02Z', model: 'imported-model' } } as unknown as Parameters<typeof taskMetrics>[1];
  expect(taskMetrics(db, context)).toEqual({ durationMs: 2000, toolCalls: null, errors: null, input: null, output: null, cacheRead: null, correctedTotal: null, costUsd: null, models: ['imported-model'] });
});
it('treats only confirmed unreported Codex cache writes as zero', () => {
  const counters = { token_input: 60, token_output: 20, token_cache_read: 30, token_cache_write: 0 };
  expect(sessionUsage({ ...counters, provider: 'codex' }).total).toBe(110);
  expect(sessionUsage({ ...counters, provider: 'claude' }).total).toBeNull();
  expect(sessionUsage({ ...counters, provider: 'workbuddy' }).total).toBeNull();
  seed(); db.prepare('UPDATE sessions SET token_cache_write=0').run();
  expect(getTask(db, 'collected:s').metrics!.correctedTotal).toBe(110);
});
it('sums trusted members independently per metric and discloses missing members without mixing unverified totals', () => {
  seed(); db.prepare('UPDATE sessions SET token_cache_write=0').run();
  const insert = db.prepare(`INSERT INTO sessions(id,provider,source_agent,started_at,updated_at,source_path,detail_loaded,token_input,token_output,token_cache_read,primary_model) VALUES(?,?,?,'2026-10-31T00:00:00Z','2026-10-31T00:00:05Z','/not-read',?,?,?,?,?)`);
  insert.run('claude', 'claude', 'Claude', 1, 40, 10, 20, 'test-model');
  insert.run('codearts', 'codearts', 'CodeArts', 1, 30, 0, 0, 'another-model');
  insert.run('empty', 'codex', 'Empty', 1, 0, 0, 0, null);
  insert.run('unloaded', 'codex', 'Unloaded', 0, 999, 999, 999, 'indexed-model');
  const context = getTask(db, 'collected:s');
  context.task.memberCount = 6;
  context.members.push(...['claude', 'codearts', 'empty', 'unloaded', 'missing'].map(id => ({ id, name: id, role: 'subagent', sessionKey: id === 'missing' ? null : id, parentId: null, detailLoaded: id !== 'unloaded', eventCount: 0 })));
  // Changing the database revision above invalidates the earlier single-member cache.
  db.prepare('UPDATE sessions SET title=? WHERE id=?').run('Partial task', 's');
  const m = taskMetrics(db, context);
  expect(m).toMatchObject({ input: 130, output: 30, cacheRead: 50, correctedTotal: 110, models: ['test-model', 'another-model', 'indexed-model'] });
  expect(m.coverage!.input).toEqual({ known: 3, total: 6, missing: [
    { memberId: 'empty', name: 'empty', reason: 'not_reported' },
    { memberId: 'unloaded', name: 'unloaded', reason: 'detail_not_loaded' },
    { memberId: 'missing', name: 'missing', reason: 'session_unavailable' },
  ] });
  expect(m.coverage!.output.known).toBe(2); expect(m.coverage!.cacheRead.known).toBe(2);
  expect(m.coverage!.correctedTotal).toMatchObject({ known: 1, total: 6 });
  expect(m.coverage!.correctedTotal.missing).toContainEqual({ memberId: 'codearts', name: 'codearts', reason: 'accounting_unknown' });
  expect(m.coverage!.models).toMatchObject({ known: 4, total: 6 });
  const cached = taskMetrics(db, context); cached.coverage!.input.missing[0]!.name = 'mutated';
  expect(taskMetrics(db, context).coverage!.input.missing[0]!.name).toBe('empty');
});
it('does not turn an entirely unavailable metric into a zero-valued partial sum', () => {
  seed(); db.prepare('UPDATE sessions SET token_input=0,token_output=0,token_cache_read=0,primary_model=NULL').run();
  const m = getTask(db, 'collected:s').metrics!;
  expect(m).toMatchObject({ input: null, output: null, cacheRead: null, correctedTotal: null, models: [] });
  expect(m.coverage!.input).toMatchObject({ known: 0, total: 1 });
});
