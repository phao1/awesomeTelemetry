import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  RsiOptimizerSession, RsiEvaluation, RsiIteration, RsiLedgerEntry, RsiLedgerHead, RsiLedgerInput, RsiRun, RsiTask,
} from '../../src/core/rsi-types.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { appendLedger, canonicalJson, computeLedgerHash, RSI_LEDGER_GENESIS_HASH } from '../rsi/ledger.js';
import {
  RSI_SESSION_COLS, RSI_DECISION_COLS, RSI_EVALUATION_COLS, RSI_FINDING_COLS, RSI_HEAD_COLS,
  RSI_INSTRUCTION_COLS, RSI_ITERATION_COLS, RSI_QUEUE_COLS, RSI_RUN_COLS, RSI_TASK_COLS,
} from './columns.js';
import { applyRsiLedgerEntry, getRsiLedgerHead, rebuildRsiIndexFromLedger } from './rsi.js';
import { RSI_SCHEMA_SQL } from './schema.js';
import { cachedStmt } from './stmt-cache.js';

const at = '2026-11-07T00:00:00.000Z';
const baseline = 'a'.repeat(40), candidate = 'b'.repeat(40);
const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
function database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(RSI_SCHEMA_SQL);
  databases.push(db);
  return db;
}
async function ledgerPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rsi-index-'));
  directories.push(directory);
  return join(directory, 'ledger.jsonl');
}
function task(id = 'task-1'): RsiTask {
  return { id, repository: 'synthetic-repository', baselineCommit: baseline, datasetHash: 'c'.repeat(64),
    mainMetric: 'passed_count', config: defaultRsiConfig(), state: 'created', pauseReason: null, delta: null,
    baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0,
    currentParentId: null, taskTokenHash: 'd'.repeat(64), createdAt: at, updatedAt: at };
}
function iteration(): RsiIteration {
  return { id: 'iteration-1', taskId: 'task-1', seq: 1, parentId: null, commit: candidate,
    prd: { observation: 'Repeated reads', hypothesis: 'Reuse parsed data', changes: ['src/agent.ts'], expectedImpact: 'More solved questions' },
    packageSha256: null, state: 'draft', holdReasons: [], resumeState: null, approvals: [], trainScore: null,
    sealedScore: null, createdAt: at, updatedAt: at };
}
function evaluation(overrides: Partial<RsiEvaluation> = {}): RsiEvaluation {
  return { id: 'evaluation-1', taskId: 'task-1', iterationId: 'iteration-1', commit: candidate, phase: 'train',
    state: 'queued', repetitions: 1, questionIds: ['question-1'], passedCounts: [], score: null,
    infraErrorRatio: null, sealedVerdict: null, locked: false, createdAt: at, updatedAt: at, ...overrides };
}
function run(overrides: Partial<RsiRun> = {}): RsiRun {
  return { id: 'run-1', taskId: 'task-1', evaluationId: 'evaluation-1', questionId: 'question-1', repetition: 0,
    attempt: 0, outcome: 'pass', failureReason: null, durationMs: 1000, proxyTokens: 123, artifactPath: null,
    sessionPath: null, at, ...overrides };
}
function input(event: RsiLedgerInput['event'], payload: RsiLedgerInput['payload'], actor: RsiLedgerInput['actor'] = 'worker'): RsiLedgerInput {
  const taskId = 'taskId' in payload ? payload.taskId : payload.id;
  return { event, payload, taskId, actor, at } as RsiLedgerInput;
}
function sign(value: RsiLedgerInput, head: RsiLedgerHead | null): RsiLedgerEntry {
  const unsigned = { ...value, version: 1 as const, seq: (head?.seq ?? 0) + 1, prevHash: head?.hash ?? RSI_LEDGER_GENESIS_HASH };
  return { ...unsigned, hash: computeLedgerHash(unsigned) };
}
function apply(db: Database.Database, value: RsiLedgerInput): RsiLedgerEntry {
  const entry = sign(value, getRsiLedgerHead(db, value.taskId));
  applyRsiLedgerEntry(db, entry);
  return entry;
}
function prepareIteration(db: Database.Database): void {
  apply(db, input('task_put', task()));
  apply(db, input('iteration_put', iteration()));
}
function readTask(db: Database.Database): RsiTask {
  return JSON.parse((db.prepare(`SELECT ${RSI_TASK_COLS} FROM rsi_tasks WHERE id=?`).get('task-1') as { entity_json: string }).entity_json) as RsiTask;
}
function trainingEvents(value = iteration()): RsiLedgerInput[] {
  const train = evaluation({ id: `train-${value.id}`, iterationId: value.id, commit: value.commit });
  return [
    input('iteration_put', value),
    input('iteration_put', { ...value, state: 'submitted' }, 'optimizer'),
    input('iteration_put', { ...value, state: 'precheck' }),
    input('iteration_put', { ...value, state: 'training' }),
    input('evaluation_put', train),
    input('run_put', run({ id: `train-run-${value.id}`, evaluationId: train.id })),
    input('evaluation_put', { ...train, state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0 }),
    input('iteration_put', { ...value, state: 'training', trainScore: 1 }),
  ];
}
function promotedEvents(value = iteration(), currentTask = task()): RsiLedgerInput[] {
  const trained = { ...value, trainScore: 1 };
  const sealed = evaluation({ id: `sealed-${value.id}`, iterationId: value.id, commit: value.commit, phase: 'sealed', repetitions: 3 });
  return [
    ...trainingEvents(value),
    input('iteration_put', { ...trained, state: 'reviewing' }),
    input('task_put', { ...currentTask, sealedQueriesUsed: currentTask.sealedQueriesUsed + 1 }),
    input('evaluation_put', sealed),
    input('iteration_put', { ...trained, state: 'sealed' }),
    ...[0, 1, 2].map(repetition => input('run_put', run({ id: `sealed-run-${value.id}-${repetition}`, evaluationId: sealed.id, repetition }))),
    input('evaluation_put', { ...sealed, state: 'completed', passedCounts: [1, 1, 1], score: 1, infraErrorRatio: 0, sealedVerdict: 'accept' }),
    input('iteration_put', { ...trained, state: 'deciding', sealedScore: 1 }),
    input('iteration_put', { ...trained, state: 'promoted', sealedScore: 1 }),
  ];
}
function promote(db: Database.Database, value = iteration()): void {
  for (const event of promotedEvents(value, readTask(db))) apply(db, event);
}
function calibrate(db: Database.Database): void {
  apply(db, input('task_put', { ...readTask(db), state: 'calibrating' }));
  for (const phase of ['train', 'sealed'] as const) {
    const baselineEvaluation = evaluation({ id: `baseline-${phase}`, iterationId: null, commit: baseline, phase, repetitions: 3 });
    apply(db, input('evaluation_put', baselineEvaluation));
    for (const repetition of [0, 1, 2]) {
      apply(db, input('run_put', run({ id: `baseline-${phase}-${repetition}`, evaluationId: baselineEvaluation.id,
        repetition, outcome: 'fail', failureReason: 'test_failed' })));
    }
    apply(db, input('evaluation_put', { ...baselineEvaluation, state: 'completed', passedCounts: [0, 0, 0], score: 0, infraErrorRatio: 0 }));
  }
  apply(db, input('task_put', { ...readTask(db), delta: 0, baselineTrainScore: 0, baselineSealedScore: 0 }));
  apply(db, input('task_put', { ...readTask(db), state: 'running' }));
}

function snapshot(db: Database.Database): unknown[][] {
  const readers = [
    cachedStmt(db, `SELECT ${RSI_TASK_COLS} FROM rsi_tasks ORDER BY id`),
    cachedStmt(db, `SELECT ${RSI_ITERATION_COLS} FROM rsi_iterations ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_EVALUATION_COLS} FROM rsi_evaluations ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_RUN_COLS} FROM rsi_runs ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_FINDING_COLS} FROM rsi_findings ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_DECISION_COLS} FROM rsi_decisions ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_INSTRUCTION_COLS} FROM rsi_instructions ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_QUEUE_COLS} FROM rsi_queue ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_SESSION_COLS} FROM rsi_sessions ORDER BY task_id,id`),
    cachedStmt(db, `SELECT ${RSI_HEAD_COLS} FROM rsi_heads ORDER BY task_id`),
  ];
  return readers.map(reader => reader.all());
}
function allEvents(): RsiLedgerInput[] {
  return [
    input('task_put', task()), input('iteration_put', iteration()),
    input('iteration_put', { ...iteration(), state: 'submitted' }, 'optimizer'),
    input('iteration_put', { ...iteration(), state: 'precheck' }),
    input('iteration_put', { ...iteration(), state: 'training' }),
    input('evaluation_put', evaluation()), input('run_put', run()),
    input('evaluation_put', evaluation({ state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0 })),
    input('finding_put', { id: 'finding-1', taskId: 'task-1', iterationId: 'iteration-1', level: 'L4', category: 'suspicious',
      severity: 'hold', source: 'monitor', file: 'src/agent.ts', line: 12, evidence: 'Synthetic evidence', at }, 'monitor'),
    input('decision_put', { id: 'decision-1', taskId: 'task-1', iterationId: 'iteration-1', verdict: 'hold', actor: 'worker',
      reason: 'l4_suspicious', approvedCategories: [], at }),
    input('instruction_put', { id: 'instruction-1', taskId: 'task-1', kind: 'idea', text: 'Try reducing repeated reads', effectiveFromSeq: 2, at }, 'human'),
    input('queue_put', { id: 'queue-1', taskId: 'task-1', kind: 'review', iterationId: 'iteration-1', evaluationId: 'evaluation-1',
      state: 'queued', requestedBy: 'worker', reason: null, command: { action: 'review' }, createdAt: at, updatedAt: at }),
    input('iteration_put', { ...iteration(), state: 'training', trainScore: 1 }),
    input('task_put', { ...task(), iterationCount: 1, tokenUsage: 123 }),
  ];
}

describe('RSI-008 atomic incremental cache', () => {
  it('persists explicit NULL references and canonical snapshots with their trusted head', () => {
    const db = database(); prepareIteration(db);
    const entry = apply(db, input('evaluation_put', evaluation()));
    expect(getRsiLedgerHead(db, 'task-1')).toEqual({ seq: entry.seq, hash: entry.hash });
    const row = db.prepare(`SELECT ${RSI_ITERATION_COLS} FROM rsi_iterations WHERE task_id=? AND id=?`).get('task-1', 'iteration-1') as { parent_id: null; entity_json: string };
    expect(row.parent_id).toBeNull();
    expect(row.entity_json).toBe(canonicalJson(iteration()));
  });
  it('accepts only an exact current-head replay and rejects stale events, gaps and forks', () => {
    const db = database();
    const first = apply(db, input('task_put', task()));
    const second = apply(db, input('iteration_put', iteration()));
    const before = snapshot(db);
    applyRsiLedgerEntry(db, second);
    expect(snapshot(db)).toEqual(before);
    expect(() => applyRsiLedgerEntry(db, first)).toThrow('sequence or chain');
    const gap = sign(input('task_put', task()), { seq: second.seq + 1, hash: second.hash });
    expect(() => applyRsiLedgerEntry(db, gap)).toThrow('sequence or chain');
    const fork = sign(input('task_put', task()), { seq: second.seq, hash: 'f'.repeat(64) });
    expect(() => applyRsiLedgerEntry(db, fork)).toThrow('sequence or chain');
    expect(snapshot(db)).toEqual(before);
  });
  it('rejects a wrong hash and a cross-task payload without changing the cache', () => {
    const db = database(); prepareIteration(db);
    const before = snapshot(db);
    const valid = sign(input('evaluation_put', evaluation()), getRsiLedgerHead(db, 'task-1'));
    expect(() => applyRsiLedgerEntry(db, { ...valid, hash: 'f'.repeat(64) })).toThrow('hash');
    const crossTask = sign({ ...input('evaluation_put', evaluation()), taskId: 'task-2' }, null);
    expect(() => applyRsiLedgerEntry(db, crossTask)).toThrow();
    expect(snapshot(db)).toEqual(before);
  });
  it.each([
    ['repository', 'different-repository'], ['baselineCommit', 'f'.repeat(40)],
    ['datasetHash', 'f'.repeat(64)], ['taskTokenHash', 'e'.repeat(64)],
    ['createdAt', '2026-11-07T00:00:01.000Z'],
  ])('freezes task identity %s so previous calibration cannot be reused under a new identity', (field, value) => {
    const db = database(); apply(db, input('task_put', task()));
    expect(() => apply(db, input('task_put', { ...task(), [field]: value, updatedAt: '2026-11-07T00:00:02.000Z' }))).toThrow('immutable');
  });
  it.each(['sealedQueriesUsed', 'tokenUsage', 'iterationCount'] as const)('never refunds the monotonic %s task counter', field => {
    const db = database();
    const current = { ...task(), sealedQueriesUsed: 2, tokenUsage: 200, iterationCount: 3 };
    apply(db, input('task_put', task()));
    apply(db, input('task_put', current));
    expect(() => apply(db, input('task_put', { ...current, [field]: current[field] - 1 }))).toThrow('cannot decrease');
    apply(db, input('task_put', { ...current, [field]: current[field] + 1 }));
  });
  it('allows only human-attributed configuration changes while preserving counters', () => {
    const db = database(); apply(db, input('task_put', task()));
    const updated = { ...task(), config: { ...task().config, maxTaskTokens: 20_000_000 } };
    expect(() => apply(db, input('task_put', updated))).toThrow('configuration changes require human');
    expect(() => apply(db, input('task_put', updated, 'optimizer'))).toThrow('configuration changes require human');
    apply(db, input('task_put', updated, 'human'));
    const row = db.prepare(`SELECT ${RSI_TASK_COLS} FROM rsi_tasks`).get() as { entity_json: string };
    expect(JSON.parse(row.entity_json)).toEqual(updated);
  });
  it('rolls back the entity mutation when the head update fails', () => {
    const db = database(); apply(db, input('task_put', task()));
    const before = snapshot(db);
    db.exec("CREATE TRIGGER fail_rsi_head BEFORE UPDATE ON rsi_heads BEGIN SELECT RAISE(ABORT,'synthetic-head-failure'); END");
    expect(() => apply(db, input('iteration_put', iteration()))).toThrow('synthetic-head-failure');
    expect(snapshot(db)).toEqual(before);
  });
  it('freezes original parent/commit/sequence, first training score and terminal iterations', () => {
    const db = database(); prepareIteration(db);
    expect(() => apply(db, input('iteration_put', { ...iteration(), commit: 'f'.repeat(40) }))).toThrow('immutable');
    for (const event of trainingEvents()) apply(db, event);
    expect(() => apply(db, input('iteration_put', { ...iteration(), state: 'training', trainScore: 2 }))).toThrow('immutable');
    apply(db, input('iteration_put', { ...iteration(), state: 'rejected', trainScore: 1 }));
    expect(() => apply(db, input('iteration_put', { ...iteration(), state: 'draft', trainScore: 1 }))).toThrow('immutable');
  });
  it('keeps rejected history and permits rollback by creating a new iteration on a promoted parent', () => {
    const db = database(); prepareIteration(db);
    promote(db);
    const rejected = { ...iteration(), id: 'iteration-2', seq: 2, parentId: 'iteration-1' };
    apply(db, input('iteration_put', rejected));
    apply(db, input('iteration_put', { ...rejected, state: 'submitted' }, 'optimizer'));
    apply(db, input('iteration_put', { ...rejected, state: 'precheck' }));
    apply(db, input('iteration_put', { ...rejected, state: 'rejected' }));
    apply(db, input('iteration_put', { ...iteration(), id: 'iteration-3', seq: 3, parentId: 'iteration-1' }));
    expect(db.prepare('SELECT id, parent_id, state FROM rsi_iterations ORDER BY seq').all()).toEqual([
      { id: 'iteration-1', parent_id: null, state: 'promoted' },
      { id: 'iteration-2', parent_id: 'iteration-1', state: 'rejected' },
      { id: 'iteration-3', parent_id: 'iteration-1', state: 'draft' },
    ]);
  });
  it('rejects missing same-task references and mismatched evaluation commit', () => {
    const db = database(); apply(db, input('task_put', task()));
    expect(() => apply(db, input('evaluation_put', evaluation()))).toThrow('reference');
    apply(db, input('iteration_put', iteration()));
    expect(() => apply(db, input('evaluation_put', evaluation({ commit: baseline })))).toThrow('commit mismatch');
    expect(() => apply(db, input('iteration_put', { ...iteration(), id: 'iteration-2', seq: 2, parentId: 'iteration-1' }))).toThrow('invalid parent');
  });
  it('permits one infrastructure retry, preserves both attempts and forbids ordinary failure retries', () => {
    const db = database(); prepareIteration(db); apply(db, input('evaluation_put', evaluation()));
    expect(() => apply(db, input('run_put', run({ id: 'run-retry', attempt: 1 })))).toThrow('retry');
    apply(db, input('run_put', run({ outcome: 'infra_error', failureReason: 'infrastructure' })));
    apply(db, input('run_put', run({ id: 'run-retry', attempt: 1 })));
    expect(db.prepare('SELECT attempt, outcome FROM rsi_runs ORDER BY attempt').all()).toEqual([{ attempt: 0, outcome: 'infra_error' }, { attempt: 1, outcome: 'pass' }]);
    expect(() => apply(db, input('run_put', run({ id: 'duplicate-slot', attempt: 1 })))).toThrow('UNIQUE');
    expect(() => apply(db, input('run_put', run()))).toThrow('immutable');
  });
  it('rejects unplanned runs and freezes completed evaluation summaries and evidence', () => {
    const db = database(); prepareIteration(db); apply(db, input('evaluation_put', evaluation()));
    expect(() => apply(db, input('run_put', run({ questionId: 'question-2' })))).toThrow('planned');
    expect(() => apply(db, input('run_put', run({ repetition: 1 })))).toThrow('planned');
    apply(db, input('run_put', run()));
    apply(db, input('evaluation_put', evaluation({ state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0 })));
    expect(() => apply(db, input('evaluation_put', evaluation({ state: 'completed', passedCounts: [0], score: 0, infraErrorRatio: 0 })))).toThrow('immutable');
    expect(() => apply(db, input('run_put', run({ id: 'late-run' })))).toThrow('locked');
  });
  it('reserves final once per commit across iterations, only on a human request, and locks the result', () => {
    const db = database(); prepareIteration(db);
    promote(db);
    const final = evaluation({ id: 'final-1', phase: 'final' });
    expect(() => apply(db, input('evaluation_put', final))).toThrow('human queued');
    apply(db, input('evaluation_put', final, 'human'));
    promote(db, { ...iteration(), id: 'iteration-2', seq: 2 });
    expect(() => apply(db, input('evaluation_put', { ...final, id: 'final-2', iterationId: 'iteration-2' }, 'human'))).toThrow('already requested');
    apply(db, input('run_put', run({ evaluationId: 'final-1' })));
    apply(db, input('evaluation_put', { ...final, state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0, locked: true }));
    expect(() => apply(db, input('evaluation_put', { ...final, state: 'completed', passedCounts: [0], score: 0, infraErrorRatio: 0, locked: true }))).toThrow('immutable');
  });
  it('rejects forged human queue attribution and mismatched decision/instruction actors', () => {
    const db = database(); prepareIteration(db);
    const item = { id: 'start-1', taskId: 'task-1', kind: 'intervene' as const, iterationId: null, evaluationId: null,
      state: 'queued' as const, requestedBy: 'human' as const, reason: null, command: { action: 'start' as const }, createdAt: at, updatedAt: at };
    expect(() => apply(db, input('queue_put', item, 'optimizer'))).toThrow('queue actor mismatch');
    apply(db, input('queue_put', item, 'human'));
    expect(() => apply(db, input('queue_put', { ...item, state: 'completed' }, 'optimizer'))).toThrow('queue actor mismatch');
    const decision = { id: 'decision-auth', taskId: 'task-1', iterationId: 'iteration-1', verdict: 'hold' as const,
      actor: 'human' as const, reason: 'Review needed', approvedCategories: [], at };
    expect(() => apply(db, input('decision_put', decision, 'optimizer'))).toThrow('decision actor mismatch');
    const instruction = { id: 'instruction-auth', taskId: 'task-1', kind: 'idea' as const, text: 'Do not specialize by question', effectiveFromSeq: 1, at };
    expect(() => apply(db, input('instruction_put', instruction, 'optimizer'))).toThrow('instruction requires human');
  });
  it('allows an optimizer to queue declare_stuck and freezes the command during worker status updates', () => {
    const db = database(); apply(db, input('task_put', task()));
    const item = { id: 'stuck-1', taskId: 'task-1', kind: 'intervene' as const, iterationId: null, evaluationId: null,
      state: 'queued' as const, requestedBy: 'optimizer' as const, reason: 'No progress',
      command: { action: 'declare_stuck' as const, reason: 'No progress' }, createdAt: at, updatedAt: at };
    apply(db, input('queue_put', item, 'optimizer'));
    apply(db, input('queue_put', { ...item, state: 'running' }));
    expect(() => apply(db, input('queue_put', { ...item, command: { action: 'declare_stuck', reason: 'Changed command' } }))).toThrow('immutable');
    expect(db.prepare('SELECT state FROM rsi_queue').all()).toEqual([{ state: 'running' }]);
  });
  it('allows completed tasks to enqueue final/adoption only with human attribution', () => {
    const db = database(); prepareIteration(db);
    calibrate(db); promote(db);
    apply(db, input('task_put', { ...readTask(db), state: 'completed' }));
    const item = { id: 'queue-final', taskId: 'task-1', kind: 'final' as const, iterationId: 'iteration-1', evaluationId: null,
      state: 'queued' as const, requestedBy: 'optimizer' as const, reason: 'Finalize', command: { action: 'final' as const, reason: 'Finalize' }, createdAt: at, updatedAt: at };
    expect(() => apply(db, input('queue_put', item, 'optimizer'))).toThrow('queue.requestedBy');
    apply(db, input('queue_put', { ...item, requestedBy: 'human' }, 'human'));
    expect(db.prepare('SELECT kind, state FROM rsi_queue').all()).toEqual([{ kind: 'final', state: 'queued' }]);
  });
});

describe('RSI-008 snapshot execution boundary and evidence accounting', () => {
  it('rejects new terminal snapshots and skipped task/iteration states', () => {
    const db = database();
    expect(() => apply(db, input('task_put', { ...task(), state: 'completed' }))).toThrow('Illegal RSI transition');
    prepareIteration(db);
    expect(() => apply(db, input('task_put', { ...task(), state: 'running' }))).toThrow('Illegal RSI transition');
    expect(() => apply(db, input('iteration_put', { ...iteration(), state: 'promoted' }))).toThrow('Illegal RSI transition');
    expect(() => apply(db, input('iteration_put', { ...iteration(), state: 'precheck' }))).toThrow('Illegal RSI transition');
    expect(() => apply(db, input('iteration_put', { ...iteration(), id: 'fake', seq: 2, state: 'promoted' }))).toThrow('Illegal RSI transition');
  });
  it('allows only human append-only approval of the exact current hold', () => {
    const db = database(); prepareIteration(db);
    apply(db, input('iteration_put', { ...iteration(), state: 'submitted' }, 'optimizer'));
    apply(db, input('iteration_put', { ...iteration(), state: 'precheck' }));
    const held = { ...iteration(), state: 'held' as const, holdReasons: ['dependency_change' as const], resumeState: 'training' as const };
    apply(db, input('iteration_put', held));
    const approval = { iterationId: 'iteration-1', commit: candidate, categories: ['dependency_change' as const], reason: 'Reviewed the dependency change', at };
    const resumed = { ...iteration(), state: 'training' as const, approvals: [approval] };
    expect(() => apply(db, input('iteration_put', resumed))).toThrow('human held resolution');
    expect(() => apply(db, input('iteration_put', { ...held, holdReasons: ['incomplete_comparison'] }))).toThrow('immutable');
    expect(() => apply(db, input('iteration_put', { ...resumed, approvals: [{ ...approval, categories: ['token_growth'] }] }, 'human'))).toThrow('exact held categories');
    apply(db, input('iteration_put', resumed, 'human'));
    expect(() => apply(db, input('iteration_put', { ...resumed, approvals: [] }, 'human'))).toThrow('append-only');
    expect(() => apply(db, input('iteration_put', { ...resumed, approvals: [{ ...approval, reason: 'Changed history' }] }, 'human'))).toThrow('immutable');
  });
  it('forbids optimizer-written measurements/packages and freezes calibrated baseline measurements', () => {
    const db = database(); prepareIteration(db);
    expect(() => apply(db, input('iteration_put', { ...iteration(), packageSha256: 'e'.repeat(64) }, 'optimizer'))).toThrow('results require worker');
    expect(() => apply(db, input('iteration_put', { ...iteration(), trainScore: 1 }, 'optimizer'))).toThrow('results require worker');
    expect(() => apply(db, input('task_put', { ...task(), delta: 0, baselineTrainScore: 0 }))).toThrow('baseline train evidence missing');
    calibrate(db);
    expect(() => apply(db, input('task_put', { ...readTask(db), delta: 1 }))).toThrow('immutable');
    expect(() => apply(db, input('task_put', { ...readTask(db), baselineSealedScore: 1 }))).toThrow('immutable');
  });
  it('requires every completed summary to agree with actual final run outcomes', () => {
    const db = database(); prepareIteration(db); apply(db, input('evaluation_put', evaluation()));
    const claimed = evaluation({ state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0 });
    expect(() => apply(db, input('evaluation_put', claimed))).toThrow('incomplete run evidence');
    apply(db, input('run_put', run({ outcome: 'fail', failureReason: 'test_failed' })));
    expect(() => apply(db, input('evaluation_put', claimed))).toThrow('summary does not match runs');
    apply(db, input('evaluation_put', { ...claimed, passedCounts: [0], score: 0 }));
  });
  it('requires the one infrastructure retry and derives infra_failed from the configured ratio', () => {
    const db = database(); prepareIteration(db); apply(db, input('evaluation_put', evaluation()));
    apply(db, input('run_put', run({ outcome: 'infra_error', failureReason: 'infrastructure' })));
    const unresolved = evaluation({ state: 'completed', passedCounts: [0], score: null, infraErrorRatio: 1 });
    expect(() => apply(db, input('evaluation_put', unresolved))).toThrow('incomplete run evidence');
    apply(db, input('run_put', run({ id: 'run-retry', attempt: 1, outcome: 'infra_error', failureReason: 'infrastructure' })));
    expect(() => apply(db, input('evaluation_put', unresolved))).toThrow('score/state does not match runs');
    apply(db, input('evaluation_put', { ...unresolved, state: 'infra_failed' }));
    expect(() => apply(db, input('evaluation_put', { ...unresolved, state: 'queued' }))).toThrow('immutable');
  });
  it('counts only the retried final result and never counts infrastructure failures as ordinary failures', () => {
    const db = database(); prepareIteration(db); apply(db, input('evaluation_put', evaluation()));
    apply(db, input('run_put', run({ outcome: 'infra_error', failureReason: 'infrastructure' })));
    apply(db, input('run_put', run({ id: 'run-retry', attempt: 1 })));
    apply(db, input('evaluation_put', evaluation({ state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0 })));
    expect(db.prepare('SELECT COUNT(id) AS n FROM rsi_runs').get()).toEqual({ n: 2 });
  });
  it('freezes the first valid train by ledger completion order, including terminal snapshot replays', () => {
    const db = database(); prepareIteration(db);
    apply(db, input('iteration_put', { ...iteration(), state: 'submitted' }, 'optimizer'));
    apply(db, input('iteration_put', { ...iteration(), state: 'precheck' }));
    apply(db, input('iteration_put', { ...iteration(), state: 'training' }));
    const first = evaluation({ id: 'z-first' }), later = evaluation({ id: 'a-later' });
    apply(db, input('evaluation_put', first));
    apply(db, input('run_put', run({ id: 'first-run', evaluationId: first.id, outcome: 'fail', failureReason: 'test_failed' })));
    const completed = { ...first, state: 'completed' as const, passedCounts: [0], score: 0, infraErrorRatio: 0 };
    const firstEntry = apply(db, input('evaluation_put', completed));
    apply(db, input('evaluation_put', later));
    apply(db, input('run_put', run({ id: 'later-run', evaluationId: later.id })));
    apply(db, input('evaluation_put', { ...later, state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0 }));
    apply(db, input('evaluation_put', completed));
    expect(db.prepare('SELECT ledger_seq FROM rsi_evaluations WHERE id=?').get(first.id)).toEqual({ ledger_seq: firstEntry.seq });
    expect(() => apply(db, input('iteration_put', { ...iteration(), state: 'training', trainScore: 1 }))).toThrow('first completed evaluation');
    apply(db, input('iteration_put', { ...iteration(), state: 'training', trainScore: 0 }));
  });
  it('matches queue evaluation and iteration references, command phase and commit, including baseline', () => {
    const db = database(); prepareIteration(db); apply(db, input('evaluation_put', evaluation()));
    apply(db, input('iteration_put', { ...iteration(), id: 'iteration-2', seq: 2 }));
    const command = { action: 'evaluate' as const, phase: 'train' as const, commit: candidate };
    const item = { id: 'evaluate-queue', taskId: 'task-1', kind: 'evaluate' as const, iterationId: 'iteration-1', evaluationId: 'evaluation-1',
      state: 'queued' as const, requestedBy: 'worker' as const, reason: null, command, createdAt: at, updatedAt: at };
    expect(() => apply(db, input('queue_put', { ...item, iterationId: 'iteration-2' }))).toThrow('evaluation/iteration mismatch');
    expect(() => apply(db, input('queue_put', { ...item, command: { ...command, commit: baseline } }))).toThrow('evaluate command mismatch');
    expect(() => apply(db, input('queue_put', { ...item, command: { ...command, phase: 'smoke' } }))).toThrow('evaluate command mismatch');
    apply(db, input('queue_put', item));
    const baselineEvaluation = evaluation({ id: 'baseline-train', iterationId: null, commit: baseline, repetitions: 3 });
    apply(db, input('evaluation_put', baselineEvaluation));
    apply(db, input('queue_put', { ...item, id: 'baseline-queue', iterationId: null, evaluationId: baselineEvaluation.id, command: { ...command, commit: baseline } }));
  });
  it.each(['final', 'adopt'] as const)('requires a promoted iteration for human %s commands', action => {
    const db = database(); prepareIteration(db);
    const item = { id: 'human-queue', taskId: 'task-1', kind: action, iterationId: 'iteration-1', evaluationId: null,
      state: 'queued' as const, requestedBy: 'human' as const, reason: 'Ready', command: { action, reason: 'Ready' }, createdAt: at, updatedAt: at };
    expect(() => apply(db, input('queue_put', item, 'human'))).toThrow('requires promoted iteration');
  });
  it('requires a reserved sealed query, permits its final budget slot, and forbids another completed-group sample', () => {
    const db = database(); prepareIteration(db);
    const sealed = evaluation({ id: 'sealed-reserved', phase: 'sealed', repetitions: 3 });
    expect(() => apply(db, input('evaluation_put', sealed))).toThrow('requires reserved budget');
    apply(db, input('task_put', { ...readTask(db), config: { ...readTask(db).config, sealedQueryBudget: 1 } }, 'human'));
    promote(db);
    expect(readTask(db).sealedQueriesUsed).toBe(1);
    expect(() => apply(db, input('evaluation_put', sealed))).toThrow('already active or completed');
  });
  it('reuses an invalidated sealed reservation after budget resume without refunding or changing its questions', () => {
    const db = database(); prepareIteration(db); calibrate(db);
    apply(db, input('task_put', { ...readTask(db), sealedQueriesUsed: 1 }));
    const sealed = evaluation({ id: 'sealed-interrupted', phase: 'sealed', repetitions: 3 });
    apply(db, input('evaluation_put', sealed));
    apply(db, input('task_put', { ...readTask(db), state: 'paused', pauseReason: 'budget_exhausted', tokenUsage: readTask(db).config.maxTaskTokens }));
    apply(db, input('evaluation_put', { ...sealed, state: 'invalidated' }));
    apply(db, input('task_put', { ...readTask(db), config: { ...readTask(db).config, maxTaskTokens: 20_000_000 } }, 'human'));
    apply(db, input('task_put', { ...readTask(db), state: 'running', pauseReason: null }, 'human'));
    expect(() => apply(db, input('evaluation_put', { ...sealed, id: 'bad-retry', questionIds: ['different-question'] }))).toThrow('immutable');
    apply(db, input('evaluation_put', { ...sealed, id: 'sealed-resumed' }));
    expect(readTask(db).sealedQueriesUsed).toBe(1);
  });
  it('continues the original final reservation after a budget pause without permitting another human trigger', () => {
    const db = database(); prepareIteration(db); calibrate(db); promote(db);
    apply(db, input('task_put', { ...readTask(db), state: 'completed' }));
    const final = evaluation({ id: 'final-interrupted', phase: 'final' });
    apply(db, input('evaluation_put', final, 'human'));
    apply(db, input('task_put', { ...readTask(db), state: 'paused', pauseReason: 'budget_exhausted', tokenUsage: readTask(db).config.maxTaskTokens }));
    apply(db, input('evaluation_put', { ...final, state: 'invalidated' }));
    expect(() => apply(db, input('evaluation_put', { ...final, id: 'final-again' }, 'human'))).toThrow('already requested');
    expect(() => apply(db, input('evaluation_put', { ...final, id: 'final-too-soon' }))).toThrow('resumed task budget');
    apply(db, input('task_put', { ...readTask(db), config: { ...readTask(db).config, maxTaskTokens: 20_000_000 } }, 'human'));
    apply(db, input('task_put', { ...readTask(db), state: 'completed', pauseReason: null }, 'human'));
    expect(() => apply(db, input('evaluation_put', { ...final, id: 'wrong-final', questionIds: ['different-question'] }))).toThrow('immutable');
    apply(db, input('evaluation_put', { ...final, id: 'final-resumed' }));
    apply(db, input('run_put', run({ id: 'resumed-final-run', evaluationId: 'final-resumed' })));
    apply(db, input('evaluation_put', { ...final, id: 'final-resumed', state: 'completed', passedCounts: [1], score: 1, infraErrorRatio: 0, locked: true }));
    expect(() => apply(db, input('evaluation_put', { ...final, id: 'final-after-completion' }))).toThrow('already requested');
    expect(readTask(db).state).toBe('completed');
  });
});

describe('RSI-008 verified all-table ledger rebuilding', () => {
  it('reconstructs all nine tables exactly like incremental writes and preserves unrelated tasks', async () => {
    const path = await ledgerPath(); const db = database(); const rebuilt = database();
    const other = input('task_put', task('task-2'));
    apply(db, other); apply(rebuilt, other);
    for (const event of allEvents()) {
      const entry = await appendLedger(path, event);
      applyRsiLedgerEntry(db, entry);
    }
    await rebuildRsiIndexFromLedger(rebuilt, 'task-1', path);
    expect(snapshot(rebuilt)).toEqual(snapshot(db));
    await rebuildRsiIndexFromLedger(rebuilt, 'task-1', path);
    expect(snapshot(rebuilt)).toEqual(snapshot(db));
    expect(rebuilt.pragma('foreign_key_check')).toEqual([]);
  });
  it('catches a missing tail using the existing cache head and preserves every prior row', async () => {
    const path = await ledgerPath(); const db = database();
    const first = await appendLedger(path, input('task_put', task())); applyRsiLedgerEntry(db, first);
    const second = await appendLedger(path, input('iteration_put', iteration())); applyRsiLedgerEntry(db, second);
    const before = snapshot(db);
    await writeFile(path, `${canonicalJson(first)}\n`);
    await expect(rebuildRsiIndexFromLedger(db, 'task-1', path)).rejects.toThrow('tail_truncated');
    expect(snapshot(db)).toEqual(before);
  });
  it('does not replace the cache after detecting a crash partial line', async () => {
    const path = await ledgerPath(); const db = database();
    applyRsiLedgerEntry(db, await appendLedger(path, input('task_put', task())));
    const before = snapshot(db);
    await appendFile(path, '{"version":1');
    await expect(rebuildRsiIndexFromLedger(db, 'task-1', path)).rejects.toThrow('partial_tail');
    expect(snapshot(db)).toEqual(before);
  });
  it('does not replace the cache after a valid-hash event violates immutable history', async () => {
    const path = await ledgerPath(); const db = database();
    for (const event of allEvents()) applyRsiLedgerEntry(db, await appendLedger(path, event));
    const before = snapshot(db);
    await appendLedger(path, input('run_put', { ...run(), proxyTokens: 999 }));
    await expect(rebuildRsiIndexFromLedger(db, 'task-1', path)).rejects.toThrow('immutable');
    expect(snapshot(db)).toEqual(before);
  });
  it('aborts replacement when incremental application advances the live head during verification', async () => {
    const path = await ledgerPath(); const db = database();
    applyRsiLedgerEntry(db, await appendLedger(path, input('task_put', task())));
    const next = await appendLedger(path, input('iteration_put', iteration()));
    const rebuilding = rebuildRsiIndexFromLedger(db, 'task-1', path);
    applyRsiLedgerEntry(db, next);
    const afterIncremental = snapshot(db);
    await expect(rebuilding).rejects.toThrow('immutable');
    expect(snapshot(db)).toEqual(afterIncremental);
  });
  it('rebuilds the permanent final reservation so a second final request stays rejected', async () => {
    const path = await ledgerPath(); const db = database();
    await appendLedger(path, input('task_put', task()));
    for (const event of promotedEvents()) await appendLedger(path, event);
    const final = evaluation({ id: 'final-1', phase: 'final' });
    await appendLedger(path, input('evaluation_put', final, 'human'));
    await rebuildRsiIndexFromLedger(db, 'task-1', path);
    expect(() => apply(db, input('evaluation_put', { ...final, id: 'final-2' }, 'human'))).toThrow('already requested');
  });
});


describe('RSI-014 session cache authorization',()=>{
  const session = ():RsiOptimizerSession=>({id:'session-1',taskId:'task-1',seq:1,parentId:null,commit:baseline,state:'running',submissionId:null,accounting:'proxy',tokens:null,artifactPath:'artifacts/optimizer/session-1',startedAt:at,endedAt:null});
  it('requires worker, same-parent commit and one running session, then freezes terminal results',()=>{
    const db=database();apply(db,input('task_put',task(),'human'));
    expect(()=>apply(db,input('session_put',session(),'optimizer'))).toThrow('worker');
    expect(()=>apply(db,input('session_put',{...session(),commit:candidate}))).toThrow('parent');
    apply(db,input('session_put',session()));
    expect(()=>apply(db,input('session_put',{...session(),id:'second',seq:2}))).toThrow('already running');
    const ended={...session(),state:'no_submission' as const,tokens:123,endedAt:at};apply(db,input('session_put',ended));
    expect(()=>apply(db,input('session_put',{...ended,tokens:124}))).toThrow('immutable');
    expect(()=>apply(db,input('session_put',session()))).toThrow('immutable');
  });
  it('reconstructs session outcomes and preserves immutable identities through ledger replay',async()=>{
    const path=await ledgerPath(),db=database(),rebuilt=database();
    for(const event of [input('task_put',task(),'human'),input('session_put',session()),input('session_put',{...session(),state:'timeout',tokens:0,endedAt:at})])applyRsiLedgerEntry(db,await appendLedger(path,event));
    await rebuildRsiIndexFromLedger(rebuilt,'task-1',path);expect(snapshot(rebuilt)).toEqual(snapshot(db));
  });
});
