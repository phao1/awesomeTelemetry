import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CaptureBodyRef, CaptureReparseSnapshot, ProxyCaptureBodies, RequestContextFormat } from '../../src/core/trace-types.js';
import { openWritable } from '../storage/db.js';
import { readCaptureAnalysis, writeCaptureAnalysis } from '../storage/capture-analysis.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureReparser } from './capture-reparse.js';
import { readCaptureBodies, writeCaptureBodies } from './capture-storage.js';
import { OriginalDeletionQueue } from './original-deletions.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
async function fixture(options: { encoding?: 'gzip' | 'br' | 'deflate'; request?: string; response?: string; format?: RequestContextFormat; streaming?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'capture-reparse-'));
  const db = openWritable(join(directory, 'state.sqlite')); const store = await CaptureBodyStore.create(join(directory, 'bodies'));
  const encode = (text: string): Buffer => options.encoding === 'gzip' ? gzipSync(text) : options.encoding === 'br' ? brotliCompressSync(text) : options.encoding === 'deflate' ? deflateSync(text) : Buffer.from(text);
  const requestBytes = encode(options.request ?? JSON.stringify({ model: 'original-model', system: 'PRIVATE_ORIGINAL_SYSTEM', messages: [{ role: 'user', content: 'original question' }] }));
  const responseBytes = encode(options.response ?? JSON.stringify({ type: 'message', id: 'native-message', model: 'original-model', content: [{ type: 'text', text: 'PRIVATE_ORIGINAL_ANSWER' }],
    stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 } }));
  const a = store.begin(), b = store.begin(); a.append(requestBytes); b.append(responseBytes);
  const [requestRef, responseRef] = await Promise.all([a.finish(), b.finish()]);
  const requestHeaders: Record<string, string | string[]> = { Authorization: 'PRIVATE_ORIGINAL_CREDENTIAL', ...(options.encoding ? { 'Content-Encoding': [options.encoding] } : {}) };
  const id = Number(db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,request_headers,request_body,response_body,system_prompt,system_prompt_len,
    started_at,completed_at,request_format,is_streaming,model,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'original-request', 'POST', 'http://127.0.0.1:1/v1/messages', '127.0.0.1', JSON.stringify(requestHeaders), 'PREVIEW_MUST_NOT_REPARSE', 'PREVIEW_RESPONSE', 'PREVIEW_SYSTEM', 14,
    '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:01.000Z', options.format ?? 'anthropic_messages', options.streaming ? 1 : 0, 'legacy-model', 999, 999).lastInsertRowid);
  const capture: ProxyCaptureBodies = { request: requestRef, response: responseRef, requestPreviewTruncated: true, responsePreviewTruncated: true,
    responseHeaders: options.encoding ? { 'CONTENT-ENCODING': options.encoding } : {}, processing: { version: 1, status: 'worker_error', error: 'CAPTURE_PROCESSING_WORKER_ERROR' },
    transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200 } };
  writeCaptureBodies(db, id, capture);
  const reparser = new CaptureReparser(db, async () => store);
  cleanups.push(async () => { await reparser.close(); if (db.open) db.close(); await rm(directory, { recursive: true, force: true }); });
  return { db, store, id, directory, reparser, requestRef, responseRef, requestBytes, responseBytes, requestHeaders, capture };
}
function expectedFingerprint(f: Awaited<ReturnType<typeof fixture>>): string {
  return sha(JSON.stringify([1, 'original-request', 'anthropic_messages', '127.0.0.1', 'http://127.0.0.1:1/v1/messages', false, false,
    [f.requestRef.id, f.requestRef.bytes, f.requestRef.sha256, f.requestRef.status], [f.responseRef.id, f.responseRef.bytes, f.responseRef.sha256, f.responseRef.status],
    f.requestHeaders['Content-Encoding'] instanceof Array ? f.requestHeaders['Content-Encoding'].join(',') : null,
    f.capture.responseHeaders['CONTENT-ENCODING'] ?? null, [1, 'completed', null, true, true, 200]]));
}
function updateRef(f: Awaited<ReturnType<typeof fixture>>, direction: 'request' | 'response', patch: Partial<CaptureBodyRef>): void {
  writeCaptureBodies(f.db, f.id, { ...readCaptureBodies(f.db, f.id), [direction]: { ...f.capture[direction]!, ...patch } });
}

describe('explicit same-capture original-backed reparse service', () => {
  it('persists one exact versioned numeric manifest, preserves source/capture rows and makes no origin request', async () => {
    const f = await fixture(); let calls = 0;
    const origin = createServer((req, res) => { calls += 1; req.resume(); res.end('must not execute'); });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
    try {
      const address = origin.address(); if (address === null || typeof address === 'string') throw new Error('fixture origin missing');
      f.db.prepare('UPDATE proxy_requests SET url=? WHERE id=?').run(`http://127.0.0.1:${address.port}/v1/messages`, f.id);
      const before = f.db.prepare('SELECT request_id,request_headers,request_body,response_body,system_prompt,model,input_tokens,output_tokens FROM proxy_requests WHERE id=?').get(f.id);
      expect(f.reparser.status(f.id)).toMatchObject({ state: 'not_parsed', snapshot: null, currentParserVersion: 3, currentMetricVersion: 1 });
      const result = await f.reparser.reparse(f.id, 'original-request');
      expect(result.status).toMatchObject({ proxyId: f.id, requestId: 'original-request', state: 'current' });
      expect(result.analysis).toMatchObject({ parserVersion: 3, model: 'original-model', system: 'PRIVATE_ORIGINAL_SYSTEM', state: 'completed' });
      const snapshot = readCaptureAnalysis(f.db, f.id)!;
      expect(Object.keys(snapshot).sort()).toEqual(['completeness', 'metricVersion', 'parsedAt', 'parserVersion', 'requestFormat', 'sourceFingerprint', 'state', 'usage']);
      expect(snapshot).toMatchObject({ parserVersion: 3, metricVersion: 1, requestFormat: 'anthropic_messages', state: 'completed',
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0, reasoningTokens: null, nativeTotalTokens: null, totalTokens: 160, accounting: 'anthropic_additive_input' } });
      expect(snapshot.parsedAt).toBe(new Date(snapshot.parsedAt).toISOString()); expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(8192);
      expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_|original question|snapshots|headers|native-message/);
      await f.reparser.reparse(f.id, 'original-request');
      expect(f.db.prepare('SELECT COUNT(1) AS n FROM proxy_capture_analysis').get()).toEqual({ n: 1 });
      expect(f.db.prepare('SELECT COUNT(1) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
      expect(f.db.prepare('SELECT request_id,request_headers,request_body,response_body,system_prompt,model,input_tokens,output_tokens FROM proxy_requests WHERE id=?').get(f.id)).toEqual(before);
      expect(readCaptureBodies(f.db, f.id)).toEqual(f.capture);
      expect(await readFile(join(f.store.directory, f.requestRef.id + '.body'))).toEqual(f.requestBytes);
      expect(await readFile(join(f.store.directory, f.responseRef.id + '.body'))).toEqual(f.responseBytes); expect(calls).toBe(0);
    } finally { await new Promise<void>(resolve => origin.close(() => resolve())); }
  });
  it.each(['gzip', 'br', 'deflate'] as const)('uses case-insensitive %s encoding headers and the exact ordered fingerprint', async encoding => {
    const f = await fixture({ encoding }); const result = await f.reparser.reparse(f.id, 'original-request');
    expect(result.status.snapshot!.sourceFingerprint).toBe(expectedFingerprint(f));
    expect(result.analysis.usage.totalTokens).toBe(160); expect(result.analysis.system).toBe('PRIVATE_ORIGINAL_SYSTEM');
  });
  it('status never opens the store or reparses, and current is not a fresh file availability assertion', async () => {
    const f = await fixture(); const getStore = vi.fn(async () => f.store); const service = new CaptureReparser(f.db, getStore);
    expect(service.status(f.id).state).toBe('not_parsed'); expect(getStore).not.toHaveBeenCalled();
    await f.reparser.reparse(f.id, 'original-request'); await unlink(join(f.store.directory, f.responseRef.id + '.body'));
    expect(service.status(f.id).state).toBe('current'); expect(getStore).not.toHaveBeenCalled(); await service.close();
  });
  it('leaves the prior successful summary intact after an explicit failed recheck without claiming files were just verified', async () => {
    const f = await fixture(); await f.reparser.reparse(f.id, 'original-request'); const previous = readCaptureAnalysis(f.db, f.id);
    await unlink(join(f.store.directory, f.responseRef.id + '.body'));
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_UNSUPPORTED', reason: 'source_unavailable' });
    expect(readCaptureAnalysis(f.db, f.id)).toEqual(previous); expect(f.reparser.status(f.id)).toMatchObject({ state: 'current', snapshot: previous });
  });
  it('confirmed deletion clears the saved summary and blocks new reads even before file cleanup runs', async () => {
    const f = await fixture(); await f.reparser.reparse(f.id, 'original-request');
    const job = await new OriginalDeletionQueue(f.db, f.store).request(f.id, 'original-request'); expect(job.state).toBe('pending');
    expect(readCaptureAnalysis(f.db, f.id)).toBeNull(); expect(f.reparser.status(f.id)).toMatchObject({ state: 'unavailable', unavailableReason: 'originals_deleted', snapshot: null });
    const reader = vi.spyOn(f.store, 'openRead');
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_ORIGINALS_DELETED', reason: null });
    expect(reader).not.toHaveBeenCalled(); expect(await readFile(join(f.store.directory, f.requestRef.id + '.body'))).toEqual(f.requestBytes);
  });
  it.each(['parser', 'metric', 'fingerprint'] as const)('marks %s version/source mismatches stale without recomputing or rewriting', async cause => {
    const f = await fixture(); await f.reparser.reparse(f.id, 'original-request');
    const old = readCaptureAnalysis(f.db, f.id)!;
    const snapshot: CaptureReparseSnapshot = { ...old, ...(cause === 'parser' ? { parserVersion: 1 } : cause === 'metric' ? { metricVersion: 2 } : { sourceFingerprint: 'f'.repeat(64) }) };
    writeCaptureAnalysis(f.db, f.id, snapshot); expect(f.reparser.status(f.id)).toMatchObject({ state: 'stale', snapshot });
    expect(readCaptureAnalysis(f.db, f.id)).toEqual(snapshot);
  });
  it('ignores unused timing and unrelated headers but invalidates changed encoding or transport outcome', async () => {
    const f = await fixture(); await f.reparser.reparse(f.id, 'original-request');
    const capture = readCaptureBodies(f.db, f.id);
    capture.transport!.timing = { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 1, firstBodyByteMs: 2, firstContentMs: null, completedMs: 3,
      firstContentKind: null, firstContentBasis: null, contentTimingStatus: 'not_collected', serverTiming: null, serverTimingTruncated: false };
    writeCaptureBodies(f.db, f.id, capture); f.db.prepare('UPDATE proxy_requests SET request_headers=? WHERE id=?').run('{"authorization":"changed"}', f.id);
    expect(f.reparser.status(f.id).state).toBe('current');
    capture.transport!.state = 'http_error'; writeCaptureBodies(f.db, f.id, capture); expect(f.reparser.status(f.id).state).toBe('stale');
    capture.transport!.state = 'completed'; writeCaptureBodies(f.db, f.id, capture);
    f.db.prepare('UPDATE proxy_requests SET request_headers=? WHERE id=?').run('{"CONTENT-ENCODING":"gzip"}', f.id); expect(f.reparser.status(f.id).state).toBe('stale');
  });
  it.each(['unknown', 'incomplete', 'failed'] as const)('persists legitimate %s protocol evidence without inventing infrastructure failure', async outcome => {
    const options = outcome === 'unknown' ? { request: '{}', response: '{}', format: 'unknown' as const }
      : outcome === 'failed' ? { response: '{"error":{"type":"synthetic_error","message":"PRIVATE_ERROR"}}' }
        : { streaming: true, response: 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n' };
    const f = await fixture(options); const result = await f.reparser.reparse(f.id, 'original-request');
    expect(result.analysis.state).toBe(outcome); expect(result.status.state).toBe('current'); expect(readCaptureAnalysis(f.db, f.id)!.state).toBe(outcome);
  });
  it('can rediscover a supported request format from unknown metadata without rewriting that metadata', async () => {
    const f = await fixture({ format: 'unknown' }); const result = await f.reparser.reparse(f.id, 'original-request');
    expect(result.analysis.requestFormat).toBe('anthropic_messages');
    expect(f.db.prepare('SELECT request_format FROM proxy_requests WHERE id=?').get(f.id)).toEqual({ request_format: 'unknown' });
    expect(f.reparser.status(f.id).state).toBe('current');
  });
  it.each(['openai_chat', 'openai_responses'] as const)('runs the actual %s parser and retains subset totals rather than adding cache/reasoning twice', async format => {
    const usage = format === 'openai_chat' ? { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } }
      : { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 5 } };
    const response = format === 'openai_chat' ? { choices: [{ index: 0, message: { content: 'answer' }, finish_reason: 'stop' }], usage }
      : { id: 'response-native', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'answer' }] }], usage };
    const f = await fixture({ format, request: format === 'openai_chat' ? '{"model":"original-model","messages":[]}' : '{"model":"original-model","input":"question"}', response: JSON.stringify(response) });
    const result = await f.reparser.reparse(f.id, 'original-request');
    expect(result.analysis.state).toBe('completed'); expect(result.analysis.usage).toMatchObject({ totalTokens: 120, cacheReadTokens: 40, reasoningTokens: 5, accounting: 'openai_subsets' });
    expect(readCaptureAnalysis(f.db, f.id)!.usage.totalTokens).toBe(120);
  });
  it.each(['missing', 'incomplete', 'invalid'] as const)('rejects %s refs with unavailable metadata and no legacy preview fallback', async cause => {
    const f = await fixture();
    if (cause === 'missing') writeCaptureBodies(f.db, f.id, { ...f.capture, request: null });
    if (cause === 'incomplete') updateRef(f, 'request', { status: 'body_limit' });
    if (cause === 'invalid') updateRef(f, 'request', { id: '../../unrelated' });
    expect(f.reparser.status(f.id)).toMatchObject({ state: 'unavailable', unavailableReason: 'originals_' + cause, snapshot: null });
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_UNSUPPORTED', reason: 'originals_' + cause });
    expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
  });
  it.each(['missing_file', 'integrity', 'limit', 'encoding'] as const)('rejects actual source %s failures without storing a preview-derived summary', async cause => {
    const f = await fixture();
    const reason = { missing_file: 'source_unavailable', integrity: 'source_integrity_failed', limit: 'source_too_large', encoding: 'unsupported_content_encoding' }[cause];
    if (cause === 'missing_file') await unlink(join(f.store.directory, f.requestRef.id + '.body'));
    if (cause === 'integrity') await writeFile(join(f.store.directory, f.requestRef.id + '.body'), 'altered');
    if (cause === 'limit') updateRef(f, 'request', { bytes: 2 * 1024 * 1024 + 1 });
    if (cause === 'encoding') f.db.prepare('UPDATE proxy_requests SET request_headers=? WHERE id=?').run('{"content-encoding":"unsupported"}', f.id);
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_UNSUPPORTED', reason });
    expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
  });
  it('checks exact identity and rejects missing requests without source reads', async () => {
    const f = await fixture(); const getStore = vi.fn(async () => f.store); const service = new CaptureReparser(f.db, getStore);
    expect(() => service.status(0)).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(() => service.status(123456)).toThrow(expect.objectContaining({ code: 'PROXY_REQUEST_NOT_FOUND' }));
    await expect(service.reparse(f.id, 'another-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_CONFLICT', reason: null });
    expect(getStore).not.toHaveBeenCalled(); await service.close();
  });
  it('rejects malformed request confirmation and IDs before opening any original', async () => {
    const f = await fixture(); const getter = vi.fn(async () => f.store); const service = new CaptureReparser(f.db, getter);
    for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await expect(service.reparse(id, 'original-request')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const expected of ['', 'x'.repeat(1025)]) await expect(service.reparse(f.id, expected)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(getter).not.toHaveBeenCalled(); await service.close();
  });
  it.each(['invalid_utf8', 'decode_failed', 'decoded_too_large'] as const)('refuses valid-digest originals with actual %s semantic failures', async reason => {
    const f = await fixture();
    const bytes = reason === 'invalid_utf8' ? Buffer.from([0xff]) : reason === 'decode_failed' ? Buffer.from('not-gzip') : gzipSync('x'.repeat(2 * 1024 * 1024 + 1));
    await writeFile(join(f.store.directory, f.requestRef.id + '.body'), bytes);
    updateRef(f, 'request', { bytes: bytes.length, sha256: sha(bytes) });
    if (reason !== 'invalid_utf8') f.db.prepare('UPDATE proxy_requests SET request_headers=? WHERE id=?').run('{"content-encoding":"gzip"}', f.id);
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_UNSUPPORTED', reason });
    expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
  });
  it('rechecks source metadata after actual original stream IO rather than only after store acquisition', async () => {
    const f = await fixture(); const original = f.store.openRead.bind(f.store);
    vi.spyOn(f.store, 'openRead').mockImplementation((id, range) => {
      const stream = original(id, range);
      if (id === f.responseRef.id) stream.once('end', () => updateRef(f, 'response', { sha256: 'c'.repeat(64) }));
      return stream;
    });
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_CONFLICT' });
    expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
  });
  it.each(['identity', 'ref', 'deletion'] as const)('prevents late commit when %s changes during accepted async work', async change => {
    const f = await fixture(); let release!: (store: CaptureBodyStore) => void;
    const gate = new Promise<CaptureBodyStore>(resolve => { release = resolve; }); const service = new CaptureReparser(f.db, () => gate);
    const work = service.reparse(f.id, 'original-request'); const expected = expect(work).rejects.toMatchObject({ code: change === 'deletion' ? 'CAPTURE_ORIGINALS_DELETED' : 'CAPTURE_REPARSE_CONFLICT' });
    await Promise.resolve();
    if (change === 'identity') f.db.prepare('UPDATE proxy_requests SET request_id=? WHERE id=?').run('changed-request', f.id);
    if (change === 'ref') updateRef(f, 'request', { sha256: 'f'.repeat(64) });
    if (change === 'deletion') await new OriginalDeletionQueue(f.db, f.store).request(f.id, 'original-request');
    release(f.store); await expected; expect(readCaptureAnalysis(f.db, f.id)).toBeNull(); await service.close();
  });
  it('shares a single active slot across DB instances and close drains accepted work before rejecting future work', async () => {
    const f = await fixture(); let release!: (store: CaptureBodyStore) => void;
    const service = new CaptureReparser(f.db, () => new Promise<CaptureBodyStore>(resolve => { release = resolve; }));
    const other = new CaptureReparser(f.db, async () => f.store);
    const work = service.reparse(f.id, 'original-request'); await Promise.resolve();
    await expect(other.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_BUSY' });
    let closed = false; const closing = service.close().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false);
    release(f.store); await work; await closing; expect(closed).toBe(true);
    await expect(service.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_BUSY' });
    await expect(other.reparse(f.id, 'original-request')).resolves.toMatchObject({ status: { state: 'current' } }); await other.close();
  });
  it('returns a static failure on store/commit faults and releases the shared active slot', async () => {
    const f = await fixture(); const service = new CaptureReparser(f.db, async () => { throw new Error('PRIVATE_STORE_PATH'); });
    await expect(service.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_FAILED', reason: null, message: 'CAPTURE_REPARSE_FAILED' });
    f.db.exec("CREATE TRIGGER reject_reparse BEFORE INSERT ON proxy_capture_analysis BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQL_FAILURE'); END");
    await expect(f.reparser.reparse(f.id, 'original-request')).rejects.toMatchObject({ code: 'CAPTURE_REPARSE_FAILED', reason: null, message: 'CAPTURE_REPARSE_FAILED' });
    f.db.exec('DROP TRIGGER reject_reparse'); await expect(f.reparser.reparse(f.id, 'original-request')).resolves.toMatchObject({ status: { state: 'current' } }); await service.close();
  });
});
