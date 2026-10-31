import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from 'better-sqlite3';
import { buildLinkedTraceExport, stringifyLinkedTraceExport, validateLinkedExportOptions } from '../../src/core/linked-trace-export.js';
import type { LinkedExportOptions, LinkedOtlpTraceExport } from '../../src/core/linked-trace-export.js';
import { TraceExportLimitError } from '../../src/core/trace-export.js';
import { getLinkedExecution, LinkedExecutionLimitError } from '../storage/linked-execution.js';
import { readTraceExportPage, traceExportIds } from './trace-export-route.js';
import { sendApiError } from './error-envelope.js';
import { sendCompressedOrPlain } from './send-json.js';

/** Stable capture identity independent of selected scan session and membership. */
export function linkedNetworkExportIds(proxyId: number): { traceId: string; spanId: string } {
  if (!Number.isSafeInteger(proxyId) || proxyId < 1) throw new TraceExportLimitError();
  const digest = (kind: string, length: number): string => {
    const id = createHash('sha256').update(JSON.stringify(['awesome-telemetry.linked-network-export', 2, kind, 'proxy', proxyId])).digest('hex').slice(0, length);
    return /^0+$/.test(id) ? '0'.repeat(length - 1) + '1' : id;
  };
  return { traceId: digest('trace', 32), spanId: digest('span', 16) };
}

export function readLinkedTraceExport(db: Database, key: string, options: LinkedExportOptions, generatedAt: string): LinkedOtlpTraceExport | null {
  validateLinkedExportOptions(options);
  return db.transaction(() => {
    const page = readTraceExportPage(db, key, options.eventOffset, options.eventLimit);
    if (page === null) return null;
    const linked = getLinkedExecution(db, key, options);
    return buildLinkedTraceExport(page, linked, options, { scan: traceExportIds(key), network: linkedNetworkExportIds }, generatedAt);
  })();
}

/** Parent must dispatch only AFTER local connection/Host/Origin and foreground guards. */
export function handleLinkedTraceExport(req: IncomingMessage, res: ServerResponse, db: Database, sessionKey: string): void {
  res.setHeader('cache-control', 'no-store');
  const bad = (): void => sendApiError(res, 400, 'BAD_REQUEST', 'Invalid linked trace export query', undefined, req);
  if (req.method !== 'GET' || sessionKey.length === 0 || sessionKey.length > 1024) return bad();
  const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
  for (const [key, value] of params) {
    if (!['eventOffset', 'eventLimit', 'captureCursor', 'captureLimit'].includes(key) || params.getAll(key).length !== 1
      || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return bad();
  }
  const options: LinkedExportOptions = { eventOffset: Number(params.get('eventOffset') ?? 0), eventLimit: Number(params.get('eventLimit') ?? 100),
    captureLimit: Number(params.get('captureLimit') ?? 20), ...(params.has('captureCursor') ? { captureCursor: Number(params.get('captureCursor')) } : {}) };
  try { validateLinkedExportOptions(options); } catch { return bad(); }
  try {
    const result = readLinkedTraceExport(db, sessionKey, options, new Date().toISOString());
    if (result === null) return sendApiError(res, 404, 'SESSION_NOT_FOUND', 'Native scan session not found', undefined, req);
    const text = stringifyLinkedTraceExport(result);
    sendCompressedOrPlain(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="linked-trace-${traceExportIds(sessionKey).traceId}-${options.eventOffset}.otlp.json"` }, Buffer.from(text), req);
  } catch (error) {
    if (error instanceof TraceExportLimitError || error instanceof LinkedExecutionLimitError) {
      return sendApiError(res, 503, 'EXECUTION_METADATA_LIMIT', 'Linked trace export exceeds bounded metadata limits', undefined, req);
    }
    sendApiError(res, 500, 'INTERNAL_ERROR', 'Linked trace export could not read retained metadata', undefined, req);
  }
}
