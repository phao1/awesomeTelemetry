# Phase D local telemetry intake (TD-001..006)

TD-001: POST /v1/traces accepts OTLP ExportTraceServiceRequest JSON, optional gzip.
Disabled on every process start; enabling is explicit. Existing remote/Host/Origin
loopback guards apply before ingestion. application/x-protobuf and other encodings
return415 ApiError with OTEL_EXPORTER_OTLP_PROTOCOL=http/json guidance. All failures
use ApiError; success is200 {}. Rejections count requests, accepted spans/traces
count submitted unique span/trace IDs per batch. Reasons are bounded static codes.

TD-002: GET /api/telemetry returns TelemetryStatus (no secret), PUT accepts exactly
{enabled:boolean,requireToken:boolean}; when enabling token authentication generate
32 random bytes, persist to sibling user-config opentelemetry.json mode0600, return
one-time token only in PUT response. Rotate on next explicit enabling; GET never
returns a token. Persist preferences but never auto-enable collection on restart.
No logging credentials, raw request bodies or user-provided rejection strings.
GET/PUT and POST /api/telemetry/import are loopback guarded and no-store.

TD-003: canonical DTOs live verbatim in src/core/telemetry-types.ts and below.
SessionProviderKey = ProviderKey | 'opentelemetry' extends stored sessions only;
the nine scanner ProviderKey/PROVIDER_KEYS and scanner configuration stay unchanged.
Reuse sessions/events and paginated task pipelines, namespace telemetry source paths
as telemetry:<source>:<group-hash>. telemetry_sessions records task root and explicit
agent parent membership; telemetry_spans retains normalized span tree and nullable
usage/endpoints. No fabricated native identities, charges, delegation or communication.
Task origin remains collected (HTTP) or imported (files), source labels distinguish
OpenTelemetry / Langfuse / LangSmith. Event time sentinel '' means unavailable only
inside legacy events; all supplied external times are normalized ISO UTC or null.
Default keeps redacted previews only (2048 chars per direction), never original prose.
No raw retention flag is introduced. Unknown attributes are ignored after bounds
validation; unknown spans remain system steps. Parent links are scoped to trace ID.

TD-004: group by explicit conversation/session then trace; descendants without an
explicit group inherit a unique declared group within their trace. Conflicting trace
groups are not guessed. invoke_agent/OpenInference AGENT creates a member; nearest
retained agent ancestor owns descendants. Unresolved/cyclic ancestry stays main with
warnings; parent span IDs remain intact. Deduplicate by source+trace+span, no unchanged
rewrites or duplicate usage. Update batches atomically. Parent late arrival recomputes
bounded task membership. Missing usage is null; no inclusion/accounting convention is
inferred. Exporter timestamps supply observed model/tool intervals; never measured
network/TTFT. Existing health/comparison/export pipelines remain accessible.

TD-005: file import POST /api/telemetry/import accepts application/json (whole JSON)
or application/x-ndjson (stream line-by-line), detects OTLP resourceSpans, Langfuse
{traces,observations}/observation rows, LangSmith {runs}/run rows. Parse/normalize in
one bounded worker with30s deadline; reject malformed/unrecognized/ambiguous formats
with400 and a clear static reason. No external requests or replay. Entire import
validates before one commit. Existing TraceLog endpoint and raw-file policy unchanged.
Return {format,spanCount,taskIds}. langfuse uses id/traceId/parentObservationId/type/
model/startTime/endTime/sessionId, usageDetails or usage input/output/total;
langsmith uses id/trace_id/parent_run_id/run_type/start_time/end_time/error/inputs/
outputs/prompt_tokens/completion_tokens/extra.metadata/usage_metadata. Documented
snake-case Langfuse blob-export equivalents are accepted. Unknown fields stay unknown.

TD-006: limits: compressed and expanded request8MiB, batch1000 spans, per-task2000,
retained20000 spans/256 tasks, attribute key256 chars/value64KiB,128 attributes per
resource/span/event,128 events/span, nesting32. Persist normalized span <=12KiB,
retained normalized JSON <=32MiB. These are telemetry-only quotas, independent of
native scan rows, capture metadata, original files and total SQLite file length.
telemetry_quota.span_count counts unique retained telemetry span rows across HTTP
and file imports; telemetry_quota.bytes sums their UTF-8 normalized span_json bytes
(including bounded redacted previews), not total DB pages or duplicated projections.
Updates charge only their byte delta; retransmission does not charge again. Default
retention limits are20000 spans,33554432 bytes and256 tasks; no automatic eviction.
Exhaustion returns413 TELEMETRY_QUOTA with the specific quota in its message.

Telemetry admission shares per-DB serialization and fresh SQLite write stamps with
capture admission, but checks ONLY WAL size, never combined database+WAL size.
At WAL>=8000000 bytes attempt at most one nonblocking TRUNCATE checkpoint, then
re-read/revalidate; if still>=8000000 reject413 TELEMETRY_WAL_LIMIT with WAL guidance
(reserving headroom toward the20MB WAL hard budget). Stat/stamp/churn/queue failure
returns503 TELEMETRY_CAPACITY, not a quota or WAL-full claim. Memory DB WAL is0.
Native data may already exceed180MB/200MB: this must not itself block telemetry.
Capture's existing combined180MB/WAL8MB admission is unchanged. The telemetry
exception supersedes applying the global DB-size admission to this pipeline only;
it does not certify the large native DB against legacy global performance budgets.
At any capacity refusal reject without partial mutation/eviction. One intake operation/server; busy429.
Drain workers on shutdown. Use async gzip, worker parsing, cached statements,
coalesced sessions_changed; lists never read previews/raw. No dependencies or CSS.

Public field references:
- https://opentelemetry.io/docs/specs/otlp/
- https://opentelemetry.io/docs/specs/otel/protocol/exporter/
- https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
- https://github.com/Arize-ai/openinference/tree/main/spec
- https://langfuse.com/docs/api-and-data-platform/features/public-api
- https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage
- https://docs.langchain.com/langsmith/run-data-format
- https://docs.langchain.com/langsmith/export-traces

Implementation bounds clarification (same Phase D amendment): one reconstruction
reads/rebuilds at most2000 retained spans and2MiB normalized JSON; larger admissions
return413 before mutation. Quota counters live in telemetry_quota(id=1,span_count,
bytes); telemetry_spans.metadata_json excludes both previews. Metadata-only batch
reads attach TraceEventSlim.telemetry?:TelemetryMetadata. source-reported OTel
submillisecond ISO precision remains in that metadata; legacy event timestamps use
millisecond ISO. File telemetry keeps collected:<otel session key> as a storage
address with origin=imported; origin, not this address, controls task list filtering.
Telemetry source labels remain distinct; nine scanner enum/config stays unchanged.
Vendor end timestamps alone do not establish success. No raw telemetry is retained.

Canonical DTOs:
```ts
import type { TraceKind, TraceStatus } from './trace-types.js';
export type TelemetrySource = 'OpenTelemetry' | 'Langfuse' | 'LangSmith';
export interface TelemetrySpan {
  source: TelemetrySource;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  group: string | null;
  name: string;
  kind: TraceKind;
  operation: string | null;
  agentName: string | null;
  agentId: string | null;
  toolName: string | null;
  toolCallId: string | null;
  userId: string | null;
  model: string | null;
  start: string | null;
  end: string | null;
  durationMs: number | null;
  status: TraceStatus;
  error: string | null;
  input: string | null;
  output: string | null;
  usage: { input: number | null; output: number | null; total: number | null; cacheRead: number | null; cacheWrite: number | null; reasoning: number | null };
}
export interface TelemetryStatus {
  enabled: boolean;
  requireToken: boolean;
  endpoint: string;
  spanCount: number;
  traceCount: number;
  rejectedCount: number;
  reasons: Record<string, number>;
  lastReceivedAt: string | null;
}
export interface TelemetryImportResult { format: TelemetrySource; spanCount: number; taskIds: string[] }

export type TelemetryMetadata = Omit<TelemetrySpan, 'input' | 'output'>;
```

Telemetry charges/context pressure remain unknown even when a local model price
exists: no input/cache or output/reasoning inclusion convention is inferred. Legacy
TraceSession/TraceEvent time strings use '' as the explicit unavailable sentinel;
TaskSummary.startedAt and TelemetryMetadata.start/end retain null at that boundary.
Source span intervals remain observed, with no TTFT or causal/communication claim.

Task API verification: HTTP receiver tasks have origin=collected; file tasks have
origin=imported (both retain collected:otel:<key> storage addresses). Use
GET /api/tasks?origin=collected&range=all or origin=imported&range=all respectively.
GET /api/tasks/:id/summary returns the existing TaskSummary DTO with metrics and
latestHealth (nullable); it reads retained metadata only, performs no hydration,
and has the same local/no-store/ApiError rules as other task routes. Standard
POST /api/tasks/:id/health-reports accepts {mode:'standard',member:'all'} for either
origin. Agent names come from gen_ai.agent.name; no title-based member inference.

LangSmith timestamp clarification (TD-005): valid timezone-free ISO date-times
YYYY-MM-DDTHH:mm:ss[.fraction] in start_time/end_time are interpreted as UTC,
reflecting LangSmith's UTC storage convention. Append Z before parsing; never use
the local process timezone. Explicit Z/offset timestamps keep their meaning.
Malformed/calendar-invalid values remain null and reversed endpoints have unknown
duration. This assumption applies only to LangSmith runs; other formats and the
shared UTC parser still require timezone evidence. TP-006 self-contained tool
presentation uses telemetry endpoint/outcome evidence without a second return row.
