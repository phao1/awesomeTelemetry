import { describe, expect, it } from 'vitest';
import type { LinkedExecutionPage, TraceSourceIdentity } from './trace-types.js';
import type { TraceExportPage } from './trace-export.js';
import { buildTraceExport, TRACE_EXPORT_MAX_BYTES } from './trace-export.js';
import { buildLinkedTraceExport, readLinkedTraceExportCoverage, stringifyLinkedTraceExport } from './linked-trace-export.js';
import type { LinkedExportOptions, LinkedOtlpTraceExport } from './linked-trace-export.js';
// IDs are an injected dependency of the pure converter. Production SHA256 and
// cross-session stability remain exercised by linked-trace-export-route.test.ts.
function fixtureScanIds(sessionKey: string) {
  if (sessionKey !== 'scan-a') throw new Error('Unexpected fixture session');
  return { traceId: '1'.repeat(32), spanId: (eventId: string) => {
    if (eventId !== 'event-a') throw new Error('Unexpected fixture event');
    return '2'.repeat(16);
  } };
}
function fixtureNetworkIds(proxyId: number) {
  if (!Number.isSafeInteger(proxyId) || proxyId < 1) throw new Error('Invalid fixture capture');
  return { traceId: proxyId.toString(16).padStart(32, 'a'), spanId: proxyId.toString(16).padStart(16, 'b') };
}
const stamp = '2026-10-19T00:00:00.123456789Z';
const options: LinkedExportOptions = { eventOffset: 0, eventLimit: 100, captureLimit: 20 };
function fixture() {
  const page: TraceExportPage = { session: { id: 'scan-a', provider: 'codex', updatedAt: stamp, durationSource: 'derived' }, offset: 0, limit: 100, declaredEventCount: 1, eventTotal: 1, detailLoaded: true,
    events: [{ id: 'event-a', sequence: 1, kind: 'tool', phase: 'implement', startedAt: stamp, durationMs: 0, status: 'success' }] };
  const identity = (source: 'scan' | 'proxy', eventId: string | null): TraceSourceIdentity => ({ id: source + ':' + eventId, source, sourceKey: source === 'scan' ? 'scan-a' : '9', namespace: 'protocol:openai', kind: 'tool_call', value: source + '-native-id', scope: 'native-session', eventId, sourcePath: '/SECRET/PATH' });
  const linked: LinkedExecutionPage = { sessionKey: 'scan-a', sessionDurationSource: 'derived', events: page.events.map(e => ({ ...e, sessionId: 'scan-a', turnKey: null, title: 'SECRET TITLE', actor: 'agent', tool: null, tokens: null, error: 'SECRET ERROR', model: 'SECRET MODEL', hasInput: true, hasOutput: true, hasRaw: true })),
    eventOffset: 0, eventLimit: 100, eventTotal: 1, eventsHasMore: false, identities: [identity('scan', 'event-a'), identity('scan', null), identity('scan', 'off-page'), identity('proxy', null)],
    identityCompleteness: { complete: true, omittedCount: 0, reasons: [] }, nextCaptureCursor: null, capturesHasMore: false,
    attempts: [{ association: { id: 'assoc', sessionKey: 'scan-a', proxyId: 9, state: 'confirmed', reason: 'user_confirmed', evidenceIds: [], createdAt: stamp, updatedAt: stamp }, matches: [],
      request: { id: 9, requestId: 'original-request-9', method: 'POST', url: 'SECRET URL', hostname: 'SECRET HOST', responseStatus: 201, contentType: 'text/event-stream', isStreaming: true,
        startedAt: stamp, completedAt: '2026-10-19T00:00:02Z', durationMs: 99, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 99, model: 'SECRET MODEL', inputTokens: 99, outputTokens: 99,
        parsedSessionId: 'SECRET PARSED', parserRoute: null, captureGroupId: null, requestFormat: 'unknown', hasSystemPrompt: true },
      transport: { version: 1, state: 'http_error', error: 'SECRET ERROR', requestEnded: true, responseEnded: true, statusCode: 503,
        timing: { version: 1, clock: 'proxy_monotonic', completedMs: 42, responseHeadersMs: null, firstBodyByteMs: null, firstContentMs: null, firstContentKind: null, firstContentBasis: null, contentTimingStatus: 'not_collected', serverTiming: 'SECRET HEADER', serverTimingTruncated: false } } }] };
  return { page, linked };
}
function build(f = fixture(), o = options) { return buildLinkedTraceExport(f.page, f.linked, o, { scan: fixtureScanIds(f.page.session.id), network: fixtureNetworkIds }, stamp); }
function attr(result: LinkedOtlpTraceExport, key: string) { return result.resourceSpans[0]!.resource.attributes.find(a => a.key === 'awesome_telemetry.' + key)!; }
const spans = (r: LinkedOtlpTraceExport, scope = 1) => r.resourceSpans[0]!.scopeSpans[scope]!.spans;
const values = (r: LinkedOtlpTraceExport) => Object.fromEntries(spans(r)[0]!.attributes.map(a => [a.key.replace('awesome_telemetry.', ''), Object.values(a.value)[0]]));

describe('LTX pure OTLP metadata projection', () => {
  it('preserves injected v1 IDs/spans, separate capture IDs and exact privacy allowlist', () => {
    const f = fixture(), r = build(f), native = buildTraceExport(f.page, fixtureScanIds('scan-a'), stamp);
    const span = structuredClone(spans(r, 0)[0]!); span.attributes = span.attributes.filter(a => a.key !== 'awesome_telemetry.identity.native');
    expect(span).toEqual(native.resourceSpans[0]!.scopeSpans[0]!.spans[0]);
    expect(spans(r)[0]).toMatchObject({ ...fixtureNetworkIds(9), status: { code: 0 }, startTimeUnixNano: '1792368000123456789' });
    expect(spans(r)[0]!.traceId).not.toBe(span.traceId);
    expect(stringifyLinkedTraceExport(r)).not.toMatch(/SECRET|parentSpanId|"links"|sourcePath/);
    expect(values(r)).toMatchObject({ 'network.completed_ms': 42, 'network.status_code': '503', 'capture.request_id': 'original-request-9', 'network.scope': 'http_request' });
    expect(readLinkedTraceExportCoverage(r, 'scan-a', options).identity.returned).toBe(4);
  });
  it('attaches native identities only by exact source and event; retains off-page locators', () => {
    const r = build();
    const scanIds = spans(r, 0)[0]!.attributes.find(a => a.key.endsWith('identity.native'))!.value;
    expect(scanIds).toEqual({ stringValue: expect.stringContaining('scan-native-id') });
    expect(values(r)['identity.native']).toContain('proxy-native-id');
    expect(attr(r, 'identity.session').value).toEqual({ stringValue: expect.stringContaining('"eventId":null') });
    expect(attr(r, 'identity.unexported_event').value).toEqual({ stringValue: expect.stringContaining('off-page') });
  });
  it.each([null, 'bad', '2026-10-18T00:00:00Z'])('marks missing/invalid/reversed end %s without claiming instantaneous execution', end => {
    const f = fixture(); f.linked.attempts[0]!.request.completedAt = end; const r = build(f);
    expect(spans(r)[0]!.endTimeUnixNano).toBe(spans(r)[0]!.startTimeUnixNano);
    expect(values(r)).toMatchObject({ 'network.end_state': end === null ? 'end_unknown' : 'end_invalid', 'network.time_basis': 'network_observation_open' });
  });
  it('omits invalid starts while preserving their identity locators and accurate coverage', () => {
    const f = fixture(); f.linked.attempts[0]!.request.startedAt = 'invalid'; f.page.events[0]!.startedAt = 'invalid'; const r = build(f);
    expect(spans(r)).toEqual([]); expect(spans(r, 0)).toEqual([]);
    expect(readLinkedTraceExportCoverage(r, 'scan-a', options)).toMatchObject({ native: { omittedInvalidTime: 1 }, capture: { omittedInvalidTime: 1, returned: 1 }, identity: { returned: 4 } });
    expect(attr(r, 'identity.unexported_capture').value).toEqual({ stringValue: expect.stringContaining('proxy-native-id') });
  });
  it('distinguishes WS connection, legacy unknown and independent monotonic evidence', () => {
    const f = fixture(); f.linked.attempts[0]!.transport!.websocket = { version: 1, scope: 'connection', archive: 'awsp1', requestMessages: 2, responseMessages: 5, clientCloseCode: 1000, upstreamCloseCode: 1000 };
    expect(values(build(f))['network.scope']).toBe('websocket_connection');
    f.linked.attempts[0]!.transport = null;
    expect(values(build(f))).toMatchObject({ 'network.scope': 'legacy_unknown', 'network.transport_state': 'unknown' });
    expect(values(build(f))).not.toHaveProperty('network.status_code'); expect(values(build(f))).not.toHaveProperty('network.completed_ms');
  });
  it('discloses missing manifests and ambiguity without manufacturing unique owner', () => {
    const f = fixture(); f.linked.identityCompleteness = { complete: false, omittedCount: 2, reasons: ['identity_not_collected', 'ambiguous_capture_membership'] };
    expect(readLinkedTraceExportCoverage(build(f), 'scan-a', options).identity).toMatchObject(f.linked.identityCompleteness);
  });
  it.each(['identity_limit', 'response_budget', 'match_limit'])('fails reader truncation %s without clipping IDs', reason => {
    const f = fixture(); f.linked.identityCompleteness = { complete: false, omittedCount: 1, reasons: [reason] }; expect(() => build(f)).toThrow();
  });
  it('fails serialized 512KiB overflow, never clips original identifiers', () => {
    const f = fixture(); f.linked.identities[0]!.value = 'x'.repeat(TRACE_EXPORT_MAX_BYTES);
    const r = build(f); expect(() => stringifyLinkedTraceExport(r)).toThrow();
    expect(f.linked.identities[0]!.value.length).toBe(TRACE_EXPORT_MAX_BYTES);
  });
  it.each(['owner', 'range', 'capture-range', 'scope', 'extra', 'body', 'parent', 'identity-path', 'network-status', 'time', 'coverage', 'nan', 'duplicate-attribute'])('rejects malformed complete payload: %s', mutation => {
    const r = build();
    if (mutation === 'owner') attr(r, 'session.key').value = { stringValue: 'wrong' };
    if (mutation === 'range') attr(r, 'page.limit').value = { intValue: '1' };
    if (mutation === 'capture-range') attr(r, 'capture_page.limit').value = { intValue: '1' };
    if (mutation === 'scope') r.resourceSpans[0]!.scopeSpans[1]!.scope.version = '1';
    if (mutation === 'extra') Object.assign(r, { body: 'SECRET' });
    if (mutation === 'body') spans(r)[0]!.attributes.push({ key: 'awesome_telemetry.body', value: { stringValue: 'SECRET' } });
    if (mutation === 'parent') Object.assign(spans(r)[0]!, { parentSpanId: 'a'.repeat(16) });
    if (mutation === 'identity-path') attr(r, 'identity.session').value = { stringValue: JSON.stringify([{ ...fixture().linked.identities[1] }]) };
    if (mutation === 'network-status') spans(r)[0]!.status.code = 1;
    if (mutation === 'time') spans(r)[0]!.endTimeUnixNano = '-1';
    if (mutation === 'coverage') attr(r, 'capture_page.proxy_ids').value = { stringValue: '[10]' };
    if (mutation === 'nan') spans(r)[0]!.attributes.find(a => a.key.endsWith('completed_ms'))!.value = { doubleValue: NaN };
    if (mutation === 'duplicate-attribute') r.resourceSpans[0]!.resource.attributes.push(attr(r, 'export.version'));
    expect(() => readLinkedTraceExportCoverage(r, 'scan-a', options)).toThrow();
  });
});
