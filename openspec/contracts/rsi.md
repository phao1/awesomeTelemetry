# RSI contract v1 — M13 / P1

This is the highest authority for the RSI module. Decisions in RSI-001 were
confirmed by the design author on **2026-11-07（决定于 2026-11-07）** and supersede
the conflicting suggestions in `docs/rsi/design.md`. No container, HTTP handler,
UI, monitor invocation, dependency installation, or automatic merge ships in P1.

## RSI-001 Author decisions and numeric semantics

All external timestamps are canonical ISO 8601 UTC strings with milliseconds.
Counts/token counts are nonnegative safe integers, durations are finite
nonnegative milliseconds, ratios are finite fractions, and scores/delta are
finite nonnegative **absolute question counts**, including fractional means.
All declared fields are required; `null` means absent/unknown, never zero.
Undefined is not a persisted value. IDs are 1–128 ASCII letters/digits/underscore/
hyphen; SHA256 values are 64 lowercase hex, Git commits are full 40/64 lowercase
hex. Secrets are never stored: only a SHA256 task bearer digest is retained.

1. Parent selection is **噪声带内最新**, not a statistical confidence lower bound:
   among baseline and promoted versions with trainScore >= bestTrainScore-delta,
   select greatest sequence. An explicit human rollback parent takes precedence;
   it must identify a baseline/promoted version in the same task.
2. Baseline trainScore is the arithmetic mean of R complete first evaluations;
   sealedScore is the arithmetic mean of three complete repetitions. Never round.
   Baseline sealed runs occur during calibration and consume no query budget.
   Candidate trainScore is its first training evaluation's passed count, frozen;
   stable-question confirmation repetitions do not replace it.
3. infraErrorRatio = unresolved infra_error slots after one retry / planned slots.
   Ratio > infraErrorMaxRatio marks evaluation infra_failed and pauses the task
   with reason infra_failed. A nonzero ratio below/equal to the limit prevents
   calibration, yields no delta and pauses the task. Promotion with an incomplete
   comparable set holds with incomplete_comparison; a human cannot approve it.
   Comparable questions have pass/fail for both parent and candidate. Do not
   silently drop missing questions and compare reduced passed counts.
4. Only dependency_change, l3_suspicious, l4_suspicious, token_growth holds can be
   approved, with an explicit nonempty reason and exact categories. Approvals
   bind task/iteration/commit. Missing reviews require human retry_review;
   incomplete comparisons require human retry_evaluation. Neither is approvable.
   Hard rejects are never waived. Approving late token growth reuses the same
   immutable candidate's completed sealed result and re-enters deciding.
5. A candidate's group of three sealed repetitions costs one query, reserved
   before execution. Infra retries do not cost extra and reservations are never
   refunded. Zero remaining queries prevents starting and sets needs_help.
6. Task iteration/token budget exhaustion pauses with budget_exhausted; in-flight
   evaluations become invalidated, contribute no score and are requeued after
   a human raises the budget and resumes. A per-run proxy token-limit 429 is fail,
   as is Agent timeout; neither is infra_error. A promoted trainScore reaching
   targetPassedCount completes the task and stops automatic scheduling. Humans
   can still request final evaluation/adoption when completed. declare_stuck
   sets needs_help.
7. Token growth compares the mean proxy-accounted tokens per question on the
   complete comparable set: candidateMean > parentMean*(1+tokenGrowthMaxRatio).
   ParentMean=0/candidateMean>0 exceeds the cap; both zero does not. Missing token
   evidence holds as incomplete_comparison. No monetary values are exposed.

The train-calibrated delta also applies to sealed absolute counts. **Known
limitation:** using it on a smaller sealed set is more permissive. Ordered pair
differences are not independent samples and delta is a fixed operational noise
band, not a confidence interval. One hypothesis per iteration is required.

## RSI-002 Authoritative runtime types

The following block is adopted verbatim by `src/core/rsi-types.ts`. Numeric units
and null rules above apply throughout. `seq` is a task-local iteration ordinal
(positive) or ledger ordinal (positive); baseline parent ordinal is zero.
`repetition` is zero-based; `attempt` is 0 or the one infrastructure retry (1).
Task config limits are budgets, not measurements. `changes` names intended
files/areas; PRD text is optimizer-authored and untrusted. Artifact/session refs
are task-relative paths, never credentials or arbitrary host paths.

```ts
export const RSI_TASK_STATES = ['created', 'calibrating', 'running', 'paused', 'needs_help', 'completed', 'stopped'] as const;
export type RsiTaskState = typeof RSI_TASK_STATES[number];
export const RSI_ITERATION_STATES = ['draft', 'submitted', 'precheck', 'training', 'reviewing', 'held', 'sealed', 'deciding', 'promoted', 'rejected'] as const;
export type RsiIterationState = typeof RSI_ITERATION_STATES[number];
export const RSI_PHASES = ['smoke', 'train', 'sealed', 'final', 'adversarial', 'ablation'] as const;
export type RsiPhase = typeof RSI_PHASES[number];
export type RsiActor = 'optimizer' | 'worker' | 'monitor' | 'human';
export type RsiOutcome = 'pass' | 'fail' | 'infra_error';
export type RsiEvaluationState = 'queued' | 'running' | 'completed' | 'infra_failed' | 'invalidated';
export type RsiHoldReason = 'dependency_change' | 'l3_suspicious' | 'l4_suspicious' | 'token_growth' | 'missing_monitor' | 'missing_adversarial' | 'incomplete_comparison';
export type RsiApprovalCategory = Extract<RsiHoldReason, 'dependency_change' | 'l3_suspicious' | 'l4_suspicious' | 'token_growth'>;
export type RsiPauseReason = 'human' | 'infra_failed' | 'incomplete_comparison' | 'budget_exhausted';
export interface RsiL1Config {
  maxDiffLines: number; maxDiffBytes: number; opaqueMinLength: number;
  minFingerprintLength: number; commonFingerprintRatio: number;
}
export interface RsiConfig {
  noiseRepeats: number; infraErrorMaxRatio: number; stableWindow: number;
  stableFailRepeats: number; sealedQueryBudget: number; tokenGrowthMaxRatio: number;
  maxIterations: number; maxTaskTokens: number; runTokenBudget: number;
  targetPassedCount: number; l1: RsiL1Config;
}
export interface RsiTask {
  id: string; repository: string; baselineCommit: string; datasetHash: string;
  mainMetric: 'passed_count'; config: RsiConfig; state: RsiTaskState;
  pauseReason: RsiPauseReason | null; delta: number | null;
  baselineTrainScore: number | null; baselineSealedScore: number | null;
  sealedQueriesUsed: number; tokenUsage: number; iterationCount: number;
  currentParentId: string | null; taskTokenHash: string; createdAt: string; updatedAt: string;
}
export interface RsiPrd { observation: string; hypothesis: string; changes: string[]; expectedImpact: string }
export interface RsiApproval {
  iterationId: string; commit: string; categories: RsiApprovalCategory[]; reason: string; at: string;
}
export interface RsiIteration {
  id: string; taskId: string; seq: number; parentId: string | null; commit: string;
  prd: RsiPrd; packageSha256: string | null; state: RsiIterationState;
  holdReasons: RsiHoldReason[]; resumeState: RsiIterationState | null;
  approvals: RsiApproval[]; trainScore: number | null; sealedScore: number | null;
  createdAt: string; updatedAt: string;
}
export interface RsiEvaluation {
  id: string; taskId: string; iterationId: string | null; commit: string; phase: RsiPhase;
  state: RsiEvaluationState; repetitions: number; questionIds: string[];
  passedCounts: number[]; score: number | null; infraErrorRatio: number | null;
  sealedVerdict: 'accept' | 'reject' | null; locked: boolean; createdAt: string; updatedAt: string;
}
export interface RsiRun {
  id: string; taskId: string; evaluationId: string; questionId: string;
  repetition: number; attempt: 0 | 1; outcome: RsiOutcome;
  failureReason: 'test_failed' | 'agent_timeout' | 'run_token_budget' | 'infrastructure' | null;
  durationMs: number; proxyTokens: number | null; artifactPath: string | null;
  sessionPath: string | null; at: string;
}
export type RsiFindingCategory = 'protected_path' | 'task_fingerprint' | 'opaque_blob' | 'dependency_change' | 'binary_file' | 'diff_too_large' | 'file_mode_change' | 'symbolic_link' | 'suspicious' | 'review_clean' | 'isolation_violation';
export interface RsiFinding {
  id: string; taskId: string; iterationId: string; level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  category: RsiFindingCategory; severity: 'reject' | 'hold' | 'info';
  source: 'rule' | 'monitor' | 'human' | 'calibration'; file: string | null;
  line: number | null; evidence: string | null; at: string;
}
export interface RsiDecision {
  id: string; taskId: string; iterationId: string; verdict: 'promote' | 'reject' | 'hold' | 'rollback';
  actor: RsiActor; reason: string; approvedCategories: RsiApprovalCategory[]; at: string;
}
export interface RsiInstruction {
  id: string; taskId: string; kind: 'prohibition' | 'idea'; text: string; effectiveFromSeq: number; at: string;
}
export type RsiCommand =
  | { action: 'start' }
  | { action: 'submit'; commit: string; prd: RsiPrd; parentId: string | null }
  | { action: 'evaluate'; phase: RsiPhase; commit: string }
  | { action: 'review' }
  | { action: 'approve'; categories: RsiApprovalCategory[]; reason: string }
  | { action: 'reject' | 'retry_review' | 'retry_evaluation' | 'pause' | 'resume' | 'stop' | 'declare_stuck' | 'final' | 'adopt'; reason: string }
  | { action: 'rollback'; parentId: string | null; reason: string }
  | { action: 'instruction'; kind: 'prohibition' | 'idea'; text: string; effectiveFromSeq: number }
  | { action: 'set_target'; targetPassedCount: number; reason: string }
  | { action: 'set_budget'; maxTaskTokens: number; maxIterations: number; sealedQueryBudget: number; reason: string };
export interface RsiQueueItem {
  id: string; taskId: string; kind: 'submit' | 'evaluate' | 'review' | 'final' | 'adopt' | 'intervene';
  iterationId: string | null; evaluationId: string | null;
  state: 'queued' | 'running' | 'completed' | 'failed'; requestedBy: RsiActor;
  reason: string | null; command: RsiCommand; createdAt: string; updatedAt: string;
}
export interface RsiOptimizerSession {
  id: string; taskId: string; seq: number; parentId: string | null; commit: string;
  state: 'running' | 'submitted' | 'stuck' | 'no_submission' | 'timeout' | 'interrupted';
  submissionId: string | null; accounting: 'proxy' | 'self_reported';
  tokens: number | null; artifactPath: string; startedAt: string; endedAt: string | null;
}
export interface RsiLedgerHead { seq: number; hash: string }
export type RsiLedgerEvent =
  | { event: 'session_put'; payload: RsiOptimizerSession }
  | { event: 'task_put'; payload: RsiTask }
  | { event: 'iteration_put'; payload: RsiIteration }
  | { event: 'evaluation_put'; payload: RsiEvaluation }
  | { event: 'run_put'; payload: RsiRun }
  | { event: 'finding_put'; payload: RsiFinding }
  | { event: 'decision_put'; payload: RsiDecision }
  | { event: 'instruction_put'; payload: RsiInstruction }
  | { event: 'queue_put'; payload: RsiQueueItem };
export type RsiLedgerInput = RsiLedgerEvent & { taskId: string; at: string; actor: RsiActor };
export type RsiLedgerEntry = RsiLedgerInput & { version: 1; seq: number; prevHash: string; hash: string };
export interface RsiQuestionResult { questionId: string; outcome: RsiOutcome }
export interface RsiNoiseInput { repetitions: RsiQuestionResult[][]; plannedQuestionIds: string[]; infraErrorMaxRatio: number }
export interface RsiNoiseResult {
  status: 'ready' | 'infra_failed' | 'incomplete_comparison'; delta: number | null;
  baselineTrainScore: number | null; infraErrorRatio: number; passedCounts: number[];
}
export interface RsiReview { status: 'clean' | 'suspicious' | 'missing' }
export interface RsiStableHistory { questionId: string; ancestorOutcomes: RsiOutcome[]; candidateOutcomes: RsiOutcome[] }
export interface RsiTokenPair { questionId: string; parentMeanTokens: number | null; candidateMeanTokens: number | null }
export interface RsiPromotionInput {
  iterationId: string; commit: string; delta: number; parentTrainScore: number | null;
  candidateTrainScore: number | null; parentSealedScore: number | null; candidateSealedScore: number | null;
  trainComparisonComplete: boolean; sealedComparisonComplete: boolean;
  findings: RsiFinding[]; monitor: RsiReview; adversarial: RsiReview; approvals: RsiApproval[];
  stableHistories: RsiStableHistory[]; stableWindow: number; stableFailRepeats: number;
  tokenPairs: RsiTokenPair[]; tokenGrowthMaxRatio: number;
}
export interface RsiConditionResult {
  condition: 'anti_cheating' | 'primary_metric' | 'sealed' | 'stable_regression' | 'token_growth';
  verdict: 'pass' | 'reject' | 'hold'; reasons: string[];
}
export interface RsiPromotionResult { verdict: 'promote' | 'reject' | 'hold'; conditions: RsiConditionResult[] }
export interface RsiParentVersion { iterationId: string | null; seq: number; state: 'baseline' | RsiIterationState; trainScore: number }
export type RsiIterationEvent = 'submit' | 'start_precheck' | 'precheck_pass' | 'precheck_reject' | 'precheck_hold' | 'training_pass' | 'training_reject' | 'training_hold' | 'review_pass' | 'review_hold' | 'sealed_accept' | 'sealed_reject' | 'sealed_hold' | 'promotion_pass' | 'promotion_reject' | 'promotion_hold' | 'approve' | 'reject' | 'retry_review' | 'retry_evaluation';
export interface RsiIterationContext {
  actor: RsiActor; reason?: string; holdReasons?: RsiHoldReason[];
  approvedCategories?: RsiApprovalCategory[]; resumeState?: RsiIterationState;
  sealedBudgetRemaining?: number; hasSealedResult?: boolean;
}
export type RsiTaskEvent = 'start' | 'calibrated' | 'pause' | 'resume' | 'declare_stuck' | 'sealed_budget_exhausted' | 'budget_exhausted' | 'infra_failed' | 'incomplete_comparison' | 'target_reached' | 'stop';
export interface RsiTaskContext { actor: RsiActor; reason?: string; budgetAvailable?: boolean; calibrationComplete?: boolean; targetReached?: boolean }
export interface RsiQuestionMetadata { questionId: string; repository: string; testNames: string[]; filePaths: string[]; rareStrings: string[]; expectedValues: string[] }
export interface RsiFingerprint { value: string; questionIds: string[]; kinds: ('questionId' | 'repository' | 'testName' | 'filePath' | 'rareString' | 'expectedValue')[] }
export interface RsiFingerprintDictionary { version: 1; config: RsiL1Config; entries: RsiFingerprint[] }
export interface RsiDiffFinding { category: RsiFindingCategory; severity: 'reject' | 'hold'; file: string; line: number; evidence: string }
```

`RsiTask.repository` is a local target repository reference; datasetHash pins all
splits. `currentParentId`/iteration.parentId null identify the baseline. Package
hash is null until platform build. Evaluation.iterationId null means baseline.
Run proxyTokens is null when accounting is unavailable. Evaluation score is null
until complete and comparable; invalidated/infra_failed evaluations have no score.
Final evaluation identity is (taskId,commit), permanently reserved once queued;
locked=true on completion and its results cannot subsequently be replaced.
Ledger `*_put` records are full snapshots; run/finding/decision/instruction records
are immutable, and final result locks survive rebuilding the cache.

Defaults: noiseRepeats=3 (minimum2), infraErrorMaxRatio=.10, stableWindow=3,
stableFailRepeats=2, sealedQueryBudget=10, tokenGrowthMaxRatio=.30,
maxIterations=20, maxTaskTokens=10000000, runTokenBudget=100000,
targetPassedCount=1 (caller should explicitly set its intended target).
L1 maxDiffLines=2000 changed lines, maxDiffBytes=262144 UTF8 bytes,
opaqueMinLength=512 literal characters, minFingerprintLength=8 normalized
characters, commonFingerprintRatio=.5. No wall clock or IO in src/core.

## RSI-003 State machines

Transition tables and exact guards are specified below with the pure implementation.
Unlisted (state,event,actor) triples and unsatisfied guards throw an error carrying
both state and event. Rejected/promoted iterations are terminal; starting another
iteration creates a new record, preserves the old commit/ledger, and on rejection
retains the original parent. Rollback also creates a new iteration.

## RSI-004 Noise, stability and promotion

For R>=2 complete baseline train evaluations of the same planned question set,
let s_i be each passed count. D contains **all ordered** differences s_i-s_j,
i != j; n=R(R-1), mean(D)=sum(D)/n=0. sampleStd=sqrt(sum((d-mean(D))^2)/(n-1));
delta=2*sampleStd. Identical repetitions give delta=0; for integer candidate and
parent scores, gain>0 requires at least one additional passed question.
No rounding, missing question deletion, infra_error-as-failure, or retry double count.

Stable regression requires the last stableWindow ancestor train outcomes all pass
and the last stableFailRepeats candidate confirmation outcomes all fail. Sequences
are chronological within the chosen lineage; missing/infra results break the
window, never get skipped. Insufficient history and one flip are not regression.

decidePromotion returns all five ordered condition results with structured reason
codes, even when an earlier condition determines the verdict. First non-pass
condition wins: anti_cheating (L0/L1 reject before any holds; then unapproved L1
dependency holds, missing L3/L4 or suspicious reviews), primary_metric
(gain strictly > delta), sealed (candidate >= parent-delta), stable_regression,
token_growth. Incomplete train/sealed/token evidence holds at its condition;
an already known earlier failure is not hidden by later incomplete evidence.
Missing monitor/adversarial can never be approved. Only same-iteration/commit,
nonempty-reason approvals can discharge the four approvable hold categories.

## RSI-005 Optimizer visibility

Projection constructs fresh objects from explicit whitelists; unknown fields are
dropped recursively. Task bearer hashes, local paths, hidden tests/assertions,
sealed question IDs/scores/differences, monitor evidence and all final data are
never exposed. Freeform raw logs/trace bodies are not whitelisted in P1; structured
run metadata provides sanitized observations without pretending string filtering
can make arbitrary test output safe. Original bodies remain human-only.

## RSI-006 Independent L1 module

Only diff text, question metadata and the dictionary/config are inputs. No storage,
server, IO, clock or runtime dependency. Content rules inspect added lines only;
file headers/modes/deletions are inspected for structural protected-path rules.
All extensions are scanned, including prompts, skills, tools and resources.

## RSI-007 Durable hash-chain ledger

Ledger canonical JSON recursively sorts object keys in UTF16 lexical order,
preserves array order, uses JSON string escaping and ECMAScript finite number
serialization (negative zero becomes zero). Only plain JSON values are accepted;
undefined, sparse arrays, nonfinite numbers, cyclic/exotic objects are rejected.
UTF8 without BOM or whitespace. hash=SHA256(canonicalJSON(entry without hash));
prevHash is the prior hash, genesis is 64 zeroes. seq starts at1, increases by1.
Each JSONL record is canonical JSON plus LF; append is followed by fsync before
success. Every event is one of the eight RSI-002 snapshot event types.

One in-process queue per canonical ledger path plus an O_EXCL lock file serializes
writers. Lock contains owner PID, random ownership token, creation UTC time.
Default stale=60000ms, acquire timeout=10000ms, retry=10ms; expiry alone never
steals a live/unknown owner. A separate O_EXCL reclaim guard serializes stale-lock
reclamation; malformed/partial locks require intervention. Release checks ownership.
All filesystem APIs are asynchronous; readers stream bounded lines (1MiB maximum).
Mutation, insertion, deletion, reordering, duplicate seq and broken hashes fail
verification. Compare the cached trusted head seq/hash with the chain prefix to
detect missing tail, while allowing valid ledger entries newer than the cache.
Without a trusted head a valid truncated prefix is indistinguishable from an
original shorter ledger; the report must disclose that limitation. A trailing
unterminated record is separately reported as partial_tail, not tampering; appends
and rebuilds fail closed until explicit recovery (no silent truncation).

Layout: <configRoot>/awesome-telemetry-data/rsi/<taskId>/ledger.jsonl,
ledger.jsonl.lock, ledger.jsonl.lock.reclaim; private/fingerprints.json,
private/sealed/, private/final/, artifacts/<iterationId>/, sessions/<runId>/.
The entire task root is trusted-host-only; optimizer gets projected API results,
never mounts of this root. No secrets in paths, payloads or evidence.

## RSI-008 Rebuildable schema25 cache

Database is a cache of verified ledger entries. Schema25 and explicit column lists
are specified in the additive section of database.md and below. No HTTP execution.

## RSI-009 API contract only

All non2xx use api.md §0.3 ApiError. Task-scoped Bearer auth is distinct from the
human page local token; a task token cannot authorize page routes. Local pages
require a token plus Host/Origin protections; loopback alone is insufficient.
Mutation HTTP requests only enqueue ledger-backed commands; worker executes.

## RSI-010 Known limitations and scope

L1 cannot detect arbitrary split/concatenated strings, encrypted/compressed blobs,
or semantically disguised heuristics. Encoding inspection is one decode layer;
it is not a general deobfuscator. Protected detector marker deletion is caught by
path protection, not by pretending added-line scans understand arbitrary removals.
The chain detects alteration relative to a trusted head; it is not a signature
against a writer able to rewrite both ledger and trusted cache. No key material,
currency, container/HTTP/UI execution or monitor Agent is implemented in P1.

### RSI-006.1 Deterministic L1 rules and dictionary format

buildFingerprintDictionary(metadata, config?) produces the exact JSON object
RsiFingerprintDictionary. On disk it is UTF8 JSON at private/fingerprints.json,
version1; entries sort by normalized value, questionIds/kinds sort lexically.
Normalize Unicode NFKC, lowercase, and remove nonletter/nondigit separators.
Reject empty/short fingerprints, digits-only values, values with <=2 distinct
characters and the explicit common-word set exported by the module. With >=4
questions, a value occurring in >=commonFingerprintRatio of distinct questions
is common and excluded. Duplicate inputs do not amplify rarity. Metadata IDs
must be unique. Minimum configurable normalized length is4 (default8).

scanDiff(diff,dictionary) reads unified Git patches: content scan only additions,
new-file line numbers from hunk headers; file structural findings use line0.
Both old and new paths (including rename/delete) are protected. Test paths and
*.test.*/*.spec.*, evaluators/graders/detectors/detection-rules, RSI rule files,
CI paths and configs reject. Lockfiles and dependency manifests produce hold
dependency_change, a specific exception to protected-path rejection. If the same
path is inside a protected test/detector/CI directory, reject still wins.
File-mode changes and symbolic links (including gitlinks, and edits that show the mode only on the `index` line) have distinct categories; binary patches
and unparseable structural paths fail closed. More than maxDiffLines changed
lines (additions+deletions) or maxDiffBytes UTF8 bytes rejects diff_too_large.

| Category | Severity / consequence |
|---|---|
| protected_path | reject |
| task_fingerprint | reject |
| opaque_blob | reject |
| dependency_change | hold, explicit human approval; dependency manifests/locks, files under `patches/`, `.npmrc`, `bunfig.toml` |
| binary_file | reject |
| diff_too_large | reject and split hypothesis |
| file_mode_change | hold, treated as dependency_change approval scope |
| symbolic_link | reject |

Added literal-like contiguous base64/hex strings >=32 encoded characters are
decoded once as UTF8 then normalized and rescanned; failed decoding is not proof
of safety. Contiguous encoded/data chunks >=opaqueMinLength also reject as opaque
blobs. Evidence is bounded to160 characters. Strings split by concatenation are
a known limitation. Literal decoding needs no Node Buffer or server dependency.

### RSI-002.1 Validation API

defaultRsiConfig():RsiConfig returns a fresh copy of all RSI-002 defaults.
validateRsiConfig/Task/Iteration/Evaluation/Run/Finding/Decision/Instruction/
QueueItem accept unknown and return their declared type or throw. Full entities
reject unknown/missing fields; projection is the separate allowlist boundary.
validateRsiLedgerEvent(unknown):RsiLedgerInput and
validateRsiLedgerEntry(unknown):RsiLedgerEntry validate full payloads and task
identity. Strings are bounded to65536 characters, arrays to100000 entries;
timestamps are parsed without reading the clock. StableFailRepeats minimum2.
Approval categories and ID arrays have no duplicates. Config ratios are fractions
in[0,1], except tokenGrowthMaxRatio may exceed1. Unknown token counts remain null.

### RSI-004.1 Pure function interfaces and reason codes

transitionIteration(state,event,context):RsiIterationState and
transitionTask(state,event,context):RsiTaskState use RSI-002 types.
calibrateNoiseBand(input:RsiNoiseInput):RsiNoiseResult;
decidePromotion(input:RsiPromotionInput):RsiPromotionResult;
isStableRegression(history:RsiStableHistory,stableWindow=3,stableFailRepeats=2):boolean;
selectParent(versions:RsiParentVersion[],delta:number,requestedParentId?:string|null):RsiParentVersion.
undefined parent means automatic; null explicitly selects baseline. All parents
must be in this task's supplied history; reject invalid/duplicate identities.
Gate reason codes: l0_reject,l1_reject,dependency_change,missing_monitor,
missing_adversarial,l3_suspicious,l4_suspicious,incomplete_comparison,
gain_not_above_noise,sealed_regression,stable_regression,token_growth.
Passing conditions have empty reasons. Conditions are always returned in order.

### RSI-009.1 HTTP DTOs, routes, authentication and queue semantics

This section defines future handlers only. All request JSON objects reject unknown
keys; UTF8 body limit65536 bytes. IDs follow RSI-002. GET list limit defaults50,
range1..200; cursor is the last returned entity ID (ASCII lexical ASC, exclusive),
null when exhausted. No hidden data ever enters an optimizer error body. All
responses are no-store. No HTTP request builds/runs code, evaluates, invokes a
model, starts a process, or changes the active iteration/task state synchronously.

DTO definitions (all fields required unless marked optional):

```ts
type RsiPage<T> = { items: T[]; nextCursor: string | null };
type RsiAccepted = { taskId: string; queueId: string; status: 'queued' };
type RsiTaskView = Omit<RsiTask, 'taskTokenHash'>;
type RsiCreateTaskRequest = {
  requestId: string; repository: string; baselineCommit: string;
  agentProfile: string; optimizerProfile: string; bank: string; subset?: 'small' | 'full'; config: RsiConfig;
};
type RsiCreateTaskResponse = RsiAccepted & { agentToken: string | null };
type RsiSubmitRequest = { requestId: string; commit: string; prd: RsiPrd };
type RsiStuckRequest = { requestId: string; reason: string };
type RsiHumanCommandRequest = { requestId: string; iterationId: string | null; command: RsiCommand };
type RsiBriefResponse = {
  task: NonNullable<ReturnType<typeof projectTaskForOptimizer>>;
  parent: { iterationId: string | null; commit: string; trainScore: number };
  instructions: NonNullable<ReturnType<typeof projectInstructionForOptimizer>>[];
  remainingTaskTokens: number; remainingIterations: number; lastIterationSeq: number; allowPaths: string[];
};
type RsiOptimizerResults = {
  iteration: NonNullable<ReturnType<typeof projectIterationForOptimizer>>;
  evaluations: NonNullable<ReturnType<typeof projectEvaluationForOptimizer>>[];
  runs: NonNullable<ReturnType<typeof projectRunForOptimizer>>[];
  findings: NonNullable<ReturnType<typeof projectFindingForOptimizer>>[];
  decisions: NonNullable<ReturnType<typeof projectDecisionForOptimizer>>[];
  quality: NonNullable<ReturnType<typeof projectQualityForOptimizer>> | null;
  nextCursor: string | null;
};
```

| Method and route | Request / response |
|---|---|
| GET /api/rsi/agent/brief | no body/query; 200 RsiBriefResponse, active task derived solely from bearer |
| GET /api/rsi/agent/iterations/:seq/results | seq positive; cursor/limit; 200 RsiOptimizerResults, pages by evaluation ID, safe runs for those evaluations; no results from other tasks |
| POST /api/rsi/agent/iterations | RsiSubmitRequest; 202 RsiAccepted; enqueue submit with the task's selected parent, no binary uploads or caller diff |
| POST /api/rsi/agent/stuck | RsiStuckRequest; 202 RsiAccepted; enqueue declare_stuck, no failure penalty |
| GET /api/rsi/tasks | cursor/limit; 200 RsiPage<RsiTaskView> |
| POST /api/rsi/tasks | RsiCreateTaskRequest; 202 RsiCreateTaskResponse |
| GET /api/rsi/tasks/:taskId | no body; 200 {task:RsiTaskView,head:RsiLedgerHead|null} |
| GET /api/rsi/tasks/:taskId/iterations | cursor/limit; 200 RsiPage<RsiIteration> |
| GET /api/rsi/tasks/:taskId/iterations/:seq | no body; 200 {iteration:RsiIteration} |
| GET /api/rsi/tasks/:taskId/evaluations | cursor/limit and optional phase:RsiPhase; 200 RsiPage<RsiEvaluation> |
| GET /api/rsi/tasks/:taskId/evaluations/:evaluationId/runs | cursor/limit; 200 RsiPage<RsiRun> |
| GET /api/rsi/tasks/:taskId/findings | cursor/limit and optional iterationId; 200 RsiPage<RsiFinding> |
| GET /api/rsi/tasks/:taskId/decisions | cursor/limit and optional iterationId; 200 RsiPage<RsiDecision> |
| GET /api/rsi/tasks/:taskId/instructions | cursor/limit; 200 RsiPage<RsiInstruction> |
| GET /api/rsi/tasks/:taskId/queue | cursor/limit; 200 RsiPage<RsiQueueItem> |
| POST /api/rsi/tasks/:taskId/commands | RsiHumanCommandRequest; 202 RsiAccepted |

Human commands are approve/reject/retry_review/retry_evaluation/pause/resume/stop/
rollback/instruction/set_budget/final/adopt. Approve names exact categories/reason;
rollback parentId null selects baseline; final/adopt require a promoted iteration,
and remain possible in completed tasks. Their iterationId must be nonnull; task
commands must use null. Worker owns evaluate/review materialization. Optimizer
cannot submit arbitrary RsiCommand objects or set actor/requestedBy/parent IDs.

Each task receives an independently generated 256-bit random bearer token; compare
SHA256(token) to taskTokenHash in constant time. Token has no global/page scope.
Human routes require a separate local token (Authorization Bearer) plus allowed
local Host/Origin policy. Never infer human privilege from remoteAddress/loopback.
Authenticated actor is assigned by the trusted entry point, not request JSON.
Tokens are never in query strings, logs, ledger, cache payloads or model prompts;
agentToken appears only in the initial local response, delivered securely to the
optimizer by the host. Creation reserves created task metadata and a start queue
command; this is durable queue setup, not execution. If the initial response is
lost, repeated acceptance returns agentToken=null without a recovered plaintext token;
token rotation is an explicit future human operation, outside P1 route scope.

requestId is the idempotency key within a task; reusing it for identical command
returns the original acceptance, changing its contents returns409 RSI_CONFLICT.
Queue command, requester, targets and creation time are immutable. Worker may
change queue execution state but not replace the command. Restart requeues running
work whose result is not in the ledger; completed ledger results are not rerun.
Budget-invalidated evaluations get a new evaluation ID on resume. An existing
final reservation retries its incomplete evaluation, never creates a second one.

The optimizer result projector resolves each run's phase from its trusted parent
evaluation, never from a caller-supplied phase. Filter final evaluation records
before pagination so their existence does not appear as an empty final page.
Max JSON response size=1048576 UTF8 bytes; overflow returns RSI_LIMIT without
truncating a record or leaking a private diagnostic. All non2xx use ApiError:

| HTTP | code | Meaning |
|---|---|---|
| 400 | RSI_INVALID_REQUEST | invalid field, query, ID, phase or configuration |
| 401 | RSI_AUTH_REQUIRED | absent/invalid bearer; static message |
| 403 | RSI_FORBIDDEN | wrong token scope, forbidden actor, Host/Origin failure |
| 404 | RSI_NOT_FOUND | task/iteration/evaluation absent or outside token scope |
| 409 | RSI_CONFLICT | idempotency collision, illegal transition, stale command |
| 409 | RSI_BUDGET_EXHAUSTED | request cannot start under remaining budget |
| 409 | RSI_FINAL_LOCKED | final already reserved/locked for this commit |
| 413 | RSI_LIMIT | body or response exceeds declared byte limit |
| 503 | RSI_BUSY | queue/ledger lock unavailable within timeout |
| 503 | RSI_LEDGER_INVALID | integrity/partial-tail/cache-rebuild failure |
| 500 | INTERNAL_ERROR | unexpected internal failure, no raw exception text |

Error `details`, when present, contains only `{reason:string}` drawn from the gate
reason codes or these static error names; never raw paths, evidence or scores.

### RSI-005.1 Exhaustive projection whitelist

Every projection accepts unknown input, drops unknown keys and returns null when
the required discriminator is invalid. Primitive whitelist fields are copied only
with valid type; no object spreading of external input. Empty optional metadata
is omitted, not synthesized as a successful result. No projection emits raw text
from monitor, test output, assertions, logs, artifacts or session paths.

| Input / stage | Allowed output fields |
|---|---|
| task / brief | id,state,mainMetric,delta,baselineTrainScore,sealedQueriesRemaining; config numeric fields except l1; instructions via instruction projection |
| iteration | id,seq,parentId,commit,state,trainScore; prd observation,hypothesis,changes,expectedImpact (optimizer-authored); hold categories only |
| evaluation smoke/train | id,phase,state,repetitions,passedCounts,score,infraErrorRatio |
| evaluation sealed | verdict: accept or reject only; pending returns null |
| evaluation final | null, entirely invisible |
| evaluation adversarial/ablation | phase,state only (no generated tests, scores or raw content) |
| run smoke/train | id,questionId,repetition,attempt,outcome,failureReason,durationMs,proxyTokens,at |
| run sealed/final/adversarial/ablation | null |
| finding L0/L1 | category,severity only; no fingerprint identity/evidence |
| finding L3/L4 | held:true,category only if severity hold; clean conclusion returns null |
| finding L2/L5 | null |
| decision | verdict only; no freeform reason or sealed gap |
| instruction | id,kind,text,effectiveFromSeq (human-authored optimizer instruction) |

Functions: projectTaskForOptimizer(value), projectIterationForOptimizer(value),
projectEvaluationForOptimizer(value), projectRunForOptimizer(value,phase),
projectFindingForOptimizer(value), projectDecisionForOptimizer(value),
projectInstructionForOptimizer(value). Return type is a fresh JSON object or null;
task projection requires valid config and nonnegative remaining budget. Run phase
must come from the trusted evaluation record, never an optimizer query parameter.

### RSI-008.3 Human final reservation

The first final evaluation snapshot must be queued, actor human. Queue items with
kind final/adopt also require requestedBy human. Subsequent execution snapshots
are worker events. A future HTTP handler queues the human's request; worker
materialization preserves human attribution for the reservation. One final
reservation per task+commit is permanent even when an attempt fails or is retried.

### RSI-008.1 Exact schema25 SQL

Each `entity_json` is the complete RSI-002 snapshot encoded with ledger canonical
JSON, never a substitute for optimizer projection. SQL columns are indexed copies:
`id`/`task_id` are entity/task IDs; `state`, `phase`, `kind`, `level`, `category`,
`verdict`, `outcome` copy the named enums; `commit_sha` copies `commit`;
`parent_id`, `iteration_id`, `evaluation_id`, `question_id` copy those references;
`seq` is the positive iteration or ledger ordinal; `repetition` is zero-based;
`attempt` is 0/1; `effective_from_seq` is the positive instruction activation
ordinal; `created_at`, `updated_at`, `at` are UTC timestamps. Nullable SQL
references match nullable runtime fields. All other columns are NOT NULL.
`rsi_heads.hash` is the trusted SHA256 at `seq`, written atomically with each
cached event. There is no row for an empty ledger.

```sql
CREATE TABLE IF NOT EXISTS rsi_tasks (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('created','calibrating','running','paused','needs_help','completed','stopped')),
  updated_at TEXT NOT NULL,
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json))
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_iterations (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq>0),
  parent_id TEXT,
  commit_sha TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('draft','submitted','precheck','training','reviewing','held','sealed','deciding','promoted','rejected')),
  created_at TEXT NOT NULL,
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  UNIQUE(task_id,seq),
  FOREIGN KEY(task_id,parent_id) REFERENCES rsi_iterations(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_evaluations (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  iteration_id TEXT,
  commit_sha TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('smoke','train','sealed','final','adversarial','ablation')),
  state TEXT NOT NULL CHECK(state IN ('queued','running','completed','infra_failed','invalidated')),
  created_at TEXT NOT NULL,
  ledger_seq INTEGER NOT NULL CHECK(ledger_seq>0),
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  FOREIGN KEY(task_id,iteration_id) REFERENCES rsi_iterations(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_runs (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  repetition INTEGER NOT NULL CHECK(repetition>=0),
  attempt INTEGER NOT NULL CHECK(attempt IN (0,1)),
  outcome TEXT NOT NULL CHECK(outcome IN ('pass','fail','infra_error')),
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  UNIQUE(task_id,evaluation_id,question_id,repetition,attempt),
  FOREIGN KEY(task_id,evaluation_id) REFERENCES rsi_evaluations(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_findings (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  iteration_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4','L5')),
  category TEXT NOT NULL,
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  FOREIGN KEY(task_id,iteration_id) REFERENCES rsi_iterations(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_decisions (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  iteration_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK(verdict IN ('promote','reject','hold','rollback')),
  at TEXT NOT NULL,
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  FOREIGN KEY(task_id,iteration_id) REFERENCES rsi_iterations(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_instructions (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  effective_from_seq INTEGER NOT NULL CHECK(effective_from_seq>0),
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_queue (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('submit','evaluate','review','final','adopt','intervene')),
  state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed')),
  iteration_id TEXT,
  evaluation_id TEXT,
  created_at TEXT NOT NULL,
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  FOREIGN KEY(task_id,iteration_id) REFERENCES rsi_iterations(task_id,id),
  FOREIGN KEY(task_id,evaluation_id) REFERENCES rsi_evaluations(task_id,id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_sessions (
  task_id TEXT NOT NULL REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq>0),
  state TEXT NOT NULL CHECK(state IN ('running','submitted','stuck','no_submission','timeout','interrupted')),
  entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
  PRIMARY KEY(task_id,id),
  UNIQUE(task_id,seq)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rsi_heads (
  task_id TEXT PRIMARY KEY REFERENCES rsi_tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK(seq>0),
  hash TEXT NOT NULL CHECK(length(hash)=64)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_rsi_tasks_state ON rsi_tasks(state,updated_at,id);
CREATE INDEX IF NOT EXISTS idx_rsi_iterations_state ON rsi_iterations(task_id,state,seq);
CREATE INDEX IF NOT EXISTS idx_rsi_evaluations_phase ON rsi_evaluations(task_id,iteration_id,phase,created_at,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rsi_final_commit ON rsi_evaluations(task_id,commit_sha) WHERE phase='final' AND state<>'invalidated';
CREATE INDEX IF NOT EXISTS idx_rsi_findings_iteration ON rsi_findings(task_id,iteration_id,level,id);
CREATE INDEX IF NOT EXISTS idx_rsi_decisions_iteration ON rsi_decisions(task_id,iteration_id,at,id);
CREATE INDEX IF NOT EXISTS idx_rsi_instructions_effective ON rsi_instructions(task_id,effective_from_seq,id);
CREATE INDEX IF NOT EXISTS idx_rsi_queue_state ON rsi_queue(state,created_at,task_id,id);
```

The run-slot UNIQUE index covers evaluation/question/repetition/attempt lookup.
Other automatic indexes are the declared PRIMARY KEY and UNIQUE constraints.
No RSI table references or rewrites native session/event tables.

### RSI-008.2 Explicit column constants and storage API

```ts
RSI_TASK_COLS = 'id, state, updated_at, entity_json';
RSI_ITERATION_COLS = 'task_id, id, seq, parent_id, commit_sha, state, created_at, entity_json';
RSI_EVALUATION_COLS = 'task_id, id, iteration_id, commit_sha, phase, state, created_at, ledger_seq, entity_json';
RSI_RUN_COLS = 'task_id, id, evaluation_id, question_id, repetition, attempt, outcome, entity_json';
RSI_FINDING_COLS = 'task_id, id, iteration_id, level, category, entity_json';
RSI_DECISION_COLS = 'task_id, id, iteration_id, verdict, at, entity_json';
RSI_INSTRUCTION_COLS = 'task_id, id, effective_from_seq, entity_json';
RSI_QUEUE_COLS = 'task_id, id, kind, state, iteration_id, evaluation_id, created_at, entity_json';
RSI_SESSION_COLS = 'task_id, id, seq, state, entity_json';
RSI_HEAD_COLS = 'task_id, seq, hash';
```

`schema.ts` exports `RSI_SCHEMA_SQL`; fresh creation and the `fromVersion < 25`
branch create all ten tables/eight explicit indexes and publish schema_version25
in one transaction. Repeated initialization is idempotent. No existing native
rows, scanners or versioned metrics are rewritten.

`applyRsiLedgerEntry(db, entry): void` validates the typed entry and hash, then
atomically upserts the entity snapshot and advances its task's head. Only the
same current seq/hash is an idempotent replay; gaps, forks, old sequences and
cross-task payloads are rejected. Immutable run/finding/decision/instruction
snapshots cannot be replaced; iteration identity/parent/commit and first nonnull
trainScore are frozen, and terminal iterations cannot be rewritten. Evaluation
identity/commit/question set/repetitions are frozen; completed/locked evaluations
and their runs cannot be rewritten. Every final (task,commit) is reserved from
its first queued snapshot, including across iterations and cache rebuilding.
References must exist in the same task. A run must belong to a planned question
and repetition; attempt1 requires a prior attempt0 infra_error.

`getRsiLedgerHead(db, taskId): RsiLedgerHead | null` reads explicit cached columns.
`rebuildRsiIndexFromLedger(db, taskId, ledgerPath): Promise<void>` verifies once,
streaming complete events into private staging SQLite, with the current cached
head as a trusted prefix anchor. A partial tail, invalid chain, invalid entity,
violated invariant or changed live cache head aborts without replacing any rows.
After verification, all ten tables for that task are replaced in one synchronous
transaction; other tasks/native tables are preserved. Staging contains only the
latest entity snapshots, not an in-memory copy of the ledger. All read/write
statements are prepared and cached outside replay loops. Concurrent writers that
observe an apply sequence conflict recover by replay; they never skip events.
Without a surviving trusted head, valid-prefix tail truncation cannot be proven.

### RSI-007.1 Ledger API and verification report

Exports from `server/rsi/ledger.ts` (all file operations are asynchronous):

```ts
const RSI_LEDGER_GENESIS_HASH: string; // 64 zeroes, empty trusted head hash
const RSI_LEDGER_DEFAULTS = {lockStaleMs:60000,lockTimeoutMs:10000,lockRetryMs:10,maxLineBytes:1048576};
type LedgerIssueCode = 'invalid_json' | 'invalid_entry' | 'non_canonical'
 | 'sequence_mismatch' | 'prev_hash_mismatch' | 'hash_mismatch' | 'task_mismatch'
 | 'anchor_mismatch' | 'tail_truncated' | 'partial_tail' | 'line_too_large';
interface LedgerIssue { code: LedgerIssueCode; line: number }
interface LedgerPartialTail { line: number; byteLength: number }
interface LedgerVerification {
 valid:boolean; head:RsiLedgerHead; entryCount:number; issues:LedgerIssue[];
 partialTail:LedgerPartialTail|null; anchored:boolean; tampered:boolean;
}
interface VerifyLedgerOptions {
 taskId?:string; expectedHead?:RsiLedgerHead; maxLineBytes?:number;
 onEntry?:(entry:RsiLedgerEntry)=>void|Promise<void>;
}
interface AppendLedgerOptions {
 expectedHead?:RsiLedgerHead; lockStaleMs?:number; lockTimeoutMs?:number;
 lockRetryMs?:number; maxLineBytes?:number;
}
type UnsignedLedgerEntry = RsiLedgerInput & {version:1;seq:number;prevHash:string};
function canonicalJson(value:unknown):string;
function computeLedgerHash(entry:UnsignedLedgerEntry):string;
function verifyLedger(path:string,options?:VerifyLedgerOptions):Promise<LedgerVerification>;
function appendLedger(path:string,input:RsiLedgerInput,options?:AppendLedgerOptions):Promise<RsiLedgerEntry>;
class LedgerIntegrityError extends Error { readonly verification:LedgerVerification }
```

`head` is the last verified full record, or seq0/genesis. entryCount counts verified
records. `line` is one-based physical JSONL line, `byteLength` is trailing raw UTF8
bytes. No incomplete body/raw content is returned. `anchored` explicitly reports
whether a trusted DB head was supplied; without one valid prefix truncation cannot
be detected. `tampered` means a structural/hash/anchor integrity failure (not proof
of malicious intent); lone partial_tail leaves tampered=false, valid=false.
Unknown FS and callback errors reject instead of being mislabeled as corruption.
Only the first structural error is needed to fail verification. expectedHead is a
trusted prefix, not a CAS latest-head expectation: newer valid entries are allowed.
Callbacks receive each verified complete entry in order; a caller MUST stage their
effects and commit only after the returned report is valid. A callback throwing
rejects the operation. append rejects any invalid report, including partial tail,
and never removes bytes or attempts a recovery write. Inputs are snapshotted before
queue waits so caller mutation cannot alter a queued record.

The exact serialized line must equal canonicalJson(parsedRecord), so even changed
whitespace/key order is detected. Canonicalization maximum nesting depth is64;
JSON values only, no accessors/symbol keys/nonenumerable object fields/array extra
properties. UTF8 read chunk size is65536 bytes and max line size excludes trailing
LF. Text decoding rejects invalid UTF8. Empty lines, CRLF, BOM and unterminated
last JSON objects are not accepted as complete canonical records.

Lock JSON: `{version:1,pid:number,owner:string,createdAt:string}`. version=1;
pid positive safe process identifier; owner random UUID ownership token;
createdAt canonical UTC. Primary path is `ledger.jsonl.lock`, recovery guard path
is **`ledger.jsonl.lock.reclaim`**. A lock must be older than lockStaleMs by both
creation time and filesystem mtime, and its PID must be known dead (ESRCH), to be
reclaimed. Live owners and EPERM/unknown owners are never stolen. Recovery guard
is O_EXCL; after acquiring it the main lock is reread to prevent a second
reclaimer unlinking a new owner's lock. Malformed/partial locks and abandoned
recovery guards require explicit operator recovery; waiting times out rather than
breaking exclusivity. Lock records are bounded to4096 bytes. Release verifies the
held file descriptor's device/inode identity; lock contents are not mutable leases.
Parent task directories use0700, newly created ledger/lock files0600. append fsyncs
the ledger and parent directory before returning. Normal failed writes propagate
and may leave a reported partial tail. No hash chain can authenticate a writer
that can rewrite both ledger and trusted head.

verify reads a regular-file snapshot bounded by the opened descriptor's initial
size; later concurrent appends are not included in that pass. The trusted anchor
is also snapshotted before callbacks. Rebuilders must compare-and-swap the live
cache head before committing a staged snapshot so a concurrent incremental index
update is never rolled back.

### RSI-003.1 Iteration transitions (24 rows)

`transitionIteration(state,event,context)` returns only the next state. The caller
records the transition, supplied reason, holds, approvals and resume point as an
immutable ledger-backed update. An event is a worker assertion of a completed
check, never an instruction for this pure function to execute one. Actor and all
guards must match. Empty/whitespace reasons fail. Unless explicitly allowed,
a pass event must have no holdReasons. Rejected and promoted records have no
outgoing transitions: the next attempt is a new iteration, not a state reset.

| Row | From | Event | Actor | To | Additional guards |
| --- | --- | --- | --- | --- | --- |
| I01 | draft | submit | optimizer | submitted | PRD/commit validated before this event |
| I02 | submitted | start_precheck | worker | precheck | — |
| I03 | precheck | precheck_pass | worker | training | no holds |
| I04 | precheck | precheck_reject | worker | rejected | reason |
| I05 | precheck | precheck_hold | worker | held | reason; only dependency_change; resumeState=training |
| I06 | training | training_pass | worker | reviewing | no holds |
| I07 | training | training_reject | worker | rejected | reason |
| I08 | training | training_hold | worker | held | reason; only incomplete_comparison; resumeState=training |
| I09 | reviewing | review_pass | worker | sealed | no holds; sealedBudgetRemaining is a positive safe integer |
| I10 | reviewing | review_hold | worker | held | reason; nonempty subset of review hold reasons; resumeState=sealed |
| I11 | reviewing | review_hold | monitor | held | same as I10 |
| I12 | sealed | sealed_accept | worker | deciding | no holds; hasSealedResult=true |
| I13 | sealed | sealed_reject | worker | rejected | reason |
| I14 | sealed | sealed_hold | worker | held | reason; only incomplete_comparison; resumeState=sealed |
| I15 | deciding | promotion_pass | worker | promoted | no holds; hasSealedResult=true; worker obtained promote from decidePromotion |
| I16 | deciding | promotion_reject | worker | rejected | reason |
| I17 | deciding | promotion_hold | worker | held | reason; either token_growth with resumeState=deciding and hasSealedResult=true, or incomplete_comparison with resumeState=training/sealed |
| I18 | held | approve | human | training | reason; only dependency_change; exact matching approvedCategories; resumeState=training |
| I19 | held | approve | human | sealed | reason; nonempty subset of l3_suspicious/l4_suspicious; exact matching approvedCategories; resumeState=sealed; positive sealedBudgetRemaining |
| I20 | held | approve | human | deciding | reason; only token_growth; exact matching approvedCategories; resumeState=deciding; hasSealedResult=true |
| I21 | held | reject | human | rejected | reason |
| I22 | held | retry_review | human | reviewing | reason; nonempty subset of review hold reasons containing missing_monitor or missing_adversarial |
| I23 | held | retry_evaluation | human | training | reason; only incomplete_comparison; resumeState=training |
| I24 | held | retry_evaluation | human | sealed | reason; only incomplete_comparison; resumeState=sealed |

Review hold reasons are missing_monitor, missing_adversarial, l3_suspicious,
l4_suspicious. Hold/category arrays are unique, never multisets. Exact approval
means identical hold/category sets, containing only approvable categories. Retry
review repeats missing review work; it never converts a missing result into a
clean result. Retained suspicious findings remain blocking unless explicitly
approved, even if a later review summary is clean. A dependency approval returns
to training, so it cannot skip training or reviews. I20 reuses sealed evidence;
I24 reuses the already reserved sealed query group. Neither requires or consumes
a new sealed query. Budget reservation/consumption itself is a ledger-backed
worker operation, outside the state-only reducer.

### RSI-003.2 Task transitions (29 rows)

`transitionTask(state,event,context)` returns the next task state. The caller
persists the corresponding pauseReason, invalidates in-flight evaluations on
budget exhaustion, and controls scheduling. budgetAvailable is true only after
checking iteration/token limits and, when recovering sealed-budget exhaustion,
the newly available sealed budget. calibrationComplete certifies both baseline
train noise calibration and baseline sealed results. targetReached certifies a
promoted version's frozen train score reaches the configured target.

| Row | From | Event | Actor | To | Guards |
| --- | --- | --- | --- | --- | --- |
| T01 | created | start | worker | calibrating | budgetAvailable=true |
| T02 | calibrating | calibrated | worker | running | budgetAvailable=true; calibrationComplete=true |
| T03 | created | pause | human | paused | reason |
| T04 | calibrating | pause | human | paused | reason |
| T05 | running | pause | human | paused | reason |
| T06 | needs_help | pause | human | paused | reason |
| T07 | paused | resume | human | running | reason; budgetAvailable=true; calibrationComplete=true; targetReached is not true |
| T08 | paused | resume | human | calibrating | reason; budgetAvailable=true; calibrationComplete=false; targetReached is not true |
| T09 | needs_help | resume | human | running | reason; budgetAvailable=true; calibrationComplete=true |
| T10 | needs_help | resume | human | calibrating | reason; budgetAvailable=true; calibrationComplete=false |
| T11 | running | declare_stuck | optimizer | needs_help | reason |
| T12 | running | sealed_budget_exhausted | worker | needs_help | reason |
| T13 | calibrating | budget_exhausted | worker | paused | reason |
| T14 | running | budget_exhausted | worker | paused | reason |
| T15 | calibrating | infra_failed | worker | paused | reason |
| T16 | running | infra_failed | worker | paused | reason |
| T17 | calibrating | incomplete_comparison | worker | paused | reason |
| T18 | running | incomplete_comparison | worker | paused | reason |
| T19 | running | target_reached | worker | completed | targetReached=true |
| T20 | created | stop | human | stopped | reason |
| T21 | calibrating | stop | human | stopped | reason |
| T22 | running | stop | human | stopped | reason |
| T23 | paused | stop | human | stopped | reason |
| T24 | needs_help | stop | human | stopped | reason |
| T25 | completed | stop | human | stopped | reason |
| T26 | completed | budget_exhausted | worker | paused | reason |
| T27 | completed | infra_failed | worker | paused | reason |
| T28 | completed | incomplete_comparison | worker | paused | reason |
| T29 | paused | resume | human | completed | reason; budgetAvailable=true; calibrationComplete=true; targetReached=true |

Unlisted triples or failed guards throw RsiTransitionError with string properties
state,event,actor and a message containing all three. stopped is terminal;
completed permits human stop or worker pause for final-work budget/infrastructure failure. Final evaluation and
adoption from completed are separate queued commands, not automatic scheduling
and not task-state transitions.

### RSI-004.2 Pure API and additional input invariants

- calibrateNoiseBand(input:RsiNoiseInput):RsiNoiseResult. Planned IDs are nonempty
  and unique; each repetition contains at most one final result for each planned
  question. Unplanned/duplicate questions and invalid outcomes throw. Missing
  records yield incomplete_comparison without inventing infra_error slots.
  More than one result for an infrastructure retry must be resolved to its final
  outcome by the caller; double counting is rejected. infraErrorMaxRatio is in
  [0,1], R>=2, and the planned set is nonempty.
- decidePromotion(input:RsiPromotionInput):RsiPromotionResult. Scores/delta/token
  means are finite nonnegative values; comparison completeness is explicit;
  token/stability question IDs are unique. Findings from another iteration throw.
  Every L0 finding rejects. Every L1 finding rejects except dependency_change and
  file_mode_change, which both map to dependency_change hold regardless of an
  untrusted severity downgrade. Symbolic links remain hard rejection. Retained
  L3/L4 suspicious findings cause their corresponding holds even if a review
  summary says clean. Approval requires matching iterationId/commit, nonempty
  reason, a unique nonempty subset of the four permitted categories and a valid
  canonical millisecond ISO UTC at string. Invalid approvals do not discharge
  a hold. All five condition results are returned; pass reasons is [].
- isStableRegression(history:RsiStableHistory,stableWindow=3,stableFailRepeats=2):
  boolean. stableWindow is a positive safe integer; stableFailRepeats is a safe
  integer >=2. Both arrays are chronological. Invalid outcomes throw.
- selectParent(versions:RsiParentVersion[],delta:number,requestedParentId?:string|
  null):RsiParentVersion. undefined selects automatically, null explicitly picks
  baseline. All IDs/sequences must be unique; baseline alone has null ID/seq0,
  ordinary versions have positive sequences and nonnull IDs. Only baseline and
  promoted versions are eligible, including explicit manual selection. Empty
  eligible sets and unavailable/ineligible rollback targets throw. Returned
  object is a fresh copy; input order never determines recency.

Gate reason codes are l0_reject,l1_reject,dependency_change,missing_monitor,
missing_adversarial,l3_suspicious,l4_suspicious,incomplete_comparison,
gain_not_above_noise,sealed_regression,stable_regression,token_growth.

### RSI-008.4 Cache authorization and frozen task identity

Snapshot actors come from authenticated trusted ingress/worker attribution, never
from optimizer-supplied JSON. A new queue record's ledger actor must equal its
requestedBy; only worker may write its later execution-state snapshots. Queue
kind, references, requestedBy, command, reason and createdAt are immutable; only
state/updatedAt may change. This permits optimizer declare_stuck while preventing
forged human commands or replacement of a queued command during a status update.
Decision snapshot actor must equal the ledger actor. Instructions require human.

Task repository, baselineCommit, datasetHash, mainMetric, taskTokenHash and
createdAt are immutable; changing these requires a new task, so calibration is
not silently reused under another identity. sealedQueriesUsed, tokenUsage and
iterationCount are monotonic and never decrease. Only a human-attributed task
snapshot may change config; all counters remain intact across that change.

Iteration parents must be promoted records in the same task with smaller seq;
null identifies baseline. Evaluation commit must match its iteration or baseline.
Final evaluation creation requires a human-attributed queued snapshot; subsequent
execution/results can be worker-attributed. The human attribution on first
materialization records who requested the final run, not who executed it.

Evaluation cache ledger_seq is the last snapshot ledger ordinal while unfinished,
and the immutable completion ordinal after completed/infra_failed. An identical
terminal snapshot cannot change that ordinal. First valid completed training
results are selected by this ordinal, never a caller-controlled timestamp.

### RSI-003.3 Snapshot transition validation

validateIterationSnapshotTransition(before:RsiIteration|null,after:RsiIteration,
context:RsiIterationContext):void and validateTaskSnapshotTransition(
before:RsiTask|null,after:RsiTask,context:RsiTaskContext):void infer the matching
event from state snapshots, then enforce the same transition table and guards.
First snapshots must be draft/created. Same-state metadata updates are separately
authorized by storage. Cache callers derive sealed completeness, budget and target
truth from retained records, never from submitted queue body fields.

Queue authorization is an exact action allowlist: submit/declare_stuck require
optimizer; evaluate/review require worker; all other declared actions require
human. evaluate cannot use final phase as a shortcut around human reservation.
The selected evaluation, iteration, commit and phase must describe the same
recorded work. Queue command payloads are executable requests, not arbitrary JSON.

Finding category review_clean is an affirmative L3/L4 review record: source=monitor,
severity=info, bound to the immutable iteration identity. It is not an optimizer
visible conclusion. Suspicious records remain blocking until approved even if a
later review_clean exists. The trusted worker assembles gate inputs from retained
reviews and evaluations; the cache state guard is not itself a monitor or worker.

Candidate train evaluation repetitions is always1; stable confirmation creates
additional single-repeat evaluations whose results cannot replace first trainScore.
Baseline train repetitions is at least2 and equals task.config.noiseRepeats.
All arithmetic means use sum(values)/values.length, without intermediate rounding.
Per-question mean proxy token inputs cannot exceed Number.MAX_SAFE_INTEGER.

### RSI-010.1 Additional fixed limits and implementation defaults

L1 common values are the exact RSI_COMMON_FINGERPRINTS list in the pure module;
frequency filtering activates at4 independent questions. Decode minimum32 encoded
characters, evidence cap160 characters. Digits-only/short/common expected answers
are intentionally excluded; a standalone generic numeric answer without another
fingerprint cannot be identified reliably by L1. Normalization treats literal
concatenation boundaries separately and does not evaluate expressions.

Additional runtime limits: ID128 ASCII characters, text65536 characters, array
100000 entries, canonical JSON depth64, ledger line1048576 bytes, stream chunk
65536 bytes, lock record4096 bytes, task directory0700, new files0600. API contracts
use body65536 bytes, response1048576 bytes, pagination50/default and200/maximum,
and256-bit bearer secrets. These are P1 implementation choices, not measurements.

Review ordering follows the explicit state diagram and author decision: monitor
and adversarial review precede sealed evaluation. This supersedes the opposite
ordering in the introductory anti-cheating paragraph. Missing/suspicious reviews
still hold even if monitor calibration suggests an alert-only downgrade; P1 does
not implement that downgrade. The task-budget stopped suggestion is superseded by
paused/budget_exhausted. Specific dependency/lockfile human review supersedes the
generic statement that every L1 finding rejects.

A nonnull sealedVerdict requires a completed evaluation, infraErrorRatio=0 and
a nonnull score. Sealed projection otherwise returns null even if a malformed
input contains accept/reject. It never presents an infrastructure failure as
an accepted sealed comparison.

Final reservation persists logically across budget invalidation: the first human
request reserves (taskId,commit) permanently. The unique index excludes invalidated
attempts solely to allow automatic worker recovery after task-budget interruption.
A repeated human trigger is rejected even if every prior attempt was invalidated.
Only worker may create a fresh queued evaluation ID after the latest final attempt
was invalidated, with identical iteration/commit/questionIds/repetitions and no
active/completed replacement. This continues the original human reservation; old
runs and invalidated snapshots remain retained and unscored. Completed final
results, including recorded infrastructure outcomes, never become a new trigger.

Completed tasks can still have explicitly requested final work in progress. Worker
budget_exhausted/infra_failed/incomplete_comparison therefore may pause completed
tasks. Human resume with calibrationComplete,targetReached,budgetAvailable true
returns to completed, never restarts optimization. The task table has29 rows
after these four final-work recovery edges.

### RSI-003.4 Snapshot inference rules

`validateIterationSnapshotTransition(before:RsiIteration|null, after:RsiIteration,
context:RsiIterationContext):void` and
`validateTaskSnapshotTransition(before:RsiTask|null, after:RsiTask,
context:RsiTaskContext):void` make cache replay apply the same legal edges and
guards as direct transitions. These are pure functions, not additional workflow
states or execution entry points. A null before means first creation: only draft
iterations / created tasks are allowed. For same-state updates they return without
checking metadata; the storage layer remains responsible for authorization,
identity, counters, immutable fields and approval append-only rules.

For changed iteration states, infer the RSI-003.1 event from the source/destination
edge. Exiting held toward training/sealed is retry_evaluation exactly when the
persisted old hold reasons contain incomplete_comparison; otherwise it is approve.
Held to reviewing means retry_review; held to deciding means approve; held to
rejected means reject. Existing reducers then validate the actual reason set,
actor, approval categories and resume point. Context cannot substitute a false
hold reason: when leaving held, use before.holdReasons/resumeState; when entering,
use after.holdReasons/resumeState; otherwise use after.holdReasons.

For changed task states, infer pause vs infra/budget pause from after.pauseReason;
needs_help means declare_stuck only for optimizer or sealed_budget_exhausted for
worker. Other inferred events are start, calibrated, resume, target_reached and
stop. The original reducer must return exactly the requested destination, so a
resume with calibrationComplete=false cannot claim a running snapshot.

Neither helper invents a human reason or trusts stored scalar scores as proof of
completed evaluations. The caller supplies context.reason/approvedCategories and
cross-record truth for available budgets, calibrationComplete, targetReached and
hasSealedResult. Storage derives those from validated records; same-state metadata
validation is not permission to inject approvals or alter frozen scores. Unlisted
edges and failed guards throw RsiTransitionError, including source state and event
(or snapshot:<destination> when no valid event can be inferred).

### RSI-004.3 Arithmetic consistency

Every arithmetic passed-count mean uses sum(passedCounts)/repetitionCount, without
rounding; calibration and persisted evaluation summaries use the same operation
order. Token comparison uses sum(per-question means)/comparableQuestionCount.
Each token mean is finite, nonnegative and <= Number.MAX_SAFE_INTEGER, since it is
derived from safe-integer proxy token counts. Reject larger values before summing;
never let arithmetic overflow silently turn an excessive token increase into pass.

All L3/L4 findings, including specific categories such as task_fingerprint,
remain suspicious except an explicit review_clean/source monitor/severity info
record. A generic clean status cannot erase those retained findings.

### RSI-008.5 Snapshot boundary, evidence and recovery invariants

The cache calls validateTaskSnapshotTransition and
validateIterationSnapshotTransition for every task/iteration snapshot. First
snapshots are created/draft with no measurements/approvals/package. All subsequent
state changes follow the same actor/guard transition tables; metadata updates do
not bypass state checks. Held reasons/resumeState cannot be replaced while staying
held. Existing approvals are append-only and immutable; exactly one new approval
may be appended by human when leaving held, and its categories must exactly match
all current held reasons. Worker/optimizer cannot manufacture approvals.

Only worker can first assign task calibration fields or iteration trainScore,
sealedScore and packageSha256. Once nonnull all these fields are immutable.
Baseline train repetitions must equal task.config.noiseRepeats. Baseline train
score/delta are verified against the first valid completed baseline train record
and its final per-question runs, using calibrateNoiseBand; baseline sealed score
must match a valid completed baseline sealed record. Candidate train/sealed scores
must match the first valid completed evaluation of their respective phase, ordered
by ledger completion sequence, never by caller-supplied timestamps or IDs.
Evaluation cache ledger_seq tracks the latest snapshot only while unfinished;
terminal completed/infra_failed/invalidated records retain their original terminal
sequence even when an identical snapshot appears again at a later ledger sequence.

Every evaluation starts queued. Ordinary evaluation snapshots and all run records
are worker-attributed; first final creation preserves human request attribution.
Completed/infra_failed summaries require final run evidence for every planned
(question,repetition) slot. A slot uses attempt0 unless it is infra_error, in which
case attempt1 is required and is the sole scored result. Counts per repetition,
remaining infra ratio and mean score must exactly match those runs. A ratio above
config.infraErrorMaxRatio requires infra_failed; otherwise completed is allowed,
but any remaining infra_error keeps score null. Terminal evaluations and their
run evidence are immutable. Invalidated evaluations are never usable for scoring
and cannot be revived in place; recovery uses a new evaluation ID.

Invalidation requires a recorded task pause with budget_exhausted. A budget pause
requires recorded tokenUsage >= maxTaskTokens or iterationCount >= maxIterations.
Task pauses/invalidation/resumption remain explicit ledger events; indexing does
not invent those events or invoke a worker. Derived transition guards use actual
budget counters, actual calibration evidence and actual promoted train scores.
Completed tasks can budget-pause during final work and resume to completed,
without resuming optimization scheduling.

Before the first candidate sealed group is queued, sealedQueriesUsed must already
cover the count of distinct candidate iteration IDs with sealed groups plus that
new candidate. Baseline sealed evaluations are exempt. An existing same-candidate
group retains its reservation, so retry does not deduct/refund again. Its commit,
questionIds and repetitions are fixed. Another evaluation cannot be created while
that group has a queued/running evaluation or a valid completed sealed result;
only invalidated, infra_failed or incomplete results can be retried. A reserved
last budget slot counts as available for that group's transition into sealed.
Late token approval always reuses the immutable completed result.

Final/adopt queue commands require an existing promoted iteration. Queue evaluation
references must belong to the exact same iteration (null baseline matches null),
and evaluate command phase/commit must match the referenced evaluation. Final
queue references, when present, must be final-phase evaluations.

The first final evaluation for (task,commit) requires human and a promoted
iteration. Any later human trigger is rejected, including after invalidation.
The partial unique index excludes invalidated rows solely to retain interrupted
attempts while resuming the original logical reservation. Worker may create a new
queued final evaluation only when all earlier records for that commit are
invalidated, the task has resumed with available budget, and iteration/commit/
questionIds/repetitions exactly match the original reservation. Completed or
infra_failed final records cannot be restarted. Results already locked by a
completed final evaluation remain permanent across cache rebuilding.

Promotion-pass events remain trusted worker attestations: the worker MUST call
decidePromotion and retain the required review evidence before advancing the
state. Cache validation verifies legal edges, attribution and underlying score
records; it does not execute evaluations or replace the promotion engine.
Non-approval human transition reasons are supplied through the separately
ledger-backed command/decision before the worker materializes the state snapshot;
the cache's inferred-edge diagnostic reason is not that human audit reason.

## RSI-011 Question bank layout (P2/P3 interface)

Added 2026-11-07 by the design author so the executor (P2) and the bank (P3) can be
built in parallel. `rsi-bank/` lives at the repository root, is not in package
`files`, and is never mounted into an optimizer container. `server/rsi/bank.ts` is
the only runtime reader.

```text
rsi-bank/
  manifest.json
  tasks/<questionId>/
    meta.json
    statement.md
    repo/            # task snapshot without .git; the original, failing code
    hidden_tests/    # overlaid onto repo/ by the evaluator, paths relative to the repo root
    reference.patch  # git diff relative to repo/, never shown to the target agent
```

```ts
type RsiBankToolchain = 'node' | 'python' | 'go';
type RsiBankReport = 'node-test-events' | 'unittest-json' | 'go-test-json';
interface RsiBankQuestion extends RsiQuestionMetadata {
  version: 1;
  language: 'javascript' | 'typescript' | 'python' | 'go';
  difficulty: 'easy' | 'medium' | 'hard';
  toolchain: RsiBankToolchain;
  testTargets: string[];   // repo-relative paths or Go package patterns; the executor builds the argv per report
  report: RsiBankReport;
  expectedTests: number;   // exact count; a different count is infra_error, never pass
  timeoutSeconds: number;  // evaluator test timeout; exceeding it is fail
}
interface RsiBankManifest {
  version: 1;
  seed: string;
  mutationKillMin: number;
  sets: { smoke: string[]; train: string[]; sealed: string[]; final: string[] };
  questions: { id: string; language: RsiBankQuestion['language']; difficulty: RsiBankQuestion['difficulty']; mutationKillRatio: number }[];
}
```

Invariants: smoke is a subset of train; train, sealed and final are pairwise disjoint;
each set covers at least three languages except smoke; `questionId` matches its
directory. `statement.md` must contain neither the question ID, the repository name,
nor any hidden test name or expected value. Reports are produced by trusted reporters
owned by the executor, not by the question: a reporter's output is the only source of
pass and fail. The fingerprint dictionary is built from `meta.json` with
`buildFingerprintDictionary` when a tuning task is created, and is stored under the
task's `private/`.

Known limitation: the candidate patch and the hidden tests run in one evaluator
container, so a patch can in principle interfere with the test framework. Exact test
counts and trusted reporters reduce this but do not eliminate it. L1 rejection
categories are also a low-bandwidth oracle: an optimizer can learn whether a guessed
string is in the dictionary by submitting it, at the cost of one iteration each.

## RSI-012 Worker and trusted local CLI (M13 / P2)

This additive P2 section implements containers and local commands; it does not
change the P1 entity types, HTTP contract or public application. No HTTP execution,
optimizer upload, monitor Agent, automatic merge or production bank ships here.

### Entry, state and persistence

`rsi worker --execute --task <id> [--root <configRoot>]` is the only production
entry that builds images or creates/starts containers. Without `--execute`, it
verifies/rebuilds the cache and prints the intended work; no Docker invocation.
A worker drains available work then exits when idle, held or paused. Default
ReviewProvider returns missing for both required reviews. Only a trusted test
harness may inject a fake ReviewProvider; there is no clean-review CLI flag.
The harness can inject an after-run crash barrier after fsynced run evidence.

CLI commands are `task create`, `task status`, `iteration submit`, `worker`,
`ledger verify`, `ledger recover`. `task command` additionally accepts a local
human JSON command for approve/reject/retry_review/retry_evaluation/pause/resume/
stop/set_budget/final. HTTP, rollback/adoption, instruction management and optimizer
access remain later-phase work. All commands select `--task <id>` and optional
`--root <configRoot>` (default current working directory). Data lives under
`<configRoot>/awesome-telemetry-data/rsi/`; the shared rebuildable `index.db` lives
there. Creation flags: `--repository <local-path> --baseline <full-commit>
--bank <bank-path> [--config <RsiConfig-json>] [--settings <WorkerSettings-json>]`.
Submit flags: `--commit <full-commit> --prd <RsiPrd-json> --request <id>`.
Human commands use `--command <RsiCommand-json> --request <id>` and, for iteration
commands, `--iteration <id>`. `--docker-context <name>` is worker-only in effect.
Task creation returns the newly generated bearer once; it is never written to a
file, log or ledger. Status is human-only and omits taskTokenHash.

Every snapshot is storage-validated in a rolled-back transaction, appended and
fsynced to the ledger, then applied to the cache. Task/iteration state changes call
rsi-state-machine. Noise calls calibrateNoiseBand. Gate conditions, including early
training and sealed checks, come from decidePromotion. Smoke requires candidate passed count >= smokeFloor, where smokeFloor is the
number of smoke questions passed in every baseline calibration repetition
(design author decision, 2026-11-07); otherwise train/reviews/sealed are prevented. No scores are chosen
from confirmations. Submissions count toward iterationCount when materialized;
reaching either task budget pauses and invalidates unfinished evaluations. Human
budget increase and resume create fresh evaluation IDs; old evidence remains.

A per-task worker O_EXCL lock prevents two executors from cleaning each other's
resources. A separate short writer lock serializes trusted CLI/worker writes;
known-dead owners may be reclaimed under a second O_EXCL guard. Partial/malformed
locks fail closed. These locks do not replace ledger.jsonl.lock and its RSI-007
ownership/staleness rules. No periodic task daemon or polling HTTP handler exists.

### Bank identity and private inputs

bank.ts is the sole runtime reader of question-bank contents. It validates RSI-011
fields, safe argv/path targets, split membership, language coverage, toolchain/
report compatibility, mutation qualification and statement secrecy. Go `.` and
`./...` package targets are allowed. The datasetHash is SHA256 over all sorted bank
files: for each file hash canonicalJSON([repoRelativePath,byteLength]), then its
raw bytes. Creation freezes a copy at private/bank and fingerprints at
private/fingerprints.json; startup rehashes the copy before execution. No hidden
content or reference patch enters a target container. Baseline is one ancestor
version: disagreement across its calibration repetitions breaks a stable pass
window instead of manufacturing multiple ancestor versions.

### Trusted source build and dependency exception (approved 2026-11-07)

The platform clones a local bare repository without hardlinks, disables hooks,
imports full commits with no submodules/tags, computes the parent-to-candidate
Git diff itself, then runs L1 before any candidate build. No uploaded binary or
caller-supplied diff is accepted. Sources come from git archive. Existing source
symlinks are materialized only from targets inside the archive, never host paths;
new/modified symlink diffs still reject under unchanged L1 rules. Source archives
are capped at256MiB (the P0 fixed source is approximately139MiB); question/session
archives are capped at64MiB. Temporary contexts are removed after builds. Bounded build logs are retained in
private/build. Recognizable source syntax/module compilation errors become a
retained L0 rejection through the gate; daemon, deadline, output limit, permissions,
IO/network and unknown build failures pause as infrastructure errors.

The networked dependency layer receives only root/workspace package.json files,
lockfiles, and dependency patches referenced by those manifests/locks. Lifecycle
scripts are disabled with `bun install --frozen-lockfile --ignore-scripts`.
Candidate `.npmrc` and `bunfig.toml` NEVER enter that layer; registry is fixed in
the trusted Dockerfile to https://registry.npmjs.org. The dependency context hash
and Docker COPY cache include every dependency input; source-only changes reuse
that layer. Patches under `patches/`, `.npmrc` and `bunfig.toml` are L1
`dependency_change` holds, including removals/renames; protected ancestors still
reject. No other L1 behavior changes in P2.

Candidate source, candidate build configuration, installation postprocessing and
compilation execute only in `RUN --network=none`. The fixed OpenCode build runs
its `packages/core` fix-node-pty step offline because the PTY spawn-helper may
need executable permissions. Related dependency: `@lydell/node-pty`; this is
OpenCode's postprocessing, not permission to run its installer online. No other
third-party lifecycle script is enabled. Native/optional prebuilt artifacts must
be present from locked installation; if a dependency needs an additional offline
script, name it here before delivery. A dependency requiring online script
execution requires a new explicit design decision.

Toolchain images have node/python/go targets. Rejected images retain at most the
configured recent commit groups (default2), in addition to baseline/promoted and
active work. The selected Docker context's shared build cache is pruned to6GB (cache only,
including reusable cache from other builds in that context). These are local image retention
limits, not permission to delete unrelated Docker resources.

### Two-stage runs and trusted reports

Each (question,repetition,attempt) uses fresh target and evaluator containers.
Targets have only a fresh internal network, zero bind mounts, cap-drop ALL,
no-new-privileges, memory1100MiB/CPU1/pids256. Evaluators use network none and
memory768MiB/CPU1/pids256. Proxies use memory256MiB, the internal network plus
bridge, no published ports; only proxies receive real upstream secrets.
Container users create random /tmp working directories. No question ID is in
target environment variables. All input uses normalized tar streams/stdin;
container users own extracted files independent of host 0600 permissions.
Export is git add -A then git diff --cached --binary, plus a tar of session DB,
WAL and SHM after Agent exit. cgroup memory.peak is read before removal and saved
in trusted-host artifact metadata. No docker stats sampling is used.

Evaluator order is original repository snapshot, git apply check/application,
symlink check, sealed hidden-test overwrite, trusted reporters baked into the image outside the patched
workspace (root-owned and read-only to the runtime user), then tests. No question-supplied test command executes. Argv:

- node-test-events: node --test --test-reporter=/opt/rsi/node.mjs -- <testTargets>
- unittest-json: python3 -I /opt/rsi/unittest.py <testTargets> (file targets)
- go-test-json: node /opt/rsi/go.mjs <testTargets>, which launches
  go test -json -count=1 <testTargets> without a shell.

Node/unittest reports contain reporter discriminator, tests/passed/failed/skipped/
cancelled/todo counters; Node also flags platform IO permission failures. The Go
launcher strips output text and emits trusted run/pass/fail/skip events. Every
named Go test/subtest is one inventory unit. Exact expectedTests and completion
are required; duplicate, skipped, missing or malformed reports are infra_error.
Test failures and test deadlines are fail. Agent deadline and per-run429 are fail.
Evaluator startup/permissions/IO/report errors are infra_error with one retry.
Git apply exit1 is fail only with recognized patch-mismatch diagnostics; permissions,
IO, timeout and unknown failures remain infrastructure errors. Empty diffs are
valid and test the unmodified snapshot. Candidate code and tests still share one
process tree; exact inventory/reporters do not eliminate framework interference.

### Model accounting, budgets and recovery

WorkerSettings is a trusted-host-only JSON document at private/runtime.json:

```ts
interface MockScript {
  outcome: 'pass' | 'fail' | 'flaky'; passCommand: string;
  failCommand?: string; repetitions?: boolean[];
}
interface WorkerSettings {
  concurrency: number; agentTimeoutMs: number; reconciliationMaxRatio: number;
  keepRecentImages: number; imagesRoot: string; reportersRoot: string;
  proxy: { mode: 'mock' | 'real'; maxTokens: number; inputTokensPerByte: number;
    mockTable: Record<string, MockScript> };
  candidateMockTable: Record<string, MockScript>;
}
```

Defaults: concurrency2 (max32), Agent deadline300000ms, reconciliation threshold
.05, recent image groups2, output cap4096, initial input calibration .35 tokens
per UTF8 byte of messages/tools (not all wire bytes). Default asset paths are
relative to the invocation's repository root; outside that root supply absolute
paths in settings. A scripted mock chooses a question through trusted run-token
attribution, and flaky chooses repetitions (default false,true,false). Real mode
requires environment RSI_UPSTREAM_BASE_URL/RSI_UPSTREAM_API_KEY/RSI_UPSTREAM_MODEL;
only the proxy receives them. Never pass host credential directories.

Proxy requests are serialized per run, forcibly select the configured model,
replace upstream authorization, clamp max_tokens to the configured output cap
and remaining admission budget, and reject admission with429 before forwarding
when reservations cannot fit. Observed prompt usage calibrates future input
estimates with10% headroom. Usage, including auxiliary title requests, is fully
charged; none is subtracted for comparison. Known estimator limitation: exact
input tokenization is provider-specific and usage arrives after a request. An
underestimate can make that final response exceed the reserved count; its entire
reported usage is charged and the run is then blocked. This is an admission hard
limit, not a claim that unknown vendor tokenization can be bounded exactly without
a tokenizer/preflight service. Missing/incomplete usage burns its reservation and
prevents a scored comparable result. No currency is recorded or displayed.

Usage logs contain requestId/stage plus runId, UTC start, status, firstByteMs,
durationMs, usage, cacheHitRate, toolCalls, complete, error and chargedTokens;
never bearer keys, prompts or responses. A reserved record precedes forwarding;
a settled record replaces it logically by requestId. No requests means no usage
file, which is valid zero accounting. Worker polls settled usage and fsyncs
private/usage/<runId>.json receipts before increasing task.tokenUsage. Recovery
first terminates leftover targets, then reads remaining proxies, conservatively
charges unsettled reservations, and removes only task-labelled containers/networks.
A receipt contains runId,tokens,requests,blocked,complete. Repeated observations
use a per-run monotonic maximum; receipts are accounting evidence, never scores.

Token exhaustion aborts and invalidates all unfinished evaluations; no interrupted
scores survive. Proxy/session token disagreement exceeding the configured ratio,
or missing reconciliation evidence, produces an L2 suspicious/info finding for
candidate runs. session_v2 sums input/output/reasoning/cache-read/cache-write;
these native counters exclude their cached/reasoning subsets. Session DB data is
untrusted; proxy usage remains authoritative. Artifact metadata has target/evaluator
memoryPeakBytes, sessionTokens and toolchain; these are not new RSI entity fields.

Startup verifies the ledger against the cache anchor before resource cleanup.
Running queues/evaluations are requeued; terminal ledger results are reused.
Slot IDs are SHA256(canonical array encoded with JSON.stringify of
[evaluationId,questionId,repetition,attempt]); each scored slot selects attempt0
unless infrastructure error requires attempt1. Existing slots are not rerun or
charged twice. Budget-invalidated groups use fresh IDs; sealed reservation is
reused and late token approval reuses completed sealed evidence. Final interrupted
reservations preserve the original human request and completed final locks.

`ledger recover` is an explicit operator command. It obtains worker/writer/ledger
exclusivity, accepts only a lone partial_tail, copies raw residual bytes into a
0600 `ledger-tail-<uuid>.quarantine`, fsyncs it and its directory, then truncates and
fsyncs the ledger to its verified complete prefix. Hash/anchor corruption is never
repaired this way. Existing unknown/live ledger locks fail closed; known-dead owners older than the
RSI-007 stale threshold can be reclaimed under its exclusive reclaim guard. Normal startup
never truncates a ledger. An unanchored valid prefix still cannot prove the absence
of a removed tail (RSI-007 limitation).

### Verification boundary

Unit tests use Docker/process/model transport doubles, real ledger/cache/state/
noise/gate logic and actual local reporter processes, without binding ports.
`scripts/rsi-e2e/p2-smoke.mjs` is a separate real-Docker, scripted-model workflow
for Claude outside the sandbox. It asserts nonzero delta, kills a worker with a
running evaluation after one durable slot (the trusted barrier also leaves a
labelled idle container/network for cleanup verification), resumes with concurrency2, verifies
no repeated slot/charge, exercises default missing-review hold, injects trusted
clean reviews, runs sealed, promotes, verifies the chain and checks restart and
resource cleanup. It emits a JSON report and fails explicitly if Docker is absent.
Real vendor calibration, genuine model resource measurements and third-party
lifecycle/native-build availability remain externally verified integration work.

Process/stream bounds: asynchronous host commands default to120000ms and8MiB
combined stdout/stderr, with process-group cancellation; source archive reads use
256MiB, candidate builds45min/16MiB, trusted image builds15min, proxy readiness10s.
Proxy usage polling is250ms; upstream requests have a120s total deadline and8MiB
response cap, request bodies2MiB and individual protocol frames4MiB. These are
implementation defaults, not measured model requirements. The miniature Go bank
uses90s test deadlines to include cold standard-library compilation on CPU1;
production question deadlines remain RSI-011 metadata. Go images pin local
GOTOOLCHAIN, disable module proxy/sumdb networking and set GOMAXPROCS=1.

## RSI-013 Configurable Agent profiles (M13, 2026-11-07)

A trusted profile is a JSON file beside its Dockerfile. It does not change
RsiTask or authorize any relaxation of RSI-012 isolation.

```ts
interface RsiAgentProfile {
  version: 1;
  id: string; name: string;
  dockerfile: string;
  dependencyInputs: { kind: 'bun-workspace' } | { kind: 'globs'; include: string[] } | { kind: 'none' };
  run: {
    argv: string[];
    env: Record<string, string>;
    files: { path: string; content: string }[];
  };
  session: { format: 'opencode-db' | 'none'; dir: string };
  l1?: { allowPaths?: string[] };
}
```

IDs follow RSI-001. Unknown fields and invalid fields fail with a field path.
Dockerfile is a safe profile-relative file (no traversal/symlinks) and must define
`target-node`, `target-python`, `target-go`. Run files and session.dir are normalized
container absolute paths. Profiles contain no real credentials: credential values
must use the temporary `{{apiKey}}`. No host credential directory is read/mounted.
argv supports `{{statement}}`, `{{model}}`; env and files.content support
`{{baseUrl}}`, `{{apiKey}}`, `{{model}}`, `{{sessionDir}}`. Unknown/malformed
placeholders fail. Replacement is a single literal string pass without shell
interpolation. baseUrl is `http://rsi-proxy:8080/v1`, sessionDir is session.dir;
model is `fixed` for mock and RSI_UPSTREAM_MODEL for real runs (a provider prefix
may be supplied by profile argv/config). The proxy still forces the upstream model.

`task create --agent <profile.json> [--subset small|full]` defaults to the bundled
OpenCode compatible profile and full bank. It freezes the original profile bytes
as private/agent/profile.json and Dockerfile at its profile-relative path.
WorkerSettings gains `agent: { profileSha256: string; dockerfileSha256: string }`
in private/runtime.json, verified at every worker startup before Docker, including dry run.
Missing pins fail closed. They are separate
from RsiTask and never contain secrets. Changed/missing frozen files fail closed.

Build context contains only source/ and deps/ plus the trusted Dockerfile.
bun-workspace retains RSI-012 collection. globs copies only matched source files;
none copies no dependency inputs. deps/ exists even when empty. In every mode,
`.npmrc` and `bunfig.toml` are excluded from deps/ at any depth. Simple globs are
case-sensitive repo-relative: `*` matches within a segment, `?` one non-slash,
`**` spans directories (`**/` also matches zero directories); no braces/extglobs,
absolute paths, dot segments or backslashes. L1 allowPaths uses the same matching
semantics and suppresses only protected_path for successfully parsed matching
paths; content/dependency/mode/link/binary/size rules still apply.

Profile authors are trusted infrastructure authors. Candidate source/configuration
and dependency lifecycle code MUST execute only in `RUN --network=none`.
Only platform-filtered deps may enter a networked installation with lifecycle
scripts disabled. Text stage validation cannot prove Dockerfile safety; authors
must review it. Profiles cannot add mounts, ports, capabilities or networks.
All bundled target/evaluator Go stages use
`COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go` and
PATH=/usr/local/go/bin:$PATH, with local/offline Go settings; never Debian Go1.19.

Proxy credentials come exclusively from worker environment
RSI_UPSTREAM_BASE_URL / RSI_UPSTREAM_MODEL / RSI_UPSTREAM_API_KEY; missing real-mode
variables report their names only. They never enter settings/runtime/ledger/logs
or target/evaluator containers. Usage polling is **2000ms**, superseding RSI-012's
250ms default. Proxy artifacts additionally retain responses.jsonl (one record per
response: requestId, assistant text and tool_calls) and last-request.json (last
request's messages). Authorization headers are never captured. Each trace file has
an 8MiB UTF8-byte limit; oversized last requests retain a bounded prefix of messages
and set truncated=true; response logs reserve room for a final truncated marker
and stop appending when full. Streaming tool deltas are assembled by choice/index.
All three proxy artifacts, including usage.jsonl when present, export to the run's
artifacts directory via tar before removal. Session dir exports independently;
format none skips native token reads and reconciliation findings, leaving proxy
tokens authoritative. Traces remain private human-only artifacts, not optimizer DTOs.

Small subset selection preserves manifest.questions order: smoke unchanged; train
contains smoke plus the first non-smoke train question of each available language;
sealed/final each contain the first question of each language. A language with no
additional non-smoke train question contributes none. Sets retain their original
set order. Only selected question entries/directories are frozen, manifest rewritten
before datasetHash/fingerprints are computed. RSI-011 invariants (including coverage,
qualification, secrecy, disjointness and full assignment) remain unchanged.

SmokeFloor is the number of smoke questions passed in **every** repetition of the
complete baseline train calibration; no extra baseline smoke evaluation is needed.
It is derived from immutable runs, including selected infrastructure retries.
Candidate smoke passed count >= smokeFloor permits train, otherwise rejects.

`rsi agent validate <profile.json>` validates profile and Dockerfile, without a task
or Docker. `rsi doctor [--root <path>] [--docker-context <name>]` emits JSON checking
CLI/buildx availability, context connectivity, Linux engine and amd64/arm64 support,
free bytes (minimum6GiB at config root), and presence booleans for all three upstream
variables, never their values. Probe failures are structured checks, not raw logs.


## RSI-014 Isolated optimizer loop and HTTP (M13 / P4)

Design author decisions **决定于 2026-11-07**. This section supersedes P1/P2
scope deferrals, RSI-005's raw-trajectory exclusion for smoke/train, and RSI-013's
human-only trajectory restriction. Pages and monitor Agents remain deferred.

### Sessions, profiles and isolation

```ts
export interface RsiOptimizerSession {
  id: string; taskId: string; seq: number; parentId: string | null; commit: string;
  state: 'running' | 'submitted' | 'stuck' | 'no_submission' | 'timeout' | 'interrupted';
  submissionId: string | null; accounting: 'proxy' | 'self_reported';
  tokens: number | null; artifactPath: string; startedAt: string; endedAt: string | null;
}
```

Ledger adds `{event:'session_put',payload:RsiOptimizerSession}`. Worker alone may
create/update sessions. Identity/parent/start/accounting/artifact are immutable;
only a running session may finish, terminal snapshots are immutable. `seq` is
positive task-local session ordinal, independently of iteration ordinal.
`submissionId` binds the first accepted submit/stuck queue ID; later different
requests during that session conflict. Running sessions recovered after a crash
finish interrupted (or submitted/stuck if their first durable request exists).
Three consecutive terminal no_submission/timeout sessions enter needs_help through
a worker-attributed, optimizer-requested declare_stuck queue; interrupted sessions
break that count. No submission does not fabricate an iteration or score.

Every round uses a new internal-only container, no host bind/socket mounts, no
published ports/capabilities. Only a configured Docker named login volume may be
mounted to that optimizer. Sidecar alone joins internal plus bridge. Sidecar
forwards model requests and exactly `/api/rsi/agent/` to a fixed host origin;
all other paths404. CONNECT is exact case-insensitive allowlisted DNS names,
port443 only, never IP literals; DNS answers must be public unicast (no host,
loopback, private, link-local, multicast, or mapped private destinations).
No redirects, arbitrary upstream URLs, forwarding of page endpoints or headers.
Session/task bearers authorize agent routes only; human routes always require a
separate process-local page token and local Host/same-origin policy.

Worker generates256 random bits each session; only `{sessionId,tokenHash,expiresAt}`
is atomically saved to private/agent-session.json mode0600. Plaintext is delivered
only through container environment, never prompts, logs or ledger. API hashes and
constant-time compares either the immutable task bearer or current unexpired
session bearer; also checks session is running. End/timeout removes the file before
export and evaluation. Restart revokes before recovery. Manual task bearers remain
usable for externally driven optimizers; no session token recovery is necessary.

Trusted optimizer profile extends RSI-013's run/session shape with version,id,name,
dockerfile,family,egress,login (no dependencyInputs/l1). egress is
`{kind:'model-proxy'}` or `{kind:'vendor-allowlist',domains:string[]}`; login is
`{kind:'none'}` or `{kind:'volume',path:string,command:string[]}`. Dockerfile is
profile-relative, no links/traversal, one final image (no target stage requirement).
Same strict single-pass placeholders as RSI-013, statement is the handoff prompt.
The only injected application env is RSI_API_BASE, RSI_AGENT_TOKEN plus rendered
model config and HTTPS_PROXY/HTTP_PROXY for vendor mode. No host credential paths.
Bundled default opencode-deepseek uses DeepSeek provider and model proxy;
codex/claude-code support named-volume fresh-container interactive login and are
explicitly untested. scripted is an interface-only integration fixture.

WorkerSettings adds optional optimizer pins (profileSha256/dockerfileSha256),
optimizerSessionTokens default2000000, optimizerSessionTimeoutMs default1800000,
allowUnmeteredOptimizer defaultfalse, apiBase defaulthttp://127.0.0.1:4173.
apiBase is a trusted host origin; sidecar rewrites its forwarding Host to loopback.
Only model-proxy usage counts toward maxTaskTokens. Proxy429 ends the session.
Vendor sessions fail closed unless allowUnmeteredOptimizer=true (CLI
--allow-unmetered-optimizer). Their time limit remains hard; native JSONL usage
is self_reported, nullable when unavailable, never counted toward task budget or
gate inputs. Codex token_count total_token_usage.total_tokens and Claude message
usage input/output/cache_read_input/cache_creation_input tokens are parsed only
as diagnostic data, never estimated. Login is an explicit exception to the
worker-only container entry rule: only `optimizer login --profile <id>` may run a
fresh interactive login container. No source/task content enters login containers.

Parent Git bundle enters by normalized tar/stdin; returned bundle is size-bounded,
fetched into the trusted bare repository with hooks disabled and no checkout.
Only submitted full commit is imported, must descend from selected parent. Platform
computes diff; caller diff/binaries never accepted. Container stdout/native logs
are not retained (may contain bearers); proxy traces omit agent-forwarding bodies.
Optimizer traces reside at artifacts/optimizer/<sessionId>/proxy and human session
trajectory route; optimizer cannot read another optimizer's traces via run routes.

### Creation, commands, artifacts

HTTP creation removes caller datasetHash. Required absolute local paths:
repository,agentProfile,optimizerProfile,bank; full baselineCommit,requestId,config.
subset optional defaults full. Async freeze only (64MiB aggregate input bank,
1MiB/profile and Dockerfile), no processes; compute datasetHash, persist created
and start command. CLI shares this implementation, defaults bundled profiles.
Worker creates/verifies trusted mirror before calibration. Idempotency retains
original acceptance/token=null and rejects changed creation contents. A durable
private/create.json records nonsecret intent and settings; no bearer in that file.

Rollback is task-scoped; command selects baseline/null or promoted parent. Latest
completed rollback after last session overrides the next round only. Submission
creates the iteration, all old versions remain. Instructions activate no earlier
than next iteration; brief filters by effectiveFromSeq. Add human command
`{action:'set_target',targetPassedCount:number,reason:string}` (positive integer).
set_budget/set_target/instruction followed by resume handles needs_help.
Adopt requires promoted iteration plus a complete locked final (score nonnull,
infraErrorRatio0); write baseline-relative artifacts/adopted/<seq>.patch and
refs/rsi/adopted/<seq> idempotently. Never merge/push.
Quality artifact fields: addedLines,deletedLines,changedLines,files,addedFunctions
(nonnegative integers; function count is a documented lexical approximation).
Worker heartbeat `{pid,at,phase}` at private/worker.json every5s; human response
adds running (fresh within15s; PID checked when local), stale status is advisory.

### Additional HTTP and visibility

All existing RSI-009.1 routes implemented, no-store, strict bodies, existing
ApiError and1MiB maximum JSON. Human token endpoint GET /api/rsi/session returns
`{token}` only for local Host, exact Origin==Host origin if supplied and
Sec-Fetch-Site absent/same-origin/none. Other human routes additionally require
Bearer page token. Wrong scope403, missing/unknown401, bad Host/Origin403.
Agent handlers do not require browser Origin (sidecar strips browser headers).

Additional GETs:
- /api/rsi/agent/runs/:runId/trajectory (only same-task smoke/train, otherwise404)
- /api/rsi/tasks/:taskId/runs/:runId/trajectory (human, all phases)
- /api/rsi/tasks/:taskId/sessions (human paged RsiOptimizerSession)
- /api/rsi/tasks/:taskId/sessions/:sessionId/trajectory (human optimizer traces)
- /api/rsi/tasks/:taskId/iterations/:seq/diff → {diff,quality}, platform artifact
- /api/rsi/tasks/:taskId/iterations/:seq/findings → paged RsiFinding with evidence
- /api/rsi/tasks/:taskId/worker → {pid,at,phase,running}, absent null fields

Trajectory query file=responses|last-request (default responses), offset unsigned
byte offset default0, limit1..65536 default65536. Response
`{file,content,nextOffset:number|null,truncated:boolean}`; content is bounded UTF8
text, reads avoid splitting multibyte characters. Missing file returns empty text.
Projection permits only this content for trusted smoke/train runs: response
requestId,assistant[].index/text/tool_calls and last-request messages (role,
content,tool_calls,tool_call_id,name), truncated marker/prefix; unknown keys dropped.
Hidden evaluator/test/monitor files NEVER enter these artifacts. No string-filter
claim: a genuinely observed target prompt/answer may mention its visible statement.
Unknown/private run phase is rejected before any artifact IO. Quality is included
in optimizer results as quality|null using explicit numeric projection. Optimizer
brief adds remainingTaskTokens,remainingIterations,lastIterationSeq and allowPaths
(from frozen target profile); no monitor prose or private paths. Sealed evals still
verdict only; final excluded before result pagination.

SSE rsi_changed {taskIds:string[]} coalesces ledger filesystem notifications200ms.
No per-run event, server owns watcher/timer cleanup. Worker --execute --watch polls
queued state every5s, Ctrl-C aborts owned work; non-watch drains and exits.


P4 implementation defaults: trajectory page ends may extend3 UTF8 bytes; offsets
inside a codepoint400. Task IDs for HTTP are task-<requestId> when <=123 characters,
otherwise task-<SHA256(requestId)>. Ledger watcher uses100ms filesystem polling
and a separate200ms merge window, without reading trace bodies. Profiles/bank
selection lists are optional and omitted in P4. API base may be overridden with
worker --api-base; production server data root is beside its database/config:
<directory>/awesome-telemetry-data/rsi (use CLI --root <directory>).
Proxy usage admission remains RSI-012's calibrated reservation semantics, not an
exact unknown-provider tokenizer. No proxy/native reconciliation for unmetered
optimizer usage. Source Git bundles capped256MiB; artifact/session export64MiB.

Default new tasks use proxy.mode=real; supply upstream variables only to the
manual worker. Test harnesses explicitly select mock in trusted WorkerSettings.
Unmetered refusal applies to execution, not dry-run validation. Native usage
parsing considers only JSONL bytes added during the current fresh session; failed
pre-session snapshots or absent counters yield null. Before bundle export, the
worker kills optimizer processes (including detached descendants), ignores dead
zombies and fails closed if a live non-init process remains. Container removal
still runs if stopping/export fails. Heartbeat covers materialization/recovery as
well as evaluation, with atomic JSON replacement; adopted patches/import manifests
are also atomically published. Host credential roots and their ancestors are not
valid creation inputs. Existing request IDs retain acceptance even if source files
have subsequently disappeared.

Bearer-bearing request bodies are rejected before queue writes. Model sidecars
redact their temporary/upstream keys and current task/session64-hex bearer digests
from model input/transcript values before forwarding/retention. This prevents
accidental literal credential copies (for example tool output of environment),
not arbitrary encoded covert channels by an adversarial optimizer. The real
upstream authorization header is still injected separately and never captured.


The optimizer image must declare a non-root USER (verified again with id -u).
A trusted root PID1 sleep supervisor enforces the absolute session deadline in
Docker even if the host worker crashes; it never executes candidate/profile code.
All source/config extraction, optimizer execution and Git/native exports run via
Docker exec with the image's original non-root user. That user cannot signal the
root deadline supervisor. The original user is retained in a trusted container
label for crash recovery. Deadline granularity is one second (floor UTC epoch, at most999ms early, never later than the configured limit);
API session token expiry and the live worker timer retain millisecond resolution.

The original non-root user's home is resolved from the image's /etc/passwd and
restored as HOME on all optimizer execs (including recovery); it is a container
path, never the host HOME. This preserves vendor login volume/config lookup while
the trusted deadline supervisor runs as root. Missing/non-root UID/home fails
closed before source extraction.

Trusted Git retains refs/rsi/baseline and refs/rsi/submissions/<SHA256(queueId)> so
unrelated later candidates/rollback cannot make recorded commits collectible.
These are local retention refs only, not source branch updates, merges or pushes.
