import Database from 'better-sqlite3';
import { request, type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';
import { CaptureBodyStore } from './proxy/body-store.js';
import { writeCaptureBodies } from './proxy/capture-storage.js';
import { WS_ARCHIVE_MAGIC, wsRecordHeader } from './proxy/websocket-archive.js';
import { registerCodexSource } from './codex/source.js';
import { CodexInspector } from './codex/service.js';
import { captureResources } from './proxy/capture-resources.js';
import { OriginalDeletionQueue } from './proxy/original-deletions.js';
import { normalizeCodexSample } from '../src/adapters/codex.js';
import { storeTraceRecord } from '../local-sessions/scanner-utils.js';

const frame = (seq: number, value: unknown): Buffer => { const bytes = Buffer.from(JSON.stringify(value)); return Buffer.concat([wsRecordHeader('message', false, seq, seq * 10, bytes.length), bytes]); };
const reqBytes = Buffer.concat([WS_ARCHIVE_MAGIC, frame(1, { type: 'response.create', model: 'SYNTHETIC_CODEX', instructions: 'SYNTHETIC_SYSTEM', input: [{ role: 'user', content: 'SYNTHETIC_INPUT' }] })]);
const resBytes = Buffer.concat([WS_ARCHIVE_MAGIC, frame(2, { type: 'response.created', response: { id: 'synthetic-one' } }),
  frame(3, { type: 'response.output_text.delta', response_id: 'synthetic-one', delta: 'SYNTHETIC_OUTPUT' }),
  frame(4, { type: 'response.completed', response: { id: 'synthetic-one', status: 'completed', usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 12 } } })]);
async function fixture(requestBytes = reqBytes, responseBytes = resBytes) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-calls-http-')), db = new Database(':memory:'); initSchema(db);
  const store = await CaptureBodyStore.create(join(directory, 'originals')), a = store.begin(), b = store.begin();
  a.append(requestBytes); b.append(responseBytes); const [requestRef, responseRef] = await Promise.all([a.finish(), b.finish()]);
  db.prepare("INSERT INTO proxy_requests(request_id,method,url,hostname,request_headers,started_at) VALUES('ws-synthetic','WS','wss://synthetic.invalid/v1/responses','synthetic.invalid','{}','2026-10-16T00:00:00.000Z')").run();
  writeCaptureBodies(db, 1, { request: requestRef, response: responseRef, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {},
    transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 101, websocket: { version: 1, scope: 'connection', archive: 'awsp1', requestMessages: 1, responseMessages: 3, clientCloseCode: 1000, upstreamCloseCode: 1000 } } });
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'absent'); });
  const server = createAgentObservabilityServer({ db, config, captureDirectory: store.directory, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, headers = {}): Promise<{ status: number; body: Record<string, unknown>; headers: IncomingHttpHeaders }> => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, res => { const parts: Buffer[] = []; res.on('data', (part: Buffer) => parts.push(part)); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>, headers: res.headers })); });
    req.on('error', reject); req.end();
  });
  return { db, store, a, b, directory, call, async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); await rm(directory, { recursive: true, force: true }); } };
}
describe('Codex per-call production worker and HTTP', () => {
  it('bounds the final detail after native enrichment, not only the worker message', async () => {
    const requestBytes = Buffer.concat([WS_ARCHIVE_MAGIC, frame(1, { type: 'response.create', client_metadata: {
      'x-codex-turn-metadata': JSON.stringify({ session_id: 'native-large' }), session_id: 'native-large',
    }, input: [] })]);
    const f = await fixture(requestBytes);
    try {
      const stamp = '2026-10-16T00:00:00.000Z';
      const record = normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: [
        { type: 'session_meta', timestamp: stamp, payload: { id: 'native-large' } },
        { type: 'response_item', timestamp: stamp, payload: { type: 'function_call', call_id: 'tool-one', name: 'Read', arguments: '{}' } },
      ] }, '/synthetic/large-native.jsonl');
      storeTraceRecord(f.db, record, '/synthetic/large-native.jsonl', 'native-large');
      const insert = f.db.prepare('INSERT INTO trace_identities(id,source_id,namespace,kind,value,scope,event_id,source_path) VALUES(?,?,?,?,?,?,?,?)');
      f.db.transaction(() => {
        for (let i = 0; i < 2040; i += 1) insert.run('synthetic-response-evidence-' + i, 'scan:native-large', 'protocol:openai', 'response', 'synthetic-one', 'native-large', 'tool-one', 'events[' + i + '].' + 'x'.repeat(480));
      })();
      expect(await f.call('/api/proxy/requests/1/codex-calls/0')).toMatchObject({ status: 503, body: { error: { code: 'CODEX_INSPECTION_LIMIT' } } });
      expect(await f.call('/api/proxy/requests/1/codex-calls')).toMatchObject({ status: 200, body: { total: 1 } });
      expect(captureResources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0, queuedBytes: 0 });
    } finally { await f.close(); }
  });
  it('serves a page and selected call beyond128 through the actual worker without returning the whole index', async () => {
    const requests: Buffer[] = [WS_ARCHIVE_MAGIC], responses: Buffer[] = [WS_ARCHIVE_MAGIC];
    for (let i = 0; i < 3000; i += 1) {
      requests.push(frame(i * 3 + 1, { type: 'response.create', model: 'SYNTHETIC_LONG', input: [{ role: 'user', content: 'LONG_BODY_' + i }] }));
      responses.push(frame(i * 3 + 2, { type: 'response.created', response: { id: 'long-' + i } }), frame(i * 3 + 3, { type: 'response.completed', response: { id: 'long-' + i, output: [] } }));
    }
    const f = await fixture(Buffer.concat(requests), Buffer.concat(responses));
    try {
      const before = f.db.prepare('SELECT total_changes() AS n').get();
      const result = await f.call('/api/proxy/requests/1/codex-calls?offset=2980&limit=20');
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ offset: 2980, total: 3000, hasMore: false, items: Array.from({ length: 20 }, (_, i) => expect.objectContaining({ sequence: 2980 + i })) });
      expect(Buffer.byteLength(JSON.stringify(result.body))).toBeLessThan(64 * 1024);
      expect(JSON.stringify(result.body)).not.toContain('LONG_BODY_');
      expect(await f.call('/api/proxy/requests/1/codex-calls/2999')).toMatchObject({ status: 200, body: { call: { sequence: 2999 }, requestPreview: expect.stringContaining('LONG_BODY_2999') } });
      expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      expect(captureResources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0, queuedBytes: 0 });
    } finally { await f.close(); }
  });
  it('lists slim metadata, serves selected original-backed analysis and exact live-key fallback with no writes or upstream calls', async () => {
    const f = await fixture();
    try {
      const before = f.db.prepare('SELECT total_changes() AS n').get();
      const page = await f.call('/api/proxy/requests/1/codex-calls');
      expect(page.status).toBe(200); expect(page.headers['cache-control']).toBe('no-store');
      expect(page.body).toMatchObject({ total: 1, active: false, complete: true, items: [expect.objectContaining({ state: 'completed', firstContentMs: 20, durationMs: 30, usage: expect.objectContaining({ totalTokens: 12, cacheReadTokens: 4, reasoningTokens: 1 }) })] });
      expect(JSON.stringify(page.body)).not.toMatch(/SYNTHETIC_(?:INPUT|OUTPUT|SYSTEM)/);
      const detail = await f.call('/api/proxy/requests/1/codex-calls/0');
      expect(detail.status).toBe(200); expect(detail.body).toMatchObject({ native: { state: 'missing' }, analysis: { state: 'completed', system: 'SYNTHETIC_SYSTEM' } });
      expect(JSON.stringify(detail.body)).toContain('SYNTHETIC_OUTPUT');
      expect((await f.call('/api/proxy/live/ws-synthetic/codex-calls')).body).toEqual(page.body);
      expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      expect(captureResources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0, queuedBytes: 0 });
    } finally { await f.close(); }
  });
  it('validates paging, unknown/non-WS sources and local-origin protection using ApiError', async () => {
    const f = await fixture();
    try {
      for (const path of ['/api/proxy/requests/1/codex-calls?limit=0', '/api/proxy/requests/1/codex-calls?offset=-1', '/api/proxy/requests/1/codex-calls/4096', '/api/proxy/requests/1/codex-calls?offset=4097']) {
        const result = await f.call(path); expect(result.status).toBe(400); expect(result.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
      }
      expect((await f.call('/api/proxy/requests/1/codex-calls/1')).status).toBe(404);
      expect((await f.call('/api/proxy/live/unknown/codex-calls')).status).toBe(404);
      expect(await f.call('/api/proxy/requests/1/codex-calls', { origin: 'https://untrusted.invalid' })).toMatchObject({ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Untrusted capture Host or Origin' } } });
      f.db.prepare("UPDATE proxy_requests SET method='POST' WHERE id=1").run();
      expect(await f.call('/api/proxy/requests/1/codex-calls')).toMatchObject({ status: 422, body: { error: { code: 'CODEX_SOURCE_UNAVAILABLE' } } });
    } finally { await f.close(); }
  });
  it('blocks all derived bodies after explicit deletion intent, retaining metadata only', async () => {
    const f = await fixture();
    try {
      await new OriginalDeletionQueue(f.db, f.store).request(1, 'ws-synthetic');
      expect(await f.call('/api/proxy/requests/1/codex-calls/0')).toMatchObject({ status: 409, body: { error: { code: 'CAPTURE_ORIGINALS_DELETED' } } });
      expect(await f.call('/api/proxy/live/ws-synthetic/codex-calls')).toMatchObject({ status: 409 });
    } finally { await f.close(); }
  });
  it('inspects an unfinished writer snapshot and cancels an owned worker without leaking leases', async () => {
    const f = await fixture(), a = f.store.begin(), b = f.store.begin();
    a.append(reqBytes); b.append(resBytes);
    const unregister = registerCodexSource(f.db, 'ws-live', () => ({ requestId: 'ws-live', active: true, directory: f.store.directory, headers: {}, startedAt: '2026-10-16T00:00:00.000Z', request: a.snapshot(), response: b.snapshot() }));
    const inspector = new CodexInspector(f.db, async () => f.store);
    try {
      while (f.store.status().pendingBytes !== 0) await new Promise(resolve => setTimeout(resolve, 1));
      expect(await f.call('/api/proxy/live')).toMatchObject({ status: 200, body: { items: [expect.objectContaining({ requestId: 'ws-live', ended: false })] } });
      expect(JSON.stringify((await f.call('/api/proxy/live')).body)).not.toMatch(/SYNTHETIC_(?:INPUT|OUTPUT|SYSTEM)|sha256|directory/);
      expect(await f.call('/api/proxy/live/ws-live/codex-calls')).toMatchObject({ status: 200, body: { active: true, total: 1, complete: false } });
      const controller = new AbortController(), task = inspector.read({ requestId: 'ws-live' }, {}, controller.signal);
      await expect(inspector.read({ requestId: 'ws-live' }, {})).rejects.toMatchObject({ code: 'CODEX_INSPECTION_BUSY' });
      const deadline = Date.now() + 2000;
      while (captureResources.snapshot().workers === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
      expect(captureResources.snapshot().workers).toBe(1);
      controller.abort(); await expect(task).rejects.toMatchObject({ code: 'CODEX_INSPECTION_FAILED' });
      expect(captureResources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0, queuedBytes: 0 });
    } finally { unregister(); await inspector.close(); await Promise.all([a.finish(), b.finish()]); await f.close(); }
  });
});
