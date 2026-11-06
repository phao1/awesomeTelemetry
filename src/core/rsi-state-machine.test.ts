import { describe, expect, it } from 'vitest';
import { RsiTransitionError, transitionIteration, transitionTask, validateIterationSnapshotTransition, validateTaskSnapshotTransition } from './rsi-state-machine.js';
import { defaultRsiConfig } from './rsi-validation.js';
import { RSI_ITERATION_STATES, RSI_TASK_STATES } from './rsi-types.js';
import type { RsiActor, RsiIteration, RsiIterationContext, RsiIterationEvent, RsiIterationState, RsiTask, RsiTaskContext, RsiTaskEvent, RsiTaskState } from './rsi-types.js';

const actors: RsiActor[] = ['optimizer', 'worker', 'monitor', 'human'];
const iterationEvents: Record<RsiIterationEvent, true> = {
  submit: true, start_precheck: true, precheck_pass: true, precheck_reject: true, precheck_hold: true,
  training_pass: true, training_reject: true, training_hold: true, review_pass: true, review_hold: true,
  sealed_accept: true, sealed_reject: true, sealed_hold: true, promotion_pass: true, promotion_reject: true,
  promotion_hold: true, approve: true, reject: true, retry_review: true, retry_evaluation: true,
};
const taskEvents: Record<RsiTaskEvent, true> = {
  start: true, calibrated: true, pause: true, resume: true, declare_stuck: true, sealed_budget_exhausted: true,
  budget_exhausted: true, infra_failed: true, incomplete_comparison: true, target_reached: true, stop: true,
};
type IterationRow = [string, RsiIterationState, RsiIterationEvent, RsiIterationContext, RsiIterationState];
const worker: RsiIterationContext = { actor: 'worker' };
const explained: RsiIterationContext = { actor: 'worker', reason: 'Retained gate result' };
// Independent transcription of RSI-003. It is deliberately not imported from
// implementation data: each row is an executable contract assertion.
const iterationRows: IterationRow[] = [
  ['I01', 'draft', 'submit', { actor: 'optimizer' }, 'submitted'],
  ['I02', 'submitted', 'start_precheck', worker, 'precheck'],
  ['I03', 'precheck', 'precheck_pass', worker, 'training'],
  ['I04', 'precheck', 'precheck_reject', explained, 'rejected'],
  ['I05', 'precheck', 'precheck_hold', { ...explained, holdReasons: ['dependency_change'], resumeState: 'training' }, 'held'],
  ['I06', 'training', 'training_pass', worker, 'reviewing'],
  ['I07', 'training', 'training_reject', explained, 'rejected'],
  ['I08', 'training', 'training_hold', { ...explained, holdReasons: ['incomplete_comparison'], resumeState: 'training' }, 'held'],
  ['I09', 'reviewing', 'review_pass', { ...worker, sealedBudgetRemaining: 1 }, 'sealed'],
  ['I10', 'reviewing', 'review_hold', { ...explained, holdReasons: ['missing_monitor'], resumeState: 'sealed' }, 'held'],
  ['I11', 'reviewing', 'review_hold', { actor: 'monitor', reason: 'Suspicious change', holdReasons: ['l4_suspicious'], resumeState: 'sealed' }, 'held'],
  ['I12', 'sealed', 'sealed_accept', { ...worker, hasSealedResult: true }, 'deciding'],
  ['I13', 'sealed', 'sealed_reject', explained, 'rejected'],
  ['I14', 'sealed', 'sealed_hold', { ...explained, holdReasons: ['incomplete_comparison'], resumeState: 'sealed' }, 'held'],
  ['I15', 'deciding', 'promotion_pass', { ...worker, hasSealedResult: true }, 'promoted'],
  ['I16', 'deciding', 'promotion_reject', explained, 'rejected'],
  ['I17', 'deciding', 'promotion_hold', { ...explained, holdReasons: ['token_growth'], resumeState: 'deciding', hasSealedResult: true }, 'held'],
  ['I18', 'held', 'approve', { actor: 'human', reason: 'Reviewed dependencies', holdReasons: ['dependency_change'], approvedCategories: ['dependency_change'], resumeState: 'training' }, 'training'],
  ['I19', 'held', 'approve', { actor: 'human', reason: 'Reviewed suspicious evidence', holdReasons: ['l3_suspicious', 'l4_suspicious'], approvedCategories: ['l3_suspicious', 'l4_suspicious'], resumeState: 'sealed', sealedBudgetRemaining: 1 }, 'sealed'],
  ['I20', 'held', 'approve', { actor: 'human', reason: 'Accepted token growth', holdReasons: ['token_growth'], approvedCategories: ['token_growth'], resumeState: 'deciding', hasSealedResult: true }, 'deciding'],
  ['I21', 'held', 'reject', { actor: 'human', reason: 'Rejected evidence' }, 'rejected'],
  ['I22', 'held', 'retry_review', { actor: 'human', reason: 'Retry missing review', holdReasons: ['missing_monitor'] }, 'reviewing'],
  ['I23', 'held', 'retry_evaluation', { actor: 'human', reason: 'Retry incomplete comparison', holdReasons: ['incomplete_comparison'], resumeState: 'training' }, 'training'],
  ['I24', 'held', 'retry_evaluation', { actor: 'human', reason: 'Retry incomplete comparison', holdReasons: ['incomplete_comparison'], resumeState: 'sealed' }, 'sealed'],
];
type TaskRow = [string, RsiTaskState, RsiTaskEvent, RsiTaskContext, RsiTaskState];
const humanTask: RsiTaskContext = { actor: 'human', reason: 'Human intervention' };
const taskRows: TaskRow[] = [
  ['T01', 'created', 'start', { actor: 'worker', budgetAvailable: true }, 'calibrating'],
  ['T02', 'calibrating', 'calibrated', { actor: 'worker', calibrationComplete: true, budgetAvailable: true }, 'running'],
  ['T03', 'created', 'pause', humanTask, 'paused'],
  ['T04', 'calibrating', 'pause', humanTask, 'paused'],
  ['T05', 'running', 'pause', humanTask, 'paused'],
  ['T06', 'needs_help', 'pause', humanTask, 'paused'],
  ['T07', 'paused', 'resume', { ...humanTask, budgetAvailable: true, calibrationComplete: true }, 'running'],
  ['T08', 'paused', 'resume', { ...humanTask, budgetAvailable: true, calibrationComplete: false }, 'calibrating'],
  ['T09', 'needs_help', 'resume', { ...humanTask, budgetAvailable: true, calibrationComplete: true }, 'running'],
  ['T10', 'needs_help', 'resume', { ...humanTask, budgetAvailable: true, calibrationComplete: false }, 'calibrating'],
  ['T11', 'running', 'declare_stuck', { actor: 'optimizer', reason: 'No general improvement found' }, 'needs_help'],
  ['T12', 'running', 'sealed_budget_exhausted', { actor: 'worker', reason: 'No remaining sealed queries' }, 'needs_help'],
  ['T13', 'calibrating', 'budget_exhausted', { actor: 'worker', reason: 'budget_exhausted' }, 'paused'],
  ['T14', 'running', 'budget_exhausted', { actor: 'worker', reason: 'budget_exhausted' }, 'paused'],
  ['T15', 'calibrating', 'infra_failed', { actor: 'worker', reason: 'infra_failed' }, 'paused'],
  ['T16', 'running', 'infra_failed', { actor: 'worker', reason: 'infra_failed' }, 'paused'],
  ['T17', 'calibrating', 'incomplete_comparison', { actor: 'worker', reason: 'incomplete_comparison' }, 'paused'],
  ['T18', 'running', 'incomplete_comparison', { actor: 'worker', reason: 'incomplete_comparison' }, 'paused'],
  ['T19', 'running', 'target_reached', { actor: 'worker', targetReached: true }, 'completed'],
  ['T20', 'created', 'stop', humanTask, 'stopped'],
  ['T21', 'calibrating', 'stop', humanTask, 'stopped'],
  ['T22', 'running', 'stop', humanTask, 'stopped'],
  ['T23', 'paused', 'stop', humanTask, 'stopped'],
  ['T24', 'needs_help', 'stop', humanTask, 'stopped'],
  ['T25', 'completed', 'stop', humanTask, 'stopped'],
  ['T26', 'completed', 'budget_exhausted', { actor: 'worker', reason: 'budget_exhausted' }, 'paused'],
  ['T27', 'completed', 'infra_failed', { actor: 'worker', reason: 'infra_failed' }, 'paused'],
  ['T28', 'completed', 'incomplete_comparison', { actor: 'worker', reason: 'incomplete_comparison' }, 'paused'],
  ['T29', 'paused', 'resume', { ...humanTask, budgetAvailable: true, calibrationComplete: true, targetReached: true }, 'completed'],
];
const triple = (state: string, event: string, actor: string) => `${state}/${event}/${actor}`;
const legalIterations = new Set(iterationRows.map(([, state, event, context]) => triple(state, event, context.actor)));
const illegalIterations = RSI_ITERATION_STATES.flatMap(state => (Object.keys(iterationEvents) as RsiIterationEvent[]).flatMap(event => actors
  .filter(actor => !legalIterations.has(triple(state, event, actor))).map(actor => [state, event, actor] as const)));
const legalTasks = new Set(taskRows.map(([, state, event, context]) => triple(state, event, context.actor)));
const illegalTasks = RSI_TASK_STATES.flatMap(state => (Object.keys(taskEvents) as RsiTaskEvent[]).flatMap(event => actors
  .filter(actor => !legalTasks.has(triple(state, event, actor))).map(actor => [state, event, actor] as const)));

describe('RSI complete iteration transition table', () => {
  it.each(iterationRows)('%s: %s + %s', (_id, state, event, context, expected) => {
    expect(transitionIteration(state, event, context)).toBe(expected);
  });
  it.each(illegalIterations)('rejects unlisted %s + %s by %s', (state, event, actor) => {
    expect(() => transitionIteration(state, event, { actor, reason: 'Attempted transition', holdReasons: ['dependency_change'], approvedCategories: ['dependency_change'], resumeState: 'training', sealedBudgetRemaining: 1, hasSealedResult: true })).toThrow(RsiTransitionError);
  });
  it('records the exact state, event and actor in illegal-transition errors', () => {
    expect(() => transitionIteration('held', 'approve', { actor: 'worker' })).toThrow('state=held, event=approve, actor=worker');
    try { transitionIteration('held', 'approve', { actor: 'worker' }); } catch (error) {
      expect(error).toMatchObject({ state: 'held', event: 'approve', actor: 'worker' });
    }
  });
  it.each(iterationRows.filter(([, , , context]) => context.reason !== undefined))('%s rejects a blank mandatory reason', (_id, state, event, context) => {
    expect(() => transitionIteration(state, event, { ...context, reason: '  ' })).toThrow();
  });
  it.each([0, -1, 1.5, NaN, Infinity])('does not start a sealed group with budget %s', sealedBudgetRemaining => {
    expect(() => transitionIteration('reviewing', 'review_pass', { actor: 'worker', sealedBudgetRemaining })).toThrow();
    expect(() => transitionIteration('held', 'approve', { actor: 'human', reason: 'Review', holdReasons: ['l4_suspicious'], approvedCategories: ['l4_suspicious'], resumeState: 'sealed', sealedBudgetRemaining })).toThrow();
  });
  it('never lets approval waive missing review or incomplete comparison', () => {
    for (const holdReasons of [['missing_monitor'], ['missing_adversarial'], ['incomplete_comparison'], ['l4_suspicious', 'missing_monitor']] as const) {
      expect(() => transitionIteration('held', 'approve', { actor: 'human', reason: 'Approval cannot invent evidence', holdReasons: [...holdReasons], approvedCategories: ['l4_suspicious'], resumeState: 'sealed', sealedBudgetRemaining: 1 })).toThrow();
    }
  });
  it('requires exact approved categories and rejects duplicates', () => {
    const context: RsiIterationContext = { actor: 'human', reason: 'Review', holdReasons: ['l3_suspicious', 'l4_suspicious'], resumeState: 'sealed', sealedBudgetRemaining: 1 };
    expect(() => transitionIteration('held', 'approve', { ...context, approvedCategories: ['l3_suspicious'] })).toThrow();
    expect(() => transitionIteration('held', 'approve', { ...context, approvedCategories: ['l3_suspicious', 'l3_suspicious'] })).toThrow();
    expect(() => transitionIteration('held', 'approve', { ...context, holdReasons: ['l3_suspicious', 'l3_suspicious'], approvedCategories: ['l3_suspicious', 'l3_suspicious'] })).toThrow();
  });
  it('cannot jump from a dependency hold past training', () => {
    expect(() => transitionIteration('held', 'approve', { actor: 'human', reason: 'Approved dependency', holdReasons: ['dependency_change'], approvedCategories: ['dependency_change'], resumeState: 'sealed', sealedBudgetRemaining: 1 })).toThrow();
  });
  it('requires a completed sealed result for late token approval, without another budget debit', () => {
    const context: RsiIterationContext = { actor: 'human', reason: 'Accepted growth', holdReasons: ['token_growth'], approvedCategories: ['token_growth'], resumeState: 'deciding', sealedBudgetRemaining: 0 };
    expect(() => transitionIteration('held', 'approve', context)).toThrow();
    expect(transitionIteration('held', 'approve', { ...context, hasSealedResult: true })).toBe('deciding');
  });
  it('does not promote or accept sealed results without retained completed evidence', () => {
    expect(() => transitionIteration('sealed', 'sealed_accept', worker)).toThrow();
    expect(() => transitionIteration('deciding', 'promotion_pass', worker)).toThrow();
  });
  it('reruns mixed missing/suspicious reviews without allowing unrelated holds to disappear', () => {
    const context: RsiIterationContext = { actor: 'human', reason: 'Rerun missing review', holdReasons: ['missing_monitor', 'l3_suspicious'] };
    expect(transitionIteration('held', 'retry_review', context)).toBe('reviewing');
    expect(() => transitionIteration('held', 'retry_review', { ...context, holdReasons: ['missing_monitor', 'token_growth'] })).toThrow();
    expect(() => transitionIteration('held', 'retry_review', { ...context, holdReasons: ['l4_suspicious'] })).toThrow();
  });
  it('allows an infrastructure retry of an already reserved sealed group with no remaining budget', () => {
    expect(transitionIteration('held', 'retry_evaluation', { actor: 'human', reason: 'Retry infrastructure', holdReasons: ['incomplete_comparison'], resumeState: 'sealed', sealedBudgetRemaining: 0 })).toBe('sealed');
  });
  it('routes late incomplete evidence to its evaluation phase instead of approving it', () => {
    for (const resumeState of ['training', 'sealed'] as const) {
      expect(transitionIteration('deciding', 'promotion_hold', { ...explained, holdReasons: ['incomplete_comparison'], resumeState })).toBe('held');
    }
  });
  it.each(['precheck_pass', 'training_pass', 'review_pass', 'sealed_accept', 'promotion_pass'] as const)('does not accept residual holds with %s', event => {
    const states: Record<typeof event, RsiIterationState> = { precheck_pass: 'precheck', training_pass: 'training', review_pass: 'reviewing', sealed_accept: 'sealed', promotion_pass: 'deciding' };
    expect(() => transitionIteration(states[event], event, { actor: 'worker', holdReasons: ['token_growth'], sealedBudgetRemaining: 1, hasSealedResult: true })).toThrow();
  });
  it('rejects unsupported runtime state/event strings', () => {
    expect(() => transitionIteration('unknown' as never, 'submit', { actor: 'optimizer' })).toThrow();
    expect(() => transitionIteration('draft', 'unknown' as never, { actor: 'optimizer' })).toThrow();
  });
});

describe('RSI complete task transition table', () => {
  it.each(taskRows)('%s: %s + %s', (_id, state, event, context, expected) => {
    expect(transitionTask(state, event, context)).toBe(expected);
  });
  it.each(illegalTasks)('rejects unlisted %s + %s by %s', (state, event, actor) => {
    expect(() => transitionTask(state, event, { actor, reason: 'Attempted transition', budgetAvailable: true, calibrationComplete: true, targetReached: true })).toThrow(RsiTransitionError);
  });
  it.each(taskRows.filter(([, , , context]) => context.reason !== undefined))('%s requires a nonempty reason', (_id, state, event, context) => {
    expect(() => transitionTask(state, event, { ...context, reason: '' })).toThrow();
  });
  it('never resumes without positive budget confirmation or known calibration status', () => {
    expect(() => transitionTask('paused', 'resume', { ...humanTask, budgetAvailable: false, calibrationComplete: true })).toThrow();
    expect(() => transitionTask('paused', 'resume', { ...humanTask, budgetAvailable: true })).toThrow();
  });
  it('does not complete calibration with missing results or budget', () => {
    expect(() => transitionTask('calibrating', 'calibrated', { actor: 'worker', budgetAvailable: true, calibrationComplete: false })).toThrow();
    expect(() => transitionTask('calibrating', 'calibrated', { actor: 'worker', budgetAvailable: false, calibrationComplete: true })).toThrow();
  });
  it('does not complete a task without an actual promoted target result', () => {
    expect(() => transitionTask('running', 'target_reached', { actor: 'worker', targetReached: false })).toThrow();
  });
  it('exhausted budgets pause rather than permanently stop tasks', () => {
    expect(transitionTask('running', 'budget_exhausted', { actor: 'worker', reason: 'budget_exhausted' })).toBe('paused');
    expect(transitionTask('paused', 'resume', { ...humanTask, budgetAvailable: true, calibrationComplete: true })).toBe('running');
  });
  it('resumes final-only work to completed without restarting optimization', () => {
    expect(transitionTask('completed', 'budget_exhausted', { actor: 'worker', reason: 'Final evaluation reached the task budget' })).toBe('paused');
    const context: RsiTaskContext = { ...humanTask, budgetAvailable: true, calibrationComplete: true, targetReached: true };
    expect(transitionTask('paused', 'resume', context)).toBe('completed');
    expect(() => transitionTask('paused', 'resume', { ...context, budgetAvailable: false })).toThrow();
    expect(() => transitionTask('paused', 'resume', { ...context, calibrationComplete: false })).toThrow();
  });
});

const snapshotAt = '2026-11-07T00:00:00.000Z';
function iterationSnapshot(state: RsiIterationState, context: RsiIterationContext): RsiIteration {
  return {
    id: 'iteration', taskId: 'task', seq: 1, parentId: null, commit: 'a'.repeat(40),
    prd: { observation: 'Observed', hypothesis: 'General improvement', changes: ['src/agent.ts'], expectedImpact: 'One additional pass' },
    packageSha256: null, state, holdReasons: state === 'held' ? context.holdReasons ?? [] : [],
    resumeState: state === 'held' ? context.resumeState ?? 'sealed' : null,
    approvals: [], trainScore: null, sealedScore: null, createdAt: snapshotAt, updatedAt: snapshotAt,
  };
}
function taskSnapshot(state: RsiTaskState, event?: RsiTaskEvent): RsiTask {
  return {
    id: 'task', repository: 'repo', baselineCommit: 'a'.repeat(40), datasetHash: 'b'.repeat(64), mainMetric: 'passed_count',
    config: defaultRsiConfig(), state,
    pauseReason: state === 'paused' ? event === 'budget_exhausted' || event === 'infra_failed' || event === 'incomplete_comparison' ? event : 'human' : null,
    delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0,
    tokenUsage: 0, iterationCount: 0, monitorCalibration: null, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: snapshotAt, updatedAt: snapshotAt,
  };
}
describe('RSI ledger snapshot state transitions', () => {
  it.each(iterationRows)('replays %s through the same iteration state guards', (_id, from, _event, context, to) => {
    expect(() => validateIterationSnapshotTransition(iterationSnapshot(from, context), iterationSnapshot(to, context), context)).not.toThrow();
  });
  it.each(taskRows)('replays %s through the same task state guards', (_id, from, event, context, to) => {
    expect(() => validateTaskSnapshotTransition(taskSnapshot(from), taskSnapshot(to, event), context)).not.toThrow();
  });
  it('allows only draft iterations and created tasks as first snapshots', () => {
    expect(() => validateIterationSnapshotTransition(null, iterationSnapshot('draft', worker), worker)).not.toThrow();
    expect(() => validateTaskSnapshotTransition(null, taskSnapshot('created'), { actor: 'human' })).not.toThrow();
  });
  it.each(RSI_ITERATION_STATES.filter(state => state !== 'draft'))('rejects a first iteration snapshot already %s', state => {
    expect(() => validateIterationSnapshotTransition(null, iterationSnapshot(state, worker), worker)).toThrow();
  });
  it.each(RSI_TASK_STATES.filter(state => state !== 'created'))('rejects a first task snapshot already %s', state => {
    expect(() => validateTaskSnapshotTransition(null, taskSnapshot(state), { actor: 'human' })).toThrow();
  });
  it('rejects skipping directly to promotion or task completion', () => {
    expect(() => validateIterationSnapshotTransition(iterationSnapshot('draft', worker), iterationSnapshot('promoted', worker), { actor: 'worker', hasSealedResult: true })).toThrow();
    expect(() => validateTaskSnapshotTransition(taskSnapshot('created'), taskSnapshot('completed'), { actor: 'worker', targetReached: true })).toThrow();
  });
  it('derives held reasons from the old snapshot, never supplied replacement context', () => {
    const before = iterationSnapshot('held', { actor: 'worker', holdReasons: ['missing_monitor'], resumeState: 'sealed' });
    const fake: RsiIterationContext = { actor: 'human', reason: 'Attempted waiver', holdReasons: ['l4_suspicious'], approvedCategories: ['l4_suspicious'], resumeState: 'sealed', sealedBudgetRemaining: 1 };
    expect(() => validateIterationSnapshotTransition(before, iterationSnapshot('sealed', fake), fake)).toThrow();
  });
  it('does not permit worker exit from held or a false resume destination', () => {
    const before = iterationSnapshot('held', { actor: 'human', holdReasons: ['incomplete_comparison'], resumeState: 'training' });
    expect(() => validateIterationSnapshotTransition(before, iterationSnapshot('training', worker), { actor: 'worker', reason: 'Retry' })).toThrow();
    expect(() => validateTaskSnapshotTransition(taskSnapshot('paused'), taskSnapshot('running'), { actor: 'human', reason: 'Resume', budgetAvailable: true, calibrationComplete: false })).toThrow();
  });
  it('rejects resuming a completed target into running after final evaluation pauses it', () => {
    const context: RsiTaskContext = { ...humanTask, budgetAvailable: true, calibrationComplete: true, targetReached: true };
    expect(() => validateTaskSnapshotTransition(taskSnapshot('paused'), taskSnapshot('running'), context)).toThrow();
    expect(() => validateTaskSnapshotTransition(taskSnapshot('paused'), taskSnapshot('completed'), context)).not.toThrow();
  });
  it('leaves same-state metadata validation to storage without mutating either snapshot', () => {
    const before = iterationSnapshot('training', worker), after = { ...before, updatedAt: '2026-11-07T00:00:01.000Z' };
    const saved = JSON.stringify([before, after]);
    expect(() => validateIterationSnapshotTransition(before, after, worker)).not.toThrow();
    expect(JSON.stringify([before, after])).toBe(saved);
    expect(() => validateTaskSnapshotTransition(taskSnapshot('running'), taskSnapshot('running'), { actor: 'worker' })).not.toThrow();
  });
});
