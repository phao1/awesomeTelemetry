import { describe, expect, it } from 'vitest';

import { RequestContext } from './request-context.js';
import { CaptureResources } from './capture-resources.js';

describe('REQ-006/011 request-context', () => {
  it('captures exact monotonic arrival evidence before worker latency without mixing UTC timestamps', () => {
    let now = 0;
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {}, startedAt: '2000-01-01T00:00:00.000Z' }, 0, undefined, () => now);
    now = 100; ctx.markResponseHeaders({ 'server-timing': 'inference;dur=720' });
    now = 150; ctx.appendResponseBytes(Buffer.from(': ping\n\n'));
    now = 800; ctx.appendResponseBytes(Buffer.from('data: {"choices":[{"delta":{"content":"中"}}]}\n\n'));
    now = 2000; const end = ctx.markTransportEnd();
    now = 9000; ctx.markResponseHeaders({ 'server-timing': 'late' }); ctx.markTransportEnd();
    expect(end.durationMs).toBe(2000);
    expect(ctx.networkTiming()).toEqual({ version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150,
      firstContentMs: null, firstContentKind: null, firstContentBasis: null, completedMs: 2000, contentTimingStatus: 'not_collected', serverTiming: 'inference;dur=720', serverTimingTruncated: false });
    const timeline = ctx.takeResponseTimeline()!;
    expect(timeline.count).toBe(2); expect(timeline.limited).toBe(false);
    expect([...timeline.elapsedMs.subarray(0, timeline.count)]).toEqual([150, 800]);
    expect([...timeline.offsets.subarray(0, timeline.count)]).toEqual([8, Buffer.byteLength(ctx.streamedBody)]);
    expect(ctx.takeResponseTimeline()).toBeUndefined();
  });
  it('charges bounded arrival arrays and releases ownership while preserving original semantic previews', () => {
    const resources = new CaptureResources();
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} }, 0, resources);
    ctx.appendResponseBytes(Buffer.from('original'));
    expect(resources.snapshot().previewBytes).toBe((320 + 32 + 48) * 1024);
    expect(ctx.takeResponseTimeline()!.count).toBe(1);
    ctx.releaseRawPreviews(); expect(resources.snapshot().previewBytes).toBe(320 * 1024);
    ctx.releasePreviews(); ctx.releasePreviews(); expect(resources.snapshot().previewBytes).toBe(0);
    const limited = new CaptureResources({ previewBytes: 384 * 1024 });
    const next = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} }, 0, limited);
    next.appendResponseBytes(Buffer.from('not discarded'));
    expect(next.previewResourceLimited).toBe(false);
    expect(next.takeResponseTimeline()).toMatchObject({ count: 0, limited: true });
    expect(Buffer.from(next.takeBytePreviews().responseBytes).toString()).toBe('not discarded');
    next.releasePreviews(); expect(limited.snapshot().previewBytes).toBe(0);
  });
  it('bounds tiny arrival marks at4096 and clips only the Server-Timing projection', () => {
    let now = 0;
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} }, 0, undefined, () => now);
    now = 100; ctx.markResponseHeaders({ 'server-timing': 'x'.repeat(513) });
    for (let i = 0; i < 4097; i += 1) { now += 1; ctx.appendResponseBytes(Buffer.from('x')); }
    const timeline = ctx.takeResponseTimeline()!;
    expect(timeline.count).toBe(4096); expect(timeline.limited).toBe(true);
    expect(timeline.offsets.byteLength + timeline.elapsedMs.byteLength).toBe(49152);
    expect(timeline.offsets[4095]).toBe(4096); expect(ctx.streamedBody).toHaveLength(4097);
    expect(ctx.networkTiming()).toMatchObject({ responseHeadersMs: 100, firstBodyByteMs: 101, serverTiming: 'x'.repeat(512), serverTimingTruncated: true });
  });
  it('owns raw byte previews and consumes them once, independently from display decoding', () => {
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} });
    const source = Buffer.from([0xff, 0x00, 0xe4, 0xb8, 0xad]);
    const expected = Buffer.from(source);
    for (const byte of source) {
      ctx.appendRequestBytes(Buffer.from([byte])); ctx.appendResponseBytes(Buffer.from([byte]));
    }
    source.fill(0);
    const previews = ctx.takeBytePreviews();
    expect(Buffer.from(previews.requestBytes)).toEqual(expected);
    expect(Buffer.from(previews.responseBytes)).toEqual(expected);
    expect(ctx.takeBytePreviews()).toEqual({ requestBytes: new Uint8Array(), responseBytes: new Uint8Array() });
    expect(ctx.requestPreviewTruncated).toBe(false); expect(ctx.responsePreviewTruncated).toBe(false);
  });
  it('bounds raw bytes separately from display text and never invents a replacement at the preview cut', () => {
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} });
    // First byte of 中 lands at the final display byte; the original is complete.
    const bytes = Buffer.from('a'.repeat(64 * 1024 - 1) + '中' + 'b'.repeat(2 * 1024 * 1024));
    ctx.appendRequestBytes(bytes); ctx.appendResponseBytes(bytes);
    ctx.finishRequestBody(); ctx.finishResponseBody();
    expect(ctx.body).toBe('a'.repeat(64 * 1024 - 1));
    expect(ctx.streamedBody).toBe(ctx.body);
    expect(ctx.displayPreviewsTruncated).toEqual({ request: true, response: true });
    expect(ctx.requestPreviewTruncated).toBe(true); expect(ctx.responsePreviewTruncated).toBe(true);
    const previews = ctx.takeBytePreviews();
    expect(Buffer.from(previews.requestBytes)).toEqual(bytes.subarray(0, 2 * 1024 * 1024));
    expect(Buffer.from(previews.responseBytes)).toEqual(bytes.subarray(0, 2 * 1024 * 1024));
  });
  it('freezes transport end and monotonic duration before delayed processing or storage', async () => {
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'synthetic', headers: {}, startedAt: '2020-01-01T00:00:00.000Z' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const end = ctx.markTransportEnd();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(ctx.markTransportEnd()).toEqual(end);
    expect(ctx.completeRequest(200, '2099-01-01T00:00:00.000Z').durationMs).toBe(end.durationMs);
    expect(end.durationMs).toBeGreaterThanOrEqual(0); expect(end.durationMs).toBeLessThan(1000);
    expect(Number.isInteger(end.durationMs)).toBe(true);
    expect(new Date(end.completedAt).toISOString()).toBe(end.completedAt);
  });
  it('incremental byte decoding preserves split Chinese in both directions', () => {
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} });
    const bytes = Buffer.from('中文🙂');
    for (const byte of bytes) {
      ctx.appendRequestBytes(Buffer.from([byte]));
      ctx.appendResponseBytes(Buffer.from([byte]));
    }
    ctx.finishRequestBody(); ctx.finishResponseBody();
    ctx.finishRequestBody(); ctx.finishResponseBody();
    expect(ctx.body).toBe('中文🙂');
    expect(ctx.streamedBody).toBe('中文🙂');
  });

  it('returns only newly decoded bounded response text for the live producer', () => {
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} });
    const bytes = Buffer.from('中🙂');
    let emitted = '';
    for (const byte of bytes) emitted += ctx.appendResponseBytes(Buffer.from([byte]));
    expect(emitted).toBe('中🙂');
    expect(ctx.streamedBody).toBe(emitted);
    const remaining = 64 * 1024 - bytes.length;
    expect(ctx.appendResponseBytes(Buffer.from('a'.repeat(remaining) + 'b'))).toBe('a'.repeat(remaining));
    expect(ctx.appendResponseBytes(Buffer.from('ignored'))).toBe('');
    expect(ctx.displayPreviewsTruncated.response).toBe(true);
  });
  it('TTNet 头检测', () => {
    expect(new RequestContext({ method: 'POST', url: 'u', hostname: 'h', headers: { 'x-tt-encrypt-version': '2' } }).ttnetEncrypted).toBe(true);
    expect(new RequestContext({ method: 'POST', url: 'u', hostname: 'h', headers: { authorization: 'Bearer x' } }).ttnetEncrypted).toBe(false);
  });

  it('requestId 格式 req-{timestamp}-{counter}', () => {
    const ctx = new RequestContext({ method: 'GET', url: 'u', hostname: 'h', headers: {} }, 42);
    expect(ctx.requestId).toMatch(/^req-\d+-42$/);
  });

  it('chunk 累积 + completeRequest 计算 durationMs 与最终 body', () => {
    const ctx = new RequestContext(
      { method: 'POST', url: 'u', hostname: 'h', headers: {}, startedAt: '2026-08-01T00:00:00.000Z' },
      1,
    );
    ctx.appendChunk('data: {"a":1}\n\n');
    ctx.appendChunk('data: {"a":2}\n\n');
    const completed = ctx.completeRequest(200, '2026-08-01T00:00:02.000Z');
    expect(completed.durationMs).toBe(2000);
    expect(completed.body).toContain('{"a":2}');
    expect(ctx.responseStatus).toBe(200);
  });
});
