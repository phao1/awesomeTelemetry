import type { RsiNoiseInput, RsiNoiseResult } from './rsi-types.js';

/** RSI-004: zero-null ordered differences, not independent score samples. */
export function calibrateNoiseBand(input: RsiNoiseInput): RsiNoiseResult {
  const { repetitions, plannedQuestionIds, infraErrorMaxRatio } = input;
  if (!Number.isFinite(infraErrorMaxRatio) || infraErrorMaxRatio < 0 || infraErrorMaxRatio > 1) {
    throw new Error('RSI infraErrorMaxRatio must be in [0,1]');
  }
  if (repetitions.length < 2 || plannedQuestionIds.length === 0) {
    throw new Error('RSI calibration requires at least two repetitions and one planned question');
  }
  const planned = new Set(plannedQuestionIds);
  if (planned.size !== plannedQuestionIds.length || plannedQuestionIds.some(id => !id.trim())) {
    throw new Error('RSI planned question IDs must be nonempty and unique');
  }
  let unresolved = 0;
  let complete = true;
  const passedCounts = repetitions.map(results => {
    const seen = new Set<string>();
    let passed = 0;
    for (const result of results) {
      if (!planned.has(result.questionId) || seen.has(result.questionId)) {
        throw new Error('RSI calibration has an unexpected or duplicate question');
      }
      seen.add(result.questionId);
      if (result.outcome === 'infra_error') unresolved += 1;
      else if (result.outcome === 'pass') passed += 1;
      else if (result.outcome !== 'fail') throw new Error('RSI calibration has an invalid outcome');
    }
    if (seen.size !== planned.size) complete = false;
    return passed;
  });
  const infraErrorRatio = unresolved / (planned.size * repetitions.length);
  if (unresolved !== 0 || !complete) {
    return {
      status: infraErrorRatio > infraErrorMaxRatio ? 'infra_failed' : 'incomplete_comparison',
      delta: null, baselineTrainScore: null, infraErrorRatio, passedCounts,
    };
  }
  // Each ordered pair appears exactly once. Their mean is exactly zero for
  // integer passed counts, including the reverse of every nonzero difference.
  let squaredDifferences = 0;
  for (let i = 0; i < passedCounts.length; i += 1) {
    for (let j = 0; j < passedCounts.length; j += 1) {
      if (i !== j) squaredDifferences += (passedCounts[i]! - passedCounts[j]!) ** 2;
    }
  }
  const pairCount = passedCounts.length * (passedCounts.length - 1);
  return {
    status: 'ready', delta: 2 * Math.sqrt(squaredDifferences / (pairCount - 1)),
    baselineTrainScore: passedCounts.reduce((sum, count) => sum + count, 0) / passedCounts.length,
    infraErrorRatio, passedCounts,
  };
}
