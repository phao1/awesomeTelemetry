import { lstat } from 'node:fs/promises';
import type { Database } from 'better-sqlite3';
import type { CaptureMetadataCapacity } from '../../src/core/trace-types.js';
import { checkpointWal } from '../storage/db.js';
import { cachedStmt } from '../storage/stmt-cache.js';

const COMBINED_LIMIT = 200_000_000, WAL_LIMIT = 20_000_000;
const COMBINED_ADMISSION = 180_000_000, WAL_ADMISSION = 8_000_000, CHECKPOINT_AT = 8_000_000;
const SIMPLE_PRAGMA = { simple: true } as const;
const lanes = new WeakMap<Database, { tail: Promise<void>; count: number }>();
export class CaptureCapacityError extends Error {
  readonly code: 'CAPTURE_METADATA_LIMIT' | 'CAPTURE_METADATA_UNAVAILABLE' | 'CAPTURE_METADATA_QUEUE_FULL';
  constructor(code: CaptureCapacityError['code']) { super(code); this.code = code; this.name = 'CaptureCapacityError'; }
}
async function fileBytes(path: string, missing: boolean): Promise<number> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(info.size)) throw new Error('Invalid capacity file');
    return info.size;
  } catch (error) {
    if (missing && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}
/** Metadata-only, no checkpoint/recovery/write or native error/path disclosure. */
export async function readCaptureCapacity(db: Database): Promise<CaptureMetadataCapacity> {
  const common = { combinedLimitBytes: COMBINED_LIMIT, walLimitBytes: WAL_LIMIT, combinedAdmissionBytes: COMBINED_ADMISSION, walAdmissionBytes: WAL_ADMISSION };
  try {
    const [databaseBytes, walBytes] = db.memory
      ? [Number(db.pragma('page_count', { simple: true })) * Number(db.pragma('page_size', { simple: true })), 0]
      : await Promise.all([fileBytes(db.name, false), fileBytes(db.name + '-wal', true)]);
    const reason = databaseBytes + walBytes >= COMBINED_ADMISSION ? 'database_limit' : walBytes >= WAL_ADMISSION ? 'wal_limit' : null;
    return { ...common, databaseBytes, walBytes, state: reason === null ? 'ready' : 'limited', reason, checkedAt: new Date().toISOString() };
  } catch {
    return { ...common, databaseBytes: null, walBytes: null, state: 'unavailable', reason: 'stat_error', checkedAt: new Date().toISOString() };
  }
}

/** Connection writes and observed foreign commits invalidate async file stats. */
function writeStamp(db: Database): string {
  if (!db.open || db.inTransaction) throw new CaptureCapacityError('CAPTURE_METADATA_UNAVAILABLE');
  let timeout: number | null = null;
  try {
    // A cached PRAGMA getter/setter freezes effects at prepare time. The
    // read-only table-valued getter is dynamic; setters must execute fresh.
    timeout = (cachedStmt(db, 'SELECT timeout FROM pragma_busy_timeout').get() as { timeout: number }).timeout;
    db.pragma('busy_timeout = 0', SIMPLE_PRAGMA);
    const own = cachedStmt(db, 'SELECT total_changes() AS changes').get() as { changes: number };
    const schema = cachedStmt(db, 'PRAGMA schema_version').get() as { schema_version: number };
    const other = cachedStmt(db, 'PRAGMA data_version').get() as { data_version: number };
    return own.changes + ':' + schema.schema_version + ':' + other.data_version;
  } catch {
    throw new CaptureCapacityError('CAPTURE_METADATA_UNAVAILABLE');
  } finally { if (timeout !== null) db.pragma(`busy_timeout = ${timeout}`, SIMPLE_PRAGMA); }
}
/** Serialize check + synchronous capture mutation across every store/listener of one DB. */
export async function withCaptureCapacity<T>(db: Database, action: () => T): Promise<T> {
  if (!db.open || db.inTransaction) throw new CaptureCapacityError('CAPTURE_METADATA_UNAVAILABLE');
  let lane = lanes.get(db);
  if (lane === undefined) { lane = { tail: Promise.resolve(), count: 0 }; lanes.set(db, lane); }
  if (lane.count >= 64) throw new CaptureCapacityError('CAPTURE_METADATA_QUEUE_FULL');
  lane.count += 1;
  const task = lane.tail.then(async () => {
    let checkpointed = false;
    for (let snapshot = 0; snapshot < 3; snapshot += 1) {
      const before = writeStamp(db), status = await readCaptureCapacity(db);
      if (writeStamp(db) !== before) continue;
      if (!checkpointed && status.walBytes !== null && status.walBytes >= CHECKPOINT_AT) {
        checkpointWal(db); checkpointed = true; continue;
      }
      if (status.state !== 'ready') throw new CaptureCapacityError(status.state === 'limited' ? 'CAPTURE_METADATA_LIMIT' : 'CAPTURE_METADATA_UNAVAILABLE');
      return action();
    }
    throw new CaptureCapacityError('CAPTURE_METADATA_UNAVAILABLE');
  }).finally(() => { lane.count -= 1; });
  lane.tail = task.then(() => {}, () => {});
  return task;
}
