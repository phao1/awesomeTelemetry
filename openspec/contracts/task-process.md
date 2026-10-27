# Task process and time navigation (2026-10-26)

User-authorized M10/M8 increment. The canonical DTOs in `src/core/task-types.ts`
are TaskNativeRef, TaskRecordStructure, TaskRoundSeed, TaskStructure, TaskTimeBin,
TaskTimeline and the additive TaskRecordQuery fields below. Existing original
records, native identity rules and the client-only legacy deriveTurns contract
remain unchanged. No schema migration, body read or new dependency.

TP-001: `GET /api/tasks/:id/records` accepts optional `structure=true` and an
inclusive UTC `from`/`to` pair. Invalid/unpaired/reversed ranges are BAD_REQUEST.
Time filtering uses retained start/log intervals. User input, bookkeeping,
output-only tool observations and unfinished records are start markers; their
adjacent-record fallback duration is not execution time. Original fields remain
inspectable. Window tokens bind filters, including the time range. Return
at most200 ordinary slim records; structure adds at most200 native fact rows,
100 preceding user-input references and12 exact same-tool references per row.
These context references do not increase match counts. Structure is optional
for older clients/responses. Existing precise anchors and local guards apply.

TP-002: Native facts use complete retained identity manifests and unambiguous,
nonempty scoped identities only. A tool tuple reused across known distinct
decision keys, conflicting IDs, unbound references or a bounded lookup overflow
cannot authorize grouping. Keep an explicit unavailable/ambiguous/incomplete
reason. Never infer native identity from event-ID syntax, names or adjacency.
Round seeds are observed user-input boundaries, not invented native round IDs.
Model request/response identities may organize recorded attempts; absent IDs
must be labelled model observations with attempt identity unavailable. No
claim of retry, execution completion, measured latency or billing is inferred.
Exactly one retained request/response identity on a context/usage record may
associate at most one model-observation block within the same nonempty declared
decision key. Label this step association, not direct model-event identity.
Conflicting identities or multiple possible model blocks remain unassociated;
the identity-carrying original stays separately inspectable and is never duplicated.
A response-only identity observation without public text remains inspectable;
never fabricate assistant output or infer successful settlement for it.

TP-003: `GET /api/tasks/:id/timeline?member=&window=` uses the fixed sequence
ceilings from a task record window, validated against task/member membership.
It returns160 sparse start-time histogram bins per member (max100 members),
the retained full-scope time extent/count, unknown-time count and parsed-member
coverage. It ignores record search/time filters to keep context stable. It
never parses sources or reads bodies. Native and imported histories retain
separate task identities. Invalid window400; missing task404; no-store and the
existing ApiError envelope apply. A histogram is observation density, never
a duration/critical-path or call-count claim. Only already parsed records are
included; partial coverage remains visible.

TP-004: Client-only process projection groups per member in native sequence:
observed user/native rounds → declared decision keys → model observations or
explicit attempts and exact tool pairs. Partial first/last groups and page-local
labels remain explicit. Group keys are UI keys, never persisted native IDs.
Unknown-time records remain readable. Current result and historical failures
remain separate; completed model output cannot finish a tool/round. Selected
input/output/raw remain the existing lazy single-record reads.

TP-005: A fixed full-scope density overview plus a zoomable detail axis retains
its domain during selection/filtering. Drag selects inclusive time; explicit
zoom/pan/reset, keyboard equivalents and pointer cancellation are available.
Click a density bin reads one bounded time-filtered page, not an arbitrary
nearby record. Exact loaded marks select exact native evidence. Activity lanes
and member lanes distinguish parallel sources. Unknown durations are points;
no fabricated TTFT/decoding segment or compressed wall clock. Search/errors
retain round/step headers without counting context as matches. Expanding groups,
timeline zoom and locale changes do not fetch bodies or unrelated sources.

Budgets: ordinary record read retains its existing budget. Explicit structure
read target250ms after source hydration; timeline target250ms/200KiB gzip at
reference scale, max16000 sparse bins, no per-row SQL/HTTP or original IO.
Two scoped metadata reads (records plus histogram), no polling; stale hints do
not change history. Virtualized flattened process rows and batched SVG paths
keep DOM bounded. Tests cover boundaries, pairing ambiguity, paging, malformed
times, cancellation, navigation and rendering. Verify with real multiagent data.
