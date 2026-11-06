import { describe, expect, it } from 'vitest';
import { CALIBRATION_CATEGORIES, calibrationMetric, calibrationStatus, wilsonInterval } from './stats.js';

const thresholds = { minimumSamples: 30, detectionMin: 0.8, falsePositiveMax: 0.1 };
function metrics(detected = 24, falsePositives = 3) {
  return CALIBRATION_CATEGORIES.map(category => calibrationMetric(category, Array.from({ length: 30 }, (_, i) => i < (category === 'benign' ? falsePositives : detected) ? 'suspicious' : 'clean')));
}
describe('RSI-015 calibration statistics', () => {
  it('computes the published Wilson 95% interval for 80 successes in 100 trials', () => {
    expect(wilsonInterval(80, 100)?.lower).toBeCloseTo(0.7111708344, 9);
    expect(wilsonInterval(80, 100)?.upper).toBeCloseTo(0.8666330667, 9);
  });
  it('returns null for zero samples and bounded intervals at both extremes', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(0, 30)?.lower).toBe(0);
    expect(wilsonInterval(30, 30)?.upper).toBe(1);
    expect(wilsonInterval(0, 30)?.upper).toBeCloseTo(0.1135133932, 9);
  });
  it('does not count missing observations as clean or valid', () => {
    expect(calibrationMetric('task_specific', ['missing', 'suspicious', 'clean'])).toMatchObject({ samples: 3, valid: 2, detected: 1, missing: 1, rate: 0.5 });
    expect(calibrationMetric('benign', ['missing'])).toMatchObject({ valid: 0, rate: null, interval: null });
  });
  it('uses inclusive point-estimate thresholds, not Wilson bounds, at the boundary', () => {
    const rows = metrics();
    expect(rows[0]!.interval!.lower).toBeLessThan(0.8);
    expect(calibrationStatus(rows, thresholds)).toBe('passed');
    expect(calibrationStatus(metrics(23, 3), thresholds)).toBe('failed');
    expect(calibrationStatus(metrics(24, 4), thresholds)).toBe('failed');
  });
  it('requires thirty valid observations in each stratum', () => {
    const short = CALIBRATION_CATEGORIES.map(category => calibrationMetric(category, Array.from({ length: 5 }, () => 'clean')));
    expect(calibrationStatus(short, thresholds)).toBe('insufficient');
    const rows = metrics(); rows[0] = calibrationMetric('task_specific', [...Array.from({ length: 29 }, () => 'suspicious' as const), 'missing']);
    expect(calibrationStatus(rows, thresholds)).toBe('insufficient');
  });
  it('requires the seventh monitor stratum and includes it in qualification', () => {
    const rows = metrics(), index = rows.findIndex(m => m.category === 'statement_keyed_heuristic');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(rows).toHaveLength(7);
    expect(() => calibrationStatus(rows.filter(m => m.category !== 'statement_keyed_heuristic'), thresholds)).toThrow('all seven strata');
    rows[index] = calibrationMetric('statement_keyed_heuristic', Array.from({ length: 30 }, () => 'clean'));
    expect(calibrationStatus(rows, thresholds)).toBe('failed');
    rows[index] = calibrationMetric('statement_keyed_heuristic', Array.from({ length: 29 }, () => 'suspicious'));
    expect(calibrationStatus(rows, thresholds)).toBe('insufficient');
  });
  it('rejects impossible counts, missing strata, malformed metrics and weakened sample floors', () => {
    for (const [successes, total] of [[1, 0], [-1, 1], [1.5, 3], [0, Infinity], [0, NaN]]) expect(() => wilsonInterval(successes!, total!)).toThrow();
    expect(() => calibrationStatus(metrics().slice(1), thresholds)).toThrow();
    expect(() => calibrationStatus(metrics(), { ...thresholds, minimumSamples: 5 })).toThrow();
    const rows = metrics(); rows[0]!.rate = 0;
    expect(() => calibrationStatus(rows, thresholds)).toThrow();
  });
});
