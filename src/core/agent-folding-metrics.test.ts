import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/ruoyi-perf-management-3x3.json';
import { foldingComparison, foldingDataIssues, foldingRunMetrics, foldingSummary } from './agent-folding-metrics.js';
import type { FoldingMetricRun } from './agent-folding-metrics.js';
import { correctedUsage } from './benchmark-analysis.js';
const runs = fixture.rows.map(r => r.item as unknown as FoldingMetricRun);
describe('r4 P5 user supplied aggregate measurements', () => {
  it('retains all nine original rows, unknown flags and the empty G3 host column', () => {
    expect(runs).toHaveLength(9);
    expect(fixture.rows.every(r => Object.keys(r.raw).length === 32)).toBe(true);
    for (const row of fixture.rows) {
      const item = row.item as unknown as FoldingMetricRun, m = foldingRunMetrics(item), raw = row.raw;
      expect(m.e2e).toBe(Number(raw['E2E时间(m)']));
      expect(m.passed).toBe(Number(raw['通过用例/总数'].split('/')[0]));
      expect(m.tokens).toBeNull(); expect(m.cacheHit).toBeNull(); expect(m.cacheRead).toBeNull(); expect(m.cacheWrite).toBeNull();
      expect(item.run.telemetry!.usage).toMatchObject({ inputIncludesCache: null, outputIncludesReasoning: null, cacheWriteReported: null });
      if (row.group === 'G3') { expect(raw['执行机ip']).toBe(''); expect(item.labels.host).toBeNull(); }
      for (const [key, value] of Object.entries(item.recorded!)) if (!['cacheCombined', 'reportedTokens', 'reportedCacheHit'].includes(key)) expect(m[key as keyof typeof m]).toBe(value);
    }
  });
  it('matches independently calculated mean/median/range/population CV for every original numeric metric', () => {
    for (const [group, expected] of Object.entries(fixture.expectedStats)) {
      const items = runs.filter(r => r.run.variantId === group);
      for (const [key, reference] of Object.entries(expected)) {
        const values = items.map(r => key === 'passed' ? r.run.verdict!.passed : (r.recorded as Record<string, number>)[key]!);
        const actual = foldingSummary(values);
        expect(actual.n).toBe(3);
        for (const stat of ['mean', 'median', 'min', 'max', 'cv'] as const) {
          if (reference[stat] === null) expect(actual[stat]).toBeNull(); else expect(actual[stat]).toBeCloseTo(reference[stat]!, 9);
        }
      }
    }
    const a = foldingSummary([204, 194, 201]);
    expect(a.mean).toBeCloseTo(599 / 3, 12); expect(a.median).toBe(201);
    expect(foldingSummary([256]).single).toBe(true); expect(foldingSummary([1, 100]).variable).toBe(true);
  });
  it('flags conflicting accounting, timing totals, outliers, LOC scope and multiple changed dimensions', () => {
    expect(foldingDataIssues(runs[0]!).join(' ')).toContain('未加思考');
    expect(foldingDataIssues(runs[3]!).join(' ')).toContain('另加思考');
    expect(foldingDataIssues(runs[1]!).join(' ')).toContain('平均耗时 × 次数');
    expect(foldingDataIssues(runs[5]!).join(' ')).toContain('函数重复率');
    expect(foldingDataIssues(runs[6]!).join(' ')).toContain('工具平均耗时');
    const result = foldingComparison(runs.slice(3, 6), runs.slice(6));
    expect(result.changes).toEqual(['productMode', 'environment']); expect(result.confounded).toBe(true);
    expect(result.rows.find(r => r.key === 'loc')).toMatchObject({ comparable: false, delta: null, ratio: null });
    expect(result.rows.find(r => r.key === 'tokens')).toMatchObject({ comparable: false, delta: null });
    expect(result.rows.find(r => r.key === 'passed')).toMatchObject({ delta: 55 });
    expect(result.regressions).toBeNull(); expect(result.limitations.join(' ')).toContain('没有逐用例结果');
  });
  it('uses a separate synthetic small fixture for explicit token conventions and measured proxy comparability', () => {
    const a = structuredClone(runs[0]!), b = structuredClone(runs[0]!);
    for (const r of [a, b]) {
      r.id = 'synthetic-accounting'; delete r.recorded; r.limitations = ['Synthetic accounting fixture, not user measurements'];
      r.run.telemetry!.usage = { input: 100, output: 20, reasoning: null, cacheRead: 50, cacheWrite: null, inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported: false };
      r.labels.ttftSource = 'proxy';
    }
    const metrics = foldingRunMetrics(a);
    expect(metrics.tokens).toBe(correctedUsage(a.run.telemetry!.usage).total);
    expect(metrics).toMatchObject({ tokens: 170, cacheWrite: 0, cache: 50, uncachedInput: 100 });
    expect(foldingComparison([a], [b]).rows.find(r => r.key === 'tokens')).toMatchObject({ comparable: true, delta: 0, ratio: 1 });
    b.run.telemetry!.usage.inputIncludesCache = true;
    expect(foldingComparison([a], [b]).rows.find(r => r.key === 'tokens')!.comparable).toBe(false);
    b.labels.ttftSource = 'reported';
    expect(foldingComparison([a], [b]).rows.find(r => r.key === 'ttft')!.comparable).toBe(false);
    expect(foldingDataIssues(a)).toContain('该工具不单独报告缓存写入');
  });
});
