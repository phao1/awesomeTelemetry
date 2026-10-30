# Task health contract v1

M12 additive increment, P0 (2026-10-30). Source: `docs/task-health/plan.md`,
including the §5.3 correction in 608a1ca. This contract defines future P1–P4
behavior; P0 ships documents and synthetic fixtures only. Existing native DTOs,
SQL schema, benchmark accounting and architecture-diagnosis routes do not change.
No global health score, product ranking, predicted queue time or perceived-time
estimate. Every conclusion is about the selected task and retained evidence.

## TH-001 Input and clocks

The collector returns HealthInput; the pure engine consumes it without IO,
clock reads, source hydration or network calls. Imports below mean the existing
types verbatim from trace-types.ts, task-types.ts and benchmark-types.ts.
All fields are required unless marked `?`. Null means missing/unknown, never
zero. Numbers are finite and nonnegative; counts and token/character counts are
safe integers. All external date strings are ISO 8601 UTC. Interval and capture
numbers below are milliseconds relative to `t0`, not epoch milliseconds. Endpoints
are half-open [start,end); point observations at either window boundary are
retained. Empty arrays mean no retained items, not proof of complete coverage.

```ts
type Timing = 'measured' | 'observed' | 'derived' | 'reported'
  | 'model_judged' | 'unknown' | 'unavailable';
type TimestampSemantics = 'completion' | 'start' | 'interval' | 'unknown';
type TtftLayer = 'proxy' | 'exporter' | 'maas' | 'inferhub' | 'kernel' | 'log_upper_bound';
type ReasoningState = 'present' | 'zero' | 'unknown';
type ToolClass = 'install' | 'build' | 'test' | 'lint/typecheck' | 'read'
  | 'search' | 'write/edit' | 'web' | 'delegate' | 'shell' | 'other';
type Dimension = 'perceived' | 'plan' | 'act' | 'model' | 'startup' | 'quality' | 'coverage';
type Coverage = 'complete' | 'partial' | 'unavailable';
interface HealthScope { member: string; from: string | null; to: string | null }
interface HealthMember {
  id: string; parentId: string | null; role: string;
  sessionKey: string | null; provider: ProviderKey | null;
  detailLoaded: boolean; durationSource: DurationSource;
  tokenSemantics: TokenSemantics | null;
  timestampSemantics: TimestampSemantics; cwd: string | null;
}
interface HealthRecord {
  recordId: string; memberId: string;
  event: TraceEventSlim | null; importedTurn: TraceLogTurn | null;
  inputLen: number | null; outputLen: number | null;
  round: TaskNativeRef | null; attempt: TaskNativeRef | null;
  tool: TaskNativeRef | null;
  pairing: 'exact' | 'ambiguous' | 'unavailable' | 'incomplete';
  relatedRecordIds: string[];
  native: {
    modelCall: TaskNativeRef | null;
    toolStartedAt: string | null; toolCompletedAt: string | null;
    modelStartedAt: string | null; modelCompletedAt: string | null;
    firstContentAt: string | null;
    command: string | null; targets: string[]; cwd: string | null;
    delegateMemberId: string | null; requestsUserInput: boolean | null;
    environmentReset: boolean | null; reasoning: ReasoningState;
    usage: BenchmarkUsage | null;
  };
}
interface HealthCaptureTiming {
  id: string; recordIds: string[];
  startedMs: number; firstContentMs: number | null; completedMs: number | null;
  outputTokens: number | null; layer: TtftLayer;
}
interface HealthInput {
  version: 1; taskId: string; t0: string;
  scope: HealthScope; revision: string; snapshotAt: string;
  running: boolean; recordedStatus: TraceStatus;
  window: string; members: HealthMember[]; records: HealthRecord[];
  captures: HealthCaptureTiming[]; limits: string[]; reasons: string[];
}
```

`scope.member` is all/main/an accepted member ID. `from/to` are both null or a
valid ordered pair. t0 is the task's first genuine user_prompt, or imported first
request; absent origin means unavailable elapsed metrics (t0 uses the snapshot
anchor and reasons states `missing_origin`). Scope does not renumber origin;
windowed E2E is the intersection of task active interval and selected window.
`window` is the collector's opaque fixed sequence ceiling, not a UI page.
`revision` binds membership, sequence ceilings, source fingerprints, capture links
and import identity; relevant changes invalidate collection, never silently mix
snapshots. `snapshotAt` caps running intervals. No q/status/UI page filters enter
the denominator. Member counts include unparsed members; do not silently scan them.

Exactly one of event/importedTurn is non-null. `recordId` is the existing task
record ID (native sessionKey:event:eventId, imported import:sequence); memberId
must resolve. `inputLen/outputLen` come from the redundant length columns, null
if not available, including imported records; they are not summary-string lengths.
References are complete namespace/kind/value/scope tuples, never parsed from
public IDs. Pairing uses taskStructure exactly; no timestamp proximity matching.
`native` contains optional facts extracted from verified retained native metadata
or bounded streaming source projections, never fabricated from title wording.
Targets are normalized literal paths/URLs retained in tool arguments; [] means
unknown/no target and cannot prove independence. Command is a bounded command
projection, not permission to execute. Null reset is no observed reset, not proof
that the environment persisted. Usage retains BenchmarkUsage inclusion flags;
null counters must survive adapter zero defaults. `TokenSemantics` supplies
aggregation, not input/cache inclusion. Imported provider is null, not a tenth
ProviderKey. TraceLog request/response are interval semantics with reported timing.

Captures require accepted direct/confirmed session links AND unique exact native
request/response/message ownership. Session association alone is insufficient.
Each capture identifies one logical request attempt; native and capture views
are not separate calls or usage additions. First/completed are absolute offsets
from t0 here (collector adds transport elapsed values to request started_at).
Require started <= firstContent <= completed where known; invalid clocks stay
unavailable with reasons. Proxy content requires observed content timing and the
retained content basis, not first network byte. WS logical calls use the bounded
per-call projection, never whole-connection duration. No same-layer mixing of
unresolved attempts; keep attempt identities, count one logical call, disclose
retries. Unknown platform layers stay unavailable until P5 source validation.

## TH-002 Timestamp semantics

| Semantics | Meaning and permitted reconstruction |
|---|---|
| completion | Record timestamp observes a completed model item/call emission/result return; reconstruct model waits backwards from next model production, tools from exact call/result endpoints. It is not request start or first token. |
| start | Parts share message creation; only a combined model-or-tool round interval is recoverable, never a model/tool split. |
| interval | Verified source start/end, including OTel and imported request/response; use those endpoints, not next-record gaps. Missing endpoint remains missing. |
| unknown | No calibrated declaration: counts and explicitly sourced cumulative work only; no partition or T_think. |

| Provider/path | Declaration in health layer | Guard |
|---|---|---|
| codex rollout | completion | Exact call/output pair observed even when session durationSource is derived; unmatched duration remains derived. |
| claude JSONL | completion | Tool result may be collapsed by adapter; source result timestamp must be retained in native facts before exact duration is claimed. |
| codeagent (Claude wrapper) | completion | Same mapping, namespace remains provider scoped. |
| opencode db/jsonl, codearts, codeagent2 before P1 | start | durationSource derived/unknown; message.time.created is shared by parts. |
| opencode OTel | interval | Actual span start/end; current mixed-source session measured flag does not certify every event. |
| opencode/codearts/codeagent2 after P1 | interval only for verified complete native intervals | Missing part endpoints fall back to start; session measured only if all relevant spans measured. |
| trae | unknown | Native startTime/endTime exist in some rows; no general health timestamp declaration without validation. |
| qoder | unknown | Adjacent-row durations do not establish semantic endpoints. |
| workbuddy | unknown | Same; do not infer semantics from call/result names. |
| TraceLog (provider null) | interval | requestTime/responseTime; numeric duration/TTFT is reported, exporter layer only. |

These are source-based declarations, not empirical calibration claims. See
`docs/task-health/timestamp-calibration.md`: all nine providers currently lack
associated transport samples. A contrary empirical result blocks implementation.
No migration or event timing_source column is authorized.

## TH-003 Derived structures and output

```ts
interface HealthSpan {
  id: string; memberId: string; recordId: string | null;
  kind: 'model' | 'tool' | 'user' | 'delegate' | 'compact' | 'other';
  toolClass: ToolClass | null; title: string;
  startMs: number | null; endMs: number | null; timing: Timing; capped: boolean;
  roundId: string | null; status: 'ok' | 'error' | 'unknown';
  model: string | null; reasoning: ReasoningState;
  tokens: BenchmarkUsage | null;
  firstContentMs: number | null; firstContentLayer: TtftLayer | null;
  outputChars: number | null;
}
interface HealthRound {
  id: string; memberId: string; index: number;
  readyMs: number | null; firstOutputMs: number | null;
  modelEndMs: number | null; endMs: number | null;
  toolSpanIds: string[]; writeFiles: number; parallelTools: number;
  reasoning: ReasoningState;
}
interface HealthMetric {
  key: string; value: number | null;
  unit: 'ms' | 'count' | 'pct' | 'tokens' | 'chars';
  timing: Timing; layer: TtftLayer | null; coverage: Coverage;
  samples: number; reason: string | null; evidenceIds: string[];
  facets: Record<string, string>;
  stat: 'value' | 'mean' | 'p50' | 'p95' | 'max' | 'sum';
  values: number[] | null;
}
interface HealthEvidence {
  id: string; memberId: string; recordIds: string[]; captureIds: string[];
  title: string; summary: string | null; truncated: boolean;
  intervalMs: [number, number] | null; timing: Timing;
}
interface HealthFinding {
  id: string; rule: string; dimension: Dimension;
  severity: 'warning' | 'notice' | 'info'; confidence: 'observed' | 'heuristic';
  facts: Record<string, number | string | null>; evidenceIds: string[];
  intervalMs: [number, number][] | null;
  recommendation: { action: string; conditions: string; retest: string[] };
}
interface HealthThresholds {
  profile: 'codearts-perf-v1';
  longToolMs: number; duplicateInstalls: number;
  toolErrorPct: number; toolErrorMinCalls: number; consecutiveErrors: number;
  writeFiles: number; singleFileWriteRoundPct: number; serialReads: number;
  roundBaseline: number | null; roundMultiplier: number; explorePct: number;
  repeatedReads: number; reworkRounds: number;
  firstOutputMs: number; reasoningMinRounds: number; reasoningPct: number;
  reasoningGroupMin: number; reasoningRatio: number; cacheHitPct: number; gapMs: number;
}
interface HealthReport {
  version: 1; id: string; taskId: string; mode: 'standard'; scope: HealthScope;
  revision: string; generatedAt: string; snapshotAt: string; running: boolean;
  thresholds: HealthThresholds; calcVersion: number; ruleVersion: number;
  coverage: { members: { loaded: number; total: number };
    timing: Record<Timing, number>; limits: string[]; reasons: string[] };
  metrics: HealthMetric[];
  partition: { modelOnly: number; toolOnly: number; overlap: number;
    undivided: number; delegateWait: number; userWait: number; unattributed: number } | null;
  rounds: HealthRound[]; spans: HealthSpan[];
  dimensions: Record<Dimension, 'findings' | 'not_observed' | 'insufficient' | 'not_applicable'>;
  findings: HealthFinding[]; evidence: HealthEvidence[]; limitations: string[];
}
```

Span and round offsets share t0; nullable endpoints cannot imply zero duration.
Span title/evidence title <=200 characters; public evidence summary <=1500
characters, always truncated explicitly, no full bodies/authentication material.
Round index is 1-based per member in sequence order. When an event turnKey
exists, round.id copies that opaque session-scoped key verbatim; otherwise use
a member-scoped serialized native round tuple, or memberId:fallback:index when
no identity exists. Imported round IDs use memberId:import:sequence. IDs are
unique report-wide and are never parsed to recover identity. writeFiles counts distinct known file targets; parallelTools
is peak simultaneous exact/measured calls (touching endpoints do not overlap).
HealthSpan is a semantic superset of BenchmarkSpan, not a TypeScript subtype
(the kind/timing unions widen). Projection preserves IDs, name=title,
duration=end-start when known, firstToken=firstContent-start. Non-benchmark
kinds are excluded, never converted to model calls. Reuse correctedUsage and
benchmarkStats; benchmark's measured-only gate remains unchanged, health's
observed-pair eligibility is explicit below.

Metric identity is (key,layer,facets,stat), unique per report. Composite dictionary
entries emit scalar rows with facets: component (volume/explore), state
(reasoning), group (reasoning_split), model (by_model), fingerprint
(duplicate_install), tool/class (tools). `values` is the eligible raw sample list
before percentile sorting; null for nonsampled values. `samples` counts eligible
independent observations, not number of records or sum of values. Reasons are
mandatory when value=null or coverage!=complete; evidence IDs resolve locally.
Timing unknown means an existing quantity has unresolved timing provenance;
unavailable means no eligible value; model_judged belongs only to deep results.
Mixed timing populations emit separate rows, not a falsely precise average.
Coverage timing counts spans per Timing, not milliseconds or percentages.
All partition fields are milliseconds. Dimensions use findings only when the
rule's prerequisites and scope coverage hold; otherwise insufficient. A partial
report may retain supported findings, but cannot certify absence. For G5's
unparsed member and missing usage, ALL dimensions are insufficient, including
coverage; cov.incomplete is still emitted. No not_observed from incomplete data.

```ts
interface DeepHealthFragment {
  id: string; recordId: string; text: string; truncated: boolean;
  role: 'goal' | 'finding' | 'normal' | 'final' | 'verification';
}
interface DeepHealthPack {
  version: 1; reportId: string; revision: string; scope: HealthScope;
  metrics: HealthMetric[]; findings: HealthFinding[]; evidence: HealthEvidence[];
  rounds: { id: string; index: number; memberId: string;
    startMs: number | null; endMs: number | null;
    tools: { name: string; title: string; status: string }[];
    tokens: BenchmarkUsage | null; reasoning: ReasoningState }[];
  fragments: DeepHealthFragment[]; limitations: string[];
}
interface DeepHealthReport {
  version: 1; id: string; reportId: string; taskId: string;
  digest: string; generatedAt: string;
  provider: 'anthropic' | 'openai-compatible'; model: string;
  promptVersion: number; status: 'accepted' | 'partial' | 'rejected';
  timing: 'model_judged';
  valueMoments: { kind: 'ttfmp' | 'ttv'; recordId: string;
    reason: string; counterEvidence: string; evidenceIds: string[] }[];
  necessity: { findingId: string; verdict: 'necessary' | 'likely_waste' | 'unknown';
    alternative: string; evidenceIds: string[] }[];
  causes: { hypothesis: string; support: string; against: string; evidenceIds: string[] }[];
  experiments: { variable: string; primaryMetric: string; qualityGate: string;
    fixedTask: string; expectedInterval: string; evidenceIds: string[] }[];
  rejected: { section: string; index: number | null; reason: string }[];
  analysis: { inputTokens: number | null; outputTokens: number | null; durationMs: number };
  limitations: string[];
}
```

Pack evidence is the bounded public projection needed to resolve copied fact-table
evidenceIds; fragments carry excerpts and link exact recordIds. Missing excerpts
are disclosed rather than resolved against unrelated reports.
Deep IDs link to an immutable ordinary report. Digest is SHA256 of canonical
UTF-8 pack JSON (recursively sorted object keys, array order retained), lowercase
64-hex. It binds redaction, facts, scope and revision, never includes credentials.
Fragments <=1500 characters, goal <=2000; rounds <=150; normal samples match
finding fragment count when available, otherwise disclose shortage. Include final
assistant reply and last verification tail; select exact evidence record IDs,
not an arbitrary first400 prefix. Entire redacted pack <=48KiB serialized UTF-8.
No raw source or authentication headers. Original retention remains unchanged.
Each accepted conclusion needs >=1 valid fragment/evidence ID in this pack;
recordId and findingId must resolve too. Causes <=5. Reject malformed schema as
one rejected report; preserve a static reason. A valid item with any numeric
claim absent from the facts table is excluded and recorded in rejected; other
valid items survive (partial). References outside this pack are rejected, never
repaired by model guesses. No accepted items means rejected. Never overwrite
ordinary facts. Model output <=64KiB. Numeric claims include number words and
units; validation uses the fact values with explicit unit conversion only.
Prompt treats all excerpts as untrusted data, ignores embedded instructions,
forbids tools/files/configuration changes, and requires unknown when unsupported.
Analysis token counts/elapsed are diagnostic overhead, excluded from task metrics.

## TH-004 Executable algorithms

1. Collect selected accepted members at fixed ceilings, explicitly offset=0,
   limit=200, continue hasMore with the same window. The taskRecords default
   offset is the last page: never rely on it. Query slim columns plus input_len/
   output_len in cached batched statements, not bodies or SELECT *. For completion
   windows, collect the full ceiling prefix needed for pairing/round readiness,
   then intersect reconstructed intervals; taskRecords's forward-duration window
   filter is not health's semantic interval filter. Preserve off-window partners
   as context, not additional in-window work. Verify revisions before/after async
   reads and before saving. No implicit hydration of detailLoaded=false members.
2. Order per member by native sequence; use timestamps only as coordinates.
   Group opaque turnKey (or exact native round identity); never parse/sort keys.
   Without a key, start a model segment after user input or completed preceding
   tool group; group contiguous model output and its emitted tools/results until
   the next model segment after results. Disclose fallback segmentation. Ignore
   token_count/empty reasoning carriers, system injections and bookkeeping as
   model output. A tool call emission is model production, its result is not.
3. For completion rounds ready=first user_prompt for round1; subsequent ready=
   previous round's last exact result (or previous model end when no tools).
   Last model production includes the tool call emission. Think interval is
   [ready,last model production]; same-round later production extends it, so
   model/tool overlap is possible and must not be subtracted twice. First output
   delay=first model production-ready, layer log_upper_bound, timing derived.
   Negative/missing boundaries produce null with clock/readiness reason.
4. Pair tools on (member,namespace,scope,tool_call value) only when exact and
   unique. Input-side invocation and output-side return are two observations of
   ONE call. Use retained call/result write timestamps, ignoring result's derived
   duration. Claude collapsed results need native toolStartedAt/toolCompletedAt;
   without them do not promote the call to observed. Verified interval endpoints
   are measured; unpaired event.durationMs is derived, capped iff >=300000 on a
   known capped derivation path. Never cap exact/measured intervals. Unknown
   endpoints are not fabricated from next record. Capped text is
   “≥300s（推导值封顶）” / “≥300s (derived duration capped)”. Derived samples are
   shown separately and excluded from act.avg/p50/p95/max eligible distributions.
   Capped lower bounds may support long_tool if already above threshold.
5. For intervals use native model start→last non-tool part end; tool state
   start/end directly. Imported numeric model/tool durations remain reported
   cumulative work, not invented tool placements within request/response.
   Start semantics yields only [message creation,next known boundary] undivided
   activity; no T_think split. Unknown semantics disables the entire partition
   and model-round timing, while explicit measured spans/counts remain usable.
6. Clip all known intervals to active task/window bounds; running work ends at
   snapshotAt with partial final-duration coverage. Sort all endpoints, examine
   each adjacent positive interval. Assign exactly one category in this order:
   explicit user-input wait; main delegation wait with no concurrent main-line
   activity; start-semantic undivided activity; model+tool overlap; model only;
   tool only; unattributed. Delegate wait covers spawn→return including launch
   and tail, not just child's 12→68 activity. Child model/tool spans still enter
   cumulative sums and global unions even while the partition labels delegate
   wait. Tool delegate spans are not ordinary toolOnly activity during that wait.
   Σ sums per span; ∪ merges sorted overlapping/touching intervals. Partition
   sums exactly to windowed E2E, whereas Σ may exceed it. Never compute idle as
   E2E−Σ. Explicit requested user wait is excluded from active E2E and accounted
   separately in the displayed partition reconciliation: raw wall span = active
   E2E + userWait; ordinary unrequested gaps are retained in E2E. Without explicit
   user-input request, merely list the gap, do not subtract it.
7. Tool classification priority: explicit delegate, install, lint/typecheck,
   test, build, write/edit, read, search, web, shell, other. Match command argv
   names plus tool metadata, not arbitrary result prose. Install patterns include
   npm/pnpm/yarn install|ci, pip install, mvn dependency:*, gradle --refresh*.
   Resolve cwd from literal `cd X &&` against session cwd, otherwise use session
   cwd; normalize separators and dot segments, preserve case/arguments/quotes,
   trim/collapse unquoted whitespace, remove only the cd prefix for command
   fingerprint. Never execute/expand shell substitutions. Missing cwd/command
   means insufficient fingerprint. Reset observations split duplicate groups.
8. Usage: dedupe one native logical call/last snapshot, never sum capture and
   native mirrors or repeated cumulative snapshots. Incremental counters sum;
   cumulative counters use last consistent snapshot/deltas, resets disclosed.
   Derive inputIncludesCache/outputIncludesReasoning from actual source facts,
   not tokenSemantics defaults. Apply correctedUsage: input denominator is input
   if cache included, else input+cacheRead+cacheWrite; total adds output plus
   reasoning only if excluded from output. Enforce subset checks and
   cacheWriteReported semantics. Any missing inclusion/count needed by the
   formula => overall null, raw counters retained as facets of cost.tokens.
   Cache hit=100*ΣcacheRead/ΣnormalizedInput (not mean of per-round ratios);
   denominator zero => null. Low-cache rule excludes round1. No inference that
   unknown usage means no cache or thinking disabled.
9. Reasoning present if any native reasoning record/block or positive reasoning
   token; zero only if source explicitly reports zero AND no positive evidence;
   otherwise unknown. Adapter-filled zero is not source evidence. Round counts
   emit state facets; pct only if all rounds known and N>0. Split means group by
   present/zero, never assign unknown to zero; separate TTFT layer and timing.
10. Statistics retain raw eligible independent samples; n=0 => null mean/P50/
    P95/max. P50 median, even n mean of middle two; P95 sorted a[ceil(.95n)-1]
    only n>=5, else null. n>=1 still gives P50/max/list. Never average precomputed
    percentiles or mix layers. Tool percentiles exclude unpaired/derived/capped.
11. UX starts at task t0: first assistant-side item gives ttfr; first exact read
    completion of any eventually modified target gives first_locate; earliest
    write completion gives first_write and first_reviewable; after LAST write,
    earliest successful test/build/lint/typecheck completion gives first_verified.
    No matching observation => null. max_gap uses consecutive retained activity
    record observations within active bounds (exclude pure bookkeeping), plus
    interval completion endpoints when supplied; attach both ends and cause,
    never label an unattributed gap “queue”. Volume partitions outputLen into
    assistant text/reasoning/tool output, no body read or double counting.
12. Emit only supported rules. Complete dimension with no applicable supported
    findings => not_observed; structurally inapplicable => not_applicable;
    missing prerequisites => insufficient. G5 global incomplete override applies.
    Quality unverified says “未观察到验证”, never “没有验证/失败”. Running reports
    do not assert final success. Sort suggestions 感→少→并→快, within dimension
    by union of affected critical-path intervals. Union shared evidence intervals
    before ranking, do not promise savings or count the same time twice.

Partition clarification: plan §5.3 asks the partition to sum to E2E and also says
explicit requested user wait is deductible. Preserve both quantities without a
new metric key: overview.e2e_ms remains raw scoped wall time for reconciliation;
its facets `{component:'active'}` row gives the explicitly wait-excluded value.
Step6's “active E2E” refers only to that facet. The default partition includes
userWait and sums to the default raw overview.e2e_ms. No wait is present in G1–G7.

### Engine entry point

```ts
analyzeTaskHealth(input: HealthInput, thresholds: Partial<HealthThresholds> | undefined,
  meta: { id: string; generatedAt: string }): HealthReport
```

The caller supplies meta (the server supplies its report UUID and generation
timestamp). The engine copies both fields verbatim, never reads the clock or
creates a UUID. HealthInput and HealthReport types remain unchanged.

## TH-004a User turns and between-turn idle (amendment, 2026-10-31)

Found on real Codex data in P2b: a session idled 17 days after `task_complete`,
resumed with `thread_settings_applied`/`task_started` and a new user_prompt, and
steps 3/6 attributed the whole gap to model thinking. This section amends TH-004
steps 3, 6 and 11 and the partition clarification; where they conflict, this
section wins.

1. User turn. Per member, each genuine user_prompt (not bookkeeping, not a
   parent→child subagent prompt) opens a user turn that lasts until the next
   genuine user_prompt of the same member or the end of scope. Step 3 restarts
   in every user turn: its first round's ready = that user_prompt; later rounds
   as before. A round, think interval or tool span never crosses a turn boundary.
2. Turn end = latest end of the turn's non-bookkeeping production records and
   located tool intervals; a running tool keeps the turn open. Bookkeeping and
   system records (task_complete, task_started, thread_settings_applied,
   environment/skills/tools injections, token_count) neither end nor extend it.
3. Between-turn idle. For consecutive user turns, the positive interval
   [previous turn end, next user_prompt] is userWait with component
   `between_turns`; explicit requested waits keep component `requested`. Both
   take the explicit user-input wait priority in step 6. If the previous turn
   end is unknown, no interval is created and coverage records
   `turn_end_unknown`.
4. No model think interval, round or tool span covers userWait; model.sum/union
   and act.sum/union never include it.
5. overview.e2e_ms keeps the raw span (first genuine prompt → last semantic
   completion) and the partition still sums to it. Its `{component:'active'}`
   facet = raw − |∪ userWait ∩ scope|, counting both components.
6. ux.*_log milestones are reported in active time:
   (milestone − t0) − |userWait ∩ [t0, milestone]|, with a `{component:'raw'}`
   facet carrying the unsubtracted value.
7. ux.max_gap_log removes userWait intervals first; only gap parts outside
   userWait count. perceived.long_gap therefore never fires on between-turn idle.
8. Round identity. When the same opaque turnKey reappears in a later user turn
   of the same member, its first round keeps round.id = turnKey; each later
   split round gets the deterministic id `<turnKey>@<userPromptRecordId>`. The
   source event's turnKey is never rewritten.
9. Multi-member wait. Member waits are kept per member. Task-level userWait
   (partition and active E2E) is the union of member waits minus every part
   covered by another selected member's located model/tool/delegate activity;
   the covered parts follow the normal step-6 order.
10. plan.rounds is null only when an unloaded member or a member/event ceiling
    could hide rounds. Native-metadata limits (e.g. native_line_limit) and
    public-projection omissions keep the counted value and only add a reason.

G8 (normative, Codex-shaped, single member, completion semantics, seconds from
t0, Codex call/result records share one tool_call ref with pairing=exact):
0 user_prompt; 3 call c1 exec_command `npm test`; 13 result c1; 15 llm "done A";
15.2 system task_complete; 3615 system thread_settings_applied; 3615.5 system
task_started; 3616 user_prompt; 3620 call c2 apply_patch writing `src/b.ts`;
3622 result c2; 3625 llm "done B"; 3625.1 system task_complete.
Expected: rounds think 3000/2000/4000/3000 (ready 0, 13, 3616, 3622);
plan.rounds 4; model.sum_ms 12000; act.sum_ms 12000; overview.e2e_ms 3625000,
active facet 24000; partition modelOnly 12000, toolOnly 12000, userWait 3601000,
overlap/undivided/delegateWait/unattributed 0; ux.ttfr_log 3000;
ux.first_write_log 21000 (raw facet 3622000); ux.max_gap_log 10000 cause
`npm test`; no perceived.long_gap finding.

## TH-005 Metric dictionary (and timing-layer summary)

Only these plan §1.2 keys and its stated distribution variants are permitted.
All time units are ms (fixtures convert seconds ×1000); pct is 0..100.
`M/O/D/R/J/U` below = measured/observed/derived/reported/model_judged/unavailable.
Every row also permits U when missing; unknown provenance uses Timing unknown.
Counts with complete known-empty scope may be 0; missing coverage is not 0.
All samples obey selected members, fixed ceiling, clipping and dedup above.

| Key | Definition / time boundaries | Unit | Allowed timing (layer) | Missing result | samples |
|---|---|---|---|---|---|
| ux.ttfr_log | t0→first assistant reasoning/llm/call record | ms | O | null | 1 task if both bounds |
| ux.first_locate_log | t0→first read completion of eventually modified target | ms | O | null | 1 task with target+pair |
| ux.first_write_log | t0→first completed write | ms | O | null | 1 task with completion |
| ux.first_reviewable_log | same write boundary, proxy only | ms | O | null | 1 task with completion |
| ux.first_verified_log | t0→first successful verification end after last write | ms | O | null | 1 task with eligible verification |
| ux.max_gap_log | max consecutive active observation gap; retain position/cause | ms | O | null if <2 observations | number of eligible gaps |
| ux.volume_log | component assistant/reasoning/tool output length sums in scope | chars | O | null component if required length missing | eligible records/component |
| ux.ttfmp_judged | t0→deep-selected effective information record | ms | J | null until accepted deep judgment | 1 accepted selection |
| overview.e2e_ms | first genuine prompt→last semantic completion, clipped; running→snapshot; active facet per TH-004 | ms | O/M/R | null if bounds unknown | 1 task |
| act.calls | distinct native tool_call identities, result not another call; imported tool_call_count reported | count | O/R | null if identities/coverage missing | calls (imported: turns reporting count) |
| act.avg_ms | arithmetic mean exact/measured call→return durations | ms | M/O | null if none | eligible paired calls |
| act.p50_ms | median of same raw eligible tool durations | ms | M/O | null if none | eligible paired calls |
| act.p95_ms | nearest rank on same sample set, n>=5 | ms | M/O | null when n<5 | eligible paired calls |
| act.max_ms | maximum of same paired sample set | ms | M/O | null if none | eligible paired calls |
| act.sum_ms | Σ tool work call→return; derived/reported separate rows | ms | M/O/D/R | null if none known; partial sums labelled | known call durations (imported: turns) |
| act.union_ms | ∪ located tool intervals clipped to scope | ms | M/O/D | null if interval placement missing | located tool spans |
| model.calls | unique native request/message identity, retries not new logical calls | count | O/R | null; show plan.rounds instead | identified logical calls |
| model.round_avg_ms | mean ready→last model production per round | ms | D/M/R | null for start/unknown or no valid rounds | rounds with model bounds |
| model.sum_ms | Σ model round work, children included | ms | D/M/R | null if none | valid model spans/rounds |
| model.union_ms | ∪ located model intervals | ms | D/M | null if placement unknown | located model spans |
| model.cache_hit | 100*ΣcacheRead/Σnormalized input, full scope | pct | O/R | null if any inclusion/count unknown or denominator0 | deduped calls/turns with known usage |
| model.ttft[layer] | request start→first content; log upper bound ready→first completed model record | ms | M(proxy),R(exporter/maas/inferhub/kernel),D(log_upper_bound) | null per layer | eligible calls/rounds per layer; stat mean/p50/p95/max |
| model.tpot[layer] | native reported formula retained; normalized facet Σ(completed−firstContent)/Σ(outputTokens−1), each output>1 | ms | M(proxy),R(exporter/maas/inferhub/kernel) | null if formula/unit/bounds/count unknown | valid calls per layer; never log approximation |
| plan.rounds | decision cycles by member/opaque turnKey or disclosed fallback | count | O/R | null if incomplete source cannot establish total | retained rounds |
| act.long_tool_count | durations >100000ms per class; capped derived lower bounds separate | count | M/O/D | null when timing unavailable | eligible timed calls, not record pairs |
| act.parallel_rounds | rounds with peak concurrent tools>=2 | count | M/O | null if pairing/placement missing | rounds with complete tool intervals |
| act.files_per_write_round | distinct written files / write rounds; preserve raw per-round list | count | O | null if targets unknown or no write round | write rounds |
| act.single_file_write_round_rate | 100*single-file write rounds/all write rounds | pct | O | null if targets unknown or no write round | write rounds |
| model.reasoning_rounds | state present/zero/unknown counts; pct facet only unknown=0 | count / pct | O/R | unknown state, pct null if any unknown | all retained rounds |
| model.reasoning_split | mean first-output delay and round duration by present/zero; layer kept | ms | D/M/R | null missing group measure; <3 each only display | eligible rounds in each group/layer |
| model.by_model | per-model call count/token/work/TTFT facets, same formulas, no new metric | count/tokens/ms | O/D/M/R | unknown model bucket, no fabricated identity | calls/rounds per model and component |
| plan.delegations | actual exact spawn/recipient link count, not parent/template count | count | O | null without native execution/link evidence | actual delegation calls |
| startup.delegate_latency_ms | spawn observation→child first record | ms | O | null if either endpoint/link missing | linked spawn/child pairs |
| plan.main_wait_ms | union of delegate intervals with no other main-line work | ms | O | null without links/endpoints | qualifying delegations |
| plan.explore_before_first_write | component rounds/reads/time before first completed write; time=t0→first write | count / ms | O/D | null without write/targets/bounds | preceding rounds/reads; time one task |
| act.duplicate_install | same cwd+command fingerprint install count; sum/union facets | count / ms | O/M/D | null without fingerprint; reset-separated groups | installs per fingerprint |
| act.tool_errors | deduped explicit failed tool calls; rate among known statuses | count / pct | O/R | null without statuses; never count result twice | known-status calls (failure count numerator) |
| cost.tokens | corrected total; component raw input/output/reasoning/cacheRead/cacheWrite facets | tokens | O/R | corrected null on unknown inclusion/counters; raw known counts kept | deduped usage observations |

TTFT layer is a separate DTO field: the literal metric key is model.ttft or
model.tpot, with the table's bracket notation denoting layer, not a new source.
Facets/stat values describe existing composite keys, not extra metric inventions.
Native platform-layer data are not yet integrated; those rows stay unavailable
until P5 validates original units and meanings. No claim of measured platform
latency based on a session duration or Kernel-Inference that includes tools.

## TH-006 Threshold profile and evidence-backed rules

`codearts-perf-v1` defaults (ms, pct, counts): longToolMs=100000,
duplicateInstalls=2, toolErrorPct=30, toolErrorMinCalls=3, consecutiveErrors=3,
writeFiles=5, singleFileWriteRoundPct=70, serialReads=3, roundBaseline=null,
roundMultiplier=1.5, explorePct=40, repeatedReads=3, reworkRounds=2,
firstOutputMs=5000, reasoningMinRounds=10, reasoningPct=90,
reasoningGroupMin=3, reasoningRatio=2, cacheHitPct=90, gapMs=60000.
Overrides are finite nonnegative values, pct<=100, count thresholds integer>=1,
ratios/multiplier>0; null allowed only for roundBaseline. Numeric overrides by
body or query use these exact keys, reject duplicate/conflicting keys and
unknown fields, echo resolved profile in report. These are screening heuristics,
not article-derived product baselines or pass/fail standards.

Each row gives rule ID, dimension, predicate/default, required evidence,
bilingual wording and retest. Confidence is heuristic for optimization claims;
observed only for literal coverage/status facts. Severity notice by default,
quality.error_end warning, cov.incomplete info. Recommendation conditions must
state the evidence limitations; no unsupported seconds-saved claim.

| ID | Dimension | Trigger / threshold | Required evidence | 中文 / English template | Retest |
|---|---|---|---|---|---|
| cov.incomplete | coverage | any unparsed member, all timing D/unknown, unknown token semantics or reached limit | member IDs, timing/usage source, limit name | 数据覆盖不足：{reason}；先补数据。 / Incomplete coverage: {reason}; prepare the missing data. | coverage reasons cleared |
| act.long_tool | act | eligible exact/measured duration>100000; capped lower bound already above threshold separately | call+result IDs or measured interval; class; capped flag | {tool}耗时{duration}；检查类别后尝试预检或后台化。 / {tool} took {duration}; inspect its class and test preflight or background execution. | act.long_tool_count,overview.e2e_ms |
| act.duplicate_install | act | same fingerprint installs>=2 since last observed reset | each install ID, cwd+command, reset coverage | 同依赖安装{count}次；核对环境是否重置，再测试依赖复用。 / Dependency installation repeated {count} times; check whether the environment reset, then test reuse. | install count/union via act.duplicate_install,overview.e2e_ms |
| act.cd_prefix_long | act | long_tool predicate AND literal cd … && prefix | command projection plus long-tool endpoints | {count}条长命令带cd前缀；可控制变量测试PATH方案。 / {count} long commands use a cd prefix; test a PATH alternative under controlled conditions. | act.long_tool_count,act.union_ms,overview.e2e_ms |
| act.tool_errors | act | per tool error pct>30 AND known calls>=3 OR consecutive same explicit error>=3 | deduped calls, explicit error signature/status chain | {tool}出现{errors}次错误；检查环境、参数和契约。 / {tool} has {errors} errors; inspect environment, arguments and contracts. | act.tool_errors,plan.rounds |
| act.small_write_batches | act | distinct files>=5 AND single-file write round pct>=70 | target IDs and round/file mapping | 单文件写入轮占{pct}%；可测试每轮批量写3–5个无依赖文件。 / Single-file rounds account for {pct}%; test batches of 3–5 independent files. | act.files_per_write_round,plan.rounds |
| act.serial_independent | act | >=3 serial read/search calls in same/adjacent rounds with distinct explicit targets | exact nonoverlapping intervals, targets and rounds; independence only heuristic | {count}次不同目标只读调用串行；确认无依赖后测试并行。 / {count} read-only calls to distinct targets are serial; test parallel calls after checking dependencies. | act.parallel_rounds,act.union_ms |
| plan.many_rounds | plan | N>baseline*1.5; no baseline=>display only | explicit same-task-class baseline, raw rounds | 轮数{N}高于基线；测试规划先行和工具合并。 / {N} rounds exceed the baseline; test earlier planning and combined tools. | plan.rounds,overview.e2e_ms |
| plan.explore_heavy | plan | pre-write elapsed/E2E>40%; rounds/reads displayed, no invented round baseline | t0,first write end,pre-write rounds/reads | 首写前耗时占{pct}%；可先给候选文件和路径判断。 / {pct}% elapsed before the first write; test earlier candidate files and path assessment. | ux.first_write_log,plan.rounds |
| plan.repeated_reads | plan | same normalized file read>=3 with no intervening write to it | ordered target read/write observations | {file}在无写入期间读取{count}次；检查上下文保留。 / {file} was read {count} times without a write; inspect context retention. | read count via explore/act.calls evidence |
| plan.rework_chain | plan | >=2 write rounds on same target linked by failed verification | exact write→failed verify→write chain/target | 观察到{count}轮返工链；先定位根因，必要测试修复不等于浪费。 / A {count}-round rework chain was observed; diagnose the cause, as necessary test repair is not waste by itself. | chain rounds,plan.rounds,overview.e2e_ms |
| model.slow_first_output | model | per-layer P50>5000 for proxy/exporter only; log bound display only | eligible raw samples and exact timing ownership | {layer}首条输出P50为{delay}；检查输入、缓存和思考策略。 / First-output P50 at {layer} is {delay}; inspect input, caching and reasoning strategy. | model.ttft same layer |
| model.always_reasoning | model | N>=10 AND unknown=0 AND present/N>=90% | all round states with native zero/present provenance | 思考轮占{pct}%；可测试简单推进轮的动态thinking。 / Reasoning rounds account for {pct}%; test dynamic thinking for simple progress rounds. | reasoning pct,model.round_avg_ms,quality gate |
| model.reasoning_split | model | each present/zero group>=3 AND present mean first-output>=2*zero mean, same layer/timing | both raw groups, means, states; unknown excluded | 思考组延迟为无思考组{ratio}倍；以同任务实验验证。 / Reasoning-group delay is {ratio} times the zero-reasoning group; verify with a fixed-task experiment. | model.reasoning_split same layer |
| model.low_cache | model | normalized aggregate cache hit of rounds2+<90%, all required usage known | deduped round usage/inclusion flags | 第2轮起缓存命中率{pct}%；检查稳定前缀和压缩策略。 / Cache hit from round 2 is {pct}%; inspect stable prefixes and compression policy. | model.cache_hit (same round subset) |
| perceived.long_gap | perceived | max_gap>60000 | two endpoint records, known tool/model interval or unattributed label | 最大日志空窗{gap}，归因为{cause}；测试阶段进度反馈。 / Maximum log gap is {gap}, attributed to {cause}; test progress updates. | ux.max_gap_log |
| quality.unverified | quality | completed write exists and no observed successful verification after LAST write, under selected coverage | last write plus following retained suffix, scope caveat | 最后写入后未观察到验证。 / Verification was not observed after the last write. | ux.first_verified_log,independent quality gate |
| quality.error_end | quality | recorded terminal status error/cancelled; running excluded | native terminal status record/task status | 记录终态为{status}，先核对质量与取消原因。 / Recorded terminal state is {status}; inspect quality and cancellation cause first. | terminal state,independent quality gate |

No file targets/commands means affected rules insufficient, not “no issue”.
Serial independence is a hypothesis even with distinct targets; overlap excludes
G2. Quality gates do not infer acceptance from assistant prose. Startup has no
extra invented rule: show delegate latency facts, insufficient if unlinked.

## TH-007 API, persistence and budgets

Authoritative route section: `api.md` §Task health reports. Standard generation
is synchronous and local, zero external requests, 45s hard deadline, one active
health analysis/server with no waiting queue. Disconnect/shutdown cancels owned
work, yields between batches; cancellation after atomic save is not rollback.
Deep is an explicit preview→digest confirmation→single model call, no retry,
120s deadline. Model client receives system/user/maxTokens/signal and supports
anthropic wrapping AnthropicFoldingClient or openai-compatible chat/completions.
Only HEALTH_MODEL_PROVIDER, HEALTH_MODEL, HEALTH_MODEL_BASE_URL,
HEALTH_MODEL_API_KEY configure it; credentials never leave server or enter pack.
No polling/new SSE per session; historical list only on drawer open/refresh.

Store ordinary `<data>/task-health-reports/<sha256(taskId)>/<reportId>.json` and
metadata-only index.json. Deep files use their own reportId in the same directory,
index links parent reportId. Server-generated UUID IDs, never caller paths.
Write UTF-8 to exclusive same-directory random .tmp with mode0600, flush and
close, rename to final; then atomically replace index with the same protocol.
Per-task store operations serialized. Return success only when both saves finish.
If report saved but index failed, return failure; recovery reconciles validated
orphan reports on explicit history read, never deletes them or pretends rollback.
Interrupted temp files are excluded. Never expose filesystem paths in errors.
Max50 ordinary+deep reports/task; reuse exact revision+scope+resolved thresholds
(and calc/rule version) ordinary report before charging quota. At capacity reject
new save and ask manual deletion; no automatic eviction or new delete route.
Revision changes mark history expired, retain immutable old report. Evidence
jump checks current existence; report facts remain reproducible after deletion.
HTML/Markdown escape all interpolated source strings including link destinations,
no raw HTML/unsafe schemes/external scripts. Export only IDs/titles/truncated
summaries, never complete source or auth. JSON download is the saved report.

Budgets: <=100 selected members, <=20000 native/imported events, <=2000 model/tool
spans; deterministic prefixes at limits with partial metrics, reasons/limits and
cov.incomplete, never full-task certification. A hit is partial even at equality
if completeness cannot be established. Native source metadata enrichment reuses
streaming JSONL parsing <=32MiB/task (run-metrics), discards prose and yields;
no large synchronous reads, whole-file regex split, per-call source reparse or
loop prepare. Capture projection retains existing nfr original/worker bounds;
health does not waive architecture-diagnosis's separate bounds. Compute20000
events <=3s target, event-loop p99<50ms hard budget; yield each bounded batch.
Saved ordinary UTF-8 JSON <=1MiB including rounds/spans/evidence. If verbose
projection exceeds this, omit bounded evidence/spans with explicit limitations
and partial coverage; if still too large fail visibly, never truncate JSON.
Deep redacted pack<=48KiB, output<=64KiB,120s, cancellable, no retries. Existing
slim route budgets, forwarding budgets, body retention and NFR gates all remain.
P2 tests must assert zero external network calls for ordinary generation.

## TH-008 Golden projection and hand calculations

Inputs in src/core/__fixtures__/task-health are HealthInput, t0 fixed to
2026-10-30T00:00:00.000Z. Every numeric expected duration is ms. Expected JSON
is a partial assertion projection, not a complete report. `metrics` maps the
literal dictionary key to its value (composite keys use named facets/stat
objects), `rounds` asserts selected round fields/work sums, `findings` asserts
rule-specific facts or absence, `partition` uses report fields, `coverage` and
`dimensions` are partial direct projections. Extra generated report fields are
not golden assertions. Projection-only names thinkMs/actSumMs/actUnionMs are
computed from round-linked spans, not additional DTO or metric keys. Composite
expected present/zero/unknown/pct selects the corresponding metric facets;
p50/p95 selects stat. includesMemberIds asserts that the summed spans include
those members, without asserting an unspecified G4 numeric total. Finding
messageContains/recommendationContains checks the rendered bilingual template;
null means that rule is absent. all:unknown checks every retained round state. For duplicate_install, count
selects the count-valued row, sumMs the component=sum ms row, unionMs the
component=union ms row of that fingerprint. reasoning_split firstOutputMeanMs
selects component=first_output, stat=mean, with group=present/zero. G6 pct50
selects state=present, unit=pct; G1 pct=null asserts percentage unavailable.
For max_gap_log, value selects the scalar metric and command checks the tool
interval containing that gap; this does not independently assert a gap finding.
Finding count fields project facts.count, triggered checks rule presence; command
and duration/class facts are checked against exact evidence. G4 included members
are derived from the underlying contributing spans, not a string guessed by UI. Expected only contains plan §6 assertions.

- G1: ready=[0,7,16.5,31.2,160], model end=[6,16,31,40,170].
  Differences=[6,9,14.5,8.8,10], sum48.3s. Tool lengths=1+.5+.2+120=121.7s;
  disjoint so union121.7s; 48.3+121.7=170. Tool calls=4 (not8), rounds5.
  First output4, read of eventual write a.ts ends16.5, write ends31.2,
  last-write-following verification ends160, max adjacent gap160−40=120.
  Reasoning r1/r2 present, r3/r4/r5 unknown =>2/0/3, pct null.
- G2: r2 intervals [16,17],[16,18],[16,19] => lengths1+2+3=6,
  union19−16=3, concurrency3, one parallel round. These calls overlap and
  therefore do not trigger serial_independent; r3 readiness19.
- G3: install intervals [1,129],[130,225],[226,356], same cwd/command;
  count3, sum128+95+130=353. Only128 and130>100 =>2 long/cd-prefix findings.
  No observed reset; recommendation must say 核对环境是否重置.
- G4: spawn10,return70,child first12,last68 =>latency12−10=2;
  delegate wait70−10=60, including launch2 and tail2. Child model/tool work
  is included in task Σ despite main-wait partition precedence; coverage2/2.
- G5: no usage inclusion/count facts =>cache null, no reasoning evidence
  =>all unknown; one unparsed member =>cov.incomplete and all insufficient.
- G6: sorted TTFT=[700,800,5200,6100], P50=(800+5200)/2=3000ms,
  n4<5=>P95 null. Zero mean=(800+700)/2=750, present mean=(5200+6100)/2=5650;
  each group2<3=>reasoning_split does not fire; present2/4=50%.
- G7: unpaired derived300000ms matches cap =>capped=true, lower bound text
  ≥300s（推导值封顶）; eligible paired percentile samples0 =>act.p95_ms=null.

P2 additionally tests plan-linked §15.1 counterexamples: fully overlapping tools
(Σ distinct from union), missing usage, native/capture mirror dedup, three
attempts/one logical call, all2000 records despite opened200, interval/window
intersection, fake deep references, fact-number tampering and prompt injection.
These tests are future runtime work, not P0 .ts edits.
