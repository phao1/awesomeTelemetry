import type {
  RsiApprovalCategory, RsiConditionResult, RsiOutcome, RsiParentVersion,
  RsiPromotionInput, RsiPromotionResult, RsiStableHistory,
} from './rsi-types.js';

function nonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`RSI ${name} must be finite and nonnegative`);
}
function positiveInteger(value: number, name: string, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`RSI ${name} must be an integer >= ${minimum}`);
}
function outcomes(values: RsiOutcome[]): void {
  if (values.some(value => !['pass', 'fail', 'infra_error'].includes(value))) throw new Error('RSI invalid outcome');
}
function uniqueIds(values: { questionId: string }[], name: string): void {
  if (values.some(value => !value.questionId.trim()) || new Set(values.map(value => value.questionId)).size !== values.length) {
    throw new Error(`RSI ${name} requires unique nonempty question IDs`);
  }
}

/** Histories are chronological and scoped to one lineage; no unknown is skipped. */
export function isStableRegression(history: RsiStableHistory, stableWindow = 3, stableFailRepeats = 2): boolean {
  positiveInteger(stableWindow, 'stableWindow');
  positiveInteger(stableFailRepeats, 'stableFailRepeats', 2);
  outcomes(history.ancestorOutcomes);
  outcomes(history.candidateOutcomes);
  return history.ancestorOutcomes.length >= stableWindow && history.candidateOutcomes.length >= stableFailRepeats
    && history.ancestorOutcomes.slice(-stableWindow).every(outcome => outcome === 'pass')
    && history.candidateOutcomes.slice(-stableFailRepeats).every(outcome => outcome === 'fail');
}

/** All conditions are reported; only the first non-pass determines the verdict. */
export function decidePromotion(input: RsiPromotionInput): RsiPromotionResult {
  nonnegative(input.delta, 'delta');
  nonnegative(input.tokenGrowthMaxRatio, 'tokenGrowthMaxRatio');
  positiveInteger(input.stableWindow, 'stableWindow');
  positiveInteger(input.stableFailRepeats, 'stableFailRepeats', 2);
  for (const key of ['parentTrainScore', 'candidateTrainScore', 'parentSealedScore', 'candidateSealedScore'] as const) {
    if (input[key] !== null) nonnegative(input[key], key);
  }
  if (typeof input.trainComparisonComplete !== 'boolean' || typeof input.sealedComparisonComplete !== 'boolean') {
    throw new Error('RSI comparison completeness must be explicit');
  }
  if (![input.monitor.status, input.adversarial.status].every(status => ['clean', 'suspicious', 'missing'].includes(status))) {
    throw new Error('RSI invalid review status');
  }
  uniqueIds(input.stableHistories, 'stableHistories');
  uniqueIds(input.tokenPairs, 'tokenPairs');
  for (const pair of input.tokenPairs) {
    if (pair.parentMeanTokens !== null) nonnegative(pair.parentMeanTokens, 'parentMeanTokens');
    if (pair.candidateMeanTokens !== null) nonnegative(pair.candidateMeanTokens, 'candidateMeanTokens');
    if ((pair.parentMeanTokens ?? 0) > Number.MAX_SAFE_INTEGER || (pair.candidateMeanTokens ?? 0) > Number.MAX_SAFE_INTEGER) {
      throw new Error('RSI token means cannot exceed the safe-integer token-count limit');
    }
  }
  if (input.findings.some(finding => finding.iterationId !== input.iterationId)) {
    throw new Error('RSI finding belongs to a different iteration');
  }
  const approved = new Set<RsiApprovalCategory>();
  const approvable: RsiApprovalCategory[] = ['dependency_change', 'l3_suspicious', 'l4_suspicious', 'token_growth'];
  for (const approval of input.approvals) {
    const validDate = typeof approval.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(approval.at)
      && Number.isFinite(Date.parse(approval.at)) && new Date(approval.at).toISOString() === approval.at;
    const validCategories = approval.categories.length > 0 && new Set(approval.categories).size === approval.categories.length
      && approval.categories.every(category => approvable.includes(category));
    if (approval.iterationId === input.iterationId && approval.commit === input.commit && approval.reason.trim() && validDate && validCategories) {
      for (const category of approval.categories) approved.add(category);
    }
  }
  const rejectReasons: string[] = [];
  if (input.findings.some(finding => finding.level === 'L0')) rejectReasons.push('l0_reject');
  const dependencyFinding = (finding: RsiPromotionInput['findings'][number]) => ['dependency_change', 'file_mode_change'].includes(finding.category);
  if (input.findings.some(finding => finding.level === 'L1' && !dependencyFinding(finding))) rejectReasons.push('l1_reject');
  const holdReasons: string[] = [];
  if (input.findings.some(finding => finding.level === 'L1' && dependencyFinding(finding)) && !approved.has('dependency_change')) {
    holdReasons.push('dependency_change');
  }
  if (input.monitor.status === 'missing') holdReasons.push('missing_monitor');
  if (input.adversarial.status === 'missing') holdReasons.push('missing_adversarial');
  const suspicious = (level: 'L3' | 'L4') => input.findings.some(finding => finding.level === level
    && !(finding.category === 'review_clean' && finding.severity === 'info' && finding.source === 'monitor'));
  if ((input.adversarial.status === 'suspicious' || suspicious('L3')) && !approved.has('l3_suspicious')) holdReasons.push('l3_suspicious');
  if ((input.monitor.status === 'suspicious' || suspicious('L4')) && !approved.has('l4_suspicious')) holdReasons.push('l4_suspicious');
  const anti: RsiConditionResult = {
    condition: 'anti_cheating', verdict: rejectReasons.length ? 'reject' : holdReasons.length ? 'hold' : 'pass',
    reasons: [...rejectReasons, ...holdReasons],
  };
  const primary: RsiConditionResult = { condition: 'primary_metric', verdict: 'pass', reasons: [] };
  if (!input.trainComparisonComplete || input.parentTrainScore === null || input.candidateTrainScore === null) {
    primary.verdict = 'hold'; primary.reasons = ['incomplete_comparison'];
  } else if (input.candidateTrainScore - input.parentTrainScore <= input.delta) {
    primary.verdict = 'reject'; primary.reasons = ['gain_not_above_noise'];
  }
  const sealed: RsiConditionResult = { condition: 'sealed', verdict: 'pass', reasons: [] };
  if (!input.sealedComparisonComplete || input.parentSealedScore === null || input.candidateSealedScore === null) {
    sealed.verdict = 'hold'; sealed.reasons = ['incomplete_comparison'];
  } else if (input.candidateSealedScore < input.parentSealedScore - input.delta) {
    sealed.verdict = 'reject'; sealed.reasons = ['sealed_regression'];
  }
  const regressed = input.stableHistories.some(history => isStableRegression(history, input.stableWindow, input.stableFailRepeats));
  const stable: RsiConditionResult = {
    condition: 'stable_regression', verdict: regressed ? 'reject' : 'pass', reasons: regressed ? ['stable_regression'] : [],
  };
  const token: RsiConditionResult = { condition: 'token_growth', verdict: 'pass', reasons: [] };
  if (!input.trainComparisonComplete || !input.tokenPairs.length || input.tokenPairs.some(pair => pair.parentMeanTokens === null || pair.candidateMeanTokens === null)) {
    token.verdict = 'hold'; token.reasons = ['incomplete_comparison'];
  } else {
    const parentMean = input.tokenPairs.reduce((sum, pair) => sum + pair.parentMeanTokens!, 0) / input.tokenPairs.length;
    const candidateMean = input.tokenPairs.reduce((sum, pair) => sum + pair.candidateMeanTokens!, 0) / input.tokenPairs.length;
    if (candidateMean > parentMean * (1 + input.tokenGrowthMaxRatio) && !approved.has('token_growth')) {
      token.verdict = 'hold'; token.reasons = ['token_growth'];
    }
  }
  const conditions = [anti, primary, sealed, stable, token];
  const firstFailure = conditions.find(condition => condition.verdict !== 'pass');
  return { verdict: firstFailure?.verdict === 'reject' ? 'reject' : firstFailure ? 'hold' : 'promote', conditions };
}

/** Undefined requests automatic selection; null explicitly selects the baseline. */
export function selectParent(versions: RsiParentVersion[], delta: number, requestedParentId?: string | null): RsiParentVersion {
  nonnegative(delta, 'delta');
  const seenIds = new Set<string | null>();
  const seenSeqs = new Set<number>();
  for (const version of versions) {
    nonnegative(version.trainScore, 'trainScore');
    if (!Number.isSafeInteger(version.seq) || version.seq < 0 || seenIds.has(version.iterationId) || seenSeqs.has(version.seq)) {
      throw new Error('RSI parent versions require unique IDs and nonnegative integer sequences');
    }
    if ((version.state === 'baseline') !== (version.iterationId === null && version.seq === 0)) {
      throw new Error('RSI baseline identity must have null ID and sequence zero');
    }
    if (version.state !== 'baseline' && (!version.iterationId || version.seq === 0)) throw new Error('RSI invalid iteration parent identity');
    seenIds.add(version.iterationId); seenSeqs.add(version.seq);
  }
  const eligible = versions.filter(version => version.state === 'baseline' || version.state === 'promoted');
  if (!eligible.length) throw new Error('RSI no baseline or promoted parent is available');
  if (requestedParentId !== undefined) {
    const requested = eligible.find(version => version.iterationId === requestedParentId);
    if (!requested) throw new Error('RSI rollback parent is not a baseline or promoted version');
    return { ...requested };
  }
  const best = Math.max(...eligible.map(version => version.trainScore));
  const inBand = eligible.filter(version => version.trainScore >= best - delta);
  return { ...inBand.reduce((latest, version) => version.seq > latest.seq ? version : latest) };
}
