import type { Database } from 'better-sqlite3';
import type { TraceLogSession, TraceLogTurn, TraceLogPage } from '../../src/core/trace-types.js';
import { TraceImportError } from '../trace-import/format.js';
import type { ParsedTrace } from '../trace-import/format.js';
import { TRACE_LOG_IMPORT_COLS, TRACE_LOG_TURN_COLS } from './columns.js';
import { cachedStmt } from './stmt-cache.js';

interface ManifestRow { metadata_json: string; session_offset: number; session_length: number; session_sha256: string }
interface TurnRow { metadata_json: string; byte_offset: number; byte_length: number; body_sha256: string }
export function importManifest(db: Database, id: string): { session: TraceLogSession; offset: number; length: number; sha256: string } | null {
  const row = cachedStmt(db, `SELECT ${TRACE_LOG_IMPORT_COLS} FROM trace_log_imports WHERE id=?`).get(id) as ManifestRow | undefined;
  return row === undefined ? null : { session: JSON.parse(row.metadata_json) as TraceLogSession, offset: row.session_offset, length: row.session_length, sha256: row.session_sha256 };
}
export function importTurn(db: Database, id: string, sequence: number): TurnRow | null {
  return cachedStmt(db, `SELECT ${TRACE_LOG_TURN_COLS} FROM trace_log_turns WHERE import_id=? AND sequence=?`).get(id, sequence) as TurnRow | undefined ?? null;
}
export function listImports(db: Database, offset: number, limit: number): TraceLogPage<TraceLogSession> {
  const rows = cachedStmt(db, 'SELECT metadata_json FROM trace_log_imports ORDER BY imported_at DESC,id LIMIT ? OFFSET ?').all(limit + 1, offset) as { metadata_json: string }[];
  return { items: rows.slice(0, limit).map(row => JSON.parse(row.metadata_json) as TraceLogSession), offset, limit, hasMore: rows.length > limit };
}
export function listImportTurns(db: Database, id: string, offset: number, limit: number): TraceLogPage<TraceLogTurn> {
  const rows = cachedStmt(db, 'SELECT metadata_json FROM trace_log_turns WHERE import_id=? ORDER BY sequence LIMIT ? OFFSET ?').all(id, limit + 1, offset) as { metadata_json: string }[];
  return { items: rows.slice(0, limit).map(row => JSON.parse(row.metadata_json) as TraceLogTurn), offset, limit, hasMore: rows.length > limit };
}
export function commitImports(db: Database, entries: { session: TraceLogSession; trace: ParsedTrace }[]): void {
  const insertSession = cachedStmt(db, `INSERT INTO trace_log_imports (${TRACE_LOG_IMPORT_COLS}) VALUES(?,?,?,?,?,?)`);
  const insertTurn = cachedStmt(db, `INSERT INTO trace_log_turns (${TRACE_LOG_TURN_COLS}) VALUES(?,?,?,?,?,?)`);
  db.transaction(() => {
    const count = cachedStmt(db, 'SELECT COUNT(1) AS n FROM trace_log_imports').get() as { n: number };
    if (count.n + entries.length > 1024) throw new TraceImportError('TRACE_IMPORT_LIMIT');
    for (const { session, trace } of entries) {
      const metadata = JSON.stringify(session); if (Buffer.byteLength(metadata) > 4096) throw new TraceImportError('TRACE_IMPORT_LIMIT');
      insertSession.run(session.id, session.importedAt, metadata, trace.sessionOffset, trace.sessionLength, trace.sessionSha256);
      for (const turn of trace.turns) insertTurn.run(session.id, turn.metadata.sequence, JSON.stringify(turn.metadata), turn.offset, turn.length, turn.sha256);
    }
  })();
}
