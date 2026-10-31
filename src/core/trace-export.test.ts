import { describe, expect, it } from 'vitest';
import { buildTraceExport, isoUtcToUnixNano, readTraceExportCoverage, stringifyTraceExport, TraceExportLimitError } from './trace-export.js';
import type { OtlpAttribute, TraceExportEvent, TraceExportPage } from './trace-export.js';

const now = '2026-10-19T00:00:00.000Z';
const event = (sequence = 1, extra: Partial<TraceExportEvent> = {}): TraceExportEvent => ({ id: 'event-' + sequence, sequence, kind: 'tool', phase: 'implement', startedAt: now, durationMs: 15, status: 'success', ...extra });
const page = (events = [event()], extra: Partial<TraceExportPage> = {}): TraceExportPage => ({ session: { id: 'scan-key', provider: 'codex', updatedAt: now, durationSource: 'derived' }, detailLoaded: true, declaredEventCount: events.length, eventTotal: events.length, offset: 0, limit: 100, events, ...extra });
const ids = { traceId: '1234567890abcdef1234567890abcdef', spanId: (id: string) => Number(id.split('-')[1]).toString(16).padStart(16, '0') };
const value = (attrs: OtlpAttribute[], key: string) => attrs.find(item => item.key === 'awesome_telemetry.' + key)?.value;

describe('OTLP exact timestamp encoding', () => {
  it('preserves epoch, submillisecond digits and unsigned64 boundary without Number nanoseconds', () => {
    expect(isoUtcToUnixNano('1970-01-01T00:00:00Z')).toBe('0');
    expect(isoUtcToUnixNano('1970-01-01T00:00:01.000000001Z')).toBe('1000000001');
    expect(isoUtcToUnixNano('2026-10-19T00:00:00.123456789Z')).toBe((BigInt(Date.parse(now)) * 1_000_000n + 123456789n).toString());
    expect(isoUtcToUnixNano('2554-07-21T23:34:33.709551615Z')).toBe('18446744073709551615');
    expect(isoUtcToUnixNano('2554-07-21T23:34:33.709551616Z')).toBeNull();
  });
  it.each(['2026-02-30T00:00:00Z', '2026-10-19T24:00:00Z', '2026-10-19T00:00:60Z', '2026-10-19', '2026-10-19T00:00:00+00:00', '1969-12-31T23:59:59.999999999Z', '2026-10-19T00:00:00.1234567890Z', 'invalid'])('rejects invalid/ambiguous or out-of-range timestamp %s', stamp => {
    expect(isoUtcToUnixNano(stamp)).toBeNull();
  });
});

describe('bounded scan observation conversion', () => {
  it('uses only standard top-level OTLP fields and explicitly separates observed duration and IDs', () => {
    const result = buildTraceExport(page(), ids, now);
    expect(Object.keys(result)).toEqual(['resourceSpans']);
    const scope = result.resourceSpans[0]!.scopeSpans[0]!;
    expect(scope.scope).toEqual({ name: 'awesome-telemetry.scan-export', version: '1' });
    const span = scope.spans[0]!;
    expect(span).toMatchObject({ traceId: ids.traceId, spanId: '0000000000000001', name: 'scan.tool', kind: 0, status: { code: 1 } });
    expect(span.startTimeUnixNano).toBe(span.endTimeUnixNano);
    expect(span).not.toHaveProperty('parentSpanId'); expect(span).not.toHaveProperty('links');
    expect(value(span.attributes, 'event.normalized_duration_ms')).toEqual({ doubleValue: 15 });
    expect(value(result.resourceSpans[0]!.resource.attributes, 'session.duration_source')).toEqual({ stringValue: 'derived' });
    expect(readTraceExportCoverage(JSON.parse(stringifyTraceExport(result)), 'scan-key', 0, 100)).toEqual({ offset: 0, limit: 100, returned: 1, eventTotal: 1, omittedInvalidTime: 0, partial: false, hasMore: false, nextOffset: null, detailLoaded: true, countMismatch: false });
  });
  it('does not promote running/cancelled/unknown to success; keeps normalized status', () => {
    const result = buildTraceExport(page(['success', 'error', 'running', 'cancelled', 'unknown'].map((status, i) => event(i + 1, { status: status as TraceExportEvent['status'] }))), ids, now);
    expect(result.resourceSpans[0]!.scopeSpans[0]!.spans.map(span => span.status.code)).toEqual([1, 2, 0, 0, 0]);
  });
  it('represents invalid and zero durations as unknown, never negative or fabricated intervals', () => {
    const result = buildTraceExport(page([0, -1, NaN, Infinity, 1.25].map((durationMs, i) => event(i + 1, { durationMs }))), ids, now);
    const spans = result.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans.map(span => value(span.attributes, 'event.duration_state'))).toEqual(['zero_or_unknown', 'invalid_or_unknown', 'invalid_or_unknown', 'invalid_or_unknown', 'positive_normalized'].map(stringValue => ({ stringValue })));
    expect(spans.every(span => span.startTimeUnixNano === span.endTimeUnixNano)).toBe(true);
    expect(value(spans[1]!.attributes, 'event.normalized_duration_ms')).toBeUndefined();
  });
  it('counts invalid-time rows as consumed so the next page never silently skips or repeats', () => {
    const result = buildTraceExport(page([event(2, { startedAt: 'invalid' }), event(3)], { offset: 1, limit: 2, eventTotal: 5, declaredEventCount: 5 }), ids, now);
    expect(readTraceExportCoverage(result, 'scan-key', 1, 2)).toMatchObject({ returned: 2, omittedInvalidTime: 1, hasMore: true, nextOffset: 3, partial: true });
    expect(result.resourceSpans[0]!.scopeSpans[0]!.spans).toHaveLength(1);
  });
  it('retains empty/unloaded and count-mismatch uncertainty without inventing source completeness', () => {
    const result = buildTraceExport(page([], { detailLoaded: false, declaredEventCount: 3 }), ids, now);
    expect(readTraceExportCoverage(result, 'scan-key', 0, 100)).toMatchObject({ returned: 0, partial: true, detailLoaded: false, countMismatch: true });
    expect(value(result.resourceSpans[0]!.resource.attributes, 'export.source_completeness')).toEqual({ stringValue: 'unknown' });
  });
  it('projects only the allowlist even when runtime inputs contain original/raw text', () => {
    const extraEvent = { ...event(), raw: 'SECRET RAW', inputSummary: 'SECRET INPUT', outputSummary: 'SECRET OUTPUT', title: 'SECRET TITLE', error: 'SECRET ERROR', tool: 'SECRET TOOL', tokens: { total: 123 } };
    const input = page([extraEvent]); Object.assign(input.session, { sourcePath: '/SECRET/PATH', systemPrompt: 'SECRET PROMPT', costUsd: 100 });
    const encoded = stringifyTraceExport(buildTraceExport(input, ids, now));
    expect(encoded).not.toContain('SECRET'); expect(encoded).not.toContain('tokens'); expect(encoded).not.toContain('costUsd');
  });
  it('fails closed on size, page overflow, duplicate generated IDs and invalid generated clocks', () => {
    const huge = page([event(1, { id: '1'.repeat(600_000) })]);
    expect(() => stringifyTraceExport(buildTraceExport(huge, { ...ids, spanId: () => '1'.repeat(16) }, now))).toThrow(TraceExportLimitError);
    expect(() => buildTraceExport(page([event(), event(2)], { limit: 1 }), ids, now)).toThrow(TraceExportLimitError);
    expect(() => buildTraceExport(page([event(), event(2)]), { ...ids, spanId: () => '1'.repeat(16) }, now)).toThrow(TraceExportLimitError);
    expect(() => buildTraceExport(page(), ids, 'bad')).toThrow(TraceExportLimitError);
  });
  it('rejects a mismatched session, range, invalid protocol clock or malformed coverage before download', () => {
    const result = buildTraceExport(page(), ids, now);
    expect(() => readTraceExportCoverage(result, 'other', 0, 100)).toThrow();
    expect(() => readTraceExportCoverage(result, 'scan-key', 1, 100)).toThrow();
    const bad = structuredClone(result); bad.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.endTimeUnixNano = '1';
    expect(() => readTraceExportCoverage(bad, 'scan-key', 0, 100)).toThrow();
    const duplicate = structuredClone(result); duplicate.resourceSpans[0]!.resource.attributes.push(duplicate.resourceSpans[0]!.resource.attributes[1]!);
    expect(() => readTraceExportCoverage(duplicate, 'scan-key', 0, 100)).toThrow();
  });
});
