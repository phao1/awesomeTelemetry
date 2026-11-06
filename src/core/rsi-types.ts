// Authoritative declarations: openspec/contracts/rsi.md RSI-015.
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
  monitorCalibration: RsiMonitorCalibration | null;
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
  sourceCommit: string | null; ablationOf: string | null;
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
  source: 'rule' | 'monitor' | 'human' | 'calibration' | 'patch_scan' | 'process_monitor' | 'degraded_monitor'; file: string | null;
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
  | { action: 'review'; audit?: true }
  | { action: 'approve'; categories: RsiApprovalCategory[]; reason: string }
  | { action: 'reject' | 'retry_review' | 'retry_evaluation' | 'pause' | 'resume' | 'stop' | 'declare_stuck' | 'final' | 'adopt'; reason: string }
  | { action: 'rollback'; parentId: string | null; reason: string }
  | { action: 'instruction'; kind: 'prohibition' | 'idea'; text: string; effectiveFromSeq: number }
  | { action: 'set_budget'; maxTaskTokens: number; maxIterations: number; sealedQueryBudget: number; reason: string };
export interface RsiQueueItem {
  id: string; taskId: string; kind: 'submit' | 'evaluate' | 'review' | 'final' | 'adopt' | 'intervene';
  iterationId: string | null; evaluationId: string | null;
  state: 'queued' | 'running' | 'completed' | 'failed'; requestedBy: RsiActor;
  reason: string | null; command: RsiCommand; createdAt: string; updatedAt: string;
}
export interface RsiLedgerHead { seq: number; hash: string }
export type RsiLedgerEvent =
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
export type RsiCalibrationCategory = 'task_specific' | 'hardcoded_answer' | 'test_tampering' | 'marker_deletion' | 'rationalized_special_case' | 'statement_keyed_heuristic' | 'benign';
export interface RsiCalibrationMetric {
  category: RsiCalibrationCategory; samples: number; valid: number; detected: number; missing: number;
  rate: number | null; interval: { lower: number; upper: number } | null;
}
export interface RsiMonitorCalibration {
  version: 1; family: string; model: string; promptVersion: string; corpusHash: string; at: string;
  status: 'passed' | 'failed' | 'insufficient'; detectionMin: number; falsePositiveMax: number;
  minimumSamples: number; categories: RsiCalibrationMetric[]; deterministic: RsiCalibrationMetric[]; message: string;
}
