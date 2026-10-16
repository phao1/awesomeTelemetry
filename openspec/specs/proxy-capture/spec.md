# Spec: Proxy Capture

> Three kinds of live capture: MITM proxy + CDP + Frida heap scan. Source
> files: `server/proxy/`

## Purpose

Intercept the agent's HTTP traffic, browser DevTools protocol, and memory heap
in real time to capture system prompts, token usage, model names, and other
data scan cannot reach.

## Requirements

### MITM proxy

### REQ-001: HTTPS CONNECT interception
`mitm-proxy.ts` SHALL handle plain HTTP (forward + capture) and HTTPS CONNECT
(generate a per-domain TLS cert → local TLS server to decrypt → forward real
HTTPS → capture).

Lifecycle controls await owned listeners, sockets and original/index writes. Occupied ports fail visibly rather than becoming an uncaught error or permanent starting state. Stop during startup waits for the late transport to close; restart is blocked until ownership is released. Existing HTTP/SSE streams receive a5s network grace, then unfinished directions retain interrupted prefixes. A10s control deadline returns503 without claiming idle or releasing SQLite. Client disconnect and upstream failure finalize each capture at most once. CONNECT certificate callbacks arriving after stop MUST NOT create new TLS listeners. User-supplied upstream TLS agents remain caller-owned. Waiting for traffic, capturing, stopping, failed and degraded are distinct diagnostics; a listening socket alone never certifies Agent connectivity.

### REQ-002: CA certificate management
`ca-manager.ts` SHALL use the actual proxy engine's self-signed root CA in the
controlled caDirectory (`certs/ca.pem`, `keys/ca.private.key`). Per-domain
certificates use that same root, correct SAN and engine persistence/cache.
Do not substitute the legacy independent root-generator filenames for the
monitoring root. Explicit process-local runtime trust does not install OS trust.

#### Scenario: OpenSSL unavailable
- **GIVEN** no `openssl` on the system PATH
- **THEN** MUST fall back to node-forge for generation
- **AND** v4 claimed the fallback but **never implemented it**; v5 must
  complete it

### REQ-003: SSE streaming capture and server-side throttling
When content-type contains `text/event-stream`, SHALL accumulate via
`appendChunk()`. `proxy_stream_chunk` events MUST be emitted after a 100ms
window concatenation, MUST NOT be emitted chunk by chunk.

### REQ-004: Original capture retention
Monitoring SHALL retain original request/response headers and bodies without redaction. Bodies stream to an independent file store, with CaptureBodyRef metadata and bounded SQLite previews. Default body limit is 100MiB per direction, default total quota is 10GB, both configurable. Original files have no implicit expiry/eviction. Analysis limits do not limit capture or original download.

#### Scenario: Budget exhausted
- **WHEN** a configured quota/body/queue budget is exceeded
- **THEN** collection stops with an explicit completeness status, forwarding continues and existing data remains intact

### REQ-005: system_prompt_len redundant column
When writing `system_prompt`, MUST also write `system_prompt_len =
LENGTH(system_prompt)` so the time-window association query can sort by index.

### REQ-006: TTNet detection
`request-context.ts` SHALL check `x-tt-encrypt-*` headers and set the
`ttnetEncrypted` flag.

### REQ-007: Proxy control API
Endpoint definitions in `contracts/api.md` §4. `/api/proxy/requests` MUST
exclude all 4 body columns and the system_prompt body.

Per-request original-body deletion SHALL require exact request identity and
explicit confirmation, with a stopped-monitor maintenance lease excluding all
starts/launches and concurrent deletion. Clear stored body/raw/prompt copies
atomically with durable intent; block fresh body/analysis/diff reads for intent,
including late in-flight analysis/diff results. Keep request/header/native
metadata, expose failed state/retry, resume pending work before capture admission
and retain shutdown ownership. No automatic global Clear/retention deletion.

Application-owned connection profiles SHALL offer explicit terminal process launch without editing native Agent configuration or system trust/proxy settings. Profile edits/deletion use expectedRevision and atomic bounded storage; generated shell commands pin that revision. The shared monitor control awaits actual listener readiness before the CLI launches a child. The launcher preserves user argv/model/auth/permission settings, sets proxy environment only in the child, appends its runtime CA without removing previous CA certificates and cleans owned trust files only after child exit. Equal-issuer/different-key CA collisions fail visibly. Remote/daemon processes and unverified transports are not silently adopted/downgraded. A recipe is not process-specific traffic filtering or verified Agent identity. See api.md §4 for exact routes/types.

Explicit connection diagnostics SHALL read the same saved recipe/current runtime/public CA evidence for Web and CLI without starting a listener, generating CA, executing Agent probes or making upstream requests. Distinguish current expected-port waiting/observed shared traffic from historical totals, other ports and stopped runs. Runtime/OS trust and exact transport remain unverified unless separately tested. Missing/invalid CA, bind failures, cleanup, timeout, bypass rules and capture errors have actionable next steps; CA faults are report findings, not raw filesystem errors or private material.

### REQ-008: parser-router hostname routing
`parser-router.ts` SHALL dispatch by explicit protocol path and body evidence before hostname hints. Chat Completions, Responses and Messages MUST behave identically on custom and official hosts. Ambiguous input keeps unknown classification. Trae tunnel parsing applies only when no recognized cleartext protocol is established.

### REQ-009: token and system prompt extraction
Parsers SHALL extract model and system/developer context from Chat messages, Responses instructions, and Messages string/array system. Usage may be top-level, message_start.message.usage or response.completed.response.usage. Partial snapshots merge fields and never sum repeated snapshots. Missing/invalid counters remain null, genuine zero stays zero. Malformed-JSON fallback stays best-effort and never replaces original evidence.

An on-demand ProxyProtocolAnalysis SHALL separate observed request history, tool declarations, response text/public reasoning, proposed tool calls and observed tool results. Chat parallel tool fragments are keyed by choice+tool index; Responses items by output index/native item ID; Messages blocks by index. Final snapshots replace their accumulated projection rather than duplicate output. Preserve incomplete argument strings and stop/error evidence. Unknown events remain in originals and increment unknownEvents, rather than dropping the entire call. This projection does not claim tool execution or expose hidden reasoning.

### REQ-010: SSE accumulator
`sse-accumulator.ts` SHALL provide `parseSseChunk(chunk)` returning SseEvent[]
and `extractTokenUsageFromSse(events)` scanning usage fields.

Byte previews SHALL preserve encoded bytes independently from display text.
Identity/gzip/br/deflate decoding uses incremental UTF-8 and bounded streaming
zlib before semantic parsing, without changing forwarding or stored originals.
SSE framing accepts split UTF-8/CRLF, one leading BOM, comments, multiline data
and empty data/deltas. Only a blank line dispatches data: EOF discards pending
frames, marks semantic incompleteness and MUST NOT invent usage or completion.
Unsupported/stacked/corrupt encoding and invalid UTF-8 are explicit decode_error
processing outcomes; decoder bounds follow contracts/nfr.md. These outcomes do
not imply original-file loss or actual Agent/network failure.

### REQ-011: request-context lifecycle
`RequestContext` SHALL track a single request: `requestId`
(`req-{timestamp}-{counter}`), method, url, hostname, headers, body,
startedAt, responseStatus, chunks[], ttnetEncrypted. `completeRequest(ctx)`
computes durationMs and the final body.

Current MITM SHALL freeze observed UTC completion and monotonic duration at
the first transport end/error, before file flush or worker queueing. Bounded
metadata parsing runs in an owned Node worker, never synchronous fallback on
failure. Record CaptureProcessingResult independently from original-file
completeness; queue/full/thread/timeout/result-limit faults preserve originals
and forwarding, mark activity degraded and retain unknown parsed metadata.
Shutdown waits pending outcomes/SQLite commits and worker termination before
releasing ownership. Worker limits follow contracts/nfr.md, including shared
process-wide collector/preview/job/worker admission across listeners. Preview
resource exhaustion discards semantic buffers and reports resource_limit plus
actual previewDroppedBytes, while forwarding and original files remain
independent. All reservations release on success/failure/stop; terminating
workers remain charged. Tiny pending original writes also have an operation
count cap. Sustained streaming/failure/recovery acceptance remains separate.

Record optional-compatible CaptureTransportResult atomically and separately
from processing/file completeness. Freeze the first terminal cause, ended
directions and actual upstream status before IO; missing upstream headers are
null, never the engine's synthesized local504. Normal completion waits both
request/response ends, including an early response during an unfinished upload.
HTTP4xx/5xx, native network error/timeout, client cancellation and explicit stop
are distinct; duplicate late events cannot rewrite an already settled result.
Monitoring imposes no default stream/request timeout. On upstream failure after
response headers, abort downstream rather than append generic engine error
text to the observed prefix. Retain exact accepted originals and unknown fields.
Offline protocol projection consumes transport evidence before its size guard:
HTTP error→failed; broken/cancelled/timed-out/interrupted calls cannot become
completed from an earlier protocol marker. Preserve observed usage/items.
Native protocol errors take precedence over later terminal markers. A parsed
error object is emitted once at its actual JSON/event locator; distinct error
frames remain distinct evidence, not deduplicated by equal text/content.

Controlled direct/proxy A/B SHALL exercise the actual forwarding/original/
worker/metadata/SSE path against a loopback origin. Compare exact application
headers, status, encoded bytes, original digests and original-backed protocol
projections. A producer gated on client feedback SHALL prove a first byte is
forwarded before origin completion; reset/cancel prefixes must not gain proxy
error text. Interleave AB/BA samples, separate cold/warm results and apply the
NFR forwarding budget, retaining raw samples and compiled artifact fingerprints.
After shutdown verify collector/job/worker/file ownership is released. A scoped
diagnostic is not actual Agent, full-app concurrency or soak certification.

### REQ-016: Bounded native network identities
Keep explicit request/response/header/tool/trace identifiers with protocol namespaces and source locators. Auto-linkable session identities require a client-declared provider plus native session id; the monitoring proxy MUST NOT inject or rewrite these fields. In this batch the opt-in declarations are x-agent-provider+x-agent-session-id or metadata.agent_provider+metadata.session_id. Ambiguous generic metadata/header IDs are evidence only, not a guessed provider identity. W3C traceparent preserves trace and parent-span identities but never implies Agent session membership.

Configured original capture SHALL gate file creation on durable journal identity,
not gate network forwarding. Persist bounded metadata snapshots off callbacks;
recovery follows storage REQ-019. A failed final commit must retain its journal
and cannot emit saved notification. Process interruption is not normal EOF or
protocol success; already durable terminal evidence remains independent of
unknown parser/original completeness. Missing upstream status stays null.

### CDP capture

### REQ-012: CDP connection
`cdp-capture.ts` SHALL connect to the Electron remote-debugging port (default
9222) via WebSocket, enable `Network` and `Page`, call `getResponseBody` on
`loadingFinished`, and rediscover targets every 10 seconds.

#### Scenario: dev mode only
- **GIVEN** production `server.ts`
- **THEN** CDP routes are not exposed; requests return 404 `ROUTE_NOT_FOUND`
- **AND** the `devOnly` field of `/api/health` MUST list those routes so the
  frontend never fails silently

### Frida capture

### REQ-013: Frida heap scan
`frida-capture.ts` SHALL spawn `frida -p <PID> -l <script.js>`, parse
structured stdout (`[NEW CHAT DATA]` / `[HEX]` / `[END]` markers), store into
the `frida_captures` table, and emit `frida_capture` and `frida_status`.

MUST use async `spawn`, MUST NOT use `spawnSync`.

### REQ-014: Auto-discover target
`discoverFridaTarget()` SHALL find Trae CN.exe PIDs with `tasklist` and probe
whether `ai_agent.dll` is loaded with a minimal Frida script
(`[AI_AGENT_FOUND]` marker). Not found → 409 `FRIDA_TARGET_NOT_FOUND`.

### REQ-015: monitor mode
Frida MUST use a monitor script (continuous listening), MUST NOT use a
one-shot scan script. Rust heap fragmentation makes one-shot scans incomplete.

## Gotchas
- G3.1: dev URLs must be 127.0.0.1 (Huawei proxy ProxyOverride does not
  include localhost)
- G3.2: MITM requires the user to trust the CA cert
- G3.3: the node-forge fallback was not implemented in v4; v5 must complete it
- G6.2: TTNet bodies cannot be MITM-decrypted
- G6.3: Frida Rust heap fragmentation; use monitor mode
- G6.4: Electron strings need UTF-16LE handling
- G6.5: CDP is useless for Trae (TTNet does not use the Chromium Network
  domain)
- G10.2: CDP routes are dev-only
- G11.12 (new): `proxy_requests` is the fastest-growing table; long-term
  capture must use the retention policy or it becomes the next 320MB
