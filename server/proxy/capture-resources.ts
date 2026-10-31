import type { CaptureResourceStatus } from '../../src/core/trace-types.js';

type Lease = () => void;
/** Process-owned semantic allocations, not transport buffers or whole-process RSS. */
export class CaptureResources {
  readonly limits: { previewBytes: number; collectors: number; jobBytes: number; jobs: number; workers: number };
  private previewBytes = 0;
  private collectors = 0;
  private jobBytes = 0;
  private jobs = 0;
  private workers = 0;
  private previewLimitedRequests = 0;
  private processingRejectedRequests = 0;
  constructor(limits: Partial<CaptureResources['limits']> = {}) {
    this.limits = Object.freeze({ previewBytes: 32 * 1024 * 1024, collectors: 64, jobBytes: 32 * 1024 * 1024, jobs: 64, workers: 2, ...limits });
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new RangeError('Invalid global capture bound');
  }
  reservePreview(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid preview reservation');
    if (this.previewBytes + bytes > this.limits.previewBytes) return false;
    this.previewBytes += bytes; return true;
  }
  releasePreview(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.previewBytes) throw new RangeError('Invalid preview release');
    this.previewBytes -= bytes;
  }
  acquireCollector(): Lease | null {
    const fixed = 320 * 1024;
    if (this.collectors >= this.limits.collectors || !this.reservePreview(fixed)) return null;
    this.collectors += 1;
    return once(() => { this.collectors -= 1; this.releasePreview(fixed); });
  }
  acquireJob(bytes: number): Lease | null {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid job reservation');
    if (this.jobs >= this.limits.jobs || this.jobBytes + bytes > this.limits.jobBytes) return null;
    this.jobs += 1; this.jobBytes += bytes;
    return once(() => { this.jobs -= 1; this.jobBytes -= bytes; });
  }
  acquireWorker(): Lease | null {
    if (this.workers >= this.limits.workers) return null;
    this.workers += 1; return once(() => { this.workers -= 1; });
  }
  notePreviewLimit(): void { this.previewLimitedRequests += 1; }
  noteProcessingRejection(count = 1): void { this.processingRejectedRequests += count; }
  snapshot(): Omit<CaptureResourceStatus, 'sseClients' | 'slowSseDisconnects'> {
    return { previewBytes: this.previewBytes, previewLimitBytes: this.limits.previewBytes, previewCollectors: this.collectors, previewCollectorLimit: this.limits.collectors,
      queuedBytes: this.jobBytes, queuedByteLimit: this.limits.jobBytes, queuedJobs: this.jobs, queuedJobLimit: this.limits.jobs, workers: this.workers, workerLimit: this.limits.workers,
      previewLimitedRequests: this.previewLimitedRequests, processingRejectedRequests: this.processingRejectedRequests };
  }
}
function once(action: () => void): Lease { let released = false; return () => { if (!released) { released = true; action(); } }; }
export const captureResources = new CaptureResources();
