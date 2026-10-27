import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { CaptureNetworkTiming, CaptureProcessingResult, NativeIdentitySet } from '../../src/core/trace-types.js';
import type { ParsedRequest } from './parser-router.js';
import { captureResources, type CaptureResources } from './capture-resources.js';
import { ARRIVAL_BYTES, ARRIVAL_POINT_LIMIT, type ResponseArrivalTimeline } from './network-timing.js';

export interface CaptureJob {
  evidenceFormat?: 'websocket_archive_v1';
  hostname: string;
  url: string;
  requestBody: string;
  responseBody: string | null;
  requestHeaders: Record<string, string | string[]>;
  responseHeaders: Record<string, string | string[]>;
  isStreaming: boolean;
  previewTruncated: boolean;
  requestBytes?: Uint8Array;
  responseBytes?: Uint8Array;
  requestTruncated?: boolean;
  responseTruncated?: boolean;
  timing?: CaptureNetworkTiming;
  responseTimeline?: ResponseArrivalTimeline;
}
export interface CaptureProjection {
  parsed: ParsedRequest;
  identities: NativeIdentitySet;
  processing: CaptureProcessingResult;
  workerThreadId: number;
  previews: { request: string | null; response: string | null; requestTruncated: boolean; responseTruncated: boolean };
  timing?: CaptureNetworkTiming;
}
export class CaptureProcessingError extends Error {
  readonly status: Exclude<CaptureProcessingResult['status'], 'ok' | 'preview_truncated'>;
  constructor(status: CaptureProcessingError['status']) { super(`CAPTURE_PROCESSING_${status.toUpperCase()}`); this.name = 'CaptureProcessingError'; this.status = status; }
}
interface PendingJob {
  id: number; bytes: number; input: CaptureJob;
  resolve: (value: CaptureProjection) => void; reject: (error: CaptureProcessingError) => void;
  timer: ReturnType<typeof setTimeout>;
  release: () => void;
}

function defaultWorkerPath(): string {
  // Compiled entry/chunks live together. Vitest source import.meta is HTTP;
  // exercise the real Node20-compatible built worker, not TS execution/mocks.
  if (import.meta.url.startsWith('file:') && !import.meta.url.endsWith('.ts')) return fileURLToPath(new URL('./capture-worker.js', import.meta.url));
  return join(process.cwd(), 'server-dist', 'capture-worker.js');
}

/** One bounded owned worker; rejection never runs the parser synchronously. */
export class CaptureProcessor {
  private worker: Worker | null = null;
  private readonly jobs = new Map<number, PendingJob>();
  private active: number | null = null;
  private next = 0;
  private bytes = 0;
  private closed = false;
  private readonly terminating = new Set<Promise<number>>();
  private readonly workerPath: string;
  private readonly maxJobs: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly resources: CaptureResources;
  private workerRelease: (() => void) | null = null;
  constructor(options: { workerPath?: string; maxJobs?: number; maxBytes?: number; timeoutMs?: number; resources?: CaptureResources } = {}) {
    this.resources = options.resources ?? captureResources;
    this.workerPath = options.workerPath ?? defaultWorkerPath();
    this.maxJobs = options.maxJobs ?? 64; this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024; this.timeoutMs = options.timeoutMs ?? 5000;
    if ([this.maxJobs, this.maxBytes, this.timeoutMs].some(value => !Number.isSafeInteger(value) || value <= 0)) throw new RangeError('Invalid capture processor bound');
  }

  status(): { jobs: number; bytes: number; closed: boolean } { return { jobs: this.jobs.size, bytes: this.bytes, closed: this.closed }; }

  submit(input: CaptureJob): Promise<CaptureProjection> {
    return this.enqueue(input, false);
  }

  /** Consume only explicitly relinquished dedicated byte/arrival arrays.
   * Ordinary callers retain the non-detaching submit() contract. */
  submitOwned(input: CaptureJob): Promise<CaptureProjection> {
    return this.enqueue(input, true);
  }

  private enqueue(input: CaptureJob, takeOwnership: boolean): Promise<CaptureProjection> {
    if (this.closed) return Promise.reject(new CaptureProcessingError('closed'));
    const requestBytes = Buffer.byteLength(input.requestBody) + (input.requestBytes?.byteLength ?? 0), responseBytes = Buffer.byteLength(input.responseBody ?? '') + (input.responseBytes?.byteLength ?? 0);
    const metadata = Buffer.byteLength(JSON.stringify([input.hostname, input.url, input.requestHeaders, input.responseHeaders, input.timing]));
    const arrivals = input.responseTimeline;
    const arrivalBytes = arrivals === undefined ? 0 : arrivals.offsets.byteLength + arrivals.elapsedMs.byteLength;
    const bytes = requestBytes + responseBytes + metadata + arrivalBytes;
    if (requestBytes > 2 * 1024 * 1024 || responseBytes > 2 * 1024 * 1024 || metadata > 64 * 1024 ||
      arrivalBytes > ARRIVAL_BYTES || arrivals !== undefined && (!Number.isSafeInteger(arrivals.count) || arrivals.count < 0 || arrivals.count > ARRIVAL_POINT_LIMIT || arrivals.count > arrivals.offsets.length || arrivals.count > arrivals.elapsedMs.length) ||
      this.jobs.size >= this.maxJobs || this.bytes + bytes > this.maxBytes) {
      this.resources.noteProcessingRejection(); return Promise.reject(new CaptureProcessingError('queue_full'));
    }
    const release = this.resources.acquireJob(bytes);
    if (release === null) { this.resources.noteProcessingRejection(); return Promise.reject(new CaptureProcessingError('queue_full')); }
    let owned: CaptureJob;
    try {
      if (takeOwnership) {
        const views = [input.requestBytes, input.responseBytes, arrivals?.offsets, arrivals?.elapsedMs].filter((view): view is Uint8Array | Uint32Array | Float64Array => view !== undefined);
        if (views.some(view => Buffer.isBuffer(view) || !(view.buffer instanceof ArrayBuffer) || view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength)) throw new TypeError('Dedicated capture arrays required');
        owned = structuredClone(input, { transfer: [...new Set(views.map(view => view.buffer as ArrayBuffer))] });
      } else owned = { ...input, requestBytes: input.requestBytes === undefined ? undefined : Uint8Array.from(input.requestBytes), responseBytes: input.responseBytes === undefined ? undefined : Uint8Array.from(input.responseBytes), requestHeaders: structuredClone(input.requestHeaders), responseHeaders: structuredClone(input.responseHeaders),
      timing: input.timing === undefined ? undefined : structuredClone(input.timing), responseTimeline: arrivals === undefined ? undefined : {
        offsets: Uint32Array.from(arrivals.offsets), elapsedMs: Float64Array.from(arrivals.elapsedMs), count: arrivals.count, limited: arrivals.limited,
      } };
    }
    catch { release(); this.resources.noteProcessingRejection(); return Promise.reject(new CaptureProcessingError('worker_error')); }
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => this.failAll('timeout'), this.timeoutMs); timer.unref();
      this.jobs.set(id, { id, bytes, input: owned, resolve, reject, timer, release }); this.bytes += bytes;
      this.pump();
    });
  }

  private pump(): void {
    if (this.closed || this.active !== null || this.jobs.size === 0 || this.terminating.size > 0) return;
    if (this.worker === null) {
      const releaseWorker = this.resources.acquireWorker();
      if (releaseWorker === null) { this.resources.noteProcessingRejection(this.jobs.size); this.failAll('queue_full'); return; }
      try {
        const worker = new Worker(this.workerPath, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
        this.worker = worker; this.workerRelease = releaseWorker;
        worker.on('message', (message: { id: number; result?: CaptureProjection; error?: string }) => {
          if (this.worker !== worker || message.id !== this.active) return;
          const job = this.jobs.get(message.id);
          if (job === undefined) return;
          this.jobs.delete(job.id); this.bytes -= job.bytes; clearTimeout(job.timer); job.release(); this.active = null;
          if (message.result !== undefined && message.result.workerThreadId > 0) job.resolve(message.result);
          else job.reject(new CaptureProcessingError(message.error === 'result_limit' ? 'result_limit' : 'worker_error'));
          this.pump();
        });
        worker.once('error', () => { if (this.worker === worker) this.failAll('worker_error'); });
        worker.once('exit', () => { if (this.worker === worker) this.failAll('worker_error'); });
      } catch { releaseWorker(); this.failAll('worker_error'); return; }
    }
    const job = this.jobs.values().next().value as PendingJob | undefined;
    if (job === undefined) return;
    this.active = job.id;
    try {
      const transfers: ArrayBuffer[] = [];
      if (job.input.requestBytes !== undefined) transfers.push(job.input.requestBytes.buffer as ArrayBuffer);
      if (job.input.responseBytes !== undefined) transfers.push(job.input.responseBytes.buffer as ArrayBuffer);
      if (job.input.responseTimeline !== undefined) transfers.push(job.input.responseTimeline.offsets.buffer as ArrayBuffer, job.input.responseTimeline.elapsedMs.buffer as ArrayBuffer);
      this.worker.postMessage({ id: job.id, input: job.input }, transfers);
    }
    catch { this.failAll('worker_error'); }
  }

  private failAll(status: CaptureProcessingError['status']): void {
    const worker = this.worker, active = this.active === null ? undefined : this.jobs.get(this.active), releaseWorker = this.workerRelease;
    this.worker = null; this.active = null; this.workerRelease = null;
    if (worker !== null) {
      const task = worker.terminate(); this.terminating.add(task);
      const finished = (): void => { active?.release(); releaseWorker?.(); this.terminating.delete(task); this.pump(); };
      void task.then(finished, finished);
    }
    for (const job of this.jobs.values()) { clearTimeout(job.timer); if (job !== active || worker === null) job.release(); job.reject(new CaptureProcessingError(status)); }
    this.jobs.clear(); this.bytes = 0;
  }

  async close(): Promise<void> {
    this.closed = true; this.failAll('closed');
    await Promise.all([...this.terminating]);
  }
}
