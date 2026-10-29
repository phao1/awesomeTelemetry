# Contract: Data Model

## Native session family exploration (M11 functional increment)

```ts
export interface NativeSessionFamilyPage {
  session: NativeSessionParentPage['items'][number]['matches'][number];
  parents: NativeSessionParentPage;
  children: Array<{
    session: NativeSessionParentPage['items'][number]['matches'][number];
    identity: TraceSourceIdentity;
    state: NativeSessionParentPage['items'][number]['state'];
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  completeness: IdentityCompleteness;
}
```

One selected scan session, existing parent declarations and one page of sessions
retaining its exact native identity as parent. Children keep a real parent_session
identity/locator; duplicate locators do not duplicate the child. Resolution needs
complete unique native owners and explicit child scope. Ambiguous/incomplete/self
claims remain non-resolved. No inferred recursion, spawn/communication/retry IDs,
model/time/hash matching or cost fields. Existing LinkedExecutionPage supplies
independent attempts and event matches; absent retry declarations mean unknown,
including failed-then-completed captures. Source originals remain independent.

## Codex WebSocket per-call inspection (no schema change)

```ts
export interface CodexCallSummary {
  sequence: number;
  streamId: string | null;
  responseId: string | null;
  previousResponseId: string | null;
  predecessorSequence: number | null;
  model: string | null;
  warmup: boolean;
  nativeSessionId: string | null;
  nativeTurnId: string | null;
  startedAt: string;
  startedMs: number;
  firstContentMs: number | null;
  durationMs: number | null;
  state: 'completed' | 'incomplete' | 'failed' | 'pending';
  usage: Omit<ProxyNativeUsage, 'snapshots'>;
  proposedToolIds: string[];
  returnedToolIds: string[];
  reasons: string[];
}
export interface CodexCallPage {
  requestId: string;
  active: boolean;
  fingerprint: string;
  items: CodexCallSummary[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  complete: boolean;
  reasons: string[];
  unassignedEvents: number;
}
export interface CodexNativeLink {
  state: 'linked' | 'missing' | 'ambiguous' | 'incomplete' | 'blocked';
  sessionKey: string | null;
  matches: Array<{ eventId: string; kind: 'response' | 'tool_call' | 'turn'; value: string; sourcePath: string }>;
}
export interface CodexCallDetail {
  contextDiff: CodexContextDiff | null;
  contextDiffUnavailableReason: 'no_predecessor' | 'base_outside_projection' | 'normalization_failed' | null;
  requestId: string;
  active: boolean;
  fingerprint: string;
  call: CodexCallSummary;
  analysis: ProxyProtocolAnalysis;
  native: CodexNativeLink;
  toolReferences: Array<{ callId: string; proposalSequence: number | null }>;
  requestPreview: string;
  requestPreviewTruncated: boolean;
}
export interface CodexContextDiff {
  baseSequence: number;
  categories: ContextCategoryDiff[];
  growth: ContextGrowth;
  indicators: ContextIndicator[];
  completeness: ContextCompleteness;
  noChange: boolean;
}

```

Sequence is zero-based observed response.create order inside ONE connection,
not a native turn/call/billing ID. Named stream_id lanes are FIFO; response IDs
and lane evidence bind events. Missing/contradictory IDs never use timestamps to
guess. Warmup is exactly generate=false, not a zero-token heuristic. Previous
response is observed lineage, not retry/execution proof; predecessorSequence
only when exactly one earlier response matches. Unknown full inherited context
is never reconstructed from an incremental input. Reused response IDs mark all
affected calls ambiguous; ambiguous calls have unknown usage.

startedAt is ISO UTC from observed connection epoch + monotonic create offset.
startedMs is connection-relative; firstContentMs/durationMs are CALL-relative
nonnegative integer proxy observations, not provider inference/tool execution.
Missing stays null. Terminal completed/failed/incomplete is protocol-only, not
Agent success; a later connection interruption cannot undo an observed call
terminal. Usage snapshots replace counters; cache/reasoning are OpenAI subsets.
No cross-source token sum or price inferred here.

Each list is metadata-only, <=20 calls/page. Detail alone includes bounded
request preview and existing analysis limits; exact original containers remain
separate. Tool references mean an observed later input mentions the same call_id,
not proof the tool ran/succeeded. Native session/turn comes from explicit Codex
client_metadata or x-codex-turn-metadata; conflicting session/thread/header
declarations become unknown. Never inherit the handshake turn for every call.
Unique complete native owner may expose exact scoped response/tool/turn bindings;
missing/ambiguous/incomplete manifests never generate a native event match.
Retained rejected/revoked membership decisions return blocked, not a revived
automatic session link; selected native metadata stays independently retained.

The existing WS capture worker may retain agent:codex session declarations from
complete bounded request-archive messages/upgrade headers. Locators reference the
actual client_metadata session_id/thread_id or embedded x-codex-turn-metadata
field. Request preview truncation/conflict invalidates manifest completeness.
This supplies existing session membership suggestions, not a connection-level
model call, native tool execution or additional charged usage.

Codex's per-call semantic adapter maps custom_tool_call.input to the existing
tool_call content, custom_tool_call_output to tool_result and
response.custom_tool_call_input delta/done to argument-content assembly. It
never rewrites original frames; indices/container source locators are unchanged.
This is a Codex WS projection, not a changed HTTP capture parser epoch.

Context diff reuses the existing bounded normalizer/diff engine against ONE
explicit previous-response call, only if its request fits the2MiB previous-input
cache. Null reason is success; absent/outside/normalization failure is explicit.
Only compares observed transmitted payloads; never interprets incremental input
shrink as compaction/context loss. Suppress inferred shrink/loss indicators when
previous_response_id is present; measured usage delta remains source-reported.

## TraceLog imports (schema19)

Independent offline evidence, never native sessions/proxy requests or billing.
`id` is SHA256 of exact inner JSON. Strings are source reported; absent/invalid
numbers and timestamps are null. Project timestamps require explicit timezone,
converted to ISO UTC milliseconds; original precision/shape remains in source.
Metadata strings <=512 UTF-16 units (title clipped with ellipsis; identifiers
over limit rejected). Each projected turn <=2048 UTF-8 bytes. Raw session/turn
objects preserve unknown fields; no automatic decoding changes stored originals.

```ts
export interface TraceLogSession {
  id: string;
  fileName: string;
  sourceMember: string | null;
  importedAt: string;
  source: CaptureBodyRef;
  nativeSessionId: string | null;
  ideType: string | null;
  model: string | null;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  turnCount: number;
}
export interface TraceLogTurn {
  sequence: number; // zero-based file order, not inferred native turn_number
  turnId: string | null;
  turnNumber: number | null;
  model: string | null;
  requestTime: string | null;
  responseTime: string | null;
  isError: boolean | null;
  reported: Record<string, number | null>; // only allowlist below
  hasOutput: boolean;
}
export interface TraceLogPage<T> { items: T[]; offset: number; limit: number; hasMore: boolean }
export interface TraceLogImportResult {
  items: { state: 'imported' | 'duplicate'; session: TraceLogSession }[];
  ignoredEntries: number;
}
export interface TraceLogTurnDetail {
  sessionId: string;
  sequence: number;
  session: Record<string, unknown>;
  raw: Record<string, unknown>;
}
```

`reported` keys verbatim: input_tokens,output_tokens,cache_creation_tokens,
cache_read_tokens,thoughts_token_count,total_tokens,ttft_ms,tpot_ms,tps,
e2e_latency_ms,model_inference_ms,tool_time_ms,tool_call_count. Source-reported
nonnegative finite numbers only, otherwise null. Never reinterpret totals/cache
inclusion or tool_time_ms as measured execution; no cross-source aggregation.
Internal indexed turn adds byte_offset,byte_length,body_sha256; internal session
object offset/length/session_sha256 is kept in manifest, not duplicated raw
content in SQLite. Selected detail verifies both bounded object digests.

## Explicit offline capture reparse (schema18)

```ts
export interface CaptureReparseSnapshot {
  parserVersion: number;
  metricVersion: number;
  sourceFingerprint: string;
  parsedAt: string;
  requestFormat: RequestContextFormat;
  state: ProxyProtocolAnalysis['state'];
  usage: Omit<ProxyNativeUsage, 'snapshots'>;
  completeness: ProxyProtocolAnalysis['completeness'];
}
export interface CaptureReparseStatus {
  proxyId: number;
  requestId: string;
  currentParserVersion: number;
  currentMetricVersion: number;
  state: 'not_parsed' | 'current' | 'stale' | 'unavailable';
  unavailableReason: 'originals_deleted' | 'originals_missing' | 'originals_incomplete' | 'originals_invalid' | null;
  snapshot: CaptureReparseSnapshot | null;
}
export interface CaptureReparseResponse {
  status: CaptureReparseStatus;
  analysis: ProxyProtocolAnalysis;
}
```

Versions are positive safe integers; current parser=3,capture-metric=1,independent
of scan METRICS_CALC_VERSION. parsedAt is ISO8601 UTC. Snapshot<=8192UTF8 bytes,
completeness reasons<=32 strings each<=128characters,nonnegative safe omittedCount;
usage has only nullable safe nonnegative counts and frozen accounting enum.
No native snapshots/content/system/tools/error messages/headers/file paths in
persisted summary. Full analysis is returned once,not stored as another body.

Fingerprint is lowercase SHA256 of UTF8 JSON.stringify of this ordered array:
`[1,requestId,requestFormat,hostname,url,ttnetEncrypted,isStreaming,
[requestRef.id,requestRef.bytes,requestRef.sha256,requestRef.status],
[responseRef.id,responseRef.bytes,responseRef.sha256,responseRef.status],
requestEncoding,responseEncoding,
transport ? [transport.version,transport.state,transport.error,
transport.requestEnded,transport.responseEnded,transport.statusCode] : null]`.
Encoding is exact observed content-encoding string,array joined by comma,or null
when absent,using case-insensitive header lookup without rewriting headers.
Fingerprint binds parser inputs,not unused timing/other headers; not a call ID.

Two valid complete UUID/SHA/byte refs are required. GETstatus is metadata-only;
deleted/missing/incomplete/invalid refs mean unavailable with null snapshot.
Otherwise no snapshot=not_parsed,versions/ref mismatch=stale,else=current.
Current means versions/reference metadata match the last successful reparse,
not fresh file verification or Agent/protocol success. POST verifies actual
original bytes/digest/decode with no legacy fallback. Body-valid unknown/failed/
incomplete protocol remains a legitimate result. Same proxy_id update,no new
call/charge or original/native/scan metric mutation. Fresh identity/ref/deletion
checks prevent stale commits. Confirmed body deletion clears summary atomically
with intent. Reparse is not detached archive import or external execution replay.

> Capture amendment (2026-10-15, user approved): monitoring preserves original request/response headers, URLs, bodies, prompts and tool data without redaction. This supersedes earlier monitoring redaction/raw-opt-in wording. Existing redaction utilities remain optional and are bypassed by monitoring. CA private keys are not capture payload.

## Original body storage types (fuse-agent-monitoring)

### Native identity and session association (fuse-agent-monitoring)

Incomplete identity manifests cannot produce automatic direct associations; matching IDs may produce candidates with the incompleteness reason. An automatic direct session association does not alone identify a specific model call/tool execution.

Automatic suggestions are capped at32 scan candidates per proxy attempt; native identity evidence itself remains retained and paged. Existing automatic candidates have priority while still matching. Direct links require uniqueness across the full matching set, never merely the first page. Users can explicitly associate any eligible existing scan session beyond the suggestion cap. Candidate counts count stored suggestions, not every mathematically possible pairing.

```ts
export type NativeIdentityKind = 'session' | 'turn' | 'message' | 'request' | 'response' | 'tool_call' | 'trace' | 'span' | 'parent_session' | 'parent_span';
export interface NativeIdentity {
  namespace: string;
  kind: NativeIdentityKind;
  value: string;
  scope: string | null;
  eventId: string | null;
  sourcePath: string;
}
export interface IdentityCompleteness {
  complete: boolean;
  omittedCount: number;
  reasons: string[];
}
export interface NativeIdentitySet {
  parserVersion: number;
  items: NativeIdentity[];
  completeness: IdentityCompleteness;
}
export interface TraceSourceIdentity extends NativeIdentity {
  id: string;
  source: 'scan' | 'proxy';
  sourceKey: string;
}
export interface TraceIdentityPage {
  source: 'scan' | 'proxy';
  sourceKey: string;
  parserVersion: number | null;
  items: TraceSourceIdentity[];
  completeness: IdentityCompleteness;
  nextCursor: string | null;
  hasMore: boolean;
}
export type TraceAssociationState = 'direct' | 'candidate' | 'confirmed' | 'rejected' | 'revoked';
export interface TraceAssociation {
  id: string;
  sessionKey: string;
  proxyId: number;
  state: TraceAssociationState;
  reason: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface TraceAssociationDecision {
  sequence: number;
  associationId: string;
  state: 'confirmed' | 'rejected' | 'revoked';
  note: string | null;
  decidedAt: string;
}
export interface SessionCaptureLinkPage {
  sessionKey: string;
  items: Array<{ association: TraceAssociation; request: ProxyRequestListItem }>;
  confirmedCount: number;
  candidateCount: number;
  nextCursor: number | null;
  hasMore: boolean;
}
export interface ProxyTraceLinkPage {
  proxyId: number;
  items: TraceAssociation[];
  nextCursor: string | null;
  hasMore: boolean;
}
```

TraceRecord gains optional nativeIdentities: NativeIdentitySet. Only adapters that collected explicit source fields supply it. Missing data is not inferred from record.session.id (which may be a filename fallback), generated event IDs or turnKey. Scope is an opaque native session ID when present, never captureGroupId. Auto association uses only exact single unambiguous session IDs in agent:<provider> namespaces; response/message/tool IDs alone never prove session membership. Candidate/direct are system decisions; confirmed/rejected/revoked are persistent user decisions. Evidence IDs reference retained source identities. Original sources and request attempts remain independent; this association is not a new charged call or a team run.

On-demand protocol analysis uses the following types in addition to body refs. It is derived evidence, not a native tool execution trace. Request items describe observed history; response tool_call describes a model proposal, never execution. sourcePath points into request/JSON response or the decoded SSE event index. Public reasoning only is exposed; encrypted/hidden reasoning is not invented.

```ts
export interface ProxyProtocolItem {
  phase: 'request' | 'response';
  kind: 'text' | 'reasoning' | 'tool_call' | 'tool_result';
  id: string | null;
  callId: string | null;
  name: string | null;
  index: number | null;
  choiceIndex: number | null;
  content: string;
  toolResultIsError: boolean | null;
  complete: boolean;
  sourcePath: string;
}

// toolResultIsError preserves a native boolean only on Messages request
// tool_result blocks; absent/invalid/other shapes are null. False is not proof
// of tool success. True reports a failure at sourcePath + '.is_error', without
// changing the independent network/protocol state or observed content.
// Framework-generated item source locators (fixed grammar + bounded indices,
// never user content) remain exact independently of the 262144 display-content
// character pool. Record and serialized-response bounds still apply; exhausting
// displayed content must not turn a retained flag into a false '.is_error' path.
// The on-demand analysis parser version is 3 after this projection change.
export interface ProxyToolDeclaration {
  name: string | null;
  type: string;
  definition: string;
  sourcePath: string;
}

export interface ProxyNativeUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  nativeTotalTokens: number | null;
  totalTokens: number | null;
  accounting: 'openai_subsets' | 'anthropic_additive_input' | 'unknown';
  snapshots: Array<{ eventIndex: number | null; value: string }>;
}

export interface ProxyProtocolAnalysis {
  parserVersion: number;
  requestFormat: RequestContextFormat;
  model: string | null;
  responseId: string | null;
  state: 'completed' | 'incomplete' | 'failed' | 'unknown';
  stopReason: string | null;
  system: string | null;
  declarations: ProxyToolDeclaration[];
  items: ProxyProtocolItem[];
  usage: ProxyNativeUsage;
  errors: Array<{ code: string | null; message: string; sourcePath: string }>;
  unknownEvents: number;
  completeness: { complete: boolean; omittedCount: number; reasons: string[] };
}
```

Usage is protocol-native: OpenAI cache/reasoning are subsets, never added again. Anthropic cache read/write are separate input categories; derive total only when input/output/read/write are all known. Missing/invalid counters are null, zero is valid. Snapshots overwrite known fields rather than sum repeated events; retain bounded native snapshots as evidence. A clean transport EOF alone does not prove protocol completion. Analysis permits at most 2MiB per source, 1024 projected records, 262144 content characters, 32768 characters per value, 32 usage snapshots and 1MiB serialized result. Exceeding a projection bound sets completeness=false with an explicit reason; originals are unchanged.

Body refs contain no body text or filesystem paths. sha256 covers exactly the accepted, successfully written prefix, not missing bytes. All limits are positive safe integers. usedBytes includes in-flight reservations and completed/crashed files; pendingBytes measures queued copies. On exhaustion, retain previous files and stop new collection with explicit status. finish is idempotent; append after finish is rejected. A store has one process owner per directory.

Internal file-layer operation `CaptureBodyStore.removeOriginals(ids: readonly
string[]): Promise<number>` accepts at most two validated UUID body IDs, with
duplicates removed. It deletes only their regular `.body`/`.part` files under
the owned directory; never recursively removes a directory, follows a symlink
or touches unrelated files. Missing paths are idempotent. It refuses while any
writer, read stream, recovery or other removal owns the store, and prevents new
read/write/recovery admission until reconciliation completes. Reconcile quota
by streaming the owned file directory after success OR partial failure, with
no whole-directory array. The returned number is the nonnegative reduction of
accounted `usedBytes`, not a claim about filesystem allocation blocks. Failure
throws, keeps surviving files charged and does not report complete success.
This internal primitive does not itself authorize deleting evidence: no public
route may call it until a confirmed durable deletion intent prevents journal
resurrection and a coordinator handles restart/partial cleanup. That coordinator
must keep the monitor stopped and serialize new monitor starts throughout
maintenance; the file-layer busy exception is not a network fail-open mechanism.
Default expiry
and retention do NOT call it. No public DTO/status shape changes in this gate.

The durable original-deletion queue (schema16) exposes the following
metadata-only projection. With confirmed API integration, `complete` means
original files and stored proxy body/prompt copies are removed. Request/header/
native/export metadata is retained; this is not full request/forensic erasure. Admission
requires a stopped/exclusively owned monitor, explicit confirmation by the
caller, current proxy ID + exact expected request ID and two valid UUID/digest
body refs. Persist both full refs and exact configured store directory internally,
never in this projection. Reject shared body IDs, unsupported refs, conflicts or
capacity before writing intent. State transitions: pending→complete/failed;
explicit run retries failed, resumePending handles pending only, completed is
idempotent. Never auto-expire/delete queue records or invoke from retention.

```ts
export interface OriginalDeletionJob {
  id: string;
  proxyId: number;
  requestId: string;
  state: 'pending' | 'failed' | 'complete';
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

Confirmed-body API integration: this projection is used by the per-request
GET/POST original-deletion route in api.md. Complete means original files and
proxy body/prompt copies removed, NOT full request/header/native/export erasure.
Original capture refs remain historical observed status/digest/bytes; a deletion
job independently records current body unavailability. Confirmed intent blocks
new body/analysis/diff access regardless of job success. Pending/failed remain
visible/retryable; no automatic default expiry. Web confirmation/status/cache
invalidation is defined by frontend REQ-020 and api.md's explicit POST.

```ts
// fuse-agent-monitoring: original byte storage, independent of analysis limits.
export type CaptureBodyStatus =
  | 'complete'
  | 'body_limit'
  | 'quota_exceeded'
  | 'queue_full'
  | 'write_error'
  | 'interrupted';

export interface CaptureBodyRef {
  id: string;
  bytes: number;
  sha256: string;
  status: CaptureBodyStatus;
  error: string | null;
}

export interface CaptureStorageConfig {
  quotaBytes: number;
  maxBodyBytes: number;
  maxPendingBytes: number;
}

export interface CaptureStorageStatus extends CaptureStorageConfig {
  usedBytes: number;
  pendingBytes: number;
  activeBodies: number;
  exhausted: boolean;
}

/** Read-only actual file sizes, not available filesystem capacity or freed space. */
export interface CaptureMetadataCapacity {
  databaseBytes: number | null;
  walBytes: number | null;
  combinedLimitBytes: number;
  walLimitBytes: number;
  combinedAdmissionBytes: number;
  walAdmissionBytes: number;
  state: 'ready' | 'limited' | 'unavailable';
  reason: 'database_limit' | 'wal_limit' | 'stat_error' | null;
  checkedAt: string;
}

export interface ProxyCaptureBodies {
  request: CaptureBodyRef | null;
  response: CaptureBodyRef | null;
  requestPreviewTruncated: boolean;
  responsePreviewTruncated: boolean;
  responseHeaders: Record<string, string | string[]>;
  /** Absent only for legacy/manual fixtures; current MITM records always supply it. */
  processing?: CaptureProcessingResult;
  /** Absent for legacy/manual records, not inferred as successful. */
  transport?: CaptureTransportResult;
}

export interface CaptureTransportResult {
  version: 1;
  state: 'completed' | 'http_error' | 'network_error' | 'timeout' | 'cancelled' | 'interrupted';
  error: string | null;
  requestEnded: boolean;
  responseEnded: boolean;
  /** Actual upstream status; null before any upstream headers, never a synthetic local status. */
  statusCode: number | null;
  /** Optional for legacy captures; a missing timing is unknown. */
  timing?: CaptureNetworkTiming;
  /** Connection observation, NOT one model call or wire-frame archive. */
  websocket?: CaptureWebSocketConnection;
}

export interface CaptureWebSocketConnection {
  version: 1;
  scope: 'connection';
  archive: 'awsp1';
  requestMessages: number;
  responseMessages: number;
  /** Observed socket close codes; null when not observed before settlement. */
  clientCloseCode: number | null;
  upstreamCloseCode: number | null;
}

export interface CaptureNetworkTiming {
  version: 1;
  clock: 'proxy_monotonic';
  responseHeadersMs: number | null;
  firstBodyByteMs: number | null;
  firstContentMs: number | null;
  firstContentKind: 'text' | 'reasoning' | 'tool_arguments' | null;
  firstContentBasis: 'sse_event_dispatch' | 'json_document_complete' | null;
  completedMs: number | null;
  contentTimingStatus: 'observed' | 'no_content' | 'not_collected' | 'unsupported_encoding' | 'preview_limit' | 'decode_error';
  serverTiming: string | null;
  serverTimingTruncated: boolean;
}

/** Internal durable journal only. Never returned on list/SSE/API or exported as a body. */
export interface CaptureJournalEntry {
  version: 1;
  ownerId: string;
  captureId: string;
  requestId: string;
  method: string;
  url: string;
  hostname: string;
  requestHeaders: Record<string, string | string[]>;
  startedAt: string;
  captureGroupId: string | null;
  requestBodyId: string;
  responseBodyId: string;
  requestEnded: boolean;
  responseEnded: boolean;
  responseStatus: number | null;
  responseHeaders: Record<string, string | string[]>;
  completedAt: string | null;
  durationMs: number | null;
  transport: CaptureTransportResult | null;
  requestRef: CaptureBodyRef | null;
  responseRef: CaptureBodyRef | null;
}
```

The journal owns request/file identity before original file creation. Initial
metadata is durable before queued original bytes are written, without waiting
in network callbacks. Only the same database's _meta.capture_journal_owner UUID
may recover it. Persist observed header/end/terminal snapshots asynchronously;
crash before a snapshot commits leaves those fields unknown/not observed.
Recovery never invents an end instant/duration or native usage and never sends
an upstream request. Missing terminal evidence yields interrupted with static
CAPTURE_PROCESS_LOST, persisted observed direction flags and null/observed
upstream status; a previously durable terminal outcome remains unchanged.
Unfinished metadata processing records closed/CAPTURE_PROCESSING_CLOSED.
Recovered .part bytes become a downloadable interrupted .body prefix with an
actual streamed digest; no complete status is inferred from file suffix/end
flags. Existing finished refs must pass size/digest checks. Missing/modified/
ambiguous/symlink evidence is explicit, never overwritten or deleted. Final
SQLite transaction and original IDs authorize idempotent journal cleanup, not
request-id equality alone. No originals are automatically removed.

An explicit metadata-retention policy additionally records exact deleted
request+both-original identities in the same SQLite transaction as row deletes.
Only those same-owner journal observations cannot restore metadata after
retention is disabled/lengthened. An old timestamp alone is never a deletion
identity. Remove only matched journal metadata, never body files; originals
stay quota-charged. Uncommitted/new old-clock evidence remains distinct;
bounded application of the currently enabled TTL after recovery remains7.3.

Original-backed protocol analysis consumes recorded transport evidence before
its response-size guard. An observed HTTP error sets analysis.state=failed
without implying incomplete evidence; normally retained protocol errors can be
fully analyzed. Cancellation/network failure/timeout/interruption prevents a
completed call projection and adds explicit transport completeness/error
evidence while preserving observed items/usage. Missing legacy transport is
not inferred. These call-projection states do not measure Agent task quality.

Transport, semantic processing/protocol completion and original-file retention
are independent evidence. completed means both observed directions reached
their normal end without a transport error; it is not Agent/protocol success.
http_error records a normally ended upstream4xx/5xx. A native error, client
disconnect or explicit stop takes precedence over status200; first terminal
cause/direction flags/upstream status are frozen before flush/worker latency.
error is null or bounded static HTTP_ERROR/TRANSPORT_INCOMPLETE/CAPTURE_PROCESS_LOST/UPSTREAM_ERROR/
UPSTREAM_ABORTED/CLIENT_DISCONNECTED/PROXY_STOPPED or an allowlisted native
network/TLS error code (no message, URL, stack or payload). Each request gets
at most one atomic final record; late duplicate errors never overwrite it.
Early response completion alone MUST NOT finalize an unfinished upload.
No default request/stream timeout is imposed by monitoring. Already-started
responses are aborted on upstream failure, never appended with synthetic
error text; a local pre-header error response is not upstream original data.

Timing offsets are nonnegative safe integer milliseconds from the same observed
proxy request start, rounded from a monotonic clock, not UTC differences or
worker/SQLite completion time. SSE first content is the arrival that completed
dispatch of the first nonempty text/public reasoning/tool-argument frame;
comments, role/empty deltas, usage and terminal markers are not content. JSON
first content means first complete document, not token/stream TTFT. Preserve
the first observed category, including real zero latency; otherwise null, never
E2E/headers substituted. Compression, missing stamps, limits and decode failure
are explicit statuses. Already observed content is not erased by later truncation.
serverTiming retains at most512 UTF16 code units from the observed Server-Timing
header with an explicit truncation flag; complete original headers remain in
capture metadata. Vendor units/clock/meaning are not guessed or mixed with
local timings. No TPS is inferred from network chunk count or these offsets.

### Linked execution metadata projection

```ts
export interface LinkedExecutionIdentityMatch {
  eventId: string;
  scanIdentityId: string;
  proxyIdentityId: string;
  namespace: string;
  kind: NativeIdentityKind;
  value: string;
  scope: string;
}
export interface LinkedExecutionPage {
  sessionKey: string;
  /** Retained session declaration only; NOT measured provenance per event. */
  sessionDurationSource: DurationSource;
  events: TraceEventSlim[];
  eventOffset: number;
  eventLimit: number;
  eventTotal: number;
  eventsHasMore: boolean;
  attempts: Array<{
    association: TraceAssociation;
    request: ProxyRequestListItem;
    /** Existing bounded network metadata, null for legacy missing evidence. */
    transport: CaptureTransportResult | null;
    matches: LinkedExecutionIdentityMatch[];
  }>;
  nextCaptureCursor: number | null;
  capturesHasMore: boolean;
  identities: TraceSourceIdentity[];
  identityCompleteness: IdentityCompleteness;
}
```

events are native metadata in sequence order; no server-derived TraceTurn or
new execution/call IDs. Attempts are accepted direct/confirmed memberships,
not proof of one native model event or a retry. A match means same exact
namespace/kind/value/nonempty native scope, with a real retained scan eventId
and complete source manifests. Session/parent-session/trace membership alone
never binds a call; request/response/tool_call/message/span may provide shared
identity evidence, not causal or billing identity. Ambiguous bindings must not
be guessed, including collisions outside the current event page. Incomplete/
unbound manifests stay visible with reasons and no fabricated event link.
Native IDs keep the source value; eventId is bound during source conversion,
not used to invent that value. Existing source originals/decisions are untouched.

sessionDurationSource is normalized from sessions.duration_source (unknown when
absent/invalid), not inferred from provider or positive duration. Existing
adapters can mix measured/derived/zero-duration events under one declaration;
therefore every native event keeps per-event measurement provenance unknown.
Display its retained duration as normalized log duration/interval, never as
measured tool time. Attempts include retained transport metadata in one batched
read, independently of native timing/matches. No cross-clock subtraction,
same-call/billing deduction or derived timing write.

### Selected capture comparison and native parent references

```ts
export interface CaptureComparisonAnalysis extends Pick<ProxyProtocolAnalysis,
  'parserVersion' | 'requestFormat' | 'model' | 'state' | 'stopReason' | 'usage' | 'completeness'> {
  errorCount: number;
  errorCodes: Array<string | null>;
  errorCodesTruncated: boolean;
}
export interface CaptureComparisonSide {
  request: ProxyRequestListItem;
  evidence: Omit<ProxyCaptureBodies, 'responseHeaders'>;
  originalDeletion: OriginalDeletionJob | null;
  analysis: CaptureComparisonAnalysis | null;
  analysisUnavailableReason: 'original_deleted' | 'analysis_unavailable' | 'metadata_only' | null;
}
export interface CaptureComparisonResponse {
  base: CaptureComparisonSide;
  target: CaptureComparisonSide;
  generatedAt: string;
}
export interface NativeSessionParentPage {
  sessionKey: string;
  items: Array<{
    identity: TraceSourceIdentity;
    state: 'resolved' | 'unresolved' | 'ambiguous' | 'incomplete';
    matches: Array<Pick<SessionIndexEntry, 'id' | 'provider' | 'sourceAgent' | 'title' | 'startedAt'>>;
    matchesTruncated: boolean;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  completeness: IdentityCompleteness;
}
```

Comparison includes only the first32 native error codes (null is a real missing
code), full observed projected errorCount and explicit truncation, not error
payloads/prompts/tool schema or raw bodies. Side metadata is a fresh point-in-
time snapshot. Any deletion intent strips that side's analysis; metadata-only
strips both. First-content differences require same nonnull basis and kind,
observed status and valid same-domain clocks; all other metrics keep explicit
basis. Unknown never becomes0, native usage subsets are not added twice. No
cross-source billing identity, aggregate charge/cost or causal speedup asserted.
Tool/parameter/task/quality equivalence is unproven until separately checked.

Parent page uses retained source values/locators, not title/filename/time guesses.
A unique same-namespace native session owner may resolve a declared parent/fork
reference, not prove a runtime spawn. Source and matched-owner manifests must
be complete; owner native session scope must be explicit/unambiguous, self
reference cannot resolve. Multiple matching owners are ambiguous; no matches
is unresolved unless evidence is incomplete. Each reference keeps at most20
matched metadata owners and a truncation flag, with paged source identities.
No recursive ancestry, inferred child/communication edge or new causal IDs.

### Versioned local capture evidence export

```ts
export interface CaptureEvidenceExport {
  format: 'awesome-telemetry.capture-evidence';
  formatVersion: 1;
  exportedAt: string;
  schemaVersion: number;
  request: Omit<ProxyRequest, 'requestBody' | 'responseBody' | 'rawRequestBody' | 'rawResponseBody' | 'systemPrompt'>;
  capture: ProxyCaptureBodies;
  originalDeletion: OriginalDeletionJob | null;
  analysis: ProxyProtocolAnalysis | null;
  analysisUnavailableReason: 'original_deleted' | 'analysis_unavailable' | 'metadata_only' | null;
  identities: TraceIdentityPage;
  traceLinks: ProxyTraceLinkPage;
  limitations: string[];
}
```

This is a bounded JSON snapshot, not a full original-file archive, future access
guarantee, full execution trace or supported offline import format. It preserves
observed header values without redaction; original body refs/digests/status
identify separately downloadable encoded originals. Analysis carries its parser
version and bounded evidence. Identity/link pages expose their own cursors and
missing manifests. No body/prompt preview fields in request, no paths/journal/
private CA. Any originalDeletion intent forces analysis=null and reason
original_deleted, even after async analysis; never substitute cached previews.
Export is local download only, not external API/tool replay or cloud upload.

```ts
export interface CaptureProcessingResult {
  version: 1;
  status: 'ok' | 'preview_truncated' | 'queue_full' | 'worker_error' | 'timeout' | 'closed' | 'result_limit' | 'decode_error' | 'resource_limit';
  error: string | null;
  /** Absent in legacy results; current byte-worker records identify view decoding. */
  contentDecoding?: { request: CaptureContentEncoding; response: CaptureContentEncoding };
  /** Present for current MITM captures; semantic preview bytes discarded, not original bytes lost. */
  previewDroppedBytes?: { request: number; response: number };
}

export type CaptureContentEncoding = 'identity' | 'gzip' | 'br' | 'deflate' | 'unsupported';
```

Native WS capture uses method `WS`, requestFormat `unknown`, parserRoute
`websocket_connection`, no inferred session or connection-level token counts.
CaptureTransportResult.websocket identifies a connection; timing is absent.
Duration is connection lifetime, NOT model E2E/TTFT. statusCode is101 only after
observing upstream upgrade, otherwise null. Message counters count observed
application messages, not tokens, close/control events or model calls; integers
are nonnegative safe integers. Close codes are null or integers1000..4999.
Processing runs the existing bounded worker. It produces <=64KiB text per
direction with global sequence/elapsed offset/kind/binary labels and binary
payload as base64; preview truncation is explicit. No JSON semantic inference
or text decoding of binary containers on forwarding callbacks. Worker framing
errors use WS_ARCHIVE_INVALID; finite preview/record limits use
SOURCE_PREVIEW_TRUNCATED. Identity manifest explicitly omits
websocket_connection_not_model_call. Existing HTTP analysis returns unknown,
incomplete with this same reason, not parsed container bytes or a complete
model call. HTTP reparse is unavailable (`originals_invalid`) for WS archives.

AWSP1 original-file format: request file=client→upstream, response
file=upstream→client. Each starts ASCII `AWSP1\n`. Records have18-byte header:
kind u8 (1 message,2 ping,3 pong,4 observed close), binary u8 (0/1), global
sequence u32BE (starts1), elapsed monotonic milliseconds f64BE, payload length
u32BE, then exact payload bytes. Close observation payload is u16BE code plus
observed reason bytes;1005/1006 are event observations, not fabricated wire
frames. The shared sequence preserves cross-direction observation order.
Message reassembly/decompression belongs to the existing engine; TCP frames,
masks, fragmentation and compressed wire bytes are not retained. Header/body
bytes count toward existing quotas, hashes and byte refs. Interrupted files
may end within a record and are never described as complete transcripts.

Capture processing status describes execution of a bounded live metadata job,
not protocol completion, Agent success, runtime trust or original retention.
ok means the task ran; invalid/unknown protocol data can still be unknown.
preview_truncated explicitly limits semantic conclusions. Queue/worker/timeout/
closed/result-limit failures retain unknown parsed fields plus an incomplete
identity manifest. decode_error retains only successfully decoded directions
and dispatched frames, with an explicitly incomplete manifest; invalid bytes
and pending frames never provide usage/completion. error is a bounded static
CAPTURE_PROCESSING_* or SOURCE_PREVIEW_TRUNCATED code, or one of SOURCE_TOO_LARGE,
INVALID_UTF8, UNSUPPORTED_CONTENT_ENCODING, DECODE_FAILED, DECODED_TOO_LARGE, SSE_EVENT_LIMIT and
SSE_INCOMPLETE_FRAME, never captured payload/worker exception text. Originals remain independently
queryable/downloadable and are never rewritten by this outcome. A later
on-demand offline analysis may inspect fuller evidence without changing this
historical processing result or replaying an upstream request.

Semantic decoding never reconstructs compressed data from text. Preserve raw
bounded byte previews for workers and full originals independently. identity,
gzip, br and deflate decode incrementally with a separate2MiB decoded limit;
unsupported/stacked encodings, corrupt compression and invalid UTF-8 are
decode_error findings (static error codes). SQLite body previews are bounded
decoded views, labelled separately from the encoded original download. Missing
legacy contentDecoding remains unknown. Partial bounded previews do not emit
a replacement character for a split trailing code point. EOF is not a final
SSE delimiter or protocol completion: discard a pending incomplete event,
report SSE_INCOMPLETE_FRAME, and do not accept its usage/completion markers.

```ts
export interface ProxyCaptureActivity {
  listening: boolean;
  observedRequests: number;
  activeRequests: number;
  pendingWrites: number;
  persistedRequests: number;
  interruptedRequests: number;
  captureErrors: number;
  lastRequestAt: string | null;
  lastError: string | null;
}

export interface ProxyMonitorDiagnostics extends ProxyCaptureActivity {
  phase: 'idle' | 'starting' | 'waiting_for_traffic' | 'capturing' | 'stopping' | 'failed' | 'degraded';
  runId: string | null;
  cleanupPending: boolean;
  /** Process-wide current allocations and lifetime counters; absent in legacy snapshots. */
  resources?: CaptureResourceStatus;
}

export interface CaptureResourceStatus {
  previewBytes: number;
  previewLimitBytes: number;
  previewCollectors: number;
  previewCollectorLimit: number;
  queuedBytes: number;
  queuedByteLimit: number;
  queuedJobs: number;
  queuedJobLimit: number;
  workers: number;
  workerLimit: number;
  previewLimitedRequests: number;
  processingRejectedRequests: number;
  sseClients: number;
  slowSseDisconnects: number;
}
```

resource_limit means process-wide preview admission failed. Discard semantic
buffers, retain unknown parsed fields and an incomplete identity manifest;
error is CAPTURE_PREVIEW_BUDGET_EXCEEDED. Original collection and forwarding
continue independently. previewDroppedBytes counts observed bytes excluded
from semantic previews (including evicted prefixes), not lost original data.
Resource snapshots are process-wide gauges/lifetime counters, not per-run
counts or whole-process RSS. Absence on old records means unknown, not zero.

```ts
export interface ProxyRuntimeStatus {
  running: boolean;
  starting: boolean;
  port: number | null;
  requestCount: number;
  startedAt: string | null;
  diagnostics?: ProxyMonitorDiagnostics;
}

export type MonitorAgent = 'claude' | 'codex' | 'opencode';

export type MonitorTransportCapability = 'http1_json_sse' | 'https_connect' | 'compressed_semantics' | 'live_identity_sse'
  | 'agent_websocket' | 'http2_grpc' | 'mtls_pinning' | 'electron_cdp' | 'trae_cn_frida';
export interface MonitorCapabilityReport {
  manifestVersion: 1;
  generatedAt: string;
  platform: string;
  scope: 'terminal_child_and_descendants';
  listener: 'shared_not_process_filtered';
  agents: Array<{
    provider: ProviderKey;
    processRecipe: MonitorAgent | null;
    nativeScanner: 'implemented';
    installedVersion: null;
    runtimeVerification: 'unverified';
  }>;
  transports: Array<{
    id: MonitorTransportCapability;
    level: 'controlled_test' | 'unsupported' | 'unverified' | 'dev_only' | 'experimental';
    testedPlatforms: string[];
  }>;
}
```

The capabilities document is bounded implementation evidence, not an installed
inventory or exact Agent version/OS/transport certification. Null installedVersion
is unknown, never an absent installation. Controlled tests list only actually
tested host platforms, never upgrade Agent runtimeVerification. Nine scanner
implementations do not certify nine network integrations. processRecipe only
selects a blank CLI form; it must not save/start/overwrite an existing profile.
Only the already implemented terminal child+descendant environment scope exists,
with a shared listener, not a process/project traffic filter or global proxy.

Local-only diagnostic view model (not a new HTTP/storage projection):

```ts
export interface CaptureDiagnosticFinding {
  code: 'slow_network' | 'slow_first_content' | 'repeated_encoded_request';
  classification: 'derived';
  evidence: Array<{ side: 'base' | 'target'; requestId: number; path: string; value: string | number }>;
}
export interface CaptureDiagnosticsViewModel {
  thresholdMs: number;
  repeat: 'same_encoded_request' | 'different_encoded_request' | 'unavailable';
  findings: CaptureDiagnosticFinding[];
}
```

deriveCaptureDiagnostics uses CaptureComparisonResponse only. Threshold must be a
positive safe integer<=3600000, default10000ms; invalid input falls back to that
documented default. A slow finding requires valid network offset evidence through
the same timing validation as selected comparison, applied independently per side;
normal HTTP error completion is a valid network observation, not Agent success.
Threshold equality qualifies. First-content also needs observed known basis/kind;
not cross-domain timing or pure model latency. Repetition requires distinct safe
positive capture IDs and retained complete request refs, valid64lowerhex digest,
positive safe integer bytes, no deletion intent, same known method/hostname/URL
and supported requestFormat. Equal bytes+digest is a recorded encoded-body match,
not equality of headers/credentials, decoded meaning, request execution, retries,
billing or quality. No file validation/IO, analysis/identity mutation or sums.

```ts
export interface MonitorConnectionSettings {
  label: string;
  agent: MonitorAgent;
  projectDirectory: string;
  executable: string | null;
  proxyPort: number;
  noProxy: string | null;
}

export interface MonitorConnectionProfile extends MonitorConnectionSettings {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorConnectionPlan {
  profile: MonitorConnectionProfile;
  controlUrl: string;
  proxyUrl: string;
  caCertUrl: string;
  caSha256: string;
  commands: { posix: string; powershell: string };
  warnings: Array<'process_and_descendants' | 'existing_process_unchanged' | 'shared_listener' | 'no_proxy_bypass' | 'opencode_loopback_bypass' | 'codex_standalone_required' | 'transport_unverified' | 'stop_affects_connected_processes'>;
  status: ProxyRuntimeStatus;
}

export type MonitorDiagnosticCode =
  | 'listener_idle' | 'listener_starting' | 'port_conflict' | 'cleanup_pending'
  | 'listener_failed' | 'ca_missing' | 'ca_invalid' | 'trust_unverified'
  | 'traffic_waiting' | 'traffic_unavailable' | 'capture_errors'
  | 'bypass_review' | 'transport_unverified' | 'shared_traffic';

export interface MonitorConnectionDiagnostics {
  profileId: string;
  profileRevision: number;
  checkedAt: string;
  expectedPort: number;
  listener: 'idle' | 'starting' | 'listening' | 'stopping' | 'failed' | 'port_conflict';
  ca: { state: 'missing' | 'available' | 'invalid'; sha256: string | null; validUntil: string | null };
  trust: { scope: 'selected_child_runtime'; variable: 'NODE_EXTRA_CA_CERTS' | 'CODEX_CA_CERTIFICATE'; runtimeVerified: false; osTrust: 'not_checked' };
  traffic: { scope: 'shared_listener'; state: 'unavailable' | 'waiting' | 'observed' };
  status: ProxyRuntimeStatus;
  issues: Array<{ code: MonitorDiagnosticCode; severity: 'info' | 'warning' | 'error'; message: string; nextStep: string }>;
}

export interface MonitorCaptureSelfTest {
  profileId: string;
  profileRevision: number;
  checkedAt: string;
  runId: string;
  proxyId: number;
  scope: 'local_http_sse';
  synthetic: true;
  checks: { forwarding: boolean; persistence: boolean; originals: boolean; parsing: boolean };
  passed: boolean;
  agentVerified: false;
  tlsVerified: false;
}
```

MonitorCaptureSelfTest is an explicit synthetic loopback HTTP/SSE pipeline
snapshot. Passed requires every check plus unchanged current run/port. Original
checks read both retained files with size/SHA256 validation and compare exact
fixture bytes; parsing checks the actual capture-worker metadata. No new table,
native identity or charge is created; the existing capture row and original files
remain, marked by model agent-observe-self-test and unique URL query marker.
Shared listener counters include this traffic and do not certify an Agent.

Connection diagnostics are timestamped read-only snapshots of one saved recipe and the shared listener. They do not start a listener, initialize a missing CA, inspect Agent/native configs, execute a process, send an upstream request or open original capture files. Public CA metadata is read asynchronously, max64KiB from the canonical certs/ca.pem, rejecting symlink/non-regular/invalid/non-CA/out-of-validity public evidence. A public certificate being available is not runtime trust or proof that a signing key still matches it. Missing/unreadable/invalid evidence is explicit; never expose private key material. Report messages/nextStep are bounded static English troubleshooting copy, not captured payload.

Traffic is observed only when the currently listening expected port has current-run observedRequests>0. It is shared-listener evidence, not per-profile/Agent/TLS verification; historical requestCount must not imply a connection. Missing legacy activity is unavailable, not zero. A stopped/failed/different-port listener never reuses old run traffic as current success. runtimeVerified is deliberately false and osTrust not_checked until independent target-runtime validation exists. NO_PROXY contents from the parent terminal are not known to the server. CLI/Web consume this same projection; Web labels stale snapshots on runtime changes and only refreshes explicitly.

Connection profiles are user-selected terminal CLI launch recipes, not arbitrary HTTP command execution. Only application-owned profile JSON is edited. The launcher inherits user config/auth/model/permissions unchanged and starts the selected executable directly (no shell) in projectDirectory; argv after -- is forwarded without rewriting. No API launches/restarts an external process. A user runs the generated command explicitly in a terminal. Child-only proxy variables and appended CA trust expire with the child; there is no global/Agent config restoration that could overwrite later edits. The listener is shared, not a per-process traffic filter or proof of session identity. Existing external/daemon/remote processes are not adopted.

Profile id is UUID, revision starts at1 and increments on updates; UTC timestamps. label1..80 characters, projectDirectory and non-null executable absolute paths<=4096 chars; proxyPort1..65535; noProxy null preserves inherited bypass, an explicit string<=2048 chars overrides both cases only in the child. Empty noProxy explicitly captures local destinations, but OpenCode requires localhost/127.0.0.1 bypass and rejects incompatible bypass configuration. Max32 profiles and256KiB UTF-8 application profile file. No auth tokens, model settings, prompt or forwarded argv are stored in a profile. Reads are bounded asynchronous; mutations use a cross-instance exclusive lock and atomic write, expectedRevision prevents lost updates. Unknown/corrupt config is not overwritten.

Node-based profiles append to NODE_EXTRA_CA_CERTS; Codex uses CODEX_CA_CERTIFICATE (fallback SSL_CERT_FILE) and requires a supported --no-daemon standalone invocation. Preserve existing selected custom CA certificates in a private process-owned temporary PEM rather than replacing them. Never set TLS verification bypass. Validate the monitor CA digest against the returned plan, reject private-key material/invalid/oversized PEM, clean only owned temporary files after child exit. No WebSocket/HTTP2 downgrade and no network-support certification from a recipe. Default transport support remains unverified until exact Agent/platform traffic is tested.

Equal-issuer/different-public-key roots can make TLS choose an invalid chain. A detected inherited/monitor root collision is an explicit configuration error before launch, never silent CA deletion, replacement, reordering to hide loss of old trust, or verification bypass. Existing CA files remain byte-identical.

Proxy environment reaches descendants, but profile CA variables cover only the selected CLI runtime. Other tool runtimes, mTLS, certificate pinning, remote/background services and corporate upstream proxy chaining need separate explicit validation/configuration. Do not imply that a process recipe establishes full tool-network coverage or universal trust.

Diagnostics are optional only for legacy consumers/fixtures; the current server always supplies them. Activity counters are per run, unlike historical requestCount. lastError is a bounded (1024 characters) technical message, never captured payload. Waiting for traffic does not prove Agent connection, certificate trust, protocol support or complete capture. Degraded means capture/storage errors were observed; originals remain unchanged. runId is capture-group identity, never native session identity. Interruption is per direction: a fully received request remains complete when its response is interrupted. CaptureBodyRef.error may contain PROXY_STOPPED, CLIENT_DISCONNECTED or UPSTREAM_ERROR for interrupted directions; earlier quota/write failures retain their own status/error.


> **Authoritative source.** All adapters, storage, API, and frontend component
> types must adopt this file's definitions verbatim. This file cross-references
> `contracts/database.md` and `contracts/api.md`; on conflict, this file wins.
> Corresponding source file: `src/core/trace-types.ts`

## 0. General conventions

- All timestamps are **ISO 8601 UTC strings** (`2026-08-03T02:38:49.000Z`), not
  millisecond numbers. The only exception is `contracts/database.md` §5 (Trae's
  second-level timestamps are converted inside the adapter; everything leaving
  the adapter is ISO).
- All optional fields use `?:`, **not `| undefined`**, and `undefined` must be
  converted to `null` before writing to the DB.
- All amounts are USD, `number`, preserving original precision without rounding.
- All token counts are `number`, non-negative integers.
- Field naming: camelCase on the TypeScript side, snake_case on the SQLite
  side; the mapping happens in the storage layer and never leaks to the API.

---

## 1. Enums (full set, must not be extended)

> fix-adapter-turn-semantics deliberately amended `TraceKind` exactly once,
> adding `reasoning` and `compact` (rationale below). After this amendment the
> enum is closed again; no further member may be added.

```ts
/** Six phases. Classification algorithm: specs/metrics-analysis REQ-001. */
export type TracePhase =
  | 'understand'
  | 'plan'
  | 'implement'
  | 'debug'
  | 'verify'
  | 'report';

export const TRACE_PHASES: readonly TracePhase[] = [
  'understand', 'plan', 'implement', 'debug', 'verify', 'report',
] as const;

/** Event kinds. */
export type TraceKind =
  | 'llm'
  | 'tool'
  | 'file_read'
  | 'file_write'
  | 'bash'
  | 'test'
  | 'agent'
  | 'system'
  | 'message'
  | 'user_prompt'
  | 'subagent_prompt'
  | 'reasoning'
  | 'compact';

export const TRACE_KINDS: readonly TraceKind[] = [
  'llm', 'tool', 'file_read', 'file_write', 'bash', 'test',
  'agent', 'system', 'message', 'user_prompt', 'subagent_prompt',
  'reasoning', 'compact',
] as const;

/**
 * 新增两个成员的依据（fix-adapter-turn-semantics A2）。
 * - `reasoning` — 模型思考与用户可见回复分开输出的记录。并入 `llm` 会让
 *   回合卡片无法区分「推演」与「作答」，而这是阅读轨迹时最有用的区分。
 * - `compact` — 客户端执行的上下文压缩 / 自动摘要。它既不是模型消息也不是
 *   工具；轨迹带需要它作为独立的一条 band。
 * 本 change 只新增这两个成员；其后枚举仍保持封闭，不得再扩展。
 */

/**
 * Unified status. Provider-native statuses are normalized by adapters:
 *   completed → success | paused → running | canceled → cancelled
 * Normalization table: specs/adapters REQ-010.
 */
export type TraceStatus = 'success' | 'error' | 'running' | 'cancelled' | 'unknown';

/** Session-list time-range filter (`GET /api/sessions?range=...`). */
export type SessionRange = 'today' | '7d' | '30d' | 'all';

export const SESSION_RANGES: readonly SessionRange[] = ['today', '7d', '30d', 'all'] as const;

export const TRACE_STATUSES: readonly TraceStatus[] = [
  'success', 'error', 'running', 'cancelled', 'unknown',
] as const;

/** 9 providers. Adding a provider must update this enum, the scanner, the
 * adapter, and both i18n locales at the same time. */
export type ProviderKey =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'codearts'
  | 'codeagent'
  | 'codeagent2'
  | 'trae'
  | 'qoder'
  | 'workbuddy';

export const PROVIDER_KEYS: readonly ProviderKey[] = [
  'claude', 'codex', 'opencode', 'codearts',
  'codeagent', 'codeagent2', 'trae', 'qoder', 'workbuddy',
] as const;

/** Data source. scan and proxy are shown separately in the UI (G7.4),
 * never mixed. */
export type DataSource = 'scan' | 'proxy';

/** Proxy capture method. */
export type CaptureMethod = 'mitm' | 'cdp' | 'frida';

/**
 * Detail response tier. Default slim. See specs/storage REQ-006 and
 * contracts/nfr.md §2.
 *   slim — fields needed to render the Gantt tree only, no body text
 *   full — slim + inputSummary + outputSummary
 *   raw  — full + raw (single-event drill-down endpoint only)
 */
export type EventMode = 'slim' | 'full' | 'raw';

/** Source file type; decides the watch strategy (chokidar vs 30s poll, G5.2). */
export type SourceKind = 'jsonl' | 'json' | 'sqlite' | 'sqlcipher' | 'otel';
```

### 1.1 Cost & duration provenance (add-mission-control)

```ts
/**
 * 成本来源。add-mission-control §1 P0-C：
 * - reported：厂商直接给出金额（workbuddy credit）
 * - estimated：由 pricing.ts 按 model 定价表估算
 * - unknown：模型未知或定价表无此模型 → UI 必须渲染 `—`，禁止显示 $0.0000
 */
export type CostSource = 'reported' | 'estimated' | 'unknown';

/**
 * 事件时长来源。add-mission-control §1 P0-A：
 * - measured：源数据自带真实起止（opencode OTel span / trae / workbuddy）
 * - derived：由相邻时间戳推导，**含调度间隙**，消费方必须在口径行标注
 * - unknown：既无测量也无推导
 * ⚠️ 与 G4.1 同类风险：把推导值当测量值用会系统性高估。
 */
export type DurationSource = 'measured' | 'derived' | 'unknown';

/**
 * turn key 的来源声明（fix-adapter-turn-semantics A5）。adapter 必须声明它如何
 * 产出 turn key；UI 读取它以写口径行，且**永远不得**从「key 恰好非 null」推断
 * 可信度。
 * - native_boundary：源格式显式标注了决策周期的起止
 * - stream_structure：周期由源自身 item 流的形状推导（边界真实但非显式标记）
 * - message_identity：按源自身的消息标识分组
 * - unavailable：源中无边界信号，turnKey 为 null
 */
export type TurnKeySource =
  | 'native_boundary'
  | 'stream_structure'
  | 'message_identity'
  | 'unavailable';
```

---

## 2. Tokens & cost

```ts
export interface TokenUsage {
  /** Prompt tokens. Incremental semantics; summed across events. */
  input: number;
  /** Generated tokens. Incremental semantics; summed across events. */
  output: number;
  /** Reasoning tokens. Incremental semantics; summed across events (G4.4). */
  reasoning: number;
  /**
   * Cache read tokens.
   * ⚠️ OpenCode / CodeArts / CodeAgent2 family is **incremental per step**
   * (measured calibration 2026-08-03: DeepSeek billing input =
   * SUM(input) + SUM(cache.read); three steps 6016/4000/2000 should total
   * 12016). Cross-event aggregation must use sum, never Math.max() (the old
   * G4.4 cumulative assumption has been overturned). Other providers are
   * incremental too, use sum. Semantics declared by the adapter's
   * tokenSemantics.
   */
  cacheRead: number;
  /** Cache write tokens. Incremental semantics. */
  cacheWrite: number;
  /**
   * Net input = max(0, input − cacheRead). cacheRead tokens hit the prompt
   * cache and are not billed as input; the 0 floor is real semantics (no cache
   * hit), never a stand-in for "unknown". Produced only by the session-level
   * aggregation (aggregateTokenUsage); never enters a billing formula.
   */
  netInput: number;
  /**
   * total = input + output + reasoning + cacheRead + cacheWrite.
   * ⚠️ Whether reasoning counts is declared by the adapter's
   * `reasoningInTotal` (#6, calibrated with real data 2026-08-04 and
   * 2026-08-09): the accounting can vary by model/version. OpenCode's measured
   * total includes reasoning; older CodeArts/DeepSeek samples excluded it,
   * while deepseek-v4-pro native totals include it. When a source record
   * carries native `tokens.total`, the adapter MUST infer the current record's
   * equation; provider defaults are only a fallback for records without it.
   */
  total: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  netInput: 0, total: 0,
};

/** Adapters must declare their provider's token aggregation semantics so the
 * storage layer aggregates correctly. */
export interface TokenSemantics {
  cacheRead: 'cumulative' | 'incremental';
  reasoning: 'cumulative' | 'incremental';
  /**
   * #6 (calibrated with real data 2026-08-04 and 2026-08-09):
   * - OpenCode: tokens.total = input+output+reasoning+cache → true
   * - legacy CodeArts/CodeAgent2 fallback: tokens.total = input+output+cache
   *   → false
   * - when native tokens.total is present, infer true/false from that record;
   *   deepseek-v4-pro measured on 2026-08-09 resolves to true
   * Default true (other providers usually have reasoning 0 or unverified).
   */
  reasoningInTotal?: boolean;
}
```

---

## 3. Sessions

```ts
/**
 * Session index entry. List endpoints return this shape and **never include
 * the systemPrompt body**. Measured basis: 524 index entries at 447.8KB /
 * 5.33ms is acceptable; including systemPrompt would blow up.
 */
export interface SessionIndexEntry {
  /**
   * = deriveSessionKey(provider, sourcePath, innerId?) result,
   * see specs/session-scanning REQ-007 (index/detail share one derivation, T-02).
   */
  id: string;
  provider: ProviderKey;
  /** Display name of the provider; may differ from provider
   * (e.g. CodeArts SDD subagents). */
  sourceAgent: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  status: TraceStatus;
  cwd: string | null;
  eventCount: number;
  messageCount: number;
  tokenTotal: number;
  costUsd: number;
  dataSource: DataSource;
  /** Desensitized path (home dir replaced with ~). */
  sourcePath: string;
  /** Whether detail was already loaded. false means opening triggers a lazy scan. */
  detailLoaded: boolean;
  /** Merge-group primary key. Non-null means this entry represents a merge
   * group, see specs/session-merge. */
  mergeGroupId: string | null;
  /** Whether a systemPrompt exists. Body is not returned here; use the detail
   * endpoint. */
  hasSystemPrompt: boolean;
  /** Session annotations tags (add-trajectory-inspector D14). Empty when the
   * session has no annotation row; the list query returns it via a single
   * join, never a per-row query, and never a body column. */
  tags: string[];
}

export interface TraceSession {
  id: string;
  provider: ProviderKey;
  sourceAgent: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  status: TraceStatus;
  cwd: string | null;
  messageCount: number;
  eventCount: number;
  tokenUsage: TokenUsage;
  costUsd: number;
  /** Associated from proxy captures by time window; scan data itself has none
   * (G5.4). */
  systemPrompt: string | null;
  dataSource: DataSource;
  sourcePath: string;
  /** wall-clock total duration = last event.startedAt − first event.startedAt
   * (G4.6, not a sum). */
  totalDurationMs: number;
  /** OpenCode-family subagent session flag, title matches /\(@.*\bsubagent\)/i
   * (G9.3). */
  isSubagent: boolean;
  /** Highest-token-share model of this session; null when the source data
   * has no model (add-mission-control §1 P0-B, produced by the adapter's
   * pickPrimaryModel). */
  primaryModel?: string | null;
  /** Trustworthiness of costUsd, see CostSource (add-mission-control §1
   * P0-C). */
  costSource?: CostSource;
  /** Provenance of per-event durationMs, see DurationSource
   * (add-mission-control §1 P0-A). When 'derived', every duration panel's
   * criteria line MUST state "durations derived from adjacent timestamps,
   * includes scheduling gaps". */
  durationSource?: DurationSource;
}
```

### 3.1 On-demand Prompt Context (show-trae-prompt-context)

Prompt Context is independent from `TraceSession.systemPrompt` and is returned
only by `GET /api/sessions/:key/prompt-context`.

```ts
export type PromptContextCompleteness = 'dynamic_only' | 'complete';
export type PromptContextSource = 'trae_db' | 'proxy' | 'frida';
export type PromptContextCategory =
  | 'terminal' | 'workspace_rules' | 'environment' | 'instructions'
  | 'skills' | 'language' | 'other';

export interface PromptContextSection {
  id: string;
  category: PromptContextCategory;
  title: string;
  /** Desensitized before persistence. */
  content: string;
  chars: number;
  estimatedTokens: number;
  duplicateOf: string | null;
}

export interface PromptModelConfig {
  modelName: string | null;
  configName: string | null;
  promptMaxTokens: number | null;
  maxOutputTokens: number | null;
  maxTurns: number | null;
  isPreset: boolean | null;
  locale: string | null;
  agentType: string | null;
  agentName: string | null;
  enabledFeatures: string[];
}

export interface PromptContextAnalysis {
  totalChars: number;
  estimatedTokens: number;
  sectionCount: number;
  uniqueSectionCount: number;
  duplicateSectionCount: number;
  duplicateChars: number;
  contextWindowPercent: number | null;
}

export interface SessionPromptContext {
  sessionId: string;
  provider: ProviderKey;
  source: PromptContextSource;
  completeness: PromptContextCompleteness;
  capturedAt: string;
  dynamicSections: PromptContextSection[];
  modelConfig: PromptModelConfig;
  analysis: PromptContextAnalysis;
  fullSystemPrompt: string | null;
}
```

### 3.2 Session annotations (add-trajectory-inspector)

Persisted per-session tags and a free-text note (design D13). Served by
`GET` / `PUT /api/sessions/:key/annotations` and aggregated by
`GET /api/annotations/tags` (contracts/api.md §1.7).

```ts
export interface SessionAnnotations {
  sessionKey: string;
  tags: string[];
  note: string | null;
  updatedAt: string | null;
}
export interface SessionAnnotationsUpdate {
  tags?: string[];
  note?: string | null;
}
```

| Rule | Value |
|---|---|
| `ANNOTATION_MAX_TAGS` | 32 |
| `ANNOTATION_TAG_MAX_CHARS` | 64 |
| `ANNOTATION_TAG_PATTERN` | `/^[\p{L}\p{N}_-]{1,64}$/u` |
| `ANNOTATION_NOTE_MAX_CHARS` | 8192 |

- Tags normalise: trim, lowercase, de-duplicate, sort ascending; stored as a
  JSON array.
- A violated bound returns `400 BAD_REQUEST` via the unified `ApiError`
  envelope. Silent truncation is prohibited.
- `GET` on an unannotated session returns `200` with `tags: []`, `note: null`,
  `updatedAt: null` — not `404`.
- `PUT` on an unknown key returns `404 SESSION_NOT_FOUND`.
- `PUT` replaces per present key: an absent key leaves that field untouched,
  `tags: []` clears tags, `note: null` clears the note.
- `DELETE /api/sessions/:key` cascades via the FK.

---

## 4. Events

```ts
/** slim tier: all fields needed to render the Gantt tree, no body text. */
export interface TraceEventSlim {
  id: string;
  sessionId: string;
  /** 1-based, unique and continuous within a session. Must be re-sequenced
   * after merging (G10.3). */
  sequence: number;
  /**
   * Decision-cycle identity. All events produced by one model inference and the
   * tool activity it triggered share one key. Null means the source format carries
   * no boundary signal; consumers then fall back to their own segmentation and must
   * disclose that they did. (fix-adapter-turn-semantics A3)
   *
   * Normative rules:
   * 1. `turnKey` is **opaque**. No consumer parses it, sorts by it, or derives an
   *    index from it. Turn ordering comes from `sequence`.
   * 2. `turnKey` is stable across rescans of unchanged source data.
   * 3. `turnKey` is unique within a session and MUST NOT be reused across
   *    sessions; prefix it with a session-scoped value when the source identifier
   *    is not globally unique.
   * 4. `null` is a first-class value, not an error. An adapter that cannot find a
   *    boundary signal in its real source data returns `null` for every event,
   *    and the reason is recorded in the adapter's provenance declaration.
   * 5. A tool event and the `llm` / `reasoning` events of the inference that
   *    requested it share one `turnKey`. Turn 0 material (system prompt, first
   *    user message) carries the key of the cycle it precedes, or `null` when no
   *    cycle follows.
   */
  turnKey: string | null;
  kind: TraceKind;
  phase: TracePhase;
  /** Single-line summary, shown directly in the UI. Max 200 chars; adapters
   * truncate beyond that. */
  title: string;
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  /** Actor: user / assistant / subagent name / tool name. */
  actor: string;
  /** Tool name, null for non-tool events. */
  tool: string | null;
  tokens: TokenUsage | null;
  /** Error summary, max 500 chars. Full error lives in the full tier. */
  error: string | null;
  /** Whether body text exists; lets the UI decide whether to show an
   * "expand" button. */
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
  /** Model id for llm events; null for non-llm events or when the source has
   * no model (add-mission-control §1 P0-B). */
  model?: string | null;
}

/** full tier: slim + body. Only for export, report generation, and
 * single-event drill-down. */
export interface TraceEvent extends TraceEventSlim {
  inputSummary: string | null;
  outputSummary: string | null;
}

/** raw tier: only GET /api/sessions/:key/events/:eventId?include=raw returns
 * this. */
export interface TraceEventRaw extends TraceEvent {
  raw: string | null;
}
```

### 4.1 Derived turn model (add-trajectory-inspector)

> Types copied verbatim from `specs/trace-model/spec.md` (derived turn model).
> Derivation is a pure function of the ordered event stream, the session, and
> the adapter's declared turn-key provenance; it runs in a single pass and is
> **never persisted and never computed on the server** (design D2/D3). A turn's
> tool-call identity is the member event's `id` — there is **no `toolCallId`
> field** and none is generated (deviation C7, design D5).

```ts
export type TurnSegmentationSource =
  | 'turn_key'
  | 'llm_boundary'
  | 'user_prompt_boundary'
  | 'sequence_fallback';

export type TurnKind = 'init' | 'user' | 'cycle';

export type MessageRole =
  | 'system' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'compact' | 'subagent';

export interface TurnMessage {
  eventId: string;
  sequence: number;
  role: MessageRole;
  kind: TraceKind;
  title: string;
  tool: string | null;
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  tokens: TokenUsage | null;
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
  error: string | null;
}

export type TurnBadge =
  | 'init' | 'user' | 'tools' | 'stop' | 'error' | 'subagent' | 'compact' | 'running';

export interface TraceTurn {
  index: number;
  kind: TurnKind;
  startedAt: string;
  durationMs: number;
  tokens: TokenUsage;
  model: string | null;
  messageCount: number;
  toolCount: number;
  status: TraceStatus;
  badges: TurnBadge[];
  messages: TurnMessage[];
}

export interface TurnModel {
  turns: TraceTurn[];
  segmentationSource: TurnSegmentationSource;
  complete: boolean;
  omittedEventCount: number;
}
```

---

## 5. Aggregation units

```ts
/** Adapter output; the complete unit consumed by the UI. */
export interface TraceRecord {
  session: TraceSession;
  events: TraceEvent[];
  nativeIdentities?: NativeIdentitySet;
  metrics?: TraceMetrics;
  tokenSemantics: TokenSemantics;
  /**
   * turn key 的来源声明（fix-adapter-turn-semantics A5），与
   * `tokenSemantics` 并列，adapter 必须声明。
   */
  turnKeySource: TurnKeySource;
}

/** Detail shape returned by the API. The events tier is decided by mode. */
export interface SessionDetailResponse {
  session: TraceSession;
  events: TraceEventSlim[] | TraceEvent[];
  mode: EventMode;
  /** Pagination info. Enabled when event count > 2000, see
   * specs/storage REQ-007. */
  eventTotal: number;
  eventOffset: number;
  eventLimit: number;
  hasMore: boolean;
  /** true when providers requiring async decryption (e.g. Trae) don't have
   * detail ready yet; SSE pushes later. */
  pending: boolean;
}
```

### 5.1 Mission aggregation (add-mission-control)

> Mission 视图的 widget 统一信封与完整响应。每个 widget 必带服务端下发的
> `criteria` 口径行；`available=false` 时 `data` 必须为 `null` 且
> `unavailableReason` 非空，前端渲染 EmptyState —— **禁止用 0 冒充**
> （design.md §7.2，落实 frontend REQ-017/018）。

```ts
export type MissionRange = '7d' | '30d' | 'all';

/** widget 统一信封 —— 这是本设计的核心机制。 */
export interface MissionWidget<T> {
  id: string;
  /** 数据口径：表名 / 字段 / 计算方式 / 覆盖范围。服务端下发，前端不得自撰。 */
  criteria: string;
  /** false 时 data 为 null，前端渲染 EmptyState + reason，禁止渲染 0。 */
  available: boolean;
  /** available=false 时必填，如 'NO_PRICING_TABLE' / 'DURATION_NOT_MEASURED'。 */
  unavailableReason: string | null;
  data: T | null;
}

export interface NamedCount {
  name: string;
  count: number;
  /** 该项中失败的次数（工具榜用）。 */
  errorCount?: number;
}

export interface MissionToolRow {
  tool: string;
  calls: number;
  errors: number;
  /** MCP 工具（名字以 mcp__ 开头）。 */
  isMcp: boolean;
  p50Ms: number | null;
  p95Ms: number | null;
  inBytes: number;
  outBytes: number;
}

export interface MissionModelRow {
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  costSource: CostSource;
}

export interface MissionDayPoint {
  day: string;
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  errorEvents: number;
  successRate: number | null;
  /** B11 漂移专用：当日 E2E p95（wall-clock 分位数）。 */
  e2eP95Ms?: number | null;
  /** B11 漂移专用：当日工具失败数。 */
  toolFails?: number;
}

export interface MissionHourPoint {
  /** 本地时区（按 tz 偏移后）的小时桶，ISO 到小时。 */
  hour: string;
  sessions: number;
  messages: number;
}

export interface MissionUsage {
  toolTop: MissionWidget<MissionToolRow[]>;
  skillTop: MissionWidget<NamedCount[]>;
  subagent: MissionWidget<{ rows: NamedCount[]; avgPerSession: number; sessionsWithSubagent: number }>;
  /** 7×24 网格，heat[weekday][hour]，weekday 0=周一。 */
  heatmap: MissionWidget<{ grid: number[][]; peak: number }>;
  promptHabits: MissionWidget<{ n: number; p50: number; p95: number; max: number }>;
  activity: MissionWidget<MissionHourPoint[]>;
}

export interface MissionQuality {
  closure: MissionWidget<{
    successRate: number | null;
    sessions: number;
    ok: number;
    err: number;
    e2eP50Ms: number | null;
    e2eP90Ms: number | null;
    e2eP99Ms: number | null;
    turnsP50: number;
    repairSessions: number;
  }>;
  costEfficiency: MissionWidget<{
    totalUsd: number;
    perTurnUsd: number | null;
    perOkToolUsd: number | null;
    perSessionUsd: number | null;
    turns: number;
    tools: number;
    pricedSessions: number;
    unpricedSessions: number;
  }>;
  toolFailure: MissionWidget<Array<{ tool: string; rate: number; errors: number; attempts: number }>>;
  tokenTrend: MissionWidget<MissionDayPoint[]>;
  apiQuality: MissionWidget<{
    cacheHitRate: number | null;
    totalIn: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    ttftP50Ms: number | null;
    ttftP95Ms: number | null;
    proxyCalls: number;
    proxyErrorRate: number | null;
  }>;
  errorReasons: MissionWidget<NamedCount[]>;
  riskyCommands: MissionWidget<Array<{ pattern: string; hits: number; sessionId: string; preview: string }>>;
  drift: MissionWidget<MissionDayPoint[]>;
  contextPressure: MissionWidget<{
    windowSource: string;
    peakPct: number | null;
    p50Pct: number | null;
    p95Pct: number | null;
    over80Pct: number;
    over95Pct: number;
    samples: number;
    histogram: NamedCount[];
    compactions: number;
    savedTokens: number;
  }>;
  models: MissionWidget<MissionModelRow[]>;
  depth: MissionWidget<NamedCount[]>;
  /** B15 工具生态：耗时/IO 维度（P0-A 时长 + input_len/output_len 冗余列）。 */
  toolEcology: MissionWidget<MissionToolRow[]>;
  /** B7 场景分布：只返回 {scene,count,tokenSum}，正文绝不出服务端。 */
  scenes: MissionWidget<{
    total: number;
    rows: Array<{ scene: string; count: number; tokenSum: number }>;
  }>;
  /** B8 重任务场景分布：B7 + token 阈值切换。 */
  heavyScenes: MissionWidget<{
    threshold: number;
    rows: Array<{ scene: string; count: number; tokenSum: number }>;
  }>;
  parallelism: MissionWidget<{
    sessions: number;
    avgRatio: number | null;
    maxRatio: number | null;
    parallelSessions: number;
  }>;
}

export interface MissionHealth {
  collectors: MissionWidget<{
    scanStateRows: number;
    /** 0 行 = 增量扫描可能失效，前端红色告警（G11.5 正向断言）。 */
    providers: Array<{
      key: ProviderKey;
      enabled: boolean;
      sessionCount: number;
      lastScanAt: string | null;
      ready: boolean;
      blockedBy: string | null;
    }>;
    proxy: { running: boolean; starting: boolean; port: number | null };
    frida: { running: boolean; pid: number | null };
    dbSizeBytes: number;
    walSizeBytes: number;
    schemaVersion: number;
    uptimeMs: number;
  }>;
  dualChannel: MissionWidget<{
    scanSessions: number;
    proxyRequests: number;
    linkedSessions: number;
    scanOnly: number;
    proxyOnly: number;
    hints: string[];
  }>;
  calendar: MissionWidget<Array<{ day: string; sessions: number; hasError: boolean }>>;
  hotSessions: MissionWidget<Array<{
    id: string;
    title: string;
    provider: ProviderKey;
    tokenTotal: number;
    costUsd: number;
    costSource: CostSource;
  }>>;
}

/** GET /api/mission 完整响应（contracts/api.md §2.4）。 */
export interface MissionResponse {
  meta: {
    range: MissionRange;
    generatedAt: string;
    tz: number;
    widgetCount: number;
    durationMs: number;
    stamp: string;
    cached: boolean;
  };
  usage: MissionUsage;
  quality: MissionQuality;
  health: MissionHealth;
}
```

---

## 6. Metrics

```ts
/** Persisted base metrics. See the metrics table in contracts/database.md. */
export interface TraceMetricsBase {
  totalSteps: number;
  /** Cumulative duration per phase; keys are the full TracePhase set, missing
   * phases are 0. */
  durationByPhase: Record<TracePhase, number>;
  toolCallCount: number;
  verificationPresent: boolean;
  /** Algorithm version. Bump on algorithm changes to trigger recompute.
   * See specs/metrics-analysis REQ-011. */
  calcVersion: number;
}

/** Four-dimension metrics. **Persisted since v5** (overturns v4's G5.3 design
 * choice). */
export interface TraceDimensionMetrics {
  /** Speed */
  avgToolDurationMs: number;
  /** Accuracy: verify-phase event count / step event count (#15, no longer
   * always 0|1). */
  verificationCoverage: number;
  /** Stability: error step count / step event count (#14; denominator
   * excludes non-step events like user_prompt/message). */
  errorRate: number;
  enteredDebug: boolean;
  /** Cost */
  tokensPerStep: number;
  costUsd: number;
}

export interface TraceMetrics extends TraceMetricsBase, TraceDimensionMetrics {
  /** 持久化的速度指标（add-mission-control §4 B6，G11.11）：不持久化 →
   * 跨会话聚合触发 N+1（G11.9）。改算法必须 bump METRICS_CALC_VERSION（当前 6）。 */
  ttftMs?: number | null;
  e2eMs?: number;
  /** 修复循环命中（W-F-W-F-W ≥2 轮，与 session-findings repairLoop 同口径）。
   * v3：扫描时预计算（design.md §7.3 R1），Mission closure 直接读 rollup。 */
  repairLoop?: boolean;
  /**
   * v4 (calibrate-tokens-and-compare-report §4): sum of durationMs over
   * events where tool !== null.
   */
  totalToolDurationMs: number;
  /** v4: number of events with kind === 'llm'. */
  llmCallCount: number;
  /** v4: number of events with kind === 'user_prompt'. */
  userInteractionRounds: number;
  /** v4: true when an event has phase === 'verify' and its command/title
   * matches the TEST_CMD regex (npm test|vitest|jest|pytest|cargo test|go
   * test|tsc|eslint). */
  hasUnitTests: boolean;
  /**
   * v4: count of events with status === 'error' and kind in
   * {bash, test, tool, file_write, file_read, agent}. Intentionally excludes
   * llm (a model error is not a command failure) — different denominator from
   * errorRate on purpose.
   */
  failedCommandCount: number;
}

/** Speed metrics, computed at runtime, not persisted. */
export interface SpeedMetrics {
  /** Legacy scan: first user_prompt to first LLM log startedAt, not wire TTFT. */
  ttftMs: number | null;
  /** Legacy scan: arithmetic mean of valid per-event output/duration rates. */
  tps: number | null;
  /** Legacy scan: sum valid LLM durations / sum their output, not streaming TPOT. */
  tpotMs: number | null;
  /** End-to-end wall-clock (ms). */
  e2eMs: number;
  /** Median gap between adjacent turns (ms). */
  turnGapMedianMs: number | null;
  /**
   * Legacy scan sum of normalized LLM durations; not guaranteed measured time.
   * ⚠️ Pure LLM inference time must come from InferHub.inference_duration.
   * Kernel-Inference duration includes tool execution time (G4.1).
   */
  pureInferenceMs: number | null;
  /**
   * Avg model response latency (ms): mean of the difference between each
   * user_prompt and the next llm event's startedAt in time order (#12).
   * turnGapMedianMs stays as the median "gap between two user inputs".
   */
  avgLlmResponseLatencyMs: number | null;
  /**
   * Avg single-inference duration (ms) = pureInferenceMs / llmCallCount.
   * null when llmCallCount is 0 (never 0 as a stand-in).
   */
  avgLlmDurationMs: number | null;
  /**
   * Cache hit rate = cacheRead / (input + cacheRead), aggregated over
   * attributed llm-event tokens. null when the denominator is 0 (no tokens);
   * 0 is real when input > 0 and cacheRead = 0.
   */
  cacheHitRate: number | null;
  /**
   * Avg tokens per LLM call = sum of attributed llm token totals / llmCallCount.
   * null when llmCallCount is 0.
   */
  avgTokensPerCall: number | null;
  /**
   * Trae systemPrompt token estimate (chars ÷ 4). Display-only; MUST NOT enter
   * TokenUsage.input (billing semantics). null when session.systemPrompt is
   * null.
   */
  systemPromptTokensEstimate: number | null;
}

/** Agent Overview aggregation row, produced directly by server SQL,
 * see specs/storage REQ-009. */
export interface AgentOverviewRow {
  provider: ProviderKey;
  sourceAgent: string;
  sessionCount: number;
  eventCount: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  costUsd: number;
  avgWallClockMs: number;
  latestUpdatedAt: string;
  avgToolDurationMs: number | null;
  errorRate: number | null;
  verificationCoverage: number | null;
  debugEntryRate: number | null;
  /**
   * 各阶段累计耗时（SUM(events.duration_ms) 按 phase 分组，6 键全量、缺失为 0）。
   * 供 Agent Overview 堆叠 Phase 条使用；口径与单会话 PhaseRibbon 一致
   * （按事件 duration 求和，不是 wall-clock，G4.6 的 totalDuration 语义不适用）。
   */
  durationByPhase: Record<TracePhase, number>;
}
```

---

## 7. Proxy & Frida

```ts
export interface ProxyRequest {
  id: number;
  /** req-{timestamp}-{counter} */
  requestId: string;
  method: string;
  url: string;
  hostname: string;
  requestHeaders: Record<string, string>;
  /** Desensitized. Original in rawRequestBody. List endpoints do not return
   * this field. */
  requestBody: string | null;
  responseStatus: number | null;
  /** Desensitized. List endpoints do not return this field. */
  responseBody: string | null;
  contentType: string | null;
  isStreaming: boolean;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  captureMethod: CaptureMethod;
  /** true when x-tt-encrypt-* headers are present. TTNet bodies cannot be
   * MITM-decrypted (G6.2). */
  ttnetEncrypted: boolean;
  systemPrompt: string | null;
  /** Redundant length column, avoids LENGTH() sorting for
   * getSystemPromptForSession. */
  systemPromptLen: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  parsedSessionId: string | null;
  parserRoute: string | null;
  /** One opaque UUID per successful proxy run (add-request-context-diff D2).
   * Correlation evidence only; MUST NOT be presented as an agent session. */
  captureGroupId: string | null;
  /** Closed phase-1 request-format classification (add-request-context-diff
   * D3). Historical rows captured before the classification landed are
   * `unknown`. */
  requestFormat: RequestContextFormat;
  /** Un-desensitized original. Filled only when desensitization is enabled
   * (G8.3). List endpoints do not return it. */
  rawRequestBody: string | null;
  rawResponseBody: string | null;
}

/** List endpoint shape. Explicitly excludes the 4 body columns + the
 * systemPrompt body + request headers; carries only the lightweight
 * capture-group/request-format metadata. */
export type ProxyRequestListItem = Omit<
  ProxyRequest,
  'requestBody' | 'responseBody' | 'rawRequestBody' | 'rawResponseBody' | 'systemPrompt' | 'requestHeaders'
> & { hasSystemPrompt: boolean };

export interface FridaCapture {
  id: number;
  pid: number;
  capturedAt: string;
  captureType: string;
  jsonData: string;
  model: string | null;
  sessionId: string | null;
  captureSessionId: string | null;
  messageCount: number | null;
  tokens: TokenUsage | null;
}
```

### 7.1 Request-context diff (add-request-context-diff)

> Types copied verbatim from `design.md` D10 into `contracts/data-model.md`
> and `src/core/trace-types.ts`. The full nested interfaces and enum values
> below are contractual; the implementation MUST adopt them verbatim.

```ts
/** Closed phase-1 request-format set (design D3). Everything else is
 * `unknown`; there is no generic best-effort success. */
export type RequestContextFormat =
  | 'anthropic_messages'
  | 'openai_chat'
  | 'openai_responses'
  | 'unknown';

/** exact/capture_group are retained for historical display compatibility, not emitted by new automatic selection. */
export type ContextPairingConfidence = 'exact' | 'capture_group' | 'linked_session' | 'manual';
export type ContextDiffCategory = 'system' | 'messages' | 'tools' | 'parameters';
export type ContextChangeKind = 'added' | 'removed' | 'modified';
export type ContextDiffSegmentKind = 'equal' | 'added' | 'removed';

export interface ContextCompleteness {
  complete: boolean;
  omittedCount: number;
  reasons: Array<
    | 'item_limit'
    | 'entry_limit'
    | 'inline_limit'
    | 'response_limit'
    | 'source_incomplete'
  >;
}

export interface ContextRequestRef {
  id: number;
  requestId: string;
  startedAt: string;
  hostname: string;
  model: string | null;
  captureMethod: CaptureMethod;
  parserRoute: string | null;
  requestFormat: Exclude<RequestContextFormat, 'unknown'>;
  parsedSessionId: string | null;
  captureGroupId: string | null;
  bodySha256: string;
  bodyBytes: number;
}

When a retained original reference exists and passes integrity/decoding checks,
ContextRequestRef.bodySha256/bodyBytes identify those observed encoded original
bytes. Context normalization/growth compares decoded text instead; do not hash
a re-encoded preview as original provenance. Legacy records without file refs
retain their existing preview-text hash/byte semantics. Current recorded
contentDecoding controls decoding; absent legacy metadata remains unknown.

export interface ContextDiffSegment {
  kind: ContextDiffSegmentKind;
  text: string;
}

export interface ContextEvidenceValue {
  jsonType: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
  sha256: string;
  charLength: number;
  excerptStart: string;
  excerptEnd: string;
  truncated: boolean;
}

export interface ContextChangeEntry {
  category: ContextDiffCategory;
  kind: ContextChangeKind;
  identity: string;
  label: string;
  beforePath: string | null;
  afterPath: string | null;
  beforeIndex: number | null;
  afterIndex: number | null;
  changedPaths: string[];
  before: ContextEvidenceValue | null;
  after: ContextEvidenceValue | null;
  segments: ContextDiffSegment[] | null;
  truncatedReason: 'inline_limit' | 'response_limit' | null;
}

export interface ContextCategoryDiff {
  category: ContextDiffCategory;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  completeness: ContextCompleteness;
  entries: ContextChangeEntry[];
}

export interface ContextGrowth {
  baseChars: number;
  targetChars: number;
  deltaChars: number;
  messageDelta: number;
  toolDelta: number;
  inputTokenDelta: number | null;
  inputTokenDeltaReason: 'captured_usage' | 'usage_missing';
}

export interface ContextIndicator {
  code: 'history_shrink' | 'system_loss' | 'tool_loss' | 'source_incomplete';
  classification: 'observation' | 'suspected_compaction';
  severity: 'info' | 'warning';
  before: number | null;
  after: number | null;
  message: string;
}

export interface RequestContextDiffResponse {
  base: ContextRequestRef;
  target: ContextRequestRef;
  pairing: {
    confidence: ContextPairingConfidence;
    reason: string;
    warnings: string[];
  };
  noChange: boolean;
  growth: ContextGrowth;
  indicators: ContextIndicator[];
  categories: ContextCategoryDiff[];
  completeness: ContextCompleteness;
  generatedAt: string;
  durationMs: number;
}
```

> `unchanged` is an exact summary count. The `entries` array contains changed
> items only (added/removed/modified); unchanged evidence is not repeated in
> the response. Incomplete/truncated evidence can never return
> `noChange=true`; unknown/unavailable numbers render `—`, never `0`.

---

## 8. Scan state

```ts
/**
 * Incremental scan state. **In v4 this table was empty (measured 0 rows),
 * causing every round to rescan 800MB of sources.** Since v5 it is a
 * mandatory path; write failures must throw, never fail silently.
 */
export interface ScanState {
  /** Primary key. The real path before desensitization. */
  sourcePath: string;
  provider: ProviderKey;
  sessionId: string | null;
  fileSize: number;
  fileMtimeMs: number;
  /** SHA1(size + first 4KB + last 4KB), constant-cost fingerprint. */
  contentHash: string;
  /** Resume position for JSONL tail incremental reads. Always fileSize for
   * non-JSONL sources. */
  byteOffset: number;
  lastScanAt: string;
  eventCount: number;
}

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
  hash: string;
}
```

---

## 9. Config

```ts
export interface ProviderConfig {
  key: ProviderKey;
  enabled: boolean;
  /** Supports ~, ~\, %VAR% expansion syntaxes (G2.2). */
  path: string;
  sourceKind: SourceKind;
  /**
   * Watch strategy. sqlite / sqlcipher must be poll (chokidar unreliable in
   * WAL mode, G5.2). poll fingerprints must also cover the -wal file, or
   * changes still go undetected.
   */
  watchStrategy: 'chokidar' | 'poll';
  pollIntervalMs: number;
  label: string;
}

export interface LocalSessionConfig {
  providers: Record<ProviderKey, ProviderConfig>;
  /** Trae SQLCipher key file path. */
  traeKeyPath: string | null;
  /** Prewarm the most recent N sessions on startup. Default 0 (fully on
   * demand). See contracts/nfr.md §3. */
  prewarmRecent: number;
}
```

---

## 10. Event bus

```ts
export interface BusEvents {
  /** Ephemeral live-preview lifecycle; not persistence or Agent success. */
  proxy_stream_started: { requestId: string; hostname: string; startedAt: string };
  proxy_stream_ended: { requestId: string };
  /** Ephemeral opaque WS dirty hints; 1s/max64 IDs, selected feed only,
   * no body, replay, completion or durable-written-prefix guarantee. */
  proxy_sources_changed: { requestIds: string[] };
  /** Single session created. Low frequency, not coalesced. */
  session_created: { key: string; provider: ProviderKey };
  /**
   * ⚠️ Since v5, **per-session emission is forbidden**. Use the
   * sessions_changed coalesced event instead. Measured: per-event emission
   * caused 508 requests / 151.2MB in 30s on the frontend.
   */
  sessions_changed: { keys: string[]; count: number };
  session_deleted: { key: string };
  scan_started: { provider: ProviderKey | 'all' };
  scan_completed: { provider: ProviderKey | 'all'; count: number };
  proxy_request: { id: number; hostname: string; item?: ProxyRequestListItem; requestCount?: number };
  trace_links_changed: { sessionKeys: string[]; proxyIds: number[]; truncated: boolean };
  /** Proxy async start/stop status (D4: starting → running / idle); readiness
   * is signaled by this event. */
  proxy_status: { running: boolean; starting: boolean; port?: number | null; error?: string | null; diagnostics?: ProxyMonitorDiagnostics };
  /** Server already concatenates on a 100ms window; frontend needs no further
   * throttling. */
  proxy_stream_chunk: { requestId: string; chunk: string };
  frida_capture: { id: number; model?: string; sessionId?: string };
  frida_status: { running: boolean; pid?: number };
  /**
   * Team run changes (add-agent-team-observability D14). Coalesced in the
   * existing 200ms window. `agentIds` / `taskIds` are capped (contract default
   * 200 each); above the cap the coalescer retains `runIds`, sets `truncated`
   * and the open run performs one snapshot refresh. No activity ids are
   * broadcast; the ledger invalidates pages intersecting the changed run/time
   * stamp. `stamp` is the run's new update stamp for patch/reconnect checks.
   */
  team_runs_changed: {
    runIds: string[];
    agentIds: string[];
    taskIds: string[];
    truncated: boolean;
    stamp: string;
  };
}
```

Live stream lifecycle describes identity-encoded SSE responses only. startedAt
is the observed UTC request start; ended means the network preview ended, not
that a complete original/parsed record was persisted. Normal chunk windows are
100ms; terminal flush may emit an accepted partial window before ended. No raw
chunk is sent on the default metadata subscription. Selected subscription uses
the requestId exactly as observed; missing/earlier chunks are not recovered.

SSE's non-bus connected control additionally supports the following shape:

```ts
export interface SseConnected {
  serverTime: string;
  schemaVersion: number;
  cursor: string;
  resume: 'fresh' | 'replayed' | 'reset';
}
```

The cursor identifies an in-memory metadata position, not a database revision.
Reset means a restart, expired/overflowed window or unusable cursor; no assertion
of durable event history or recovered live body fragments is made.

---

## 11. Type-level acceptance

The following assertions must exist in `src/core/trace-types.test.ts` and fail
at compile time:

```ts
import { expectTypeOf } from 'vitest';

// The full enum set must not lose entries
expectTypeOf<TracePhase>().toEqualTypeOf<
  'understand' | 'plan' | 'implement' | 'debug' | 'verify' | 'report'
>();

// slim tier must never contain body fields
expectTypeOf<TraceEventSlim>().not.toHaveProperty('inputSummary');
expectTypeOf<TraceEventSlim>().not.toHaveProperty('raw');

// Index entries must never contain the systemPrompt body
expectTypeOf<SessionIndexEntry>().not.toHaveProperty('systemPrompt');

// Proxy list items must never contain any body
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
```

Additional exclusions added by add-request-context-diff §1.2 — the list item
must still omit every body/header/system-prompt field while carrying the two
new lightweight metadata fields:

```ts
// Proxy list items must still exclude ALL body + header + system-prompt fields
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('responseBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawRequestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('systemPrompt');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestHeaders');

// Proxy list items carry only the lightweight correlation metadata
expectTypeOf<ProxyRequestListItem>().toHaveProperty('captureGroupId');
expectTypeOf<ProxyRequestListItem>().toHaveProperty('requestFormat');

// The closed request-format enum must not gain or lose entries
expectTypeOf<RequestContextFormat>().toEqualTypeOf<
  'anthropic_messages' | 'openai_chat' | 'openai_responses' | 'unknown'
>();

// The response shape compiles verbatim from design D10
expectTypeOf<ContextPairingConfidence>().toEqualTypeOf<
  'exact' | 'capture_group' | 'linked_session' | 'manual'
>();
expectTypeOf<ContextDiffCategory>().toEqualTypeOf<
  'system' | 'messages' | 'tools' | 'parameters'
>();
expectTypeOf<ContextChangeKind>().toEqualTypeOf<
  'added' | 'removed' | 'modified'
>();
expectTypeOf<ContextDiffSegmentKind>().toEqualTypeOf<
  'equal' | 'added' | 'removed'
>();
```

Additional assertions added by fix-adapter-turn-semantics §1.7 — the two new
kinds are closed members of `TraceKind`, `turnKey` exists on the slim tier with
`null` as a valid value, and the provenance enum is closed:

```ts
// The two new kinds are first-class members
expectTypeOf<TraceKind>().toEqualTypeOf<
  'llm' | 'tool' | 'file_read' | 'file_write' | 'bash' | 'test'
  | 'agent' | 'system' | 'message' | 'user_prompt' | 'subagent_prompt'
  | 'reasoning' | 'compact'
>();

// turnKey exists and null is a valid value
expectTypeOf<Pick<TraceEventSlim, 'turnKey'>>().toEqualTypeOf<{
  turnKey: string | null;
}>();

// The provenance enum is closed
expectTypeOf<TurnKeySource>().toEqualTypeOf<
  'native_boundary' | 'stream_structure' | 'message_identity' | 'unavailable'
>();
```

Additional assertions added by add-trajectory-inspector §1.3/§1.4/§1.9 — the
derived turn enums are closed, every derived type compiles verbatim from the
trace-model delta spec, the index entry carries `tags`, and **no `toolCallId`
field exists** (identity comes from `event.id`, deviation C7 / design D5):

```ts
// The three derived turn enums are closed
expectTypeOf<TurnSegmentationSource>().toEqualTypeOf<
  'turn_key' | 'llm_boundary' | 'user_prompt_boundary' | 'sequence_fallback'
>();
expectTypeOf<TurnKind>().toEqualTypeOf<'init' | 'user' | 'cycle'>();
expectTypeOf<MessageRole>().toEqualTypeOf<
  'system' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'compact' | 'subagent'
>();
expectTypeOf<TurnBadge>().toEqualTypeOf<
  'init' | 'user' | 'tools' | 'stop' | 'error' | 'subagent' | 'compact' | 'running'
>();

// Turn identity comes from the member event id — never a toolCallId field
expectTypeOf<Pick<TurnMessage, 'eventId'>>().toEqualTypeOf<{ eventId: string }>();
expectTypeOf<TurnMessage>().not.toHaveProperty('toolCallId');
expectTypeOf<TraceTurn>().not.toHaveProperty('toolCallId');

// Turn model carries completeness explicitly
expectTypeOf<Pick<TurnModel, 'complete' | 'omittedEventCount'>>().toEqualTypeOf<{
  complete: boolean;
  omittedEventCount: number;
}>();

// Index entries carry the tags array
expectTypeOf<Pick<SessionIndexEntry, 'tags'>>().toEqualTypeOf<{ tags: string[] }>();

// Annotation shapes compile verbatim from design D13
expectTypeOf<Pick<SessionAnnotations, 'sessionKey' | 'tags' | 'note' | 'updatedAt'>>()
  .toEqualTypeOf<{
    sessionKey: string;
    tags: string[];
    note: string | null;
    updatedAt: string | null;
  }>();
expectTypeOf<SessionAnnotationsUpdate>().toHaveProperty('tags');
expectTypeOf<SessionAnnotationsUpdate>().toHaveProperty('note');
```

---

## 12. Team observability (add-agent-team-observability)

> 本节的枚举与记录类型来自 `changes/add-agent-team-observability/design.md` D3
> 词汇表（冻结基准）与 D4–D10，字段的 null 性依据
> `openspec/research/agent-team-evidence.md` 的脱敏字段映射矩阵冻结。
> 所有 adapter、storage、API、前端组件类型必须逐字采用本节定义。
> 对应运行时源文件：`src/core/trace-types.ts`。

### 12.1 Closed team enums

前 12 个是 design D3 的闭合枚举，**不得扩展**。后 4 个是 design D8/D9/D10
明确要求的补充枚举（order/round/metric 方向），同样封闭。

```ts
/** 拓扑分类（design D5，由 edges 推导，绝不按 provider 名假设）。 */
export type TeamTopologyKind =
  | 'two_level'
  | 'three_level'
  | 'deep_tree'
  | 'peer_graph'
  | 'hybrid'
  | 'unknown';

export const TEAM_TOPOLOGY_KINDS: readonly TeamTopologyKind[] = [
  'two_level', 'three_level', 'deep_tree', 'peer_graph', 'hybrid', 'unknown',
] as const;

/**
 * 证据可信度，按事实（fact）而非按 run 赋值（design D4）。
 * - native：源记录显式陈述该事实
 * - correlated：显式稳定 id 连接两条 native 记录
 * - inferred：文档化启发式（如 legacy subagent-title 模式）
 * - unavailable：无法获取该事实
 */
export type EvidenceConfidence = 'native' | 'correlated' | 'inferred' | 'unavailable';

/** 证据维度（design D3；completeness 按此九维独立报告）。 */
export type EvidenceDimension =
  | 'topology'
  | 'tasks'
  | 'communication'
  | 'timing'
  | 'tools'
  | 'outputs'
  | 'tokens'
  | 'cost'
  | 'verification';

/** 单个维度的完整性水平。 */
export type CompletenessLevel = 'complete' | 'partial' | 'unavailable' | 'conflicted';

/** team run 生命周期状态。provider 原生状态由 adapter 归一化。 */
export type TeamRunStatus =
  | 'planned'
  | 'running'
  | 'blocked'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'unknown';

/** agent 生命周期状态。 */
export type TeamAgentState =
  | 'created'
  | 'ready'
  | 'busy'
  | 'blocked'
  | 'idle'
  | 'failed'
  | 'replaced'
  | 'cancelled'
  | 'completed'
  | 'unknown';

/** task 状态。 */
export type TeamTaskStatus =
  | 'pending'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

/**
 * agent 关系边类型（design D5）。拓扑由 `created` / `supervises` 推导，
 * `coordinates` / `reviews` / `replaces` / `peer` 是覆盖层，不静默改变父边。
 */
export type TeamAgentEdgeKind =
  | 'created'
  | 'supervises'
  | 'coordinates'
  | 'reviews'
  | 'replaces'
  | 'peer';

/** 活动账本种类。封闭：provider 原生类型保留在 evidence 元数据，不扩展本 union。 */
export type TeamActivityKind =
  | 'agent_lifecycle'
  | 'task_created'
  | 'task_dependency'
  | 'task_assignment'
  | 'task_status'
  | 'round'
  | 'message_sent'
  | 'message_received'
  | 'tool_call'
  | 'tool_result'
  | 'artifact'
  | 'verification'
  | 'handoff'
  | 'error'
  | 'recovery'
  | 'integration'
  | 'unknown';

/**
 * 消息投递模式（design D7）。`leader_mediated` 要求观测到两跳，
 * 绝不从「leader 在场」推断。
 */
export type TeamMessageMode = 'direct' | 'leader_mediated' | 'broadcast' | 'unknown';

/** 消息类别。 */
export type TeamMessageCategory =
  | 'assignment'
  | 'coordination'
  | 'question'
  | 'answer'
  | 'handoff'
  | 'status'
  | 'blocker'
  | 'review'
  | 'correction'
  | 'result'
  | 'system'
  | 'unknown';

/** 比较基准匹配结果（design D10）。unmatched/unknown 仍是成功响应，不是错误。 */
export type ComparisonMatch = 'matched' | 'partially_matched' | 'unmatched' | 'unknown';

/** 活动账本排序置信度（design D8）：跨源无共享序列时 `ambiguous`。 */
export type TeamOrderConfidence = 'native' | 'ambiguous';

/** round 边界来源（design D8 四级优先级）。 */
export type TeamRoundSegmentationSource =
  | 'native_round'
  | 'session_turn'
  | 'turn_model'
  | 'unavailable';

/** 比较的五维（design D9）。 */
export type TeamMetricDimension = 'speed' | 'accuracy' | 'stability' | 'cost' | 'collaboration';

/** 指标方向性（metrics-analysis REQ-018）。 */
export type TeamMetricDirection = 'higher_better' | 'lower_better' | 'descriptive';
```

### 12.2 Evidence reference and completeness

```ts
/**
 * 证据引用。标识一条规范化事实的出处与可信度；**绝不内嵌源正文**
 * （design D4 / trace-model delta）。`sourceKind` 当前取值集合为
 * `agent-team-directory`（CodeArts）与 `codex-jsonl`（Codex），随新 dialect 扩展。
 */
export interface EvidenceRef {
  id: string;
  sourceKind: string;
  /** 脱敏/不透明的源定位器；真实本地路径留在服务端。 */
  sourceLocator: string;
  nativeId: string | null;
  nativeSequence: number | null;
  capturedAt: string;
  confidence: EvidenceConfidence;
  parserVersion: string;
}

/** 运行级计数。仅当对应维度 completeness 为 `complete` 时值才是可断言的真实值。 */
export interface TeamRunCounts {
  agents: number;
  tasks: number;
  communications: number;
  activities: number;
  rounds: number;
  artifacts: number;
}

/** 单个维度的完整性快照（九维）。 */
export type TeamCompleteness = Record<EvidenceDimension, CompletenessLevel>;

/** DAG/拓扑校验发现的异常，只报告不修复（design D6 / D5）。 */
export interface TeamAnomaly {
  kind: string;
  dimension: EvidenceDimension;
  severity: 'info' | 'warning';
  message: string;
  entityIds: string[];
  evidenceIds: string[];
}
```

### 12.3 Core team records

```ts
/**
 * team run 列表条目（slim）。绝不含 task/message/tool/reasoning/artifact 正文。
 * `goalFingerprint` 是脱敏归一化指纹，全文只进 detail（design D18）。
 */
export interface TeamRunSummary {
  id: string;
  provider: ProviderKey;
  /** provider run 身份：CodeArts = leader sessionID；Codex = 根线程 id。 */
  nativeRunId: string;
  /**
   * run 身份的置信度：CodeArts `native`（目录名/contact/session 三源一致），
   * Codex `correlated`（根线程 id 本身 native，但「当作 team run 锚点」是推导）。
   */
  runIdentityConfidence: EvidenceConfidence;
  title: string;
  goalFingerprint: string | null;
  status: TeamRunStatus;
  startedAt: string | null;
  endedAt: string | null;
  topologyKind: TeamTopologyKind;
  counts: TeamRunCounts;
  /** token 维度是否可观测（evidence 实测两 provider 均 native）。 */
  tokenAvailable: boolean;
  /** cost 维度是否可观测：CodeArts native(USD)，Codex unavailable。 */
  costAvailable: boolean;
  costCurrency: PriceCurrency | null;
  completeness: TeamCompleteness;
  updatedAt: string;
  /** 变更戳 = 受影响的派生投影最大更新时间，供 patch/reconnect 比较。 */
  stamp: string;
}

/**
 * 打开一个 team run 返回的有界快照。summary + 图元数据 + 完整性 + 异常 + 指标；
 * **绝不**包含 activity、message、tool、raw、reasoning、artifact 正文（design D13）。
 */
export interface TeamRunSnapshot {
  summary: TeamRunSummary;
  agents: TeamAgent[];
  agentEdges: TeamAgentEdge[];
  tasks: TeamTask[];
  taskDependencies: TeamTaskDependency[];
  /** 当前 active 指派（unassignedAt === null 的投影）。 */
  assignments: TeamAssignment[];
  artifacts: TeamArtifact[];
  completeness: TeamCompleteness;
  anomalies: TeamAnomaly[];
  metrics: TeamMetrics;
}

/**
 * 参与者。`role` 保留 provider 原生标签（team-leader/team-mate/agent_nickname…）；
 * `roleClass` 是规范化类别（`leader` | `teammate` | `subagent` | `unknown`），
 * Codex 的 root→leader、depth-1 subagent→subagent（design D16，level 标签非硬编码）。
 */
export interface TeamAgent {
  id: string;
  runId: string;
  nativeId: string;
  displayName: string;
  role: string;
  roleClass: string;
  model: string | null;
  state: TeamAgentState;
  createdAt: string | null;
  endedAt: string | null;
  /** 关联 session 的 keys（可空数组；仅存显式关联，见 design D15 session jump）。 */
  sessionKeys: string[];
  evidenceIds: string[];
}

/** agent 关系边（versioned；`validTo` null = 仍 active）。 */
export interface TeamAgentEdge {
  id: string;
  runId: string;
  fromAgentId: string;
  toAgentId: string;
  kind: TeamAgentEdgeKind;
  validFrom: string | null;
  validTo: string | null;
  confidence: EvidenceConfidence;
  evidenceIds: string[];
}

/**
 * task（slim 身份/状态/时间/body 标志）。无 description/result 正文
 * （design D11 body policy）。
 */
export interface TeamTask {
  id: string;
  runId: string;
  nativeId: string;
  title: string;
  descriptionAvailable: boolean;
  priority: number | null;
  status: TeamTaskStatus;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  resultAvailable: boolean;
  evidenceIds: string[];
}

/** task 依赖边（versioned DAG edge）。 */
export interface TeamTaskDependency {
  id: string;
  runId: string;
  upstreamTaskId: string;
  downstreamTaskId: string;
  validFrom: string | null;
  validTo: string | null;
  confidence: EvidenceConfidence;
  evidenceIds: string[];
}

/**
 * task 指派历史（多对多随时间，design D6）。`assignmentKind` 取值集合
 * `claimed` | `assigned` | `reassigned` | `review`；`unassignedAt` null = active。
 */
export interface TeamAssignment {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  assignedAt: string | null;
  unassignedAt: string | null;
  assignmentKind: string;
  evidenceIds: string[];
}

/**
 * 逻辑通信记录（slim，无消息正文，design D7）。广播 = 一条逻辑消息 + 多个
 * recipient，不复制 N 份正文。body 尺寸/hash 用于重复检测而不外发内容。
 */
export interface TeamCommunication {
  id: string;
  runId: string;
  senderAgentId: string;
  recipientAgentIds: string[];
  mode: TeamMessageMode;
  category: TeamMessageCategory;
  taskId: string | null;
  correlationId: string | null;
  replyToId: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  bodyAvailable: boolean;
  bodyChars: number | null;
  bodyBytes: number | null;
  contentHash: string | null;
  evidenceIds: string[];
}

/**
 * 统一执行账本的 slim 行。**绝不含** raw / message / tool 参数与结果 /
 * reasoning / artifact 正文（design D3）。`status` 复用 `TraceStatus`
 * （活动自身的执行结果）；agent 的当前状态见 `TeamAgent.state`。
 */
export interface TeamActivitySlim {
  id: string;
  runId: string;
  agentId: string | null;
  taskId: string | null;
  roundId: string | null;
  kind: TeamActivityKind;
  status: TraceStatus;
  startedAt: string | null;
  endedAt: string | null;
  nativeSequence: number | null;
  /** 显式 session/event/turn 链接（design D15「链接而不复制/重编号」）。 */
  sessionKey: string | null;
  eventId: string | null;
  turnKey: string | null;
  /** 关联 message/artifact 实体 id（message_sent/received → communication；artifact → artifact）。 */
  messageId: string | null;
  artifactId: string | null;
  tokenUsage: TokenUsage | null;
  costUsd: number | null;
  costSource: CostSource | null;
  costCurrency: PriceCurrency | null;
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
  evidenceIds: string[];
  orderConfidence: TeamOrderConfidence;
}

/**
 * per-agent round。`aggregates` 里 tokens/cost 可用性独立，unavailable 为 null
 * 而非 0（design D8 / capability spec）。round 边界优先级见
 * `TeamRoundSegmentationSource`。
 */
export interface TeamRoundAggregates {
  wallClockMs: number | null;
  activeMs: number | null;
  tokenUsage: TokenUsage | null;
  costUsd: number | null;
  toolCallCount: number;
  messageCount: number;
}

export interface TeamRound {
  id: string;
  runId: string;
  agentId: string;
  nativeId: string | null;
  index: number;
  segmentationSource: TeamRoundSegmentationSource;
  startedAt: string | null;
  endedAt: string | null;
  status: TraceStatus;
  taskIds: string[];
  outputArtifactIds: string[];
  aggregates: TeamRoundAggregates;
  completeness: CompletenessLevel;
}

/**
 * artifact 元数据（无内容正文，design D11/D18）。`kind` 取值集合
 * `file` | `patch` | `report`；content 只进单条 detail。
 */
export interface TeamArtifact {
  id: string;
  runId: string;
  nativeId: string | null;
  name: string;
  kind: string;
  pathRedacted: string | null;
  contentHash: string | null;
  producerAgentIds: string[];
  taskIds: string[];
  createdAt: string | null;
  acceptedAt: string | null;
  hasContent: boolean;
  evidenceIds: string[];
}
```

### 12.4 Team metrics and comparison

```ts
/**
 * 单个指标的统一信封（design D9）。每个指标携带可用性、完整性、口径行与
 * 支撑证据；`value` null = unavailable（禁止 0 冒充）。比例类指标携带
 * numerator/denominator。
 */
export interface TeamMetricValue {
  value: number | null;
  available: boolean;
  complete: boolean;
  criteria: string;
  evidenceIds: string[];
  numerator: number | null;
  denominator: number | null;
}

export interface TeamSchedulingMetrics {
  wallClockMs: TeamMetricValue;
  agentActiveMs: TeamMetricValue;
  totalWorkMs: TeamMetricValue;
  observedWaitMs: TeamMetricValue;
  maxConcurrency: TeamMetricValue;
  avgConcurrency: TeamMetricValue;
  serialWorkEstimateMs: TeamMetricValue;
  observedSpeedup: TeamMetricValue;
  peakCapacityUtilization: TeamMetricValue;
  criticalPathMs: TeamMetricValue;
  delegationDelayMs: TeamMetricValue;
  handoffLatencyMs: TeamMetricValue;
}

export interface TeamQualityMetrics {
  taskCompletion: TeamMetricValue;
  verificationCoverage: TeamMetricValue;
  acceptanceCoverage: TeamMetricValue;
  reviewRework: TeamMetricValue;
  acceptedArtifactRate: TeamMetricValue;
}

export interface TeamStabilityMetrics {
  failures: TeamMetricValue;
  retries: TeamMetricValue;
  replacements: TeamMetricValue;
  recoveryLatencyMs: TeamMetricValue;
  blockedOrphanTimeMs: TeamMetricValue;
  unresolvedErrors: TeamMetricValue;
  dagAnomalies: TeamMetricValue;
  incompleteTerminalStates: TeamMetricValue;
}

export interface TeamCostMetrics {
  totalInputTokens: TeamMetricValue;
  totalOutputTokens: TeamMetricValue;
  totalReasoningTokens: TeamMetricValue;
  totalCacheReadTokens: TeamMetricValue;
  totalCacheWriteTokens: TeamMetricValue;
  totalCostUsd: TeamMetricValue;
  /** cost 不可观测（Codex）时为 null；禁止显示 $0.0000（evidence §9.3）。 */
  costCurrency: PriceCurrency | null;
  coordinationTokens: TeamMetricValue;
  costGini: TeamMetricValue;
}

export interface TeamCollaborationMetrics {
  directRatio: TeamMetricValue;
  leaderMediatedRatio: TeamMetricValue;
  responseLatencyMedianMs: TeamMetricValue;
  responseLatencyP95Ms: TeamMetricValue;
  taskBalanceGini: TeamMetricValue;
  leaderWorkConcentration: TeamMetricValue;
  criticalAgentConcentration: TeamMetricValue;
  crossAgentReview: TeamMetricValue;
  duplicateWorkSignal: TeamMetricValue;
}

/**
 * 按计算版本持久化的 run 级指标（design D9）。算法/证据语义变更必须 bump
 * `calcVersion`（metrics-analysis REQ-019）。
 */
export interface TeamMetrics {
  calcVersion: number;
  generatedAt: string;
  scheduling: TeamSchedulingMetrics;
  quality: TeamQualityMetrics;
  stability: TeamStabilityMetrics;
  cost: TeamCostMetrics;
  collaboration: TeamCollaborationMetrics;
}

/** 比较基准（design D10）。`userDeclared` 不抹除检测到的差异。 */
export interface TeamComparisonBasis {
  match: ComparisonMatch;
  goalMatch: boolean | null;
  criteriaMatch: boolean | null;
  projectMatch: boolean | null;
  revisionMatch: boolean | null;
  environmentMatch: boolean | null;
  modelMatch: boolean | null;
  templateMatch: boolean | null;
  completenessDelta: boolean | null;
  userDeclared: boolean;
  reasons: string[];
}

/** 单条比较指标行：raw 左右值 + delta（右减左）+ 相对 delta + 方向 + 口径。 */
export interface TeamComparisonMetricRow {
  metricId: string;
  dimension: TeamMetricDimension;
  criteria: string;
  direction: TeamMetricDirection;
  left: TeamMetricValue;
  right: TeamMetricValue;
  /** right − left。 */
  delta: number | null;
  /** 仅 left 为有限非零时计算，否则 null（禁止 infinity / 0 冒充）。 */
  relativeDelta: number | null;
  material: boolean;
  completeness: CompletenessLevel;
  evidenceIds: string[];
}

export interface TeamComparisonDimension {
  dimension: TeamMetricDimension;
  rows: TeamComparisonMetricRow[];
}

/**
 * 两 run 比较响应（design D10）。strengths/weaknesses/tradeoffs 由确定性规则
 * 从 material、complete、方向感知的 delta 选出，无 LLM、无 winner、无总评分。
 */
export interface TeamComparison {
  leftRunId: string;
  rightRunId: string;
  basis: TeamComparisonBasis;
  dimensions: TeamComparisonDimension[];
  strengths: string[];
  weaknesses: string[];
  tradeoffs: string[];
  caveats: string[];
  generatedAt: string;
}
```

### 12.5 Team type-level acceptance

以下断言必须存在于 `src/core/trace-types.test.ts` 且编译期失败（追加，不覆盖
既有断言）：

```ts
// 12 个闭合 team 枚举全集不得增减
expectTypeOf<TeamTopologyKind>().toEqualTypeOf<
  'two_level' | 'three_level' | 'deep_tree' | 'peer_graph' | 'hybrid' | 'unknown'
>();
expectTypeOf<EvidenceConfidence>().toEqualTypeOf<
  'native' | 'correlated' | 'inferred' | 'unavailable'
>();
expectTypeOf<EvidenceDimension>().toEqualTypeOf<
  'topology' | 'tasks' | 'communication' | 'timing' | 'tools' | 'outputs'
  | 'tokens' | 'cost' | 'verification'
>();
expectTypeOf<CompletenessLevel>().toEqualTypeOf<
  'complete' | 'partial' | 'unavailable' | 'conflicted'
>();
expectTypeOf<TeamRunStatus>().toEqualTypeOf<
  'planned' | 'running' | 'blocked' | 'success' | 'error' | 'cancelled' | 'unknown'
>();
expectTypeOf<TeamAgentState>().toEqualTypeOf<
  'created' | 'ready' | 'busy' | 'blocked' | 'idle' | 'failed' | 'replaced'
  | 'cancelled' | 'completed' | 'unknown'
>();
expectTypeOf<TeamTaskStatus>().toEqualTypeOf<
  'pending' | 'ready' | 'claimed' | 'running' | 'blocked' | 'completed'
  | 'failed' | 'cancelled' | 'unknown'
>();
expectTypeOf<TeamAgentEdgeKind>().toEqualTypeOf<
  'created' | 'supervises' | 'coordinates' | 'reviews' | 'replaces' | 'peer'
>();
expectTypeOf<TeamActivityKind>().toEqualTypeOf<
  'agent_lifecycle' | 'task_created' | 'task_dependency' | 'task_assignment'
  | 'task_status' | 'round' | 'message_sent' | 'message_received' | 'tool_call'
  | 'tool_result' | 'artifact' | 'verification' | 'handoff' | 'error' | 'recovery'
  | 'integration' | 'unknown'
>();
expectTypeOf<TeamMessageMode>().toEqualTypeOf<
  'direct' | 'leader_mediated' | 'broadcast' | 'unknown'
>();
expectTypeOf<TeamMessageCategory>().toEqualTypeOf<
  'assignment' | 'coordination' | 'question' | 'answer' | 'handoff' | 'status'
  | 'blocker' | 'review' | 'correction' | 'result' | 'system' | 'unknown'
>();
expectTypeOf<ComparisonMatch>().toEqualTypeOf<
  'matched' | 'partially_matched' | 'unmatched' | 'unknown'
>();

// 补充枚举封闭
expectTypeOf<TeamOrderConfidence>().toEqualTypeOf<'native' | 'ambiguous'>();
expectTypeOf<TeamRoundSegmentationSource>().toEqualTypeOf<
  'native_round' | 'session_turn' | 'turn_model' | 'unavailable'
>();
expectTypeOf<TeamMetricDimension>().toEqualTypeOf<
  'speed' | 'accuracy' | 'stability' | 'cost' | 'collaboration'
>();
expectTypeOf<TeamMetricDirection>().toEqualTypeOf<
  'higher_better' | 'lower_better' | 'descriptive'
>();

// slim 类型绝不携带 body 字段
expectTypeOf<TeamRunSummary>().not.toHaveProperty('raw');
expectTypeOf<TeamRunSummary>().not.toHaveProperty('goal');
expectTypeOf<TeamCommunication>().not.toHaveProperty('body');
expectTypeOf<TeamCommunication>().not.toHaveProperty('message');
expectTypeOf<TeamActivitySlim>().not.toHaveProperty('raw');
expectTypeOf<TeamActivitySlim>().not.toHaveProperty('inputSummary');
expectTypeOf<TeamActivitySlim>().not.toHaveProperty('outputSummary');
expectTypeOf<TeamActivitySlim>().not.toHaveProperty('toolInput');
expectTypeOf<TeamActivitySlim>().not.toHaveProperty('toolOutput');
expectTypeOf<TeamActivitySlim>().not.toHaveProperty('reasoning');
expectTypeOf<TeamTask>().not.toHaveProperty('description');
expectTypeOf<TeamTask>().not.toHaveProperty('result');
expectTypeOf<TeamArtifact>().not.toHaveProperty('content');

// required id 存在且非空
expectTypeOf<Pick<TeamRunSummary, 'id'>>().toEqualTypeOf<{ id: string }>();
expectTypeOf<Pick<TeamAgent, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
expectTypeOf<Pick<TeamTask, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
expectTypeOf<Pick<TeamCommunication, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
expectTypeOf<Pick<TeamActivitySlim, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();

// nullable 可用性：cost 不可观测必须能表达 null（禁止 0 冒充）
expectTypeOf<Pick<TeamRunSummary, 'costCurrency'>>().toEqualTypeOf<{ costCurrency: PriceCurrency | null }>();
expectTypeOf<Pick<TeamCostMetrics, 'costCurrency'>>().toEqualTypeOf<{ costCurrency: PriceCurrency | null }>();
expectTypeOf<Pick<TeamMetricValue, 'value'>>().toEqualTypeOf<{ value: number | null }>();
```

## Client tool-inspection projection

```ts

/** Client-only grouping of retained tool observations on ONE execution page.
 * key is a UI selection key, never a native execution ID or persisted identity.
 * No count, order or input/output flag establishes execution/causal success. */
export interface ToolInspectionGroup {
  key: string;
  reason: 'native_id' | 'missing_identity' | 'incomplete' | 'ambiguous_identity';
  identities: TraceSourceIdentity[];
  events: TraceEventSlim[];
}
```

Groups are current-page metadata only, using one nonempty scoped tool_call tuple
per event from this scan session and a complete identity manifest. Duplicate
locators do not create a new group. Conflicting IDs, unbound locators or repeated
IDs across known distinct turnKeys prevent grouping. Incomplete/absent identity
keeps each event independent. Same name, event-id shape, adjacency, wall time or
protocol proposal never supplies a native tool ID. Input/output are retained
hasInput/hasOutput hints, not inferred lifecycle roles. Off-page references and
page coverage stay explicit; there is no whole-session execution count or new
measured tool timing. No source mutation, billing or tool execution.

## Cross-page native tool observations

The exact NativeToolObservationPage definition in [native-tool-observations.md](native-tool-observations.md) extends this contract. It organizes retained references only, never inventing execution/retry identity.
# Additive functional contracts (M11 increment)

Official Claude HTTP-hook observation types are defined verbatim in
[claude-hooks.md](claude-hooks.md) CH-001..006 and src/core/claude-hooks.ts.
BusEvents additionally includes hook_events_changed:{latestId:number}; only a
coalesced saved-metadata hint, not a per-session or body event.

The frozen local metadata export types are in [trace-export.md](trace-export.md)
TX-001..004; generated export IDs are separate from native/propagated identities.
Manual experiment DTOs are in [experiment-records.md](experiment-records.md)
EXP-001..004. Their conditions/labels are user declarations and do not change
TraceRecord, native evidence, SQLite schema or measured quality.

Frida saved-capture flow uses the existing `FridaCapture` definition above,
with limits, lifecycle and list/detail ownership frozen in
[frida-capture-flow.md](frida-capture-flow.md) FC-001..004. No new native
session identity or completed Agent execution is inferred from capture.
The additive linked-network OTLP document is independently defined in
[linked-trace-export.md](linked-trace-export.md) LTX-001..005; network and scan
observations keep separate generated trace IDs and explicit coverage.
Standard Electron CDP helper types, ownership and the additive development-only
DTOs below follow [cdp-capture-flow.md](cdp-capture-flow.md).

## Development CDP inspection DTOs

Original capture bundle DTOs and retained-byte semantics are defined verbatim
in [capture-bundle.md](capture-bundle.md) CB-001..005. They wrap existing evidence
and original refs without changing native identity or SQLite storage types.

```ts
export interface CdpDevStatus {
  state: 'idle' | 'running' | 'stopping';
  discovering: boolean;
  targetCount: number;
  connectedTargetCount: number;
}
export interface CdpDevTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}
export interface CdpDevCaptureSummary {
  id: number; // positive safe development-server-local sequence, never a native ID
  targetId: string;
  url: string;
  capturedAt: string; // UTC body-acquisition callback time, not network end
  bodyBytes: number; // decoded UTF-8 text bytes, not original wire length
}
export interface CdpDevCaptureDetail extends CdpDevCaptureSummary { body: string }
export interface CdpDevCapturePage {
  items: CdpDevCaptureSummary[];
  totalBytes: number;
  rejectedCount: number;
  lastIssue: string | null; // static CdpIssueCode or capture_limit; max64 characters
}
```

These represent decoded response acquisition only. No request, header, HTTP
status, native identity, execution, archive, token or timing measurement is
inferred. No source data is inserted as a fabricated MITM or native event.

## Task workbench read projection (2026-10-25)

The additive process/time DTOs and query fields follow [task-process.md](task-process.md)
TP-001..005 and their canonical definitions in `src/core/task-types.ts`.

Task identity is anchored to a uniquely resolved native root Session. `collected:<sessionKey>` and `imported:<contentHash>` occupy disjoint namespaces. Child Session lookup resolves to the same root task when a unique explicit run root exists; unresolved or conflicting relationships remain standalone with warnings. No title/time inference is allowed. Imported evidence remains independent and cannot imply online execution. `provenanceKnown=false` labels legacy native records lacking scan provenance; it is not a third intake pipeline. Counts describe retained records, never live-process state. No body fields occur in list/context/record metadata. Canonical types in `src/core/task-types.ts`:

```ts
import type { ProviderKey, TraceEventSlim, TraceLogSession, TraceLogTurn, TraceStatus } from './trace-types.js';

/** Task identity is a read projection; native IDs and evidence remain unchanged. */
export type TaskOrigin = 'collected' | 'imported';
export interface TaskSummary {
  id: string;
  origin: TaskOrigin;
  provenanceKnown: boolean;
  rootSessionKey: string | null;
  runId: string | null;
  title: string;
  provider: string;
  startedAt: string | null;
  updatedAt: string;
  recordedStatus: string;
  memberCount: number;
  eventCount: number;
  loadedMemberCount: number;
}
export interface TaskMember {
  id: string;
  name: string;
  role: string;
  sessionKey: string | null;
  parentId: string | null;
  detailLoaded: boolean;
  eventCount: number;
}
export interface TaskContext {
  task: TaskSummary;
  members: TaskMember[];
  importSession: TraceLogSession | null;
  warnings: string[];
}
export interface TaskPage {
  items: TaskSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
export interface TaskRecord {
  id: string;
  memberId: string;
  memberName: string;
  sessionKey: string | null;
  event: TraceEventSlim | null;
  importedTurn: TraceLogTurn | null;
}
export interface TaskRecordPage {
  context: TaskContext;
  items: TaskRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  hasPrevious: boolean;
  /** Session sequence ceilings make subsequent pages independent of live appends. */
  window: string;
  warnings: string[];
  /** Optional indexed native facts; semantic grouping remains client-only. */
  structure?: TaskStructure;
}
export interface TaskListQuery { origin?: TaskOrigin; q?: string; provider?: ProviderKey; range?: 'today' | '7d' | '30d' | 'all'; offset?: number; limit?: number }
export interface TaskRecordQuery { member?: string; q?: string; status?: TraceStatus; offset?: number; limit?: number; window?: string; anchor?: string; from?: string; to?: string; structure?: boolean }

/** A retained, scoped identity, never an ID inferred from a title or timestamp. */
export interface TaskNativeRef { namespace: string; kind: 'turn' | 'request' | 'response' | 'tool_call'; value: string; scope: string }
export interface TaskRecordStructure {
  recordId: string;
  round: TaskNativeRef | null;
  attempt: TaskNativeRef | null;
  tool: TaskNativeRef | null;
  pairing: 'exact' | 'unavailable' | 'ambiguous' | 'incomplete';
  /** Exact same-ID retained observations, including off-page links; max12. */
  relatedRecordIds: string[];
}
export interface TaskRoundSeed { memberId: string; recordId: string; sequence: number; title: string; startedAt: string }
export interface TaskStructure { records: TaskRecordStructure[]; leading: TaskRoundSeed[]; warnings: string[] }
/** Histogram counts retained event STARTS, not executions or time shares. */
export interface TaskTimeBin { index: number; input: number; model: number; tool: number; other: number; errors: number }
export interface TaskTimeline {
  taskId: string;
  member: string;
  window: string;
  from: string | null;
  to: string | null;
  bins: number;
  total: number;
  untimed: number;
  lanes: Array<{ memberId: string; name: string; total: number; bins: TaskTimeBin[] }>;
  coverage: { loadedMembers: number; totalMembers: number };
}
```

## Additive agent boundary evaluation DTOs (2026-10-29)

The canonical types in src/core/agent-folding-types.ts implement
[agent-folding.md](agent-folding.md) AF-001..005. FoldingProject separates agent
inventory/boundaries, independent multi-turn cases, trial assertions, ordered
traffic, experiment+variant+case+zero-based-repetition identity, real/source/
synthetic/import provenance and source evidence. Per-boundary proposal and
experimental disposition differ; human adoption notes never rewrite grades.
Optional retained toolDefinitions preserve actual schemas; unknowns stay null.
Explicit chainChecks/variant chainMappings retain terminal fact and logical
replacement evidence; optional third ablation variant changes skill loading
alone. Portable external plans may contain their own user-reported project,
never silently replace it with a support-desk graph. No native TraceEvent or
stored SQLite schema is changed by these additive DTOs.
