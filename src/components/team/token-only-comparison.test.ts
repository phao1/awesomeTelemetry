import { describe, expect, it } from 'vitest';
import type { TeamComparison, TeamComparisonMetricRow } from '../../core/trace-types.js';
import { tokenOnlyTeamComparison } from './token-only-comparison.js';

const row = (metricId: string, value: number | null): TeamComparisonMetricRow => ({
  metricId, dimension: 'cost', criteria: 'retained exporter evidence', direction: 'descriptive',
  left: { value, available: value !== null, complete: false, criteria: 'retained', evidenceIds: ['e-1'], numerator: null, denominator: null },
  right: { value: null, available: false, complete: false, criteria: 'unknown', evidenceIds: [], numerator: null, denominator: null },
  delta: null, relativeDelta: null, material: false, completeness: 'partial', evidenceIds: ['e-1'],
});
const comparison = (): TeamComparison => ({
  leftRunId: 'left', rightRunId: 'right', generatedAt: '2026-10-18T00:00:00.000Z',
  basis: { match: 'matched', goalMatch: true, criteriaMatch: null, projectMatch: null, revisionMatch: null,
    environmentMatch: null, modelMatch: null, templateMatch: null, completenessDelta: null, userDeclared: false, reasons: [] },
  dimensions: [{ dimension: 'cost', rows: [row('totalCostUsd', 12), row('costGini', 0.4), row('totalInputTokens', 31), row('totalOutputTokens', null)] }],
  strengths: ['totalCostUsd decreased 20%', 'totalInputTokens decreased 10%'],
  weaknesses: ['费用增加', 'wallClockMs increased'], tradeoffs: ['更快但更贵', 'fewer retries, more Tokens'],
  caveats: ['USD unavailable', 'native timing coverage is partial'],
});

describe('token-only Team comparison presentation policy', () => {
  it('omits monetary rows/statements without rewriting original values, evidence or unknowns', () => {
    const source = comparison(), before = structuredClone(source);
    const visible = tokenOnlyTeamComparison(source);
    expect(visible.dimensions[0]!.rows.map(item => item.metricId)).toEqual(['totalInputTokens', 'totalOutputTokens']);
    expect(visible.dimensions[0]!.rows[0]).toBe(source.dimensions[0]!.rows[2]);
    expect(visible.dimensions[0]!.rows[1]!.left.value).toBeNull();
    expect(visible.strengths).toEqual(['totalInputTokens decreased 10%']);
    expect(visible.weaknesses).toEqual(['wallClockMs increased']);
    expect(visible.tradeoffs).toEqual(['fewer retries, more Tokens']);
    expect(visible.caveats).toEqual(['native timing coverage is partial']);
    expect(source).toEqual(before);
  });

  it('preserves comparison basis, time/source identity and existing non-monetary dimensions', () => {
    const source = comparison();
    source.dimensions.push({ dimension: 'stability', rows: [{ ...row('failures', 0), dimension: 'stability' }] });
    const visible = tokenOnlyTeamComparison(source);
    expect(visible.basis).toBe(source.basis);
    expect(visible.generatedAt).toBe(source.generatedAt);
    expect([visible.leftRunId, visible.rightRunId]).toEqual(['left', 'right']);
    expect(visible.dimensions[1]).toEqual(source.dimensions[1]);
  });
});
