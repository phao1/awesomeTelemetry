import type {
  RsiActor, RsiApprovalCategory, RsiHoldReason, RsiIteration, RsiIterationContext,
  RsiIterationEvent, RsiIterationState, RsiTask, RsiTaskContext, RsiTaskEvent, RsiTaskState,
} from './rsi-types.js';

export class RsiTransitionError extends Error {
  readonly state: string;
  readonly event: string;
  readonly actor: RsiActor;
  constructor(state: string, event: string, actor: RsiActor) {
    super(`Illegal RSI transition: state=${state}, event=${event}, actor=${actor}`);
    this.name = 'RsiTransitionError';
    this.state = state;
    this.event = event;
    this.actor = actor;
  }
}

function reason(context: { reason?: string }): boolean {
  return typeof context.reason === 'string' && context.reason.trim().length > 0;
}
function exactlyReasons(context: RsiIterationContext, allowed: readonly RsiHoldReason[]): boolean {
  return !!context.holdReasons?.length
    && new Set(context.holdReasons).size === context.holdReasons.length
    && context.holdReasons.every(value => allowed.includes(value));
}
function noHolds(context: RsiIterationContext): boolean {
  return context.holdReasons === undefined || context.holdReasons.length === 0;
}
function hasBudget(context: RsiIterationContext): boolean {
  return Number.isSafeInteger(context.sealedBudgetRemaining) && context.sealedBudgetRemaining! > 0;
}
function approved(context: RsiIterationContext): boolean {
  const categories: RsiApprovalCategory[] = ['dependency_change', 'l3_suspicious', 'l4_suspicious', 'token_growth'];
  return reason(context) && exactlyReasons(context, categories)
    && !!context.approvedCategories?.length
    && context.approvedCategories.length === context.holdReasons!.length
    && new Set(context.approvedCategories).size === context.approvedCategories.length
    && context.approvedCategories.every(category => context.holdReasons!.includes(category));
}

/** Events attest to worker-owned checks; this reducer never executes a check. */
export function transitionIteration(state: RsiIterationState, event: RsiIterationEvent, context: RsiIterationContext): RsiIterationState {
  if (state === 'draft' && event === 'submit' && context.actor === 'optimizer') return 'submitted';
  if (context.actor === 'worker') {
    if (state === 'submitted' && event === 'start_precheck') return 'precheck';
    if (state === 'precheck') {
      if (event === 'precheck_pass' && noHolds(context)) return 'training';
      if (event === 'precheck_reject' && reason(context)) return 'rejected';
      if (event === 'precheck_hold' && reason(context) && exactlyReasons(context, ['dependency_change']) && context.resumeState === 'training') return 'held';
    }
    if (state === 'training') {
      if (event === 'training_pass' && noHolds(context)) return 'reviewing';
      if (event === 'training_reject' && reason(context)) return 'rejected';
      if (event === 'training_hold' && reason(context) && exactlyReasons(context, ['incomplete_comparison']) && context.resumeState === 'training') return 'held';
    }
    if (state === 'reviewing' && event === 'review_pass' && noHolds(context) && hasBudget(context)) return 'sealed';
    if (state === 'sealed') {
      if (event === 'sealed_accept' && noHolds(context) && context.hasSealedResult === true) return 'deciding';
      if (event === 'sealed_reject' && reason(context)) return 'rejected';
      if (event === 'sealed_hold' && reason(context) && exactlyReasons(context, ['incomplete_comparison']) && context.resumeState === 'sealed') return 'held';
    }
    if (state === 'deciding') {
      if (event === 'promotion_pass' && noHolds(context) && context.hasSealedResult === true) return 'promoted';
      if (event === 'promotion_reject' && reason(context)) return 'rejected';
      if (event === 'promotion_hold' && reason(context)) {
        if (exactlyReasons(context, ['token_growth']) && context.resumeState === 'deciding' && context.hasSealedResult === true) return 'held';
        if (exactlyReasons(context, ['incomplete_comparison']) && ['training', 'sealed'].includes(context.resumeState ?? '')) return 'held';
      }
    }
  }
  if (state === 'reviewing' && event === 'review_hold' && ['worker', 'monitor'].includes(context.actor)
    && reason(context) && exactlyReasons(context, ['missing_monitor', 'missing_adversarial', 'l3_suspicious', 'l4_suspicious']) && context.resumeState === 'sealed') return 'held';
  if (state === 'held' && context.actor === 'human' && reason(context)) {
    if (event === 'reject') return 'rejected';
    if (event === 'approve' && approved(context)) {
      if (exactlyReasons(context, ['dependency_change']) && context.resumeState === 'training') return 'training';
      if (exactlyReasons(context, ['l3_suspicious', 'l4_suspicious']) && context.resumeState === 'sealed' && hasBudget(context)) return 'sealed';
      if (exactlyReasons(context, ['token_growth']) && context.resumeState === 'deciding' && context.hasSealedResult === true) return 'deciding';
    }
    if (event === 'retry_review' && exactlyReasons(context, ['missing_monitor', 'missing_adversarial', 'l3_suspicious', 'l4_suspicious'])
      && context.holdReasons!.some(value => value === 'missing_monitor' || value === 'missing_adversarial')) return 'reviewing';
    if (event === 'retry_evaluation' && exactlyReasons(context, ['incomplete_comparison'])) {
      if (context.resumeState === 'training') return 'training';
      if (context.resumeState === 'sealed') return 'sealed';
    }
  }
  throw new RsiTransitionError(state, event, context.actor);
}

/** Paused work never bypasses calibration on resume. Terminal tasks do not run. */
export function transitionTask(state: RsiTaskState, event: RsiTaskEvent, context: RsiTaskContext): RsiTaskState {
  if (context.actor === 'worker') {
    if (state === 'created' && event === 'start' && context.budgetAvailable === true) return 'calibrating';
    if (state === 'calibrating' && event === 'calibrated' && context.calibrationComplete === true && context.budgetAvailable === true) return 'running';
    if (['calibrating', 'running', 'completed'].includes(state) && ['budget_exhausted', 'infra_failed', 'incomplete_comparison'].includes(event) && reason(context)) return 'paused';
    if (state === 'running' && event === 'sealed_budget_exhausted' && reason(context)) return 'needs_help';
    if (state === 'running' && event === 'target_reached' && context.targetReached === true) return 'completed';
  }
  if (context.actor === 'optimizer' && state === 'running' && event === 'declare_stuck' && reason(context)) return 'needs_help';
  if (context.actor === 'human' && reason(context)) {
    if (['created', 'calibrating', 'running', 'needs_help'].includes(state) && event === 'pause') return 'paused';
    if (['paused', 'needs_help'].includes(state) && event === 'resume' && context.budgetAvailable === true) {
      if (state === 'paused' && context.targetReached === true) {
        if (context.calibrationComplete === true) return 'completed';
        throw new RsiTransitionError(state, event, context.actor);
      }
      if (context.calibrationComplete === true) return 'running';
      if (context.calibrationComplete === false) return 'calibrating';
    }
    if (['created', 'calibrating', 'running', 'paused', 'needs_help', 'completed'].includes(state) && event === 'stop') return 'stopped';
  }
  throw new RsiTransitionError(state, event, context.actor);
}

/** Cache replay must use the same state edges as live scheduling. */
export function validateIterationSnapshotTransition(before: RsiIteration | null, after: RsiIteration, context: RsiIterationContext): void {
  if (before === null) {
    if (after.state !== 'draft') throw new RsiTransitionError('absent', `create:${after.state}`, context.actor);
    return;
  }
  if (before.state === after.state) return;
  const edges: Partial<Record<RsiIterationState, Partial<Record<RsiIterationState, RsiIterationEvent>>>> = {
    draft: { submitted: 'submit' },
    submitted: { precheck: 'start_precheck' },
    precheck: { training: 'precheck_pass', rejected: 'precheck_reject', held: 'precheck_hold' },
    training: { reviewing: 'training_pass', rejected: 'training_reject', held: 'training_hold' },
    reviewing: { sealed: 'review_pass', held: 'review_hold' },
    sealed: { deciding: 'sealed_accept', rejected: 'sealed_reject', held: 'sealed_hold' },
    deciding: { promoted: 'promotion_pass', rejected: 'promotion_reject', held: 'promotion_hold' },
    held: {
      training: before.holdReasons.includes('incomplete_comparison') ? 'retry_evaluation' : 'approve',
      sealed: before.holdReasons.includes('incomplete_comparison') ? 'retry_evaluation' : 'approve',
      deciding: 'approve', reviewing: 'retry_review', rejected: 'reject',
    },
  };
  const event = edges[before.state]?.[after.state];
  if (event === undefined) throw new RsiTransitionError(before.state, `snapshot:${after.state}`, context.actor);
  const held = before.state === 'held' ? before : after.state === 'held' ? after : null;
  const derived: RsiIterationContext = {
    ...context,
    holdReasons: held?.holdReasons ?? after.holdReasons,
    ...(held?.resumeState === null || held?.resumeState === undefined ? {} : { resumeState: held.resumeState }),
  };
  if (transitionIteration(before.state, event, derived) !== after.state) throw new RsiTransitionError(before.state, `snapshot:${after.state}`, context.actor);
}

/** State-only validation; the cache separately validates counters and evidence. */
export function validateTaskSnapshotTransition(before: RsiTask | null, after: RsiTask, context: RsiTaskContext): void {
  if (before === null) {
    if (after.state !== 'created') throw new RsiTransitionError('absent', `create:${after.state}`, context.actor);
    return;
  }
  if (before.state === after.state) return;
  let event: RsiTaskEvent | undefined;
  if (after.state === 'stopped') event = 'stop';
  else if (after.state === 'paused') {
    if (after.pauseReason === 'human') event = 'pause';
    else if (after.pauseReason !== null) event = after.pauseReason;
  } else if (after.state === 'needs_help') {
    if (context.actor === 'optimizer') event = 'declare_stuck';
    else if (context.actor === 'worker') event = 'sealed_budget_exhausted';
  } else if (before.state === 'created' && after.state === 'calibrating') event = 'start';
  else if (before.state === 'calibrating' && after.state === 'running') event = 'calibrated';
  else if ((before.state === 'paused' || before.state === 'needs_help') && (after.state === 'running' || after.state === 'calibrating' || after.state === 'completed')) event = 'resume';
  else if (after.state === 'completed') event = 'target_reached';
  if (event === undefined || transitionTask(before.state, event, context) !== after.state) {
    throw new RsiTransitionError(before.state, `snapshot:${after.state}`, context.actor);
  }
}
