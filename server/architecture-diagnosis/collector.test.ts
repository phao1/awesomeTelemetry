import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { analyzeProtocol } from '../proxy/protocol-analysis.js';
import { writeNativeIdentities } from '../storage/trace-links.js';
import { createArchitectureDiagnosisCollector } from './collector.js';
const when = '2026-10-29T00:00:00.000Z';
const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
function setup() {
  const db = new Database(':memory:'); initSchema(db); databases.push(db);
  db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('main','codex','Codex','Task',?,?, '/fixture/main',1)").run(when, when);
  return db;
}
function event(db: Database.Database, n: number, raw: unknown, kind = 'tool') {
  db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,started_at,actor) VALUES(?,?,?,?,?,?,?)').run('main', 'e' + n, n, kind, 'implement', when, 'assistant');
  db.prepare('INSERT INTO event_raw(session_id,event_id,raw) VALUES(?,?,?)').run('main', 'e' + n, JSON.stringify(raw));
}
function capture(db: Database.Database, id: number, state = 'confirmed') {
  db.prepare("INSERT INTO proxy_requests(id,request_id,method,url,hostname,started_at,request_format) VALUES(?,?,'POST','https://fixture.invalid/v1/responses','fixture.invalid',?,'openai_responses')").run(id, 'request' + id, when);
  db.prepare('INSERT INTO trace_associations(id,session_key,proxy_id,state,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('link' + id, 'main', id, state, 'explicit', when, when);
}
async function source(id: number) { const requestBody = JSON.stringify({ input: [{ role: 'user', content: 'test' }] }); return { requestBody,
  analysis: await analyzeProtocol({ format: 'openai_responses', requestBody, responseBody: JSON.stringify({ id: 'response' + id, status: 'completed', output: [] }), streaming: false }), fingerprint: String(id), requestComplete: true }; }
describe('bounded task architecture collector', () => {
  it('ignores candidate associations, isolates HTTP streams, and performs no native writes', async () => {
    const db = setup(); capture(db, 1); capture(db, 2); capture(db, 3, 'candidate');
    event(db, 1, { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 42 } } } }, 'llm');
    const reads: number[] = [], before = db.prepare('SELECT total_changes() AS n').get();
    const collector = createArchitectureDiagnosisCollector({ db, async loadCapture(id) { reads.push(id); return source(id); } });
    const input = await collector.collect('collected:main');
    expect(reads).toEqual([1, 2]); expect(input.contexts.map(value => value.streamId)).toEqual(['native:main', 'http:capture:1', 'http:capture:2']);
    expect(input.contexts.filter(value => value.id.startsWith('http')).every(value => value.agentId === null)).toBe(true);
    expect(input.coverage).toMatchObject({ captures: 2, logicalCalls: 2, nativeEvents: 1 });
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before); collector.close();
  });
  it('caps native metadata/bodies and original reads with visible omissions', async () => {
    const db = setup(); const insert = db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,started_at,actor) VALUES(?,?,?,?,?,?,?)');
    const raw = db.prepare('INSERT INTO event_raw(session_id,event_id,raw) VALUES(?,?,?)');
    db.transaction(() => { for (let i = 1; i <= 410; i++) { insert.run('main', 'e' + i, i, 'tool', 'implement', when, 'assistant'); raw.run('main', 'e' + i, JSON.stringify({ type: 'function_call', name: 'Read', call_id: 'call' + i, arguments: '{}' })); } })();
    for (let i = 1; i <= 10; i++) capture(db, i);
    const reads: number[] = [], collector = createArchitectureDiagnosisCollector({ db, async loadCapture(id) { reads.push(id); return source(id); } });
    const input = await collector.collect('collected:main');
    expect(input.coverage.nativeEvents).toBe(64); expect(input.coverage.nativeEventTotal).toBe(410); expect(input.coverage.omitted).toBeGreaterThanOrEqual(346);
    expect(reads).toHaveLength(8); expect(input.evidence.length).toBeLessThanOrEqual(512);
    expect(input.coverage.reasons).toEqual(expect.arrayContaining(['native_metadata_limit', 'native_body_limit', 'capture_limit'])); collector.close();
  });
  it('does not parse a huge retained native body and never falls back to preview as complete', async () => {
    const db = setup(); event(db, 1, { type: 'function_call', call_id: 'huge', name: 'spawn_agent', arguments: 'x'.repeat(200000) });
    const collector = createArchitectureDiagnosisCollector({ db, loadCapture: source }), input = await collector.collect('collected:main');
    expect(input.handoffs).toEqual([]); expect(input.coverage.reasons).toContain('native_body_limit'); collector.close();
  });
  it('extracts a real parent/spawn/result/child-first-input chain from SQLite without manual handoff labels', async () => {
    const db = setup(); db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('child','codex','Codex','Child',?,?,'/fixture/child',1)").run(when, when);
    const identity = (key: string, id: string, parent?: string) => writeNativeIdentities(db, { source: 'scan', key }, { parserVersion: 3, items: [
      { namespace: 'agent:codex', kind: 'session', value: id, scope: null, eventId: null, sourcePath: 'session_meta.id' },
      ...(parent ? [{ namespace: 'agent:codex', kind: 'parent_session' as const, value: parent, scope: id, eventId: null, sourcePath: 'session_meta.parent_thread_id' }] : []),
    ], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
    identity('main', 'native-main'); identity('child', 'native-child', 'native-main');
    event(db, 1, { type: 'response_item', payload: { type: 'function_call', call_id: 'spawn', name: 'spawn_agent', arguments: JSON.stringify({ message: 'Read /repo/config.ts and preserve CODE-123.' }) } });
    event(db, 2, { type: 'response_item', payload: { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'native-child' }) } });
    db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,started_at,actor) VALUES('child','input',1,'user_prompt','understand',?,'user')").run(when);
    db.prepare("INSERT INTO event_raw(session_id,event_id,raw) VALUES('child','input',?)").run(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect the repo.' }] } }));
    const collector = createArchitectureDiagnosisCollector({ db, loadCapture: source }), input = await collector.collect('collected:main');
    expect(input.handoffs).toMatchObject([{ senderAgentId: 'main', recipientAgentId: 'child', linkage: 'explicit', sentComplete: true, receivedComplete: true, receivedText: 'Inspect the repo.' }]);
    expect(input.evidence.some(value => value.sessionKey === 'child' && value.eventId === 'input' && value.path === 'payload.content')).toBe(true);
    collector.close();
  });
  it('rejects changed/deleted capture evidence and source writes during the async job', async () => {
    const db = setup(); capture(db, 1);
    const collector = createArchitectureDiagnosisCollector({ db, async loadCapture(id) { db.prepare("UPDATE sessions SET title='Changed' WHERE id='main'").run(); return source(id); } });
    await expect(collector.collect('collected:main')).rejects.toMatchObject({ reason: 'SOURCE_CHANGED' }); collector.close();
    for (const code of ['CAPTURE_ORIGINALS_DELETED', 'CAPTURE_ANALYSIS_CONFLICT']) {
      const another = createArchitectureDiagnosisCollector({ db, async loadCapture() { throw Object.assign(new Error('changed'), { code }); } });
      await expect(another.collect('collected:main')).rejects.toMatchObject({ reason: 'SOURCE_CHANGED' }); another.close();
    }
  });
  it('owns one job and cancels pending source analysis on shutdown', async () => {
    const db = setup(); capture(db, 1); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    const collector = createArchitectureDiagnosisCollector({ db, async loadCapture(_id, signal) { entered(); await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); return source(1); } });
    const running = collector.collect('collected:main'); await ready;
    await expect(collector.collect('collected:main')).rejects.toMatchObject({ reason: 'BUSY' });
    collector.close(); await expect(running).rejects.toBeTruthy();
  });
});
