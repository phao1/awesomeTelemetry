# Contract: Non-functional requirements (performance budget)

## Local official hook bounds

CH-001..006 caps raw ingress256KiB/2s,4 accepted writes/1MiB,10000 metadata rows;
raw originals reuse existing file quota/queue and metadata uses shared capacity
admission. Control file<=4096B, atomic0600; no secret/hash in status/list/logs.
List<=50/64KiB, raw selected detail<=1MiB serialized; no source fan-out. One
latest-ID hint/200ms (unref), shared shell SSE. Selected open metadata can refresh
only when hinted and at most once/5s; stop auto refresh on error/close. Owned UI
reads5s, configuration10s. No whole-file native transcript, new runtime dependency,
schema budget increase or claimed hook crash-journal/real-version certification.

## Codex selected call inspection

Selected jobs may keep at most2MiB total previous request text (FIFO eviction)
for one explicit-lineage payload diff, not full inherited context reconstruction.

One active inspection per service/DB, no waiting queue; process-shared capture
job/worker leases (16MiB reservation,64MiB old/16MiB young worker heap),30s
deadline and request/close cancellation. Stream <=100MiB/direction in64KiB
chunks; <=2MiB/frame,65536frames,4096calls,64tool IDs/call. Retained call-index
serialized metadata<=4MiB, incrementally charged as records change. Worker
returns only the requested20-row page (no items in detail mode), never all calls.
Validate complete
source digest even when projection bounds are reached. No whole-file JSON.parse,
sync source IO, per-message SQL or parsing inside forwarding callbacks.
Worker result and final detail including native links<=1MiB; metadata page<=64KiB; detail request preview<=64KiB and
existing analysis projection bounds apply. Native resolution<=3 cached batch
queries/detail,<=2048 identities; no raw/body/native event N+1.
Active writer snapshot is an O(1) hash.copy of written bytes only, private
registered same-DB sources; no duplicate original or unbounded in-memory stream.
UI lazy,20rows/page; opened selected live sources may update on coalesced
metadata hints at most once/5s, serial page then changed selected detail only.
Before auto cycles, count selected page/detail UTF-8 result bytes over30s.
At>=512KiB delay to debt expiry, reserving64KiB+1MiB for the next serial cycle;
auto reads stay below2MB/30s. Explicit manual actions remain available.
Pause/hidden/unmount suspends automatic reads, no hint means no polling.
No automatic retry after a read error except one explicit CODEX_SOURCE_CHANGED
live-to-saved convergence attempt, owned by the same5s/byte budget (manual
refresh resets that one allowance). Preserve completed selection/content.
Abort/unmount/deletion/
relation invalidation suppress stale results. All existing budgets unchanged.

## TraceLog bounded import
Existing budgets unchanged. Upload async spool128MiB max and120s total deadline;
one worker/DB,64MiB old/16MiB young heap. Streaming JSON framing retains at most
one2MiB turn/64KiB session;512MiB expanded gzip tar,200MiB selected JSON total,
100MiB/JSON,16files,2000 turns/job,50000tarentries,64KiB extended header. No
HTTP-thread whole-file JSON.parse, sync IO or new runtime dependency. Source
copies throttle existing body-store queue; capture quota/capacity apply. Temp
paths are private generated owned files, cleaned after failure/cancel/close.
Metadata pages<=20 rows; turn detail <=2MiB+64KiB source data before JSON escaping;
download streams. UI preview64KiB, explicit expand/font controls. Unsafe/malformed
or over-budget input fails visibly without deleting user data or weakening tests.

## Native/scan timing interpretation bounds

Functional handoff evidence:227files2879passed/1existing skipped;initial HTML+
preloadedJS standard gzip184270B. Existing05-36-53.997Z-59066 perf all3hard
profiles pass,actual loop p99HTTP2.234367/HTTPS2.062335/near2MiB2.125823ms.
HTTP E2E+23.2% relative to05-15 row crosses20% alert;retain/no waiver or automatic
commit. User paused further work for manual use; no full product/Agent/soak
acceptance or changed storage boundary. Existing §6 commit gate unchanged.

Scan comparison policy is pure, using existing session/pagination/value fields
only, no IO/normalization loops over unrelated sessions/new metric DTO or cost
dedup. Keep numeric scan algorithms; metric epoch6 marks interpretation, capture
parser3/metric1 unchanged. Linked execution merges scalar session-duration and
event count in scan-owner lookup, and adds one cached bulk transport read,
at most8 SELECTs per metadata page regardless of attempt count,
transport<=4096B/attempt,<=50attempts and existing whole1MiB bound unchanged.
No raw/headers/source/body reads, new table/index, N+1 or clock subtraction.
Native/network panel remains lazy; no new eager dependency/runtime package or
polling. Existing JS gzip<=200000B/rendering/loop/forwarding budgets remain.

## Explicit offline reparse bounds

One active reparse per Database,no waiting queue;<=2MiB encoded/decoded per
original,existing parser1024record/262144content/1MiB projection limits. Persist
only<=8192B numeric/status manifest per capture,GETstatus<=16KiB,POST<=1MiB.
Reuse existing capacity-admitted finite commit retry; no hidden source/body copy,
startup reparse,per-row fetch,metric recompute on version check or new capture
event. Existing forwarding/loop/DB/WAL budgets unchanged; no DB split. Status
and action read only on explicit user interaction,client10s owned deadline,
cancel/unmount/invalidation suppress late callbacks; cancellation isn't rollback.

Current functional evidence:223files2797passed/1existing skipped,initial/preloaded
JS gzip198587B. Existing perf05-15-18.499Z-51247 all3hard profiles pass,actual
loop p99HTTP2.068479/HTTPS2.002943/near2MiB2.019327ms. Adjacent04-53row
HTTP/HTTPS first-byte+21.2%/+21.8% and near2MiB E2E+24.5% cross20% alert;
all history retained in PERF-BASELINE.md. No waiver/automatic commit/push or
whole-product/real-Agent/soak acceptance;the existing §6 commit gate remains.

## Functional capability setup and selected diagnostics

Capabilities are fixed9 agent rows/9 transport rows,<=64KiB, no IO/probes/DB/
network effects. One explicit Web read per opening/refresh, owned5s cancellation
and no polling. Pure pair diagnostics reuse an already fetched comparison,
at most5 findings/ten evidence refs, no full-body strings/normalizer/HTTP calls.
UI threshold changes perform no IO. All existing budgets remain unchanged.

Current functional gate (33/71,not release):218files2666passed/1existing skipped,
initial/preloaded JS gzip198243B. Existing perf:check04-53-19.778Z-46153 passes
all3hard profiles; actual loop p99HTTP2.150399/HTTPS2.103295/near2MiB2.134015ms.
Near2MiB extra first-byte p951.775959vs previous04-23row1.313458ms(+35.2%)
crosses the20% relative alert. Preserve all rows/alerts in PERF-BASELINE.md;
no waiver or rerun-until-favorable,no automatic commit/push. Existing §6 commit
gate/full-product acceptance remains; no new disk-boundary/soak/DB-split work.

## Functional selected comparison and native parent increment

One selected pair GET, at most2 existing bounded analysis reads and a fresh
synchronous metadata/deletion snapshot; response<=1MiB, error codes<=32/side,
no raw/header/content payload. No analysis/HTTP/SQL fan-out from request lists,
no charge aggregate or upstream execution.10s owned client deadline, context
diff lazy explicit and separate. Existing source2MiB/projection1MiB limits and
all forwarding/loop/initial-JS budgets stay unchanged.

Native parent references<=50/page,20 candidate owners/reference,<=512KiB total.
Cached fixed-count indexed SQL using source and session/scope-NULL native match
indexes; target<100ms at reference scale, no global parent scan/new index/table.
No original IO or recursive traversal. Client5s deadline, lazy metadata only,
no auto-refetch on SSE, candidate owner rows bounded/virtual where needed.

## Functional timing/execution/export increment

Timing owns at most4096 arrival offset/elapsed points: Uint32+Float64 arrays,
49152 bytes/collector, explicitly charged to shared preview admission and worker
job bytes, including owned handoff copies. Bounds stop timing collection with
preview_limit, not forwarding/original retention. No forwarding-path JSON parse
or decompression. Content classification runs in the bounded capture worker;
recorded arrival offsets, not worker execution time, determine latency. Optional
transport timing increases its serialized cap to4096B; non-timing outcome<=512B
and error code<=128chars remain. Server-Timing projection<=512 UTF16 units with
truncation disclosed; originals unchanged. Existing loop/forwarding budgets stand.

Execution projection: events<=200/attempts<=50 per metadata page, identities and
matches<=1000 each and whole response<=1MiB UTF8; byte pressure removes excess
identity/match entries with explicit incomplete reasons, never metadata body
columns or false exact links. Use fixed-count cached queries/source indexes,
no N+1 or global identity scan; target<100ms at existing tier-B fixture scale.
No server TraceTurn derivation; UI virtualizes events and makes one page request.

Capture export:4MiB serialized UTF8 JSON, analysis retains existing2MiB per
source/1MiB projected bounds. First100 identity/link metadata rows only, no
recursive fetching or original bodies in JSON. Original downloads stay separate
and unbounded by semantic limits. Explicit Web action timeout10s, no polling or
automatic upstream replay. Exceeding the export cap is a static503 error, never
silent header redaction/truncation. No extra runtime dependency or DB table.

## Functional live preview and bounded reconnect (B9)

Metadata journal: max512 frames/512KiB total and5minutes, one process epoch;
individual frames retain the existing256KiB limit. Record once per emitted bus
metadata event, even with no clients; no original body/chunk is journalled.
Overflow/expiry advances the replay floor; gaps force explicit reset rather than
silently skipping changes. No timers/DB writes/body reads for this ring.
Replay stays within the existing1MiB/client writable budget. Existing64-client,
5s drain timeout and slow-disconnect policy applies to both subscription modes.

Live preview: at most64 request windows,32768 UTF16 code units/window and the
existing64KiB display prefix per request;100ms merge or one terminal flush.
Exhaustion stops that request's live preview explicitly, not forwarding/original
capture. No full JSON/regex parse in callbacks or extra decompression there.
Frontend retains at most50 recent stream metadata entries and64KiB selected
preview text; one selected EventSource, no polling or body/list N+1. The selected
connection may drain its tail for at most5s after a separate metadata end hint;
its own ordered end clears that timer, timeout explicitly marks a gap. Metadata
reset uses bounded snapshot refresh only. This is not durable history, arbitrary
transport support or long-soak reliability certification. All old hard budgets
and pre-commit gates remain unchanged.

## Durable capture journal (B6 task7.2)

Capture pressure admission: one shared per-DB lane/max64 active+queued actions,
asynchronous two-file stat per check; no directory/body enumeration. Actual WAL
>=8,000,000 bytes permits one non-waiting checkpoint attempt, no retry. Refuse
new journal admission/capture metadata commits at combined180,000,000 or WAL
8,000,000 bytes, preserving headroom under the unchanged200MB/20MB budgets.
Serialize check+transaction across listeners/store owners; retries recheck.
Busy checkpoint must not spend the configured5s SQLite wait. Read-only capacity
diagnostics never checkpoint or recover. Native SQLITE_FULL tests establish
atomic rollback/evidence retention, not actual filesystem ENOSPC certification.
Unrelated scan/external writers and worst-size transaction overshoot still need
their own acceptance; do not claim full7.3 or long-term shared-DB certification.

Capacity admission MUST revalidate SQLite total_changes/schema_version/data_version around
async stat snapshots, including after checkpoint; at most3 snapshots per action,
then static CAPTURE_METADATA_UNAVAILABLE with no mutation/saved event. Detect
same-connection writes and observed other-connection commits; refuse caller
transactions, never hold a transaction across async IO. This protects against
already-stale admission, not unlimited/future native or external DB growth.
Do not silently throttle/evict native evidence or waive NFR §7 separation.

v17 pressure regression: original bytes/digest, all1900 long scoped tool keys
or2046 tool keys (2048 total native identities), complete1/omitted0
and32 candidate owners must survive a real proxy/worker commit near current WAL
admission; parser/result-limit fallback is not a passing capacity test. WAL must
stay<20,000,000, DB+WAL<200,000,000 and nonempty-sample loop p99<50ms. Native
lookup index covers only session/scope NULL (the current matching query domain),
not duplicate all long tool scope strings. This measured boundary fixture does
not prove all possible inputs, unrelated writers, physical ENOSPC or a long soak.

Capacity Web: lazy chunk, exactly2 bounded requests on drawer open/manual refresh,
zero requests while closed or on SSE alone; each wait aborts after5s. No original
body downloads or per-row reads, no polling/new event frames/automatic mutations.
Existing initial JS<=200kB gzip target/strict project rendering budgets stay
unchanged. Read-only metadata capacity is independent of original-store status,
whose owned initialization may resume previously confirmed deletion. Display
separate partial errors/unknown, never infer physical free space or freed bytes.

Durable original-deletion queue core: max1024 retained jobs, one active run,
normalized1536B/ref,1024-char request identity,4096-char store path. All stored
path/ref values stay internal. Admission+exact marker is one cached transaction;
max3 yielding SQLite attempts using existing10/40ms backoff, no synchronous
busy wait. Shared-ref and pending-job lookup plans must use their indexes.
Original verification streams64KiB chunks; file removal/reconciliation retains
its existing bounded/yielding semantics. Never return complete before IO and
completion-state commit. The confirmed API adds indexed metadata-only intent
guards on selected body/analysis/diff/detail reads, never per-row list reads.
Stop/start exclusion spans owned async IO; shutdown awaits active handlers and
startup recovery. Intent+body-copy clearing is one bounded transaction, not graph
deletion/scan cleanup. Existing DB/WAL/loop budgets stay hard. This is not full
request/header/forensic erasure or maximum-capacity/disk-full certification.

The Web deletion control adds one metadata GET per selected drawer, zero body
reads and zero polling. Explicit refresh/action reuse existing bounded API routes;
GET abort5s, POST wait abort15s (not cancellation of durable server intent).
Block local cached body-bearing panels before submission; late completions cannot
repopulate them. No list N+1 or extra SSE payload. Production initial JS measured
191.40kB gzip in this batch, below the200kB frontend target; the existing500kB
uncompressed chunk warning remains. LCP<=2500ms/INP<=200ms/CLS<=0.1 at p75 and
Lighthouse performance/accessibility>=90 are validation targets, not measured
certifications. The project's stricter first-paint budget remains authoritative.

Explicit original-removal file-layer primitive: max2 body IDs/max4 paths per
operation, async preflight/unlink and incremental directory reconciliation;
max1 maintenance operation and no directory-sized inventory in memory. Yield
while scanning. Forwarding must never call it; a later coordinator must require
durable confirmed intent and no active readers/writers/recovery. No automatic
eviction, new public route or full deletion/space-reclamation claim from this
internal foundation alone.

Retention/recovery coordination uses one indexed cached exact-identity marker
lookup per journal; a deleted match requires no body IO/hash, parse or upstream
request. Markers are inserted set-wise in the explicit retention transaction,
not via a separate success window or per-row prepare. Defaults/budgets stay
unchanged; this is not full manual cleanup/capacity/load certification.

Current explicit TTL is checked before recovering an uncommitted journal's
originals/graph: at most one cached atomic exact-marker INSERT SELECT with an
indexed request-id NOT EXISTS guard per entry, using the same3-attempt yielding
retry. Never run the legacy bulk purge on HTTP recovery paths. Default0 adds
no expiry writes. A pinned-reader500-entry regression must retain WAL<20MB,
DB+WAL<200MB and measured nonzero-sample loop p99<50ms; this bounded fixture
does not certify indefinite marker growth, maximum-size IDs or sustained load.

Journal serialization/atomic file IO and bounded SQLite retries run after an
event-loop yield, not in forwarding callbacks. Per store max64 queued journal
operations,4MiB serialized pending metadata,256KiB/file and16MiB retained
journal bytes (+one bounded atomic scratch file). Admission failure prevents
untracked new original files, reports an explicit capture/write error and
continues unchanged forwarding. Existing originals never evict. Body queues
retain their existing32MiB/4096 operation bounds while awaiting admission.
Recovery enumerates metadata incrementally, streams digests in<=64KiB chunks
and yields between records; no full original read/JSON/SSE reparse. Only this
DB owner's journals may recover. Gate capture queries/start on one shared
recovery task, not scan/static routes; shutdown awaits owned recovery IO.
At most3 nonblocking metadata attempts (10/40ms backoff); permanent failures
do not retry or send saved events. Keep all existing forwarding/DB/WAL/loop
budgets and rerun the actual A/B gate. This certifies process-crash recovery
of durably admitted/written prefixes, not power-loss or unobserved bytes.

## Controlled forwarding A/B gate (B4 task5.5)

Compare the same loopback origin/payload via direct and actual ProxyRuntime→
MITM→original store→worker→metadata/SSE, with no parser/network mocks. Interleave
AB/BA paired samples to avoid fixed order bias. Report cold initialization/
first request separately; exclude only explicit warmup pairs from warm metrics.
Required normal profiles: HTTP and fully trusted HTTPS CONNECT,100 warm paired
samples/profile, concurrency4,8 text deltas paced5ms; an additional near2MiB
HTTP profile uses the same sample/concurrency counts. Record exact byte sizes,
encoding, status/header/body/protocol equality, original counts/digests and
transport/processing outcomes. First-body-byte is not model TTFT or first-token
time. Report raw paired timing samples and p50/p95/max, including signed paired
deltas; warm additional first-body-byte/E2E latency p95 SHALL be<=20ms. Existing
event-loop p99<50ms and DB+WAL<200MB/WAL<20MB stay hard; monitor actual nonzero
samples during forwarding and metadata drain, not the old empty histogram.

Controlled streaming producers wait for the client's first byte before they
can finish, proving forwarding does not buffer to EOF. Compare gzip/br/deflate
JSON/SSE bytes and protocol semantics, and independently verify that reset and
client-cancel prefixes/termination propagate without injected upstream bytes.
All accepted normal-profile captures SHALL save complete exact originals and
have no unexplained processing/admission failures; resource ownership returns
to zero at shutdown. State the measured topology: synthetic origin/client/
runtime in one process, no scanners or full Web query workload. Smoke runs or
insufficient samples cannot claim this performance gate. This scope does not
certify30-minute soak/crash/reconnect or actual Agent/OS/transport support;
those remain separate B6/B9/B10 gates. Never relax assertions after a failure.

Transport outcomes add at most512 serialized bytes and one cached statement
per final capture transaction; detail-only read, absent on metadata lists/SSE.
Freeze first terminal cause and monotonic/UTC end before async flush/worker.
Normal finalization awaits both request/response end; cancel/stop/error releases
owned resources exactly once. Do not impose an implicit request/stream timeout
or wait for parsing before forwarding. Native timeout evidence is classified
only when actually observed. A partial downstream response is aborted on
upstream error, not buffered/replaced/appended with fabricated upstream bytes.

Process-wide capture resource admission (B4 task5.3): max64 live semantic
collectors/32MiB charged preview memory across all MITM listeners. Reserve
320KiB per collector for bounded display/header metadata; charge32KiB for
each16KiB raw block, including its transient flattened handoff copy. Failure
evicts semantic buffers and reports resource_limit/dropped-preview bytes,
never cancels forwarding or deletes accepted originals. Release collector
reservations after worker ownership transfer/rejection and on every exit.
Across processors: max64 jobs/32MiB source bytes including active jobs, and
max2 live workers (including terminating workers). Worker faults retain active
reservations until termination completes. Local limits may be stricter.
These are owned semantic allocations, not a claim about Node/TLS/network RSS.

SSE clients: max64 process-wide. Reject additional clients with503 unified
ApiError SSE_LIMIT_REACHED before subscribing. Each outgoing frame<=256KiB,
pending writable bytes<=1MiB/client, no application side queue. A write=false
starts a5s drain deadline; drain clears it, timeout/overflow/write failure
destroys only that client and increments slowSseDisconnects. Cleanup releases
all subscriptions/timers exactly once; other clients and forwarding continue.
Application reconnect/resume acceptance remains B9, not certified here.

Original file queues additionally cap4096 pending write operations per store
across its concurrent writers, so tiny fragments cannot bypass the byte budget
through Promise/Buffer overhead. Exhaustion returns queue_full with static
CAPTURE_PENDING_OPERATIONS_LIMIT, retaining accepted originals and forwarding.
Decoded expansion uses decoded_too_large/DECODED_TOO_LARGE, distinct from the
encoded source limit. Decoder text assembly retains bounded chunk groups,
not one permanent string object per tiny input fragment.

Byte-preserving decode: retain at most2MiB encoded bytes per direction for
semantic processing in16KiB blocks (not one object per network chunk), plus
at most64KiB display text per direction. Worker admission counts byte previews
as well as compatibility text inputs; owned byte buffers may be transferred,
never detach a caller's buffer. Decode in<=8KiB input slices with separate
2MiB decoded bound and64KiB output previews, incremental UTF-8 and SSE framing.
The capture worker retains at most8192 dispatched SSE events; excess/dropped
events are an explicit semantic decode failure, never an original-file loss.
gzip/br/deflate use bounded streaming node:zlib; stop/destroy on expansion
limit, malformed encoding or consumer failure. Identity/decoder/worker results
remain independent of original-file completeness. No sync decompression or
full JSON/regex parsing on forwarding callbacks. Global preview/processor/SSE
admission follows the process-wide bounds above. Full failure/overhead/load
and reconnect acceptance remains5.4–5.5/B9/B10.

Live capture metadata processing: one owned lazy worker per MITM listener;
WS uses that same collector/file/worker budgets, not an unbounded parallel
pipeline. Forward hooks append constant-size archive headers and bounded
payload copies, no full-payload JSON/base64 or semantic parsing. Live preview
<=64KiB total per connection, each inspected payload prefix<=4096B, text
conversion only within that budget. Worker archive traversal<=8192 records
per direction and2MiB source, readable output<=64KiB/direction; limits are
explicit, original capture/download independent. Close/error/Stop settle once;
Stop marks interruption before terminating both owned WS legs, awaits original
IO/worker/commits before DB release. No default lifetime timer or HTTP fallback.
Transport metadata <=4096B includes WS <=512B, no timing for connection rows.
max64 outstanding jobs and32MiB UTF-8 source bytes, including the active job.
Each body preview<=2MiB and metadata<=64KiB; worker result<=4MiB serialized.
Worker heap limit64MiB old/16MiB young; total admission-to-result timeout5s.
Queue overflow, worker exit/error, timeout and result limit are explicit
CaptureProcessingResult outcomes. Do not fall back to synchronous main-thread
JSON/SSE/identity parsing, and do not mutate/drop forwarded bytes or originals.
Worker input/output remains ephemeral; no extra spool files. Stop awaits
accepted original writes, outcomes and worker termination before releasing DB.
Timestamps/end duration are captured before queueing, not after parsing/IO.
SQLite metadata commit occurs after an event-loop yield, never in a forwarding
callback. The local queue additionally shares process-wide admission above;
all listeners using the application body store share its separate32MiB pending
file-write budget. These owned allocation bounds do not certify total RSS or
sustained load. Worker/bundle tests must exercise built assets on Node20+
without requiring TypeScript execution in a worker.

Connection diagnostic snapshot: one explicit request, one saved-profile read (existing256KiB cap), at most64KiB canonical public CA read and one existing runtime status query; zero original-body reads, process probes, upstream requests or implicit polling. Return <16KiB, static issue message/nextStep <=512 characters each. Web aborts after5s, CLI control after12s. Snapshot invalidation on runtime SSE is local-only. Diagnostics do not establish sustained capture or actual Agent support.

Connection setup: max32 profiles/256KiB profile file,32KiB mutation body, bounded asynchronous reads/atomic writes, no version/process probes on lists. Launch readiness10s, local control fetch timeout12s, CA response64KiB, inherited CA bundle4MiB, CLI help probe2s/256KiB. No secrets/argv in profile metadata or activity events. Process execution uses shell=false and inherited stdio, so the observability server never buffers Agent stdout. SIGINT/SIGTERM and child exit must clean process-owned temporary CA files, without mutating parent environment or user configuration. These bounds do not certify real Agent transport or replace capture/load NFRs.

Proxy lifecycle: network grace 5000ms, stop control deadline 10000ms. Await original flush and listener/socket closure without blocking the event loop. A deadline is an explicit 503, not permission to close SQLite or release ownership while work remains. Test injection may shorten these durations, not remove drain/completeness assertions. Lifecycle diagnostic events contain metadata only, activity updates coalesced at200ms; no per-chunk SSE or periodic SQL polling.

Association fanout: at most32 automatic candidates per proxy attempt, with full-group ambiguity checks and preservation of still-matching previous automatic candidates. All native identity records remain independently accessible; the cap limits suggestions, not retained evidence. Identity pages must also stop before500KB uncompressed and return an actual last-item cursor; long opaque IDs do not bypass pagination budgets.

Identity/correlation additions: indexed metadata-only pages (default50/max100), at most500KB uncompressed for identity pages and200KB gzip for association pages; no file reads/reparse on list paths, no per-row HTTP/SQL queries. Session source collector cap50000, proxy2048 identities; identifiers/scopes1024 chars, namespaces128, locators512, evidence IDs8 per association. Omitted oversized IDs are explicitly incomplete, never truncated into matching keys. A normal scan/proxy ingest updates affected native session keys only; never recompute every association per capture. Existing DB/WAL/event-loop budgets remain unchanged.

Original-backed context analysis remains on demand: at most two 2MiB request files, asynchronous reads, digest validation, no partial JSON parse and no list-triggered file reads. Existing diff response/latency budgets remain unchanged. Capture/download limits are independent.

Association predecessor selection performs a fixed number of metadata queries and at most2 body-bearing reads. No per-candidate body load or session/capture-group body scan. Use existing forward/reverse association indexes and proxy PK, with no temporary sorting tree. Budget: metadata selection <20ms at10000 captures linked to one session in the isolated reference microbench; whole context-diff and event-loop budgets remain unchanged. A latest eligible captured request is labelled as such, not as proof of native turn adjacency.

## Approved original-capture budget (fuse-agent-monitoring)

Original bodies MUST stream to a separate local file store. Defaults: quota 10,000,000,000 bytes (10 GB); per-direction body limit 104,857,600 bytes (100 MiB); global pending write limit 33,554,432 bytes (32 MiB). All are configurable. SQLite metadata/previews retain the existing DB+WAL <200MB and WAL <20MB budget. Body files are accounted separately. The 2MiB context-diff source limit applies only to semantic analysis, not capture or download.

Quota includes completed files, crash remnants and in-flight reserved bytes. Restart MUST count existing files before accepting writes. Limits stop collection with explicit status while preserving accepted bytes. No automatic eviction or implicit original expiry. No whole-body buffering solely for persistence. Writes must be asynchronous and memory bounded across concurrent captures.


> **The biggest spec flaw in the recreated project: its spec had zero
> performance requirements.** As a result its first screen took 5.9-12.4
> seconds. This file defines performance as a **verifiable hard requirement**
> at the same level as functional requirements. Exceeding the budget equals a
> functional defect. The "reference implementation" column comes from that
> measured diagnostic report (524 sessions / 73,588 events / 800MB source
> files) — it describes what the project would grow into **without these
> constraints**, not where this project starts. This project is written to the
> budget columns from the first line of code.

## Explicit local capture self-test

One active job/server, no queue or polling;10s total owned deadline including
origin/network/event wait/original checks,12s Web deadline. Fixed loopback origin
only; fixture/request/response/read buffers<=4096 bytes each, report<=4096 bytes.
Two original reads maximum via existing size/SHA validation, indexed single-row
metadata reads only; event-driven committed capture wait, no DB scans. No new
worker/parser on HTTP handling path: use the actual existing capture worker.
Client disconnect/shutdown abort owned sockets, timers and event subscription;
shutdown waits job cleanup before releasing DB. Existing forwarding/loop/JS
budgets are unchanged. Shared listener and saved synthetic evidence survive a
test; only the owned temporary origin/client are closed.

## 1. Scale assumptions

The system is designed for **tier B**. When the design ceiling is exceeded,
upgrade the architecture per the §7 escalation rules.

| Dimension | Reference measured scale | Design ceiling | Action when exceeded |
|-----------|--------------------------|----------------|----------------------|
| Sessions | 524 | 5,000 | list virtualization + server-side search |
| Total events | 73,588 | 500,000 | partition events by time |
| Events per session | p50=36 / p95=401 / max=9,590 | 20,000 | Gantt timeline LOD downsampling |
| Total source size | 800.21MB (1,514 files) | 5GB | move scanning into a worker pool |
| Largest provider | codeagent 739.21MB / 948 files | 2GB | force byte-offset incremental reads |
| DB size | target < 200MB | 2GB | split DB into index/detail/proxy |
| proxy_requests | 1,820 | 100,000 | retention policy + FTS5 |
| Team runs (add-agent-team-observability D17) | 0 | 500 | server-side search (FTS5) |
| Team agents in one run | 0 | 100 | graph clustering beyond role/task grouping |
| Team tasks in one run | 0 | 1,000 | task-page pagination |
| Team communications in one run | 0 | 20,000 | communication ledger pagination |
| Team activities in one run | 0 | 100,000 | partitioned activity storage |

---

## 2. Response budget (hard requirement)

| Scenario | Reference measured (negative baseline) | **This project's budget** | Verification |
|----------|----------------------------------------|---------------------------|--------------|
| First screen (within 10s of startup) | 5,884ms | **< 100ms** | A/B script Step 4 |
| First screen (within 180s) | 12,399ms | **< 100ms** | same |
| Session list, 500 items | 5.33ms / 447.8KB | **< 5ms / < 60KB (gzip)** | contract test |
| Detail: median session (36 events) | 1.57ms / 193.3KB | **< 5ms / < 15KB** | contract test |
| Detail: P95 session (401 events) | 12.94ms / 1,621.6KB | **< 8ms / < 80KB** | contract test |
| Detail: worst session (9,590 events) | 625.29ms / 32,332.3KB | **< 60ms / < 1,500KB** | contract test |
| Single event drill-down | did not exist | **< 20ms** | contract test |
| Agent Overview | 4,732ms / 524 requests / 299.6MB | **< 400ms / 1 request / < 80KB** | Playwright |
| Mission 冷启（add-mission-control） | — | **< 500ms / 1 request / < 120KB (gzip)** | `perf-diag/08-mission.mjs` |
| Mission 缓存命中 | — | **< 20ms** | 同上 |
| Mission 单 widget SQL | — | **< 30ms @ tier B**（逐条 EXPLAIN + 计时断言） | 同上 |
| 事件循环 p99（mission 请求期间） | unmeasured（同步 GROUP BY 会顶穿） | **< 50ms**（沿用 §2；A/B/C 三区之间 `await setTimeout(0)` 让出） | 同上 |
| Event sort query (worst) | 210.48ms | **< 15ms** | EXPLAIN assertion |
| Total requests in a 30s window | 508 / 151.2MB | **< 15 / < 2MB** | Playwright |
| Incremental scan, no changes | 18,235 SQL / reread 800MB | **0 SQL / read < 20MB** | write-counter test |
| Incremental write of one session (append 1 event) | 348 SQL / 181.91ms | **1 SQL / < 20ms** | write-counter test |
| Event-loop delay p99 (during service) | unmeasured (spawnSync blocked 6,074ms) | **< 50ms** | `monitorEventLoopDelay` |
| Steady-state DB + WAL size | 471.64MB | **< 200MB, WAL < 20MB** | health endpoint |
| Context-diff service (tier-B ceiling pair) | did not exist | **< 100ms p95** | `server.perf.test.ts` |
| Context-diff event-loop delay p99 | did not exist | **< 50ms** | `monitorEventLoopDelay` |
| Context-diff uncompressed 200 response | did not exist | **< 1 MiB** | contract test |

---

## 2.1 Context-diff budget (add-request-context-diff)

The `GET /api/proxy/requests/:id/context-diff` route is an on-demand,
two-row workflow. The following are hard requirements at the same level as the
§2 table:

| Assertion | Budget | Verification |
|---|---|---|
| Service time (endpoint to response) at the tier-B ceiling pair | p95 < 100 ms | `server.perf.test.ts` |
| Event-loop delay during a diff | p99 < 50 ms | `monitorEventLoopDelay` |
| Uncompressed successful response size | < 1 MiB | contract test + serialize-once assert (design D9) |
| Source bodies read per diff | exactly 1 target + at most 1 base | query instrumentation; no capture-group/session body scan; fixed indexed metadata queries for association selection |
| Per-source stored body size cap | ≤ 2 MiB; larger → 422 `source_too_large`, no partial JSON parsing | normalizer test (design D9) |
| Semantic work on the forwarding/startup/list/SSE/detail paths | zero — normalization/diff runs only after explicit Context Diff activation | regression test proving proxy capture does not import diff modules (NFR-P6) |

Legacy candidate predecessor lookups (exact-session and capture-group) must use their
composite index and their `EXPLAIN QUERY PLAN` must not contain
`USE TEMP B-TREE` (see `contracts/database.md` §5.3).

---

## 2.2 Trajectory budgets (add-trajectory-inspector D20)

The turn surface derives and renders entirely on the client (design D2/D3);
these are hard requirements at the same level as the §2 table:

| Scenario | Budget | Verification |
|---|---|---|
| `deriveTurns` over 1,000 events | < 20 ms | `src/core/turn-model.test.ts` benchmark (tasks §4.11) |
| `computeRibbon` over 200 turns | < 5 ms | `src/core/turn-ribbon.test.ts` benchmark (tasks §5.8) |
| session detail first paint, 200-turn session | < 2 s | `PERF-BASELINE.md` entry, real-session measure (tasks §9.13) |
| turn list scroll | 60 fps, stable DOM node count | node-count stability test (tasks §6.16); virtual scrolling above 50 turns via the existing `useVirtualList` |
| ribbon mode switch | zero network, one React commit | component test asserting zero requests (tasks §6.16) |
| card body / raw expansion | ≤ 1 request each, cached thereafter | 100-entry LRU; re-expansion issues no request (tasks §6.13) |
| session list with tag join | within the existing 524-entry baseline (447.8KB / 5.33ms); record the delta | re-measure before/after the join (tasks §2.11, §9.12); a material degradation is reported rather than shipped (storage delta spec) |

Derivation is O(events), runs once per detail load, and is never persisted or
computed on the server. The ribbon renders at most 200 DOM segments (bucketing
above `RIBBON_MAX_SEGMENTS = 200`, no turn dropped). Rendering a turn issues no
request beyond the per-event body fetch.

---

## 2.3 Team budgets (add-agent-team-observability D17)

The team surface serves derived multi-agent runs. These are hard requirements
at the same level as the §2 table, defined at the tier-B ceiling (500 runs;
one large run with 100 agents, 1,000 tasks, 20,000 communications, 100,000
activities):

| Scenario | Budget | Verification |
|---|---|---|
| Team list, 500 runs | < 10ms DB / < 80KB gzip | contract test |
| Run snapshot, 100 agents + 1,000 tasks | < 100ms / < 750KB gzip | contract test |
| Ledger page, 200 activities | < 50ms / < 200KB gzip | contract test |
| One body detail | < 20ms, bounded by existing detail limits | contract test |
| Two-run comparison | < 300ms cold / < 20ms stamp-cache hit / 1 request / < 250KB gzip | contract test |
| Topology / DAG projection | < 50ms each at ceiling | contract test |
| Timeline first meaningful paint | < 2s; stable DOM nodes while scrolling | `PERF-BASELINE.md` entry |
| SSE / request behavior | no per-entity SSE; < 15 API requests in a 30s steady window | Playwright |
| Event-loop delay p99 (during ingest and compare) | < 50ms | `monitorEventLoopDelay` |

Snapshot and compare use stamp caches. Heavy graph/metrics recomputation
occurs after ingest, between foreground-yield points, and is persisted by
calculation version; request handlers read bounded projections only (design
D17).

---

## 3. Startup behavior (hard requirement)

| Requirement | Description |
|-------------|-------------|
| **No full detail prewarm by default** | `prewarmRecent` defaults to `0`. Measured on-demand reads: median 1.57ms, P95 12.94ms; prewarm's benefit is nowhere near its 200-1240x degradation |
| Index phase must complete synchronously | directory traversal + lightweight metadata only; no detail reads, no decryption, no child processes |
| Index phase time | < 3s @ 1,514 files |
| Optional prewarm must yield | pause when a foreground request is detected within 750ms; `await setTimeout(0)` between sessions to yield a full event-loop round |
| Server listen must not be blocked by prewarm | prewarm uses `void backgroundPrewarm(...)`, never `await` |
| No child process spawns on the request path | Trae decryption only runs in 30s polling; the request path returns `pending: true` when not ready |
| One-time rescan after schema v7 upgrade (fix-adapter-turn-semantics A10) | The v6→v7 migration clears derived event data (`events`, `event_raw`, `metrics`, `scan_state`) and marks every session `detail_loaded = 0`, so each session's next open triggers a full rescan. The cost is **one-time and bounded**: source files are untouched and scanning is deterministic, so the rescan reproduces the data exactly; startup after upgrade is slower once, and the change's final report records the measured wall-clock duration (tasks.md §6.7). Repeated initialisation against an already-migrated database is a no-op (completion recorded in `_meta`) and must not rescan again |
| Schema v8 upgrade (add-trajectory-inspector D15) | **Additive only**: the v7→v8 migration creates the `session_annotations` table and its index and touches no existing table, so it triggers **no rescan and no one-time startup cost**. Change A's destructive v6→v7 migration enumerates the tables it clears (`events`, `event_raw`, `metrics`, `scan_state`) precisely so this table survives it by default (see `contracts/database.md` §2); the storage window proves it with a migration-preservation test (tasks §2.4) |

---

## 4. Prohibitions (directly violate the budget)

1. **No `SELECT *`** — always list return columns explicitly
2. **Never return `raw` / `inputSummary` / `outputSummary` from detail list
   endpoints** — these three columns total 96% of DB size
3. **No `db.prepare()` inside loops** — reuse prepared statements
4. **No `spawnSync` / `readFileSync` on HTTP request handling paths**
5. **No per-session SSE events** — must coalesce on a 200ms window
6. **No frontend per-session detail fetches for aggregation views** — must use
   server-side aggregation endpoints
7. **No delete-and-reinsert `upsertEvents`** — must use differential upsert
8. **No skipping `scan_state` writes** — write failures must throw, never
   silently catch
9. **No regex-splitting the whole file to parse JSONL** — must stream line by
   line (v4: `RegExp: \r?\n` self time 459.8ms)
10. **No `ORDER BY LENGTH(col)`** — use a redundant length column + index

---

## 5. CI assertions

The following tests must exist and run in CI. Each locks down a point most
likely to be broken unintentionally by later iterations.

```ts
// server/storage/perf.test.ts

it('hot queries do not produce temp sorts', () => {
  const plans = [
    "SELECT id FROM events WHERE session_id = ? ORDER BY sequence",
    "SELECT id FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT 50",
  ];
  for (const sql of plans) {
    const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x'));
    expect(plan, sql).not.toContain('TEMP B-TREE');
  }
});

it('slim detail response is within the size budget', () => {
  const rec = getSessionDetail(db, worstCaseKey, { mode: 'slim' });
  expect(Buffer.byteLength(JSON.stringify(rec))).toBeLessThan(1_500_000);
});

it('no-change rescan produces zero writes and zero parsing', () => {
  scanAndStoreDetail(db, key);
  const before = writeCounter.value;
  const r = scanAndStoreDetail(db, key);
  expect(r?.skipped).toBe(true);
  expect(writeCounter.value).toBe(before);
});

it('appending 1 event produces exactly 1 INSERT', () => {
  appendEventToFixture(key);
  const before = writeCounter.value;
  scanAndStoreDetail(db, key);
  expect(writeCounter.value - before).toBe(1);
});

it('SSE events per scan round stay bounded', async () => {
  const seen: unknown[] = [];
  eventBus.on('sessions_changed', e => seen.push(e));
  await scanAndStore({ db });
  await sleep(300);                       // wait for the coalescing window to flush
  expect(seen.length).toBeLessThanOrEqual(10);
});

it('scan_state is non-empty after the first scan', async () => {
  await scanAndStore({ db });
  const n = db.prepare('SELECT COUNT(*) c FROM scan_state').get().c;
  expect(n).toBeGreaterThan(0);           // v4 measured 0; this is the regression guard
});
```

```ts
// server/server.perf.test.ts —— end-to-end budget
it('first screen 10s after startup is within budget', async () => {
  const server = await bootServer({ prewarmRecent: 0 });
  await sleep(10_000);
  const t = await timeRequest('/api/sessions?limit=50');
  expect(t).toBeLessThan(100);
});

it('event loop delay stays controlled', async () => {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  await hammerRequests(200);
  h.disable();
  expect(h.percentile(99) / 1e6).toBeLessThan(50);   // ns → ms
});
```

```ts
// server/storage/perf.test.ts —— team (add-agent-team-observability D17)

it('team hot queries do not produce temp sorts', () => {
  const plans = [
    "SELECT id, agent_id, task_id, kind, status, started_at FROM team_activities WHERE run_id = ? AND started_at >= ? ORDER BY started_at DESC, native_sequence DESC, id ASC LIMIT 200",
    "SELECT id, agent_id, kind, started_at FROM team_agents WHERE run_id = ? ORDER BY first_seen_at ASC",
    "SELECT id, status, started_at FROM team_tasks WHERE run_id = ? AND status = ? ORDER BY started_at DESC",
    "SELECT id, from_agent_id, to_agent_id, kind FROM team_agent_edges WHERE run_id = ?",
  ];
  for (const sql of plans) {
    const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x'));
    expect(plan, sql).not.toContain('TEMP B-TREE');
  }
});

it('team responses never contain body columns', () => {
  const list = getTeamRunList(db, { limit: 10 });
  for (const item of list.items) {
    expect(item).not.toHaveProperty('body');
    expect(item).not.toHaveProperty('sourcePath');
  }
  const ledger = getTeamActivities(db, worstRunId, { limit: 200 });
  for (const item of ledger.items) {
    expect(item).not.toHaveProperty('input');
    expect(item).not.toHaveProperty('output');
    expect(item).not.toHaveProperty('raw');
  }
});
```

---

## 6. Regression baseline maintenance

From M3 (storage working), after every milestone merge run Step 2 (segment
timing) and Step 4 (A/B) of `perf-diag/` and append the numbers to
`PERF-BASELINE.md` at the repo root:

```
| Date | Milestone | First screen @10s | Worst detail | Overview | Requests in 30s | DB+WAL |
|------|-----------|-------------------|--------------|----------|-----------------|--------|
| —    | reference (negative baseline) | 5,884ms | 625ms/32.3MB | 4,732ms/524req | 508 | 471.6MB |
| ...  | M3 storage | | | | | |
```

Any column degrading more than 20% vs the previous row blocks the commit
unless the trade-off is documented in the commit message and the budget table
in this file is updated in sync.

### 6.1 Fusion development-snapshot baseline record — 2026-10-16

The user explicitly requested creating/pushing the remote
`codex/telemetryref-fusion` branch after the historical relative-performance
alerts were disclosed. Preserve the partial implementation for manual testing
without claiming a release, main-branch merge or proven performance equivalence.
The commit message must state the retained alerts and this development scope.
Do not remove old samples, rerun until a favorable row appears, or change any
hard limit/assertion. No blanket exception is granted to this or future commits.

| Metric (extra latency p95) | Prior handoff sample ms | Partial-task sample ms | Hard budget, unchanged |
| --- | ---: | ---: | --- |
| HTTP first body byte | 1.819126 | 3.046083 | <=20ms |
| HTTP near2MiB first body byte | 1.176666 | 1.555333 | <=20ms |
| HTTP near2MiB E2E | 4.216458 | 5.174209 | <=20ms |
| Event-loop delay during capture | actual nonzero samples retained | p99<=2.923ms in all3 partial-task profiles | <50ms |
| SQLite DB+WAL / WAL | exact decimal accounting | existing measured hard gates pass | <200,000,000 / <20,000,000 bytes |

Reports02-25-55.717Z-12660 and02-44-26.804Z-15226 remain in the local
diagnostic history; numerical summaries stay in PERF-BASELINE.md. Relative
alerts remain unresolved, not a claim that the new code caused them or that
they are harmless. Run the existing full gates before snapshot commit and
append that result without replacing these rows. The one predefined normal
pre-commit rerun, report02-57-09.382Z-17568, passed every hard profile. Compared
with the immediately previous02-44-26.804Z-15226 row, extra HTTP/HTTPS/near2MiB
first-byte p95 is3.151/7.305/1.389ms, E2E6.448/8.577/3.856ms and loop
p99 2.808/2.083/1.991ms; no column degraded>20%. The largest latency increase
was HTTP E2E~10.1%. Thus this snapshot meets the normal adjacent-row gate;
no performance-budget waiver is invoked, and prior alerts are not erased or
declared explained. Whole-product/actual-Agent/
long-soak acceptance, §7 work and the remaining41 tasks are still incomplete;
the user's separate deferral of database splitting/new storage-boundary tests
stands. No automatic promotion to main or release is authorized.


### 6.2 npm / Web CLI feature-branch measurements — 2026-10-19

The M12 npm/Web CLI branch uses the existing forwarding core. Its diagnostic
setup now copies/fingerprints the complete built worker/chunk closure so flat
server-dist output can be checked. The first pre-commit attempt failed during
old directory setup, before any A/B sample. The corrected run is retained below.
No hard threshold, performance assertion or prior measurement was changed.

Prior: capture-ab-2026-10-19T01-40-41.022Z-12693.json; current: capture-ab-2026-10-19T05-10-18.039Z-18002.json.
Each profile has100 warm paired samples/concurrency4 and104captures/208verified
originals. Existing hard gates pass; actual loop p99 samples are nonzero.

| Extra latency metric | Prior ms | Current ms | Relative | Hard budget, unchanged |
| --- | ---: | ---: | ---: | --- |
| http firstByte | 2.149166 | 2.244000 | +4.4% | <=20ms |
| http e2e | 5.735750 | 5.273125 | -8.1% | <=20ms |
| http loopP99 | 2.119679 | 2.113535 | -0.3% | <50ms |
| https-connect firstByte | 6.830000 | 8.350250 | +22.3% | <=20ms |
| https-connect e2e | 7.830458 | 10.120042 | +29.2% | <=20ms |
| https-connect loopP99 | 1.986559 | 2.094079 | +5.4% | <50ms |
| http-near-2mib firstByte | 2.012833 | 1.948832 | -3.2% | <=20ms |
| http-near-2mib e2e | 6.214792 | 4.857542 | -21.8% | <=20ms |
| http-near-2mib loopP99 | 2.160639 | 2.207743 | +2.2% | <50ms |

HTTPS first-byte +22.3% and E2E +29.2% remain unresolved relative alerts. The
recorded trade-off for this user-requested feature-branch save is to preserve
the Mac-verified npm/Web workflow for review while retaining those alerts and
the existing CSS gzip24380B versus16384B gap. This is not a main-branch merge,
release acceptance, a claim of performance equivalence or causal attribution.
The commit message and PERF-BASELINE.md preserve this scope; no budget is waived.

---

## 7. Escalation signals

If any of the following appears, immediately redesign the affected module for
the next tier — do not wait until everything is over budget:

| Signal | Triggered upgrade |
|--------|-------------------|
| Events per session > 20,000 | Gantt timeline LOD downsampling + forced detail pagination |
| Single source file > 200MB | byte-offset incremental reads promoted from P2 to mandatory |
| Long-term MITM capture enabled | `proxy_requests` in a separate DB + FTS5 + enforced retention |
| Sessions > 5,000 | server-side search (FTS5) replaces frontend filtering |
| Multiple people share one instance | SQLite single-writer lock becomes the bottleneck; need a write serialization queue or external DB |
| One scan round > 10s | move scanning into a `worker_threads` pool |
| Team agents in one run > 500 | graph clustering beyond role/task grouping |
| Team activities in one run > 1,000,000 | partitioned activity storage |
| Team runs > 5,000 | server-side FTS replaces frontend filtering |
| Team source parsing > 10s | move team derivation into a `worker_threads` pool |

## Functional family exploration bounds

One family read: default20/max50 child sessions, existing20 parent-reference
page, <=1MiB UTF8 response, <=12 cached metadata SELECT/WITH statements in one
synchronous snapshot, no source/body IO and no per-child query. Reverse native
parent index and existing native/source indexes apply. Explicit expansion may
load one further page; no eager whole-graph/N+1 fetch. Browser5s owned metadata
wait, independent error/retry/cancel, stale-result suppression; no polling.
Session/attempt/event detail remains selected/lazy using existing slim API.
No new performance waiver; this functional batch defers attribution/soak work.

## Selected native tool-reference lookup

[native-tool-observations.md](native-tool-observations.md) uses default20/max100 slim events, <=1000 returned identity locators, <=1MiB UTF8, <=9 cached SELECT/WITH queries in one synchronous read snapshot. Full selected-source identity validation includes off-page collisions; no per-event read, source/body IO, write, eager full-graph or polling. The source/native/event indexes remain in force; no budget waiver or new performance certification.
# Local export and manual registry bounds

Trace-export metadata reads use exactly three cached SELECTs and at most200
events/512KiB serialized OTLP JSON, with no source/body/identity/proxy reads.
Experiment records use asynchronous bounded1MiB app-owned JSON IO, <=100records,
<=16references/record, a single batch query for newly added scan references and
<=20KiB HTTP mutation bodies. No implicit execution, polling or body fan-out.
These functional bounds do not waive the existing performance budgets or certify
whole-product/long-running/platform acceptance. Full contracts: trace-export.md
TX-003 and experiment-records.md EXP-001..004.

## Frida history and linked export functional bounds

FC-001..004 limits frames to1MiB wire/256KiB decoded JSON; list defaults50,
max500, SQL JSON previews500characters. Selected detail checks256KiB JSON and
4KiB tokens before full acquisition; total reply<=2MiB. Owned browser reads5s,
commands10s; cancelled waits never establish command success.
LTX-001..005 shares one snapshot with <=11 cached SELECTs, native max200 and
capture max50 metadata records, total UTF8<=512KiB. Both pages remain explicit
and independently navigated. No body/source IO or implicit frontend fan-out.
CDP acquisition/manager bounds follow cdp-capture-flow.md. The explicit dev
inspector retains at most64 decoded responses and8MiB decoded UTF8 text total,
each<=1MiB. Admission rejects additional records and increments rejectedCount;
never evicts accepted records. Metadata-only list<=64KiB, selected detail<=2MiB
JSON (escaping included); a detail exceeding that bound is rejected at admission.
An accepted record lives until dev-server shutdown. No automatic scan/start,
body polling, backend fan-out or new runtime dependency. Browser reads own5s,
control waits12s; timeout/cancel is uncertain for mutations. These checks do
not waive the existing budgets, unresolved baselines or long-running acceptance.

## Capture original bundle bounds

CB-001..005 uses at most2 active transfers/exporter,120s total deadline,
at most2 original readers and64KiB file chunks with backpressure. Metadata JSON
retains its4MiB cap; manifest/receipt<=64KiB. No archive spool, full-body buffer,
new runtime dependency or body-bearing list. Browser preparation is5s owned
metadata only; actual native download streams outside JS. Original tar entries
are bounded by ustar's8589934591-byte field, independent of analysis size; larger
sources fail explicitly and remain available through individual downloads.
