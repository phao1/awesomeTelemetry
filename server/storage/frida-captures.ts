import type { Database } from 'better-sqlite3';
import type { FridaCapture } from '../../src/core/trace-types.js';
import { FRIDA_JSON_BYTES, type FridaCaptureData } from '../proxy/frida-capture.js';
import { cachedStmt } from './stmt-cache.js';

// database §3.8; no Frida column constant exists in the shared §5.2 module.
export const FRIDA_METADATA_COLS = 'id, pid, captured_at, capture_type, model, session_id, capture_session_id, message_count';
export const FRIDA_DETAIL_COLS = `${FRIDA_METADATA_COLS}, json_data, tokens_json`;
const METADATA_BOUNDS = "length(CAST(COALESCE(tokens_json, '') AS BLOB)) <= 4096 AND length(CAST(capture_type AS BLOB)) <= 1024 AND length(CAST(COALESCE(model, '') AS BLOB)) <= 1024 AND length(CAST(COALESCE(session_id, '') AS BLOB)) <= 1024 AND length(CAST(COALESCE(capture_session_id, '') AS BLOB)) <= 1024 AND length(captured_at) <= 32";
const BOUNDS = `length(CAST(json_data AS BLOB)) <= 262144 AND ${METADATA_BOUNDS}`;
export class FridaStoreError extends Error {
  readonly reason: 'invalid' | 'limit';
  constructor(reason: FridaStoreError['reason']) { super(`Frida capture ${reason}`); this.reason = reason; }
}
type Row = { id: number; pid: number; captured_at: string; capture_type: string; json_data: string; model: string | null; session_id: string | null; capture_session_id: string | null; message_count: number | null; tokens_json: string | null };
function map(row: Row): FridaCapture {
  if (!Number.isFinite(Date.parse(row.captured_at)) || new Date(row.captured_at).toISOString() !== row.captured_at) throw new Error('Invalid retained Frida timestamp');
  return { id: row.id, pid: row.pid, capturedAt: row.captured_at, captureType: row.capture_type, jsonData: row.json_data, model: row.model, sessionId: row.session_id, captureSessionId: row.capture_session_id, messageCount: row.message_count, tokens: row.tokens_json === null ? null : JSON.parse(row.tokens_json) as FridaCapture['tokens'] };
}
export function insertFridaCapture(db: Database, capture: FridaCaptureData, captureSessionId: string | null = null): number {
  if (!Number.isSafeInteger(capture.pid) || capture.pid <= 0) throw new FridaStoreError('invalid');
  if (Buffer.byteLength(capture.jsonData) > FRIDA_JSON_BYTES || [capture.model, capture.sessionId, captureSessionId].some(value => value != null && Buffer.byteLength(value) > 1024)) throw new FridaStoreError('limit');
  const value: unknown = JSON.parse(capture.jsonData);
  if (typeof value !== 'object' || value === null) throw new FridaStoreError('invalid');
  const result = cachedStmt(db, `INSERT INTO frida_captures (pid, captured_at, capture_type, json_data, model, session_id, capture_session_id, message_count, tokens_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`).run(capture.pid, new Date().toISOString(), 'chat', capture.jsonData, capture.model ?? null, capture.sessionId ?? null, captureSessionId ?? null);
  return Number(result.lastInsertRowid);
}
export interface FridaCapturePage { items: FridaCapture[]; nextCursor: string | null; hasMore: boolean }
function cursorParts(cursor?: string): { at: string; id: number } {
  if (cursor === undefined) return { at: '9999-12-31T23:59:59.999Z', id: Number.MAX_SAFE_INTEGER };
  if (cursor.length > 128) throw new FridaStoreError('invalid');
  let at: unknown = cursor, id: unknown = 0;
  if (cursor.startsWith('[')) {
    try { const pair: unknown = JSON.parse(cursor); if (!Array.isArray(pair) || pair.length !== 2) throw new FridaStoreError('invalid'); [at, id] = pair; } catch { throw new FridaStoreError('invalid'); }
  }
  if (typeof at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) throw new FridaStoreError('invalid');
  return { at, id };
}
export function listFridaCaptures(db: Database, opts: { limit?: number; cursor?: string } = {}): FridaCapturePage {
  const limit = opts.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new FridaStoreError('invalid');
  const { at, id } = cursorParts(opts.cursor);
  // CASE prevents oversized legacy metadata from being materialized. Fixed indexed page.
  const rows = cachedStmt(db, `SELECT id, pid, substr(captured_at,1,32) AS captured_at, CASE WHEN ${METADATA_BOUNDS} THEN capture_type ELSE NULL END AS capture_type, substr(json_data, 1, 500) AS json_data, substr(model, 1, 1024) AS model, substr(session_id, 1, 1024) AS session_id, substr(capture_session_id, 1, 1024) AS capture_session_id, message_count, CASE WHEN ${METADATA_BOUNDS} THEN tokens_json ELSE NULL END AS tokens_json FROM frida_captures WHERE (captured_at, id) < (?, ?) ORDER BY captured_at DESC, id DESC LIMIT ?`).all(at, id, limit + 1) as Row[];
  if (rows.some(row => row.capture_type === null)) throw new FridaStoreError('limit');
  const items = rows.slice(0, limit).map(map), hasMore = rows.length > limit, last = items.at(-1);
  const page = { items, hasMore, nextCursor: hasMore && last ? JSON.stringify([last.capturedAt, last.id]) : null };
  if (Buffer.byteLength(JSON.stringify(page)) > 2 * 1024 * 1024) throw new FridaStoreError('limit');
  return page;
}
export function getFridaCapture(db: Database, id: number): FridaCapture | null {
  if (!Number.isSafeInteger(id) || id <= 0) throw new FridaStoreError('invalid');
  const row = cachedStmt(db, `SELECT ${FRIDA_DETAIL_COLS} FROM frida_captures WHERE id = ? AND ${BOUNDS}`).get(id) as Row | undefined;
  if (row === undefined) {
    if (cachedStmt(db, 'SELECT id FROM frida_captures WHERE id = ?').get(id)) throw new FridaStoreError('limit');
    return null;
  }
  if (row.json_data === null) throw new FridaStoreError('limit');
  return map(row);
}
