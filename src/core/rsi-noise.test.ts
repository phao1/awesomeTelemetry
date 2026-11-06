import { describe, expect, it } from 'vitest';
import { calibrateNoiseBand } from './rsi-noise.js';
import type { RsiNoiseInput } from './rsi-types.js';

function sample(counts: number[], size = 10): RsiNoiseInput {
  const plannedQuestionIds = Array.from({ length: size }, (_, i) => `q${i}`);
  return {
    plannedQuestionIds, infraErrorMaxRatio: .1,
    repetitions: counts.map(count => plannedQuestionIds.map((questionId, i) => ({ questionId, outcome: i < count ? 'pass' : 'fail' }))),
  };
}

describe('RSI ordered-pair noise calibration', () => {
  it('uses both ordered differences and sample denominator n-1 for R=2', () => {
    const result = calibrateNoiseBand(sample([4, 7]));
    expect(result).toEqual({ status: 'ready', delta: 2 * Math.sqrt(18), baselineTrainScore: 5.5, infraErrorRatio: 0, passedCounts: [4, 7] });
  });
  it('uses all six ordered pairs for R=3', () => {
    const result = calibrateNoiseBand(sample([7, 8, 9]));
    expect(result.delta).toBeCloseTo(2 * Math.sqrt(12 / 5), 14);
    expect(result.baselineTrainScore).toBe(8);
  });
  it('produces exactly zero when every repetition has the same passed count', () => {
    expect(calibrateNoiseBand(sample([7, 7, 7])).delta).toBe(0);
  });
  it('preserves fractional baseline means', () => {
    expect(calibrateNoiseBand(sample([1, 2, 2])).baselineTrainScore).toBe(5 / 3);
  });
  it('is independent of the presentation order of questions', () => {
    const input = sample([2, 5, 6]);
    const expected = calibrateNoiseBand(input);
    input.repetitions[1]!.reverse();
    expect(calibrateNoiseBand(input)).toEqual(expected);
  });
  it('at exactly the permitted infra ratio still withholds delta', () => {
    const input = sample([3, 3]);
    for (const repetition of input.repetitions) repetition[9]!.outcome = 'infra_error';
    expect(calibrateNoiseBand(input)).toEqual({ status: 'incomplete_comparison', delta: null, baselineTrainScore: null, infraErrorRatio: .1, passedCounts: [3, 3] });
  });
  it('marks infrastructure failure only above the configured ratio', () => {
    const input = sample([3, 3]);
    input.repetitions[0]![8]!.outcome = 'infra_error';
    for (const repetition of input.repetitions) repetition[9]!.outcome = 'infra_error';
    expect(calibrateNoiseBand(input)).toMatchObject({ status: 'infra_failed', delta: null, baselineTrainScore: null, infraErrorRatio: .15 });
  });
  it('does not invent infra outcomes for missing records or shrink the planned denominator', () => {
    const input = sample([3, 3]);
    input.repetitions[0]!.pop();
    expect(calibrateNoiseBand(input)).toMatchObject({ status: 'incomplete_comparison', delta: null, baselineTrainScore: null, infraErrorRatio: 0 });
  });
  it('counts one final outcome per planned slot; retries cannot be submitted twice', () => {
    const input = sample([3, 3]);
    input.repetitions[0]!.push({ questionId: 'q0', outcome: 'infra_error' });
    expect(() => calibrateNoiseBand(input)).toThrow('duplicate');
  });
  it('does not treat infra_error as fail when it replaces a passed result', () => {
    const input = sample([3, 3]);
    input.repetitions[0]![0]!.outcome = 'infra_error';
    expect(calibrateNoiseBand(input)).toMatchObject({ status: 'incomplete_comparison', passedCounts: [2, 3], baselineTrainScore: null });
  });
  it.each([-.1, 1.1, NaN, Infinity])('rejects invalid infra ratio %s', infraErrorMaxRatio => {
    expect(() => calibrateNoiseBand({ ...sample([1, 1]), infraErrorMaxRatio })).toThrow();
  });
  it('rejects too few repetitions', () => { expect(() => calibrateNoiseBand(sample([1]))).toThrow(); });
  it('rejects empty planned sets', () => { expect(() => calibrateNoiseBand(sample([0, 0], 0))).toThrow(); });
  it('rejects duplicate planned IDs', () => {
    const input = sample([1, 1]); input.plannedQuestionIds[1] = 'q0';
    expect(() => calibrateNoiseBand(input)).toThrow('unique');
  });
  it('rejects unknown questions', () => {
    const input = sample([1, 1]); input.repetitions[0]![0]!.questionId = 'unknown';
    expect(() => calibrateNoiseBand(input)).toThrow('unexpected');
  });
  it('rejects unknown outcomes', () => {
    const input = sample([1, 1]); input.repetitions[0]![0]!.outcome = 'timeout' as never;
    expect(() => calibrateNoiseBand(input)).toThrow('invalid outcome');
  });
  it('keeps inputs unchanged', () => {
    const input = sample([1, 2, 3]); const before = JSON.stringify(input);
    calibrateNoiseBand(input); expect(JSON.stringify(input)).toBe(before);
  });
});
