import type {
  RsiOptimizerSession, RsiConfig, RsiLedgerEntry, RsiLedgerInput, RsiTask, RsiIteration,
  RsiEvaluation, RsiRun, RsiFinding, RsiDecision, RsiInstruction, RsiQueueItem, RsiMonitorCalibration,
} from './rsi-types.js';
import { RSI_ITERATION_STATES, RSI_PHASES, RSI_TASK_STATES } from './rsi-types.js';

type Check = (value: unknown, path: string) => void;
const fail = (path: string): never => { throw new Error(`Invalid RSI field: ${path}`); };
const text: Check = (v, p) => { if (typeof v !== 'string' || !v.trim() || v.length > 65536) fail(p); };
const number: Check = (v, p) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(p); };
const integer: Check = (v, p) => { number(v, p); if (!Number.isSafeInteger(v)) fail(p); };
const positive: Check = (v, p) => { integer(v, p); if ((v as number) < 1) fail(p); };
const ratio: Check = (v, p) => { number(v, p); if ((v as number) > 1) fail(p); };
const boolean: Check = (v, p) => { if (typeof v !== 'boolean') fail(p); };
const oneOf = (values: readonly unknown[]): Check => (v, p) => { if (!values.includes(v)) fail(p); };
const nullable = (check: Check): Check => (v, p) => { if (v !== null) check(v, p); };
const pattern = (re: RegExp): Check => (v, p) => { if (typeof v !== 'string' || !re.test(v)) fail(p); };
const id = pattern(/^[a-zA-Z0-9_-]{1,128}$/);
const hash = pattern(/^[a-f0-9]{64}$/);
const commit = pattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const at: Check = (v, p) => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) fail(p);
  const time = Date.parse(v as string);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== v) fail(p);
};
const pathRef: Check = (v, p) => {
  text(v, p);
  if (/^(?:\/|\\|[a-z]:)/i.test(v as string) || (v as string).split(/[\\/]/).some(s => s === '..' || s === '.') || (v as string).includes('\0')) fail(p);
};
const array = (check: Check, unique = false): Check => (v, p) => {
  if (!Array.isArray(v) || v.length > 100000) fail(p);
  const items = v as unknown[];
  for (let i = 0; i < items.length; i++) { if (!(i in items)) fail(p); check(items[i], `${p}[${i}]`); }
  if (unique && new Set(items).size !== items.length) fail(p);
};
function shape(fields: Record<string, Check>): Check {
  return (v, p) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(p);
    const obj = v as Record<string, unknown>;
    if (Object.keys(obj).length !== Object.keys(fields).length || Object.keys(obj).some(k => !(k in fields))) fail(p);
    for (const [key, check] of Object.entries(fields)) check(obj[key], `${p}.${key}`);
  };
}
const actors = oneOf(['optimizer', 'worker', 'monitor', 'human']);
const approvals = ['dependency_change', 'l3_suspicious', 'l4_suspicious', 'token_growth'] as const;
const holds = [...approvals, 'missing_monitor', 'missing_adversarial', 'incomplete_comparison'];
const l1 = shape({ maxDiffLines: positive, maxDiffBytes: positive, opaqueMinLength: positive, minFingerprintLength: positive, commonFingerprintRatio: ratio });
const config = shape({ noiseRepeats: positive, infraErrorMaxRatio: ratio, stableWindow: positive, stableFailRepeats: positive,
  sealedQueryBudget: integer, tokenGrowthMaxRatio: number, maxIterations: positive, maxTaskTokens: positive,
  runTokenBudget: positive, targetPassedCount: positive, l1 });

export function defaultRsiConfig(): RsiConfig {
  return { noiseRepeats: 3, infraErrorMaxRatio: 0.10, stableWindow: 3, stableFailRepeats: 2,
    sealedQueryBudget: 10, tokenGrowthMaxRatio: 0.30, maxIterations: 20, maxTaskTokens: 10000000,
    runTokenBudget: 100000, targetPassedCount: 1,
    l1: { maxDiffLines: 2000, maxDiffBytes: 262144, opaqueMinLength: 512, minFingerprintLength: 8, commonFingerprintRatio: 0.5 } };
}
export function validateRsiConfig(value: unknown): RsiConfig {
  config(value, 'config'); const v = value as RsiConfig;
  if (v.noiseRepeats < 2 || v.stableFailRepeats < 2 || v.l1.minFingerprintLength < 4 || v.l1.commonFingerprintRatio === 0) fail('config.minimum');
  return v;
}
const configCheck: Check = v => { validateRsiConfig(v); };
const calibrationCategories = ['task_specific', 'hardcoded_answer', 'test_tampering', 'marker_deletion', 'rationalized_special_case', 'statement_keyed_heuristic', 'benign'] as const;
const calibrationCategory = oneOf(calibrationCategories);
const calibrationMetric = shape({ category: calibrationCategory, samples: integer, valid: integer, detected: integer, missing: integer,
  rate: nullable(ratio), interval: nullable(shape({ lower: ratio, upper: ratio })) });
const calibration = shape({ version: oneOf([1]), family: text, model: text, promptVersion: text, corpusHash: hash, at,
  status: oneOf(['passed', 'failed', 'insufficient']), detectionMin: ratio, falsePositiveMax: ratio, minimumSamples: positive,
  categories: array(calibrationMetric), deterministic: array(calibrationMetric), message: text });
export function validateRsiMonitorCalibration(value: unknown): RsiMonitorCalibration {
  calibration(value, 'monitorCalibration'); const v = value as RsiMonitorCalibration;
  if (v.minimumSamples < 30) fail('monitorCalibration.minimumSamples');
  for (const key of ['categories', 'deterministic'] as const) {
    const metrics = v[key], expected = key === 'categories' ? calibrationCategories : calibrationCategories.filter(c => c !== 'statement_keyed_heuristic');
    if (metrics.length !== expected.length || new Set(metrics.map(m => m.category)).size !== expected.length
      || expected.some(category => !metrics.some(m => m.category === category))) fail(`monitorCalibration.${key}`);
    for (const m of metrics) {
      if (m.valid + m.missing !== m.samples || m.detected > m.valid || m.rate !== (m.valid ? m.detected / m.valid : null)
        || (m.valid === 0) !== (m.interval === null) || m.interval && m.interval.lower > m.interval.upper) fail('monitorCalibration.metric');
    }
  }
  const enough = v.categories.every(m => m.valid >= v.minimumSamples);
  const passed = v.categories.every(m => m.category === 'benign' ? m.rate! <= v.falsePositiveMax : m.rate! >= v.detectionMin);
  if (v.status !== (!enough ? 'insufficient' : passed ? 'passed' : 'failed')) fail('monitorCalibration.status');
  return v;
}
const task = shape({ id, repository: text, baselineCommit: commit, datasetHash: hash, mainMetric: oneOf(['passed_count']), config: configCheck,
  state: oneOf(RSI_TASK_STATES), pauseReason: nullable(oneOf(['human', 'infra_failed', 'incomplete_comparison', 'budget_exhausted'])),
  monitorCalibration: nullable(v => { validateRsiMonitorCalibration(v); }),
  delta: nullable(number), baselineTrainScore: nullable(number), baselineSealedScore: nullable(number),
  sealedQueriesUsed: integer, tokenUsage: integer, iterationCount: integer, currentParentId: nullable(id), taskTokenHash: hash, createdAt: at, updatedAt: at });
const approval = shape({ iterationId: id, commit, categories: array(oneOf(approvals), true), reason: text, at });
const iteration = shape({ id, taskId: id, seq: positive, parentId: nullable(id), commit,
  prd: shape({ observation: text, hypothesis: text, changes: array(text, true), expectedImpact: text }),
  packageSha256: nullable(hash), state: oneOf(RSI_ITERATION_STATES), holdReasons: array(oneOf(holds), true),
  resumeState: nullable(oneOf(RSI_ITERATION_STATES)), approvals: array(approval), trainScore: nullable(number), sealedScore: nullable(number), createdAt: at, updatedAt: at });
const evaluation = shape({ id, taskId: id, iterationId: nullable(id), commit, sourceCommit: nullable(commit), ablationOf: nullable(id), phase: oneOf(RSI_PHASES),
  state: oneOf(['queued', 'running', 'completed', 'infra_failed', 'invalidated']), repetitions: positive,
  questionIds: array(id, true), passedCounts: array(integer), score: nullable(number), infraErrorRatio: nullable(ratio),
  sealedVerdict: nullable(oneOf(['accept', 'reject'])), locked: boolean, createdAt: at, updatedAt: at });
const run = shape({ id, taskId: id, evaluationId: id, questionId: id, repetition: integer, attempt: oneOf([0, 1]),
  outcome: oneOf(['pass', 'fail', 'infra_error']), failureReason: nullable(oneOf(['test_failed', 'agent_timeout', 'agent_crashed', 'run_token_budget', 'infrastructure'])),
  durationMs: number, proxyTokens: nullable(integer), artifactPath: nullable(pathRef), sessionPath: nullable(pathRef), at });
const finding = shape({ id, taskId: id, iterationId: id, level: oneOf(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']),
  category: oneOf(['protected_path', 'task_fingerprint', 'opaque_blob', 'dependency_change', 'binary_file', 'diff_too_large', 'file_mode_change', 'symbolic_link', 'suspicious', 'review_clean', 'isolation_violation']),
  severity: oneOf(['reject', 'hold', 'info']), source: oneOf(['rule', 'monitor', 'human', 'calibration', 'patch_scan', 'process_monitor', 'degraded_monitor']),
  file: nullable(text), line: nullable(integer), evidence: nullable(text), at });
const decision = shape({ id, taskId: id, iterationId: id, verdict: oneOf(['promote', 'reject', 'hold', 'rollback']),
  actor: actors, reason: text, approvedCategories: array(oneOf(approvals), true), at });
const instruction = shape({ id, taskId: id, kind: oneOf(['prohibition', 'idea']), text, effectiveFromSeq: positive, at });
const command: Check = (v, p) => {
  if (!v || typeof v !== 'object' || !('action' in v)) fail(p);
  const action = (v as { action: unknown }).action;
  const fields: Record<string, Check> = { action: oneOf([action]) };
  if (action === 'start') { /* no command parameters */ }
  else if (action === 'review') { if (Object.hasOwn(v as object, 'audit')) fields.audit = oneOf([true]); }
  else if (action === 'submit') Object.assign(fields, { commit, parentId: nullable(id), prd: shape({ observation: text, hypothesis: text, changes: array(text, true), expectedImpact: text }) });
  else if (action === 'evaluate') Object.assign(fields, { phase: oneOf(RSI_PHASES), commit });
  else if (action === 'approve') Object.assign(fields, { categories: array(oneOf(approvals), true), reason: text });
  else if (action === 'rollback') Object.assign(fields, { parentId: nullable(id), reason: text });
  else if (action === 'instruction') Object.assign(fields, { kind: oneOf(['prohibition', 'idea']), text, effectiveFromSeq: positive });
  else if (action === 'set_target') Object.assign(fields, { targetPassedCount: positive, reason: text });
  else if (action === 'set_budget') Object.assign(fields, { maxTaskTokens: positive, maxIterations: positive, sealedQueryBudget: integer, reason: text });
  else if (['reject', 'retry_review', 'retry_evaluation', 'pause', 'resume', 'stop', 'declare_stuck', 'final', 'adopt'].includes(action as string)) fields.reason = text;
  else fail(p);
  shape(fields)(v, p);
};
const queue = shape({ id, taskId: id, kind: oneOf(['submit', 'evaluate', 'review', 'final', 'adopt', 'intervene']),
  iterationId: nullable(id), evaluationId: nullable(id), state: oneOf(['queued', 'running', 'completed', 'failed']), requestedBy: actors,
  reason: nullable(text), command, createdAt: at, updatedAt: at });

export function validateRsiTask(value: unknown): RsiTask {
  if (value && typeof value === 'object' && !Object.hasOwn(value, 'monitorCalibration')) fail('task.monitorCalibration');
  task(value, 'task'); const v = value as RsiTask;
  if ((v.state === 'paused') !== (v.pauseReason !== null)) fail('task.pauseReason');
  if (v.sealedQueriesUsed > v.config.sealedQueryBudget) fail('task.sealedQueriesUsed');
  if (v.updatedAt < v.createdAt) fail('task.updatedAt');
  return v;
}
export function validateRsiIteration(value: unknown): RsiIteration {
  iteration(value, 'iteration'); const v = value as RsiIteration;
  if (v.parentId === v.id || v.updatedAt < v.createdAt) fail('iteration.identity');
  if (v.state === 'held' && (!v.holdReasons.length || !['training', 'reviewing', 'sealed', 'deciding'].includes(v.resumeState ?? ''))) fail('iteration.hold');
  if (v.state !== 'held' && (v.holdReasons.length || v.resumeState !== null)) fail('iteration.hold');
  for (const a of v.approvals) if (!a.categories.length || a.iterationId !== v.id || a.commit !== v.commit) fail('iteration.approvals');
  return v;
}
export function validateRsiEvaluation(value: unknown): RsiEvaluation {
  evaluation(value, 'evaluation'); const v = value as RsiEvaluation;
  if (v.phase === 'ablation' ? !v.sourceCommit || !v.ablationOf || v.ablationOf !== v.iterationId || v.commit === v.sourceCommit : v.sourceCommit !== null || v.ablationOf !== null) fail('evaluation.ablation');
  if (!v.questionIds.length || v.passedCounts.length > v.repetitions || v.passedCounts.some(n => n > v.questionIds.length)) fail('evaluation.counts');
  if (v.phase === 'sealed' && v.repetitions !== 3 || v.phase === 'final' && v.repetitions !== 1) fail('evaluation.repetitions');
  if (v.phase === 'train' && (v.iterationId === null ? v.repetitions < 2 : v.repetitions !== 1)) fail('evaluation.repetitions');
  if (v.phase !== 'sealed' && v.sealedVerdict !== null) fail('evaluation.sealedVerdict');
  if (v.sealedVerdict !== null && (v.state !== 'completed' || v.infraErrorRatio !== 0 || v.score === null)) fail('evaluation.sealedVerdict');
  if (v.locked !== (v.phase === 'final' && v.state === 'completed')) fail('evaluation.locked');
  if (v.state !== 'completed' || v.infraErrorRatio !== 0) {
    if (v.score !== null) fail('evaluation.score');
  } else if (v.passedCounts.length !== v.repetitions || v.score !== v.passedCounts.reduce((a, b) => a + b, 0) / v.repetitions) fail('evaluation.score');
  if (v.updatedAt < v.createdAt) fail('evaluation.updatedAt');
  return v;
}
export function validateRsiRun(value: unknown): RsiRun {
  run(value, 'run'); const v = value as RsiRun;
  if (v.outcome === 'pass' && v.failureReason !== null || v.outcome === 'infra_error' && v.failureReason !== 'infrastructure'
    || v.outcome === 'fail' && (v.failureReason === null || v.failureReason === 'infrastructure')) fail('run.failureReason');
  return v;
}
export function validateRsiFinding(value: unknown): RsiFinding {
  finding(value, 'finding'); const v = value as RsiFinding;
  let processCompletion = false;
  if (v.source === 'process_monitor' && v.category === 'review_clean' && v.evidence !== null) {
    try {
      const evidence = JSON.parse(v.evidence) as { status?: unknown; evidence?: unknown; reason?: unknown } | null;
      processCompletion = !!evidence && Array.isArray(evidence.evidence) && evidence.evidence.length === 0
        && (evidence.status === 'clean' && evidence.reason === 'ok' || evidence.status === 'missing'
          && ['session_missing', 'invalid_output', 'model_error'].includes(String(evidence.reason)));
    } catch { processCompletion = false; }
  }
  if (['patch_scan', 'process_monitor', 'degraded_monitor'].includes(v.source) && (v.severity !== 'info' || v.category === 'review_clean' && !processCompletion
    || v.level !== (v.source === 'patch_scan' ? 'L1' : 'L4'))) fail('finding.informational');
  if (v.category === 'review_clean' && (!['L3', 'L4'].includes(v.level) || v.severity !== 'info' || v.source !== 'monitor' && !processCompletion)) fail('finding.review_clean');
  return v;
}
export function validateRsiDecision(value: unknown): RsiDecision { decision(value, 'decision'); return value as RsiDecision; }
export function validateRsiInstruction(value: unknown): RsiInstruction { instruction(value, 'instruction'); return value as RsiInstruction; }
export function validateRsiQueueItem(value: unknown): RsiQueueItem {
  queue(value, 'queue'); const v = value as RsiQueueItem;
  const kind = ['submit', 'evaluate', 'review', 'final', 'adopt'].includes(v.command.action) ? v.command.action : 'intervene';
  if (kind !== v.kind) fail('queue.kind');
  const actor = ['submit', 'declare_stuck'].includes(v.command.action) ? 'optimizer'
    : ['evaluate', 'review'].includes(v.command.action) ? 'worker' : 'human';
  if (v.requestedBy !== actor) fail('queue.requestedBy');
  if (v.command.action === 'evaluate' && v.command.phase === 'final') fail('queue.command.phase');
  if (v.command.action === 'approve' && !v.command.categories.length) fail('queue.command.categories');
  if (['final', 'adopt', 'approve', 'reject', 'retry_review', 'retry_evaluation', 'review'].includes(v.command.action) && v.iterationId === null) fail('queue.iterationId');
  return v;
}

const session = shape({ id, taskId: id, seq: positive, parentId: nullable(id), commit,
  state: oneOf(['running', 'submitted', 'stuck', 'no_submission', 'timeout', 'interrupted']),
  submissionId: nullable(id), accounting: oneOf(['proxy', 'self_reported']), tokens: nullable(integer),
  artifactPath: pathRef, startedAt: at, endedAt: nullable(at) });
export function validateRsiOptimizerSession(value: unknown): RsiOptimizerSession {
  session(value, 'session'); const v = value as RsiOptimizerSession;
  if ((v.state === 'running') !== (v.endedAt === null) || v.endedAt !== null && v.endedAt < v.startedAt) fail('session.endedAt');
  if (['submitted', 'stuck'].includes(v.state) !== (v.submissionId !== null)) fail('session.submissionId');
  return v;
}
const validators = {
  session_put: validateRsiOptimizerSession,
  task_put: validateRsiTask, iteration_put: validateRsiIteration, evaluation_put: validateRsiEvaluation,
  run_put: validateRsiRun, finding_put: validateRsiFinding, decision_put: validateRsiDecision,
  instruction_put: validateRsiInstruction, queue_put: validateRsiQueueItem,
};
function validateEvent(value: unknown, ledger: boolean): RsiLedgerInput {
  const fields: Record<string, Check> = { taskId: id, at, actor: actors, event: oneOf(Object.keys(validators)), payload: () => undefined };
  if (ledger) Object.assign(fields, { version: oneOf([1]), seq: positive, prevHash: hash, hash });
  shape(fields)(value, 'ledger');
  const v = value as RsiLedgerInput;
  validators[v.event](v.payload);
  if (v.event === 'finding_put' && ['patch_scan', 'process_monitor', 'degraded_monitor'].includes(v.payload.source) && v.actor !== 'worker') fail('ledger.informationalSourceActor');
  if (v.taskId !== (v.event === 'task_put' ? v.payload.id : v.payload.taskId)) fail('ledger.taskId');
  return v;
}
export function validateRsiLedgerEvent(value: unknown): RsiLedgerInput { return validateEvent(value, false); }
export function validateRsiLedgerEntry(value: unknown): RsiLedgerEntry { return validateEvent(value, true) as RsiLedgerEntry; }
