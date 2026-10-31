# Unified task comparison (Phase C, 2026-11-01)

TC-001 URL: canonical entry `#/compare?a=<taskId>&b=<taskId>`; repeat a/b
for disjoint groups of 1..40 tasks. Empty/one-sided selection is editable.
Task list routes containing both groups redirect here (explicit task/evidence routes stay readable); legacy left/right session
keys become collected task references, resolved through TASK_BINDINGS_SQL.
Recent10 valid definitions use localStorage `task-comparison.recent.v1`, guarded
reads/writes. Only URL groups define a comparison; history is convenience only.

TC-002 `POST /api/task-comparison` JSON `{a:string[],b:string[]}` returns
`TaskComparisonSnapshot {a:TaskSummary[],b:TaskSummary[]}`. Strict unique/disjoint
1..40 per side, collected/imported IDs<=1024chars, body<=128KiB, no extra keys.
Collected session references resolve to canonical root tasks in one indexed
binding query; collapsed duplicate roots or cross-side overlap reject400.
Missing tasks404. Same Phase B cached/yielded metadata projection,
coverage, result denominators; no native hydration/body reads/schema changes.
No-store, local guards, gzip, ApiError; metadata source change409 SOURCE_CHANGED.

TC-003 Conclusions compare B median minus A median and B/A (zero baseline =>
unknown ratio). Verdicts better/worse/equal/unavailable describe observed resource
or issue magnitude only, never quality, model inference or causal benefit.
All members/tasks must have reliable values; partial/missing stays unavailable.
Token verdict additionally requires foldingComparison's exact accounting guard;
architecture metrics use foldingComparison unchanged. Cache hit rate requires complete coverage and the same Token accounting guard; higher is better.
Lower counts of tools/agents/delegations are descriptive, not quality proof.
Single sample on either side explicitly cannot prove causality. Mixed providers
and multiple changed labels are confounded. Unknown rows collapse; medians only
in cells; n/mean/range/CV in accessible details. No overall winner.

TC-004 Explicit health action calls existing standard POST sequentially (single
job guard), member=all, no time filter/default thresholds; exact reuse remains
server-owned. No deep/model call. Matching uses finding.rule + normalized evidence
position: member first-seen ordinal and record ordinal inside saved ordered evidence,
removing task/session-specific opaque IDs. No title/body similarity; missing
locations cannot match or certify absence. Mark absence resolved/new only with complete reports, an eligible non-insufficient relevant dimension and
same scope/threshold/calc/rule versions; otherwise disclose insufficient evidence.
Rule rows count distinct affected tasks / all tasks on each side; exact position
rows retain original task+record evidence links. No matching by ephemeral finding.id.

TC-005 Process pair is URL `pa`/`pb` selected task IDs, default first task per side.
Reuse existing POST /api/compare and CompareTimeline/CompareTokenUsage/
CompareToolAnalysis for selected root sessions only, never merge unrelated clocks.
Explicitly label root-session, loaded-page scope, L=A and R=B, recorded tool
interval averages rather than measured execution. Imported tasks have no native
session process view. Tool failure count/rate use existing tool analysis convention.
Exports MD/HTML use selected locale, escaped text, conclusion/metrics/health/
limitations and share URL, no external script or full event bodies.

TC-006 At375px selectors/conclusions stack, page min-width0, only table wrappers
scroll horizontally. CSS uses existing token variables/calc. Reads own abort,
timeout,retry and suppress late results; source invalidation hides conclusions.
ArchitectureReadError reason codes remain shared. No dependency changes.

Types: TaskComparisonSnapshot lives in src/core/task-types.ts with a,b arrays of
existing TaskSummary; no other API fields. Client-only health-diff entries retain
rule/status/side original report+finding references and per-side task counts.


## Phase C review amendment
Initial mount/refresh MUST consume one mount-owned location snapshot before any
state-to-hash write; a/b, pa/pb, compareImport and legacy left/right survive.
Display/export share human duration units (ms/s/min/h/days), signed deltas,
grouped counts/tokens, two-decimal B/A multipliers and one-decimal percentages.
Exact raw values remain inspectable via titles / export raw-value appendix.
Selected-task hints show cache hit rate with explicit member coverage. Process timeline defaults
to hiding system/injected/bookkeeping records using the task reader's shared
presentation predicate, aligned with TH-004a; an explicit bilingual switch
restores them without IO. Filtering is presentation-only: no denominator, health,
tool, usage, raw evidence or stored-event changes. Tool column header is Tool.


Phase E: TR-005 amends TC-001/002/004/005 with ar/br request references,
request-aware process pages and compatible all-request report comparisons.
Whole-task architecture/usage conventions never certify selected requests.
