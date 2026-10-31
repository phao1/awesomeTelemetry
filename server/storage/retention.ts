import type { Database } from 'better-sqlite3';
import type { CaptureJournalEntry } from '../../src/core/trace-types.js';

import { checkpointWal } from './db.js';
import { cachedStmt } from './stmt-cache.js';
import { PROXY_CAPTURE_TOMBSTONE_COLS } from './columns.js';

const DEFAULT_PROXY_RETENTION_DAYS = 30;
const CHECKPOINT_THRESHOLD = 1000;

// contracts/database.md §6: helper default30, CLI default0; originals never expire implicitly.
const DELETE_OLD_PROXY_SQL =
  'DELETE FROM proxy_requests WHERE julianday(started_at) < julianday(:cutoff)';
const MARK_EXPIRED_SQL = `INSERT INTO proxy_capture_tombstones (${PROXY_CAPTURE_TOMBSTONE_COLS})
  SELECT p.request_id, json_extract(b.request_ref,'$.id'), json_extract(b.response_ref,'$.id'), :deletedAt
  FROM proxy_requests p JOIN proxy_capture_bodies b ON b.proxy_id=p.id
  WHERE julianday(p.started_at)<julianday(:cutoff)
    AND json_type(b.request_ref,'$.id')='text' AND json_type(b.response_ref,'$.id')='text'
  ON CONFLICT(request_id,request_body_id,response_body_id) DO NOTHING`;

/** Neither timestamp nor request ID alone authorizes discarding an observation. */
export function captureWasDeleted(db: Database, requestId: string, requestBodyId: string, responseBodyId: string): boolean {
  return cachedStmt(db, `SELECT ${PROXY_CAPTURE_TOMBSTONE_COLS} FROM proxy_capture_tombstones
    WHERE request_id=? AND request_body_id=? AND response_body_id=?`).get(requestId, requestBodyId, responseBodyId) !== undefined;
}

/** One immutable, SQLite-representable UTC cutoff; disabled policy performs no SQL. */
export function proxyRetentionCutoff(db: Database, retentionDays: number): string | null {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 0) throw new RangeError('Retention days must be a nonnegative safe integer');
  if (retentionDays === 0) {
    return null;
  }
  const instant = Date.now() - retentionDays * 86_400_000;
  if (!Number.isFinite(instant) || Math.abs(instant) > 8.64e15) throw new RangeError('Retention cutoff exceeds the supported timestamp range');
  const cutoff = new Date(instant).toISOString();
  const supported = cachedStmt(db, 'SELECT julianday(?) AS instant').get(cutoff) as { instant: number | null };
  if (supported.instant === null) throw new RangeError('Retention cutoff exceeds the supported timestamp range');
  return cutoff;
}

/** Called inside recovery's bounded nonblocking commit, never from forwarding. */
export function expireUncommittedCapture(
  db: Database,
  entry: Pick<CaptureJournalEntry, 'requestId' | 'requestBodyId' | 'responseBodyId' | 'startedAt'>,
  cutoff: string,
): boolean {
  return cachedStmt(db, `INSERT INTO proxy_capture_tombstones (${PROXY_CAPTURE_TOMBSTONE_COLS})
    SELECT :requestId,:requestBodyId,:responseBodyId,:deletedAt
    WHERE julianday(:startedAt)<julianday(:cutoff)
      AND NOT EXISTS (SELECT id FROM proxy_requests WHERE request_id=:requestId)
    ON CONFLICT(request_id,request_body_id,response_body_id) DO NOTHING`).run({
    ...entry, cutoff, deletedAt: new Date().toISOString(),
  }).changes > 0;
}

/** REQ-017：按保留天数清理过期 proxy_requests，返回删除行数。 Startup only. */
export function enforceProxyRetention(
  db: Database,
  retentionDays = DEFAULT_PROXY_RETENTION_DAYS,
): number {
  const now = Date.now(), cutoff = proxyRetentionCutoff(db, retentionDays);
  if (cutoff === null) return 0;
  const deleted = db.transaction(() => {
    cachedStmt(db, MARK_EXPIRED_SQL).run({ cutoff, deletedAt: new Date(now).toISOString() });
    return cachedStmt(db, DELETE_OLD_PROXY_SQL).run({ cutoff }).changes;
  })();
  if (deleted > CHECKPOINT_THRESHOLD) {
    checkpointWal(db);
  }
  return deleted;
}
