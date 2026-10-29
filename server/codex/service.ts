import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Database } from 'better-sqlite3';
import type { CodexCallPage, CodexCallDetail } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { readCaptureBodies } from '../proxy/capture-storage.js';
import { getOriginalDeletionForProxy } from '../proxy/original-deletions.js';
import { captureResources } from '../proxy/capture-resources.js';
import type { CaptureBodyStore } from '../proxy/body-store.js';
import { CodexInspectionError } from './archive.js';
import { liveCodexSource, type CodexSource } from './source.js';
import { nativeCodexLink } from './native-links.js';
import type { CodexProjection, CodexDiagnosisBatch } from './projector.js';
import { MAX_CODEX_CALLS } from './projector.js';

export type CodexSelector = { id: number } | { requestId: string };
export class CodexSourceAccessError extends Error {
  readonly code: 'BAD_REQUEST' | 'PROXY_REQUEST_NOT_FOUND' | 'CAPTURE_ORIGINALS_DELETED';
  constructor(code: CodexSourceAccessError['code']) { super(code); this.code = code; }
}
export function codexInteger(value: string | null | undefined, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (!/^(?:0|[1-9]\d{0,3})$/.test(value) || Number(value) > max) throw new CodexSourceAccessError('BAD_REQUEST');
  return Number(value);
}
export class CodexInspector {
  private closed = false;
  private running: Promise<CodexCallPage | CodexCallDetail | CodexDiagnosisBatch> | null = null;
  private abort: (() => void) | null = null;
  private readonly db: Database;
  private readonly getStore: () => Promise<CaptureBodyStore>;
  constructor(db: Database, getStore: () => Promise<CaptureBodyStore>) { this.db = db; this.getStore = getStore; }
  private inspect(selector: CodexSelector, directory: string): CodexSource {
    if ('requestId' in selector) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(selector.requestId)) throw new CodexSourceAccessError('BAD_REQUEST');
      const live = liveCodexSource(this.db, selector.requestId); if (live !== null) return live;
    }
    const row = cachedStmt(this.db, `SELECT id,request_id,method,started_at,request_headers FROM proxy_requests WHERE ${'id' in selector ? 'id' : 'request_id'}=?`)
      .get('id' in selector ? selector.id : selector.requestId) as { id: number; request_id: string; method: string; started_at: string; request_headers: string } | undefined;
    if (row === undefined) throw new CodexSourceAccessError('PROXY_REQUEST_NOT_FOUND');
    if (getOriginalDeletionForProxy(this.db, row.id) !== null) throw new CodexSourceAccessError('CAPTURE_ORIGINALS_DELETED');
    const capture = readCaptureBodies(this.db, row.id);
    if (row.method !== 'WS' || capture.request === null || capture.response === null || Buffer.byteLength(row.request_headers) > 64 * 1024) throw new CodexInspectionError('CODEX_SOURCE_UNAVAILABLE');
    return { proxyId: row.id, requestId: row.request_id, startedAt: row.started_at, active: false, directory,
      headers: JSON.parse(row.request_headers) as CodexSource['headers'], request: capture.request, response: capture.response };
  }
  read(selector: CodexSelector, options: { offset?: number; limit?: number; selected?: number }, signal?: AbortSignal): Promise<CodexCallPage | CodexCallDetail> {
    if (this.closed || this.running !== null) return Promise.reject(new CodexInspectionError('CODEX_INSPECTION_BUSY'));
    if (!Number.isSafeInteger(options.offset ?? 0) || (options.offset ?? 0) < 0 || (options.offset ?? 0) > MAX_CODEX_CALLS ||
      !Number.isSafeInteger(options.limit ?? 20) || (options.limit ?? 20) < 1 || (options.limit ?? 20) > 20 ||
      options.selected !== undefined && (!Number.isInteger(options.selected) || options.selected < 0 || options.selected >= MAX_CODEX_CALLS)) return Promise.reject(new CodexSourceAccessError('BAD_REQUEST'));
    const task = this.run(selector, options, signal) as Promise<CodexCallPage | CodexCallDetail>;
    this.running = task;
    const release = (): void => { if (this.running === task) this.running = null; };
    void task.then(release, release); return task;
  }
  /** One archive pass, at most32 logical calls; never one full archive read per call. */
  readDiagnosis(selector: CodexSelector, signal?: AbortSignal): Promise<CodexDiagnosisBatch> {
    if (this.closed || this.running !== null) return Promise.reject(new CodexInspectionError('CODEX_INSPECTION_BUSY'));
    const task = this.run(selector, { diagnosis: true }, signal) as Promise<CodexDiagnosisBatch>;
    this.running = task;
    const release = (): void => { if (this.running === task) this.running = null; };
    void task.then(release, release); return task;
  }
  private async run(selector: CodexSelector, options: { offset?: number; limit?: number; selected?: number; diagnosis?: boolean }, signal?: AbortSignal): Promise<CodexCallPage | CodexCallDetail | CodexDiagnosisBatch> {
    // A first synchronous deletion/identity check precedes filesystem admission.
    this.inspect(selector, '');
    const store = await this.getStore();
    const source = this.inspect(selector, store.directory);
    const fingerprint = createHash('sha256').update(JSON.stringify([1, source.requestId, source.startedAt, source.headers, source.request, source.response])).digest('hex');
    const releaseJob = captureResources.acquireJob(16 * 1024 * 1024), releaseWorker = releaseJob === null ? null : captureResources.acquireWorker();
    if (releaseJob === null || releaseWorker === null) { releaseJob?.(); throw new CodexInspectionError('CODEX_INSPECTION_BUSY'); }
    let worker: Worker | null = null;
    try {
      if (this.closed || signal?.aborted) throw new CodexInspectionError('CODEX_INSPECTION_FAILED');
      const path = import.meta.url.startsWith('file:') && !import.meta.url.endsWith('.ts')
        ? fileURLToPath(new URL('./codex-worker.js', import.meta.url)) : join(process.cwd(), 'server-dist', 'codex-worker.js');
      worker = new Worker(path, { execArgv: [], workerData: { source, selected: options.selected, window: { offset: options.offset, limit: options.limit, detailOnly: options.selected !== undefined || options.diagnosis === true, diagnosis: options.diagnosis } }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
      const result = await new Promise<CodexProjection>((resolve, reject) => {
        const abort = (): void => reject(new CodexInspectionError('CODEX_INSPECTION_FAILED'));
        this.abort = abort; signal?.addEventListener('abort', abort, { once: true });
        const deadline = setTimeout(() => reject(new CodexInspectionError('CODEX_INSPECTION_LIMIT')), 30000); deadline.unref();
        const cleanup = (): void => { clearTimeout(deadline); signal?.removeEventListener('abort', abort); if (this.abort === abort) this.abort = null; };
        worker!.once('message', (message: { result?: CodexProjection; error?: CodexInspectionError['code'] }) => {
          cleanup(); if (message.result !== undefined) resolve(message.result); else reject(new CodexInspectionError(message.error ?? 'CODEX_INSPECTION_FAILED'));
        });
        worker!.once('error', () => { cleanup(); reject(new CodexInspectionError('CODEX_INSPECTION_FAILED')); });
        worker!.once('exit', () => { cleanup(); reject(new CodexInspectionError('CODEX_INSPECTION_FAILED')); });
        if (signal?.aborted || this.closed) abort();
      });
      // Stop and release the worker BEFORE this final synchronous evidence guard.
      await worker.terminate(); worker = null;
      const latest = this.inspect(selector, store.directory);
      // Appends are allowed to an active prefix. Replacement/finalization is not.
      if (latest.requestId !== source.requestId || latest.active !== source.active || latest.request.id !== source.request.id || latest.response.id !== source.response.id ||
        !source.active && JSON.stringify([latest.request, latest.response]) !== JSON.stringify([source.request, source.response])) throw new CodexInspectionError('CODEX_SOURCE_CHANGED');
      if (options.diagnosis) {
        if (!result.diagnosis) throw new CodexInspectionError('CODEX_INSPECTION_FAILED');
        const diagnosis = { ...result.diagnosis, fingerprint };
        if (Buffer.byteLength(JSON.stringify(diagnosis)) > 4 * 1024 * 1024) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
        return diagnosis;
      }
      if (options.selected !== undefined) {
        if (result.detail === null) throw new CodexSourceAccessError('PROXY_REQUEST_NOT_FOUND');
        const detail = { ...result.detail, fingerprint, native: nativeCodexLink(this.db, result.detail.call, latest.proxyId) };
        if (Buffer.byteLength(JSON.stringify(detail)) > 1024 * 1024) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
        return detail;
      }
      const offset = options.offset ?? 0, limit = options.limit ?? 20;
      const page: CodexCallPage = { ...result.page, fingerprint, offset, limit, hasMore: offset + limit < result.page.total };
      if (Buffer.byteLength(JSON.stringify(page)) > 64 * 1024) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
      return page;
    } catch (error) {
      if (error instanceof CodexInspectionError || error instanceof CodexSourceAccessError) throw error;
      throw new CodexInspectionError('CODEX_INSPECTION_FAILED');
    } finally { if (worker !== null) await worker.terminate(); releaseWorker(); releaseJob(); }
  }
  async close(): Promise<void> { this.closed = true; this.abort?.(); await this.running?.catch(() => {}); }
}
