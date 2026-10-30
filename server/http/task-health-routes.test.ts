import Database from 'better-sqlite3';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { analyzeTaskHealth } from '../../src/core/task-health/report.js';
import type { HealthInput, HealthReport, HealthThresholds } from '../../src/core/task-health/types.js';
import { createHealthReportStore } from '../task-health/store.js';
import { Router } from './router.js';
import { registerTaskHealthRoutes, parseHealthJson } from './task-health-routes.js';
const when = '2026-10-30T00:00:00.000Z';
class Response extends EventEmitter {
  statusCode = 200; destroyed = false; text = ''; headers: Record<string, unknown> = {};
  setHeader(key: string, value: unknown) { this.headers[key] = value; }
  writeHead(status: number, headers: Record<string, unknown>) { this.statusCode = status; Object.assign(this.headers, headers); }
  end(text: Buffer | string) { this.text = String(text); }
}
let db: Database.Database, dir: string, router: Router, stop: () => void;
let generate: (input: HealthInput, thresholds: HealthThresholds, signal: AbortSignal) => Promise<HealthReport>;
beforeEach(async () => {
  db = new Database(':memory:'); initSchema(db); dir = await mkdtemp(join(tmpdir(), 'health-route-')); router = new Router();
  db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded,status) VALUES('main','codex','Codex','Task',?,?, '/fixture/missing',1,'success')").run(when, when);
  db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,actor) VALUES('main','e',0,'user_prompt','understand','Task',?,'user')").run(when);
  generate = async (i, thresholds) => analyzeTaskHealth(i, thresholds, { id: randomUUID(), generatedAt: when });
  stop = registerTaskHealthRoutes(router, { db, store: createHealthReportStore(dir), generate: (i, t, s) => generate(i, t, s) });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden'); }));
});
afterEach(async () => { stop(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers(); db.close(); await rm(dir, { recursive: true, force: true }); });
function request(method = 'POST', url = '/api/tasks/collected:main/health-reports', data: unknown = { mode: 'standard', member: 'all' }) {
  const text = typeof data === 'string' ? data : JSON.stringify(data), req = Readable.from(method === 'POST' ? [Buffer.from(text)] : []) as IncomingMessage;
  req.url = url; req.method = method; req.headers = { 'content-type': 'application/json', host: 'localhost' }; req.socket = { remoteAddress: '127.0.0.1' } as Socket;
  const res = new Response(), match = router.match(method, new URL(url, 'http://localhost').pathname)!;
  return { req, res, run: async () => { await match.handler(req, res as unknown as ServerResponse, match.params); return res; } };
}
it('generates200, lists metadata, reads/exports immutable bytes and reuses an existing report', async () => {
  let calls = 0; const original = generate; generate = async (...args) => { calls++; return original(...args); };
  const first = await request().run(), r = JSON.parse(first.text) as HealthReport; expect(first.statusCode).toBe(200); expect(first.headers['cache-control']).toBe('no-store');
  const again = await request().run(); expect(again.text).toBe(first.text); expect(calls).toBe(1);
  const history = await request('GET', '/api/tasks/collected:main/health-reports').run(); expect(JSON.parse(history.text).items[0]).toMatchObject({ id: r.id, expired: false }); expect(history.text).not.toContain('metrics');
  expect((await request('GET', `/api/health-reports/${r.id}`).run()).text).toBe(first.text);
  for (const format of ['json', 'md', 'html']) { const exported = await request('GET', `/api/health-reports/${r.id}/export?format=${format}`).run(); expect(exported.statusCode).toBe(200); expect(exported.headers['content-disposition']).toContain('attachment'); if (format === 'json') expect(exported.text).toBe(first.text); }
});
it.each([
  '{}', '{"mode":"standard","mode":"standard","member":"all"}',
  { mode: 'standard', member: 'all', bogus: true }, { mode: 'deep', member: 'all' },
  { mode: 'standard', member: 'all', from: when }, { mode: 'standard', member: 'foreign' },
  { mode: 'standard', member: 'all', thresholds: { gapMs: -1 } }, { mode: 'standard', member: 'all', thresholds: { profile: 'codearts-perf-v1' } },
])('rejects invalid/duplicate request with400 and ApiError: %j', async value => { const res = await request('POST', undefined, value).run(); expect(res.statusCode).toBe(400); expect(JSON.parse(res.text).error.code).toBe('BAD_REQUEST'); });
it('rejects oversized/chunked bodies413, unsupported export/query400 and missing report/task404', async () => {
  expect((await request('POST', undefined, ' '.repeat(16385)).run()).statusCode).toBe(413);
  expect((await request('GET', '/api/health-reports/nope').run()).statusCode).toBe(404);
  expect((await request('POST', '/api/tasks/collected:missing/health-reports').run()).statusCode).toBe(404);
  expect((await request('GET', '/api/health-reports/nope/export?format=html&format=md').run()).statusCode).toBe(400);
  expect((await request('GET', '/api/tasks/collected:main/health-reports?q=x').run()).statusCode).toBe(400);
});
it('validates duplicate nested/escaped JSON keys and conflicting numeric query thresholds', async () => {
  expect(() => parseHealthJson('{"x":1,"\\u0078":2}')).toThrow();
  expect(() => parseHealthJson('{"thresholds":{"gapMs":1,"gapMs":2}}')).toThrow();
  const value = { mode: 'standard', member: 'all', thresholds: { gapMs: 1 } };
  expect((await request('POST', '/api/tasks/collected:main/health-reports?gapMs=2', value).run()).statusCode).toBe(400);
  const res = await request('POST', '/api/tasks/collected:main/health-reports?gapMs=2').run(); expect(res.statusCode).toBe(200); expect(JSON.parse(res.text).thresholds.gapMs).toBe(2);
});
it('rejects a concurrent generation409 BUSY without queueing', async () => {
  let started!: () => void, release!: () => void; const ready = new Promise<void>(r => { started = r; }), wait = new Promise<void>(r => { release = r; }), original = generate;
  generate = async (...args) => { started(); await wait; return original(...args); };
  const first = request().run(); await ready;
  const busy = await request().run(); expect(busy.statusCode).toBe(409); expect(JSON.parse(busy.text).error.code).toBe('BUSY'); release(); expect((await first).statusCode).toBe(200);
});
it('cancels owned work on disconnect, does not write an error to a destroyed response and releases ownership', async () => {
  let started!: () => void; const ready = new Promise<void>(r => { started = r; });
  generate = async (_i, _t, signal) => { started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true })); };
  const call = request(), running = call.run(); await ready; call.res.destroyed = true; call.res.emit('close'); await running;
  expect(call.res.text).toBe(''); generate = async (i, t) => analyzeTaskHealth(i, t, { id: randomUUID(), generatedAt: when }); expect((await request().run()).statusCode).toBe(200);
});
it('returns503 HEALTH_TIMEOUT after45s and releases the cancelled worker', async () => {
  let started!: () => void; const ready = new Promise<void>(r => { started = r; });
  generate = async (_i, _t, signal) => { started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true })); };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const pending = request().run(); await ready; await vi.advanceTimersByTimeAsync(45000); const res = await pending;
  expect(res.statusCode).toBe(503); expect(JSON.parse(res.text).error.code).toBe('HEALTH_TIMEOUT');
});
it('rejects oversized reports503 and detects source changes after compute409', async () => {
  const original = generate; generate = async (...args) => ({ ...await original(...args), limitations: ['x'.repeat(1024 * 1024)] });
  const big = await request().run(); expect(big.statusCode).toBe(503); expect(JSON.parse(big.text).error.code).toBe('HEALTH_SIZE_LIMIT');
  generate = async (...args) => { const r = await original(...args); db.prepare("UPDATE sessions SET title='changed' WHERE id='main'").run(); return r; };
  const changed = await request().run(); expect(changed.statusCode).toBe(409); expect(JSON.parse(changed.text).error.code).toBe('SOURCE_CHANGED');
});
it('shutdown cancels owned generation and rejects further work409', async () => {
  stop(); const res = await request().run(); expect(res.statusCode).toBe(409); expect(JSON.parse(res.text).error.code).toBe('BUSY');
});
it('applies loopback Host/Origin/connection protection to report reads and exports', async () => {
  const hostile = request('GET', '/api/health-reports/nope/export?format=json'); hostile.req.headers.host = 'attacker.invalid'; expect((await hostile.run()).statusCode).toBe(400);
  const remote = request('GET', '/api/health-reports/nope'); remote.req.socket = { remoteAddress: '10.0.0.2' } as Socket; expect((await remote.run()).statusCode).toBe(400);
  const origin = request(); origin.req.headers.origin = 'https://attacker.invalid'; const res = await origin.run(); expect(res.statusCode).toBe(400); expect(res.headers['cache-control']).toBe('no-store');
});
it('rejects escaped exports over4MiB rather than truncating markup', async () => {
  const original = generate;
  generate = async (...args) => { const r = await original(...args); r.evidence.push(...Array.from({ length: 560 }, (_, i) => ({ id: 'e' + i, memberId: r.evidence[0]!.memberId, recordIds: ['r' + i], captureIds: [], title: 'evidence', summary: '&'.repeat(1500), truncated: true, intervalMs: null, timing: 'observed' as const }))); return r; };
  const generated = await request().run(); expect(generated.statusCode).toBe(200);
  const res = await request('GET', `/api/health-reports/${JSON.parse(generated.text).id}/export?format=html`).run(); expect(res.statusCode).toBe(503); expect(JSON.parse(res.text).error.code).toBe('HEALTH_SIZE_LIMIT');
});
it('rejects GET bodies, non-JSON generation and unsafe numeric overrides', async () => {
  const get = request('GET', '/api/health-reports/nope'); get.req.headers['content-length'] = '1'; expect((await get.run()).statusCode).toBe(400);
  const contentType = request(); contentType.req.headers['content-type'] = 'text/plain'; expect((await contentType.run()).statusCode).toBe(400);
  const unsafe = await request('POST', undefined, { mode: 'standard', member: 'all', thresholds: { gapMs: 1e20 } }).run(); expect(unsafe.statusCode).toBe(400);
});
