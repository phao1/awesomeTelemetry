import type { Database } from 'better-sqlite3';
import type { CaptureBodyRef, CaptureProcessingResult, CaptureTransportResult, ProxyCaptureBodies } from '../../src/core/trace-types.js';
import { PROXY_CAPTURE_BODY_COLS, PROXY_CAPTURE_PROCESSING_COLS, PROXY_CAPTURE_TRANSPORT_COLS } from '../storage/columns.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { validNetworkTiming } from './network-timing.js';

const WRITE = `INSERT INTO proxy_capture_bodies (${PROXY_CAPTURE_BODY_COLS}) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(proxy_id) DO UPDATE SET request_ref=excluded.request_ref, response_ref=excluded.response_ref,
  request_preview_truncated=excluded.request_preview_truncated,
  response_preview_truncated=excluded.response_preview_truncated, response_headers=excluded.response_headers`;
const READ = `SELECT ${PROXY_CAPTURE_BODY_COLS} FROM proxy_capture_bodies WHERE proxy_id = ?`;
const READ_PROCESSING = `SELECT ${PROXY_CAPTURE_PROCESSING_COLS} FROM proxy_capture_processing WHERE proxy_id = ?`;
const WRITE_PROCESSING = `INSERT INTO proxy_capture_processing (${PROXY_CAPTURE_PROCESSING_COLS}) VALUES (?, ?) ON CONFLICT(proxy_id) DO UPDATE SET result_json=excluded.result_json`;
const READ_TRANSPORT = `SELECT ${PROXY_CAPTURE_TRANSPORT_COLS} FROM proxy_capture_transport WHERE proxy_id = ?`;
const WRITE_TRANSPORT = `INSERT INTO proxy_capture_transport (${PROXY_CAPTURE_TRANSPORT_COLS}) VALUES (?, ?) ON CONFLICT(proxy_id) DO UPDATE SET result_json=excluded.result_json`;

export function writeCaptureTransport(db: Database, id: number, value: CaptureTransportResult): void {
  const { timing, websocket, ...outcome } = value;
  if (!(value.error === null || typeof value.error === 'string' && value.error.length <= 128) ||
    Buffer.byteLength(JSON.stringify(outcome)) > 512 || timing !== undefined && !validNetworkTiming(timing) ||
    websocket !== undefined && (timing !== undefined || websocket.version !== 1 || websocket.scope !== 'connection' || websocket.archive !== 'awsp1' ||
      [websocket.requestMessages, websocket.responseMessages].some(v => !Number.isSafeInteger(v) || v < 0) ||
      [websocket.clientCloseCode, websocket.upstreamCloseCode].some(v => v !== null && (!Number.isInteger(v) || v < 1000 || v > 4999)) ||
      Buffer.byteLength(JSON.stringify(websocket)) > 512)) throw new RangeError('Invalid capture transport metadata');
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 4096) throw new RangeError('Capture transport outcome exceeds its metadata bound');
  cachedStmt(db, WRITE_TRANSPORT).run(id, encoded);
}

export function writeCaptureProcessing(db: Database, id: number, value: CaptureProcessingResult): void {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 1024) throw new RangeError('Capture processing outcome exceeds its metadata bound');
  cachedStmt(db, WRITE_PROCESSING).run(id, encoded);
}

export function writeCaptureBodies(db: Database, id: number, value: ProxyCaptureBodies): void {
  cachedStmt(db, WRITE).run(id,
    value.request === null ? null : JSON.stringify(value.request),
    value.response === null ? null : JSON.stringify(value.response),
    value.requestPreviewTruncated ? 1 : 0, value.responsePreviewTruncated ? 1 : 0,
    JSON.stringify(value.responseHeaders));
  if (value.processing !== undefined) writeCaptureProcessing(db, id, value.processing);
  if (value.transport !== undefined) writeCaptureTransport(db, id, value.transport);
}

export function readCaptureBodies(db: Database, id: number): ProxyCaptureBodies {
  const row = cachedStmt(db, READ).get(id) as Record<string, unknown> | undefined;
  const processing = cachedStmt(db, READ_PROCESSING).get(id) as { result_json: string } | undefined;
  const transport = cachedStmt(db, READ_TRANSPORT).get(id) as { result_json: string } | undefined;
  return {
    request: typeof row?.request_ref === 'string' ? JSON.parse(row.request_ref) as CaptureBodyRef : null,
    response: typeof row?.response_ref === 'string' ? JSON.parse(row.response_ref) as CaptureBodyRef : null,
    requestPreviewTruncated: Boolean(row?.request_preview_truncated),
    responsePreviewTruncated: Boolean(row?.response_preview_truncated),
    responseHeaders: typeof row?.response_headers === 'string' ? JSON.parse(row.response_headers) as Record<string, string | string[]> : {},
    ...(processing === undefined ? {} : { processing: JSON.parse(processing.result_json) as CaptureProcessingResult }),
    ...(transport === undefined ? {} : { transport: JSON.parse(transport.result_json) as CaptureTransportResult }),
  };
}
