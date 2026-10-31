import type { LinkedExecutionPage, TraceSourceIdentity } from './trace-types.js';
import { TRACE_KINDS, TRACE_PHASES, PROVIDER_KEYS } from './trace-types.js';
import { buildTraceExport, isoUtcToUnixNano, readTraceExportCoverage, TraceExportLimitError, TRACE_EXPORT_MAX_BYTES } from './trace-export.js';
import type { OtlpAttribute, OtlpExportSpan, TraceExportPage, TraceExportCoverage } from './trace-export.js';

export interface LinkedExportOptions { eventOffset: number; eventLimit: number; captureCursor?: number; captureLimit: number }
export interface LinkedOtlpTraceExport {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: 'awesome-telemetry.scan-export' | 'awesome-telemetry.linked-network-export'; version: '1' | '2' };
      spans: OtlpExportSpan[];
    }>;
  }>;
}
export interface LinkedExportCoverage {
  native: TraceExportCoverage;
  capture: { cursor: number | null; limit: number; returned: number; omittedInvalidTime: number; hasMore: boolean; nextCursor: number | null; partial: boolean };
  identity: { complete: boolean; omittedCount: number; reasons: string[]; returned: number };
}
type ExportIdentity = Pick<TraceSourceIdentity, 'namespace' | 'kind' | 'value' | 'scope' | 'eventId' | 'source' | 'sourceKey'>;
const P = 'awesome_telemetry.';
const fail = (): never => { throw new TraceExportLimitError(); };
const attr = (key: string, value: string | number | boolean, integer = false): OtlpAttribute => ({ key: P + key,
  value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : integer ? { intValue: String(value) } : { doubleValue: value } });
const nativeIdentity = ({ namespace, kind, value, scope, eventId, source, sourceKey }: TraceSourceIdentity): ExportIdentity => ({ namespace, kind, value, scope, eventId, source, sourceKey });
const identityAttr = (key: string, values: ExportIdentity[]): OtlpAttribute => attr(key, JSON.stringify(values));

export function validateLinkedExportOptions(o: LinkedExportOptions): void {
  if (!Number.isSafeInteger(o.eventOffset) || o.eventOffset < 0 || o.eventOffset > 1_000_000
    || !Number.isSafeInteger(o.eventLimit) || o.eventLimit < 1 || o.eventLimit > 200
    || !Number.isSafeInteger(o.captureLimit) || o.captureLimit < 1 || o.captureLimit > 50
    || (o.captureCursor !== undefined && (!Number.isSafeInteger(o.captureCursor) || o.captureCursor < 1))) fail();
}

/** Pure allowlist projection. Association never supplies execution edges or ownership. */
export function buildLinkedTraceExport(page: TraceExportPage, linked: LinkedExecutionPage, options: LinkedExportOptions,
  ids: { scan: { traceId: string; spanId: (eventId: string) => string }; network: (proxyId: number) => { traceId: string; spanId: string } },
  generatedAt: string): LinkedOtlpTraceExport {
  validateLinkedExportOptions(options);
  if (linked.sessionKey !== page.session.id || page.offset !== options.eventOffset || page.limit !== options.eventLimit
    || linked.eventOffset !== page.offset || linked.eventLimit !== page.limit || linked.eventTotal !== page.eventTotal
    || linked.events.length !== page.events.length || linked.events.some((e, i) => e.id !== page.events[i]!.id)
    || linked.identities.length > 1000 || linked.attempts.length > options.captureLimit
    || linked.identityCompleteness.reasons.some(r => ['identity_limit', 'response_budget', 'match_limit'].includes(r))) fail();
  const native = buildTraceExport(page, ids.scan, generatedAt).resourceSpans[0]!;
  const attributes = native.resource.attributes.map(a => a.key === P + 'export.version' ? attr('export.version', 2, true)
    : a.key === P + 'export.source' ? attr('export.source', 'scan_and_proxy')
      : a.key === P + 'export.scope' ? attr('export.scope', 'linked_metadata_pages')
        : a.key === P + 'export.id_basis' ? attr('export.id_basis', 'generated_source_keys') : a);
  const identities = linked.identities.map(nativeIdentity);
  const scanSpans = native.scopeSpans[0]!.spans;
  const attachedEvents = new Set<string>();
  for (const span of scanSpans) {
    const eventId = (span.attributes.find(a => a.key === P + 'event.id')!.value as { stringValue: string }).stringValue;
    attachedEvents.add(eventId);
    span.attributes.push(identityAttr('identity.native', identities.filter(i => i.source === 'scan' && i.sourceKey === page.session.id && i.eventId === eventId)));
  }
  const spans: OtlpExportSpan[] = [];
  const attachedCaptures = new Set<string>();
  let omitted = 0;
  for (const { request, transport, association } of linked.attempts) {
    if (association.sessionKey !== page.session.id || association.proxyId !== request.id || !['direct', 'confirmed'].includes(association.state)) fail();
    const start = isoUtcToUnixNano(request.startedAt);
    if (start === null) { omitted++; continue; }
    const end = request.completedAt === null ? null : isoUtcToUnixNano(request.completedAt);
    const knownEnd = end !== null && BigInt(end) >= BigInt(start);
    const endState = knownEnd ? 'end_known' : request.completedAt === null ? 'end_unknown' : 'end_invalid';
    const a = [attr('capture.source', 'proxy'), attr('capture.proxy_id', request.id, true), attr('capture.request_id', request.requestId),
      attr('association.id', association.id), attr('association.state', association.state), attr('association.reason', association.reason), attr('association.session_key', association.sessionKey),
      attr('network.scope', transport?.websocket ? 'websocket_connection' : transport ? 'http_request' : 'legacy_unknown'),
      attr('network.transport_state', transport?.state ?? 'unknown'), attr('network.end_state', endState),
      attr('network.time_basis', knownEnd ? 'network_observed_interval' : 'network_observation_open'),
      identityAttr('identity.native', identities.filter(i => i.source === 'proxy' && i.sourceKey === String(request.id)))];
    if (transport?.statusCode !== null && transport?.statusCode !== undefined) a.push(attr('network.status_code', transport.statusCode, true));
    const completed = transport?.timing?.completedMs;
    if (transport?.timing?.clock === 'proxy_monotonic' && typeof completed === 'number' && Number.isFinite(completed) && completed >= 0) {
      a.push(attr('network.completed_ms', completed), attr('network.completed_ms_basis', 'proxy_monotonic'));
    }
    spans.push({ ...ids.network(request.id), name: 'network.capture', kind: 0, startTimeUnixNano: start, endTimeUnixNano: knownEnd ? end : start,
      attributes: a, status: { code: 0 } });
    attachedCaptures.add(String(request.id));
  }
  const completeness = linked.identityCompleteness;
  attributes.push(attr('export.snapshot', 'single_read_live_page'), attr('export.retry_identity', 'unknown'), attr('export.association_semantics', 'membership_only'),
    attr('identity.complete', completeness.complete), attr('identity.omitted_count', completeness.omittedCount, true), attr('identity.reasons', JSON.stringify(completeness.reasons)),
    attr('identity.returned', identities.length, true), identityAttr('identity.session', identities.filter(i => i.source === 'scan' && i.eventId === null)),
    identityAttr('identity.unexported_event', identities.filter(i => i.source === 'scan' && i.eventId !== null && !attachedEvents.has(i.eventId))),
    identityAttr('identity.unexported_capture', identities.filter(i => i.source === 'proxy' && !attachedCaptures.has(i.sourceKey))),
    attr('capture_page.limit', options.captureLimit, true), attr('capture_page.returned', linked.attempts.length, true),
    attr('capture_page.omitted_invalid_time', omitted, true), attr('capture_page.has_more', linked.capturesHasMore),
    attr('capture_page.partial', options.captureCursor !== undefined || linked.capturesHasMore || omitted > 0),
    attr('capture_page.proxy_ids', JSON.stringify(linked.attempts.map(a => a.request.id))));
  if (options.captureCursor !== undefined) attributes.push(attr('capture_page.cursor', options.captureCursor, true));
  if (linked.nextCaptureCursor !== null) attributes.push(attr('capture_page.next_cursor', linked.nextCaptureCursor, true));
  const result: LinkedOtlpTraceExport = { resourceSpans: [{ resource: { attributes }, scopeSpans: [native.scopeSpans[0]!,
    { scope: { name: 'awesome-telemetry.linked-network-export', version: '2' }, spans }] }] };
  readLinkedTraceExportCoverage(result, page.session.id, options);
  return result;
}

export function stringifyLinkedTraceExport(value: LinkedOtlpTraceExport): string {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > TRACE_EXPORT_MAX_BYTES) fail();
  return text;
}

// Validate the complete wire envelope, not just the subset used by the UI.
const keys = (value: unknown, expected: string[]): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length
    || Object.keys(value).some(k => !expected.includes(k))) fail();
};
const stringKeys = (list: string): string[] => list.split(' ');
const resourceStrings = stringKeys('export.source export.id_basis export.scope export.generated_at export.source_completeness session.key session.provider session.updated_at session.duration_source export.snapshot export.retry_identity export.association_semantics identity.reasons identity.session identity.unexported_event identity.unexported_capture capture_page.proxy_ids');
const resourceInts = stringKeys('export.version page.offset page.limit page.returned page.event_total page.omitted_invalid_time page.next_offset identity.omitted_count identity.returned capture_page.cursor capture_page.limit capture_page.returned capture_page.omitted_invalid_time capture_page.next_cursor');
const resourceBools = stringKeys('export.bodies_included page.has_more page.partial page.detail_loaded page.count_mismatch identity.complete capture_page.has_more capture_page.partial');
const scanStrings = stringKeys('event.id event.kind event.phase event.status event.time_basis event.duration_state identity.native');
const networkStrings = stringKeys('capture.source capture.request_id association.id association.state association.reason association.session_key network.scope network.transport_state network.end_state network.time_basis network.completed_ms_basis identity.native');
function attributesMap(value: OtlpAttribute[], strings: string[], ints: string[], bools: string[], doubles: string[] = [], service = false) {
  if (!Array.isArray(value)) fail();
  const map = new Map<string, string | number | boolean>();
  for (const a of value) {
    keys(a, ['key', 'value']);
    const k = a.key === 'service.name' && service ? 'service.name' : typeof a.key === 'string' && a.key.startsWith(P) ? a.key.slice(P.length) : fail();
    if (map.has(k)) fail();
    if (strings.includes(k) || k === 'service.name') { keys(a.value, ['stringValue']); const v = (a.value as { stringValue: string }).stringValue; if (typeof v !== 'string') fail(); map.set(k, v); }
    else if (ints.includes(k)) { keys(a.value, ['intValue']); const v = (a.value as { intValue: string }).intValue; if (typeof v !== 'string' || !/^(0|[1-9]\d*)$/.test(v) || !Number.isSafeInteger(Number(v))) fail(); map.set(k, Number(v)); }
    else if (bools.includes(k)) { keys(a.value, ['boolValue']); const v = (a.value as { boolValue: boolean }).boolValue; if (typeof v !== 'boolean') fail(); map.set(k, v); }
    else if (doubles.includes(k)) { keys(a.value, ['doubleValue']); const v = (a.value as { doubleValue: number }).doubleValue; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(); map.set(k, v); }
    else fail();
  }
  return map;
}
const required = (m: Map<string, unknown>, names: string[]): void => { if (names.some(k => !m.has(k))) fail(); };
const nano = (v: string): boolean => typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) && v.length <= 20 && BigInt(v) <= (1n << 64n) - 1n;
const validId = (id: string, n: number): boolean => typeof id === 'string' && id.length === n && /^[a-f0-9]+$/.test(id) && !/^0+$/.test(id);
const identityKinds = stringKeys('session turn message request response tool_call trace span parent_session parent_span');
function jsonArray(v: unknown): unknown[] { if (typeof v !== 'string') return fail(); let parsed: unknown; try { parsed = JSON.parse(v); } catch { return fail(); } return Array.isArray(parsed) ? parsed : fail(); }

export function readLinkedTraceExportCoverage(value: LinkedOtlpTraceExport, sessionKey: string, options: LinkedExportOptions): LinkedExportCoverage {
  validateLinkedExportOptions(options);
  keys(value, ['resourceSpans']);
  if (!Array.isArray(value.resourceSpans) || value.resourceSpans.length !== 1) fail();
  const resource = value.resourceSpans[0]!;
  keys(resource, ['resource', 'scopeSpans']); keys(resource.resource, ['attributes']);
  const r = attributesMap(resource.resource.attributes, resourceStrings, resourceInts, resourceBools, [], true);
  required(r, [...resourceStrings, ...resourceBools, ...resourceInts.filter(k => !['page.next_offset', 'capture_page.cursor', 'capture_page.next_cursor'].includes(k)), 'service.name']);
  if (r.get('service.name') !== 'awesome-telemetry' || r.get('export.version') !== 2 || r.get('export.source') !== 'scan_and_proxy'
    || r.get('export.scope') !== 'linked_metadata_pages' || r.get('export.id_basis') !== 'generated_source_keys'
    || r.get('export.snapshot') !== 'single_read_live_page' || r.get('export.retry_identity') !== 'unknown' || r.get('export.association_semantics') !== 'membership_only'
    || !PROVIDER_KEYS.includes(r.get('session.provider') as typeof PROVIDER_KEYS[number]) || !['unknown', 'measured', 'derived'].includes(String(r.get('session.duration_source')))
    || isoUtcToUnixNano(String(r.get('export.generated_at'))) === null || isoUtcToUnixNano(String(r.get('session.updated_at'))) === null) fail();
  const scopes = resource.scopeSpans;
  if (!Array.isArray(scopes) || scopes.length !== 2) fail();
  for (const [i, s] of scopes.entries()) {
    keys(s, ['scope', 'spans']); keys(s.scope, ['name', 'version']);
    if (s.scope.name !== (i === 0 ? 'awesome-telemetry.scan-export' : 'awesome-telemetry.linked-network-export') || s.scope.version !== (i === 0 ? '1' : '2') || !Array.isArray(s.spans)) fail();
  }
  const native = readTraceExportCoverage({ resourceSpans: [{ resource: { attributes: resource.resource.attributes.map(a => a.key === P + 'export.version' ? attr('export.version', 1, true)
    : a.key === P + 'export.source' ? attr('export.source', 'scan') : a.key === P + 'export.scope' ? attr('export.scope', 'retained_scan_metadata_page') : a) },
  scopeSpans: [{ scope: { name: 'awesome-telemetry.scan-export', version: '1' }, spans: scopes[0]!.spans }] }] }, sessionKey, options.eventOffset, options.eventLimit);
  if (!native.hasMore && r.has('page.next_offset')) fail();
  const capture = { cursor: r.has('capture_page.cursor') ? r.get('capture_page.cursor') as number : null, limit: r.get('capture_page.limit') as number,
    returned: r.get('capture_page.returned') as number, omittedInvalidTime: r.get('capture_page.omitted_invalid_time') as number, hasMore: r.get('capture_page.has_more') as boolean,
    nextCursor: r.has('capture_page.next_cursor') ? r.get('capture_page.next_cursor') as number : null, partial: r.get('capture_page.partial') as boolean };
  const proxyIds = jsonArray(r.get('capture_page.proxy_ids'));
  if (capture.cursor !== (options.captureCursor ?? null) || capture.limit !== options.captureLimit || capture.returned > capture.limit
    || proxyIds.length !== capture.returned || proxyIds.some((id, i) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || (capture.cursor !== null && id >= capture.cursor) || (i > 0 && id >= (proxyIds[i - 1] as number)))
    || capture.omittedInvalidTime > capture.returned || scopes[1]!.spans.length !== capture.returned - capture.omittedInvalidTime
    || (capture.hasMore ? capture.returned === 0 || capture.nextCursor !== proxyIds.at(-1) : capture.nextCursor !== null)
    || capture.partial !== (capture.cursor !== null || capture.hasMore || capture.omittedInvalidTime > 0)) fail();
  const reasons = jsonArray(r.get('identity.reasons'));
  if (reasons.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9_]*$/.test(x)) || new Set(reasons).size !== reasons.length) fail();
  const identity = { complete: r.get('identity.complete') as boolean, omittedCount: r.get('identity.omitted_count') as number, reasons: reasons as string[], returned: r.get('identity.returned') as number };
  if (identity.returned > 1000 || (identity.complete && (identity.omittedCount !== 0 || reasons.length !== 0)) || reasons.some(x => ['identity_limit', 'response_budget', 'match_limit'].includes(String(x)))) fail();
  let identityCount = 0;
  const observedEvents = new Set<string>(); const observedCaptures = new Set<string>(); const spanIds = new Set<string>(); const networkTraceIds = new Set<string>();
  const readIdentities = (encoded: unknown, check: (i: ExportIdentity) => boolean): void => {
    for (const raw of jsonArray(encoded)) {
      keys(raw, ['namespace', 'kind', 'value', 'scope', 'eventId', 'source', 'sourceKey']);
      const i = raw as ExportIdentity;
      if (typeof i.namespace !== 'string' || typeof i.value !== 'string' || typeof i.sourceKey !== 'string' || !identityKinds.includes(i.kind)
        || (i.scope !== null && typeof i.scope !== 'string') || (i.eventId !== null && typeof i.eventId !== 'string')
        || !['scan', 'proxy'].includes(i.source) || (i.source === 'scan' ? i.sourceKey !== sessionKey : !proxyIds.includes(Number(i.sourceKey)) || String(Number(i.sourceKey)) !== i.sourceKey) || !check(i)) fail();
      identityCount++;
    }
  };
  let scanTraceId: string | undefined;
  for (const [index, scope] of scopes.entries()) for (const span of scope.spans) {
    keys(span, ['traceId', 'spanId', 'name', 'kind', 'startTimeUnixNano', 'endTimeUnixNano', 'attributes', 'status']); keys(span.status, ['code']);
    if (!validId(span.traceId, 32) || !validId(span.spanId, 16) || spanIds.has(span.traceId + span.spanId) || !nano(span.startTimeUnixNano) || !nano(span.endTimeUnixNano)
      || BigInt(span.endTimeUnixNano) < BigInt(span.startTimeUnixNano) || span.kind !== 0) fail();
    spanIds.add(span.traceId + span.spanId);
    if (index === 0) {
      const a = attributesMap(span.attributes, scanStrings, ['event.sequence'], [], ['event.normalized_duration_ms']); required(a, [...scanStrings, 'event.sequence']);
      const eventId = a.get('event.id') as string;
      if (observedEvents.has(eventId) || (scanTraceId !== undefined && span.traceId !== scanTraceId) || (a.get('event.sequence') as number) < 1
        || !TRACE_KINDS.includes(a.get('event.kind') as typeof TRACE_KINDS[number]) || !TRACE_PHASES.includes(a.get('event.phase') as typeof TRACE_PHASES[number])
        || span.name !== 'scan.' + a.get('event.kind') || a.get('event.time_basis') !== 'scan_observation_point'
        || !['success', 'error', 'running', 'cancelled', 'unknown'].includes(String(a.get('event.status')))
        || span.status.code !== (a.get('event.status') === 'success' ? 1 : a.get('event.status') === 'error' ? 2 : 0)) fail();
      const durationState = a.has('event.normalized_duration_ms') ? (a.get('event.normalized_duration_ms') as number) > 0 ? 'positive_normalized' : 'zero_or_unknown' : 'invalid_or_unknown';
      if (a.get('event.duration_state') !== durationState) fail();
      scanTraceId = span.traceId; observedEvents.add(eventId);
      readIdentities(a.get('identity.native'), i => i.source === 'scan' && i.eventId === eventId);
    } else {
      const a = attributesMap(span.attributes, networkStrings, ['capture.proxy_id', 'network.status_code'], [], ['network.completed_ms']);
      required(a, [...networkStrings.filter(k => k !== 'network.completed_ms_basis'), 'capture.proxy_id']);
      const id = a.get('capture.proxy_id') as number;
      const endState = a.get('network.end_state');
      if (!proxyIds.includes(id) || observedCaptures.has(String(id)) || networkTraceIds.has(span.traceId) || span.traceId === scanTraceId || span.status.code !== 0
        || span.name !== 'network.capture' || a.get('capture.source') !== 'proxy' || a.get('association.session_key') !== sessionKey
        || !['direct', 'confirmed'].includes(String(a.get('association.state'))) || !['websocket_connection', 'http_request', 'legacy_unknown'].includes(String(a.get('network.scope')))
        || !['completed', 'http_error', 'network_error', 'timeout', 'cancelled', 'interrupted', 'unknown'].includes(String(a.get('network.transport_state')))
        || !['end_known', 'end_unknown', 'end_invalid'].includes(String(endState)) || (endState !== 'end_known' && span.endTimeUnixNano !== span.startTimeUnixNano)
        || a.get('network.time_basis') !== (endState === 'end_known' ? 'network_observed_interval' : 'network_observation_open')
        || (a.has('network.completed_ms') ? a.get('network.completed_ms_basis') !== 'proxy_monotonic' : a.has('network.completed_ms_basis'))
        || (a.has('network.status_code') && ((a.get('network.status_code') as number) < 100 || (a.get('network.status_code') as number) > 599))
        || (a.get('network.scope') === 'legacy_unknown' ? a.get('network.transport_state') !== 'unknown' || a.has('network.status_code') || a.has('network.completed_ms') : a.get('network.transport_state') === 'unknown')) fail();
      observedCaptures.add(String(id)); networkTraceIds.add(span.traceId);
      readIdentities(a.get('identity.native'), i => i.source === 'proxy' && i.sourceKey === String(id));
    }
  }
  readIdentities(r.get('identity.session'), i => i.source === 'scan' && i.eventId === null);
  readIdentities(r.get('identity.unexported_event'), i => i.source === 'scan' && i.eventId !== null && !observedEvents.has(i.eventId));
  readIdentities(r.get('identity.unexported_capture'), i => i.source === 'proxy' && !observedCaptures.has(i.sourceKey));
  if (identityCount !== identity.returned) fail();
  return { native, capture, identity };
}
