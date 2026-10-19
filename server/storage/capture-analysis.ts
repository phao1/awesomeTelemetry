import type { Database } from 'better-sqlite3';
import type { CaptureReparseSnapshot, RequestContextFormat } from '../../src/core/trace-types.js';
import { PROXY_CAPTURE_ANALYSIS_COLS } from './columns.js';
import { cachedStmt } from './stmt-cache.js';

const MAX_BYTES = 8192;
const SNAPSHOT_KEYS = ['parserVersion', 'metricVersion', 'sourceFingerprint', 'parsedAt', 'requestFormat', 'state', 'usage', 'completeness'];
const USAGE_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'nativeTotalTokens', 'totalTokens', 'accounting'];
const COMPLETENESS_KEYS = ['complete', 'omittedCount', 'reasons'];
const READ_SQL = `SELECT ${PROXY_CAPTURE_ANALYSIS_COLS} FROM proxy_capture_analysis WHERE proxy_id=?`;
const WRITE_SQL = `INSERT INTO proxy_capture_analysis (${PROXY_CAPTURE_ANALYSIS_COLS}) VALUES(?,?,?,?,?,?,?,?,?)
  ON CONFLICT(proxy_id) DO UPDATE SET parser_version=excluded.parser_version,metric_version=excluded.metric_version,
  source_fingerprint=excluded.source_fingerprint,parsed_at=excluded.parsed_at,request_format=excluded.request_format,
  state=excluded.state,usage_json=excluded.usage_json,completeness_json=excluded.completeness_json`;

export class CaptureAnalysisError extends Error {
  readonly code = 'CAPTURE_REPARSE_LIMIT';
  constructor() { super('CAPTURE_REPARSE_LIMIT'); this.name = 'CaptureAnalysisError'; }
}
function fail(): never { throw new CaptureAnalysisError(); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    result[key] = descriptor.value;
  }
  return result;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail(); return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(); return value;
}
function nullableCount(value: unknown): number | null { return value === null ? null : count(value); }
function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(); return value;
}
function utc(value: unknown): string {
  const text = boundedString(value, MAX_BYTES);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)) fail();
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== text.slice(0, 19)) fail();
  return text;
}
function format(value: unknown): RequestContextFormat {
  if (value !== 'openai_chat' && value !== 'openai_responses' && value !== 'anthropic_messages' && value !== 'unknown') fail(); return value;
}
function state(value: unknown): CaptureReparseSnapshot['state'] {
  if (value !== 'completed' && value !== 'incomplete' && value !== 'failed' && value !== 'unknown') fail(); return value;
}
function accounting(value: unknown): CaptureReparseSnapshot['usage']['accounting'] {
  if (value !== 'openai_subsets' && value !== 'anthropic_additive_input' && value !== 'unknown') fail(); return value;
}
function validate(value: unknown): CaptureReparseSnapshot {
  const input = exact(value, SNAPSHOT_KEYS), native = exact(input.usage, USAGE_KEYS), complete = exact(input.completeness, COMPLETENESS_KEYS);
  const fingerprint = boundedString(input.sourceFingerprint, 64);
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || typeof complete.complete !== 'boolean' || !Array.isArray(complete.reasons) || complete.reasons.length > 32) fail();
  const snapshot: CaptureReparseSnapshot = {
    parserVersion: positive(input.parserVersion), metricVersion: positive(input.metricVersion), sourceFingerprint: fingerprint,
    parsedAt: utc(input.parsedAt), requestFormat: format(input.requestFormat), state: state(input.state),
    usage: { inputTokens: nullableCount(native.inputTokens), outputTokens: nullableCount(native.outputTokens),
      cacheReadTokens: nullableCount(native.cacheReadTokens), cacheWriteTokens: nullableCount(native.cacheWriteTokens),
      reasoningTokens: nullableCount(native.reasoningTokens), nativeTotalTokens: nullableCount(native.nativeTotalTokens), totalTokens: nullableCount(native.totalTokens), accounting: accounting(native.accounting) },
    completeness: { complete: complete.complete, omittedCount: count(complete.omittedCount), reasons: Array.from(complete.reasons, reason => boundedString(reason, 128)) },
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_BYTES) fail();
  return snapshot;
}
type Row = { proxy_id: number; parser_version: number; metric_version: number; source_fingerprint: string; parsed_at: string;
  request_format: string; state: string; usage_json: string; completeness_json: string };

/** Explicit primary-key metadata read. Does not inspect original files or reparse. */
export function readCaptureAnalysis(db: Database, proxyId: number): CaptureReparseSnapshot | null {
  positive(proxyId);
  const row = cachedStmt(db, READ_SQL).get(proxyId) as Row | undefined;
  if (row === undefined) return null;
  try {
    if (typeof row.usage_json !== 'string' || typeof row.completeness_json !== 'string' || Buffer.byteLength(row.usage_json) > MAX_BYTES || Buffer.byteLength(row.completeness_json) > MAX_BYTES) fail();
    return validate({ parserVersion: row.parser_version, metricVersion: row.metric_version, sourceFingerprint: row.source_fingerprint,
      parsedAt: row.parsed_at, requestFormat: row.request_format, state: row.state,
      usage: JSON.parse(row.usage_json) as unknown, completeness: JSON.parse(row.completeness_json) as unknown });
  } catch { fail(); }
}

/** Caller owns the fresh identity/deletion check, synchronous transaction and capacity admission. */
export function writeCaptureAnalysis(db: Database, proxyId: number, value: CaptureReparseSnapshot): void {
  positive(proxyId); const snapshot = validate(value);
  cachedStmt(db, WRITE_SQL).run(proxyId, snapshot.parserVersion, snapshot.metricVersion, snapshot.sourceFingerprint,
    snapshot.parsedAt, snapshot.requestFormat, snapshot.state, JSON.stringify(snapshot.usage), JSON.stringify(snapshot.completeness));
}

/** Used in the existing confirmed-intent transaction; never removes a source capture. */
export function clearCaptureAnalysis(db: Database, proxyId: number): void {
  positive(proxyId); cachedStmt(db, 'DELETE FROM proxy_capture_analysis WHERE proxy_id=?').run(proxyId);
}
