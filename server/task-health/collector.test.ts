import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import { initSchema } from '../storage/schema.js';
import { writeNativeIdentities } from '../storage/trace-links.js';
import { analyzeTaskHealth } from '../../src/core/task-health/report.js';
import type { HealthInput } from '../../src/core/task-health/types.js';
import { collectTaskHealth, healthRevision, boundHealthReport } from './collector.js';
const when = '2026-10-30T00:00:00.000Z';
let db: Database.Database, dir: string;
beforeEach(async () => { db = new Database(':memory:'); initSchema(db); dir = await mkdtemp(join(tmpdir(), 'health-')); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External request forbidden'); })); });
afterEach(async () => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); db.close(); await rm(dir, { recursive: true, force: true }); });
function session(id = 'main', loaded = true, path = '/fixture/missing') { db.prepare('INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded,status,data_source) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, 'codex', 'Codex', 'Task', when, when, path, loaded ? 1 : 0, 'success', 'scan'); }
function events(id: string, n: number, lastError = false) {
  const stmt = db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,status,actor,input_len,output_len,input_summary,output_summary) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  db.transaction(() => { for (let i = 0; i < n; i++) stmt.run(id, 'e' + i, i, i === 0 ? 'user_prompt' : i === n - 1 && lastError ? 'tool' : 'system', 'implement', i === n - 1 ? 'failure' : 'context', new Date(Date.parse(when) + i * 1000).toISOString(), i === n - 1 && lastError ? 'error' : 'success', 'assistant', 12, 34, 'SECRET INPUT', 'SECRET OUTPUT'); })();
}
function linkMembers() {
  db.prepare("INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES('run','codex','root',?,?)").run(when, when);
  const stmt = db.prepare('INSERT INTO team_agents(id,run_id,native_id,display_name,role_class,session_keys_json) VALUES(?,?,?,?,?,?)');
  stmt.run('a-main', 'run', 'root', 'Main', 'leader', '["main"]'); stmt.run('a-child', 'run', 'child', 'Child', 'subagent', '["child"]');
}
it('collects all members and crosses 200-row boundaries without body SQL or writes', async () => {
  session(); session('child'); linkMembers(); events('main', 205); events('child', 202);
  const sql: string[] = []; const original = db.prepare.bind(db); vi.spyOn(db, 'prepare').mockImplementation((query: string) => { sql.push(query); return original(query); });
  const before = db.prepare('SELECT total_changes() AS n').get(), input = await collectTaskHealth(db, 'collected:main');
  expect(input.records).toHaveLength(407); expect(input.members.map(m => m.id)).toEqual(['a-child', 'a-main']);
  expect(input.records.find(r => r.recordId === 'main:event:e204')).toMatchObject({ inputLen: 12, outputLen: 34 });
  expect(JSON.stringify(input)).not.toContain('SECRET'); expect(sql.join('\n')).not.toMatch(/input_summary|output_summary|event_raw|SELECT \*/i);
  expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before); expect(input.revision).toBe(await healthRevision(db, 'collected:main'));
  expect(JSON.parse(Buffer.from(input.window, 'base64url').toString()).ceilings).toHaveLength(2);
});
it('retains and locates the anomaly at record 2000', async () => {
  session(); events('main', 2000, true);
  const input = await collectTaskHealth(db, 'collected:main'); expect(input.records).toHaveLength(2000);
  const report = analyzeTaskHealth(input, { toolErrorMinCalls: 1, toolErrorPct: 0 }, { id: 'report', generatedAt: when });
  const finding = report.findings.find(f => f.rule === 'act.tool_errors')!; expect(finding).toBeDefined();
  expect(report.evidence.find(e => finding.evidenceIds.includes(e.id))?.recordIds).toContain('main:event:e1999');
});
it('detects source changes between yielded pages', async () => {
  session(); events('main', 401);
  const collecting = collectTaskHealth(db, 'collected:main');
  setImmediate(() => db.prepare("UPDATE events SET title='changed' WHERE session_id='main' AND id='e200'").run());
  await expect(collecting).rejects.toMatchObject({ code: 'SOURCE_CHANGED', status: 409 });
});
it('preserves unloaded members and provider without triggering source hydration', async () => {
  session(); session('child', false); linkMembers(); events('main', 2); events('child', 2);
  const input = await collectTaskHealth(db, 'collected:main'); expect(input.records).toHaveLength(2);
  expect(input.members.find(m => m.id === 'a-child')).toMatchObject({ provider: 'codex', detailLoaded: false }); expect(input.reasons).toContain('native_detail_not_loaded');
  expect(analyzeTaskHealth(input, undefined, { id: 'r', generatedAt: when }).coverage.members).toEqual({ loaded: 1, total: 2 });
});
it('marks a deterministic 20000-event prefix partial', async () => {
  session(); events('main', 20001);
  const input = await collectTaskHealth(db, 'collected:main'); expect(input.records).toHaveLength(20000); expect(input.limits).toContain('events'); expect(input.records.at(-1)?.recordId).toBe('main:event:e19999');
});
it('reads imported metadata_json with null length and no provider invention', async () => {
  const id = 'a'.repeat(64), turn = { sequence: 0, turnId: 't', turnNumber: 1, model: 'm', requestTime: when, responseTime: '2026-10-30T00:00:01.000Z', isError: false, reported: { ttft_ms: 800, thoughts_token_count: 0 }, hasOutput: true };
  db.prepare('INSERT INTO trace_log_imports(id,imported_at,metadata_json,session_offset,session_length,session_sha256) VALUES(?,?,?,0,10,?)').run(id, when, JSON.stringify({ id, importedAt: when, startedAt: when, turnCount: 1 }), id);
  db.prepare('INSERT INTO trace_log_turns(import_id,sequence,metadata_json,byte_offset,byte_length,body_sha256) VALUES(?,0,?,0,10,?)').run(id, JSON.stringify(turn), id);
  const input = await collectTaskHealth(db, 'imported:' + id); expect(input.records[0]).toMatchObject({ importedTurn: turn, event: null, inputLen: null, outputLen: null }); expect(input.members[0]).toMatchObject({ provider: null, timestampSemantics: 'interval' });
  const report = analyzeTaskHealth(input, undefined, { id: 'r', generatedAt: when }); expect(report.metrics.find(m => m.key === 'model.ttft' && m.layer === 'exporter' && m.stat === 'p50')?.value).toBe(800);
});
it('honors abort and rejects invalid scope/range', async () => {
  session(); events('main', 2); const controller = new AbortController(); controller.abort();
  await expect(collectTaskHealth(db, 'collected:main', undefined, controller.signal)).rejects.toThrow();
  await expect(collectTaskHealth(db, 'collected:main', { member: 'foreign', from: null, to: null })).rejects.toThrow('does not belong');
  await expect(collectTaskHealth(db, 'collected:main', { member: 'all', from: when, to: null })).rejects.toThrow('range');
});
it('enriches verified Claude collapsed tool-result endpoints and raw usage flags', async () => {
  const path = join(dir, 'source.jsonl'); session('main', true, path); db.prepare("UPDATE sessions SET provider='claude' WHERE id='main'").run(); events('main', 2);
  db.prepare("UPDATE events SET id='call',kind='tool' WHERE sequence=1").run();
  writeNativeIdentities(db, { source: 'scan', key: 'main' }, { parserVersion: 3, items: [{ namespace: 'agent:claude', kind: 'tool_call', value: 'call', scope: 'scope', eventId: 'call', sourcePath: 'message.content' }], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  await writeFile(path, [ { type: 'assistant', timestamp: when, message: { id: 'm', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3, output_tokens_details: { thinking_tokens: 0 } }, content: [{ type: 'tool_use', id: 'call', input: { command: 'npm test', cwd: '/project' } }] } }, { type: 'user', timestamp: '2026-10-30T00:00:10.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'call' }] } } ].map(v => JSON.stringify(v)).join('\n'));
  const input = await collectTaskHealth(db, 'collected:main'); expect(input.records[1]?.native).toMatchObject({ toolStartedAt: when, toolCompletedAt: '2026-10-30T00:00:10.000Z', command: 'npm test', reasoning: 'zero', usage: { inputIncludesCache: false, cacheWriteReported: null } });
});
it('worker runs the actual engine, supports cancellation and produces bounded public JSON', async () => {
  const output = join(dir, 'build'); await build({ configFile: false, logLevel: 'silent', build: { ssr: resolve('server/task-health/collector.ts'), outDir: output, target: 'node20', rollupOptions: { external: ['better-sqlite3'], output: { entryFileNames: 'collector.mjs' } } } });
  await symlink(resolve('node_modules'), join(output, 'node_modules'), 'dir');
  const { generateHealthReport } = await import(pathToFileURL(join(output, 'collector.mjs')).href);
  const input = JSON.parse(await readFile('src/core/__fixtures__/task-health/g1-serial.input.json', 'utf8')) as HealthInput;
  const report = await generateHealthReport(input); expect(report.metrics.find((m: { key: string }) => m.key === 'overview.e2e_ms').value).toBe(170000);
  const controller = new AbortController(), running = generateHealthReport(input, undefined, controller.signal); controller.abort(); await expect(running).rejects.toThrow();
});
it('fails visibly when the report cannot fit 1MiB after unreferenced evidence omission', async () => {
  const input = JSON.parse(await readFile('src/core/__fixtures__/task-health/g1-serial.input.json', 'utf8')) as HealthInput;
  const report = analyzeTaskHealth(input, undefined, { id: 'r', generatedAt: when }); report.limitations.push('x'.repeat(1024 * 1024));
  expect(() => boundHealthReport(report)).toThrow('HEALTH_SIZE_LIMIT'); expect(report.coverage.limits).toContain('report_bytes');
});

it('matches taskStructure across page boundaries and keeps off-page collisions ambiguous', async () => {
  session(); events('main', 202);
  db.prepare("UPDATE events SET kind='tool',input_len=CASE WHEN sequence=199 THEN 10 ELSE 0 END,output_len=CASE WHEN sequence=200 THEN 10 ELSE 0 END,turn_key='round' WHERE sequence IN (199,200)").run();
  const identities = [199,200].map(i => ({ namespace: 'protocol:openai', kind: 'tool_call' as const, value: 'call', scope: 'scope', eventId: 'e' + i, sourcePath: 'payload.call_id' }));
  writeNativeIdentities(db, { source: 'scan', key: 'main' }, { parserVersion: 3, items: identities, completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  const input = await collectTaskHealth(db, 'collected:main');
  expect(input.records[199]).toMatchObject({ pairing: 'exact', relatedRecordIds: expect.arrayContaining(['main:event:e199','main:event:e200']) }); expect(input.records[200]?.pairing).toBe('exact');
  db.prepare("UPDATE events SET input_len=10 WHERE sequence=201").run();
  writeNativeIdentities(db, { source: 'scan', key: 'main' }, { parserVersion: 3, items: [...identities, { ...identities[0]!, eventId: 'e201' }], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  const ambiguous = await collectTaskHealth(db, 'collected:main'); expect(ambiguous.records[199]).toMatchObject({ pairing: 'ambiguous', tool: null });
});
it('accepts only observed transport with unique scoped matches and accepted associations', async () => {
  session(); events('main', 2); db.prepare("UPDATE events SET kind='llm' WHERE sequence=1").run();
  const bundle = (eventId: string | null) => ({ parserVersion: 3, items: [{ namespace: 'protocol:openai', kind: 'response' as const, value: 'response', scope: 'native', eventId, sourcePath: 'payload.response_id' }], completeness: { complete: true, omittedCount: 0, reasons: [] } });
  writeNativeIdentities(db, { source: 'scan', key: 'main' }, bundle('e1'), when);
  db.prepare("INSERT INTO proxy_requests(id,request_id,method,url,hostname,started_at,request_format,output_tokens) VALUES(1,'req','POST','https://fixture.invalid','fixture.invalid',?,'openai_responses',8)").run(when);
  writeNativeIdentities(db, { source: 'proxy', key: '1' }, bundle(null), when);
  db.prepare("INSERT INTO trace_associations(id,session_key,proxy_id,state,reason,created_at,updated_at) VALUES('explicit','main',1,'confirmed','explicit',?,?) ON CONFLICT(session_key,proxy_id) DO UPDATE SET state='confirmed'").run(when, when);
  const timing = { contentTimingStatus: 'observed', firstContentBasis: 'sse_event_dispatch', firstContentMs: 20, completedMs: 100 };
  db.prepare('INSERT INTO proxy_capture_transport(proxy_id,result_json) VALUES(1,?)').run(JSON.stringify({ timing }));
  expect((await collectTaskHealth(db, 'collected:main')).captures).toEqual([{ id: '1', recordIds: ['main:event:e1'], startedMs: 0, firstContentMs: 20, completedMs: 100, outputTokens: 8, layer: 'proxy' }]);
  db.prepare('UPDATE proxy_capture_transport SET result_json=? WHERE proxy_id=1').run(JSON.stringify({ timing: { ...timing, contentTimingStatus: 'not_collected' } })); expect((await collectTaskHealth(db, 'collected:main')).captures).toEqual([]);
  db.prepare('UPDATE proxy_capture_transport SET result_json=? WHERE proxy_id=1').run(JSON.stringify({ timing })); db.prepare("UPDATE trace_associations SET state='candidate' WHERE proxy_id=1").run(); expect((await collectTaskHealth(db, 'collected:main')).captures).toEqual([]);
  db.prepare("UPDATE trace_associations SET state='confirmed' WHERE proxy_id=1").run(); writeNativeIdentities(db, { source: 'scan', key: 'main' }, { ...bundle('e1'), items: [...bundle('e1').items, ...bundle('e0').items] }, when); expect((await collectTaskHealth(db, 'collected:main')).captures).toEqual([]);
});
it('projects Codex round increments without converting absent counters to zero or inventing calls', async () => {
  const path = join(dir, 'codex.jsonl'); session('main', true, path); events('main', 2);
  db.prepare("UPDATE events SET kind='llm',turn_key='main:native-message',tokens_json=? WHERE sequence=1").run(JSON.stringify({ input: 10, output: 2, reasoning: 0 }));
  await writeFile(path, [{ type: 'response_item', timestamp: when, payload: { type: 'message', id: 'native-message', role: 'assistant' } }, { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2, reasoning_output_tokens: 0, cached_input_tokens: 3 } } } }].map(value => JSON.stringify(value)).join('\n'));
  const input = await collectTaskHealth(db, 'collected:main'); expect(input.records[1]?.native).toMatchObject({ modelCall: null, reasoning: 'zero', usage: { input: 10, output: 2, reasoning: 0, cacheRead: 3, cacheWrite: null, inputIncludesCache: true, outputIncludesReasoning: true, cacheWriteReported: null } });
});
it('uses full-input statistics in bounded reports and never exposes authentication in public source strings', async () => {
  const { calculateHealthReport } = await import('./collector.js');
  const input = JSON.parse(await readFile('src/core/__fixtures__/task-health/g1-serial.input.json', 'utf8')) as HealthInput;
  input.records[0]!.event!.title = 'Authorization: Bearer SUPER_SECRET';
  const report = calculateHealthReport(input); expect(JSON.stringify(report)).not.toContain('SUPER_SECRET');
  const sample = structuredClone(input.records[0]!); sample.event!.kind = 'system';
  for (let i = 0; i < 4001; i++) input.records.push({ ...sample, recordId: 'context' + i, event: { ...sample.event!, id: 'context' + i, sequence: 100 + i } });
  const bounded = calculateHealthReport(input); expect(bounded.metrics.find(m => m.key === 'plan.rounds')?.value).toBe(5); expect(bounded.coverage.limits).toContain('report_bytes');
  expect(bounded.t0).toBe(input.t0);
  expect(bounded.findings.some(f => f.rule === 'cov.incomplete')).toBe(true); const ids = new Set(bounded.evidence.map(e => e.id)); for (const item of [...bounded.findings, ...bounded.metrics]) for (const id of item.evidenceIds) expect(ids.has(id)).toBe(true);
});
it('links a real spawn result to a unique confirmed member, without inferring from parent roles', async () => {
  const path = join(dir, 'spawn.jsonl'); session('main', true, path); session('child'); linkMembers(); events('main', 3); events('child', 2);
  db.prepare("UPDATE events SET kind='tool',input_len=CASE WHEN sequence=1 THEN 10 ELSE 0 END,output_len=CASE WHEN sequence=2 THEN 10 ELSE 0 END,tool='spawn_agent',turn_key='round' WHERE session_id='main' AND sequence IN (1,2)").run();
  const tool = [1,2].map(i => ({ namespace: 'protocol:openai', kind: 'tool_call' as const, value: 'spawn', scope: 'root-native', eventId: 'e' + i, sourcePath: 'payload.call_id' }));
  writeNativeIdentities(db, { source: 'scan', key: 'main' }, { parserVersion: 3, items: tool, completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  writeNativeIdentities(db, { source: 'scan', key: 'child' }, { parserVersion: 3, items: [{ namespace: 'agent:codex', kind: 'session', value: 'child-native', scope: null, eventId: null, sourcePath: 'payload.id' }], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  await writeFile(path, [{ type: 'response_item', timestamp: when, payload: { type: 'function_call', call_id: 'spawn', name: 'spawn_agent', arguments: '{}' } }, { type: 'response_item', timestamp: when, payload: { type: 'function_call_output', call_id: 'spawn', output: '{"agent_id":"child-native"}' } }].map(v => JSON.stringify(v)).join('\n'));
  const input = await collectTaskHealth(db, 'collected:main'); expect(input.records.find(r => r.recordId === 'main:event:e1')?.native.delegateMemberId).toBe('a-child');
});
