import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import type { CaptureComparisonResponse, CaptureNetworkTiming } from '../src/core/trace-types.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';
import { CaptureBodyStore } from './proxy/body-store.js';
import { readCaptureBodies, writeCaptureBodies } from './proxy/capture-storage.js';
import { OriginalDeletionQueue } from './proxy/original-deletions.js';

async function call(port: number, path: string, headers: Record<string, string> = {}): Promise<{status: number; headers: IncomingHttpHeaders; text: string}> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('error', reject);
      res.once('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, headers: res.headers,
        text: (res.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString('utf8') }); });
    }); req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Synthetic comparison HTTP timeout'))); req.end();
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-comparison-'));
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); initSchema(db);
  const captureDirectory = join(directory, 'originals'); const store = await CaptureBodyStore.create(captureDirectory);
  let originCalls = 0; const origin = createServer((req, res) => { originCalls++; req.resume(); res.end('not replayed'); });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const insert = db.prepare(`INSERT INTO proxy_requests (request_id,method,url,hostname,request_format,request_headers,request_body,response_body,
    raw_request_body,raw_response_body,system_prompt,system_prompt_len,model,started_at,completed_at,duration_ms,response_status,content_type)
    VALUES (?,'POST',?,'127.0.0.1','openai_chat',?,'SQLITE_BODY_COPY','SQLITE_RESPONSE_COPY','RAW_COPY','RAW_RESPONSE_COPY','PROMPT_COPY',11,'synthetic',?,?,2000,200,'application/json')`);
  const ids: number[] = [];
  for (const index of [1, 2]) {
    const reqBody = JSON.stringify({ model: 'synthetic', messages: [{ role: 'system', content: 'BODY_DERIVED_SYSTEM' }, { role: 'user', content: 'same synthetic task' }] });
    const resBody = JSON.stringify({ id: 'synthetic-' + index, model: 'synthetic', choices: [{ message: { role: 'assistant', content: 'BODY_DERIVED_RESPONSE' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: index === 1 ? 100 : 120, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 }, total_tokens: index === 1 ? 120 : 140 } });
    const reqWriter = store.begin(); const resWriter = store.begin(); reqWriter.append(Buffer.from(reqBody)); resWriter.append(Buffer.from(resBody));
    const [reqRef, resRef] = await Promise.all([reqWriter.finish(), resWriter.finish()]);
    const id = Number(insert.run('synthetic-' + index, `http://127.0.0.1:${(origin.address() as AddressInfo).port}/v1/chat/completions`,
      JSON.stringify({ authorization: 'SYNTHETIC_HEADER_NOT_IN_COMPARISON' }), '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:02.000Z').lastInsertRowid);
    const timing: CaptureNetworkTiming = { version: 1, clock: 'proxy_monotonic', responseHeadersMs: index * 100, firstBodyByteMs: index * 150,
      firstContentMs: 2000, firstContentKind: 'text', firstContentBasis: 'json_document_complete', completedMs: 2000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false };
    writeCaptureBodies(db, id, { request: reqRef, response: resRef, requestPreviewTruncated: false, responsePreviewTruncated: false,
      responseHeaders: { 'set-cookie': 'SYNTHETIC_RESPONSE_HEADER_NOT_IN_COMPARISON' }, processing: { version: 1, status: 'ok', error: null },
      transport: { version: 1, state: 'completed', error: null, statusCode: 200, requestEnded: true, responseEnded: true, timing } });
    ids.push(id);
  }
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'no-sources'); });
  const server = createAgentObservabilityServer({ db, config, captureDirectory, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as AddressInfo).port;
  expect((await call(port, '/api/health')).status).toBe(200);
  return { db, directory, store, captureDirectory, port, ids, get originCalls() { return originCalls; }, async close() {
    try { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
    finally { await new Promise<void>(resolve => origin.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true }); }
  } };
}
function parse(result: Awaited<ReturnType<typeof call>>): CaptureComparisonResponse {
  expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); return JSON.parse(result.text) as CaptureComparisonResponse;
}

describe('selected capture comparison production HTTP', () => {
  it('returns exactly two original-backed usage/timing summaries without bodies/headers or upstream replay', async () => {
    const f = await fixture();
    try {
      const before = f.db.prepare('SELECT total_changes() AS n').get();
      const result = await call(f.port, '/api/proxy/requests/2/comparison?base=1'); const data = parse(result);
      expect(data.base.request.id).toBe(1); expect(data.target.request.id).toBe(2); expect(new Date(data.generatedAt).toISOString()).toBe(data.generatedAt);
      expect(data.base.analysis?.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, totalTokens: 120, accounting: 'openai_subsets' });
      expect(data.target.analysis?.usage.totalTokens).toBe(140); expect(data.base.analysis?.errorCount).toBe(0); expect(data.base.analysis?.errorCodesTruncated).toBe(false);
      expect(data.base.evidence.transport?.timing?.responseHeadersMs).toBe(100); expect(data.target.evidence.transport?.timing?.responseHeadersMs).toBe(200);
      expect(data.base.analysisUnavailableReason).toBeNull(); expect(data.base.evidence).not.toHaveProperty('responseHeaders');
      for (const value of ['BODY_DERIVED_SYSTEM','BODY_DERIVED_RESPONSE','SQLITE_BODY_COPY','SQLITE_RESPONSE_COPY','RAW_COPY','PROMPT_COPY','SYNTHETIC_HEADER_NOT_IN_COMPARISON','SYNTHETIC_RESPONSE_HEADER_NOT_IN_COMPARISON', f.directory]) expect(result.text).not.toContain(value);
      expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before); expect(f.originCalls).toBe(0);
      const gzip = await call(f.port, '/api/proxy/requests/2/comparison?base=1', { 'accept-encoding': 'gzip' }); expect(gzip.headers['content-encoding']).toBe('gzip'); expect(parse(gzip).base.analysis?.usage.totalTokens).toBe(120);
    } finally { await f.close(); }
  });
  it('keeps metadata and recorded timing but strips either side after real pending deletion intent', async () => {
    const f = await fixture();
    try {
      const intent = await new OriginalDeletionQueue(f.db, f.store).request(1, 'synthetic-1');
      expect(intent.state).toBe('pending');
      // Metadata-only must not initialize the file store or resume this intent.
      const pending = parse(await call(f.port, '/api/proxy/requests/2/comparison?base=1&mode=metadata'));
      expect(pending.base.originalDeletion?.state).toBe('pending');
      expect(pending.base.analysis).toBeNull(); expect(pending.base.analysisUnavailableReason).toBe('original_deleted');
      expect(pending.target.analysis).toBeNull(); expect(pending.target.analysisUnavailableReason).toBe('metadata_only');
      expect(pending.base.evidence.transport?.timing?.completedMs).toBe(2000);
      // Reading the other side's originals resumes an already confirmed pending
      // cleanup; the final synchronous snapshot must reflect that completion.
      const data = parse(await call(f.port, '/api/proxy/requests/2/comparison?base=1'));
      expect(data.base.analysis).toBeNull(); expect(data.base.analysisUnavailableReason).toBe('original_deleted'); expect(data.base.originalDeletion?.state).toBe('complete');
      expect(data.base.evidence.transport?.timing?.completedMs).toBe(2000); expect(data.target.analysis?.usage.totalTokens).toBe(140);
      const reversed = parse(await call(f.port, '/api/proxy/requests/1/comparison?base=2')); expect(reversed.target.analysis).toBeNull(); expect(reversed.base.analysis).not.toBeNull(); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('metadata mode does not read missing original files; full mode reports source loss honestly', async () => {
    const f = await fixture();
    try {
      // Only disposable synthetic files are removed; DB references stay as observed.
      for (const id of f.ids) { const refs = readCaptureBodies(f.db, id);
        await rm(join(f.captureDirectory, refs.request!.id + '.body')); await rm(join(f.captureDirectory, refs.response!.id + '.body')); }
      const metadata = parse(await call(f.port, '/api/proxy/requests/2/comparison?base=1&mode=metadata'));
      expect(metadata.base.analysis).toBeNull(); expect(metadata.target.analysis).toBeNull(); expect(metadata.base.analysisUnavailableReason).toBe('metadata_only');
      const full = parse(await call(f.port, '/api/proxy/requests/2/comparison?base=1'));
      expect(full.base.analysis?.completeness.complete ?? false).toBe(false); expect(full.target.analysis?.completeness.complete ?? false).toBe(false); expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('bounds native error codes and never returns observed native error payloads', async () => {
    const f = await fixture();
    try {
      // Explicitly seeded legacy analysis fixture; originals remain independent.
      const frames = Array.from({ length: 40 }, (_, i) => 'data: ' + JSON.stringify({ error: { code: 'SYNTHETIC_' + i, message: 'BODY_ERROR_PAYLOAD' } }) + '\n\n').join('');
      f.db.prepare('DELETE FROM proxy_capture_bodies WHERE proxy_id=1').run();
      f.db.prepare("UPDATE proxy_requests SET request_body=?,response_body=?,is_streaming=1 WHERE id=1").run('{"messages":[]}', frames);
      const result = await call(f.port, '/api/proxy/requests/2/comparison?base=1'); const side = parse(result).base;
      expect(side.analysis?.errorCount).toBe(40); expect(side.analysis?.errorCodes).toHaveLength(32); expect(side.analysis?.errorCodesTruncated).toBe(true); expect(result.text).not.toContain('BODY_ERROR_PAYLOAD');
    } finally { await f.close(); }
  });
  it.each(['','?base=2','?base=0','?base=-1','?base=1.5','?base=0x1','?base=9007199254740992','?base=1&base=1','?base=1&mode=full','?base=1&mode=metadata&mode=metadata','?base=1&unexpected=1'])('rejects malformed pair query %s with unified errors', async query => {
    const f = await fixture(); try { const result = await call(f.port, '/api/proxy/requests/2/comparison' + query); expect(result.status).toBe(400); expect(JSON.parse(result.text)).toEqual({ error: { code: 'BAD_REQUEST', message: expect.any(String) } }); } finally { await f.close(); }
  });
  it('guards unknown and malformed target IDs and nonlocal Host/Origin', async () => {
    const f = await fixture(); try {
      for (const target of ['0x2','2.5','0','9007199254740992']) expect((await call(f.port, `/api/proxy/requests/${target}/comparison?base=1`)).status).toBe(400);
      const absent = await call(f.port, '/api/proxy/requests/2/comparison?base=99999'); expect(absent.status).toBe(404); expect(JSON.parse(absent.text).error.code).toBe('PROXY_REQUEST_NOT_FOUND');
      for (const headers of [{ host: 'untrusted.invalid' }, { origin: 'https://untrusted.invalid' }] as Array<Record<string,string>>) expect((await call(f.port, '/api/proxy/requests/2/comparison?base=1', headers)).status).toBe(400);
      expect(f.originCalls).toBe(0);
    } finally { await f.close(); }
  });
  it('maps oversized metadata to the static bounded comparison error', async () => {
    const f = await fixture(); try {
      f.db.prepare('UPDATE proxy_requests SET url=? WHERE id=1').run('SYNTHETIC_OVERSIZED_' + 'x'.repeat(1024 * 1024));
      const result = await call(f.port, '/api/proxy/requests/2/comparison?base=1&mode=metadata'); expect(result.status).toBe(503);
      expect(JSON.parse(result.text)).toEqual({ error: { code: 'CAPTURE_COMPARISON_LIMIT', message: expect.any(String) } }); expect(result.text).not.toContain('SYNTHETIC_OVERSIZED_');
    } finally { await f.close(); }
  });
});
