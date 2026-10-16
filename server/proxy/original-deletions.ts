import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { CaptureBodyRef, OriginalDeletionJob } from '../../src/core/trace-types.js';
import { PROXY_CAPTURE_TOMBSTONE_COLS, PROXY_ORIGINAL_DELETION_COLS, PROXY_ORIGINAL_REF_COLS, ORIGINAL_DELETION_STATUS_COLS } from '../storage/columns.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import type { CaptureBodyStore } from './body-store.js';
import { retryCaptureCommit } from './capture-journal.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = new Set(['complete', 'body_limit', 'quota_exceeded', 'queue_full', 'write_error', 'interrupted']);
const MAX_JOBS = 1024;
const activeRuns = new WeakMap<Database, { id: string; directory: string; task: Promise<OriginalDeletionJob> }>();
// Separate indexed arms prevent ANALYZE/tiny-table statistics from choosing a
// whole body-reference scan for the OR, and keep the large-store plan stable.
export const SHARED_ORIGINAL_SQL = `SELECT proxy_id FROM proxy_capture_bodies INDEXED BY idx_capture_request_original
  WHERE proxy_id<>:proxyId AND CASE WHEN json_valid(request_ref) THEN json_extract(request_ref,'$.id') END IN (:a,:b)
  UNION ALL SELECT proxy_id FROM proxy_capture_bodies INDEXED BY idx_capture_response_original
  WHERE proxy_id<>:proxyId AND CASE WHEN json_valid(response_ref) THEN json_extract(response_ref,'$.id') END IN (:a,:b) LIMIT 1`;
export const PENDING_ORIGINAL_DELETION_SQL = `SELECT id FROM proxy_original_deletions
  WHERE state='pending' ORDER BY created_at,id LIMIT 1`;

type JobRow = {
  id: string; proxy_id: number; request_id: string; request_ref: string; response_ref: string; store_directory: string;
  state: OriginalDeletionJob['state']; error: string | null; created_at: string; updated_at: string; completed_at: string | null;
};
export class OriginalDeletionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'OriginalDeletionError'; this.code = code; }
}
function fail(code: string): never { throw new OriginalDeletionError(code); }
function snapshot(value: CaptureBodyRef | null): CaptureBodyRef {
  if (value === null || !ID.test(value.id) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || !/^[0-9a-f]{64}$/.test(value.sha256)
    || !STATES.has(value.status) || !(value.error === null || (typeof value.error === 'string' && value.error.length <= 1024))) fail('CAPTURE_DELETE_INVALID_REF');
  const ref = { id: value.id, bytes: value.bytes, sha256: value.sha256, status: value.status, error: value.error };
  if (Buffer.byteLength(JSON.stringify(ref)) > 1536) fail('CAPTURE_DELETE_INVALID_REF');
  return ref;
}
function projection(row: Omit<JobRow, 'request_ref' | 'response_ref' | 'store_directory'>): OriginalDeletionJob {
  return { id: row.id, proxyId: row.proxy_id, requestId: row.request_id, state: row.state, error: row.error,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at };
}
/** Indexed metadata-only availability guard; never loads refs/path/body text. */
export function getOriginalDeletionForProxy(db: Database, proxyId: number): OriginalDeletionJob | null {
  const row = cachedStmt(db, `SELECT ${ORIGINAL_DELETION_STATUS_COLS} FROM proxy_original_deletions WHERE proxy_id=?`).get(proxyId) as Omit<JobRow, 'request_ref' | 'response_ref' | 'store_directory'> | undefined;
  return row === undefined ? null : projection(row);
}
function errorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return /^CAPTURE_(DELETE_[A-Z_]+|RECOVERY_[A-Z_]+|STORE_BUSY)$/.test(value) ? value : 'CAPTURE_DELETE_FAILED';
}

/** Confirmed body cleanup; caller owns the stopped-monitor/start exclusion lease.
 * Preserves headers/request/native metadata; not full request/forensic erasure. */
export class OriginalDeletionQueue {
  private readonly db: Database;
  private readonly store: CaptureBodyStore;
  constructor(db: Database, store: CaptureBodyStore) { this.db = db; this.store = store; }

  private row(id: string): JobRow | undefined {
    if (!ID.test(id)) fail('CAPTURE_DELETE_INVALID_ID');
    return cachedStmt(this.db, `SELECT ${PROXY_ORIGINAL_DELETION_COLS} FROM proxy_original_deletions WHERE id=?`).get(id) as JobRow | undefined;
  }
  get(id: string): OriginalDeletionJob | null { const row = this.row(id); return row === undefined ? null : projection(row); }
  private refs(proxyId: number): [CaptureBodyRef, CaptureBodyRef] {
    const row = cachedStmt(this.db, `SELECT ${PROXY_ORIGINAL_REF_COLS} FROM proxy_capture_bodies WHERE proxy_id=?`).get(proxyId) as { request_ref: string | null; response_ref: string | null } | undefined;
    try { return [snapshot(row?.request_ref == null ? null : JSON.parse(row.request_ref) as CaptureBodyRef), snapshot(row?.response_ref == null ? null : JSON.parse(row.response_ref) as CaptureBodyRef)]; }
    catch (error) { if (error instanceof SyntaxError) fail('CAPTURE_DELETE_INVALID_REF'); throw error; }
  }
  private assertUnshared(proxyId: number, a: string, b: string): void {
    if (cachedStmt(this.db, SHARED_ORIGINAL_SQL).get({ proxyId, a, b }) !== undefined) fail('CAPTURE_DELETE_SHARED_ORIGINAL');
  }
  private mark(requestId: string, a: string, b: string, now: string): void {
    cachedStmt(this.db, `INSERT INTO proxy_capture_tombstones (${PROXY_CAPTURE_TOMBSTONE_COLS})
      VALUES(?,?,?,?) ON CONFLICT(request_id,request_body_id,response_body_id) DO NOTHING`).run(requestId, a, b, now);
  }
  private clearBodyCopies(proxyId: number, requestId: string): void {
    cachedStmt(this.db, `UPDATE proxy_requests SET request_body=NULL,response_body=NULL,
      raw_request_body=NULL,raw_response_body=NULL,system_prompt=NULL,system_prompt_len=0
      WHERE id=? AND request_id=?`).run(proxyId, requestId);
  }

  /** Persists intent+exact tombstone atomically; performs NO original-file IO. */
  async request(proxyId: number, expectedRequestId: string): Promise<OriginalDeletionJob> {
    if (!Number.isSafeInteger(proxyId) || proxyId <= 0 || typeof expectedRequestId !== 'string' || expectedRequestId.length === 0 || expectedRequestId.length > 1024 || this.store.directory.length > 4096) fail('CAPTURE_DELETE_INVALID_ID');
    return retryCaptureCommit(this.db, () => this.db.transaction(() => {
      const request = cachedStmt(this.db, 'SELECT id,request_id FROM proxy_requests WHERE id=?').get(proxyId) as { id: number; request_id: string } | undefined;
      if (request?.request_id !== expectedRequestId) fail('CAPTURE_DELETE_CONFLICT');
      const [a, b] = this.refs(proxyId);
      this.assertUnshared(proxyId, a.id, b.id);
      const existing = cachedStmt(this.db, `SELECT ${PROXY_ORIGINAL_DELETION_COLS} FROM proxy_original_deletions WHERE proxy_id=?`).get(proxyId) as JobRow | undefined;
      if (existing !== undefined) {
        if (existing.store_directory !== this.store.directory) fail('CAPTURE_DELETE_STORE_MISMATCH');
        if (existing.request_id !== expectedRequestId || existing.request_ref !== JSON.stringify(a) || existing.response_ref !== JSON.stringify(b)) fail('CAPTURE_DELETE_CONFLICT');
        this.clearBodyCopies(proxyId, expectedRequestId);
        return projection(existing);
      }
      if ((cachedStmt(this.db, 'SELECT COUNT(*) AS n FROM proxy_original_deletions').get() as { n: number }).n >= MAX_JOBS) fail('CAPTURE_DELETE_LIMIT');
      const id = randomUUID(), now = new Date().toISOString();
      cachedStmt(this.db, `INSERT INTO proxy_original_deletions (${PROXY_ORIGINAL_DELETION_COLS}) VALUES(?,?,?,?,?,?,'pending',NULL,?,?,NULL)`)
        .run(id, proxyId, expectedRequestId, JSON.stringify(a), JSON.stringify(b), this.store.directory, now, now);
      this.mark(expectedRequestId, a.id, b.id, now);
      this.clearBodyCopies(proxyId, expectedRequestId);
      return projection(this.row(id)!);
    })());
  }

  /** One owned operation, no unbounded promise queue. Same-job callers share it. */
  run(id: string): Promise<OriginalDeletionJob> {
    const running = activeRuns.get(this.db);
    if (running !== undefined) return running.id === id && running.directory === this.store.directory ? running.task : Promise.reject(new OriginalDeletionError('CAPTURE_DELETE_BUSY'));
    const task = this.execute(id).finally(() => { activeRuns.delete(this.db); });
    activeRuns.set(this.db, { id, directory: this.store.directory, task }); return task;
  }
  private async execute(id: string): Promise<OriginalDeletionJob> {
    const row = this.row(id); if (row === undefined) fail('CAPTURE_DELETE_NOT_FOUND');
    if (row.state === 'complete') return projection(row);
    try {
      const a = snapshot(JSON.parse(row.request_ref) as CaptureBodyRef), b = snapshot(JSON.parse(row.response_ref) as CaptureBodyRef);
      await retryCaptureCommit(this.db, () => this.db.transaction(() => {
        const request = cachedStmt(this.db, 'SELECT id,request_id FROM proxy_requests WHERE id=?').get(row.proxy_id) as { request_id: string } | undefined;
        if (request !== undefined) {
          const [currentA, currentB] = this.refs(row.proxy_id);
          if (request.request_id !== row.request_id || JSON.stringify(currentA) !== row.request_ref || JSON.stringify(currentB) !== row.response_ref) fail('CAPTURE_DELETE_CONFLICT');
        }
        this.assertUnshared(row.proxy_id, a.id, b.id);
        this.mark(row.request_id, a.id, b.id, new Date().toISOString());
        this.clearBodyCopies(row.proxy_id, row.request_id);
      })());
      if (row.store_directory !== this.store.directory) fail('CAPTURE_DELETE_STORE_MISMATCH');
      // Verify both before the first unlink. Missing files are idempotent after
      // partial deletion/process interruption; changed bytes are not ours to guess.
      await this.store.recover(a.id, a); await this.store.recover(b.id, b);
      await this.store.removeOriginals([a.id, b.id]);
      await retryCaptureCommit(this.db, () => cachedStmt(this.db, `UPDATE proxy_original_deletions
        SET state='complete',error=NULL,updated_at=?,completed_at=? WHERE id=?`).run(new Date().toISOString(), new Date().toISOString(), id));
    } catch (error) {
      try {
        await retryCaptureCommit(this.db, () => cachedStmt(this.db, `UPDATE proxy_original_deletions
          SET state='failed',error=?,updated_at=?,completed_at=NULL WHERE id=?`).run(errorCode(error), new Date().toISOString(), id));
      } catch { fail('CAPTURE_DELETE_STATE_WRITE_FAILED'); }
    }
    return projection(this.row(id)!);
  }
  async resumePending(): Promise<void> {
    for (;;) {
      const row = cachedStmt(this.db, PENDING_ORIGINAL_DELETION_SQL).get() as { id: string } | undefined;
      if (row === undefined) return;
      await this.run(row.id);
    }
  }
}
