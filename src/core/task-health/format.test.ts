import { expect, it } from 'vitest';
import { coverageReason, formatDuration, formatFacets, healthLabel, metricText, metricValue, reconciliationRows } from './format.js';
import { analyzeTaskHealth, renderFinding } from './report.js';
import input from '../__fixtures__/task-health/g8-multiturn.input.json';
import type { HealthInput } from './types.js';
it.each([[120, '120 ms'], [12300, '12.3 秒'], [312000, '5 分 12 秒'], [11520000, '3.2 小时'], [354240000, '4.1 天'], [null, '—']] as const)('formats duration %s with readable units', (value, expected) => { expect(formatDuration(value)).toBe(expected); });
it('formats English durations, percentages and null reasons without inventing zero', () => {
  expect(formatDuration(312000, 'en')).toBe('5 min 12 s');
  expect(metricValue({ value: 12.345, unit: 'pct', reason: null })).toBe('12.3%');
  expect(metricValue({ value: 1234, unit: 'count', reason: null })).toBe('1234');
  expect(metricValue({ value: null, unit: 'ms', reason: 'fewer_than_5_samples' })).toContain('— (有效样本少于 5');
});
it('labels causes, states, timing, facets and coverage reasons in both languages', () => {
  expect(healthLabel('unattributed')).toBe('未归因'); expect(healthLabel('observed')).toBe('日志观测'); expect(healthLabel('insufficient', 'en')).toBe('Insufficient data');
  expect(formatFacets({ component: 'active' })).toBe('活跃'); expect(coverageReason('native_line_limit')).toContain('单行超过');
  const r = analyzeTaskHealth(input as HealthInput, undefined, { id: 'r', generatedAt: input.snapshotAt }); expect(metricText(r.metrics[0]!)).toContain('任务端到端耗时（overview.e2e_ms）');
  const rows = reconciliationRows(r); expect(rows.find(row => row[0].includes('活跃'))?.[1]).toBe('24.0 秒'); expect(rows.find(row => row[0] === '等用户')?.[1]).toBe('1.0 小时');
});
it.each([['model', '长思考期间输出阶段提示'], ['tool', '长工具期间输出进度'], ['unattributed', '核对该空窗两端记录，补齐计时数据']])('formats long-gap advice for %s without changing facts', (cause, advice) => {
  const f = renderFinding({ id: 'gap', rule: 'perceived.long_gap', dimension: 'perceived', severity: 'notice', confidence: 'observed', facts: { gap: 120000, cause }, evidenceIds: [], intervalMs: [[0, 120000]] });
  expect(f.facts.gap).toBe(120000); expect(f.recommendation.action).toContain('2 分 0 秒'); expect(f.recommendation.action).toContain(advice);
});
it('distinguishes active and raw log milestones under TH-004a', () => {
  const r = analyzeTaskHealth(input as HealthInput, undefined, { id: 'r', generatedAt: input.snapshotAt });
  const rows = r.metrics.filter(m => m.key === 'ux.first_write_log');
  expect(metricText(rows.find(m => !m.facets.component)!)).toContain('活跃');
  expect(metricText(rows.find(m => m.facets.component === 'raw')!)).toContain('原值');
});
it('localizes every fixed facet value emitted by the metric engine and labels character counts', () => {
  for (const value of ['active', 'raw', 'reads', 'time', 'rounds', 'assistant', 'reasoning', 'tool', 'present', 'zero', 'unknown', 'reported', 'normalized', 'first_output', 'round_duration', 'input', 'output', 'cacheRead', 'cacheWrite', 'rounds2+', 'rate', 'sum', 'union', 'calls', 'tokens', 'work', 'ttft']) expect(formatFacets({ component: value })).not.toBe(value);
  expect(formatFacets({ component: 'reads' })).toBe('读取次数');
  expect(metricValue({ value: 42, unit: 'chars', reason: null })).toBe('42 字符');
});
it('describes an unattributed gap without attributing it to unattributed', () => {
  for (const cause of ['unattributed', '无法归因']) {
    const f = renderFinding({ id: 'gap', rule: 'perceived.long_gap', dimension: 'perceived', severity: 'notice', confidence: 'observed', facts: { gap: 120000, cause }, evidenceIds: [], intervalMs: null });
    expect(f.recommendation.action).toContain('最大日志空窗2 分 0 秒，未能归因到具体环节');
    expect(f.recommendation.action).toContain('could not be attributed'); expect(f.recommendation.action).not.toContain('归因为未归因');
  }
});
