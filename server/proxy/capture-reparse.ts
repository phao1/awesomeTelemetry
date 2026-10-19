import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';

import type { CaptureBodyRef, CaptureReparseResponse, CaptureReparseSnapshot, CaptureReparseStatus, CaptureTransportResult, ProxyRequestListItem } from '../../src/core/trace-types.js';
import { readCaptureAnalysis, writeCaptureAnalysis } from '../storage/capture-analysis.js';
import { getProxyRequestListItemById } from '../storage/query-engine.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { readAnalysisBody } from './analysis-source.js';
import type { CaptureBodyStore } from './body-store.js';
import { retryCaptureCommit } from './capture-journal.js';
import { readCaptureBodies } from './capture-storage.js';
import { getOriginalDeletionForProxy } from './original-deletions.js';
import { parseProxyRequest } from './parser-router.js';
import { analyzeProtocol, CAPTURE_METRIC_VERSION, CAPTURE_PARSER_VERSION } from './protocol-analysis.js';

type ErrorCode = 'BAD_REQUEST' | 'PROXY_REQUEST_NOT_FOUND' | 'CAPTURE_ORIGINALS_DELETED' | 'CAPTURE_REPARSE_CONFLICT'
  | 'CAPTURE_REPARSE_UNSUPPORTED' | 'CAPTURE_REPARSE_BUSY' | 'CAPTURE_REPARSE_FAILED' | 'CAPTURE_REPARSE_LIMIT';
export class CaptureReparseError extends Error {
  readonly code: ErrorCode;
  readonly reason: string | null;
  constructor(code: ErrorCode, reason: string | null = null) { super(code); this.name = 'CaptureReparseError'; this.code = code; this.reason = reason; }
}
const active = new WeakMap<Database, Promise<CaptureReparseResponse>>();
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const REF_STATES = new Set(['complete', 'body_limit', 'quota_exceeded', 'queue_full', 'write_error', 'interrupted']);
type UnavailableReason = Exclude<CaptureReparseStatus['unavailableReason'], null>;
interface Source {
  request: ProxyRequestListItem;
  requestRef: CaptureBodyRef;
  responseRef: CaptureBodyRef;
  requestEncoding: string | null;
  responseEncoding: string | null;
  transport: CaptureTransportResult | undefined;
  fingerprint: string;
}
interface Inspection { requestId: string; reason: UnavailableReason | null; source: Source | null }
function fail(code: ErrorCode, reason: string | null = null): never { throw new CaptureReparseError(code, reason); }
function mapped(error: unknown): CaptureReparseError {
  if (error instanceof CaptureReparseError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return new CaptureReparseError(code === 'CAPTURE_REPARSE_LIMIT' ? 'CAPTURE_REPARSE_LIMIT' : 'CAPTURE_REPARSE_FAILED');
}
function validRef(value: CaptureBodyRef): boolean {
  return typeof value === 'object' && value !== null && typeof value.id === 'string' && ID.test(value.id)
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && typeof value.sha256 === 'string' && SHA.test(value.sha256)
    && REF_STATES.has(value.status) && (value.error === null || typeof value.error === 'string' && value.error.length <= 1024);
}
function encoding(headers: unknown): string | null {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) fail('CAPTURE_REPARSE_LIMIT');
  const value: unknown = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1];
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) return value.join(',');
  return fail('CAPTURE_REPARSE_LIMIT');
}
function bounded(value: unknown, max: number): void {
  if (Buffer.byteLength(JSON.stringify(value)) > max) fail('CAPTURE_REPARSE_LIMIT');
}

/** Explicit local reparse only. It never inserts captures, forwards requests or rewrites historical outcomes. */
export class CaptureReparser {
  private readonly db: Database;
  private readonly getFileStore: () => Promise<CaptureBodyStore>;
  private closed = false;
  constructor(db: Database, getFileStore: () => Promise<CaptureBodyStore>) { this.db = db; this.getFileStore = getFileStore; }

  private inspect(id: number): Inspection {
    if (!Number.isSafeInteger(id) || id < 1) fail('BAD_REQUEST');
    const request = getProxyRequestListItemById(this.db, id);
    if (request === null) fail('PROXY_REQUEST_NOT_FOUND');
    if (getOriginalDeletionForProxy(this.db, id) !== null) return { requestId: request.requestId, reason: 'originals_deleted', source: null };
    let capture;
    try { capture = readCaptureBodies(this.db, id); }
    catch (error) {
      if (error instanceof SyntaxError) return { requestId: request.requestId, reason: 'originals_invalid', source: null };
      throw error;
    }
    if (capture.request === null || capture.response === null) return { requestId: request.requestId, reason: 'originals_missing', source: null };
    if (request.method === 'WS' || capture.transport?.websocket !== undefined) return { requestId: request.requestId, reason: 'originals_invalid', source: null };
    if (!validRef(capture.request) || !validRef(capture.response)) return { requestId: request.requestId, reason: 'originals_invalid', source: null };
    if (capture.request.status !== 'complete' || capture.response.status !== 'complete') return { requestId: request.requestId, reason: 'originals_incomplete', source: null };
    const row = cachedStmt(this.db, 'SELECT request_headers FROM proxy_requests WHERE id=?').get(id) as { request_headers: string };
    let headers: unknown;
    try { headers = JSON.parse(row.request_headers) as unknown; } catch { return fail('CAPTURE_REPARSE_LIMIT'); }
    const requestEncoding = encoding(headers), responseEncoding = encoding(capture.responseHeaders);
    const ref = (value: CaptureBodyRef): unknown[] => [value.id, value.bytes, value.sha256, value.status];
    const transport = capture.transport;
    const tuple = [1, request.requestId, request.requestFormat, request.hostname, request.url, request.ttnetEncrypted, request.isStreaming,
      ref(capture.request), ref(capture.response), requestEncoding, responseEncoding,
      transport === undefined ? null : [transport.version, transport.state, transport.error, transport.requestEnded, transport.responseEnded, transport.statusCode]];
    const fingerprint = createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex');
    return { requestId: request.requestId, reason: null, source: { request, requestRef: capture.request, responseRef: capture.response,
      requestEncoding, responseEncoding, transport, fingerprint } };
  }
  private fresh(id: number, original: Source): void {
    let latest: Inspection;
    try { latest = this.inspect(id); }
    catch (error) { if (error instanceof CaptureReparseError && error.code === 'PROXY_REQUEST_NOT_FOUND') fail('CAPTURE_REPARSE_CONFLICT'); throw error; }
    if (latest.reason === 'originals_deleted') fail('CAPTURE_ORIGINALS_DELETED');
    if (latest.source === null || latest.requestId !== original.request.requestId || latest.source.fingerprint !== original.fingerprint) fail('CAPTURE_REPARSE_CONFLICT');
  }
  status(id: number): CaptureReparseStatus {
    try {
      const inspected = this.inspect(id);
      const snapshot = inspected.source === null ? null : readCaptureAnalysis(this.db, id);
      const state = inspected.source === null ? 'unavailable' : snapshot === null ? 'not_parsed'
        : snapshot.parserVersion !== CAPTURE_PARSER_VERSION || snapshot.metricVersion !== CAPTURE_METRIC_VERSION || snapshot.sourceFingerprint !== inspected.source.fingerprint ? 'stale' : 'current';
      const result: CaptureReparseStatus = { proxyId: id, requestId: inspected.requestId, currentParserVersion: CAPTURE_PARSER_VERSION,
        currentMetricVersion: CAPTURE_METRIC_VERSION, state, unavailableReason: inspected.reason, snapshot };
      bounded(result, 16 * 1024); return result;
    } catch (error) { throw mapped(error); }
  }
  reparse(id: number, expectedRequestId: string): Promise<CaptureReparseResponse> {
    if (this.closed || active.has(this.db)) return Promise.reject(new CaptureReparseError('CAPTURE_REPARSE_BUSY'));
    const task = Promise.resolve().then(() => this.run(id, expectedRequestId)).catch(error => { throw mapped(error); });
    active.set(this.db, task);
    const release = (): void => { if (active.get(this.db) === task) active.delete(this.db); };
    void task.then(release, release); return task;
  }
  private async run(id: number, expectedRequestId: string): Promise<CaptureReparseResponse> {
    if (typeof expectedRequestId !== 'string' || expectedRequestId.length < 1 || expectedRequestId.length > 1024) fail('BAD_REQUEST');
    const inspected = this.inspect(id);
    if (inspected.reason === 'originals_deleted') fail('CAPTURE_ORIGINALS_DELETED');
    if (inspected.requestId !== expectedRequestId) fail('CAPTURE_REPARSE_CONFLICT');
    if (inspected.source === null) fail('CAPTURE_REPARSE_UNSUPPORTED', inspected.reason);
    const source = inspected.source;
    let store: CaptureBodyStore;
    try { store = await this.getFileStore(); }
    catch (error) { this.fresh(id, source); throw error; }
    this.fresh(id, source);
    const read = async (ref: CaptureBodyRef, contentEncoding: string | null): Promise<string> => {
      const result = await readAnalysisBody(store, ref, 2 * 1024 * 1024, { contentEncoding });
      this.fresh(id, source);
      if (!result.ok) fail('CAPTURE_REPARSE_UNSUPPORTED', result.reason);
      return result.body;
    };
    // Sequential ownership means a refused direction cannot leave a sibling read running after close.
    const requestBody = await read(source.requestRef, source.requestEncoding); this.fresh(id, source);
    const responseBody = await read(source.responseRef, source.responseEncoding); this.fresh(id, source);
    const request = source.request;
    const format = request.requestFormat === 'unknown' && !request.ttnetEncrypted
      ? parseProxyRequest({ hostname: request.hostname, url: request.url, requestBody }).requestFormat ?? 'unknown' : request.requestFormat;
    const analysis = await analyzeProtocol({ format, requestBody, responseBody, streaming: request.isStreaming, transport: source.transport });
    this.fresh(id, source);
    const usage = analysis.usage;
    const snapshot: CaptureReparseSnapshot = { parserVersion: CAPTURE_PARSER_VERSION, metricVersion: CAPTURE_METRIC_VERSION,
      sourceFingerprint: source.fingerprint, parsedAt: new Date().toISOString(), requestFormat: analysis.requestFormat, state: analysis.state,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens, nativeTotalTokens: usage.nativeTotalTokens, totalTokens: usage.totalTokens, accounting: usage.accounting },
      completeness: structuredClone(analysis.completeness) };
    const result: CaptureReparseResponse = { status: { proxyId: id, requestId: request.requestId, currentParserVersion: CAPTURE_PARSER_VERSION,
      currentMetricVersion: CAPTURE_METRIC_VERSION, state: 'current', unavailableReason: null, snapshot }, analysis };
    bounded(snapshot, 8192); bounded(result, 1024 * 1024);
    await retryCaptureCommit(this.db, () => this.db.transaction(() => { this.fresh(id, source); writeCaptureAnalysis(this.db, id, snapshot); })(), true);
    this.fresh(id, source); return result;
  }
  async close(): Promise<void> {
    this.closed = true;
    try { await active.get(this.db); } catch { /* The accepted caller owns its explicit failure; shutdown still drains it. */ }
  }
}
