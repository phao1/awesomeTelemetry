/** Canonical additive DTOs: openspec/contracts/agent-folding.md AF-001..005. */
export type FoldingJson = null | boolean | number | string | FoldingJson[] | { [key: string]: FoldingJson };
export interface FoldingText { zh: string; en: string }
export type FoldingAction = 'fold' | 'merge' | 'as_tool' | 'keep' | 'main';
export type FoldingSourceKind = 'official_recording' | 'synthetic_traffic' | 'offline_smoke' | 'live_api' | 'user_import' | 'native_telemetry' | 'source_code';
export interface FoldingSource {
  id: string; kind: FoldingSourceKind; title: string; url: string | null; revision: string | null;
  observedAt: string | null; model: string | null; limitations: string[];
}
export interface FoldingEvidence {
  id: string; sourceId: string; path: string; pointer: string | null; sha256: string | null;
  kind: 'code' | 'trace' | 'grade' | 'action' | 'model_call' | 'owner' | 'document';
  excerpt: string | null; text: string | null; complete: boolean;
  native: { taskId: string; sessionKey: string | null; eventId: string | null; captureId: number | null; callSequence: number | null } | null;
}
export interface FoldingAgent {
  id: string; name: string; owner: string | null; isMain: boolean; prompt: string | null;
  tools: string[]; invokedBy: string[]; returns: string | null;
  talksToUser: boolean | null; externalOwner: boolean | null;
  contextNeed: 'large_input' | 'independent_parallel' | 'independent_verification' | 'tool_conflict' | 'none' | 'unknown';
  proposed: FoldingAction; rationale: FoldingText; evidenceIds: string[];
  toolDefinitions?: Array<{ name: string; description: string; inputSchema: FoldingJson | null; writes: boolean | null; preconditions: string[]; evidenceIds: string[] }>;
}
export interface FoldingBoundary {
  id: string; fromAgentId: string; targetAgentIds: string[]; proposed: Exclude<FoldingAction, 'main'>;
  title: FoldingText; rationale: FoldingText; requirements: string[]; evidenceIds: string[];
}
export interface FoldingCaseCheck {
  id: string; kind: 'answer_includes' | 'answer_excludes' | 'action' | 'forbidden_action' | 'only_expected_writes' | 'external';
  expected: FoldingJson; required: boolean;
}
export interface FoldingCase {
  id: string; title: string; turns: string[]; customerId: string | null; tags: string[];
  checks: FoldingCaseCheck[]; requiredChains: string[][]; split: 'train' | 'confirmation'; evidenceIds: string[];
  chainChecks?: Array<{ chain: string[]; checkId: string }>;
}
export interface FoldingTrafficCall {
  traceId: string; sequence: number; agentId: string; callerId: string | null;
  timestamp: string | null; durationMs: number | null; inputTokens: number | null; evidenceId: string;
}
export interface FoldingCheckResult { id: string; label: string; passed: boolean | null; evidenceId: string | null }
export interface FoldingTraceEvent {
  id: string; sequence: number; role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'model' | 'skill' | 'handoff' | 'verification';
  agentId: string | null; targetAgentId: string | null; name: string | null; content: string | null;
  startMs: number | null; durationMs: number | null; evidenceId: string; complete: boolean;
}
export interface FoldingTrial {
  id: string; experimentId: string; variantId: string; caseId: string; repetition: number; sourceId: string;
  grade: 0 | 1 | null; checks: FoldingCheckResult[]; answer: string | null;
  latencyMs: number | null; inputTokens: number | null; outputTokens: number | null;
  modelCalls: number | null; toolCalls: number | null; model: string | null;
  byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
  actions: Array<{ name: string; args: FoldingJson; evidenceId: string | null }>;
  events: FoldingTraceEvent[]; harnessError: string | null; evidenceIds: string[];
}
export interface FoldingControls {
  taskSet: 'verified' | 'declared' | 'changed' | 'unknown';
  grader: 'verified' | 'declared' | 'changed' | 'unknown';
  model: 'same_recorded' | 'different' | 'unknown';
  nonTarget: 'verified' | 'declared' | 'changed' | 'unknown';
  intervention: 'verified' | 'declared' | 'unknown';
  execution: 'verified' | 'declared' | 'changed' | 'unknown';
  baselineRevision: string | null; candidateRevision: string | null;
  skillAblation: 'complete' | 'not_run' | 'not_applicable'; notes: string[];
}
export interface FoldingExperiment {
  id: string; title: string; boundaryId: string; operation: Exclude<FoldingAction, 'main'>;
  baselineVariantId: string; candidateVariantId: string; caseIds: string[]; expectedRepetitions: number;
  controls: FoldingControls; trialIds: string[]; evidenceIds: string[];
  chainMappings?: Array<{ variantId: string; before: string[]; after: string[]; verified: boolean; evidenceIds: string[] }>;
  ablationVariantId?: string;
}
export interface FoldingHumanDecision {
  id: string; boundaryId: string; action: 'keep_change' | 'revert' | 'fix' | 'rerun';
  note: string; decidedAt: string | null; evidenceIds: string[];
}
export interface FoldingProject {
  version: 1; kind: 'agent-folding-project'; id: string; title: string; createdAt: string;
  sources: FoldingSource[]; agents: FoldingAgent[]; boundaries: FoldingBoundary[]; cases: FoldingCase[];
  traffic: FoldingTrafficCall[]; experiments: FoldingExperiment[]; trials: FoldingTrial[];
  evidence: FoldingEvidence[]; humanDecisions: FoldingHumanDecision[]; limitations: string[];
}
export interface FoldingPair {
  caseId: string; repetition: number; baselineTrialId: string | null; candidateTrialId: string | null;
  baselineGrade: 0 | 1 | null; candidateGrade: 0 | 1 | null;
  outcome: 'both_passed' | 'regression' | 'improvement' | 'both_failed' | 'unknown';
  routeBefore: string[]; routeAfter: string[]; actionsChanged: boolean | null; evidenceIds: string[];
}
export interface FoldingMetricSummary { n: number; mean: number | null; median: number | null }
export interface FoldingExperimentAnalysis {
  experimentId: string; boundaryId: string;
  status: 'supported' | 'regression' | 'needs_evidence' | 'unscored';
  baseline: { passed: number; known: number; expected: number; taskScore: number | null; interval: [number, number] | null };
  candidate: { passed: number; known: number; expected: number; taskScore: number | null; interval: [number, number] | null };
  pairs: FoldingPair[]; regressions: FoldingPair[]; improvements: FoldingPair[];
  metrics: Record<'latencyMs' | 'inputTokens' | 'outputTokens' | 'modelCalls' | 'toolCalls', { baseline: FoldingMetricSummary; candidate: FoldingMetricSummary }>;
  coverage: Array<{ variantId: string; chain: string[]; trialsSeen: number; trialsSuccessful: number; caseIds: string[]; evidenceIds: string[] }>;
  blockers: FoldingText[]; observations: Array<{ title: FoldingText; detail: FoldingText; evidenceIds: string[] }>;
  ablation?: { variantId: string; passed: number; known: number; expected: number; taskScore: number | null; regressions: number; evidenceIds: string[] };
}
export interface FoldingBoundaryDecision {
  boundaryId: string; action: Exclude<FoldingAction, 'main'>;
  status: 'candidate' | 'supported' | 'regression' | 'needs_evidence' | 'protected';
  title: FoldingText; rationale: FoldingText; experimentIds: string[]; evidenceIds: string[];
  nextChecks: FoldingText[];
}
export interface FoldingAnalysis {
  decisions: FoldingBoundaryDecision[]; experiments: FoldingExperimentAnalysis[];
  coupling: Array<{ left: string; right: string; traces: number; coupling: number; share: number; evidenceIds: string[] }>;
  warnings: FoldingText[];
}
export interface FoldingRunPlan {
  version: 1; kind: 'agent-folding-plan'; title: string;
  adapter: 'support-desk' | 'external'; provider: 'anthropic' | 'fixture'; model: string | null;
  boundaryId: string; operation: 'fold' | 'merge' | 'as_tool'; targetAgentIds: string[];
  caseIds: string[]; repetitions: number; schedule: 'sequential' | 'parallel';
  budgets: { maxCallsPerCase: number; maxOutputTokens: number; maxInputChars: number; maxTotalTokensPerCase: number; timeoutMs: number; maxToolBatch: number };
  external: { repository: string; ref: string; baselineDriver: string[]; candidateDriver: string[]; evaluator: string[]; cases: FoldingCase[]; project?: FoldingProject } | null;
  skillAblation?: boolean;
}
export interface FoldingEstimate {
  cases: number; repetitions: number; variants: 2 | 3; modelCalls: number | null;
  inputTokens: number | null; outputTokens: number | null; basis: 'measured_baseline' | 'unknown';
  limitations: string[];
}
export interface FoldingArtifact { path: string; content: string; purpose: FoldingText }
export interface FoldingProviderStatus { anthropicConfigured: boolean; modelConfigured: boolean; model: string | null; paidExecution: 'cli_only' }
