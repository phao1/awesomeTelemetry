# Linked OTLP metadata export v2

This additive derived-export contract freezes LTX-001..005. It adds no native,
storage or root DTO fields and leaves TX-001..004 and the v1 literal scope intact.
Inputs are existing TraceExportPage and LinkedExecutionPage verbatim.

## LTX-001 Read and HTTP boundary
GET `/api/sessions/:key/linked-trace-export`. Canonical safe decimal parameters:
eventOffset default0 max1000000, eventLimit default100 range1..200,
captureCursor optional positive safe integer, captureLimit default20 range1..50.
Unknown/duplicate/invalid params400 BAD_REQUEST, key nonempty<=1024. Missing or
non-scan404 SESSION_NOT_FOUND. Read errors500 INTERNAL_ERROR. Limit failures503
EXECUTION_METADATA_LIMIT. Unified ApiError; static errors without source paths.
Parent server applies local connection/Host/Origin guard and foreground marking.
No-store, gzip via existing sender, application/json attachment, <=512KiB UTF8
uncompressed JSON, otherwise fail without clipping identifiers.
One outer synchronous SQLite read transaction reuses readTraceExportPage (3
SELECTs) and getLinkedExecution (<=8 SELECTs). Nested savepoints share snapshot.
No source IO/body queries/writes/N+1/new association algorithm. Reject reader
identity_limit/response_budget/match_limit or mismatching native pages; existing
manifest incompleteness remains faithfully disclosed (not silently repaired).

## LTX-002 Standard OTLP structure and IDs
Exactly one resourceSpans with resource.attributes and two scopeSpans:
`awesome-telemetry.scan-export` version`1`, then
`awesome-telemetry.linked-network-export` version`2`. Separate LinkedOtlpTraceExport
uses existing OtlpAttribute/OtlpExportSpan, never widening OtlpTraceExport.
Scan builder/IDs reuse buildTraceExport and traceExportIds unchanged.
Network trace/span IDs are nonzero lowercase first32/16 SHA256 of JSON.stringify
["awesome-telemetry.linked-network-export",2,"trace"|"span","proxy",numericProxyId].
All-zero prefix substitutes final1. Selected session/request membership never
changes these IDs. Each capture is its own trace, no parentSpanId/links/causal/
retry synthesis or unique-owner claim. No counting/token/fee merge.

## LTX-003 Metadata allowlist and clock semantics
All attributes use `awesome_telemetry.` except service.name. Resource retains
v1 attributes except export.version=2, export.source=scan_and_proxy,
export.scope=linked_metadata_pages, export.id_basis=generated_source_keys.
Additional strings: export.snapshot=single_read_live_page,
export.retry_identity=unknown, export.association_semantics=membership_only.
Bodies=false; source completeness=unknown regardless of retained coverage.
Native identities are JSON-string arrays of exactly namespace/kind/value/scope/
eventId/source/sourceKey (existing values; omit internal id and sourcePath).
`identity.session` holds scan identities with null eventId; scan span
`identity.native` attaches by exact eventId; network span `identity.native`
attaches by proxy sourceKey. Resource `identity.unexported_event` and
`identity.unexported_capture` retain locators for off-page/invalid-time records.
Resource identity.complete bool, identity.omitted_count int, identity.reasons
JSON-string array preserve original completeness. identity.returned int counts
all retained identifiers, including those outside exported spans. No clipping.
Source body/title/error/headers/URL/model/token/cost/path fields never copied.

Network spans name=network.capture, kind=0, status.code=0 always. Attributes:
capture.source=proxy, capture.proxy_id int, capture.request_id original string;
association.id/state/reason/session_key strings preserve membership only;
network.scope=websocket_connection/http_request/legacy_unknown (WS if retained
websocket exists, HTTP if retained transport exists, unknown if absent);
network.transport_state existing state or unknown; network.status_code actual
transport.statusCode int only if observed, never legacy/synthetic substitute;
network.end_state=end_known/end_unknown/end_invalid; network.time_basis=
network_observed_interval (valid end) or network_observation_open (unknown/invalid).
start/end fixed64 via isoUtcToUnixNano. Missing/invalid/inverted end uses start
point with explicit unknown/invalid state; never instantaneous execution.
Invalid start omits span and increments capture_page.omitted_invalid_time.
network.completed_ms optional finite nonnegative known proxy-monotonic value,
network.completed_ms_basis=proxy_monotonic; never derived from wall-clock or
labelled model/inference time. No transport.error or raw timing server headers.

## LTX-004 Independent coverage and validation
Native page.* attributes remain v1 semantics. Capture resource attributes:
capture_page.cursor int only if supplied; capture_page.limit/returned/
omitted_invalid_time int; capture_page.has_more/partial bool;
capture_page.next_cursor int only if has_more; capture_page.proxy_ids JSON array
of all read IDs in descending order, including invalid-start records. Partial
means supplied cursor, more records or omitted time. No capture total invented.
Native and capture pages are independent live snapshots; multiple downloads do
not imply consistent archive. Source originals remain independently available
through existing original/evidence downloads, never deleted/modified here.
Client streams <=512KiB, then validates exact OTLP structure, allowed attributes,
AnyValue types, clocks/IDs/status/scopes, identity locators, session owner and
both requested ranges before creating a Blob download. Extract/adapt only scan
scope/resource version tags for the unmodified v1 coverage validator.

## LTX-005 UI
Independent bilingual lazy panel; mount/open/locale/invalidation zero IO. Three
labelled inputs: native offset, native limit, capture cursor (empty first batch),
capture limit fixed20. Explicit Download with10s owned wait/cancel/explicit retry.
Session/range/invalidation/unmount suppress late results. Next-native and
next-capture actions only edit respective form values, never download. Expose
both coverage domains, missing identities/reasons, unknown completeness and
no causal/unique-owner/billing claims. Local download requested is not proof of
saved file. No collector upload/model/tool execution. Component imports own CSS.
