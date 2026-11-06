import type { RsiPhase } from './rsi-types.js';
import { RSI_ITERATION_STATES, RSI_PHASES, RSI_TASK_STATES } from './rsi-types.js';

type RecordValue = Record<string, unknown>;
type Predicate = (value: unknown) => boolean;
const object = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const string: Predicate = value => typeof value === 'string';
const num: Predicate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const int: Predicate = value => num(value) && Number.isSafeInteger(value);
const nullable = (check: Predicate): Predicate => value => value === null || check(value);
const member = (values: readonly unknown[]): Predicate => value => values.includes(value);
function pick(value: RecordValue, fields: Record<string, Predicate>): RecordValue {
  const result: RecordValue = {};
  for (const [name, check] of Object.entries(fields)) if (Object.hasOwn(value, name) && check(value[name])) result[name] = value[name];
  return result;
}
const categories = ['protected_path', 'task_fingerprint', 'opaque_blob', 'dependency_change', 'binary_file', 'diff_too_large', 'file_mode_change', 'symbolic_link', 'suspicious', 'isolation_violation'];
const holds = ['dependency_change', 'l3_suspicious', 'l4_suspicious', 'token_growth', 'missing_monitor', 'missing_adversarial', 'incomplete_comparison'];

export function projectTaskForOptimizer(value: unknown): RecordValue | null {
  const v = object(value); if (!v || !RSI_TASK_STATES.includes(v.state as never)) return null;
  const config = object(v.config); if (!config || !int(config.sealedQueryBudget) || !int(v.sealedQueriesUsed)) return null;
  const remaining = (config.sealedQueryBudget as number) - (v.sealedQueriesUsed as number); if (remaining < 0) return null;
  return { ...pick(v, { id: string, state: member(RSI_TASK_STATES), mainMetric: member(['passed_count']), delta: nullable(num), baselineTrainScore: nullable(num) }),
    sealedQueriesRemaining: remaining,
    config: pick(config, { noiseRepeats: int, infraErrorMaxRatio: num, stableWindow: int, stableFailRepeats: int, sealedQueryBudget: int,
      tokenGrowthMaxRatio: num, maxIterations: int, maxTaskTokens: int, runTokenBudget: int, targetPassedCount: int }) };
}
export function projectIterationForOptimizer(value: unknown): RecordValue | null {
  const v = object(value); if (!v || !RSI_ITERATION_STATES.includes(v.state as never)) return null;
  const result = pick(v, { id: string, seq: int, parentId: nullable(string), commit: string, state: member(RSI_ITERATION_STATES), trainScore: nullable(num) });
  const prd = object(v.prd);
  if (prd) {
    result.prd = pick(prd, { observation: string, hypothesis: string, expectedImpact: string });
    if (Array.isArray(prd.changes)) (result.prd as RecordValue).changes = prd.changes.filter(string);
  }
  if (Array.isArray(v.holdReasons)) result.holdReasons = v.holdReasons.filter(member(holds));
  return result;
}
export function projectEvaluationForOptimizer(value: unknown): RecordValue | null {
  const v = object(value); if (!v || !RSI_PHASES.includes(v.phase as never) || v.phase === 'final') return null;
  if (v.phase === 'sealed') return v.state === 'completed' && v.infraErrorRatio === 0 && num(v.score)
    && (v.sealedVerdict === 'accept' || v.sealedVerdict === 'reject') ? { verdict: v.sealedVerdict } : null;
  const fields = { phase: member(RSI_PHASES), state: member(['queued', 'running', 'completed', 'infra_failed', 'invalidated']) };
  if (v.phase === 'adversarial' || v.phase === 'ablation') return pick(v, fields);
  const result = pick(v, { ...fields, id: string, repetitions: int, score: nullable(num), infraErrorRatio: nullable(num) });
  if (Array.isArray(v.passedCounts) && v.passedCounts.every(int)) result.passedCounts = [...v.passedCounts];
  return result;
}
export function projectRunForOptimizer(value: unknown, phase: RsiPhase): RecordValue | null {
  const v = object(value); if (!v || (phase !== 'smoke' && phase !== 'train') || !['pass', 'fail', 'infra_error'].includes(v.outcome as string)) return null;
  return pick(v, { id: string, questionId: string, repetition: int, attempt: member([0, 1]), outcome: member(['pass', 'fail', 'infra_error']),
    failureReason: nullable(member(['test_failed', 'agent_timeout', 'run_token_budget', 'infrastructure'])), durationMs: num, proxyTokens: nullable(int), at: string });
}
export function projectFindingForOptimizer(value: unknown): RecordValue | null {
  const v = object(value); if (!v || !categories.includes(v.category as string)) return null;
  if (v.level === 'L3' || v.level === 'L4') return v.severity === 'hold' ? { held: true, category: v.category } : null;
  return v.level === 'L0' || v.level === 'L1' ? pick(v, { category: member(categories), severity: member(['reject', 'hold', 'info']) }) : null;
}
export function projectDecisionForOptimizer(value: unknown): RecordValue | null {
  const v = object(value); if (!v || !['promote', 'reject', 'hold', 'rollback'].includes(v.verdict as string)) return null;
  return { verdict: v.verdict };
}
export function projectInstructionForOptimizer(value: unknown): RecordValue | null {
  const v = object(value); if (!v || !['prohibition', 'idea'].includes(v.kind as string)) return null;
  return pick(v, { id: string, kind: member(['prohibition', 'idea']), text: string, effectiveFromSeq: int });
}
