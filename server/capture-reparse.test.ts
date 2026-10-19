import Database from 'better-sqlite3';
import { request, createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { CaptureReparseResponse, CaptureReparseStatus } from '../src/core/trace-types.js';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';
import { CaptureBodyStore } from './proxy/body-store.js';
import { writeCaptureBodies } from './proxy/capture-storage.js';
import { OriginalDeletionQueue } from './proxy/original-deletions.js';
import { CaptureReparser } from './proxy/capture-reparse.js';

async function call(port: number, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({ host: '127.0.0.1', port, path, method, headers: {
      ...(bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(bytes.byteLength) }), ...headers,
    } }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { const raw = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, headers: res.headers,
        text: (res.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8') }); });
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Synthetic reparse HTTP timeout'))); req.end(bytes);
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-reparse-http-'));
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); initSchema(db);
  const captureDirectory = join(directory, 'originals'), store = await CaptureBodyStore.create(captureDirectory);
  let originCalls = 0;
  const origin = createServer((req, res) => { originCalls += 1; req.resume(); res.end('must not be replayed'); });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const requestBody = JSON.stringify({ model: 'synthetic-reparse', messages: [{ role: 'system', content: 'SYNTHETIC_REPARSE_SYSTEM' }] });
  const responseBody = JSON.stringify({ model: 'synthetic-reparse', choices: [{ message: { content: 'SYNTHETIC_REPARSE_OUTPUT' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120 } });
  const a = store.begin(), b = store.begin(); a.append(Buffer.from(requestBody)); b.append(Buffer.from(responseBody));
  const [requestRef, responseRef] = await Promise.all([a.finish(), b.finish()]);
  const url = `http://127.0.0.1:${(origin.address() as AddressInfo).port}/v1/chat/completions`;
  db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,request_headers,request_format,started_at,request_body,response_body)
    VALUES('synthetic-reparse-request','POST',?,'127.0.0.1',?,'openai_chat','2026-10-16T00:00:00.000Z','LEGACY_COPY','LEGACY_RESPONSE')`)
    .run(url, JSON.stringify({ authorization: 'SYNTHETIC_REPARSE_HEADER' }));
  writeCaptureBodies(db, 1, { request: requestRef, response: responseRef, requestPreviewTruncated: false, responsePreviewTruncated: false,
    responseHeaders: {}, processing: { version: 1, status: 'ok', error: null },
    transport: { version: 1, state: 'completed', error: null, statusCode: 200, requestEnded: true, responseEnded: true } });
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'disabled-sources'); });
  const server = createAgentObservabilityServer({ db, config, captureDirectory, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  expect((await call(port, '/api/health')).status).toBe(200);
  return { db, directory, store, port, requestRef, responseRef, get originCalls() { return originCalls; }, requestBody, responseBody,
    async close() {
      try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
      finally { await new Promise<void>(resolve => origin.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true }); }
    } };
}

describe('explicit versioned reparse production HTTP', () => {
  it('checks metadata without mutation and reparses the same originals twice without new calls, body copies or upstream traffic', async () => {
    const f = await fixture();
    try {
      const before = f.db.prepare('SELECT total_changes() AS n').get();
      const status = await call(f.port, '/api/proxy/requests/1/reparse');
      expect(status.status).toBe(200); expect(status.headers['cache-control']).toBe('no-store');
      expect((JSON.parse(status.text) as CaptureReparseStatus).state).toBe('not_parsed');
      expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      const originalQuery = f.db.prepare('SELECT request_id,request_body,response_body FROM proxy_requests WHERE id=1');
      const original = originalQuery.get();
      const summaryQuery = f.db.prepare('SELECT usage_json,completeness_json FROM proxy_capture_analysis WHERE proxy_id=1');
      const requestCount = f.db.prepare('SELECT COUNT(id) AS n FROM proxy_requests');
      const summaryCount = f.db.prepare('SELECT COUNT(proxy_id) AS n FROM proxy_capture_analysis');
      for (let iteration = 0; iteration < 2; iteration += 1) {
        const result = await call(f.port, '/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request' }, { 'accept-encoding': 'gzip' });
        expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['content-encoding']).toBe('gzip');
        const data = JSON.parse(result.text) as CaptureReparseResponse;
        expect(data.status).toMatchObject({ proxyId: 1, requestId: 'synthetic-reparse-request', state: 'current', currentParserVersion: 3, currentMetricVersion: 1 });
        expect(data.status.snapshot?.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, totalTokens: 120 });
        expect(data.analysis.system).toBe('SYNTHETIC_REPARSE_SYSTEM'); expect(data.analysis.items[0]?.content).toBe('SYNTHETIC_REPARSE_OUTPUT');
        const stored = summaryQuery.get();
        for (const text of ['SYNTHETIC_REPARSE_SYSTEM', 'SYNTHETIC_REPARSE_OUTPUT', 'SYNTHETIC_REPARSE_HEADER', 'LEGACY_COPY', 'snapshots']) expect(JSON.stringify(stored)).not.toContain(text);
        expect(requestCount.get()).toEqual({ n: 1 }); expect(summaryCount.get()).toEqual({ n: 1 });
        expect(originalQuery.get()).toEqual(original); expect(f.originCalls).toBe(0);
      }
      const readOriginal = async (id: string): Promise<string> => { const chunks: Buffer[] = []; for await (const chunk of f.store.openRead(id)) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString('utf8'); };
      expect(await readOriginal(f.requestRef.id)).toBe(f.requestBody); expect(await readOriginal(f.responseRef.id)).toBe(f.responseBody);
      f.db.prepare('UPDATE proxy_capture_analysis SET parser_version=1,metric_version=2 WHERE proxy_id=1').run();
      const stale = JSON.parse((await call(f.port, '/api/proxy/requests/1/reparse')).text) as CaptureReparseStatus;
      expect(stale.state).toBe('stale'); expect(stale.snapshot?.parserVersion).toBe(1); expect(stale.snapshot?.metricVersion).toBe(2);
      const rerun = await call(f.port, '/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request' });
      expect(rerun.status).toBe(200); expect((JSON.parse(rerun.text) as CaptureReparseResponse).status.state).toBe('current'); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });

  it('clears the derived summary atomically with confirmed deletion and blocks new reparse', async () => {
    const f = await fixture();
    try {
      expect((await call(f.port, '/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request' })).status).toBe(200);
      await new OriginalDeletionQueue(f.db, f.store).request(1, 'synthetic-reparse-request');
      expect(f.db.prepare('SELECT COUNT(proxy_id) AS n FROM proxy_capture_analysis').get()).toEqual({ n: 0 });
      const status = JSON.parse((await call(f.port, '/api/proxy/requests/1/reparse')).text) as CaptureReparseStatus;
      expect(status).toMatchObject({ state: 'unavailable', unavailableReason: 'originals_deleted', snapshot: null });
      const denied = await call(f.port, '/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request' });
      expect(denied.status).toBe(409); expect(JSON.parse(denied.text)).toMatchObject({ error: { code: 'CAPTURE_ORIGINALS_DELETED' } });
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });

  it('reports a source conflict if metadata disappears across the final service-to-HTTP await', async () => {
    const f = await fixture();
    const original = CaptureReparser.prototype.reparse;
    // Pass-through scheduling instrumentation: execute the entire real service
    // first, then change real SQLite metadata before its HTTP await resumes.
    // No parser/storage/result logic is replaced or fabricated.
    const boundary = vi.spyOn(CaptureReparser.prototype, 'reparse').mockImplementation(async function (this: CaptureReparser, id, expected) {
      const result = await original.call(this, id, expected);
      f.db.prepare('DELETE FROM proxy_requests WHERE id=?').run(id);
      return result;
    });
    try {
      const result = await call(f.port, '/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request' });
      expect(result.status).toBe(409); expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'CAPTURE_REPARSE_CONFLICT' } });
      expect(result.text).not.toContain('SYNTHETIC_REPARSE_SYSTEM'); expect(f.originCalls).toBe(0);
    } finally { boundary.mockRestore(); await f.close(); }
  });

  it.each([
    ['/api/proxy/requests/0/reparse', 'GET', undefined, {}, 400, 'BAD_REQUEST'],
    ['/api/proxy/requests/1e0/reparse', 'GET', undefined, {}, 400, 'BAD_REQUEST'],
    ['/api/proxy/requests/999/reparse', 'GET', undefined, {}, 404, 'PROXY_REQUEST_NOT_FOUND'],
    ['/api/proxy/requests/1/reparse?extra=1', 'GET', undefined, {}, 400, 'BAD_REQUEST'],
    ['/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request', replay: true }, {}, 400, 'BAD_REQUEST'],
    ['/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'different-identity' }, {}, 409, 'CAPTURE_REPARSE_CONFLICT'],
    ['/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: 'synthetic-reparse-request' }, { origin: 'https://evil.example' }, 400, 'BAD_REQUEST'],
    ['/api/proxy/requests/1/reparse', 'GET', undefined, { host: 'evil.example' }, 400, 'BAD_REQUEST'],
  ] as const)('rejects invalid or unauthorized reparse input %s %s', async (path, method, body, headers, expectedStatus, code) => {
    const f = await fixture();
    try {
      const result = await call(f.port, path, method, body, headers);
      expect(result.status).toBe(expectedStatus); expect(JSON.parse(result.text)).toMatchObject({ error: { code } });
      expect(f.db.prepare('SELECT COUNT(proxy_id) AS n FROM proxy_capture_analysis').get()).toEqual({ n: 0 }); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
});
