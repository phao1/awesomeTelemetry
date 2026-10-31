import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from 'better-sqlite3';
import { buildTraceExport, stringifyTraceExport, TraceExportLimitError, TRACE_EXPORT_MAX_EVENTS, TRACE_EXPORT_MAX_OFFSET } from '../../src/core/trace-export.js';
import type { TraceExportPage, TraceExportEvent } from '../../src/core/trace-export.js';
import { EVENT_SLIM_COLS, SESSION_LIST_COLS } from '../storage/columns.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { sendApiError } from './error-envelope.js';
import { sendCompressedOrPlain } from './send-json.js';

// TX-003: narrower subsets of the frozen slim columns; no body CASE expressions.
const SESSION_COLUMNS = SESSION_LIST_COLS.split(', ').filter(column => ['id', 'provider', 'updated_at', 'detail_loaded', 'event_count'].includes(column)).join(', ');
const EVENT_COLUMNS = EVENT_SLIM_COLS.split(', ').filter(column => ['id', 'sequence', 'kind', 'phase', 'started_at', 'duration_ms', 'status'].includes(column)).join(', ');
const SESSION_SQL = `SELECT ${SESSION_COLUMNS}, duration_source FROM sessions WHERE id = ? AND data_source = 'scan'`;
const COUNT_SQL = 'SELECT COUNT(*) AS count FROM events WHERE session_id = ?';
const EVENTS_SQL = `SELECT ${EVENT_COLUMNS} FROM events WHERE session_id = ? ORDER BY sequence LIMIT ? OFFSET ?`;

type SessionRow = { id: string; provider: TraceExportPage['session']['provider']; updated_at: string; detail_loaded: number; event_count: number; duration_source: TraceExportPage['session']['durationSource'] };
type EventRow = Omit<TraceExportEvent, 'startedAt' | 'durationMs'> & { started_at: string; duration_ms: number };

export function traceExportIds(sessionKey: string): { traceId: string; spanId: (eventId: string) => string } {
  const digest = (parts: string[], size: number): string => {
    const hex = createHash('sha256').update(JSON.stringify(['awesome-telemetry.scan-export', 1, ...parts])).digest('hex').slice(0, size);
    return /^0+$/.test(hex) ? '0'.repeat(size - 1) + '1' : hex;
  };
  return { traceId: digest(['trace', sessionKey], 32), spanId: eventId => digest(['span', sessionKey, eventId], 16) };
}

/** Existing retained DB only. Never invoke getSessionDetail's lazy/large body path. */
export function readTraceExportPage(db: Database, key: string, offset: number, limit: number): TraceExportPage | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > TRACE_EXPORT_MAX_OFFSET || !Number.isSafeInteger(limit) || limit < 1 || limit > TRACE_EXPORT_MAX_EVENTS) throw new TraceExportLimitError();
  return db.transaction(() => {
    const session = cachedStmt(db, SESSION_SQL).get(key) as SessionRow | undefined;
    if (!session) return null;
    const count = cachedStmt(db, COUNT_SQL).get(key) as { count: number };
    const rows = cachedStmt(db, EVENTS_SQL).all(key, limit, offset) as EventRow[];
    return { session: { id: session.id, provider: session.provider, updatedAt: session.updated_at, durationSource: session.duration_source ?? 'unknown' },
      detailLoaded: Boolean(session.detail_loaded), declaredEventCount: session.event_count, eventTotal: count.count, offset, limit,
      events: rows.map(row => ({ id: row.id, sequence: row.sequence, kind: row.kind, phase: row.phase, startedAt: row.started_at, durationMs: row.duration_ms, status: row.status })) };
  })();
}

/** Register after existing local Host/Origin guard; synchronous read+serialize+send. */
export function handleTraceExport(req: IncomingMessage, res: ServerResponse, db: Database, sessionKey: string): void {
  res.setHeader('cache-control', 'no-store');
  const badRequest = (): void => sendApiError(res, 400, 'BAD_REQUEST', 'Invalid trace export query', undefined, req);
  const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
  if (req.method !== 'GET' || sessionKey.length === 0 || sessionKey.length > 1024) return badRequest();
  for (const key of query.keys()) {
    const value = query.get(key)!;
    if (!['offset', 'limit'].includes(key) || query.getAll(key).length !== 1 || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return badRequest();
  }
  const offset = Number(query.get('offset') ?? 0);
  const limit = Number(query.get('limit') ?? 100);
  if (offset > TRACE_EXPORT_MAX_OFFSET || limit < 1 || limit > TRACE_EXPORT_MAX_EVENTS) return badRequest();
  try {
    const page = readTraceExportPage(db, sessionKey, offset, limit);
    if (page === null) return sendApiError(res, 404, 'SESSION_NOT_FOUND', 'Native scan session not found', undefined, req);
    const ids = traceExportIds(sessionKey);
    const encoded = stringifyTraceExport(buildTraceExport(page, ids, new Date().toISOString()));
    sendCompressedOrPlain(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="scan-trace-${ids.traceId}-${offset}.otlp.json"` }, Buffer.from(encoded), req);
  } catch (error) {
    if (error instanceof TraceExportLimitError) return sendApiError(res, 503, 'EXECUTION_METADATA_LIMIT', 'Trace export exceeds bounded metadata limits', undefined, req);
    sendApiError(res, 500, 'INTERNAL_ERROR', 'Trace export could not read retained metadata', undefined, req);
  }
}
