import type { TraceEventSlim, TraceSession } from './trace-types.js';
import { PROVIDER_KEYS, TRACE_KINDS, TRACE_PHASES } from './trace-types.js';

export const TRACE_EXPORT_MAX_BYTES = 512 * 1024;
export const TRACE_EXPORT_MAX_EVENTS = 200;
export const TRACE_EXPORT_MAX_OFFSET = 1_000_000;
const PREFIX = 'awesome_telemetry.';
const UINT64_MAX = (1n << 64n) - 1n;

export type TraceExportEvent = Pick<TraceEventSlim, 'id' | 'sequence' | 'kind' | 'phase' | 'startedAt' | 'durationMs' | 'status'>;
export interface TraceExportPage {
  session: Pick<TraceSession, 'id' | 'provider' | 'updatedAt' | 'durationSource'>;
  detailLoaded: boolean;
  declaredEventCount: number;
  eventTotal: number;
  offset: number;
  limit: number;
  events: TraceExportEvent[];
}
export interface OtlpAttribute {
  key: string;
  value: { stringValue: string } | { intValue: string } | { boolValue: boolean } | { doubleValue: number };
}
export interface OtlpExportSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: 0;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: 0 | 1 | 2 };
}
export interface OtlpTraceExport {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: 'awesome-telemetry.scan-export'; version: '1' };
      spans: OtlpExportSpan[];
    }>;
  }>;
}
export interface TraceExportCoverage {
  offset: number;
  limit: number;
  returned: number;
  eventTotal: number;
  omittedInvalidTime: number;
  hasMore: boolean;
  nextOffset: number | null;
  partial: boolean;
  detailLoaded: boolean;
  countMismatch: boolean;
}

export class TraceExportLimitError extends Error {
  constructor() { super('Trace export exceeds bounded metadata limits'); }
}

/** Strict calendar validation before BigInt conversion; no float epoch nanoseconds. */
export function isoUtcToUnixNano(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return null;
  const base = match[1]!;
  const milliseconds = Date.parse(base + '.000Z');
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== base + '.000Z') return null;
  const nano = BigInt(milliseconds) * 1_000_000n + BigInt((match[2] ?? '').padEnd(9, '0'));
  return nano < 0n || nano > UINT64_MAX ? null : nano.toString();
}

function attr(key: string, value: string | number | boolean, integer = false): OtlpAttribute {
  return { key: PREFIX + key, value: typeof value === 'string' ? { stringValue: value }
    : typeof value === 'boolean' ? { boolValue: value } : integer ? { intValue: String(value) } : { doubleValue: value } };
}
function validId(id: string, length: number): boolean {
  return id.length === length && /^[0-9a-f]+$/.test(id) && !/^0+$/.test(id);
}

/** TX-001..003: flat observation spans; never create causal edges or use bodies. */
export function buildTraceExport(page: TraceExportPage, ids: { traceId: string; spanId: (eventId: string) => string }, generatedAt: string): OtlpTraceExport {
  if (!PROVIDER_KEYS.includes(page.session.provider) || !['measured', 'derived', 'unknown'].includes(page.session.durationSource ?? 'unknown')
    || !validId(ids.traceId, 32) || isoUtcToUnixNano(generatedAt) === null || isoUtcToUnixNano(page.session.updatedAt) === null) throw new TraceExportLimitError();
  if (![page.offset, page.limit, page.eventTotal, page.declaredEventCount].every(value => Number.isSafeInteger(value) && value >= 0)
    || page.offset > TRACE_EXPORT_MAX_OFFSET || page.limit < 1 || page.limit > TRACE_EXPORT_MAX_EVENTS || page.events.length > page.limit
    || page.offset + page.events.length > Math.max(page.offset, page.eventTotal)) throw new TraceExportLimitError();
  const spans: OtlpExportSpan[] = [];
  const seen = new Set<string>();
  let omitted = 0;
  for (const event of page.events) {
    if (!TRACE_KINDS.includes(event.kind) || !TRACE_PHASES.includes(event.phase) || !['success', 'error', 'running', 'cancelled', 'unknown'].includes(event.status)) throw new TraceExportLimitError();
    const start = isoUtcToUnixNano(event.startedAt);
    if (start === null) { omitted++; continue; }
    const spanId = ids.spanId(event.id);
    if (!validId(spanId, 16) || seen.has(spanId) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new TraceExportLimitError();
    seen.add(spanId);
    const validDuration = typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs >= 0;
    const attributes = [attr('event.id', event.id), attr('event.sequence', event.sequence, true), attr('event.kind', event.kind),
      attr('event.phase', event.phase), attr('event.status', event.status), attr('event.time_basis', 'scan_observation_point'),
      attr('event.duration_state', validDuration ? event.durationMs > 0 ? 'positive_normalized' : 'zero_or_unknown' : 'invalid_or_unknown')];
    if (validDuration) attributes.push(attr('event.normalized_duration_ms', event.durationMs));
    spans.push({ traceId: ids.traceId, spanId, name: 'scan.' + event.kind, kind: 0, startTimeUnixNano: start, endTimeUnixNano: start,
      attributes, status: { code: event.status === 'success' ? 1 : event.status === 'error' ? 2 : 0 } });
  }
  const next = page.offset + page.events.length;
  const hasMore = next < page.eventTotal;
  const mismatch = page.declaredEventCount !== page.eventTotal;
  if (hasMore && page.events.length === 0) throw new TraceExportLimitError();
  const attributes = [
    { key: 'service.name', value: { stringValue: 'awesome-telemetry' } }, attr('export.version', 1, true), attr('export.source', 'scan'),
    attr('export.id_basis', 'generated_normalized_keys'), attr('export.scope', 'retained_scan_metadata_page'),
    attr('export.bodies_included', false), attr('export.generated_at', generatedAt), attr('export.source_completeness', 'unknown'),
    attr('session.key', page.session.id), attr('session.provider', page.session.provider), attr('session.updated_at', page.session.updatedAt),
    attr('session.duration_source', page.session.durationSource ?? 'unknown'), attr('page.offset', page.offset, true), attr('page.limit', page.limit, true),
    attr('page.returned', page.events.length, true), attr('page.event_total', page.eventTotal, true), attr('page.omitted_invalid_time', omitted, true),
    attr('page.has_more', hasMore), attr('page.partial', page.offset > 0 || hasMore || omitted > 0 || !page.detailLoaded || mismatch),
    attr('page.detail_loaded', page.detailLoaded), attr('page.count_mismatch', mismatch),
  ];
  if (hasMore) attributes.push(attr('page.next_offset', next, true));
  return { resourceSpans: [{ resource: { attributes }, scopeSpans: [{ scope: { name: 'awesome-telemetry.scan-export', version: '1' }, spans }] }] };
}

export function stringifyTraceExport(value: OtlpTraceExport): string {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > TRACE_EXPORT_MAX_BYTES) throw new TraceExportLimitError();
  return encoded;
}

/** Validate coverage and request identity before the browser creates a download. */
export function readTraceExportCoverage(value: OtlpTraceExport, sessionKey: string, offset: number, limit: number): TraceExportCoverage {
  const resource = value?.resourceSpans;
  if (!Array.isArray(resource) || resource.length !== 1 || !Array.isArray(resource[0]?.resource?.attributes)) throw new TraceExportLimitError();
  const attributes = resource[0]!.resource.attributes;
  const read = (key: string): OtlpAttribute['value'] => {
    const found = attributes.filter(item => item.key === PREFIX + key);
    if (found.length !== 1 || !found[0]?.value) throw new TraceExportLimitError();
    return found[0].value;
  };
  const str = (key: string): string => { const v = read(key); if (!('stringValue' in v) || typeof v.stringValue !== 'string') throw new TraceExportLimitError(); return v.stringValue; };
  const num = (key: string): number => { const v = read(key); if (!('intValue' in v) || !/^(0|[1-9]\d*)$/.test(v.intValue) || !Number.isSafeInteger(Number(v.intValue))) throw new TraceExportLimitError(); return Number(v.intValue); };
  const bool = (key: string): boolean => { const v = read(key); if (!('boolValue' in v) || typeof v.boolValue !== 'boolean') throw new TraceExportLimitError(); return v.boolValue; };
  if (num('export.version') !== 1 || str('export.source') !== 'scan' || str('session.key') !== sessionKey || bool('export.bodies_included')
    || str('export.scope') !== 'retained_scan_metadata_page' || str('export.source_completeness') !== 'unknown') throw new TraceExportLimitError();
  const coverage: TraceExportCoverage = { offset: num('page.offset'), limit: num('page.limit'), returned: num('page.returned'), eventTotal: num('page.event_total'),
    omittedInvalidTime: num('page.omitted_invalid_time'), hasMore: bool('page.has_more'), partial: bool('page.partial'), detailLoaded: bool('page.detail_loaded'),
    countMismatch: bool('page.count_mismatch'), nextOffset: null };
  const end = coverage.offset + coverage.returned;
  if (coverage.hasMore) coverage.nextOffset = num('page.next_offset');
  const scopes = resource[0]!.scopeSpans;
  if (coverage.offset !== offset || coverage.limit !== limit || limit < 1 || limit > TRACE_EXPORT_MAX_EVENTS || offset < 0 || offset > TRACE_EXPORT_MAX_OFFSET
    || coverage.returned > limit || end > Math.max(offset, coverage.eventTotal) || coverage.omittedInvalidTime > coverage.returned || coverage.hasMore !== (end < coverage.eventTotal)
    || (coverage.hasMore && (coverage.returned === 0 || coverage.nextOffset !== end))
    || coverage.partial !== (offset > 0 || coverage.hasMore || coverage.omittedInvalidTime > 0 || !coverage.detailLoaded || coverage.countMismatch)
    || !Array.isArray(scopes) || scopes.length !== 1 || scopes[0]?.scope?.name !== 'awesome-telemetry.scan-export' || scopes[0]?.scope?.version !== '1'
    || !Array.isArray(scopes[0]?.spans) || scopes[0].spans.length !== coverage.returned - coverage.omittedInvalidTime) throw new TraceExportLimitError();
  for (const span of scopes[0].spans) {
    if (!validId(span.traceId, 32) || !validId(span.spanId, 16) || span.kind !== 0 || typeof span.startTimeUnixNano !== 'string'
      || !/^\d+$/.test(span.startTimeUnixNano) || BigInt(span.startTimeUnixNano) > UINT64_MAX || span.endTimeUnixNano !== span.startTimeUnixNano
      || ![0, 1, 2].includes(span.status?.code)) throw new TraceExportLimitError();
  }
  return coverage;
}
