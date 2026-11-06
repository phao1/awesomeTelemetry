import type { RsiEvaluation, RsiIteration, RsiPromotionInput, RsiRun } from '../../src/core/rsi-types.js';
import type { RsiStore } from './queue.js';
import { isInformationalReviewFinding } from './review.js';

export function finalRuns(e: RsiEvaluation, all: RsiRun[]): RsiRun[] {
  const own = all.filter(r => r.evaluationId === e.id), result: RsiRun[] = [];
  for (let repetition = 0; repetition < e.repetitions; repetition++) for (const questionId of e.questionIds) {
    const first = own.find(r => r.questionId === questionId && r.repetition === repetition && r.attempt === 0);
    const last = first?.outcome === 'infra_error' ? own.find(r => r.questionId === questionId && r.repetition === repetition && r.attempt === 1) : first;
    if (last) result.push(last);
  }
  return result;
}
export function promotionInput(store: RsiStore, trainIds: string[], iteration: RsiIteration, currentReview?: {monitor:{status:'clean'|'suspicious'|'missing'};adversarial:{status:'clean'|'suspicious'|'missing'}}): RsiPromotionInput {
    const t = store.task(), evaluations = store.list('evaluation_put'), runs = store.list('run_put'), iterations = store.list('iteration_put');
    const completed = (id: string | null, phase: RsiEvaluation['phase']) => evaluations.find(e => e.iterationId === id && e.phase === phase && e.state === 'completed' && e.score !== null);
    const observed = new Map<string,RsiRun[]>();
    const runsFor=(e:RsiEvaluation):RsiRun[]=>{let value=observed.get(e.id);if(!value){value=finalRuns(e,runs);observed.set(e.id,value);}return value;};
    const train = completed(iteration.id, 'train'), parentTrain = completed(iteration.parentId, 'train');
    const sealed = completed(iteration.id, 'sealed'), parentSealed = completed(iteration.parentId, 'sealed');
    const parent = iterations.find(i => i.id === iteration.parentId);
    const findings = store.list('finding_put').filter(f => f.iterationId === iteration.id && !isInformationalReviewFinding(f));
    const review = (level: 'L3' | 'L4'): { status: 'clean' | 'suspicious' | 'missing' } => ({ status: iteration.holdReasons.includes(level==='L4'?'missing_monitor':'missing_adversarial')?'missing':findings.some(f => f.level === level && f.category !== 'review_clean') ? 'suspicious'
      : findings.some(f => f.level === level && f.category === 'review_clean') ? 'clean' : 'missing' });
    const complete = (a?: RsiEvaluation, b?: RsiEvaluation): boolean => !!a && !!b && a.score !== null && b.score !== null
      && [...a.questionIds].sort().join(',') === [...b.questionIds].sort().join(',');
    const tokens = (evaluation: RsiEvaluation | undefined, q: string): number | null => {
      if (!evaluation) return null;
      const values = runsFor(evaluation).filter(r => r.questionId === q);
      if (values.length !== evaluation.repetitions || values.some(r => r.outcome === 'infra_error' || r.proxyTokens === null)) return null;
      return values.reduce((n, r) => n + r.proxyTokens!, 0) / values.length;
    };
    const lineage: Array<RsiIteration | null> = [];
    let ancestor = parent;
    while (ancestor) { lineage.unshift(ancestor); ancestor = iterations.find(i => i.id === ancestor!.parentId); }
    lineage.unshift(null);
    const histories = trainIds.map(questionId => ({ questionId,
      // A baseline is one ancestor version. Disagreement among calibration repeats
      // breaks stable history rather than manufacturing multiple ancestor versions.
      ancestorOutcomes: lineage.map(i => {
        const e = completed(i?.id ?? null, 'train');
        const values = e ? runsFor(e).filter(r => r.questionId === questionId) : [];
        return values.length && values.every(r => r.outcome === 'pass') ? 'pass' as const : values.length && values.every(r => r.outcome === 'fail') ? 'fail' as const : 'infra_error' as const;
      }),
      candidateOutcomes: evaluations.filter(e => e.iterationId === iteration.id && e.phase === 'train' && e.state === 'completed' && e.score !== null)
        .flatMap(e => runsFor(e).filter(r => r.questionId === questionId).map(r => r.outcome)),
    }));
    const input: RsiPromotionInput = { iterationId: iteration.id, commit: iteration.commit, delta: t.delta ?? 0,
      parentTrainScore: parent?.trainScore ?? t.baselineTrainScore, candidateTrainScore: iteration.trainScore,
      parentSealedScore: parent?.sealedScore ?? t.baselineSealedScore, candidateSealedScore: iteration.sealedScore,
      trainComparisonComplete: complete(train, parentTrain), sealedComparisonComplete: complete(sealed, parentSealed),
      findings, monitor: currentReview?.monitor??review('L4'), adversarial: currentReview?.adversarial??review('L3'), approvals: iteration.approvals,
      stableHistories: histories, stableWindow: t.config.stableWindow, stableFailRepeats: t.config.stableFailRepeats,
      tokenPairs: trainIds.map(questionId => ({ questionId, parentMeanTokens: tokens(parentTrain, questionId), candidateMeanTokens: tokens(train, questionId) })), tokenGrowthMaxRatio: t.config.tokenGrowthMaxRatio };
    return input;
  }
