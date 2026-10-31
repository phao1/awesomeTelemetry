import { describe, expect, it } from 'vitest';
import { CaptureResources } from './capture-resources.js';
import { RequestContext } from './request-context.js';

describe('process-wide capture reservations', () => {
  it('bounds collectors/preview allocations, rejects excess and releases exactly once', () => {
    const pool = new CaptureResources({ collectors: 1, previewBytes: 384 * 1024 });
    const release = pool.acquireCollector()!;
    expect(pool.acquireCollector()).toBeNull();
    expect(pool.reservePreview(64 * 1024)).toBe(true);
    expect(pool.reservePreview(1)).toBe(false);
    pool.releasePreview(64 * 1024); release(); release();
    expect(pool.snapshot()).toMatchObject({ previewBytes: 0, previewCollectors: 0 });
    expect(() => pool.releasePreview(1)).toThrow(RangeError);
  });
  it('bounds shared job bytes/count and worker ownership including idempotent release', () => {
    const pool = new CaptureResources({ jobBytes: 32, jobs: 1, workers: 1 });
    expect(pool.acquireJob(33)).toBeNull();
    const release = pool.acquireJob(32)!, worker = pool.acquireWorker()!;
    expect(pool.acquireJob(1)).toBeNull(); expect(pool.acquireWorker()).toBeNull();
    expect(pool.snapshot()).toMatchObject({ queuedBytes: 32, queuedJobs: 1, workers: 1 });
    release(); release(); worker(); worker();
    expect(pool.snapshot()).toMatchObject({ queuedBytes: 0, queuedJobs: 0, workers: 0 });
  });
  it('evicts an exhausted collector, accounts both observed directions and permits a new collector', () => {
    const pool = new CaptureResources({ previewBytes: 352 * 1024 });
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} }, 0, pool);
    ctx.appendRequestBytes(Buffer.from('saved-prefix'));
    expect(pool.snapshot().previewBytes).toBe(352 * 1024);
    ctx.appendResponseBytes(Buffer.from('response')); // second block cannot be admitted
    ctx.appendRequestBytes(Buffer.from('tail'));
    expect(ctx.previewResourceLimited).toBe(true);
    expect(ctx.previewDroppedBytes).toEqual({ request: 16, response: 8 });
    expect(ctx.body).toBe(''); expect(ctx.streamedBody).toBe('');
    expect(ctx.takeBytePreviews().requestBytes.byteLength).toBe(0);
    ctx.releasePreviews(); ctx.releasePreviews();
    expect(pool.snapshot()).toMatchObject({ previewBytes: 0, previewCollectors: 0, previewLimitedRequests: 1 });
    const next = new RequestContext({ method: 'GET', url: '/', hostname: 'h', headers: {} }, 1, pool);
    expect(next.previewResourceLimited).toBe(false); next.releasePreviews();
  });
  it('keeps handoff-copy charges until ownership transfer and releases display charge separately', () => {
    const pool = new CaptureResources();
    const ctx = new RequestContext({ method: 'POST', url: '/', hostname: 'h', headers: {} }, 0, pool);
    ctx.appendRequestBytes(Buffer.from('中'));
    expect(ctx.takeBytePreviews().requestBytes).toEqual(new Uint8Array(Buffer.from('中')));
    expect(pool.snapshot().previewBytes).toBe(352 * 1024);
    ctx.releaseRawPreviews(); expect(pool.snapshot().previewBytes).toBe(320 * 1024);
    ctx.releasePreviews(); expect(pool.snapshot().previewBytes).toBe(0);
  });
  it('validates limits and never admits a collector when fixed overhead alone exceeds the budget', () => {
    expect(() => new CaptureResources({ jobs: 0 })).toThrow(RangeError);
    const pool = new CaptureResources({ previewBytes: 1 });
    const ctx = new RequestContext({ method: 'GET', url: '/', hostname: 'h', headers: {} }, 0, pool);
    ctx.appendRequestBytes(Buffer.from('original-only'));
    expect(ctx.previewResourceLimited).toBe(true); expect(ctx.previewDroppedBytes.request).toBe(13);
    expect(pool.snapshot()).toMatchObject({ previewBytes: 0, previewCollectors: 0, previewLimitedRequests: 1 });
  });
});
