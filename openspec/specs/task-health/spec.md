# Task health requirements

M12 / P0 contract and synthetic data; implementation deferred to P1–P4.
Authority: [task-health.md](../../contracts/task-health.md) TH-001..008.
No schema changes or runtime dependencies are authorized.

## REQ-001 Fixed collector input
Collector SHALL return valid HealthInput with all selected members, detailLoaded,
provider, duration/token/timestamp semantics, fixed window and revision. Read
explicit offset0 pages of200 until hasMore=false or a disclosed budget; no UI
search/status/page filter affects totals. Unparsed members remain unparsed.
Test:2000 retained records with only200 opened still produce full-scope totals;
source change fails409, missing member stays in coverage denominator.

## REQ-002 Source and timestamp interpretation
Engine SHALL use TH-002 declarations and native sequence/opaque identities.
Completion output points are not starts; start semantics is undivided; unknown
semantics yields null partition and think time. Imported fields stay exporter
reported. Test every provider/path declaration, mixed native timing, absent
endpoints and unknown clocks; no guessed MaaS/InferHub/Kernel classification.

## REQ-003 Exact tool pairing
Deduplicate call/result by scoped native tool identity only when pairing=exact;
ambiguous/incomplete pairs cannot supply observed latency. Preserve Claude
collapsed-result endpoints through bounded native facts. Test G1/G2 call/result
pairs, same ID in different members/scopes, off-page partner and conflict.

## REQ-004 Rounds and model waits
Completion rounds SHALL follow TH-004 readiness/last-production rules, ignore
bookkeeping, disclose fallback segmentation and retain same-round overlap.
Test G1 think list [6000,9000,14500,8800,10000] and sum48300ms; G2 readiness19000.
Logical model.calls requires unique request/message evidence, otherwise null
with plan.rounds, never one call per llm/reasoning part.

## REQ-005 Work and exclusive time partition
Compute cumulative Σ separately from interval ∪. Clip to window, sweep endpoints
with TH-004 priority, reconcile partition with raw scoped E2E including explicit
userWait; active facet subtracts only explicitly requested wait. Unknown semantics
makes partition null. Test total overlap, window intersection, running snapshot,
unrequested user gap, requested input and G4 delegate wait60000ms.

## REQ-006 Delegations
Only actual spawn/target identity establishes a delegation. Include confirmed
children's model/tool work in task totals while main-line delegate waiting is
partitioned once. Test G4 latency2000ms, wait60000ms and members2/2; parent or
role template alone yields no invented delegation/communication.

## REQ-007 Usage and missing values
Use tokenSemantics aggregation and correctedUsage inclusion/subset checks;
native and capture mirrors never add usage twice. Unknown is null, not0.
Reasoning is present/explicit zero/unknown; unknown prevents percentage.
Test G5 and three attempts of one logical request, source absent-vs-zero,
cumulative resets, partial usage and cacheWriteReported=false.

## REQ-008 Statistics and timing layers
Metric dictionary TH-005 SHALL be exhaustive; every value carries unit, timing,
layer, coverage, eligible sample count and evidence. P50 median for n>=1, P95
nearest rank only n>=5; raw max/list retained. No mixed layers/derived tool
percentiles. Test G6 P50=3000, P95=null, means750/5650, group counts2/2.

## REQ-009 UX proxies
Compute all *_log boundaries and length-only volumes per TH-004/005. Verification
must follow LAST completed write; first locate requires eventual modified target.
No logs are claimed to measure UI first render or real usable result.
Test G1 ttfr4000, locate16500, write31200, verify160000, gap120000ms.

## REQ-010 Tool classification and rules
Versioned codearts-perf-v1 SHALL implement all16 rules plus2 quality gates in
TH-006, including bilingual templates, evidence and retest metrics. Unknown
baseline =>many_rounds display only. Test each equality/strict boundary,
missing prerequisites, G2 no serial_independent and G3 install count3,sum353000,
long count2,cd-prefix count2 and “核对环境是否重置” suggestion.

## REQ-011 Capped derivation
Exact/measured tool intervals SHALL never be capped. Unpaired capped derived
values carry capped=true and the lower-bound text, never enter act percentiles.
Test G7 duration300000, required Chinese text and p95 null; actual602s paired
value stays602000ms and is eligible.

## REQ-012 Evidence, coverage and recommendations
References SHALL resolve within report/pack. Complete scope alone permits
not_observed; G5 all dimensions insufficient even with cov.incomplete emitted.
No total score. Deduplicate affected wall intervals when ranking suggestions;
quality unknown prevents faster-with-equal-quality claims. Test overlapping
findings, deleted evidence navigation and running terminal-state handling.

## REQ-013 Standard API
Implement the seven explicit routes in api.md Task health reports section,
ApiError for every non2xx, local guards/no-store, strict request/threshold
validation, single job,45s deadline and disconnect cancellation. Test BUSY,
invalid scope/window/threshold, source changed, no implicit hydration and zero
external requests. Preserve architecture-diagnosis route behavior.

## REQ-014 Persistence and history
Atomic report+index writes SHALL follow TH-007. Reuse exact revision/scope/
threshold/version; changed revision retains expired history. Cap50 with visible
manual-deletion instruction, never evict. Test report/index crash boundaries,
orphan reconciliation, traversal rejection and cancellation-after-save retention.

## REQ-015 Export
HTML/MD SHALL escape source text and unsafe links, contain no external script,
full bodies or authentication data. JSON exports exact saved report. Test script
end tags, malicious Markdown links, credentials and absent evidence.

## REQ-016 Deep preview and execution
Preview SHALL return bounded redacted pack/digest/estimate without model call.
Explicit matching digest permits one model request, no retry,120s deadline,
cancellable. Config is server environment only; model status never returns key
or base URL credentials. Test digest changes, no model config, timeout/cancel,
48KiB pack/64KiB response and preservation of ordinary report on failure.

## REQ-017 Deep validation
Validate schema and all pack-local references; invalid schema rejects report,
unfounded numeric claims exclude item, accepted results marked model_judged.
Causes<=5, rounds<=150, goal<=2000chars, excerpt<=1500chars; include matched
normal samples and final/verification tails or explicit shortages. Test forged
record/finding/evidence IDs, fact tampering and injected source instructions.
No deep result mutates ordinary metrics or executes a tool.

## REQ-018 Budgets and scheduling
Enforce100 members/20000 events/2000 spans,32MiB native enrichment,1MiB report;
limit hits visibly partial. Compute20000 events<=3s, yield batches and preserve
NFR loop p99<50ms and forwarding budgets. No SELECT *, prepare loops, body N+1,
synchronous large-file IO, whole-file JSONL split, frontend fan-out or polling.
P2 supplies performance evidence; P0 does not claim runtime acceptance.

## REQ-019 Golden fixture integrity and calibration
G1–G7 HealthInput and expected projection SHALL be valid JSON, t0 fixed to
2026-10-30T00:00:00.000Z, record dates ISO UTC; Codex call/output are separate
records sharing exact native tool reference. TH-008 documents every hand
calculation. Calibration SHALL query sqlite3 -readonly, accepted links only;
insufficient samples say 未校准. A contrary result blocks further work.

## Related gotchas

G4.1, G4.4, G4.5, G4.6; G8.1; G9.1, G9.2; G10.5;
G11.1, G11.3, G11.6, G11.9, G11.10, G11.15, G11.18;
G12.1, G12.2, G12.4; G13.1–G13.6 (task health additions).
