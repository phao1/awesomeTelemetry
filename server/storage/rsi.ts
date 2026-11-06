import Database, { type Database as Db, type Statement } from 'better-sqlite3';

import type {
  RsiOptimizerSession, RsiEvaluation, RsiIteration, RsiLedgerEntry, RsiLedgerHead, RsiQueueItem, RsiRun, RsiTask,
} from '../../src/core/rsi-types.js';
import { calibrateNoiseBand } from '../../src/core/rsi-noise.js';
import { validateIterationSnapshotTransition, validateTaskSnapshotTransition } from '../../src/core/rsi-state-machine.js';
import { validateRsiLedgerEntry } from '../../src/core/rsi-validation.js';
import {
  canonicalJson, computeLedgerHash, LedgerIntegrityError, RSI_LEDGER_GENESIS_HASH, verifyLedger,
} from '../rsi/ledger.js';
import {
  RSI_SESSION_COLS, RSI_DECISION_COLS, RSI_EVALUATION_COLS, RSI_FINDING_COLS, RSI_HEAD_COLS,
  RSI_INSTRUCTION_COLS, RSI_ITERATION_COLS, RSI_QUEUE_COLS, RSI_RUN_COLS, RSI_TASK_COLS,
} from './columns.js';
import { RSI_SCHEMA_SQL } from './schema.js';
import { cachedStmt } from './stmt-cache.js';

type EventName = RsiLedgerEntry['event'];
type Row = Record<string, string | number | null>;
interface EntityRow { entity_json: string; ledger_seq?: number }
interface Definition { event: EventName; table: string; columns: string; taskColumn: string }
const DEFINITIONS: readonly Definition[] = [
  { event: 'task_put', table: 'rsi_tasks', columns: RSI_TASK_COLS, taskColumn: 'id' },
  { event: 'iteration_put', table: 'rsi_iterations', columns: RSI_ITERATION_COLS, taskColumn: 'task_id' },
  { event: 'evaluation_put', table: 'rsi_evaluations', columns: RSI_EVALUATION_COLS, taskColumn: 'task_id' },
  { event: 'run_put', table: 'rsi_runs', columns: RSI_RUN_COLS, taskColumn: 'task_id' },
  { event: 'finding_put', table: 'rsi_findings', columns: RSI_FINDING_COLS, taskColumn: 'task_id' },
  { event: 'decision_put', table: 'rsi_decisions', columns: RSI_DECISION_COLS, taskColumn: 'task_id' },
  { event: 'instruction_put', table: 'rsi_instructions', columns: RSI_INSTRUCTION_COLS, taskColumn: 'task_id' },
  { event: 'session_put', table: 'rsi_sessions', columns: RSI_SESSION_COLS, taskColumn: 'task_id' },
  { event: 'queue_put', table: 'rsi_queue', columns: RSI_QUEUE_COLS, taskColumn: 'task_id' },
];
interface TableStatements { get: Statement; put: Statement; remove: Statement; list: Statement }
interface Statements {
  tables: Record<EventName, TableStatements>;
  head: Statement; putHead: Statement; removeHead: Statement; retrySource: Statement;
  evaluationRuns: Statement; completedEvaluations: Statement; sealedGroups: Statement; iterationSealedGroup: Statement; promotedIterations: Statement; finalHistory: Statement;
}
const statementCache = new WeakMap<Db, Statements>();

/** Prepare once per connection, before any ledger replay or row-copy loop. */
function statements(db: Db): Statements {
  const existing = statementCache.get(db);
  if (existing) return existing;
  const tables = Object.fromEntries(DEFINITIONS.map(definition => {
    const columns = definition.columns.split(', ');
    const primary = definition.event === 'task_put' ? ['id'] : ['task_id', 'id'];
    const assignments = columns.filter(column => !primary.includes(column)).map(column => `${column}=excluded.${column}`).join(', ');
    return [definition.event, {
      get: cachedStmt(db, `SELECT ${definition.columns} FROM ${definition.table} WHERE ${definition.taskColumn}=@task_id AND id=@id`),
      put: cachedStmt(db, `INSERT INTO ${definition.table} (${definition.columns}) VALUES (${columns.map(column => `@${column}`).join(', ')}) ON CONFLICT(${primary.join(', ')}) DO UPDATE SET ${assignments}`),
      remove: cachedStmt(db, `DELETE FROM ${definition.table} WHERE ${definition.taskColumn}=?`),
      list: cachedStmt(db, `SELECT ${definition.columns} FROM ${definition.table} WHERE ${definition.taskColumn}=? ORDER BY id`),
    }];
  })) as Record<EventName, TableStatements>;
  const result: Statements = {
    tables,
    head: cachedStmt(db, `SELECT ${RSI_HEAD_COLS} FROM rsi_heads WHERE task_id=?`),
    putHead: cachedStmt(db, 'INSERT INTO rsi_heads (task_id, seq, hash) VALUES (@task_id, @seq, @hash) ON CONFLICT(task_id) DO UPDATE SET seq=excluded.seq, hash=excluded.hash'),
    removeHead: cachedStmt(db, 'DELETE FROM rsi_heads WHERE task_id=?'),
    evaluationRuns: cachedStmt(db, `SELECT ${RSI_RUN_COLS} FROM rsi_runs WHERE task_id=@task_id AND evaluation_id=@evaluation_id ORDER BY question_id,repetition,attempt`),
    completedEvaluations: cachedStmt(db, `SELECT ${RSI_EVALUATION_COLS} FROM rsi_evaluations WHERE task_id=@task_id AND iteration_id IS @iteration_id AND phase=@phase AND state='completed' ORDER BY ledger_seq,id`),
    sealedGroups: cachedStmt(db, "SELECT COUNT(DISTINCT iteration_id) AS count FROM rsi_evaluations WHERE task_id=? AND phase='sealed' AND iteration_id IS NOT NULL"),
    iterationSealedGroup: cachedStmt(db, `SELECT ${RSI_EVALUATION_COLS} FROM rsi_evaluations WHERE task_id=@task_id AND iteration_id=@iteration_id AND phase='sealed' ORDER BY ledger_seq,id`),
    finalHistory: cachedStmt(db, `SELECT ${RSI_EVALUATION_COLS} FROM rsi_evaluations WHERE task_id=@task_id AND commit_sha=@commit_sha AND phase='final' ORDER BY ledger_seq,id`),
    promotedIterations: cachedStmt(db, `SELECT ${RSI_ITERATION_COLS} FROM rsi_iterations WHERE task_id=? AND state='promoted' ORDER BY seq`),
    retrySource: cachedStmt(db, `SELECT ${RSI_RUN_COLS} FROM rsi_runs WHERE task_id=@task_id AND evaluation_id=@evaluation_id AND question_id=@question_id AND repetition=@repetition AND attempt=0`),
  };
  statementCache.set(db, result);
  return result;
}

function stored<T>(suite: Statements, event: EventName, taskId: string, id: string): T | null {
  const row = suite.tables[event].get.get({ task_id: taskId, id }) as EntityRow | undefined;
  return row ? JSON.parse(row.entity_json) as T : null;
}
function required<T>(suite: Statements, event: EventName, taskId: string, id: string): T {
  const value = stored<T>(suite, event, taskId, id);
  if (value === null) throw new Error('RSI index missing same-task reference');
  return value;
}
function unchanged(before: unknown, after: unknown): void {
  if (canonicalJson(before) !== canonicalJson(after)) throw new Error('RSI index immutable record or identity');
}
function terminalEvaluation(value: RsiEvaluation): boolean {
  return ['completed', 'infra_failed', 'invalidated'].includes(value.state);
}
function completedEvaluation(suite: Statements, taskId: string, iterationId: string | null, phase: RsiEvaluation['phase']): RsiEvaluation | null {
  const rows = suite.completedEvaluations.all({ task_id: taskId, iteration_id: iterationId, phase }) as EntityRow[];
  return rows.map(row => JSON.parse(row.entity_json) as RsiEvaluation).find(value => value.score !== null && value.infraErrorRatio === 0) ?? null;
}
function evaluationTally(suite: Statements, value: RsiEvaluation): {
  passedCounts: number[]; infraErrorRatio: number; repetitions: Array<Array<{ questionId: string; outcome: RsiRun['outcome'] }>>;
} {
  const rows = suite.evaluationRuns.all({ task_id: value.taskId, evaluation_id: value.id }) as EntityRow[];
  const slots = new Map<string, RsiRun[]>();
  for (const row of rows) {
    const run = JSON.parse(row.entity_json) as RsiRun;
    const key = `${run.questionId}:${run.repetition}`;
    const attempts = slots.get(key) ?? [];
    attempts.push(run); slots.set(key, attempts);
  }
  const passedCounts: number[] = [];
  const repetitions: Array<Array<{ questionId: string; outcome: RsiRun['outcome'] }>> = [];
  let infraErrors = 0;
  for (let repetition = 0; repetition < value.repetitions; repetition += 1) {
    let passed = 0;
    const results: Array<{ questionId: string; outcome: RsiRun['outcome'] }> = [];
    for (const questionId of value.questionIds) {
      const attempts = slots.get(`${questionId}:${repetition}`) ?? [];
      const first = attempts.find(run => run.attempt === 0);
      const last = first?.outcome === 'infra_error' ? attempts.find(run => run.attempt === 1) : first;
      if (!last) throw new Error('RSI index evaluation has incomplete run evidence');
      if (last.outcome === 'pass') passed += 1;
      if (last.outcome === 'infra_error') infraErrors += 1;
      results.push({ questionId, outcome: last.outcome });
    }
    passedCounts.push(passed); repetitions.push(results);
  }
  return { passedCounts, infraErrorRatio: infraErrors / (value.questionIds.length * value.repetitions), repetitions };
}
function validateEvaluationResult(suite: Statements, task: RsiTask, value: RsiEvaluation): void {
  if (value.state !== 'completed' && value.state !== 'infra_failed') return;
  const actual = evaluationTally(suite, value);
  if (canonicalJson(value.passedCounts) !== canonicalJson(actual.passedCounts) || value.infraErrorRatio !== actual.infraErrorRatio) {
    throw new Error('RSI index evaluation summary does not match runs');
  }
  const expectedState = actual.infraErrorRatio > task.config.infraErrorMaxRatio ? 'infra_failed' : 'completed';
  const expectedScore = actual.infraErrorRatio === 0 ? actual.passedCounts.reduce((sum, count) => sum + count, 0) / value.repetitions : null;
  if (value.state !== expectedState || value.score !== expectedScore) throw new Error('RSI index evaluation score/state does not match runs');
}
function validateSnapshot(suite: Statements, entry: RsiLedgerEntry): void {
  if (entry.event === 'task_put') {
    const after = entry.payload;
    const before = stored<RsiTask>(suite, 'task_put', entry.taskId, after.id);
    if (before === null && (after.delta !== null || after.baselineTrainScore !== null || after.baselineSealedScore !== null
      || after.sealedQueriesUsed !== 0 || after.tokenUsage !== 0 || after.iterationCount !== 0 || after.currentParentId !== null)) {
      throw new Error('RSI index new task must have empty measurements');
    }
    if (before !== null) {
      for (const key of ['delta', 'baselineTrainScore', 'baselineSealedScore'] as const) {
        if (before[key] !== null) unchanged(before[key], after[key]);
        if (before[key] !== after[key] && entry.actor !== 'worker') throw new Error('RSI index task measurements require worker');
      }
      if (before.delta !== after.delta || before.baselineTrainScore !== after.baselineTrainScore) {
        const baseline = completedEvaluation(suite, entry.taskId, null, 'train');
        if (!baseline || baseline.repetitions !== after.config.noiseRepeats) throw new Error('RSI index baseline train evidence missing');
        const tally = evaluationTally(suite, baseline);
        const noise = calibrateNoiseBand({ repetitions: tally.repetitions, plannedQuestionIds: baseline.questionIds, infraErrorMaxRatio: after.config.infraErrorMaxRatio });
        if (after.delta !== null && after.delta !== noise.delta || after.baselineTrainScore !== null && after.baselineTrainScore !== noise.baselineTrainScore) {
          throw new Error('RSI index calibration does not match baseline runs');
        }
      }
      if (before.baselineSealedScore !== after.baselineSealedScore) {
        const sealed = completedEvaluation(suite, entry.taskId, null, 'sealed');
        if (!sealed || after.baselineSealedScore !== sealed.score) throw new Error('RSI index baseline sealed evidence missing');
      }
    }
    if (before?.state !== 'paused' && after.state === 'paused' && after.pauseReason === 'budget_exhausted'
      && after.tokenUsage < after.config.maxTaskTokens && after.iterationCount < after.config.maxIterations) {
      throw new Error('RSI index budget pause requires exhausted budget');
    }
    const promoted = (suite.promotedIterations.all(entry.taskId) as EntityRow[]).map(row => JSON.parse(row.entity_json) as RsiIteration);
    validateTaskSnapshotTransition(before, after, {
      actor: entry.actor, reason: after.pauseReason ?? 'ledger task transition',
      budgetAvailable: after.tokenUsage < after.config.maxTaskTokens && after.iterationCount < after.config.maxIterations,
      calibrationComplete: after.delta !== null && after.baselineTrainScore !== null && after.baselineSealedScore !== null,
      targetReached: promoted.some(value => value.trainScore !== null && value.trainScore >= after.config.targetPassedCount),
    });
    return;
  }
  if (entry.event !== 'iteration_put') return;
  const after = entry.payload;
  const before = stored<RsiIteration>(suite, 'iteration_put', entry.taskId, after.id);
  const task = required<RsiTask>(suite, 'task_put', entry.taskId, entry.taskId);
  if (before === null && (after.approvals.length || after.trainScore !== null || after.sealedScore !== null || after.packageSha256 !== null)) {
    throw new Error('RSI index new iteration must have no approvals or results');
  }
  if (before !== null) {
    if (after.approvals.length < before.approvals.length) throw new Error('RSI index approvals are append-only');
    unchanged(before.approvals, after.approvals.slice(0, before.approvals.length));
    if (before.state === 'held' && after.state === 'held') {
      unchanged([before.holdReasons, before.resumeState], [after.holdReasons, after.resumeState]);
    }
    for (const key of ['trainScore', 'sealedScore', 'packageSha256'] as const) {
      if (before[key] !== null) unchanged(before[key], after[key]);
      if (before[key] !== after[key] && entry.actor !== 'worker') throw new Error('RSI index iteration results require worker');
    }
  }
  const newApprovals = after.approvals.slice(before?.approvals.length ?? 0);
  if (newApprovals.length && (entry.actor !== 'human' || newApprovals.length !== 1 || before?.state !== 'held' || after.state === 'held')) {
    throw new Error('RSI index new approval requires human held resolution');
  }
  if (newApprovals.length && canonicalJson([...newApprovals[0]!.categories].sort()) !== canonicalJson([...before!.holdReasons].sort())) {
    throw new Error('RSI index approval must resolve the exact held categories');
  }
  if (after.trainScore !== null) {
    const training = completedEvaluation(suite, entry.taskId, after.id, 'train');
    if (!training || after.trainScore !== training.score) throw new Error('RSI index training score lacks first completed evaluation');
  }
  const sealed = completedEvaluation(suite, entry.taskId, after.id, 'sealed');
  if (after.sealedScore !== null && (!sealed || after.sealedScore !== sealed.score)) throw new Error('RSI index sealed score lacks completed evaluation');
  const reserved = suite.iterationSealedGroup.get({ task_id: entry.taskId, iteration_id: after.id }) !== undefined;
  validateIterationSnapshotTransition(before, after, {
    actor: entry.actor, reason: newApprovals[0]?.reason ?? 'ledger iteration transition',
    approvedCategories: newApprovals[0]?.categories,
    sealedBudgetRemaining: task.config.sealedQueryBudget - task.sealedQueriesUsed + (reserved ? 1 : 0),
    hasSealedResult: sealed !== null && after.sealedScore === sealed.score,
  });
}

function validateRelations(suite: Statements, entry: RsiLedgerEntry): void {
  if (entry.event === 'task_put') return;
  const task = required<RsiTask>(suite, 'task_put', entry.taskId, entry.taskId);
  switch (entry.event) {
    case 'iteration_put': {
      const iteration = entry.payload;
      if (iteration.parentId !== null) {
        const parent = required<RsiIteration>(suite, 'iteration_put', entry.taskId, iteration.parentId);
        if (parent.state !== 'promoted' || parent.seq >= iteration.seq) throw new Error('RSI index invalid parent');
      }
      break;
    }
    case 'evaluation_put': {
      const evaluation = entry.payload;
      const expectedCommit = evaluation.iterationId === null ? task.baselineCommit
        : required<RsiIteration>(suite, 'iteration_put', entry.taskId, evaluation.iterationId).commit;
      if (evaluation.commit !== expectedCommit) throw new Error('RSI index evaluation commit mismatch');
      const previous = stored<RsiEvaluation>(suite, 'evaluation_put', entry.taskId, evaluation.id);
      if (previous === null && evaluation.state !== 'queued') throw new Error('RSI index evaluation must begin queued');
      if (evaluation.phase === 'final' && previous === null) {
        const history = (suite.finalHistory.all({ task_id: entry.taskId, commit_sha: evaluation.commit }) as EntityRow[])
          .map(row => JSON.parse(row.entity_json) as RsiEvaluation);
        if (!history.length && entry.actor !== 'human') throw new Error('RSI final evaluation requires human queued reservation');
        if (history.length) {
          if (entry.actor !== 'worker' || history.some(value => value.state !== 'invalidated')) throw new Error('RSI final evaluation already requested');
          if (!['running', 'completed'].includes(task.state) || task.tokenUsage >= task.config.maxTaskTokens || task.iterationCount >= task.config.maxIterations) {
            throw new Error('RSI final recovery requires resumed task budget');
          }
          unchanged([history[0]!.iterationId, history[0]!.commit, history[0]!.questionIds, history[0]!.repetitions],
            [evaluation.iterationId, evaluation.commit, evaluation.questionIds, evaluation.repetitions]);
        }
        if (evaluation.iterationId === null || required<RsiIteration>(suite, 'iteration_put', entry.taskId, evaluation.iterationId).state !== 'promoted') {
          throw new Error('RSI final evaluation requires promoted iteration');
        }
      } else if (entry.actor !== 'worker') throw new Error('RSI index evaluation results require worker');
      if (previous !== null && terminalEvaluation(previous)) break;
      if (evaluation.phase === 'train' && evaluation.iterationId === null && evaluation.repetitions !== task.config.noiseRepeats) {
        throw new Error('RSI index baseline repetitions must match task configuration');
      }
      if (evaluation.phase === 'sealed' && evaluation.iterationId !== null && previous === null) {
        const group = (suite.iterationSealedGroup.all({ task_id: entry.taskId, iteration_id: evaluation.iterationId }) as EntityRow[])
          .map(row => JSON.parse(row.entity_json) as RsiEvaluation);
        const groups = suite.sealedGroups.get(entry.taskId) as { count: number };
        if (!group.length && task.sealedQueriesUsed < groups.count + 1) throw new Error('RSI index sealed evaluation requires reserved budget');
        if (group.some(value => value.state === 'queued' || value.state === 'running' || value.state === 'completed' && value.score !== null)) {
          throw new Error('RSI index sealed group already active or completed');
        }
        if (group.length) unchanged([group[0]!.commit, group[0]!.questionIds, group[0]!.repetitions], [evaluation.commit, evaluation.questionIds, evaluation.repetitions]);
      }
      if (evaluation.state === 'invalidated' && previous?.state !== 'invalidated'
        && (task.state !== 'paused' || task.pauseReason !== 'budget_exhausted')) {
        throw new Error('RSI index invalidation requires task budget pause');
      }
      validateEvaluationResult(suite, task, evaluation);
      break;
    }
    case 'run_put': {
      if (entry.actor !== 'worker') throw new Error('RSI index run results require worker');
      const run = entry.payload;
      const evaluation = required<RsiEvaluation>(suite, 'evaluation_put', entry.taskId, run.evaluationId);
      if (terminalEvaluation(evaluation)) {
        const previous = stored<RsiRun>(suite, 'run_put', entry.taskId, run.id);
        if (previous === null) throw new Error('RSI index completed evaluation is locked');
        unchanged(previous, run);
      }
      if (!evaluation.questionIds.includes(run.questionId) || run.repetition >= evaluation.repetitions) {
        throw new Error('RSI index run outside planned question/repetition');
      }
      if (run.attempt === 1) {
        const prior = suite.retrySource.get({
          task_id: entry.taskId, evaluation_id: run.evaluationId,
          question_id: run.questionId, repetition: run.repetition,
        }) as EntityRow | undefined;
        if (!prior || (JSON.parse(prior.entity_json) as RsiRun).outcome !== 'infra_error') {
          throw new Error('RSI index retry requires infrastructure failure');
        }
      }
      break;
    }
    case 'finding_put':
      required<RsiIteration>(suite, 'iteration_put', entry.taskId, entry.payload.iterationId);
      break;
    case 'decision_put':
      if (entry.actor !== entry.payload.actor) throw new Error('RSI index decision actor mismatch');
      required<RsiIteration>(suite, 'iteration_put', entry.taskId, entry.payload.iterationId);
      break;
    case 'queue_put': {
      const item = entry.payload;
      const previous = stored<RsiQueueItem>(suite, 'queue_put', entry.taskId, item.id);
      if (previous === null ? entry.actor !== item.requestedBy : entry.actor !== 'worker') {
        throw new Error('RSI index queue actor mismatch');
      }
      const target = item.iterationId === null ? null : required<RsiIteration>(suite, 'iteration_put', entry.taskId, item.iterationId);
      const evaluation = item.evaluationId === null ? null : required<RsiEvaluation>(suite, 'evaluation_put', entry.taskId, item.evaluationId);
      if (evaluation !== null && evaluation.iterationId !== item.iterationId) {
        throw new Error('RSI index queue evaluation/iteration mismatch');
      }
      if (item.command.action === 'evaluate' && (evaluation === null
        || item.command.commit !== evaluation.commit || item.command.phase !== evaluation.phase)) {
        throw new Error('RSI index queue evaluate command mismatch');
      }
      if ((item.kind === 'final' || item.kind === 'adopt') && target?.state !== 'promoted') {
        throw new Error('RSI index final/adopt requires promoted iteration');
      }
      if (item.kind === 'final' && evaluation !== null && evaluation.phase !== 'final') {
        throw new Error('RSI index final queue phase mismatch');
      }
      if ((item.kind === 'final' || item.kind === 'adopt') && item.requestedBy !== 'human') {
        throw new Error('RSI index human-only queue command');
      }
      break;
    }
    case 'session_put': {
      if (entry.actor !== 'worker') throw new Error('RSI sessions require worker');
      const v = entry.payload, before = stored<RsiOptimizerSession>(suite, 'session_put', entry.taskId, v.id);
      if (!before && v.state !== 'running') throw new Error('Session must begin running');
      const parent = v.parentId === null ? null : required<RsiIteration>(suite, 'iteration_put', entry.taskId, v.parentId);
      if (parent && parent.state !== 'promoted' || v.commit !== (parent?.commit ?? task.baselineCommit)) throw new Error('Invalid session parent');
      if (!before && (suite.tables.session_put.list.all(entry.taskId) as EntityRow[]).some(row => (JSON.parse(row.entity_json) as RsiOptimizerSession).state === 'running')) throw new Error('Optimizer session already running');
      if (v.submissionId !== null) {
        const q = required<RsiQueueItem>(suite, 'queue_put', entry.taskId, v.submissionId);
        if (q.requestedBy !== 'optimizer' || q.createdAt < v.startedAt || q.command.action !== (v.state === 'stuck' ? 'declare_stuck' : 'submit')) throw new Error('Invalid session submission');
        if (q.command.action === 'submit' && q.command.parentId !== v.parentId) throw new Error('Session submission parent mismatch');
      }
      break;
    }
    case 'instruction_put':
      if (entry.actor !== 'human') throw new Error('RSI index instruction requires human');
      break;
  }
}

function validateMutation(suite: Statements, entry: RsiLedgerEntry): void {
  const previousRow = suite.tables[entry.event].get.get({ task_id: entry.taskId, id: entry.payload.id }) as EntityRow | undefined;
  if (!previousRow) return;
  const previous: unknown = JSON.parse(previousRow.entity_json);
  switch (entry.event) {
    case 'session_put': {
      const before = previous as RsiOptimizerSession, after = entry.payload;
      unchanged([before.id,before.taskId,before.seq,before.parentId,before.commit,before.accounting,before.artifactPath,before.startedAt], [after.id,after.taskId,after.seq,after.parentId,after.commit,after.accounting,after.artifactPath,after.startedAt]);
      if (before.state !== 'running') unchanged(before, after);
      return;
    }
    case 'run_put':
    case 'finding_put':
    case 'decision_put':
    case 'instruction_put':
      unchanged(previous, entry.payload);
      return;
    case 'iteration_put': {
      const before = previous as RsiIteration;
      const after = entry.payload;
      unchanged([before.taskId, before.id, before.seq, before.parentId, before.commit, before.createdAt],
        [after.taskId, after.id, after.seq, after.parentId, after.commit, after.createdAt]);
      if (before.trainScore !== null) unchanged(before.trainScore, after.trainScore);
      if (before.state === 'promoted' || before.state === 'rejected') unchanged(before, after);
      return;
    }
    case 'evaluation_put': {
      const before = previous as RsiEvaluation;
      const after = entry.payload;
      unchanged([before.taskId, before.id, before.iterationId, before.commit, before.phase, before.repetitions, before.questionIds, before.createdAt],
        [after.taskId, after.id, after.iterationId, after.commit, after.phase, after.repetitions, after.questionIds, after.createdAt]);
      if (terminalEvaluation(before)) unchanged(before, after);
      return;
    }
    case 'queue_put': {
      const before = previous as RsiQueueItem;
      const after = entry.payload;
      unchanged([before.kind, before.iterationId, before.evaluationId, before.requestedBy, before.command, before.reason, before.createdAt],
        [after.kind, after.iterationId, after.evaluationId, after.requestedBy, after.command, after.reason, after.createdAt]);
      return;
    }
    case 'task_put': {
      const before = previous as RsiTask;
      const after = entry.payload;
      unchanged([before.id, before.repository, before.baselineCommit, before.datasetHash, before.mainMetric, before.taskTokenHash, before.createdAt],
        [after.id, after.repository, after.baselineCommit, after.datasetHash, after.mainMetric, after.taskTokenHash, after.createdAt]);
      if (after.sealedQueriesUsed < before.sealedQueriesUsed || after.tokenUsage < before.tokenUsage || after.iterationCount < before.iterationCount) {
        throw new Error('RSI index task counters cannot decrease');
      }
      if (canonicalJson(before.config) !== canonicalJson(after.config) && entry.actor !== 'human') {
        throw new Error('RSI index configuration changes require human');
      }
      return;
    }
  }
}

/** All nullable SQL arguments are explicitly normalized before binding. */
function entityRow(entry: RsiLedgerEntry, evaluationLedgerSeq: number): Row {
  const json = canonicalJson(entry.payload);
  const common = { task_id: entry.taskId, id: entry.payload.id, entity_json: json };
  switch (entry.event) {
    case 'session_put': return { ...common, seq: entry.payload.seq, state: entry.payload.state };
    case 'task_put': return { id: entry.payload.id, state: entry.payload.state, updated_at: entry.payload.updatedAt, entity_json: json };
    case 'iteration_put': return { ...common, seq: entry.payload.seq, parent_id: entry.payload.parentId ?? null, commit_sha: entry.payload.commit,
      state: entry.payload.state, created_at: entry.payload.createdAt };
    case 'evaluation_put': return { ...common, iteration_id: entry.payload.iterationId ?? null, commit_sha: entry.payload.commit,
      phase: entry.payload.phase, state: entry.payload.state, created_at: entry.payload.createdAt, ledger_seq: evaluationLedgerSeq };
    case 'run_put': return { ...common, evaluation_id: entry.payload.evaluationId, question_id: entry.payload.questionId,
      repetition: entry.payload.repetition, attempt: entry.payload.attempt, outcome: entry.payload.outcome };
    case 'finding_put': return { ...common, iteration_id: entry.payload.iterationId, level: entry.payload.level, category: entry.payload.category };
    case 'decision_put': return { ...common, iteration_id: entry.payload.iterationId, verdict: entry.payload.verdict, at: entry.payload.at };
    case 'instruction_put': return { ...common, effective_from_seq: entry.payload.effectiveFromSeq };
    case 'queue_put': return { ...common, kind: entry.payload.kind, state: entry.payload.state, iteration_id: entry.payload.iterationId ?? null,
      evaluation_id: entry.payload.evaluationId ?? null, created_at: entry.payload.createdAt };
  }
}

export function getRsiLedgerHead(db: Db, taskId: string): RsiLedgerHead | null {
  const row = statements(db).head.get(taskId) as (RsiLedgerHead & { task_id: string }) | undefined;
  return row ? { seq: row.seq, hash: row.hash } : null;
}

export function applyRsiLedgerEntry(db: Db, value: RsiLedgerEntry): void {
  const entry = validateRsiLedgerEntry(value);
  const { hash, ...unsigned } = entry;
  if (computeLedgerHash(unsigned) !== hash) throw new Error('RSI index ledger hash mismatch');
  const suite = statements(db);
  db.transaction(() => {
    const head = getRsiLedgerHead(db, entry.taskId);
    if (head?.seq === entry.seq && head.hash === entry.hash) return;
    if (entry.seq !== (head?.seq ?? 0) + 1 || entry.prevHash !== (head?.hash ?? RSI_LEDGER_GENESIS_HASH)) {
      throw new Error('RSI index ledger sequence or chain conflict');
    }
    validateMutation(suite, entry);
    validateRelations(suite, entry);
    validateSnapshot(suite, entry);
    const previous = entry.event === 'evaluation_put'
      ? suite.tables.evaluation_put.get.get({ task_id: entry.taskId, id: entry.payload.id }) as EntityRow | undefined : undefined;
    const previousEvaluation = previous ? JSON.parse(previous.entity_json) as RsiEvaluation : null;
    const evaluationLedgerSeq = previousEvaluation && terminalEvaluation(previousEvaluation) ? previous!.ledger_seq! : entry.seq;
    suite.tables[entry.event].put.run(entityRow(entry, evaluationLedgerSeq));
    suite.putHead.run({ task_id: entry.taskId, seq: entry.seq, hash: entry.hash });
  }).immediate();
}

/** One verified streaming pass, then a synchronous all-table replacement. */
export async function rebuildRsiIndexFromLedger(db: Db, taskId: string, ledgerPath: string): Promise<void> {
  const originalHead = getRsiLedgerHead(db, taskId);
  const staging = new Database(':memory:');
  try {
    staging.pragma('foreign_keys=ON');
    staging.exec(RSI_SCHEMA_SQL);
    const stagedStatements = statements(staging);
    const liveStatements = statements(db);
    const verified = await verifyLedger(ledgerPath, {
      taskId, ...(originalHead === null ? {} : { expectedHead: originalHead }),
      onEntry: entry => { applyRsiLedgerEntry(staging, entry); },
    });
    if (!verified.valid || verified.partialTail !== null) throw new LedgerIntegrityError(verified);
    db.transaction(() => {
      unchanged(originalHead, getRsiLedgerHead(db, taskId));
      liveStatements.removeHead.run(taskId);
      // Delete descendants first; the remaining iteration parent FKs are deferred
      // only for this replacement transaction, never for ordinary writes.
      db.pragma('defer_foreign_keys=ON');
      for (const definition of [...DEFINITIONS].reverse()) liveStatements.tables[definition.event].remove.run(taskId);
      for (const definition of DEFINITIONS) {
        for (const row of stagedStatements.tables[definition.event].list.iterate(taskId) as Iterable<Row>) {
          liveStatements.tables[definition.event].put.run(row);
        }
      }
      const stagedHead = getRsiLedgerHead(staging, taskId);
      if (stagedHead !== null) liveStatements.putHead.run({ task_id: taskId, ...stagedHead });
    }).immediate();
  } finally {
    staging.close();
  }
}
