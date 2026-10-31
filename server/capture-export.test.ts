import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import type { CaptureEvidenceExport, NativeIdentitySet } from '../src/core/trace-types.js';
import { CaptureBodyStore } from './proxy/body-store.js';
import { writeCaptureBodies } from './proxy/capture-storage.js';
import { OriginalDeletionQueue } from './proxy/original-deletions.js';
import { createAgentObservabilityServer } from './server.js';
import { openWritable } from './storage/db.js';
import { SCHEMA_VERSION } from './storage/schema.js';
import { writeNativeIdentities } from './storage/trace-links.js';

interface HttpResult { status: number; headers: IncomingHttpHeaders; raw: Buffer; text: string }
async function call(port: number, path: string, options: { headers?: Record<string, string>; method?: string; body?: unknown } = {}): Promise<HttpResult> {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }), ...options.headers,
    } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('error', reject);
      res.once('end', () => {
        const raw = Buffer.concat(chunks);
        const decoded = res.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
        resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, text: decoded.toString('utf8') });
      });
    }); req.on('error', reject); req.end(body);
  });
}

async function fixture(options: { encoded?: boolean; unavailableStore?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'capture-export-http-'));
  const dbPath = join(directory, 'state.sqlite'); const captureDirectory = join(directory, 'bodies');
  const db = openWritable(dbPath); const store = await CaptureBodyStore.create(captureDirectory);
  let originCalls = 0;
  const origin = createServer((req, res) => { originCalls += 1; req.resume(); res.end('UPSTREAM_MUST_NOT_BE_REPLAYED'); });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const originPort = (origin.address() as AddressInfo).port;
  const requestText = JSON.stringify({ model: 'synthetic-model', system: 'SYSTEM_FROM_ORIGINAL', messages: [{ role: 'user', content: 'Question from retained original' }],
    unprojectedOriginal: 'REQUEST_ORIGINAL_NOT_INLINE' });
  const responseText = JSON.stringify({ id: 'message-original', type: 'message', role: 'assistant', model: 'synthetic-model',
    content: [{ type: 'text', text: 'RESPONSE_FROM_ORIGINAL' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 3 },
    unprojectedOriginal: 'RESPONSE_ORIGINAL_NOT_INLINE' });
  const requestBytes = options.encoded ? gzipSync(requestText) : Buffer.from(requestText);
  const responseBytes = options.encoded ? gzipSync(responseText) : Buffer.from(responseText);
  const first = store.begin(); const second = store.begin(); first.append(requestBytes); second.append(responseBytes);
  const [requestRef, responseRef] = await Promise.all([first.finish(), second.finish()]);
  const headers = { authorization: 'Bearer ORIGINAL_SYNTHETIC_CREDENTIAL', cookie: 'session=ORIGINAL_SYNTHETIC_COOKIE',
    ...(options.encoded ? { 'content-encoding': 'gzip' } : {}) };
  const id = Number(db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,started_at,completed_at,duration_ms,request_format,request_headers,
    request_body,response_body,raw_request_body,raw_response_body,system_prompt,system_prompt_len,response_status,content_type,model)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('export-request', 'POST', `http://127.0.0.1:${originPort}/v1/messages?token=ORIGINAL_URL_VALUE`,
    '127.0.0.1', '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:01.000Z', 1000, 'anthropic_messages', JSON.stringify(headers),
    'SQLITE_REQUEST_PREVIEW_MUST_NOT_EXPORT', 'SQLITE_RESPONSE_PREVIEW_MUST_NOT_EXPORT', 'SQLITE_RAW_REQUEST_MUST_NOT_EXPORT',
    'SQLITE_RAW_RESPONSE_MUST_NOT_EXPORT', 'SQLITE_SYSTEM_PREVIEW_MUST_NOT_EXPORT', 37, 200, 'application/json', 'synthetic-model').lastInsertRowid);
  writeCaptureBodies(db, id, { request: requestRef, response: responseRef, requestPreviewTruncated: false, responsePreviewTruncated: false,
    responseHeaders: { 'set-cookie': ['a=ORIGINAL_FIRST', 'b=ORIGINAL_SECOND'], ...(options.encoded ? { 'content-encoding': 'gzip' } : {}) },
    transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200 } });
  db.prepare('INSERT INTO sessions(id,provider,source_agent,started_at,updated_at,source_path,data_source) VALUES(?,?,?,?,?,?,?)')
    .run('export-scan', 'codex', 'Codex', '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z', 'fixture://native-session', 'scan');
  const manifest: NativeIdentitySet = { parserVersion: 1, completeness: { complete: true, omittedCount: 0, reasons: [] },
    items: [{ namespace: 'agent:codex', kind: 'session', value: 'native-export-session', scope: null, eventId: null, sourcePath: 'request.headers.x-agent-session-id' }] };
  writeNativeIdentities(db, { source: 'scan', key: 'export-scan' }, manifest, '2026-10-16T00:00:00.000Z');
  writeNativeIdentities(db, { source: 'proxy', key: String(id) }, manifest, '2026-10-16T00:00:00.000Z');
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'no-native-sources'); }
  const caDirectory = join(directory, 'private-ca'); await mkdir(join(caDirectory, 'keys'), { recursive: true });
  await writeFile(join(caDirectory, 'keys', 'ca.private.key'), 'PRIVATE_CA_FILE_MUST_NOT_EXPORT');
  let configuredCaptureDirectory = captureDirectory;
  if (options.unavailableStore) configuredCaptureDirectory = join(directory, 'not-a-directory');
  const server = createAgentObservabilityServer({ db, dbPath, captureDirectory: configuredCaptureDirectory, caDirectory,
    userConfigPath: join(directory, 'user-config.json'), config });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  if (options.unavailableStore) {
    // Settle ordinary startup first: this is an on-demand source failure, not
    // the separate policy that blocks capture routes after startup corruption.
    expect((await call(port, '/api/health')).status).toBe(200);
    await writeFile(configuredCaptureDirectory, 'PRIVATE_STORE_INITIALIZATION_FAILURE');
  }
  return { directory, db, store, id, requestRef, responseRef, captureDirectory, requestBytes, responseBytes,
    port, get originCalls() { return originCalls; },
    async close() {
      try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
      finally {
        origin.closeAllConnections(); await new Promise<void>(resolve => origin.close(() => resolve()));
        if (db.open) db.close(); await rm(directory, { recursive: true, force: true });
      }
    } };
}

function evidence(result: HttpResult): CaptureEvidenceExport {
  expect(result.status).toBe(200);
  expect(result.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(result.headers['cache-control']).toBe('no-store');
  return JSON.parse(result.text) as CaptureEvidenceExport;
}
function noPrivateCopies(text: string, directory: string): void {
  for (const value of ['SQLITE_REQUEST_PREVIEW_MUST_NOT_EXPORT', 'SQLITE_RESPONSE_PREVIEW_MUST_NOT_EXPORT', 'SQLITE_RAW_REQUEST_MUST_NOT_EXPORT',
    'SQLITE_RAW_RESPONSE_MUST_NOT_EXPORT', 'SQLITE_SYSTEM_PREVIEW_MUST_NOT_EXPORT', 'REQUEST_ORIGINAL_NOT_INLINE', 'RESPONSE_ORIGINAL_NOT_INLINE',
    'PRIVATE_CA_FILE_MUST_NOT_EXPORT', 'PRIVATE_STORE_INITIALIZATION_FAILURE', directory]) expect(text).not.toContain(value);
}

describe('capture evidence export production HTTP/SQLite integration', () => {
  it('downloads original-backed bounded analysis and identity/link evidence without exposing preview/raw/path/private-CA copies or replaying upstream', async () => {
    const f = await fixture();
    try {
      const changes = f.db.prepare('SELECT total_changes() AS count').get();
      const result = await call(f.port, `/api/proxy/requests/${f.id}/export`); const value = evidence(result);
      expect(result.headers['content-disposition']).toBe(`attachment; filename="capture-${f.id}.json"`);
      expect(result.headers['content-length']).toBe(String(result.raw.length)); expect(result.headers['content-encoding']).toBeUndefined();
      expect(value).toMatchObject({ format: 'awesome-telemetry.capture-evidence', formatVersion: 1, schemaVersion: SCHEMA_VERSION,
        analysisUnavailableReason: null, originalDeletion: null, request: { id: f.id, requestId: 'export-request' } });
      expect(new Date(value.exportedAt).toISOString()).toBe(value.exportedAt);
      expect(value.analysis?.parserVersion).toBeGreaterThanOrEqual(2); expect(value.analysis?.system).toBe('SYSTEM_FROM_ORIGINAL');
      expect(value.analysis?.items.some(item => item.content === 'RESPONSE_FROM_ORIGINAL')).toBe(true);
      expect(value.analysis?.usage.inputTokens).toBe(0); expect(value.analysis?.usage.outputTokens).toBe(3);
      expect(value.request.requestHeaders).toMatchObject({ authorization: 'Bearer ORIGINAL_SYNTHETIC_CREDENTIAL', cookie: 'session=ORIGINAL_SYNTHETIC_COOKIE' });
      expect(value.request.url).toContain('token=ORIGINAL_URL_VALUE'); expect(value.capture.responseHeaders['set-cookie']).toEqual(['a=ORIGINAL_FIRST', 'b=ORIGINAL_SECOND']);
      expect(value.capture.request).toEqual(f.requestRef); expect(value.capture.response).toEqual(f.responseRef);
      expect(value.identities.items).toHaveLength(1); expect(value.identities.items[0]).toMatchObject({ value: 'native-export-session', sourcePath: 'request.headers.x-agent-session-id' });
      expect(value.traceLinks.items).toHaveLength(1); expect(value.traceLinks.items[0]).toMatchObject({ state: 'direct', sessionKey: 'export-scan' });
      expect(value.traceLinks.items[0]!.evidenceIds).toContain(value.identities.items[0]!.id);
      for (const key of ['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody', 'systemPrompt']) expect(value.request).not.toHaveProperty(key);
      noPrivateCopies(result.text, f.directory); expect(f.originCalls).toBe(0);
      expect(f.db.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    } finally { await f.close(); }
  });
  it('uses production gzip download headers while preserving encoded-original digests and separate raw-body downloads', async () => {
    const f = await fixture({ encoded: true });
    try {
      const result = await call(f.port, `/api/proxy/requests/${f.id}/export`, { headers: { 'accept-encoding': 'gzip' } }); const value = evidence(result);
      expect(result.headers['content-encoding']).toBe('gzip'); expect(result.headers.vary).toBe('accept-encoding');
      expect(result.headers['content-length']).toBe(String(result.raw.length)); expect(result.headers['content-disposition']).toBe(`attachment; filename="capture-${f.id}.json"`);
      expect(value.analysis?.system).toBe('SYSTEM_FROM_ORIGINAL'); expect(value.analysis?.items.some(item => item.content === 'RESPONSE_FROM_ORIGINAL')).toBe(true);
      expect(value.capture.request?.sha256).toBe(createHash('sha256').update(f.requestBytes).digest('hex'));
      expect(value.capture.response?.sha256).toBe(createHash('sha256').update(f.responseBytes).digest('hex'));
      const downloaded = await call(f.port, `/api/proxy/requests/${f.id}/body/request`);
      expect(downloaded.status).toBe(200); expect(downloaded.raw).toEqual(f.requestBytes);
      noPrivateCopies(result.text, f.directory); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('metadata mode avoids unavailable original-store initialization and never contains body-derived analysis', async () => {
    const f = await fixture({ unavailableStore: true });
    try {
      const value = evidence(await call(f.port, `/api/proxy/requests/${f.id}/export?mode=metadata`));
      expect(value.analysis).toBeNull(); expect(value.analysisUnavailableReason).toBe('metadata_only');
      expect(JSON.stringify(value)).not.toContain('SYSTEM_FROM_ORIGINAL'); expect(JSON.stringify(value)).not.toContain('RESPONSE_FROM_ORIGINAL');
      expect(value.capture.request).toEqual(f.requestRef); expect(value.identities.items).toHaveLength(1);
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('keeps metadata downloadable with an explicit unavailable reason when real local source initialization fails', async () => {
    const f = await fixture({ unavailableStore: true });
    try {
      const result = await call(f.port, `/api/proxy/requests/${f.id}/export`); const value = evidence(result);
      expect(value.analysis).toBeNull(); expect(value.analysisUnavailableReason).toBe('analysis_unavailable');
      expect(value.limitations).toContain('analysis_unavailable'); noPrivateCopies(result.text, f.directory);
      expect(result.text).not.toContain('EEXIST'); expect(result.text).not.toContain('ENOTDIR'); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('blocks pending intent before physical cleanup and never revives original analysis from still-present files', async () => {
    const f = await fixture();
    try {
      const job = await new OriginalDeletionQueue(f.db, f.store).request(f.id, 'export-request'); expect(job.state).toBe('pending');
      expect((await readFile(join(f.captureDirectory, f.requestRef.id + '.body')))).toEqual(f.requestBytes);
      const result = await call(f.port, `/api/proxy/requests/${f.id}/export`); const value = evidence(result);
      expect(value.originalDeletion?.state).toBe('pending'); expect(value.analysis).toBeNull(); expect(value.analysisUnavailableReason).toBe('original_deleted');
      expect(value.request.requestHeaders.authorization).toBe('Bearer ORIGINAL_SYNTHETIC_CREDENTIAL');
      expect(result.text).not.toContain('SYSTEM_FROM_ORIGINAL'); expect(result.text).not.toContain('RESPONSE_FROM_ORIGINAL');
      noPrivateCopies(result.text, f.directory);
      const metadata = evidence(await call(f.port, `/api/proxy/requests/${f.id}/export?mode=metadata`)); expect(metadata.analysisUnavailableReason).toBe('original_deleted');
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('exports only retained metadata after real confirmed HTTP deletion and keeps old originals unavailable', async () => {
    const f = await fixture();
    try {
      const path = `/api/proxy/requests/${f.id}`;
      expect(evidence(await call(f.port, path + '/export')).analysis).not.toBeNull();
      const deleted = await call(f.port, path + '/original-deletion', { method: 'POST', body: { expectedRequestId: 'export-request', confirm: true } });
      expect(deleted.status).toBe(200); expect(JSON.parse(deleted.text).state).toBe('complete');
      const result = await call(f.port, path + '/export'); const value = evidence(result);
      expect(value.originalDeletion?.state).toBe('complete'); expect(value.analysis).toBeNull(); expect(value.analysisUnavailableReason).toBe('original_deleted');
      expect(value.capture.request).toEqual(f.requestRef); expect(value.traceLinks.items).toHaveLength(1);
      expect(value.request.requestHeaders.cookie).toBe('session=ORIGINAL_SYNTHETIC_COOKIE');
      expect(result.text).not.toContain('SYSTEM_FROM_ORIGINAL'); expect(result.text).not.toContain('RESPONSE_FROM_ORIGINAL'); noPrivateCopies(result.text, f.directory);
      expect((await call(f.port, path + '/body/request')).status).toBe(404); expect((await call(f.port, path + '/analysis')).status).toBe(409);
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('rejects invalid/unknown IDs and unknown, duplicate or invalid mode queries with unified ApiError', async () => {
    const f = await fixture();
    try {
      for (const id of ['0', '-1', '1.5', '9007199254740992', 'not-a-number']) {
        const result = await call(f.port, `/api/proxy/requests/${id}/export`);
        expect(result.status).toBe(400); expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'BAD_REQUEST', message: expect.any(String) } });
      }
      const absent = await call(f.port, '/api/proxy/requests/999999/export'); expect(absent.status).toBe(404);
      expect(JSON.parse(absent.text)).toMatchObject({ error: { code: 'PROXY_REQUEST_NOT_FOUND', message: expect.any(String) } });
      for (const query of ['?mode=', '?mode=full', '?mode=metadata&mode=metadata', '?include=raw', '?mode=metadata&extra=1']) {
        const result = await call(f.port, `/api/proxy/requests/${f.id}/export` + query);
        expect(result.status).toBe(400); expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'BAD_REQUEST', message: expect.any(String) } });
      }
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('retains the first 100 identity/link records with true continuation rather than silently asserting an exhaustive archive', async () => {
    const f = await fixture();
    try {
      const items: NativeIdentitySet['items'] = Array.from({ length: 101 }, (_, i) => ({ namespace: 'openai', kind: 'request', value: 'native-request-' + i,
        scope: null, eventId: null, sourcePath: 'request.metadata.request_id_' + i }));
      writeNativeIdentities(f.db, { source: 'proxy', key: String(f.id) }, { parserVersion: 1, items, completeness: { complete: true, omittedCount: 0, reasons: [] } }, '2026-10-16T00:01:00.000Z');
      const insertSession = f.db.prepare('INSERT INTO sessions(id,provider,source_agent,started_at,updated_at,source_path,data_source) VALUES(?,?,?,?,?,?,?)');
      const insertLink = f.db.prepare('INSERT INTO trace_associations(id,session_key,proxy_id,state,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
      f.db.transaction(() => {
        for (let index = 0; index < 101; index += 1) {
          const key = 'page-session-' + String(index).padStart(3, '0');
          insertSession.run(key, 'codex', 'Codex', '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z', 'fixture://native-' + index, 'scan');
          insertLink.run('export-link-' + index, key, f.id, index % 2 === 0 ? 'confirmed' : 'candidate', 'fixture observed relation', '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z');
        }
      })();
      const value = evidence(await call(f.port, `/api/proxy/requests/${f.id}/export?mode=metadata`));
      expect(value.identities.items).toHaveLength(100); expect(value.identities.hasMore).toBe(true);
      expect(value.identities.nextCursor).toBe(value.identities.items.at(-1)!.id);
      expect(value.traceLinks.items).toHaveLength(100); expect(value.traceLinks.hasMore).toBe(true);
      expect(value.traceLinks.nextCursor).toBe(value.traceLinks.items.at(-1)!.sessionKey);
      expect(value.traceLinks.items.some(item => item.state === 'candidate')).toBe(true);
      expect(value.limitations).toContain('identity_page_has_more'); expect(value.limitations).toContain('trace_link_page_has_more');
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('maps the package-size guard to a static 503 rather than clipping retained headers or starting an attachment', async () => {
    const f = await fixture();
    try {
      // HTTP package limit only, not disk capacity, quota, split-DB or full-disk testing.
      const marker = 'ORIGINAL_HEADER_MUST_NOT_BE_CLIPPED';
      f.db.prepare('UPDATE proxy_requests SET request_headers=? WHERE id=?').run(JSON.stringify({ authorization: marker, 'x-large': 'x'.repeat(4 * 1024 * 1024) }), f.id);
      const result = await call(f.port, `/api/proxy/requests/${f.id}/export?mode=metadata`);
      expect(result.status).toBe(503); expect(JSON.parse(result.text)).toEqual({ error: { code: 'CAPTURE_EXPORT_LIMIT', message: 'Capture evidence export exceeds its bounded package size' } });
      expect(result.headers['content-disposition']).toBeUndefined(); expect(result.text).not.toContain(marker); expect(result.text.length).toBeLessThan(300);
      const retained = f.db.prepare('SELECT request_headers FROM proxy_requests WHERE id=?').get(f.id) as { request_headers: string };
      expect(JSON.parse(retained.request_headers).authorization).toBe(marker);
      expect(JSON.parse(retained.request_headers)['x-large'].length).toBe(4 * 1024 * 1024); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('applies loopback Host/Origin checks to full and metadata-only attachment routes', async () => {
    const f = await fixture();
    try {
      const untrustedHeaders: Array<Record<string, string>> = [{ host: 'untrusted.invalid' }, { origin: 'https://untrusted.invalid' }];
      for (const suffix of ['', '?mode=metadata']) {
        for (const headers of untrustedHeaders) {
          const result = await call(f.port, `/api/proxy/requests/${f.id}/export` + suffix, { headers });
          expect(result.status).toBe(400); expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'BAD_REQUEST', message: expect.any(String) } });
          expect(result.headers['content-disposition']).toBeUndefined();
        }
        expect(evidence(await call(f.port, `/api/proxy/requests/${f.id}/export` + suffix, { headers: { origin: 'http://127.0.0.1:5173' } })).request.id).toBe(f.id);
      }
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
});
