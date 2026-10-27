import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { CaptureProcessor, CaptureProcessingError, type CaptureJob } from './capture-processor.js';
import { CaptureResources } from './capture-resources.js';
import type { CaptureNetworkTiming } from '../../src/core/trace-types.js';
import { WS_ARCHIVE_MAGIC, wsRecordHeader } from './websocket-archive.js';

const job = (): CaptureJob => ({ hostname: 'synthetic.invalid', url: '/v1/messages', requestBody: '{"model":"synthetic","system":"你好","messages":[],"metadata":{"agent_provider":"claude","session_id":"native-one"}}', responseBody: 'event: message_start\r\ndata: {"message":{"id":"msg_1","usage":{"input_tokens":12}}}\r\n\r\nevent: message_delta\r\ndata: {"usage":{"output_tokens":5}}\r\n\r\n', requestHeaders: {}, responseHeaders: {}, isStreaming: true, previewTruncated: false });
const faultWorker = join(process.cwd(), 'server/proxy/capture-worker.fixture.mjs');

describe('bounded real worker capture processor', () => {
  it('consumes relinquished dedicated previews once and retains actual worker parsing', async () => {
    const resources = new CaptureResources(), processor = new CaptureProcessor({ resources });
    const input = job(), requestBytes = Uint8Array.from(Buffer.from(input.requestBody)), responseBytes = Uint8Array.from(Buffer.from(input.responseBody!));
    const offsets = new Uint32Array([responseBytes.length]), elapsedMs = new Float64Array([2]);
    try {
      const pending = processor.submitOwned({ ...input, requestBody:'', responseBody:null, requestBytes,responseBytes,responseTimeline:{offsets,elapsedMs,count:1,limited:false} });
      expect([requestBytes.byteLength,responseBytes.byteLength,offsets.byteLength,elapsedMs.byteLength]).toEqual([0,0,0,0]);
      const result = await pending;
      expect(result.workerThreadId).toBeGreaterThan(0);
      expect(result.processing.status).toBe('ok');
      expect(result.parsed).toMatchObject({model:'synthetic',systemPrompt:'你好',inputTokens:12,outputTokens:5});
      expect(result.previews).toMatchObject({request:input.requestBody,response:input.responseBody});
    } finally { await processor.close(); }
    expect(resources.snapshot()).toMatchObject({queuedJobs:0,queuedBytes:0,workers:0});
  });
  it('rejects unsafe owned views and over-budget jobs before detaching any caller bytes', async () => {
    const resources = new CaptureResources(), processor = new CaptureProcessor({ resources });
    const requestBytes = Uint8Array.from(Buffer.from(job().requestBody)), original = requestBytes.slice();
    try {
      await expect(processor.submitOwned({...job(),requestBody:'',requestBytes,responseBytes:Uint8Array.of(1,2).subarray(1)})).rejects.toMatchObject({status:'worker_error'});
      expect(requestBytes).toEqual(original);
      await expect(processor.submitOwned({...job(),requestBody:'',requestBytes,responseBytes:Buffer.from('pooled')})).rejects.toMatchObject({status:'worker_error'});
      expect(requestBytes).toEqual(original);
      await expect(processor.submitOwned({...job(),requestBody:'',requestBytes,responseBytes:new Uint8Array(new SharedArrayBuffer(2))})).rejects.toMatchObject({status:'worker_error'});
      expect(requestBytes).toEqual(original);
    } finally { await processor.close(); }
    await expect(processor.submitOwned({...job(),requestBytes})).rejects.toMatchObject({status:'closed'});
    expect(requestBytes).toEqual(original);
    const bounded = new CaptureProcessor({resources,maxBytes:1});
    try { await expect(bounded.submitOwned({...job(),requestBytes})).rejects.toMatchObject({status:'queue_full'});expect(requestBytes).toEqual(original); }
    finally { await bounded.close(); }
    expect(resources.snapshot()).toMatchObject({queuedJobs:0,queuedBytes:0,workers:0});
  });
  it('retains exact Codex WS session membership without turning a connection into a model call', async () => {
    const processor = new CaptureProcessor();
    const body = Buffer.from(JSON.stringify({ type: 'response.create', client_metadata: { session_id: 'codex-native',
      'x-codex-turn-metadata': JSON.stringify({ session_id: 'codex-native', thread_id: 'codex-native' }) }, model: 'synthetic', input: [] }));
    const requestBytes = Buffer.concat([WS_ARCHIVE_MAGIC, wsRecordHeader('message', false, 1, 0, body.length), body]);
    try {
      const result = await processor.submit({ ...job(), evidenceFormat: 'websocket_archive_v1', requestHeaders: {}, requestBytes, responseBytes: WS_ARCHIVE_MAGIC });
      expect(result.parsed).toMatchObject({ model: null, inputTokens: null, outputTokens: null, parserRoute: 'websocket_connection' });
      expect(result.identities.completeness.complete).toBe(true);
      expect(result.identities.items).toEqual([expect.objectContaining({ namespace: 'agent:codex', kind: 'session', value: 'codex-native', scope: null, sourcePath: 'awsp1.request[1].client_metadata.session_id' })]);
      const partial = await processor.submit({ ...job(), evidenceFormat: 'websocket_archive_v1', requestHeaders: {}, requestBytes, responseBytes: WS_ARCHIVE_MAGIC, requestTruncated: true });
      expect(partial.identities.completeness.complete).toBe(false); expect(partial.identities.completeness.reasons).toContain('source_preview_truncated');
    } finally { await processor.close(); }
  });
  it('classifies recorded arrivals in the actual worker without replacing them with worker time or detaching caller arrays', async () => {
    const processor = new CaptureProcessor();
    const parts = [': ping\n\n', 'data: {"choices":[{"delta":{"content":"中文🙂"}}]}\n\n', 'data: [DONE]\n\n'];
    const responseBytes = Buffer.from(parts.join(''));
    let offset = 0;
    const offsets = Uint32Array.from(parts.map(part => offset += Buffer.byteLength(part)));
    const elapsedMs = Float64Array.of(150, 800, 1900);
    const timing: CaptureNetworkTiming = { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150,
      firstContentMs: null, firstContentKind: null, firstContentBasis: null, completedMs: 2000,
      contentTimingStatus: 'not_collected', serverTiming: 'native;dur=700', serverTimingTruncated: false };
    const source = { ...job(), url: '/v1/chat/completions', requestBody: '{"model":"synthetic","messages":[]}', responseBody: null,
      responseBytes, timing, responseTimeline: { offsets, elapsedMs, count: 3, limited: false }, responseTruncated: false };
    const snapshot = JSON.stringify(source);
    try {
      const result = await processor.submit(source);
      expect(result.workerThreadId).toBeGreaterThan(0);
      expect(result.timing).toEqual({ ...timing, firstContentMs: 800, firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', contentTimingStatus: 'observed' });
      expect(JSON.stringify(source)).toBe(snapshot); expect(offsets.byteLength).toBe(12); expect(elapsedMs.byteLength).toBe(24);
      expect(processor.status().bytes).toBe(0);
    } finally { await processor.close(); }
  });
  it('charges arrival arrays against processor admission before cloning or worker transfer', async () => {
    const processor = new CaptureProcessor({ maxBytes: 49152 });
    const responseTimeline = { offsets: new Uint32Array(4096), elapsedMs: new Float64Array(4096), count: 0, limited: true };
    try {
      await expect(processor.submit({ ...job(), responseTimeline })).rejects.toMatchObject({ status: 'queue_full' });
      expect(responseTimeline.offsets.byteLength + responseTimeline.elapsedMs.byteLength).toBe(49152);
      expect(processor.status().bytes).toBe(0);
    } finally { await processor.close(); }
  });
  it('enforces job admission across processors and releases global reservations after real termination', async () => {
    const resources = new CaptureResources({ jobs: 1, workers: 1 });
    const first = new CaptureProcessor({ resources, workerPath: faultWorker, timeoutMs: 1000 });
    const second = new CaptureProcessor({ resources });
    const pending = first.submit(job()); const rejected = pending.catch(error => error);
    try {
      await expect(second.submit(job())).rejects.toMatchObject({ status: 'queue_full' });
      expect(resources.snapshot()).toMatchObject({ queuedJobs: 1, workers: 1, processingRejectedRequests: 1 });
      await first.close(); expect(await rejected).toBeInstanceOf(CaptureProcessingError);
      expect(resources.snapshot()).toMatchObject({ queuedJobs: 0, queuedBytes: 0, workers: 0 });
      expect((await second.submit(job())).processing.status).toBe('ok');
    } finally { await first.close(); await second.close(); }
    expect(resources.snapshot()).toMatchObject({ queuedJobs: 0, queuedBytes: 0, workers: 0 });
  });
  it('bounds live workers across listeners and recovers after the owner closes', async () => {
    const resources = new CaptureResources({ workers: 1 });
    const first = new CaptureProcessor({ resources }), second = new CaptureProcessor({ resources });
    try {
      await first.submit(job());
      await expect(second.submit(job())).rejects.toMatchObject({ status: 'queue_full' });
      expect(resources.snapshot()).toMatchObject({ workers: 1, queuedJobs: 0 });
      await first.close(); expect((await second.submit(job())).processing.status).toBe('ok');
    } finally { await first.close(); await second.close(); }
    expect(resources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0 });
  });
  it('bounds dispatched SSE records without accepting usage beyond that bound', async () => {
    const processor = new CaptureProcessor();
    try {
      const responseBody = 'data: {}\n\n'.repeat(8192) + 'data: {"usage":{"input_tokens":999,"output_tokens":999}}\n\n';
      const result = await processor.submit({ ...job(), responseBody });
      expect(result.processing).toMatchObject({ status: 'decode_error', error: 'SSE_EVENT_LIMIT' });
      expect(result.parsed.inputTokens).toBeNull(); expect(result.parsed.outputTokens).toBeNull();
      expect(result.identities.completeness.complete).toBe(false);
      expect(result.identities.completeness.reasons).toContain('SSE_EVENT_LIMIT');
    } finally { await processor.close(); }
  });
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('uses owned %s bytes without reconstructing them from text or detaching caller buffers', async (encoding, compress) => {
    const processor = new CaptureProcessor(); const input = job();
    const requestBytes = compress(Buffer.from(input.requestBody)), responseBytes = compress(Buffer.from(input.responseBody!));
    const requestOriginal = Buffer.from(requestBytes), responseOriginal = Buffer.from(responseBytes);
    try {
      const result = await processor.submit({ ...input, requestBody: '', responseBody: null, requestBytes, responseBytes, requestHeaders: { 'content-encoding': encoding }, responseHeaders: { 'content-encoding': encoding } });
      expect(result.processing).toEqual({ version: 1, status: 'ok', error: null, contentDecoding: { request: encoding, response: encoding } });
      expect(result.parsed).toMatchObject({ model: 'synthetic', systemPrompt: '你好', inputTokens: 12, outputTokens: 5 });
      expect(result.previews.request).toBe(input.requestBody); expect(result.previews.response).toBe(input.responseBody);
      expect(requestBytes).toEqual(requestOriginal); expect(responseBytes).toEqual(responseOriginal);
    } finally { await processor.close(); }
  });
  it('does not accept usage/terminal markers from an incomplete EOF frame and exposes codec errors separately', async () => {
    const processor = new CaptureProcessor();
    try {
      const incomplete = await processor.submit({ ...job(), responseBody: 'data: {"usage":{"input_tokens":99,"output_tokens":99}}\n' });
      expect(incomplete.processing).toMatchObject({ status: 'decode_error', error: 'SSE_INCOMPLETE_FRAME' });
      expect(incomplete.parsed.inputTokens).toBeNull(); expect(incomplete.parsed.outputTokens).toBeNull();
      const badUtf8 = await processor.submit({ ...job(), responseBody: null, responseBytes: Uint8Array.of(0xff) });
      expect(badUtf8.processing).toMatchObject({ status: 'decode_error', error: 'INVALID_UTF8' });
      const unsupported = await processor.submit({ ...job(), responseHeaders: { 'content-encoding': 'gzip, br' } });
      expect(unsupported.processing).toMatchObject({ status: 'decode_error', error: 'UNSUPPORTED_CONTENT_ENCODING' });
      const bomb = await processor.submit({ ...job(), responseBody: null, responseBytes: gzipSync(Buffer.from('x'.repeat(3 * 1024 * 1024))), responseHeaders: { 'content-encoding': 'gzip' } });
      expect(bomb.processing).toMatchObject({ status: 'decode_error', error: 'DECODED_TOO_LARGE' });
      expect(bomb.parsed.outputTokens).toBeNull();
    } finally { await processor.close(); }
  });
  it('runs the actual built protocol/identity parser on another thread and preserves input', async () => {
    const processor = new CaptureProcessor(); const input = job(); const snapshot = structuredClone(input);
    try {
      const result = await processor.submit(input);
      expect(result.workerThreadId).toBeGreaterThan(0);
      expect(result.parsed).toMatchObject({ requestFormat: 'anthropic_messages', model: 'synthetic', systemPrompt: '你好', inputTokens: 12, outputTokens: 5 });
      expect(result.identities.items.some(identity => identity.kind === 'session' && identity.value === 'native-one')).toBe(true);
      expect(result.processing).toEqual({ version: 1, status: 'ok', error: null, contentDecoding: { request: 'identity', response: 'identity' } });
      expect(input).toEqual(snapshot);
    } finally { await processor.close(); }
    expect(processor.status()).toEqual({ jobs: 0, bytes: 0, closed: true });
  });

  it('bounds active plus queued jobs, rejects excess without losing accepted work and releases all reservations', async () => {
    const processor = new CaptureProcessor({ maxJobs: 1 });
    try {
      const first = processor.submit(job());
      await expect(processor.submit(job())).rejects.toMatchObject({ status: 'queue_full' });
      expect(processor.status().jobs).toBe(1);
      await first;
      expect(processor.status().bytes).toBe(0);
      expect((await processor.submit(job())).processing.status).toBe('ok');
    } finally { await processor.close(); }
  });

  it('enforces byte admission and source preview limits before posting to a worker', async () => {
    const processor = new CaptureProcessor({ maxBytes: 10 });
    await expect(processor.submit(job())).rejects.toBeInstanceOf(CaptureProcessingError);
    expect(processor.status()).toEqual({ jobs: 0, bytes: 0, closed: false }); await processor.close();
    const other = new CaptureProcessor();
    try { await expect(other.submit({ ...job(), requestBody: 'x'.repeat(2 * 1024 * 1024 + 1) })).rejects.toMatchObject({ status: 'queue_full' }); }
    finally { await other.close(); }
  });

  it('makes truncated acquisition explicit rather than parsing a partial preview as complete evidence', async () => {
    const processor = new CaptureProcessor();
    try {
      const result = await processor.submit({ ...job(), previewTruncated: true });
      expect(result.processing.status).toBe('preview_truncated');
      expect(result.identities.completeness.complete).toBe(false);
    } finally { await processor.close(); }
  });

  it('handles an actual worker crash with a static error, releases queued work and can restart', async () => {
    const processor = new CaptureProcessor({ workerPath: faultWorker });
    try {
      const crashed = processor.submit({ ...job(), hostname: 'crash.synthetic.invalid' });
      const queued = processor.submit(job());
      const settled = await Promise.allSettled([crashed, queued]);
      expect(settled.every(result => result.status === 'rejected')).toBe(true);
      for (const result of settled) if (result.status === 'rejected') { expect(result.reason).toMatchObject({ status: 'worker_error' }); expect(String(result.reason)).not.toContain('synthetic sensitive payload'); }
      expect(processor.status().jobs).toBe(0);
      const recovered = await processor.submit({ ...job(), hostname: 'recover.synthetic.invalid' });
      expect(recovered.parsed.model).toBe('synthetic'); expect(recovered.workerThreadId).toBeGreaterThan(0);
    } finally { await processor.close(); }
  });

  it('rejects a bounded oversized projection without adopting partial metadata', async () => {
    const processor = new CaptureProcessor();
    const requestBody = JSON.stringify({ model: 'synthetic', metadata: { agent_provider: 'claude', session_id: 's'.repeat(1024) }, messages: [{ role: 'assistant', tool_calls: Array.from({ length: 2000 }, (_, index) => ({ id: 'i'.repeat(1000) + index })) }] });
    expect(Buffer.byteLength(requestBody)).toBeLessThan(2 * 1024 * 1024);
    try { await expect(processor.submit({ ...job(), requestBody, responseBody: null, isStreaming: false })).rejects.toMatchObject({ status: 'result_limit' }); }
    finally { await processor.close(); }
  });

  it('keeps main-loop heartbeat moving while real workers parse near-limit streams', async () => {
    const processor = new CaptureProcessor();
    const responseBody = 'data: {"usage":{"input_tokens":12,"output_tokens":5}}\n\n'.repeat(36000);
    expect(Buffer.byteLength(responseBody)).toBeLessThan(2 * 1024 * 1024);
    const histogram = monitorEventLoopDelay({ resolution: 1 }); histogram.enable();
    let beats = 0; const beat = setInterval(() => { beats += 1; }, 1);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      const results = await Promise.all(Array.from({ length: 4 }, () => processor.submit({ ...job(), responseBody })));
      expect(results.every(result => result.parsed.outputTokens === 5)).toBe(true);
      expect(beats).toBeGreaterThan(3);
      expect(histogram.percentile(99) / 1e6).toBeLessThan(50);
    } finally { clearInterval(beat); histogram.disable(); await processor.close(); }
  });

  it('terminates a stalled worker at its bound, rejects jobs once and cleans shutdown ownership', async () => {
    const processor = new CaptureProcessor({ workerPath: faultWorker, timeoutMs: 80 });
    try {
      await expect(processor.submit(job())).rejects.toMatchObject({ status: 'timeout' });
      expect(processor.status().jobs).toBe(0);
    } finally { await processor.close(); }
    await expect(processor.submit(job())).rejects.toMatchObject({ status: 'closed' });
  });
});
