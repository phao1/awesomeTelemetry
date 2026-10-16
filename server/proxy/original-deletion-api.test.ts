import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, chmod, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentObservabilityServer } from '../server.js';
import { openWritable } from '../storage/db.js';
import { CaptureBodyStore } from './body-store.js';
import { writeCaptureBodies } from './capture-storage.js';
import { OriginalDeletionQueue } from './original-deletions.js';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';

async function call(port: number, method: string, path: string, body?: unknown, origin?: string) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { ...(text === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }), ...(origin === undefined ? {} : { origin }) } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk as Buffer)); res.on('error', reject); res.once('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end(text);
  });
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'original-deletion-api-')), dbPath = join(directory, 'state.sqlite'), captureDirectory = join(directory, 'bodies');
  let db = openWritable(dbPath);
  const store = await CaptureBodyStore.create(captureDirectory), a = store.begin(), b = store.begin();
  a.append(Buffer.from('{"model":"synthetic","system":"body-secret","messages":[]}')); b.append(Buffer.from('{"text":"response-secret"}'));
  const [requestRef, responseRef] = await Promise.all([a.finish(), b.finish()]);
  const id = Number(db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,started_at,request_format,request_headers,
    request_body,response_body,raw_request_body,raw_response_body,system_prompt,system_prompt_len)
    VALUES('expected-request','POST','/v1/messages','synthetic',?,'anthropic_messages',?,?,?,?,?,?,?)`)
    .run(new Date().toISOString(), '{"authorization":"retained-header"}', 'body-secret', 'response-secret', 'raw-request-secret', 'raw-response-secret', 'system-secret', 13).lastInsertRowid);
  writeCaptureBodies(db, id, { request: requestRef, response: responseRef, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'no-native-sessions'); }
  const start = () => createAgentObservabilityServer({ db, dbPath, captureDirectory, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json'), config });
  let server = start();
  const listen = async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return (server.address() as AddressInfo).port; };
  let port = await listen();
  return { directory, captureDirectory, id, requestRef, responseRef, store, get db() { return db; }, get port() { return port; },
    async restart() { await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))); db.close(); db = openWritable(dbPath); server = start(); port = await listen(); },
    async close() { try { await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))); } finally { if (db.open) db.close(); await rm(directory, { recursive: true, force: true }); } } };
}
const confirm = { expectedRequestId: 'expected-request', confirm: true };
describe('confirmed body-deletion production HTTP integration', () => {
  it('requires exact confirmation and blocks all fresh capture body routes while retaining headers/metadata', async () => {
    const f = await fixture(), path = `/api/proxy/requests/${f.id}`;
    try {
      expect(JSON.parse((await call(f.port, 'GET', path + '/original-deletion')).body.toString())).toBeNull();
      expect((await call(f.port, 'POST', path + '/original-deletion', { expectedRequestId: 'expected-request' })).status).toBe(400);
      expect((await call(f.port, 'POST', path + '/original-deletion', confirm, 'https://untrusted.invalid')).status).toBe(400);
      expect((await call(f.port, 'POST', path + '/original-deletion', { ...confirm, expectedRequestId: 'wrong' })).status).toBe(409);
      const deleted = await call(f.port, 'POST', path + '/original-deletion', confirm); expect(deleted.status).toBe(200);
      const job = JSON.parse(deleted.body.toString()); expect(job).toMatchObject({ state: 'complete', proxyId: f.id });
      expect(JSON.parse((await call(f.port, 'GET', path + '/original-deletion')).body.toString())).toEqual(job);
      expect(JSON.parse((await call(f.port, 'POST', path + '/original-deletion', confirm)).body.toString())).toEqual(job);
      const detail = JSON.parse((await call(f.port, 'GET', path)).body.toString());
      for (const key of ['requestBody','responseBody','rawRequestBody','rawResponseBody','systemPrompt']) expect(detail[key]).toBeNull();
      expect(f.db.prepare('SELECT request_body,response_body,raw_request_body,raw_response_body,system_prompt,system_prompt_len FROM proxy_requests WHERE id=?').get(f.id)).toEqual({ request_body: null, response_body: null, raw_request_body: null, raw_response_body: null, system_prompt: null, system_prompt_len: 0 });
      expect(detail.requestHeaders.authorization).toBe('retained-header');
      for (const direction of ['request', 'response']) expect((await call(f.port, 'GET', path + '/body/' + direction)).status).toBe(404);
      const analysis = await call(f.port, 'GET', path + '/analysis'); expect(analysis.status).toBe(409); expect(JSON.parse(analysis.body.toString()).error.code).toBe('CAPTURE_ORIGINALS_DELETED');
      const diff = await call(f.port, 'GET', path + '/context-diff'); expect(diff.status).toBe(422); expect(JSON.parse(diff.body.toString()).error.details.reason).toBe('original_deleted');
      expect(JSON.parse((await call(f.port, 'GET', '/api/proxy/storage')).body.toString()).usedBytes).toBe(0);
      expect(f.db.prepare('SELECT request_id FROM proxy_requests').all()).toEqual([{ request_id: 'expected-request' }]);
      // A controlled file reappearance is still not permission to serve it.
      await writeFile(join(f.captureDirectory, f.requestRef.id + '.body'), 'reappeared body-secret');
      expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(404);
      await f.restart(); expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(404);
    } finally { await f.close(); }
  });
  it('rejects deletion while a real monitor is running before persisting intent', async () => {
    const f = await fixture(), probe = createNetServer();
    try {
      await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve)); const proxyPort = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
      expect((await call(f.port, 'POST', '/api/proxy/start', { port: proxyPort })).status).toBe(200);
      const deadline = Date.now() + 5000;
      while (!JSON.parse((await call(f.port, 'GET', '/api/proxy/status')).body.toString()).running) { if (Date.now() > deadline) throw new Error('Actual proxy did not start'); await new Promise(resolve => setTimeout(resolve, 5)); }
      const result = await call(f.port, 'POST', `/api/proxy/requests/${f.id}/original-deletion`, confirm);
      expect(result.status).toBe(409); expect(JSON.parse(result.body.toString()).error.code).toBe('PROXY_MAINTENANCE');
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 0 });
      expect((await call(f.port, 'POST', '/api/proxy/stop')).status).toBe(200);
    } finally { probe.close(); await f.close(); }
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('retains failed cleanup for explicit retry but never serves still-present files or preview copies', async () => {
    const f = await fixture(), path = `/api/proxy/requests/${f.id}`;
    try {
      await call(f.port, 'GET', '/api/proxy/storage'); await chmod(f.captureDirectory, 0o500);
      try {
        const result = await call(f.port, 'POST', path + '/original-deletion', confirm); expect(result.status).toBe(200); expect(JSON.parse(result.body.toString())).toMatchObject({ state: 'failed' });
        expect((await stat(join(f.captureDirectory, f.requestRef.id + '.body'))).size).toBe(f.requestRef.bytes);
        expect((await readFile(join(f.captureDirectory, f.requestRef.id + '.body'), 'utf8'))).toContain('body-secret');
        expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(404);
        expect((await call(f.port, 'GET', path)).body.toString()).not.toContain('body-secret');
      } finally { await chmod(f.captureDirectory, 0o700); }
      expect(JSON.parse((await call(f.port, 'POST', path + '/original-deletion', confirm)).body.toString())).toMatchObject({ state: 'complete' });
    } finally { await chmod(f.captureDirectory, 0o700); await f.close(); }
  });
  it('reports state-write failure without SQL leakage and retries pending intent after files already vanished', async () => {
    const f = await fixture(), path = `/api/proxy/requests/${f.id}`;
    try {
      f.db.exec("CREATE TRIGGER reject_state BEFORE UPDATE ON proxy_original_deletions BEGIN SELECT RAISE(ABORT,'private synthetic SQL failure'); END");
      const result = await call(f.port, 'POST', path + '/original-deletion', confirm); expect(result.status).toBe(503);
      expect(JSON.parse(result.body.toString()).error.code).toBe('CAPTURE_DELETE_FAILED'); expect(result.body.toString()).not.toContain('private synthetic');
      expect(JSON.parse((await call(f.port, 'GET', path + '/original-deletion')).body.toString())).toMatchObject({ state: 'pending' });
      expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(404);
      f.db.exec('DROP TRIGGER reject_state'); expect(JSON.parse((await call(f.port, 'POST', path + '/original-deletion', confirm)).body.toString())).toMatchObject({ state: 'complete' });
    } finally { await f.close(); }
  });
  it('resumes pending confirmed intent at server restart even without an existing journal directory', async () => {
    const f = await fixture(), path = `/api/proxy/requests/${f.id}`;
    try {
      await new OriginalDeletionQueue(f.db, f.store).request(f.id, 'expected-request');
      await expect(stat(join(f.captureDirectory, '.capture-journal'))).rejects.toMatchObject({ code: 'ENOENT' });
      await f.restart(); expect((await call(f.port, 'GET', '/api/health')).status).toBe(200);
      expect(JSON.parse((await call(f.port, 'GET', path + '/original-deletion')).body.toString())).toMatchObject({ state: 'complete' });
      expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(404);
      expect(JSON.parse((await call(f.port, 'GET', '/api/proxy/storage')).body.toString()).usedBytes).toBe(0);
    } finally { await f.close(); }
  });
  it('rolls back intent and marker when clearing actual SQLite body copies fails', async () => {
    const f = await fixture(), path = `/api/proxy/requests/${f.id}`;
    try {
      f.db.exec("CREATE TRIGGER reject_copy_clear BEFORE UPDATE OF request_body ON proxy_requests BEGIN SELECT RAISE(ABORT,'controlled copy-clear failure'); END");
      expect((await call(f.port, 'POST', path + '/original-deletion', confirm)).status).toBe(503);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 0 });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 0 });
      expect(f.db.prepare('SELECT request_body FROM proxy_requests WHERE id=?').get(f.id)).toEqual({ request_body: 'body-secret' });
      expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(200);
    } finally { await f.close(); }
  });
  it('deletes a real production proxy capture through the API without replaying origin traffic', async () => {
    const f = await fixture(), probe = createNetServer(); let originCalls = 0;
    const origin = createServer((req, res) => { originCalls += 1; req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"synthetic","type":"message","content":[{"type":"text","text":"real-response-secret"}],"usage":{"input_tokens":2,"output_tokens":3}}'); }); });
    try {
      await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve)); const originPort = (origin.address() as AddressInfo).port;
      await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve)); const proxyPort = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
      await call(f.port, 'POST', '/api/proxy/start', { port: proxyPort }); const deadline = Date.now() + 7000;
      while (!JSON.parse((await call(f.port, 'GET', '/api/proxy/status')).body.toString()).running) { if (Date.now() > deadline) throw new Error('Actual proxy not ready'); await new Promise(resolve => setTimeout(resolve, 5)); }
      expect((await call(proxyPort, 'POST', `http://127.0.0.1:${originPort}/v1/messages`, { model: 'synthetic', system: 'real-system-secret', messages: [] })).status).toBe(200);
      await call(f.port, 'POST', '/api/proxy/stop');
      const captured = f.db.prepare('SELECT id,request_id FROM proxy_requests WHERE id<>?').get(f.id) as { id: number; request_id: string };
      expect(captured).toBeDefined(); const path = `/api/proxy/requests/${captured.id}`;
      expect((await call(f.port, 'GET', path + '/body/request')).body.toString()).toContain('real-system-secret');
      expect((await call(f.port, 'GET', path + '/body/response')).body.toString()).toContain('real-response-secret');
      const result = await call(f.port, 'POST', path + '/original-deletion', { confirm: true, expectedRequestId: captured.request_id });
      expect(result.status).toBe(200); expect(JSON.parse(result.body.toString())).toMatchObject({ state: 'complete' });
      expect((await call(f.port, 'GET', path + '/body/request')).status).toBe(404); expect((await call(f.port, 'GET', path)).body.toString()).not.toContain('real-system-secret');
      expect(originCalls).toBe(1); await f.restart(); expect((await call(f.port, 'GET', path + '/body/response')).status).toBe(404); expect(originCalls).toBe(1);
    } finally { probe.close(); origin.closeAllConnections(); await new Promise<void>(resolve => origin.close(() => resolve())); await f.close(); }
  }, 15_000);
});
