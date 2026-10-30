import type { ProviderKey, DurationSource, TokenSemantics, TraceEventSlim, TraceLogTurn, TraceStatus } from '../trace-types.js';
import type { TaskNativeRef } from '../task-types.js';
import type { BenchmarkUsage } from '../benchmark-types.js';

export type Timing = 'measured' | 'observed' | 'derived' | 'reported'
  | 'model_judged' | 'unknown' | 'unavailable';
export type TimestampSemantics = 'completion' | 'start' | 'interval' | 'unknown';
export type TtftLayer = 'proxy' | 'exporter' | 'maas' | 'inferhub' | 'kernel' | 'log_upper_bound';
export type ReasoningState = 'present' | 'zero' | 'unknown';
export type ToolClass = 'install' | 'build' | 'test' | 'lint/typecheck' | 'read'
  | 'search' | 'write/edit' | 'web' | 'delegate' | 'shell' | 'other';
export type Dimension = 'perceived' | 'plan' | 'act' | 'model' | 'startup' | 'quality' | 'coverage';
export type Coverage = 'complete' | 'partial' | 'unavailable';
export interface HealthScope { member: string; from: string | null; to: string | null }
export interface HealthMember {
  id: string; parentId: string | null; role: string;
  sessionKey: string | null; provider: ProviderKey | null;
  detailLoaded: boolean; durationSource: DurationSource;
  tokenSemantics: TokenSemantics | null;
  timestampSemantics: TimestampSemantics; cwd: string | null;
}
export interface HealthRecord {
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
export interface HealthCaptureTiming {
  id: string; recordIds: string[];
  startedMs: number; firstContentMs: number | null; completedMs: number | null;
  outputTokens: number | null; layer: TtftLayer;
}
export interface HealthInput {
  version: 1; taskId: string; t0: string;
  scope: HealthScope; revision: string; snapshotAt: string;
  running: boolean; recordedStatus: TraceStatus;
  window: string; members: HealthMember[]; records: HealthRecord[];
  captures: HealthCaptureTiming[]; limits: string[]; reasons: string[];
}

export interface HealthSpan {
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
export interface HealthRound {
  id: string; memberId: string; index: number;
  readyMs: number | null; firstOutputMs: number | null;
  modelEndMs: number | null; endMs: number | null;
  toolSpanIds: string[]; writeFiles: number; parallelTools: number;
  reasoning: ReasoningState;
}
export interface HealthMetric {
  key: string; value: number | null;
  unit: 'ms' | 'count' | 'pct' | 'tokens' | 'chars';
  timing: Timing; layer: TtftLayer | null; coverage: Coverage;
  samples: number; reason: string | null; evidenceIds: string[];
  facets: Record<string, string>;
  stat: 'value' | 'mean' | 'p50' | 'p95' | 'max' | 'sum';
  values: number[] | null;
}
export interface HealthEvidence {
  id: string; memberId: string; recordIds: string[]; captureIds: string[];
  title: string; summary: string | null; truncated: boolean;
  intervalMs: [number, number] | null; timing: Timing;
}
export interface HealthFinding {
  id: string; rule: string; dimension: Dimension;
  severity: 'warning' | 'notice' | 'info'; confidence: 'observed' | 'heuristic';
  facts: Record<string, number | string | null>; evidenceIds: string[];
  intervalMs: [number, number][] | null;
  recommendation: { action: string; conditions: string; retest: string[] };
}
export interface HealthThresholds {
  profile: 'codearts-perf-v1';
  longToolMs: number; duplicateInstalls: number;
  toolErrorPct: number; toolErrorMinCalls: number; consecutiveErrors: number;
  writeFiles: number; singleFileWriteRoundPct: number; serialReads: number;
  roundBaseline: number | null; roundMultiplier: number; explorePct: number;
  repeatedReads: number; reworkRounds: number;
  firstOutputMs: number; reasoningMinRounds: number; reasoningPct: number;
  reasoningGroupMin: number; reasoningRatio: number; cacheHitPct: number; gapMs: number;
}
export interface HealthReport {
  version: 1; id: string; taskId: string; mode: 'standard'; scope: HealthScope;
  revision: string; generatedAt: string; snapshotAt: string; running: boolean;
  /** ISO UTC of HealthInput.t0; older saved reports omit the origin. */
  t0?: string | null;
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

export interface DeepHealthFragment {
  id: string; recordId: string; text: string; truncated: boolean;
  role: 'goal' | 'finding' | 'normal' | 'final' | 'verification';
}
export interface DeepHealthPack {
  version: 1; reportId: string; revision: string; scope: HealthScope;
  metrics: HealthMetric[]; findings: HealthFinding[]; evidence: HealthEvidence[];
  rounds: { id: string; index: number; memberId: string;
    startMs: number | null; endMs: number | null;
    tools: { name: string; title: string; status: string }[];
    tokens: BenchmarkUsage | null; reasoning: ReasoningState }[];
  fragments: DeepHealthFragment[]; limitations: string[];
}
export interface DeepHealthReport {
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
