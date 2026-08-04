import type { Database } from 'better-sqlite3';

import type { FileFingerprint } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { fingerprintFile, fingerprintSqliteWithWal } from './fingerprint.js';

const SELECT_SCAN_STATE_SQL =
  `SELECT source_path, provider, session_id, file_size, file_mtime_ms, content_hash, ` +
  `byte_offset, last_scan_at, event_count FROM scan_state WHERE source_path = ?`;

const UPSERT_SCAN_STATE_SQL =
  `INSERT INTO scan_state (source_path, provider, session_id, file_size, file_mtime_ms, ` +
  `content_hash, byte_offset, last_scan_at, event_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
  `ON CONFLICT(source_path) DO UPDATE SET ` +
  `provider = excluded.provider, session_id = excluded.session_id, ` +
  `file_size = excluded.file_size, file_mtime_ms = excluded.file_mtime_ms, ` +
  `content_hash = excluded.content_hash, byte_offset = excluded.byte_offset, ` +
  `last_scan_at = excluded.last_scan_at, event_count = excluded.event_count`;

export interface ScanGateResult {
  changed: boolean;
  fp: FileFingerprint;
  prevOffset: number;
}

/**
 * REQ-001：详情读取前的增量门禁。判定未变更时返回 changed=false，
 * 调用方 MUST 直接返回：零文件读取之外不做任何 SQL 写入。
 * @param fpFn sqlite/sqlcipher 源传入 WAL 双文件指纹（G11.15）。
 */
export function shouldRescan(
  db: Database,
  sourcePath: string,
  fpFn: (path: string) => FileFingerprint = fingerprintFile,
): ScanGateResult {
  const fp = fpFn(sourcePath);
  const prev = cachedStmt(db, SELECT_SCAN_STATE_SQL).get(sourcePath) as
    | {
        file_size: number;
        file_mtime_ms: number;
        content_hash: string;
        byte_offset: number;
      }
    | undefined;

  if (prev === undefined) {
    return { changed: true, fp, prevOffset: 0 };
  }

  const changed =
    prev.file_size !== fp.size ||
    prev.file_mtime_ms !== fp.mtimeMs ||
    prev.content_hash !== fp.hash;
  return { changed, fp, prevOffset: prev.byte_offset };
}

/** sqlite / sqlcipher 源的门禁指纹（覆盖 -wal）。 */
export const sqliteFingerprint = fingerprintSqliteWithWal;

export interface CommitScanStateInput {
  sourcePath: string;
  provider: string;
  sessionId: string | null;
  fp: FileFingerprint;
  byteOffset: number;
  eventCount: number;
}

/**
 * REQ-003：每次成功详情扫描后调用。写入失败 MUST 抛错（G11.5），
 * 这里不 catch —— scan_state 为空会让增量扫描形同虚设。
 */
export function commitScanState(
  db: Database,
  input: CommitScanStateInput,
): void {
  cachedStmt(db, UPSERT_SCAN_STATE_SQL).run(
    input.sourcePath,
    input.provider,
    input.sessionId,
    input.fp.size,
    input.fp.mtimeMs,
    input.fp.hash,
    input.byteOffset,
    new Date().toISOString(),
    input.eventCount,
  );
}
