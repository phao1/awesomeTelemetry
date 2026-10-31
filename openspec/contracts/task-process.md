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

TP-005 (user-directed reading amendment, 2026-10-28): Render one compact
single-row trajectory chart with colored input/model/tool blocks and an inline
text legend, not a second density
overview or per-member chart. The chart projects only the current bounded page
of at most200 metadata records. Disclose its page/count boundary; the existing
full-scope timeline response supplies retained extent/count/coverage without
turning unloaded histogram bins into selectable original records. Main/all/one
member remains an outer scope choice, and every selected record retains its
member and original identity. Equal-width record order is the default; the
duration toggle uses retained log intervals and does not claim model inference
timing. Unknown durations remain start markers. No fabricated TTFT/decoding
segment or compressed wall clock is introduced.

Overlapping real intervals remain one visual row: a pointer hit with multiple
loaded records opens an exact-identity choice list rather than guessing which
record was intended. The selected block is painted above overlapping blocks;
keyboard selection remains in original record order. Context retains its own
legend entry when present. No interval is trimmed into a false execution order.

Exact loaded blocks select that exact evidence, expand its ancestors and locate
its ledger row. Hover and keyboard selection identify the same record. Zoom,
pan/reset, inclusive range selection and pointer cancellation stay bounded to
the displayed projection; only an actual UTC time range may become a server
time filter. Equal-width positions are reading order, not timestamps. Round
and call controls fold ledger groups, not alternative clock domains. Search
and errors retain useful round/step context without counting context as matches.
Expanding groups, chart zoom, folding and locale changes do not fetch bodies or
unrelated sources.

The task process owns one vertical reading scroll root. The compact task title
sticks at its top; the single chart sticks directly below the measured title.
Metadata, scope/mode/filter controls and page summaries use compact horizontal
rows and scroll away. The virtual ledger uses this same scroll root, with
correct offsets for sticky content, rather than a second short scroll box.
The wide right-side selected-evidence panel stays usable while reading and can
be resized; narrow layouts must retain a reachable close/return action. Its
default summary shows available tool parameters/results or model public
reasoning/output through selected-record body reads. At most the selected
record plus one exact same-tool related record may be read for that summary;
missing/conflicting/ambiguous partners remain unavailable. Raw is a separate
explicit read. All reads retain cancellation, stale-result suppression and
loading/error/retry/empty states. Viewing or scrolling never enables collection.

Budgets: ordinary record read retains its existing budget. Explicit structure
read target250ms after source hydration; timeline target250ms/200KiB gzip at
reference scale, max16000 sparse bins, no per-row SQL/HTTP or original IO.
Two scoped metadata reads (records plus retained timeline extent/count), no
polling; stale hints do not change history. The single chart contains only the
current <=200 exact metadata records; virtualized flattened process rows share
the main reading scroll root and keep DOM bounded. Selected summary body reads
are capped as above, cached per evidence identity and never fanned out from
list rows or chart rendering. Tests cover page boundaries, pairing ambiguity,
malformed/unknown times, cancellation, exact block-to-row navigation, folding,
shared-scroll offsets and rendering. Browser acceptance must verify sticky
title/chart and usable record/detail height with real multiagent data; tests or
this contract alone do not certify that visual result.
