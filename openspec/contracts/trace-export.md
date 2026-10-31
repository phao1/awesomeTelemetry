# Contract: local OTLP JSON trace export v1

M11 functional increment, original fuse-agent-monitoring task13.1 remains open
for cross-source export. This additive contract authorizes only the files in
`trace-export-feature.md`; it does not change existing normalized types or APIs.

## TX-001 Standard payload and identity

Download an OTLP `ExportTraceServiceRequest` JSON object (`resourceSpans`), not
a proprietary wrapper. lowerCamelCase keys; trace/span IDs use lowercase hex
(32/16 characters, nonzero); enums are integers; fixed64 times/int64 attributes
are decimal strings. Scope name `awesome-telemetry.scan-export`, version `1`.
Generated traceId = first32 SHA256 hex of JSON.stringify
`["awesome-telemetry.scan-export",1,"trace",sessionKey]`; spanId = first16 of
`["awesome-telemetry.scan-export",1,"span",sessionKey,eventId]`. All-zero digest
prefix substitutes a final `1`. These are export grouping IDs, NOT native or
propagated IDs. Same normalized event across pages has stable identity; different
source session keys remain distinct. No parentSpanId, links, synthetic root,
retry, native identity claim, scan/proxy merge or inferred causal relation.

## TX-002 Observation timestamps/status

A span represents a retained scan event **observation**, not an instrumented
execution. `name=scan.<kind>`, kind=0 (UNSPECIFIED); start=end=the observed ISO UTC
instant. Point spans deliberately do not claim measured instantaneous execution.
The original normalized duration is an attribute only: finite nonnegative values
are `doubleValue`, with state `positive_normalized` or `zero_or_unknown`;
invalid/negative/nonfinite is omitted with state `invalid_or_unknown`.
Session duration declaration is separate and never per-event measurement proof.
No model/network duration, token or money totals are synthesized.

Accept strict YYYY-MM-DDTHH:mm:ss[.1..9 digits]Z, validate calendar components;
convert seconds to BigInt*1e9 plus fractional digits padded to9. Require unsigned
fixed64 range. Invalid/out-of-range timestamp omits that span, increments omitted
count, and marks partial; never substitute now/epoch. Export-generated timestamp
remains ISO UTC. This isolated OTLP wire conversion is the explicit exception to
project ISO timestamp convention; normalized/storage timestamps remain unchanged.
Normalized `success` -> status.code1, `error` ->2, running/cancelled/unknown ->0;
retain normalized status as an attribute. No exception text or success inference.

## TX-003 Bounded retained metadata snapshot

GET `/api/sessions/:key/trace-export?offset=0&limit=100`, default100/max200,
offset0..1000000; canonical unsigned safe decimal only, no duplicate/unknown
query parameters. Key nonempty<=1024characters. Existing local connection/Host/
Origin guard and foreground marking MUST be applied by server wiring.
One synchronous read transaction, exactly3 cached metadata SELECTs (session,
count, ordered sequence page); no writes/source IO/lazy parse/raw/body/identity/
proxy reads. Use subsets of existing SESSION_LIST_COLS/EVENT_SLIM_COLS and the
existing duration_source scalar. Only id/provider/updated_at/detail_loaded/
event_count/duration_source and event id/sequence/kind/phase/started_at/
duration_ms/status are read. Never read title/error/tool/input/output/raw.

200 application/json attachment with generated safe filename, no-store and
existing gzip behavior. At most512KiB UTF8 serialized JSON; if exceeded, fail503
EXECUTION_METADATA_LIMIT, no silent field clipping. Missing/non-scan404
SESSION_NOT_FOUND; invalid query400 BAD_REQUEST; read failure500 INTERNAL_ERROR.
All failures use existing unified ApiError/static messages (no paths/input).

Resource attribute prefix `awesome_telemetry.` (below abbreviated `at.`):
- service.name=`awesome-telemetry`; at.export.version intValue1;
  at.export.source=`scan`; at.export.id_basis=`generated_normalized_keys`;
  at.export.scope=`retained_scan_metadata_page`; at.export.bodies_included=false;
  at.export.generated_at=ISO UTC; at.session.key=normalized key;
  at.session.provider=provider; at.session.updated_at=retained ISO UTC;
  at.session.duration_source=measured/derived/unknown;
- at.page.offset/limit/returned/event_total/omitted_invalid_time: intValue;
  at.page.next_offset: intValue only when more rows remain;
  at.page.has_more/partial/detail_loaded/count_mismatch: boolValue.
- at.export.source_completeness=`unknown`: detail-loaded/count consistency never
  certify complete source history. partial=true when offset>0, more retained rows,
  omitted timestamps, detail not loaded or index/retained count mismatch. false
  means all currently retained metadata covered, not full original history.

Span attributes: at.event.id (normalized, never claimed native), at.event.sequence
intValue, at.event.kind/phase/status strings, at.event.duration_state string,
at.event.normalized_duration_ms optional doubleValue, at.event.time_basis=
`scan_observation_point`. Native IDs, titles, errors, prompts, paths, headers,
body text/raw, input/output, tokens and fees are excluded. User downloads cannot
be revoked. Independent pages are live snapshots, not a consistent multi-page
archive; no automatic pagination or collector upload.

## TX-004 UI ownership

Explicit action only, editable offset/limit, no IO on mount/locale/invalidation.
One request/10s owned deadline/cancel/explicit retry. Change session, range,
invalidation or unmount aborts and suppresses late downloads. Show retained
coverage/partial status and unknown original completeness, selected scan scope,
observation-point timing, excluded bodies/proxy data and local-only semantics in
both zh/en. Download success means browser download requested, not saved.
Use local dictionaries in the new component because shared i18n is outside scope.
The parent MUST pass invalidation and hide/disable for non-scan/offline data.

## Frozen TypeScript types

The following are defined verbatim in src/core/trace-export.ts (import existing
TraceEventSlim/TraceSession types; no new trace-types.ts fields):

```ts
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
```

## Official references (checked2026-10-19)

- [OTLP JSON encoding](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding):
  hex IDs, numeric enums, lowerCamelCase and decimal-string fixed64.
- [Trace protobuf](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/trace/v1/trace.proto):
  ResourceSpans/ScopeSpans/Span, nanosecond timestamps and status enum.
- [Export request protobuf](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/collector/trace/v1/trace_service.proto).
- [ProtoJSON](https://protobuf.dev/programming-guides/json/): int64 precision and
  AnyValue primitive field encoding. No extra runtime package.
