import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, opendir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldImmediate, setTimeout as delay } from 'node:timers/promises';
import type { Database } from 'better-sqlite3';
import type { CaptureJournalEntry } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { captureWasDeleted, expireUncommittedCapture, proxyRetentionCutoff } from '../storage/retention.js';
import type { CaptureBodyStore } from './body-store.js';
import { readCaptureBodies, writeCaptureBodies } from './capture-storage.js';
import { writeRecoveredCapture } from './proxy-writer.js';
import { withCaptureCapacity } from './capture-capacity.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE = 256 * 1024, MAX_DISK = 16 * 1024 * 1024, MAX_PENDING = 4 * 1024 * 1024;
const managers = new WeakMap<Database, Map<string, Promise<CaptureJournal>>>();
function code(error: unknown): string | undefined { return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined; }
export class CaptureJournalError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'CaptureJournalError'; }
}

/** Only the synchronous transaction temporarily bypasses SQLite's blocking busy handler. */
export async function retryCaptureCommit<T>(db: Database, action: () => T, capacity = false): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await yieldImmediate();
    const execute = (): T => {
      const timeout = db.pragma('busy_timeout', { simple: true }) as number;
      try { db.pragma('busy_timeout = 0'); return action(); }
      finally { db.pragma(`busy_timeout = ${timeout}`); }
    };
    try {
      return capacity ? await withCaptureCapacity(db, execute) : execute();
    } catch (error) {
      const value = code(error);
      if (attempt >= 2 || (value !== 'SQLITE_BUSY' && value !== 'SQLITE_LOCKED')) throw error;
    }
    await delay(attempt === 0 ? 10 : 40);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function headers(value: unknown, arrays: boolean): boolean {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string' || (arrays && Array.isArray(item) && item.every(part => typeof part === 'string')));
}
function validEntry(value: unknown): value is CaptureJournalEntry {
  if (!isRecord(value) || value.version !== 1) return false;
  for (const key of ['ownerId', 'captureId', 'requestBodyId', 'responseBodyId']) if (typeof value[key] !== 'string' || !ID.test(value[key])) return false;
  for (const key of ['requestId', 'method', 'url', 'hostname', 'startedAt']) if (typeof value[key] !== 'string') return false;
  if (!Number.isFinite(Date.parse(String(value.startedAt))) || !headers(value.requestHeaders, true) || !headers(value.responseHeaders, true)) return false;
  if (typeof value.requestEnded !== 'boolean' || typeof value.responseEnded !== 'boolean' || !(value.captureGroupId === null || typeof value.captureGroupId === 'string')) return false;
  if (!(value.completedAt === null || (typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)))) || !(value.durationMs === null || (Number.isSafeInteger(value.durationMs) && Number(value.durationMs) >= 0))) return false;
  if (!(value.responseStatus === null || (Number.isInteger(value.responseStatus) && Number(value.responseStatus) >= 100 && Number(value.responseStatus) <= 599))) return false;
  for (const direction of ['request', 'response'] as const) {
    const ref = value[direction + 'Ref'];
    if (ref !== null && (!isRecord(ref) || ref.id !== value[direction + 'BodyId'] || !Number.isSafeInteger(ref.bytes) || Number(ref.bytes) < 0 || typeof ref.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ref.sha256) || !['complete', 'body_limit', 'quota_exceeded', 'queue_full', 'write_error', 'interrupted'].includes(String(ref.status)) || !(ref.error === null || typeof ref.error === 'string'))) return false;
  }
  const transport = value.transport;
  return transport === null || (isRecord(transport) && transport.version === 1 && ['completed', 'http_error', 'network_error', 'timeout', 'cancelled', 'interrupted'].includes(String(transport.state)) && typeof transport.requestEnded === 'boolean' && typeof transport.responseEnded === 'boolean' && transport.statusCode === value.responseStatus && (transport.error === null || typeof transport.error === 'string'));
}

/** Request ID alone cannot authorize deduplication or delete another request's journal. */
export function committedCaptureId(db: Database, entry: CaptureJournalEntry): number | null {
  const row = cachedStmt(db, 'SELECT id FROM proxy_requests WHERE request_id = ?').get(entry.requestId) as { id: number } | undefined;
  if (row === undefined) return null;
  const refs = readCaptureBodies(db, row.id);
  if (refs.request?.id !== entry.requestBodyId || refs.response?.id !== entry.responseBodyId) throw new CaptureJournalError('CAPTURE_RECOVERY_CONFLICT');
  return row.id;
}

type Patch = Partial<Pick<CaptureJournalEntry, 'requestEnded' | 'responseEnded' | 'responseStatus' | 'responseHeaders' | 'completedAt' | 'durationMs' | 'transport' | 'requestRef' | 'responseRef'>>;
export class CaptureJournalTicket {
  entry: CaptureJournalEntry;
  readonly ready: Promise<void>;
  private running: Promise<void> | null = null;
  private pending = false;
  private admit!: () => void;
  private rejectAdmission!: (error: unknown) => void;
  private readonly journal: CaptureJournal;
  constructor(journal: CaptureJournal, entry: CaptureJournalEntry) {
    this.journal = journal; this.entry = entry;
    this.ready = new Promise<void>((resolve, reject) => { this.admit = resolve; this.rejectAdmission = reject; });
    void this.schedule();
  }
  update(patch: Patch): Promise<void> {
    this.entry = { ...this.entry, ...patch }; return this.schedule();
  }
  private schedule(): Promise<void> {
    this.pending = true;
    if (this.running !== null) return this.running;
    const task = this.journal.enqueue(async () => {
      while (this.pending) { this.pending = false; await this.journal.persist(this.entry); this.admit(); }
    });
    this.running = task;
    void task.then(() => { this.running = null; }, error => { this.running = null; this.rejectAdmission(error); });
    return task;
  }
  async remove(): Promise<void> { await this.running?.catch(() => {}); await this.journal.remove(this.entry.captureId); }
}

/** One manager for each DB/store owner. Internal metadata, never a second body spool. */
export class CaptureJournal {
  readonly directory: string;
  readonly ownerId: string;
  readonly store: CaptureBodyStore;
  private sizes = new Map<string, number>();
  private diskBytes = 0;
  private queued = 0;
  private pendingBytes = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly db: Database;
  private constructor(db: Database, ownerId: string, store: CaptureBodyStore) { this.db = db; this.ownerId = ownerId; this.store = store; this.directory = join(store.directory, '.capture-journal'); }

  static open(db: Database, store: CaptureBodyStore): Promise<CaptureJournal> {
    let perDb = managers.get(db); if (perDb === undefined) { perDb = new Map(); managers.set(db, perDb); }
    const existing = perDb.get(store.directory); if (existing !== undefined) return existing;
    const task = (async () => {
      const ownerId = await retryCaptureCommit(db, () => db.transaction(() => {
        cachedStmt(db, 'INSERT INTO _meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING').run('capture_journal_owner', randomUUID());
        return (cachedStmt(db, 'SELECT value FROM _meta WHERE key = ?').get('capture_journal_owner') as { value: string }).value;
      })());
      if (!ID.test(ownerId)) throw new CaptureJournalError('CAPTURE_RECOVERY_OWNER_INVALID');
      const journal = new CaptureJournal(db, ownerId, store); await mkdir(journal.directory, { recursive: true, mode: 0o700 });
      for await (const item of await opendir(journal.directory)) if (item.isFile()) { const bytes = (await stat(join(journal.directory, item.name))).size; journal.sizes.set(item.name, bytes); journal.diskBytes += bytes; }
      return journal;
    })();
    perDb.set(store.directory, task); void task.catch(() => perDb?.delete(store.directory)); return task;
  }
  begin(input: Omit<CaptureJournalEntry, 'version' | 'ownerId' | 'captureId'>): CaptureJournalTicket {
    return new CaptureJournalTicket(this, { ...input, version: 1, ownerId: this.ownerId, captureId: randomUUID() });
  }
  drain(): Promise<void> { return this.tail; }
  /** Ticket updates coalesce into one reserved job/latest snapshot, never hidden promise queues. */
  enqueue(action: () => Promise<void>): Promise<void> {
    if (this.queued >= 64) return Promise.reject(new CaptureJournalError('CAPTURE_JOURNAL_LIMIT'));
    this.queued += 1;
    const task = this.tail.then(async () => { await yieldImmediate(); await action(); }).finally(() => { this.queued -= 1; });
    this.tail = task.catch(() => {}); return task;
  }
  write(entry: CaptureJournalEntry): Promise<void> {
    return this.enqueue(() => this.persist(entry));
  }
  /** Only called inside an admitted serialized job. */
  async persist(entry: CaptureJournalEntry): Promise<void> {
      const text = JSON.stringify(entry), bytes = Buffer.byteLength(text), name = entry.captureId + '.json';
      if (!validEntry(entry) || entry.ownerId !== this.ownerId) throw new CaptureJournalError('CAPTURE_JOURNAL_INVALID');
      if (bytes > MAX_FILE || this.pendingBytes + bytes > MAX_PENDING || this.diskBytes - (this.sizes.get(name) ?? 0) + bytes > MAX_DISK) throw new CaptureJournalError('CAPTURE_JOURNAL_LIMIT');
      if (!this.sizes.has(name)) await withCaptureCapacity(this.db, () => {});
      this.pendingBytes += bytes;
      const scratch = join(this.directory, entry.captureId + '-' + randomUUID() + '.tmp');
      try {
        const file = await open(scratch, 'wx', 0o600);
        try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
        await rename(scratch, join(this.directory, name));
        this.diskBytes += bytes - (this.sizes.get(name) ?? 0); this.sizes.set(name, bytes);
      } finally {
        this.pendingBytes -= bytes;
        await unlink(scratch).catch((error: unknown) => { if (code(error) !== 'ENOENT') throw new CaptureJournalError('CAPTURE_JOURNAL_SCRATCH_FAILED'); });
      }
  }
  remove(id: string): Promise<void> {
    if (!ID.test(id)) return Promise.reject(new CaptureJournalError('CAPTURE_JOURNAL_INVALID'));
    return this.enqueue(async () => {
      const name = id + '.json';
      await unlink(join(this.directory, name)).catch((error: unknown) => { if (code(error) !== 'ENOENT') throw new CaptureJournalError('CAPTURE_JOURNAL_CLEANUP_FAILED'); });
      this.diskBytes -= this.sizes.get(name) ?? 0; this.sizes.delete(name);
    });
  }
  /** Startup only. Original-file IO precedes one bounded transaction; no parsing or upstream replay. */
  async recover(db: Database, retentionDays = 0): Promise<number> {
    const cutoff = proxyRetentionCutoff(db, retentionDays);
    let recovered = 0;
    for await (const item of await opendir(this.directory)) {
      if (!ID.test(item.name.replace(/\.json$/, '')) || !item.name.endsWith('.json')) continue;
      if (!item.isFile() || item.isSymbolicLink()) throw new CaptureJournalError('CAPTURE_RECOVERY_CONFLICT');
      const file = await open(join(this.directory, item.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let value: unknown;
      try {
        const buffer = Buffer.alloc(MAX_FILE + 1); let count = 0;
        while (count < buffer.length) { const { bytesRead } = await file.read(buffer, count, buffer.length - count); if (bytesRead === 0) break; count += bytesRead; }
        if (count > MAX_FILE) throw new CaptureJournalError('CAPTURE_JOURNAL_LIMIT');
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count)));
      } catch { throw new CaptureJournalError('CAPTURE_RECOVERY_INVALID'); } finally { await file.close(); }
      if (!isRecord(value) || typeof value.ownerId !== 'string') throw new CaptureJournalError('CAPTURE_RECOVERY_INVALID');
      if (value.ownerId !== this.ownerId) continue;
      if (!validEntry(value) || item.name !== value.captureId + '.json') throw new CaptureJournalError('CAPTURE_RECOVERY_INVALID');
      const entry = value;
      // Deletion intent survives cascades, but never discards different/old-clock evidence.
      if (captureWasDeleted(db, entry.requestId, entry.requestBodyId, entry.responseBodyId)) { await this.remove(entry.captureId); continue; }
      if (committedCaptureId(db, entry) !== null) { await this.remove(entry.captureId); continue; }
      // Expire this uncommitted identity now under explicit current policy. No
      // graph/body materialization or large cascading DELETE on the HTTP thread.
      if (cutoff !== null && await retryCaptureCommit(db, () => expireUncommittedCapture(db, entry, cutoff))) {
        await this.remove(entry.captureId); continue;
      }
      const request = await this.store.recover(entry.requestBodyId, entry.requestRef), response = await this.store.recover(entry.responseBodyId, entry.responseRef);
      await retryCaptureCommit(db, () => db.transaction(() => {
        if (committedCaptureId(db, entry) !== null) return;
        const id = writeRecoveredCapture(db, entry);
        writeCaptureBodies(db, id, { request, response, requestPreviewTruncated: true, responsePreviewTruncated: true, responseHeaders: entry.responseHeaders,
          processing: { version: 1, status: 'closed', error: 'CAPTURE_PROCESSING_CLOSED' },
          transport: entry.transport ?? { version: 1, state: 'interrupted', error: 'CAPTURE_PROCESS_LOST', requestEnded: entry.requestEnded, responseEnded: entry.responseEnded, statusCode: entry.responseStatus } });
      })(), true);
      await this.remove(entry.captureId); recovered += 1; await yieldImmediate();
    }
    return recovered;
  }
}
