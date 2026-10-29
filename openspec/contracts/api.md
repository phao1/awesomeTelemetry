# Contract: HTTP API

## Official local Claude hook observations

The explicit `/api/hooks/claude/status`, `/configure`, `/events` and
`/events/:id` routes follow [claude-hooks.md](claude-hooks.md) CH-001..006.
All retain local Host/Origin/connection protection and no-store; ingress also
requires enabled state and the issued Bearer secret. §0.4 adds HOOK_DISABLED(409),
HOOK_AUTH_REQUIRED(401), HOOK_CONFLICT(409), HOOK_BUSY(409), HOOK_LIMIT(413/503),
HOOK_UNAVAILABLE(503), HOOK_EVENT_NOT_FOUND(404). Success ingest is empty204,
never a tool decision or context injection. Native observations stay separate.

## Local capture original bundle

The explicit GET `/api/proxy/requests/:id/bundle/manifest` and
`/api/proxy/requests/:id/bundle` routes follow
[capture-bundle.md](capture-bundle.md) CB-001..005 exactly. They retain local
guards, unified ApiError and no-store. §0.4 adds CAPTURE_BUNDLE_CHANGED(409),
CAPTURE_BUNDLE_BUSY(503), CAPTURE_BUNDLE_UNAVAILABLE(503); existing
CAPTURE_ORIGINALS_DELETED/CAPTURE_EXPORT_LIMIT/PROXY_REQUEST_NOT_FOUND apply.

## Codex per-call local inspection

GET /api/proxy/live returns {items:Array<{requestId:string,hostname:string,
startedAt:string,ended:false}>} for at most64 currently registered WS sources;
metadata only,<=64KiB,no-store and same local Host/Origin guard. Used once on
Proxy mount/explicit refresh to rediscover still-active connections after reload,
not polling or a replay of missing body fragments.

GET /api/proxy/requests/:id/codex-calls?offset=0&limit=20 returns CodexCallPage.
GET /api/proxy/requests/:id/codex-calls/:sequence returns CodexCallDetail.
GET /api/proxy/live/:requestId/codex-calls uses the same page query/response;
GET /api/proxy/live/:requestId/codex-calls/:sequence uses the same detail.
Live lookup falls back to the exact persisted request_id after settlement.
No arbitrary file paths, uploads, upstream requests or state mutations.
All routes retain local-origin/Host protection and Cache-Control:no-store.
Unsigned decimal safe integers only; offset<=4096,limit1..20,sequence0..4095.
Unknown source/call 404 PROXY_REQUEST_NOT_FOUND; invalid input400 BAD_REQUEST;
non-WS/missing/invalid originals422 CODEX_SOURCE_UNAVAILABLE; busy503
CODEX_INSPECTION_BUSY; bound/deadline503 CODEX_INSPECTION_LIMIT;
read/integrity/worker failure503 CODEX_INSPECTION_FAILED. All use ApiError.
Confirmed original-deletion intent409 CAPTURE_ORIGINALS_DELETED, checked
before/after every async boundary and immediately before serialization.

An active source snapshot binds only successfully written prefix bytes+digest,
not queued bytes or future messages. Partial trailing records are explicit.
Final/source replacement while inspecting yields409 CODEX_SOURCE_CHANGED;
caller refreshes explicitly or on a selected source dirty hint. No implicit polling/per-frame requests or persisted
per-message DB rows. Detail re-verifies original bytes and resolves native
metadata in bounded batch queries, never raw event bodies.

## TraceLog import (schema19)

All `/api/trace-imports` routes require existing local connection/Host/Origin
guard. No filesystem paths in responses; untrusted source content is inert.
- POST `/api/trace-imports`: raw application/octet-stream upload; required
  `x-trace-filename` URI-encoded basename ending .json/.gz/.tgz/.tar.gz,<=512
  chars. No multipart.120s total deadline,128MiB max incl. chunked uploads.
  Requires stopped monitor and one job/DB. Returns200 TraceLogImportResult only
  after complete copies+atomic metadata commit. No model/tool/network replay.
- GET `/api/trace-imports?offset=0&limit=20`: TraceLogPage<TraceLogSession>;
  offset0..1024,limit1..20; imported_at DESC,id, no source/body file reads.
- GET `/api/trace-imports/:id/turns?offset=0&limit=20`:
  TraceLogPage<TraceLogTurn>,offset0..2000,limit1..20; sequence ASC. No raw data.
- GET `/api/trace-imports/:id/turns/:sequence`: TraceLogTurnDetail, one <=2MiB
  original turn + <=64KiB session object, range reads. No auto links or metrics.
- GET `/api/trace-imports/:id/source`: streamed exact JSON download, fixed safe
  generated filename, SHA256 ETag/X-Trace-Sha256 and content-length; not archive.

id=64 lowercase hex; sequence=0..1999. Non-2xx ApiError §0.3 always. §0.4 adds
TRACE_IMPORT_INVALID(400),TRACE_IMPORT_LIMIT(413),TRACE_IMPORT_BUSY(409),
TRACE_IMPORT_NOT_FOUND(404),TRACE_IMPORT_FAILED(503). PROXY_MAINTENANCE(409)
also rejects live-monitor import. All error messages static, never input snippets
or local paths. Cancel/disconnect/deadline stops owned work before commit where
possible; after commit cancellation is uncertain, refresh list. No auto resubmit.
Full source download may end incomplete on later disk failure; do not fabricate
an HTTP success JSON body or silently retry. No SSE additions or polling.

## Explicit same-capture offline reparse (schema18)

GET `/api/proxy/requests/:id/reparse` returns CaptureReparseStatus with no
original IO,automatic reparse,version rewrite or upstream request. No query
parameters. POST same path accepts only `{expectedRequestId:string}` (1–1024
chars,body<=8KiB),returns CaptureReparseResponse. Both no-store,existing loopback
Host/Origin guard and unified ApiError apply. GET<=16KiB,POST<=1MiB UTF8.

POST reads/validates both complete original files (<=2MiB encoded/decoded each)
using existing reader/parser,never substitutes legacy previews; updates one
versioned numeric/status summary,not original capture/transport/processing/
identity/association/scan metrics. No new saved-capture event or charge. Fresh
identity/ref/deletion rechecks follow all async IO and precede the synchronous
capacity-admitted transaction/send. Same id repeated stays one row. Unknown/
failed/incomplete protocol is not infrastructure failure. Current status only
compares metadata/version,last parsedAt; it is not a fresh file integrity check.

One active operation per DB,no queue; server shutdown owns accepted work. Web
10s cancellation stops waiting,not guaranteed rollback; explicitly refresh
status after uncertain result. No poll/automatic restart/reparse on stale version.

Errors:400BAD_REQUEST invalid id/query/body,404PROXY_REQUEST_NOT_FOUND;
409CAPTURE_ORIGINALS_DELETED for confirmed intent;
409CAPTURE_REPARSE_CONFLICT for changed request identity/fingerprint;
422CAPTURE_REPARSE_UNSUPPORTED with static details.reason for missing/incomplete/
invalid refs or existing AnalysisSourceReason source/decode/integrity/size failure;
503CAPTURE_REPARSE_BUSY for overlapping/closing operation;
503CAPTURE_REPARSE_FAILED for other read/parse/commit failure;503CAPTURE_REPARSE_LIMIT
for invalid/oversized metadata/response. No filesystem/vendor/body error text.

## Original capture access (fuse-agent-monitoring)

GET `/api/proxy/capabilities` returns MonitorCapabilityReport, no-store, max64KiB,
no query parameters (any query400 BAD_REQUEST), same local Host/Origin guard.
No process/version/config/CA/body probe, file/DB read or write, upstream request,
listener start or recovery. Static implementation levels have explicit tested
platforms; generatedAt is current ISO UTC, installed versions remain unknown.
The Web matrix loads once only after explicit expansion,5s owned timeout and
manual retry/refresh, no polling/per-row reads/locale refetch. Its configure
action selects a new blank process-recipe form only, without creating a profile
or modifying saved/dirty profiles, starting a listener or launching an Agent.
Existing start/stop/diagnostics remain the actual control path.

### Functional linked execution and local export

GET `/api/proxy/requests/:id/comparison?base=<id>` compares two explicit distinct
positive safe integer capture IDs, no automatic pairing. Exactly one base and
optional one `mode=metadata`; unknown/duplicate/malformed params or same IDs400
BAD_REQUEST; absent capture404 PROXY_REQUEST_NOT_FOUND. Returns
CaptureComparisonResponse, no-store, local Host/Origin guard. Full mode reads
bounded analysis once per side; analysis failure leaves explicit unavailable
summary and usable metadata. Metadata mode reads no body/analysis. After awaits,
fresh synchronous snapshot of both original-deletion intents strips affected
analysis, then serialization/send with no await. First32 error codes only,
explicit projected count/truncation. No headers/raw/prompt/tool schema/large
analysis content. Whole UTF8 response<=1MiB, excess503 CAPTURE_COMPARISON_LIMIT
static unified envelope. No DB mutation/replay/new association or billing sum.
Client loads only on explicit compare, one pair GET/10s abort, no polling/cache
or per-row reads; changing pair/mode/invalidation aborts and hides prior result.
Context Diff for that pair is a separate explicit existing local read, not an
automatically duplicated normalizer or an experiment.

GET `/api/sessions/:key/parents` returns NativeSessionParentPage for an existing
scan session (unknown404 SESSION_NOT_FOUND), metadata only with no source IO.
Query limit default20/max50, positive safe integer; cursor absent or lower-case
64hex retained identity ID, exclusive ascending. Unknown/duplicate/malformed
params400 BAD_REQUEST. Local Host/Origin guard applies. Scope/namespace/value
and complete unique owner evidence determine resolved references; truncated,
self, incomplete or multiowner claims never invent topology. At most20 matched
owners/reference; whole JSON<=512KiB. Byte pressure shrinks source-reference
page and advances by actual returned last identity, without altering fields or
skipping refs; unprojectable single record503 EXECUTION_METADATA_LIMIT. No new
table/index, recursive/global parent lookup, source reparse or relation mutation.
Web entry only after explicit expansion,5s abort, explicit paging/refresh,
invalidation hides stale conclusions rather than auto-refetching or N+1.

GET `/api/sessions/:key/execution` returns LinkedExecutionPage for an existing
scan session; unknown404 SESSION_NOT_FOUND. Queries: eventOffset default0,
eventLimit default100/max200; captureCursor absent or positive numeric proxy ID,
captureLimit default20/max50. All integers are safe/nonnegative (limits positive),
malformed/duplicate/unknown params return400 BAD_REQUEST. Native events use slim
columns only, ordered sequence; attempts use accepted direct/confirmed links,
proxy id descending. Identities/matches are bounded to1000 retained entries
and byte budgets from nfr.md; truncation sets identityCompleteness=false with
reasons and cannot authorize an ambiguous match. No body/source-file IO, scan,
new association mutation or billing aggregation. Local Host/Origin guard applies.
Byte-budget reduced pages advance by the actual returned event count/last proxy
cursor, not the requested limit; no skipped records. A single unprojectable
metadata record returns503 EXECUTION_METADATA_LIMIT rather than an endless empty
page or silently modified URL/title/identity.
The frontend pages this metadata only, virtualizes events, and explicitly opens
one native event or proxy on demand. Missing/candidate identities are not facts.
The execution snapshot also returns sessionDurationSource, the retained session
declaration only (unknown fallback, not per-event measured provenance), and each
attempt's existing transport metadata or null. One cached bulk transport query;
the scalar declaration and event count share the scan-owner query (at most8
SELECTs/page), no body/header/raw query, source IO or per-attempt read.
Network/native clocks are never subtracted
or promoted to a same-call/speedup/billing conclusion. Whole1MiB limit unchanged.

GET `/api/proxy/requests/:id/export` returns CaptureEvidenceExport as
application/json, attachment `capture-<numeric-id>.json`, Cache-Control:no-store.
Explicit local download; same Host/Origin checks,400 BAD_REQUEST for invalid id,
404 PROXY_REQUEST_NOT_FOUND for absent capture. Only this action performs bounded
original-backed analysis, no model/tool/network replay. First100 identities and
first100 trace links are included with their paging metadata; no per-row fetch.
After async analysis, acquire fresh synchronous request/capture/deletion/
identity/link metadata and serialize/send without another await; confirmed
deletion always removes analysis regardless of cleanup outcome. Retained headers
and metadata may still export after deletion. A failed analysis yields metadata
with analysisUnavailableReason=analysis_unavailable, not success. Maximum JSON
UTF8 size4MiB; excess503 CAPTURE_EXPORT_LIMIT, static ApiError without silently
clipping headers. No raw body/prompt previews, server paths, journal or CA keys.
Optional query `mode=metadata` skips all analysis/body reads and returns
analysis=null/reason=metadata_only (original_deleted still takes precedence).
Unknown/duplicate params or mode values return400 BAD_REQUEST. The UI uses this
mode whenever body availability is blocked/unknown and invalidates an older
full-export operation immediately on that transition, preventing pre-intent
submission races from downloading prior body projections. Metadata-only packages
must not be accepted if a response unexpectedly contains nonnull analysis.
The Web action sends one explicit request, aborts after10s, rejects late/deleted/
unmounted results and does not automatically retry or upload anything. An older
download cannot be retroactively erased by deleting current evidence.

Capture transport detail optionally includes CaptureNetworkTiming. It is not
part of metadata lists/SSE. Header/first-byte/first-content/end offsets use one
monotonic request clock; missing legacy timing remains unknown. SSE content is
dispatch arrival, JSON content is document completion (explicit basis), encoded
streams currently expose unsupported_encoding rather than guessed first-content.
Observed raw Server-Timing is shown separately without unit/model-time claims.

### Capture metadata capacity diagnostic

GET `/api/proxy/capacity` returns CaptureMetadataCapacity without original IO,
recovery, checkpoint, DB write or upstream traffic. It remains available when
capture recovery is pressure-blocked. Same loopback Host/Origin policy applies.
Sizes are physical DB/WAL file lengths (in-memory fixtures use logical pages),
not free disk space. Unreadable sizes return200 state=unavailable/reason=stat_error
with null sizes, never invented zero/success. No paths or native SQLite errors.
Limits are200,000,000 combined/20,000,000 WAL bytes; capture admission stops at
180,000,000/8,000,000 bytes. limited explains database_limit or wal_limit, not
automatic evidence deletion. checkedAt is ISO8601 UTC. This is an explicit
diagnostic, no polling or per-request-list-row use. It does not certify other
scan/external writers or physical ENOSPC behavior.

The capacity Web drawer makes exactly one GET here plus one GET /api/proxy/storage
only on open/explicit refresh.5s abort; independent partial failures, no polling,
per-row calls or mutation. The original-store query can initialize owned files
and resume already-confirmed pending deletion, unlike this metadata-only route;
UI must disclose that distinction. Runtime changes mark snapshots stale locally,
never refetch; late/unmounted responses cannot restore old snapshots. Display
original quota remaining separately from database admission headroom, neither as
physical free disk space or a guarantee of successful capture.

Pressure may defer unindexed journals at startup; already committed request
metadata/body reads and confirmed body cleanup remain available. Cleanup/storage
reads initialize only the owned file store and pending deletion intents, not
unrelated journal insertion. Start/restart retries deferred recovery after
pressure relief. Other recovery corruption/conflicts still fail capture access.
Runtime lastError uses bounded static CAPTURE_METADATA_LIMIT/UNAVAILABLE/
QUEUE_FULL or CAPTURE_METADATA_SQLITE_FULL; no raw SQLite/filesystem messages.

### Confirmed per-request original-body deletion

GET `/api/proxy/requests/:id/original-deletion` returns OriginalDeletionJob or
JSON null (no intent), without file IO. POST the same route with exactly
`{expectedRequestId:string,confirm:true}` (max8KiB JSON, request ID1..1024 chars)
confirms deletion of that request/response BODY, prompt and SQLite body/raw/prompt
copies. Retain headers, metrics, identity/association metadata, scan/native
sessions and external exports. This is not full request/header/forensic erasure.
No global Clear route is added. Unknown request404, malformed/missing confirmation
400 BAD_REQUEST. All existing loopback Host/Origin controls apply.

POST requires fully stopped monitor/no pending cleanup, serializes starts and
other deletion attempts, and awaits async file/state work; health/scan routes
remain responsive. Returns200 OriginalDeletionJob, including explicit failed
state/error (not success). Repeat the same confirmed POST explicitly retries a
failed/pending job; completed is idempotent. During maintenance start/launch or
another deletion returns409 PROXY_MAINTENANCE; running/starting/stopping also
reject deletion with that code before intent. Identity/shared-ref/unsupported/
directory conflicts409 CAPTURE_DELETE_CONFLICT with bounded static reason;
retained-job capacity503 CAPTURE_DELETE_LIMIT; DB/intent/status write failures
503 CAPTURE_DELETE_FAILED without raw SQL/filesystem messages. GET status enables
recovery after the client disconnects. Default retention never invokes deletion.

Intent, exact tombstone and clearing request_body/response_body/raw_request_body/
raw_response_body/system_prompt (system_prompt_len=0) are one transaction.
Once intent exists, body download404 PROXY_REQUEST_NOT_FOUND and protocol analysis
409 CAPTURE_ORIGINALS_DELETED even if cleanup failed/files reappear. Context diff
rejects either deleted source with422 CONTEXT_DIFF_UNSUPPORTED,
details.reason='original_deleted'; no legacy-preview fallback. Fresh request
detail returns null body/prompt fields. Previously delivered browser/export/native
copies are outside API deletion scope. Original refs keep their observed capture
status/size/digest; consult the deletion status for current availability.

On startup, pending jobs resume before journal recovery/capture file admission;
failed jobs remain explicit for retry. Startup/active HTTP cleanup is owned until
shutdown finishes. Already confirmed intent authorizes this bounded continuation,
not deleting unrelated files.

The selected-request Web drawer reads this metadata status once on selection;
refresh is explicit, not polling or per-row list requests. Show exact request
identity, retained scope and an acknowledgement before the confirmed POST.
Disable submission unless monitoring is known stopped and originals are supported.
A200 failed job is not success. Abort status reads after5s and action waits after
15s; timeout/disconnect means unconfirmed, not freed space. On submission or any
known intent, clear local body/prompt/analysis/diff caches, invalidate in-flight
callbacks and hide downloads. Reopening stale detail in the same view must not
revive those copies. Headers/timing/association/native views remain available.
Failure/retry requires explicit confirmation; status refresh alone never deletes.

### Identity/correlation routes

Association invalidation uses trace_links_changed with sessionKeys/proxyIds/truncated, coalesced200ms and capped200 keys per array. It is metadata-only, not a native session-content change; it must not trigger native detail/scanner reloads. Until incremental association patches/recovery are implemented, open relation panels show an explicit stale signal with an on-demand refresh action, not a polling loop.

Open context-comparison panels must also invalidate cached association conclusions on this signal, hide stale automatic results and offer explicit refresh. In-flight results from before invalidation cannot restore a revoked conclusion. No automatic original-body analysis/refetch is triggered by a relation notification.

All routes below require the same local Host/Origin policy as capture controls, including session-scoped routes and user decisions. Unknown scan session404 SESSION_NOT_FOUND, unknown proxy404 PROXY_REQUEST_NOT_FOUND; invalid owner/cursor/limit/state/note400 BAD_REQUEST, all unified ApiError. Only existing data_source=scan sessions are eligible. No body/raw/summary fields occur in identity/association pages.

| Method | Route | Shape |
|---|---|---|
| GET | /api/sessions/:key/identities | TraceIdentityPage |
| GET | /api/proxy/requests/:id/identities | TraceIdentityPage |
| GET | /api/sessions/:key/capture-links | SessionCaptureLinkPage, active direct/confirmed/candidate links only |
| GET | /api/proxy/requests/:id/trace-links | ProxyTraceLinkPage, including rejected/revoked decisions |
| PUT | /api/proxy/requests/:id/trace-links/:key | body {state:'confirmed'|'rejected'|'revoked',note:string|null}; returns TraceAssociation |
| GET | /api/proxy/requests/:id/trace-links/:key/decisions | {items:TraceAssociationDecision[],nextCursor:number|null,hasMore:boolean} |

Pages default limit50/max100. Identity cursor is the last opaque identity id (lexicographic ascending). Session capture-link cursor is the last proxy numeric id (descending). Proxy trace-link cursor is the last session key (ascending). Decision cursor is the last sequence (ascending). Omitted cursor starts a page; nextCursor is null when hasMore=false. Invalid/unknown cursor values never widen the query. Paged reads do not trigger scanning, file reads, remote calls, automatic reparsing or state mutation. Missing manifests return parserVersion=null,empty items and complete=false/reasons=['not_collected'] rather than fabricated identities.

PUT is explicit user confirmation/rejection/revocation, not automatic correlation. A nullable note up to1000 characters records user context. Each transition is atomic and append-only audited; retries with the identical state/note are idempotent. Automatic links may be downgraded if late identity evidence is ambiguous; user-confirmed/rejected/revoked links remain under user control. Session-level membership is not proof of a specific model/tool execution, and no derived duration or duplicate billing is added.

Protocol analysis reads at most 2MiB encoded and 2MiB decoded per direction, supporting identity/gzip/br/deflate via asynchronous built-in zlib. Originals remain encoded/unchanged for download. Incomplete prefixes may be projected with completeness=false and explicit capture status; historical previews are marked legacy_preview. Integrity/read/decode/size failures do not silently fall back to previews. Invalid/unknown id uses BAD_REQUEST/PROXY_REQUEST_NOT_FOUND as above. Projection failures are described in completeness.reasons; missing data is never reported as zero or a successful terminal protocol.

Context diff prefers complete original request files when present and reads at most 2MiB per source asynchronously. It verifies byte count/digest before normalization; missing, incomplete, changed, invalid UTF-8 or over-limit originals return CONTEXT_DIFF_UNSUPPORTED with a stable reason, never a silently substituted preview. Historical rows without file refs retain legacy preview behavior. Original files/downloads are unchanged. Parameter projections preserve metadata values (including credential-like keys); ordinary comparison bounds still apply. Reasons include capture_incomplete, source_unavailable, source_integrity_failed and invalid_utf8, in addition to existing normalization reasons.

| Method | Route | Result |
|---|---|---|
| GET | `/api/proxy/storage` | CaptureStorageStatus for the local original-body store |
| GET | `/api/proxy/requests/:id/capture` | ProxyCaptureBodies; absent historical refs are null |
| GET | `/api/proxy/requests/:id/analysis` | On-demand ProxyProtocolAnalysis from original request/response files; no remote requests |
| GET | `/api/proxy/requests/:id/body/:direction` | Original bytes as application/octet-stream, attachment; direction=request or response |

Invalid id/direction returns400 BAD_REQUEST. Unknown request or unavailable body returns404 PROXY_REQUEST_NOT_FOUND using ApiError. Body download is streamed, supports incomplete captured prefixes, and includes `x-capture-status` plus `x-capture-sha256`; this explicitly identifies incomplete evidence. No content transformation/redaction or analysis-size limit applies. Ordinary list/detail requests do not fetch full files. Runtime options captureDirectory and captureStorage configure the local store; a user-facing configuration flow is a later task, not implicit global state.

Original downloads also support a single byte `Range: bytes=start-end`,
`bytes=start-` or `bytes=-suffixLength`, with inclusive offsets into the stored
encoded prefix, not decoded text. Successful downloads advertise
`accept-ranges: bytes` and a strong `etag` equal to the quoted full-prefix
SHA-256. No Range returns200; a satisfiable Range returns206, exact
`content-range: bytes start-end/total` and the segment content-length. Clamp an
end past EOF; suffixes longer than the prefix select that entire prefix.
`x-capture-sha256` always describes the entire retained prefix, not the segment;
partial HTTP delivery does not change `x-capture-status` or imply complete capture.
An exact strong If-Range match permits206; weak/nonmatching/date If-Range falls
back to200/full bytes (no last-modified/date validator is supported). Malformed,
over256-character, multiple or non-byte ranges return400 BAD_REQUEST. Valid
nonoverlapping/zero-suffix ranges, including any range on an empty prefix,
return416 RANGE_NOT_SATISFIABLE with ApiError and `content-range: bytes */total`.
Host/Origin and confirmed deletion checks apply equally to full and segmented
downloads. No multipart implementation, transformed representation, extra
file copy, body-bearing list or unbounded allocation is introduced.

Capture routes (`/api/proxy/*`, `/api/ca-cert`) require a loopback connection and a loopback Host; an Origin header, when present, must also name a loopback host. Untrusted Host/Origin returns400 BAD_REQUEST in the unified envelope. Same-machine development UI on another loopback port is allowed. The certificate endpoint returns only the actual proxy CA public certificate, never private keys.

> Original-capture amendment (2026-10-15): monitoring detail/download/export preserve original observed values without masking, including request/response headers and bodies. Lists and incremental change signals stay metadata-only. The full body download is independent of semantic analysis limits. Capture storage config/status uses CaptureStorageConfig/CaptureStorageStatus from data-model; default 10GB quota and 100MiB per direction. Concrete routes and errors must be specified here before HTTP integration. Original file reads remain local and on demand.


> **Authoritative source.** All endpoint paths, params, response shapes, and
> status codes must be adopted verbatim. Type references:
> `contracts/data-model.md`. Corresponding source files:
> `server/server.ts` (production) + `local-sessions/vite-plugin.ts` (dev)

## 0. General conventions

### 0.1 Basics

- Base path: `/api`
- Requests and responses are `application/json; charset=utf-8`
- Server: plain Node `http`, no Express/Fastify
- Default bind address `127.0.0.1` (**not localhost**, G3.1)

### 0.2 Response compression

When the response body is >= 1024 bytes and the request carries
`accept-encoding: gzip`, respond with gzip and set:

```
content-encoding: gzip
vary: accept-encoding
```

Responses under 1024 bytes are not compressed and must carry `content-length`.

### 0.3 Error envelope

**All** non-2xx responses use the unified shape, no exceptions:

```ts
interface ApiError {
  error: {
    /** Machine-readable, stable. Full set in §0.4. */
    code: string;
    /** Human-readable, English. i18n is the frontend's job. */
    message: string;
    /** Optional context, debug display only. */
    details?: Record<string, unknown>;
  };
}
```

Example:

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "No session with key codeagent-abf46f48171c01", "details": { "key": "codeagent-abf46f48171c01" } } }
```

### 0.4 Error code full set

| code | HTTP | Meaning |
|------|------|---------|
| `BAD_REQUEST` | 400 | missing or malformed params |
| `INVALID_ENUM` | 400 | enum value outside the allowed set |
| `SESSION_NOT_FOUND` | 404 | session key does not exist |
| `EVENT_NOT_FOUND` | 404 | event id not in this session |
| `PROMPT_CONTEXT_NOT_FOUND` | 404 | session exists but has no captured Prompt Context |
| `PROXY_REQUEST_NOT_FOUND` | 404 | proxy request id does not exist |
| `RANGE_NOT_SATISFIABLE` | 416 | byte range has no overlap with the retained original prefix |
| `ROUTE_NOT_FOUND` | 404 | path not registered |
| `PROVIDER_DISABLED` | 409 | provider disabled in config |
| `SESSION_PARSE_FAILED` | 500 | session source parse failed (corrupt / not this provider's format, G5.6) |
| `PROXY_ALREADY_RUNNING` | 409 | proxy already running |
| `PROXY_NOT_RUNNING` | 409 | proxy not running |
| `PROXY_STOP_FAILED` | 503 | cleanup did not finish; ownership retained, retry stop; never report idle |
| `PROXY_MAINTENANCE` | 409 | stop monitor/await maintenance before deleting or starting |
| `CAPTURE_ORIGINALS_DELETED` | 409 | confirmed body intent makes protocol source unavailable |
| `CAPTURE_DELETE_CONFLICT` | 409 | exact identity/ref/directory/shared-owner conflict; static reason only |
| `CAPTURE_DELETE_LIMIT` | 503 | retained deletion-job capacity reached, no new intent |
| `CAPTURE_DELETE_FAILED` | 503 | deletion/DB state could not finish; inspect typed job before retry |
| `CAPTURE_EXPORT_LIMIT` | 503 | local JSON evidence package exceeds its explicit size bound |
| `CAPTURE_COMPARISON_LIMIT` | 503 | selected capture comparison exceeds its bounded projection |
| `CAPTURE_REPARSE_CONFLICT` | 409 | exact capture identity or source fingerprint changed |
| `CAPTURE_REPARSE_UNSUPPORTED` | 422 | retained originals cannot be reparsed; static source reason only |
| `CAPTURE_REPARSE_BUSY` | 503 | one same-DB reparse or shutdown owns the operation |
| `CAPTURE_REPARSE_FAILED` | 503 | local reparse/read/commit failed; no upstream replay |
| `CAPTURE_REPARSE_LIMIT` | 503 | invalid or oversized bounded reparse projection |
| `EXECUTION_METADATA_LIMIT` | 503 | one execution metadata record cannot fit the bounded page |
| `SERVER_SHUTTING_DOWN` | 503 | server is draining; new work rejected |
| `SSE_LIMIT_REACHED` | 503 | process-wide live subscriber limit reached; retry later |
| `MONITOR_PROFILE_NOT_FOUND` | 404 | connection profile missing |
| `MONITOR_PROFILE_CONFLICT` | 409 | expectedRevision differs; reload before editing/launching |
| `MONITOR_PROFILE_BUSY` | 409 | profile writer lock is owned; retry, never delete another writer's lock |
| `MONITOR_PROFILE_INVALID` | 400/500 | invalid request settings / unreadable or corrupt stored profile document |
| `MONITOR_NOT_READY` | 503 | listener/CA not ready; no Agent was started |
| `MONITOR_SELF_TEST_NOT_READY` | 409 | matching owned listener/run is not ready; no implicit start/switch |
| `MONITOR_SELF_TEST_BUSY` | 409 | one explicit local self-test is already active; no queue |
| `MONITOR_SELF_TEST_FAILED` | 503 | local self-test network/persistence/deadline failed; retained synthetic evidence is not rolled back |
| `CONTEXT_DIFF_UNAVAILABLE` | 409 | target is valid but no trustworthy automatic predecessor exists |
| `CONTEXT_DIFF_UNSUPPORTED` | 422 | target/base source cannot be normalized safely within phase-1 rules |
| `FRIDA_TARGET_NOT_FOUND` | 409 | no Trae process or ai_agent.dll not loaded |
| `TRAE_KEY_MISSING` | 412 | Trae SQLCipher key not extracted (G6.1) |
| `SCAN_IN_PROGRESS` | 429 | a scan is already running |
| `TEAM_RUN_NOT_FOUND` | 404 | team run id does not exist |
| `TEAM_ACTIVITY_NOT_FOUND` | 404 | activity id not in this team run |
| `TEAM_SOURCE_INCOMPLETE` | 409 | team source scan is incomplete; derived rows are partial |
| `TEAM_BODY_UNAVAILABLE` | 409 | body/raw requested but not available for this activity |
| `TEAM_COMPARE_INVALID` | 400 | compare input invalid (missing/equal run id or malformed manual basis) |
| `INTERNAL_ERROR` | 500 | unclassified exception; `details` never contains a stack |
| `DECRYPT_FAILED` | 500 | Python bridge decryption failed |

### 0.5 Pagination conventions

List endpoints use `limit` + `cursor` (keyset), **never offset** (offset misses
rows / duplicates when data changes):

- `limit`: default 50, max 500
- `cursor`: the last item's `startedAt` from the previous page; omitted on the first page
- Response contains `{ items, nextCursor, hasMore }`; `nextCursor: null` means end

> Exception: in-session event pagination uses `offset` + `limit`, because
> `sequence` is continuous and immutable, offset semantics are stable, and the
> frontend virtual scroll needs random jumps.

### 0.6 Foreground request marking

**Every** `/api/*` request must call `markForegroundRequest()` on entry so
background prewarm yields (see `specs/session-scanning` REQ-012).

---

## 1. Sessions

### 1.1 `GET /api/sessions`

Session index list. **The response never contains the `systemPrompt` body or
any events.**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` | data source; scan/proxy shown separately (G7.4) |
| `provider` | `ProviderKey` | — | optional filter; comma-separated multi-select, `provider IN (...)` |
| `status` | `TraceStatus` | — | optional filter; comma-separated multi-select, `status IN (...)`; any invalid value returns `400 INVALID_ENUM` |
| `q` | string | — | title / session ID case-insensitive substring (SQL `LIKE` with `ESCAPE '\'`, `% _ \` treated literally) |
| `range` | `'today' \| '7d' \| '30d' \| 'all'` | — | `updated_at >= since` activity filter (`today` = local midnight); a long-running session updated today remains visible. Default no filter; frontend default is `today`; invalid value returns `400 INVALID_ENUM` |
| `limit` | number | 50 | max 500 |
| `cursor` | string | — | last item's `startedAt` of the previous page |
| `keys` | string | — | comma-separated key list for batched patches after SSE; max 200, more returns `BAD_REQUEST` |
| `merged` | `'1' \| '0'` | `'1'` | whether to apply session merging (see `specs/session-merge`) |
| `tags` | string | — | optional tag filter (add-trajectory-inspector D14); comma-separated multi-select with **OR** semantics matching the existing `provider` / `status` filters, max 32 values; more than 32 values or a value outside `ANNOTATION_TAG_PATTERN` (see `contracts/data-model.md` §3.2) returns `400 BAD_REQUEST` |

```ts
// 200
interface SessionListResponse {
  items: SessionIndexEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;          // total under the current filters, from COUNT(*)
}
```

> When `keys` is passed, `limit` / `cursor` / `total` are ignored; matching
> items are returned directly and `hasMore` is always `false`. The same
> applies to `q` / `range` / `provider` / `status` / `tags` — the `keys` path
> ignores all filters.

Each list item carries `tags: string[]` (empty when unannotated); the tag
array comes from one join evaluated once, never a per-row query, and no body
column is added to the projection (D14). Tag matching uses a JSON-array
containment predicate on the joined row; `EXPLAIN QUERY PLAN` must show no
temporary B-tree (see `contracts/database.md` §4). The candidate list for the
filter UI comes from `GET /api/annotations/tags` (§1.7), fetched once when the
filter opens.

**Budget**: 500 items < 60KB (gzipped), server < 5ms.

### 1.2 `GET /api/sessions/:key`

Session detail. **Defaults to `mode=slim`.**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `'slim' \| 'full'` | `'slim'` | `raw` is not supported here; use §1.3 |
| `offset` | number | 0 | event offset |
| `limit` | number | 2000 | max event count, cap 5000 |

Response: `SessionDetailResponse` (see `contracts/data-model.md` §5).

Behavior requirements:

1. LRU detail-cache hit returns directly
2. Miss and `sessions.detail_loaded = 0` → trigger one lazy `scanAndStoreDetail`
3. Session belongs to an async-decryption provider (Trae) and decryption is
   not done → return existing index data + `pending: true`, **non-blocking**;
   SSE `sessions_changed` notifies when decryption completes
4. Key does not exist → 404 `SESSION_NOT_FOUND`

**Budget**: worst session (9,590 events) slim tier < 1.5MB, server < 60ms.

### 1.3 `GET /api/sessions/:key/events/:eventId`

Single-event drill-down. Called when EventInspector clicks.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `include` | `'raw'` | — | when set, fills `raw` from the `event_raw` table |

```ts
// 200 → TraceEvent or TraceEventRaw
// 404 → EVENT_NOT_FOUND
```

**Budget**: < 20ms.

### 1.3a `GET /api/sessions/:key/prompt-context` (show-trae-prompt-context)

Returns the independently stored `SessionPromptContext` for an explicit UI
drill-down. It MUST NOT trigger Trae decryption or any child process.

```ts
// 200 → SessionPromptContext (contracts/data-model.md §3.1)
// 404 → SESSION_NOT_FOUND when the session key does not exist
// 404 → PROMPT_CONTEXT_NOT_FOUND when the session exists but has no context row
```

The session list and `GET /api/sessions/:key` MUST NOT contain
`dynamicSections`, `modelConfig`, or `analysis` from this endpoint.

**Budget**: < 20ms; gzip applies when the body is >= 1KB.

### 1.4 `GET /api/sessions/:key/report`

Generates a self-contained HTML report.

| Param | Type | Default |
|-------|------|---------|
| `format` | `'html'` | `'html'` |

Responds `text/html`. **Large JSON must be written to an external `.js` file
and referenced; inline `<script>var data=...</script>` is forbidden (G7.6).**

### 1.5 `DELETE /api/sessions/:key`

Cascade-deletes `events` + `event_raw` + `metrics` + `session_annotations`
(via its FK) + `sessions` + the matching `scan_state` row.

```ts
// 200 → { deleted: true, key: string }
```

### 1.6 `POST /api/sessions/:key/rescan`

Force-rescans a single session, bypassing the `scan_state` gate
(`force: true`).

```ts
// 200 → { key: string, eventCount: number, durationMs: number }
```

### 1.7 Session annotations (add-trajectory-inspector)

Per-session tags and free-text note, plus the tag vocabulary used by the
session-list filter (design D13 / D14). Shape and bounds are defined in
`contracts/data-model.md` §3.2. Routes follow the project convention
`/api/sessions/:key/*` (deviation C4) and are registered so the existing
`:key` routes are not shadowed.

#### `GET /api/sessions/:key/annotations`

```ts
// 200 → SessionAnnotations
{
  "sessionKey": "codex-abc123def45678",
  "tags": ["refactor", "perf"],
  "note": "string | null",
  "updatedAt": "2026-08-08T04:00:00.000Z | null"
}
// 404 → SESSION_NOT_FOUND
```

Behavior requirements:

1. Unannotated session → `200` with `tags: []`, `note: null`, `updatedAt:
   null` — **not `404`** — and reading creates no row.
2. Unknown session key → `404 SESSION_NOT_FOUND`.

**Budget**: < 20ms (primary-key lookup).

#### `PUT /api/sessions/:key/annotations`

```ts
// request → SessionAnnotationsUpdate; absent keys leave that field untouched
{ "tags": ["Refactor", "refactor", "  Résumé  "], "note": "string" | null }
// 200 → the full SessionAnnotations after normalisation
// 400 → BAD_REQUEST, 404 → SESSION_NOT_FOUND
```

Behavior requirements:

1. Bounds: `ANNOTATION_MAX_TAGS = 32`, `ANNOTATION_TAG_MAX_CHARS = 64`,
   `ANNOTATION_TAG_PATTERN` `/^[\p{L}\p{N}_-]{1,64}$/u`,
   `ANNOTATION_NOTE_MAX_CHARS = 8192` (`contracts/data-model.md` §3.2). A
   violated bound returns `400 BAD_REQUEST` via the unified `ApiError`
   envelope; silent truncation is prohibited and nothing is persisted.
2. Tags normalise: trim, lowercase, de-duplicate, sort ascending; stored as a
   JSON array.
3. Partial-update semantics: `tags: []` clears the tags, `note: null` clears
   the note, an absent key leaves that field untouched.
4. Unknown session key → `404 SESSION_NOT_FOUND`.
5. Malformed body → `400 BAD_REQUEST`.
6. `updatedAt` is refreshed on every successful write (ISO 8601 UTC).

#### `GET /api/annotations/tags`

Tag vocabulary with per-tag session counts, the candidate list for the
session-list tag filter (D14). Fetched once when the filter opens, never per
keystroke; a tag may also be typed directly.

```ts
// 200
{ "tags": [{ "tag": "refactor", "count": 3 }, { "tag": "perf", "count": 1 }] }
```

Ordering: count descending, ties by tag ascending. Computed as **one** query,
never one per session. **Budget**: < 20ms.

---

## 2. Aggregations

### 2.1 `GET /api/agent-overview`

**Replaces v4's frontend N+1.** Measured: v4's view produced 524 requests /
299.6MB / 4,732ms.

| Param | Type | Default |
|-------|------|---------|
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` |

```ts
// 200
interface AgentOverviewResponse {
  rows: AgentOverviewRow[];
  /** Cache invalidation key = MAX(sessions.updated_at). Frontend can use it
   * to decide whether to refresh. */
  stamp: string;
  cached: boolean;
}
```

**Implementation requirement**: three SQL queries (session-level aggregation +
event-level aggregation + phase-duration aggregation) merged server-side,
cached by `stamp`. The frontend **must not** fetch per-session details for
this view.

**Budget**: 1 request, < 80KB, < 400ms (cache hit < 20ms).

### 2.2 `GET /api/providers/status`

```ts
// 200
interface ProviderStatusResponse {
  providers: Array<{
    key: ProviderKey;
    enabled: boolean;
    sessionCount: number;
    lastScanAt: string | null;
    /** Trae-specific: whether the key is ready */
    ready: boolean;
    /** reason code when ready=false, e.g. TRAE_KEY_MISSING */
    blockedBy: string | null;
  }>;
}
```

### 2.3 `POST /api/compare`

```ts
// request
{ leftKey: string; rightKey: string }
// 200 → { left: SessionDetailResponse; right: SessionDetailResponse; speed: { left: SpeedMetrics; right: SpeedMetrics } }
```

`mode` is fixed to `slim`. The compare report HTML goes through
`GET /api/compare/report?left=&right=`.

### 2.4 `GET /api/mission`

Mission 指挥中心聚合：**一次请求返回全部 A/B/C 三区 widget**（G11.9 红线：
禁止前端逐会话拉取，frontend REQ-003）。响应形状见
`contracts/data-model.md` §5.1 `MissionResponse`。

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `range` | `'7d' \| '30d' \| 'all'` | `'7d'` | 时间窗（按 `sessions.started_at` 过滤） |
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` | G7.4：scan/proxy 分开展示，不混列 |
| `tz` | number | `0` | 本地时区偏移分钟数，用于 A4 活跃热力图 / A7 会话活跃曲线 / C3 任务日历的分桶（**分桶前在 SQL 里偏移**，分桶后无法再转换） |

```ts
// 200 → MissionResponse（见 contracts/data-model.md §5.1）
```

**实现要求**：

1. 每个 widget 必带非空 `criteria`（表名/字段/计算方式/覆盖范围，服务端下发）。
2. `available=false` 时 `data` 必须为 `null` 且 `unavailableReason` 非空
   （如 `'NO_PRICING_TABLE'` / `'DURATION_NOT_MEASURED'`）；**禁止用 0 冒充**。
3. stamp 缓存：`stamp = MAX(sessions.updated_at)`，复用
   `server/storage/overview.ts` 的 `cacheByDb` WeakMap 模式；stamp 未变直接
   返回缓存（`cached: true`）。
4. ⚠️ better-sqlite3 是同步 API：单 widget SQL 必须 < 30ms（tier B），
   A / B / C 三区之间 `await setTimeout(0)` 让出一整轮事件循环
   （design.md §7.3 R1）。
5. 入口由 `createServer` 的统一 handler 调 `markForegroundRequest()`（§0.6）。

**Budget**：冷启 < 500ms / 1 请求 / < 120KB (gzip)；缓存命中 < 20ms；
事件循环 p99 < 50ms（见 `contracts/nfr.md` §2）。

---

## 3. Realtime

### 3.1 `GET /api/events` (SSE)

Metadata events carry `id: <opaque epoch:sequence>` and the connected control
uses SseConnected. A reconnect's Last-Event-ID replays retained metadata in order
after connected(resume=replayed). The connected frame advertises the final
current cursor but sends its id only AFTER replay completes via an id-only
frame, so interrupted replay cannot acknowledge undelivered events. Initial
connections are fresh; unknown epoch/future/expired/overflow cursor yields
resume=reset with the current cursor. No persisted rows or model calls are
replayed. Default /api/events contains metadata only, never proxy_stream_chunk.

Optional query `requestId` (1..1024 non-control characters) explicitly selects
one ephemeral live preview: that connection receives only connected and matching
proxy_stream_chunk/proxy_stream_ended and proxy_sources_changed filtered to
that requestId. Source hints contain only requestIds, coalesce for1s (max64),
are not written-prefix/completion guarantees, and are excluded from replay and
the default metadata feed. Selection/reconnect/end recovers via one bounded
source inspection, not body history. It has no replay and does not change the
global metadata cursor. The browser closes it on deselection/unmount/its own
ordered end. An end hint on the separate metadata connection allows up to5s
for selected-connection tail frames, then closes with a gap warning; it must
not discard already-in-flight final chunks merely because metadata arrived
first. Late
subscription/reconnect may miss earlier text, which MUST be disclosed. Only
identity-encoded SSE is previewed; encoded streams remain inspectable through
retained originals and final analysis. Selected streaming receives the same
loopback Host/Origin guard as capture bodies. Reject malformed/multiple query
parameters or invalid/over128-character Last-Event-ID with400 BAD_REQUEST.

The id-less connected control inherits a browser's previous lastEventId; it
MUST bypass metadata event-id deduplication. On metadata reset, invalidate detail
caches, drop stale proxy live patches and
refresh only a bounded first metadata page/current visible metadata, never
fetch every session body. Pre-reset asynchronous index/patch/detail completions
cannot restore old state or caches. Show a reset notice. Normal replayed notifications use
the existing key-patch path; duplicate proxy IDs replace rather than append.
Unrecoverable live fragments are not represented as durable history.

`text/event-stream`. Sends a `connected` event immediately on connection.

Event types and payloads map exactly to `BusEvents` in
`contracts/data-model.md` §10.

```
event: connected
data: {"serverTime":"2026-08-03T02:38:49.000Z","schemaVersion":1}

event: sessions_changed
data: {"keys":["codeagent-1f07032d5edae5","trae-3fd3ab3a6128c5"],"count":2}

event: scan_completed
data: {"provider":"all","count":524}
```

**Mandatory requirements**:

1. `sessions_changed` is emitted by the server after coalescing on a **200ms
   window**. Per-session `session_updated` emission is **forbidden** (v4's
   approach, measured 508 requests / 151.2MB in 30s on the frontend).
2. `proxy_stream_chunk` is concatenated by the server on a **100ms window**;
   the frontend no longer renders chunk by chunk.
3. On client disconnect, cleanup must run and unsubscribe everything.
4. Send a comment-line heartbeat every 30s (`: ping\n\n`) to prevent
   proxy-layer timeouts.

**Frontend consumption rules**: on `sessions_changed`, do **only a local
patch** — invalidate the detail cache for the matching keys and fetch index
rows once via `GET /api/sessions?keys=...`. **Refetching the full index is
forbidden.**

---

## 4. Proxy

### Connection profiles (fuse-agent-monitoring)

On restart, capture list/detail requests await the shared asynchronous recovery
of same-DB journals. Scan/static routes stay available; recovery faults use503
ApiError INTERNAL_ERROR with static CAPTURE_RECOVERY_FAILED, retaining evidence.
Recovered requests use existing response types: unknown completion/duration and
usage remain null; transport interruption may report CAPTURE_PROCESS_LOST,
processing closed, originals interrupted/missing independently. No implicit
upstream replay or saved event before a successful final SQLite commit.
One metadata-only proxy_status after a successful recovery batch corrects any
earlier historical requestCount snapshot; do not emit per-record body events.
Explicitly expired metadata is not reintroduced by journal recovery; an empty
post-retention list is legitimate, not a capture success or freed-body-quota
claim. Its body URLs return404 after row deletion, but original files remain
on disk and charged to storage. No public response shape changes are needed.
Absent upstream responseStatus is null for new records, correcting the old
writer's synthetic0. Historical rows are not backfilled; clients already accept
the contract's nullable responseStatus.

Original body detail (`ProxyCaptureBodies`) may additionally contain
`processing: CaptureProcessingResult`, independent of original-file status.
Current MITM writes version1/status/error atomically with metadata; legacy
records omit it instead of claiming success. Queue/worker/timeout/output-limit
failures still permit original download and metadata persistence, are shown
as degraded capture activity, and never substitute partial parsed usage as
complete. This outcome is not included in metadata lists or chunk SSE.

ProxyCaptureBodies may separately include transport: CaptureTransportResult.
Its optional websocket identifies an AWSP1 connection capture (method WS).
Existing request/response body downloads return the exact binary container;
SHA/bytes describe that container. Existing selected detail text contains
bounded worker-rendered message transcripts. A connection may contain multiple
Responses turns: counters are messages, duration is connection lifetime, usage
and model-call timings remain unknown. No new endpoint or body-bearing list.
Open connections announce selected live preview; final persistence occurs on
close/Stop. Live text has direction/sequence labels,100ms coalescing and the
existing display bounds; pre-selection/reconnect gaps are not replayed.
HTTP-only analysis returns unknown/incomplete websocket_connection_not_model_call
without reading archive files; HTTP reparse reports originals_invalid. Retained
metadata export remains valid with this limitation and separate original files.
Its normally ended HTTP4xx/5xx, network error, observed timeout, client cancel
and explicit interruption remain distinct from processing and file outcomes.
statusCode is upstream-only; missing legacy transport is unknown. Client UI
must not label network completed as Agent/protocol success. On-demand analysis
retains independent protocol evidence and marks transport failures explicitly;
neither repeated inspection nor error handling retries/replays upstream calls.

Byte-worker results add optional contentDecoding (identity/gzip/br/deflate/
unsupported per direction) and decode_error status. Body text fields are
decoded bounded views when available; original links/digests/byte lengths
always refer to observed encoded bytes, never re-encoded preview text. Decode
failures are explicit findings, not empty-success bodies or rewritten files.

Current MITM processing outcomes additionally include previewDroppedBytes;
resource_limit/CAPTURE_PREVIEW_BUDGET_EXCEEDED marks semantic preview admission
failure without asserting original loss. Proxy diagnostics may include the
exact CaptureResourceStatus process-wide gauges/lifetime counters from the
data-model contract; reads do not reset them or start capture. The events
endpoint rejects excess subscribers with503 ApiError SSE_LIMIT_REACHED;
already accepted slow subscribers are disconnected without changing capture.

All routes below use the existing local-only proxy Host/Origin guard and unified ApiError. JSON request bodies are bounded at32KiB. There is no HTTP arbitrary-process launch endpoint.

| Endpoint | Method | Body/result |
|---|---|---|
| `/api/proxy/profiles` | GET | `{ items: MonitorConnectionProfile[] }`, max32/256KiB, no per-profile file or process probes |
| `/api/proxy/profiles` | POST | MonitorConnectionSettings →201 MonitorConnectionProfile |
| `/api/proxy/profiles/:id` | PUT | `{ settings: MonitorConnectionSettings, expectedRevision: number }` →200 profile |
| `/api/proxy/profiles/:id` | DELETE | `{ expectedRevision: number }` →200 `{ deleted: true }`; deletes only the app recipe, not original captures/config/Agent processes |
| `/api/proxy/profiles/:id/plan` | GET | MonitorConnectionPlan; no proxy/Agent start; public CA may be initialized using the existing CA path |
| `/api/proxy/profiles/:id/diagnostics` | GET | MonitorConnectionDiagnostics read-only timestamped snapshot, no CA generation/listener/Agent start or upstream test request; same local-only guard. CA faults are200 diagnostic findings, not a falsely successful connection. Missing/corrupt profiles still use404/500 ApiError. |
| `/api/proxy/profiles/:id/start` | POST | `{ expectedRevision: number }` →200 MonitorConnectionPlan after actual listener readiness; no Agent start. Existing same-port running proxy can be reused, other-port/closing proxy returns409 PROXY_ALREADY_RUNNING. |
| `/api/proxy/profiles/:id/self-test` | POST | Exactly `{ expectedRevision: number }`, no query parameters →200 MonitorCaptureSelfTest, no-store. Explicitly creates one retained synthetic capture through the matching already-running owned proxy and a temporary fixed loopback origin. Does not start/stop the proxy, call models/tools or test Agent/TLS trust. |

Self-test admits one active job/server, no queue. Invalid body/query400
BAD_REQUEST; revision404/409 uses existing profile errors; wrong/stopped/run-changed
listener409 MONITOR_SELF_TEST_NOT_READY; overlap409 MONITOR_SELF_TEST_BUSY;
network/persistence deadline or infrastructure fault503 MONITOR_SELF_TEST_FAILED;
shutdown503 SERVER_SHUTTING_DOWN. All use ApiError. Bounded completed evidence
checks can return200 with passed=false and per-stage booleans, never false green.
Abort/disconnect is not rollback: a synthetic capture may still finish saving.
No external URL/headers/credentials/process parameters are accepted. The result
is not included in read-only diagnostics and does not prove actual Agent traffic.

Plan command is shell-quoted for POSIX and PowerShell and calls `agent-observe launch --server <loopback-control-url> --profile <uuid> --revision <n> -- <user-args>`. Copied commands pin the reviewed revision; later edits require regeneration, never silently launch a changed executable/project. The CLI obtains/starts the same listener through these APIs, checks CA digest, uses process-local environment/trust and inherits terminal stdio. It does not automatically stop a shared listener when its child exits. Proxy stop can disrupt still-connected Agents and must say so. Returned profile is the revision explicitly selected for launch; no implicit native session or verified Agent identity is created. A readiness wait is bounded at10s and never claims success solely from starting-state acceptance.

`agent-observe diagnose --server <loopback-origin> --profile <uuid> --revision <n> [--json]` reads only the diagnostics endpoint through direct bounded loopback HTTP. It never starts the server/listener/Agent or opens a database. Revision mismatch is a conflict. Human output includes each issue's nextStep; JSON returns the same snapshot. Exit0 means report retrieved, not Agent readiness; exit2 means report contains an error finding; connection/validation failures exit nonzero with actionable control-server guidance. No polling or extra model traffic. CLI control fetch timeout12s; the explicit Web check aborts after5s with retry guidance and clears stale results. Runtime SSE changes invalidate a snapshot locally without another fetch.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/proxy/start` | POST | body `{ port?: number }`; running → 409 `PROXY_ALREADY_RUNNING` |
| `/api/proxy/stop` | POST | async drain; concurrent stops share cleanup; idle → 409 `PROXY_NOT_RUNNING`; failure → 503 `PROXY_STOP_FAILED` |
| `/api/proxy/status` | GET | `ProxyRuntimeStatus`; starting=true during async startup; diagnostics distinguish listening from observed traffic |
| `/api/proxy/requests` | GET | list, `ProxyRequestListItem[]`, **excludes all 4 body columns and the systemPrompt body** |
| `/api/proxy/requests/:id` | GET | full `ProxyRequest` incl. bodies |
| `/api/proxy/requests/:id/context-diff` | GET | bounded evidence-grade request-context diff (see §4.1) |
| `/api/ca-cert` | GET | `application/x-pem-file`, downloads the CA certificate |

`/api/proxy/requests` params: `limit` (default 50, max 500), `cursor`,
`hostname`, `captureMethod`.

The list pagination envelope is `{ items: ProxyRequestListItem[], nextCursor:
string | null, hasMore: boolean }`; the table above describes its item type,
not a top-level array. This clarifies the existing implementation/client shape.

Stop first rejects new proxy work and closes acceptors, allows existing requests up to 5 seconds to finish, then interrupts remaining streams and flushes accepted original bytes/index writes. A successful response guarantees no owned listener/socket or capture write remains. The control waits at most 10 seconds; a timeout/failure retains cleanup ownership, blocks a new start and reports failed/cleanupPending, not idle. Start during stopping returns PROXY_ALREADY_RUNNING. Startup cancellation waits for any late-created transport to close before a restart. Activity SSE is coalesced over 200ms; lifecycle transitions are immediate and contain no body data. Shutdown of the HTTP server closes its own SSE clients/watcher, drains scans and proxy before its close callback permits the caller to close SQLite. CLI SIGINT/SIGTERM uses this cleanup before checkpoint/DB close. No automatic trust/proxy setting mutation.

### 4.1 `GET /api/proxy/requests/:id/context-diff` (add-request-context-diff)

On-demand comparison of the original request context of the target
request `:id` with an eligible base request. Query:

```ts
interface RequestContextDiffQuery {
  base?: 'previous' | `${number}`; // omitted equals previous; numeric value MUST be a positive integer
}
```

Semantics:

- Omitted `base` is identical to `base=previous` (automatic pairing).
- Automatic pairing (fuse-agent-monitoring supersedes legacy design D4): the
  target must have exactly one active `direct` or `confirmed` association.
  Select the nearest earlier eligible captured request of the same format in
  that linked scan session. The base must also have exactly one such owner;
  candidate/rejected/revoked links never qualify. Compare observed UTC start
  instants, then numeric id as a deterministic tie-break, not insertion order
  alone. Label `linked_session`, give the session key in the reason and warn
  that membership/capture order does not prove the immediately previous native
  model call. Model changes remain comparable but produce a mismatch warning.
  Legacy `parsed_session_id`, capture group, host/model/time/length are never
  sufficient evidence. No unique owner/predecessor returns409 as below.
- `base=<positive integer>` selects an explicit manual base; base→target
  order is preserved, confidence is `manual`, and identity mismatches are
  returned as warnings, never silently coerced.
- The route reads exactly the target body and at most one base body, plus a
  fixed number of indexed association/metadata queries; no per-row body read,
  capture-group body scan or raw-column selection. Manual comparison also
  warns about absent/ambiguous/different linked-session membership; it never
  creates or confirms an association.

```ts
// 200 → RequestContextDiffResponse (contracts/data-model.md §7.1, verbatim
//       from design D10); uncompressed body < 1 MiB; gzip applies via §0.2.
```

Errors (all via the unified `ApiError` envelope, §0.3; `details` never
contains a source body, auth header, or stack):

| HTTP | Code | Trigger |
|---:|---|---|
| 400 | `BAD_REQUEST` | invalid target/base param or base equals target |
| 404 | `PROXY_REQUEST_NOT_FOUND` | target missing; manual base missing (`details.role='base'`, no body evidence) |
| 409 | `CONTEXT_DIFF_UNAVAILABLE` | no trustworthy automatic predecessor; `details.reason='pairing_unavailable'` |
| 422 | `CONTEXT_DIFF_UNSUPPORTED` | source cannot be normalized safely (missing/unknown/malformed/encrypted/oversized body, format disagreement) with a stable reason |
| 500 | `INTERNAL_ERROR` | unclassified failure; sanitized, no stack/body/partial diff |

**Budget**: service p95 < 100 ms, event-loop p99 < 50 ms, uncompressed
response < 1 MiB, two-row read (see `contracts/nfr.md` §2).

---

## 5. Frida

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/frida/start` | POST | body `{ pid?: number }`, exactly representable positive integer when present; auto-discover when omitted; failure → 409 `FRIDA_TARGET_NOT_FOUND` |
| `/api/frida/stop` | POST | |
| `/api/frida/status` | GET | `{ running: boolean, starting: boolean, pid: number \| null }` |
| `/api/frida/captures` | GET | paginated list; `jsonData` truncated to 500 chars |
| `/api/frida/captures/:id` | GET | full record |

All Frida methods retain the same local connection/Host/Origin protection as
monitoring controls. A valid local request alone does not authorize or prove
target installation, successful capture or platform support.

Saved-capture pagination, selected detail limits and error behavior follow
[frida-capture-flow.md](frida-capture-flow.md) FC-002. List previews are SQL
bounded to500characters; full JSON is selected only by an explicit detail
request and bounded to256KiB before acquisition. All methods use `no-store`.

---

## 6. Config

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config/providers` | GET | returns the merged `LocalSessionConfig` |
| `/api/config/providers` | PUT | writes the user config layer, **must be atomic** (tmp + rename, G2.3); returns the new merged config |
| `/api/session-groups` | GET | merge groups from `config/session-groups.json` (+ auto subagent groups); members are session keys usable with `GET /api/sessions?keys=` |
| `/api/desensitization/rules` | GET | current rule set (incl. enabled state) |
| `/api/desensitization/rules` | PUT | updates rules; also atomic write |
| `/api/scan` | POST | body `{ provider?: ProviderKey, force?: boolean }`; scan in progress → 429 `SCAN_IN_PROGRESS` |
| `/api/health` | GET | `{ ok: true, schemaVersion: 1, uptimeMs: number, dbSizeBytes: number, walSizeBytes: number }` |

---

## 7. Team runs (add-agent-team-observability)

All team responses are gzip-aware (§0.2), use `ApiError` (§0.3) for non-2xx,
and call `markForegroundRequest()` on entry (§0.6). List/ledger use keyset
pagination (§0.5) with an opaque `cursor`; snapshots and compare are single
bounded reads. **No route reads a large source file, spawns a process, or
computes a full run on the request path** (design D13). Every route rejects a
violated bound with `400 BAD_REQUEST` — silent truncation is prohibited.

### 7.1 `GET /api/team-runs`

Keyset-paginated slim run list. **Never contains task/message/tool/reasoning/
artifact body, goal full text, or a source file path** (design D18).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `ProviderKey` | — | comma-separated multi-select, `provider IN (...)` |
| `status` | `TeamRunStatus` | — | comma-separated multi-select; invalid value → `400 INVALID_ENUM` |
| `topology` | `TeamTopologyKind` | — | comma-separated multi-select; invalid value → `400 INVALID_ENUM` |
| `q` | string | — | title / native run id case-insensitive substring (`LIKE` with `ESCAPE '\'`) |
| `range` | `'today' \| '7d' \| '30d' \| 'all'` | — | `started_at >= since` activity filter; invalid value → `400 INVALID_ENUM` |
| `completeness` | `CompletenessLevel` | — | comma-separated multi-select over any evidence dimension |
| `limit` | number | 50 | max 500 |
| `cursor` | string | — | opaque keyset cursor (encoded `started_at` + `id`); omitted on first page |

```ts
// 200
interface TeamRunListResponse {
  items: TeamRunSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;          // total under current filters, from COUNT(*)
}
```

Ordering: `started_at DESC, id ASC`. **Budget**: 500 runs < 10ms DB / < 80KB gzip.

### 7.2 `GET /api/team-runs/:runId`

One bounded `TeamRunSnapshot` (§data-model 12.3): summary, agents, agent edges,
tasks, dependencies, current assignments, artifacts metadata, completeness,
anomalies, metrics. **No activity, message, tool, raw, reasoning, or artifact
body** (design D13). Uses a stamp cache; a cache hit returns `cached: true`.

```ts
// 200
interface TeamRunSnapshotResponse {
  snapshot: TeamRunSnapshot;
  stamp: string;
  cached: boolean;
}
// 404 → TEAM_RUN_NOT_FOUND
// 409 → TEAM_SOURCE_INCOMPLETE (run exists but derived rows are partial)
```

**Budget**: 100 agents + 1,000 tasks < 100ms / < 750KB gzip; 1 request.

### 7.3 `GET /api/team-runs/:runId/activities`

Keyset-paginated slim ledger. **Never contains tool arguments/results, message
text, raw, reasoning, or artifact content** (design D3).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | string | — | canonical agent id |
| `task` | string | — | canonical task id |
| `kind` | `TeamActivityKind` | — | comma-separated multi-select; invalid value → `400 INVALID_ENUM` |
| `status` | `TraceStatus` | — | comma-separated multi-select |
| `from` / `to` | ISO string | — | `started_at` window bounds |
| `limit` | number | 200 | max 500 |
| `cursor` | string | — | opaque keyset cursor (encoded `started_at` + `native_sequence` + `id`) |

```ts
// 200
interface TeamActivityListResponse {
  items: TeamActivitySlim[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  /** true when any returned row has orderConfidence === 'ambiguous'. */
  hasAmbiguousOrder: boolean;
}
// 404 → TEAM_RUN_NOT_FOUND
```

Ordering (§data-model D8): native sequence within a source, then `started_at`
across sources, then source priority, then canonical `id`; rows with
`orderConfidence = 'ambiguous'` render an uncertainty marker. **Budget**: 200
activities < 50ms / < 200KB gzip.

### 7.4 `GET /api/team-runs/:runId/activities/:activityId`

Single detail. `include=body` returns the desensitized body tier; `include=raw`
returns the raw reference. Both require an explicit query flag; the default
response is slim metadata only.

| Param | Type | Description |
|-------|------|-------------|
| `include` | `'body' \| 'raw'` | explicit body tier control |

```ts
// 200
interface TeamActivityBody {
  input: string | null;
  output: string | null;
  message: string | null;
  result: string | null;
}

interface TeamActivityDetailResponse {
  activity: TeamActivitySlim;
  body: TeamActivityBody | null;   // present only when include=body
  raw: string | null;              // present only when include=raw
}
// 404 → TEAM_RUN_NOT_FOUND
// 404 → TEAM_ACTIVITY_NOT_FOUND
// 409 → TEAM_BODY_UNAVAILABLE (include requested but no body/raw row exists)
```

**Budget**: < 20ms, bounded by existing detail limits; cached in the bounded
detail cache.

### 7.5 `GET /api/team-runs/:runId/patch`

Bounded SSE-patch payload: returns slim entities changed since `stamp`, plus
deleted ids. When the change set exceeds the caps, `truncated` is set and the
client performs one snapshot refresh (design D14).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `stamp` | string | — | the run's previous stamp; required for an incremental patch |

```ts
// 200
interface TeamPatchResponse {
  runId: string;
  stamp: string;                    // new stamp for the next patch
  agents: TeamAgent[];
  tasks: TeamTask[];
  agentEdges: TeamAgentEdge[];
  taskDependencies: TeamTaskDependency[];
  assignments: TeamAssignment[];
  messages: TeamCommunication[];
  artifacts: TeamArtifact[];
  metrics: TeamMetrics | null;      // non-null when aggregates changed
  deletedAgentIds: string[];
  deletedTaskIds: string[];
  deletedMessageIds: string[];
  deletedActivityIds: string[];
  truncated: boolean;
}
// 404 → TEAM_RUN_NOT_FOUND
```

No activity ids are broadcast over SSE; the ledger invalidates pages
intersecting the changed run/time stamp. **Budget**: 1 request, bounded by the
SSE cap (contract default 200 ids per list).

### 7.6 `POST /api/team-compare`

Compares exactly two team runs. An `unmatched` / `unknown` result is a
**successful descriptive response**, not an error; only malformed or
bounded-invalid input is rejected (design D10 / D13).

```ts
// request
interface TeamCompareRequest {
  leftRunId: string;
  rightRunId: string;
  /** true = the user declares the runs comparable; detected differences are
   * still preserved and reported. */
  manualBasis?: boolean;
}
// 200 → TeamComparison (contracts/data-model.md §12.4)
// 400 → TEAM_COMPARE_INVALID (missing id, left === right, or malformed manualBasis)
// 400 → BAD_REQUEST (body not parseable)
// 404 → TEAM_RUN_NOT_FOUND (either run id does not exist)
```

**Budget**: < 300ms cold / < 20ms stamp-cache hit / 1 request / < 250KB gzip;
no per-agent/task/session loop (design D17, storage REQ-020).

### 7.7 `DELETE /api/team-runs/:runId`

Explicit local derived-team deletion only. Deletes team-owned graph, ledger,
detail, and metric rows via the FK cascade; **does not** delete linked sessions
or source files (design D11 / D18). The confirmation says linked sessions and
sources are untouched.

```ts
// 200 → { deleted: true, runId: string }
// 404 → TEAM_RUN_NOT_FOUND
```

---

## 8. Dev-only endpoints

The following are reserved for explicit development integration; production
`server.ts` does not expose them (G10.2). Requests to a production instance
return 404 `ROUTE_NOT_FOUND`:

| Endpoint | Description |
|----------|-------------|
| `/api/cdp/start` `/api/cdp/stop` `/api/cdp/status` | CDP capture control |
| `/api/cdp/targets` | list connectable Electron targets |

Development integration (2026-10-20): Vite's localSessionsPlugin owns these
paths before the existing backend proxy; it never creates a native scanner.
Production `server.ts` still exposes none of them. All CDP paths require local
connection/Host/Origin and Cache-Control:no-store, including reads; non-2xx
uses ApiError. Exact supported routes:

- POST `/api/cdp/start`, JSON object with optional numeric safe integer `port`
  (1..65535, default9222), returns CdpDevStatus. Empty body means {}. Unknown
  keys are400 BAD_REQUEST. No auto-start, process launch or port scanning.
  Repeated same-port start joins current discovery; different-port start while
  non-idle is409 CDP_BUSY. A running manager does not prove connection/traffic.
- POST `/api/cdp/stop`, empty body or {}, returns CdpDevStatus after owned
  cleanup. A stop may interrupt initial discovery. Retained diagnostics survive.
- GET `/api/cdp/status`, returns CdpDevStatus without target network IO.
- GET `/api/cdp/targets`, returns `{items:CdpDevTarget[]}`, max16 current
  owned targets, including connecting targets. No rediscovery on reads.
- GET `/api/cdp/captures`, returns CdpDevCapturePage, max64 summaries in
  acquisition order; no body field or per-item IO. This development-server
  memory is lost on shutdown; it is not an original archive or DB history.
- GET `/api/cdp/captures/:id`, positive decimal safe ID, returns exactly one
  CdpDevCaptureDetail. Missing ID404 CDP_CAPTURE_NOT_FOUND. No source request.

Request bodies<=1024 UTF8 bytes with5s total read deadline; invalid/oversize
body400 BAD_REQUEST. Cross-origin/nonlocal403 BAD_REQUEST; unsupported CDP
method/path404 ROUTE_NOT_FOUND. Closing development server503
SERVER_SHUTTING_DOWN. Internal control failure503 CDP_UNAVAILABLE with static
message, never upstream exception text. §0.4 adds CDP_BUSY(409),
CDP_UNAVAILABLE(503), CDP_CAPTURE_NOT_FOUND(404). Body/target acquisition
issues surface as the bounded static lastIssue diagnostic, not false success.
The plugin owns stop on dev-server close and does not run in build/preview.

> v4 known gap: CDP is dev-only. v5 keeps that but **must expose a
> `devOnly: string[]` field in the `/api/health` response** listing the
> dev-only routes the current instance does not provide, so the frontend never
> fails silently.

---

## 9. Contract tests

The following tests must exist in `server/server.test.ts` as executable API
contract acceptance:

```ts
describe('API contract', () => {
  it('session list does not leak the systemPrompt body', async () => {
    const r = await get('/api/sessions?limit=10');
    for (const item of r.items) {
      expect(item).not.toHaveProperty('systemPrompt');
      expect(typeof item.hasSystemPrompt).toBe('boolean');
    }
  });

  it('detail defaults to slim and contains no body', async () => {
    const r = await get(`/api/sessions/${key}`);
    expect(r.mode).toBe('slim');
    for (const e of r.events) {
      expect(e).not.toHaveProperty('inputSummary');
      expect(e).not.toHaveProperty('raw');
    }
  });

  it('proxy list excludes all body columns', async () => {
    const r = await get('/api/proxy/requests?limit=5');
    for (const item of r.items) {
      for (const col of ['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody']) {
        expect(item).not.toHaveProperty(col);
      }
    }
  });

  it('all errors use the unified envelope', async () => {
    const r = await getRaw('/api/sessions/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('agent-overview returns all providers in one request', async () => {
    const r = await get('/api/agent-overview');
    expect(Array.isArray(r.rows)).toBe(true);
    expect(typeof r.stamp).toBe('string');
  });

  it('production instance does not expose dev-only routes', async () => {
    const r = await getRaw('/api/cdp/status');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('mission returns all sections in one request with criteria on every widget', async () => {
    const r = await get('/api/mission?range=all');
    expect(r.meta.widgetCount).toBeGreaterThan(0);
    expect(typeof r.meta.stamp).toBe('string');
    const widgets = [
      ...Object.values(r.usage),
      ...Object.values(r.quality),
      ...Object.values(r.health),
    ] as Array<{ criteria: string; available: boolean; unavailableReason: string | null; data: unknown }>;
    for (const w of widgets) {
      expect(typeof w.criteria).toBe('string');
      expect(w.criteria.length).toBeGreaterThan(0);
      if (w.available === false) {
        expect(w.data).toBeNull();
        expect(w.unavailableReason).not.toBeNull();
      }
    }
  });

  it('mission validates range and tz params', async () => {
    const bad = await getRaw('/api/mission?range=99d');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ENUM');
  });

  it('team run list never leaks body or source paths', async () => {
    const r = await get('/api/team-runs?limit=10');
    for (const item of r.items) {
      expect(item).not.toHaveProperty('body');
      expect(item).not.toHaveProperty('sourcePath');
      expect(item).not.toHaveProperty('goal');
    }
    expect(typeof r.nextCursor === 'string' || r.nextCursor === null).toBe(true);
    expect(typeof r.hasMore).toBe('boolean');
  });

  it('team run snapshot contains no activity/message/body fields', async () => {
    const r = await get(`/api/team-runs/${runId}`);
    const s = r.snapshot;
    for (const a of s.agents) {
      expect(a).not.toHaveProperty('body');
    }
    for (const t of s.tasks) {
      expect(t).not.toHaveProperty('body');
    }
    expect(s).not.toHaveProperty('activities');
    expect(s).not.toHaveProperty('messages');
    expect(typeof r.stamp).toBe('string');
    expect(typeof r.cached).toBe('boolean');
  });

  it('team activity ledger returns slim rows with no body fields', async () => {
    const r = await get(`/api/team-runs/${runId}/activities?limit=200`);
    for (const item of r.items) {
      expect(item).not.toHaveProperty('input');
      expect(item).not.toHaveProperty('output');
      expect(item).not.toHaveProperty('raw');
      expect(item).not.toHaveProperty('toolArguments');
      expect(item).not.toHaveProperty('toolResult');
    }
    expect(typeof r.hasAmbiguousOrder).toBe('boolean');
  });

  it('team activity detail defaults to slim and gates body/raw behind include', async () => {
    const slim = await get(`/api/team-runs/${runId}/activities/${activityId}`);
    expect(slim.body).toBeUndefined();
    expect(slim.raw).toBeUndefined();
  });

  it('team compare never returns body text and reports unmatched as success', async () => {
    const r = await post('/api/team-compare', { leftRunId, rightRunId });
    expect(r.dimensions).toBeDefined();
    expect(r.metrics).toBeDefined();
    expect(r).not.toHaveProperty('bodies');
    // matched rows carry no body payload
    for (const row of r.metrics) {
      expect(row).not.toHaveProperty('body');
      expect(row).not.toHaveProperty('raw');
    }
  });

  it('team routes use the unified error envelope', async () => {
    const missing = await getRaw('/api/team-runs/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TEAM_RUN_NOT_FOUND');

    const missingActivity = await getRaw(`/api/team-runs/${runId}/activities/does-not-exist`);
    expect(missingActivity.status).toBe(404);
    expect(missingActivity.body.error.code).toBe('TEAM_ACTIVITY_NOT_FOUND');

    const badCompare = await post('/api/team-compare', { leftRunId: runId, rightRunId: runId });
    expect(badCompare.status).toBe(400);
    expect(badCompare.body.error.code).toBe('TEAM_COMPARE_INVALID');
  });
});
```

## Functional session family exploration

GET `/api/sessions/:key/family` returns NativeSessionFamilyPage. Query limit
(default20,max50,positive safe integer) and cursor (exclusive ascending child
session key,nonempty<=512 chars,no C0 controls) only; duplicate/unknown/invalid
queries400 BAD_REQUEST,missing scan session404 SESSION_NOT_FOUND,unprojectable
metadata503 EXECUTION_METADATA_LIMIT, all ApiError. Local Host/Origin guard and
no-store apply. One-hop indexed reverse-parent page with fixed-count batched
metadata reads,no body/source IO/reparse/mutation. Duplicate child locators
retain one actual reference, never multiply children. Full owner/scope checks
outside the display page determine states. Metadata<=1MiB; byte-reduced pages
advance from the actual last child, never clip identifiers. Existing /parents
paging remains available for additional selected-session references. Existing
/execution supplies independent native events/attempts; no retry identity is
invented or model/tool request sent. Further generations load only on explicit
expansion/navigation; no per-row frontend fetches.

## Cross-page native tool observations

GET `/api/sessions/:key/tool-observations` follows [native-tool-observations.md](native-tool-observations.md): strict required namespace/value/scope, sequence keyset pages, existing owner/local guards/error envelope and no-store. No body/source IO or writes.
# Additive local functional endpoints

GET `/api/sessions/:key/trace-export` follows [trace-export.md](trace-export.md)
TX-003: bounded local OTLP JSON attachment, no upstream collector send.
GET/POST `/api/experiment-records` and PUT/DELETE
`/api/experiment-records/:id` follow [experiment-records.md](experiment-records.md)
EXP-003: confirmed manual writes, revision CAS, unified ApiError envelopes.
All methods use the existing local connection/Host/Origin guard and foreground
tracking; no-store is required. Original/native data remain independent.

GET `/api/sessions/:key/linked-trace-export` follows
[linked-trace-export.md](linked-trace-export.md) LTX-001..005. It exports two
separate observation scopes with independent paging and generated trace IDs;
membership does not establish a causal parent, retry or billing owner. Existing
local guards, foreground marking and no-store apply. The v1 route is unchanged.

### Automatic monitoring status
`GET /api/health` additionally returns `monitoringEnabled: boolean`, describing automatic file watching/polling for this server instance. Normal Web CLI startup defaults false; `--enable-monitoring` opts in to startup session/team scans and watching. Explicit manual scans and historical reads remain available. The embeddable server factory keeps its prior default watching behavior unless `enableMonitoring: false` is supplied.

## Task workbench read APIs (2026-10-25)

### Evidence-backed architecture diagnosis (2026-10-29)

`GET /api/tasks/:id/architecture-diagnosis?member=all` follows
[architecture-diagnosis.md](architecture-diagnosis.md) AD-001..003. Optional
numeric query keys are exactly ArchitectureThresholds; duplicates/unknowns and
out-of-range values return BAD_REQUEST. Response is ArchitectureDiagnosisReport
from `src/core/architecture-diagnosis-types.ts`, <=512KiB. One explicit owned
analysis, no-store, loopback Host/Origin guard; no collection or execution.
Missing scope returns SESSION_NOT_FOUND; invalid membership returns BAD_REQUEST;
busy/changed source reports a bounded ApiError with reason; unavailable/aborted
analysis uses 503. Original deletion immediately emits a metadata-only existing
`trace_links_changed` hint (empty sessionKeys, exact proxyIds) to clear derived
conclusions without body refetch. Body-backed evidence remains guarded before
and after asynchronous work. Imported evidence unsupported by the collector is
explicitly unavailable, not promoted from experiment driver declarations.

### Existing task reader

The optional `structure=true`, inclusive UTC `from`/`to`, and fixed-window
`GET /api/tasks/:id/timeline?member=&window=` follow [task-process.md](task-process.md)
TP-001..003. Ordinary slim reads remain compatible; no source/body IO in timeline.

- `GET /api/tasks?origin=collected|imported&q=&provider=&range=today|7d|30d|all&offset=0&limit=50` returns TaskPage. Default origin collected, range all; limit 1–100, offset 0–100000. Root tasks are filtered after grouping; child sessions never create duplicate rows.
- `GET /api/tasks/:id` returns TaskContext, at most 100 members. `:id` is URI encoded. `collected:<childSessionKey>` resolves to the canonical root identity. `run:<runId>` resolves an old team link when its root is unique. Missing task returns SESSION_NOT_FOUND (404); invalid/conflicting scope returns BAD_REQUEST (400). Unresolved native relationships produce warnings and preserve standalone access.
- `GET /api/tasks/:id/records?member=main|all|<memberId>&q=&status=&offset=&limit=200&window=&anchor=` returns TaskRecordPage including the refreshed metadata-only TaskContext, so first-read hydration updates member coverage without a second request. Native records are metadata only. Import records reuse TraceLogTurn metadata. No offset means the latest page; anchor overrides offset to load at most one page around that exact record. Unknown/nonmember anchors return SESSION_NOT_FOUND, not a nearby event. Page limit 1–200; search matches metadata and is explicitly scoped to this task/member. It does not search unloaded body text.
- Native record reads lazily parse only the selected native scope, at most 100 members with concurrency 2. They never start a monitor or upstream Agent. Cancellation stops scheduling further parses; already completed local persistence remains. Incomplete/deleted sources are reported as warnings. Imported reads never trigger native scans.
- The first record read fixes per-session maximum sequences in an opaque, validated window token; later pages exclude appended records. Token task/member/filter mismatch returns BAD_REQUEST. Explicit refresh omits the token and obtains a new window. Both empty and unknown-time windows are supported. Raw/body reads use the existing single-event or single-import-turn APIs.
- Every task route is no-store and uses the existing unified ApiError envelope. Query sizes and source counts are bounded. Runtime API types are TaskPage, TaskContext and TaskRecordPage in the data-model task section.

`GET /api/monitoring` returns `{ enabled: boolean, state: idle|starting|running|stopping }`; `PUT /api/monitoring` with `{ enabled: boolean }` serializes shared native listener transitions. Stop waits for watcher cleanup and automatic scans; viewing tasks and reading evidence never invokes these mutations. Both routes are loopback-only and no-store. Configuration persistence and current runtime state are separate.

## Agent boundary evaluation (2026-10-29)

[agent-folding.md](agent-folding.md) AF-001..005 defines canonical portable
project/plan/evidence DTOs. All /api/agent-folding/* routes share loopback Host /
Origin and foreground guards, no-store and ApiError. GET /example explicitly
loads the pinned, licensed official recordings (not new model execution). GET
/status returns FoldingProviderStatus booleans/model name, never credentials.
GET /tasks/:id?member=all reads bounded retained native evidence and creates a
candidate inventory, never eval grades; member follows existing task scope.
POST /smoke accepts only {} and starts the fixed unscored fictional local
fixture, one owned cancellable job with45s server/50s browser ceiling. It cannot
execute a supplied plan or call a paid model. POST /artifacts accepts only
{project:FoldingProject} <=8MiB and returns FoldingArtifact[] as inert reviewable
texts, without file/path/URL execution. Real and external execution are explicit
CLI only; portable imported provenance is downgraded to user-reported.
No background scans/body fan-out/paid requests on viewing, importing, analysis,
export or replay. Missing native scope, changing/deleted evidence, capacity and
malformed inputs stay visible; a source claim is not execution attestation.
