import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Database } from 'better-sqlite3';
import type { TraceLogSession, TraceLogImportResult, TraceLogTurnDetail } from '../../src/core/trace-types.js';
import type { CaptureBodyStore } from '../proxy/body-store.js';
import { retryCaptureCommit } from '../proxy/capture-journal.js';
import { commitImports, importManifest, importTurn } from '../storage/trace-import.js';
import { invalid, limit, object, TraceImportError } from './format.js';
import type { ParsedTrace } from './format.js';

const active = new WeakMap<Database, Promise<TraceLogImportResult>>();
function failure(error: unknown): TraceImportError { return error instanceof TraceImportError ? error : new TraceImportError('TRACE_IMPORT_FAILED'); }
function check(signal: AbortSignal): void { if (signal.aborted) throw new TraceImportError('TRACE_IMPORT_FAILED'); }
export function importId(value: string | undefined): string { if (value === undefined || !/^[0-9a-f]{64}$/.test(value)) invalid(); return value; }
export function importSequence(value: string | undefined): number { if (value === undefined || !/^(?:0|[1-9]\d{0,3})$/.test(value) || Number(value) >= 2000) invalid(); return Number(value); }
export function importPaging(url: URL, maxOffset: number): { offset: number; limit: number } {
  const offset = url.searchParams.get('offset') ?? '0', size = url.searchParams.get('limit') ?? '20';
  if (!/^\d{1,4}$/.test(offset) || !/^\d{1,2}$/.test(size) || Number(offset) > maxOffset || Number(size) < 1 || Number(size) > 20) invalid();
  return { offset: Number(offset), limit: Number(size) };
}
export function requireImport(db: Database, id: string): NonNullable<ReturnType<typeof importManifest>> {
  const manifest = importManifest(db, id); if (manifest === null) throw new TraceImportError('TRACE_IMPORT_NOT_FOUND'); return manifest;
}
function workerPath(): string {
  return import.meta.url.startsWith('file:') && !import.meta.url.endsWith('.ts')
    ? fileURLToPath(new URL('./trace-import-worker.js', import.meta.url)) : join(process.cwd(), 'server-dist', 'trace-import-worker.js');
}
async function parseInWorker(path: string, directory: string, archive: boolean, signal: AbortSignal): Promise<{ traces: ParsedTrace[]; ignoredEntries: number }> {
  check(signal);
  const worker = new Worker(workerPath(), { workerData: { path, directory, archive }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
  try {
    return await new Promise((resolve, reject) => {
      const abort = (): void => reject(new TraceImportError('TRACE_IMPORT_FAILED'));
      signal.addEventListener('abort', abort, { once: true });
      worker.once('message', (message: { ok: boolean; traces: ParsedTrace[]; ignoredEntries: number; code: TraceImportError['code'] }) => {
        signal.removeEventListener('abort', abort);
        if (message.ok) resolve({ traces: message.traces, ignoredEntries: message.ignoredEntries });
        else reject(new TraceImportError(message.code));
      });
      worker.once('error', () => { signal.removeEventListener('abort', abort); reject(new TraceImportError('TRACE_IMPORT_FAILED')); });
      worker.once('exit', () => { signal.removeEventListener('abort', abort); reject(new TraceImportError('TRACE_IMPORT_FAILED')); });
      if (signal.aborted) abort();
    });
  } finally { await worker.terminate(); }
}

/** Owns only uploads/workers/copies, not user originals or upstream Agent work. */
export class TraceLogImporter {
  private readonly db: Database;
  private readonly getStore: () => Promise<CaptureBodyStore>;
  private readonly controllers = new Set<AbortController>();
  private readonly tasks = new Set<Promise<TraceLogImportResult>>();
  private closed = false;
  constructor(db: Database, getStore: () => Promise<CaptureBodyStore>) { this.db = db; this.getStore = getStore; }

  import(source: Readable, filename: string, external?: AbortSignal): Promise<TraceLogImportResult> {
    if (this.closed || active.has(this.db)) return Promise.reject(new TraceImportError('TRACE_IMPORT_BUSY'));
    const controller = new AbortController(); this.controllers.add(controller);
    const abort = (): void => { controller.abort(); };
    external?.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, 120000); deadline.unref();
    const task = Promise.resolve().then(() => { if (external?.aborted) abort(); return this.run(source, filename, controller.signal); }).catch(error => { throw failure(error); });
    active.set(this.db, task); this.tasks.add(task);
    const release = (): void => {
      clearTimeout(deadline); external?.removeEventListener('abort', abort); this.controllers.delete(controller); this.tasks.delete(task);
      if (active.get(this.db) === task) active.delete(this.db);
    };
    void task.then(release, release); return task;
  }
  private async run(source: Readable, filename: string, signal: AbortSignal): Promise<TraceLogImportResult> {
    if (typeof filename !== 'string' || filename.length < 1 || filename.length > 512 || basename(filename) !== filename || [...filename].some(char => char.charCodeAt(0) < 32 || char === '\\') || !/\.(?:json|gz|tgz)$/i.test(filename)) invalid();
    check(signal);
    const directory = await mkdtemp(join(tmpdir(), 'awesome-tracelog-'));
    try {
      const path = join(directory, 'upload'), file = await open(path, 'wx', 0o600);
      const abort = (): void => { source.destroy(new TraceImportError('TRACE_IMPORT_FAILED')); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        check(signal);
        let bytes = 0;
        for await (const value of source.iterator({ destroyOnReturn: false })) {
          check(signal); const part = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
          bytes += part.length; if (bytes > 128 * 1024 * 1024) limit();
          let offset = 0; while (offset < part.length) { check(signal); const count = (await file.write(part, offset, part.length - offset)).bytesWritten; if (count === 0) throw new TraceImportError('TRACE_IMPORT_FAILED'); offset += count; }
        }
        if (bytes === 0) invalid();
      } finally { signal.removeEventListener('abort', abort); await file.close(); }
      check(signal);
      const parsed = await parseInWorker(path, directory, !/\.json$/i.test(filename), signal); check(signal);
      const store = await this.getStore(); check(signal);
      const items: TraceLogImportResult['items'] = [], entries: { session: TraceLogSession; trace: ParsedTrace }[] = [], known = new Map<string, TraceLogSession>();
      for (const trace of parsed.traces) {
        check(signal);
        const previous = known.get(trace.sha256) ?? importManifest(this.db, trace.sha256)?.session;
        if (previous !== undefined) { items.push({ state: 'duplicate', session: previous }); continue; }
        const writer = store.begin(); let complete = false;
        try {
          const size = Math.min(64 * 1024, store.status().maxPendingBytes); if (size < 1) limit();
          for await (const chunk of createReadStream(trace.path, { highWaterMark: size, signal })) {
            check(signal);
            while (store.status().pendingBytes > 0) { await delay(1, undefined, { signal }); }
            if (!writer.append(chunk as Buffer)) limit();
          }
          const ref = await writer.finish(); complete = true; check(signal);
          if (ref.status !== 'complete' || ref.bytes !== trace.bytes || ref.sha256 !== trace.sha256) throw new TraceImportError('TRACE_IMPORT_FAILED');
          const session: TraceLogSession = { id: trace.sha256, fileName: filename, sourceMember: trace.member, importedAt: new Date().toISOString(), source: ref, ...trace.metadata, turnCount: trace.turns.length };
          if (Buffer.byteLength(JSON.stringify(session)) > 4096) limit();
          entries.push({ session, trace }); known.set(session.id, session); items.push({ state: 'imported', session });
        } finally { if (!complete) await writer.finish(true, 'TRACE_IMPORT_FAILED'); }
      }
      if (entries.length > 0) await retryCaptureCommit(this.db, () => { check(signal); commitImports(this.db, entries); }, true);
      return { items, ignoredEntries: parsed.ignoredEntries };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async detail(id: string, sequence: number, signal?: AbortSignal): Promise<TraceLogTurnDetail> {
    const manifest = requireImport(this.db, id), turn = importTurn(this.db, id, sequence);
    if (turn === null) throw new TraceImportError('TRACE_IMPORT_NOT_FOUND');
    let store: CaptureBodyStore;
    try { store = await this.getStore(); } catch { throw new TraceImportError('TRACE_IMPORT_FAILED'); }
    const read = async (offset: number, length: number, max: number, sha?: string): Promise<Record<string, unknown>> => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 2 || length > max || offset + length > manifest.session.source.bytes) throw new TraceImportError('TRACE_IMPORT_FAILED');
      const stream = store.openRead(manifest.session.source.id, { start: offset, end: offset + length - 1 });
      const abort = (): void => { stream.destroy(new TraceImportError('TRACE_IMPORT_FAILED')); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) abort();
        const parts: Buffer[] = []; let count = 0;
        for await (const bytes of stream) { count += (bytes as Buffer).length; if (count > max) throw new TraceImportError('TRACE_IMPORT_FAILED'); parts.push(bytes as Buffer); }
        const bytes = Buffer.concat(parts, count);
        if (count !== length || sha !== undefined && createHash('sha256').update(bytes).digest('hex') !== sha) throw new TraceImportError('TRACE_IMPORT_FAILED');
        return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
      } finally { signal?.removeEventListener('abort', abort); stream.destroy(); }
    };
    try {
      const session = await read(manifest.offset, manifest.length, 64 * 1024, manifest.sha256);
      const raw = await read(turn.byte_offset, turn.byte_length, 2 * 1024 * 1024, turn.body_sha256);
      return { sessionId: id, sequence, session, raw };
    } catch { throw new TraceImportError('TRACE_IMPORT_FAILED'); }
  }
  async close(): Promise<void> {
    this.closed = true; for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
}
