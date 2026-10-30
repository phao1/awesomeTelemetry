import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HealthReportView } from './HealthReportView.js';
import { analyzeTaskHealth } from '../../../core/task-health/report.js';
import input from '../../../core/__fixtures__/task-health/g8-multiturn.input.json';
import type { HealthInput } from '../../../core/task-health/types.js';
it('shows eight sections, reconciled raw/active E2E and five cards with inert evidence and null reasons', () => {
  const report = analyzeTaskHealth(input as HealthInput, undefined, { id: 'g8', generatedAt: input.snapshotAt });
  report.metrics.push({ ...report.metrics[0]!, key: 'ux.ttfr_log', value: null, reason: 'native_line_limit' });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<HealthReportView report={report} locale="zh" onLocate={vi.fn()}/>));
    expect(host.querySelectorAll('article > section')).toHaveLength(8); expect(host.querySelectorAll('.health-card')).toHaveLength(5);
    const table = host.querySelector('table')!; expect(table.textContent).toContain('原值'); expect(table.textContent).toContain('活跃'); expect(table.textContent).toContain('24.0 秒'); expect(table.textContent).toContain('等用户');
    expect(host.textContent).toContain('— (原生日志单行超过读取上限。)'); expect(host.querySelector('.health-metric-key')).not.toBeNull();
    expect(host.querySelectorAll('.health-log-label').length).toBeGreaterThan(0); expect(host.querySelector('script')).toBeNull();
  } finally { act(() => root.unmount()); }
});

it('merges empty timing layers, folds null metrics with reasons and displays each metric once', () => {
  const report = analyzeTaskHealth(input as HealthInput, undefined, { id: 'compact', generatedAt: input.snapshotAt });
  const base = report.metrics[0]!;
  report.metrics = [
    ...(['model.ttft', 'model.tpot', 'model.reasoning_split'] as const).flatMap(key => ['proxy', 'exporter'].map(layer => ({ ...base, key, layer: layer as 'proxy' | 'exporter', value: null, samples: 0, facets: {}, reason: 'missing_eligible_evidence' }))),
    { ...base, key: 'model.ttft', layer: 'log_upper_bound', value: 1200, samples: 1, facets: {} },
    { ...base, key: 'model.ttft', layer: 'log_upper_bound', value: null, samples: 1, stat: 'p95', facets: {}, reason: 'fewer_than_5_samples' },
    { ...base, key: 'model.cache_hit', value: null, facets: {}, reason: 'native_line_limit' },
    { ...base, key: 'ux.volume_log', unit: 'chars', value: 42, facets: { component: 'assistant' } },
    { ...base, key: 'plan.explore_before_first_write', unit: 'count', value: 3, facets: { component: 'reads' } },
  ];
  const before = JSON.stringify(report), host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<HealthReportView report={report} locale="zh" onLocate={vi.fn()}/>));
    const model = host.querySelectorAll('.health-card')[3]!;
    expect(model.querySelectorAll(':scope > p > .health-metric-key')).toHaveLength(1);
    const missing = model.querySelector<HTMLDetailsElement>('.health-missing-metrics')!;
    expect(missing.open).toBe(false); expect(missing.querySelector('summary')!.textContent).toBe('暂无数据的指标（8）');
    expect(missing.textContent).toContain('首 Token 延迟：网络代理、导入上报 暂无样本');
    expect(missing.textContent).toContain('每 Token 延迟：网络代理、导入上报 暂无样本');
    expect(missing.textContent).toContain('思考分组延迟：网络代理、导入上报 暂无样本');
    expect(missing.textContent).toContain('有效样本少于 5'); expect(missing.textContent).toContain('原生日志单行超过');
    const keys = [...host.querySelectorAll('.health-metric-key')].map(node => node.textContent);
    expect(keys.filter(key => key === '(ux.volume_log)')).toHaveLength(1);
    expect(host.textContent).toContain('42 字符'); expect(host.textContent).toContain('读取次数'); expect(host.textContent).not.toContain('reads');
    expect(host.querySelectorAll('article > section')).toHaveLength(8); expect(JSON.stringify(report)).toBe(before);
  } finally { act(() => root.unmount()); }
});

it('excludes user wait from the largest Agent partition and omits a zero-only hint', () => {
  const report = analyzeTaskHealth(input as HealthInput, undefined, { id: 'partition', generatedAt: input.snapshotAt });
  report.partition = { modelOnly: 1000, toolOnly: 2000, overlap: 0, undivided: 0, delegateWait: 0, userWait: 999999, unattributed: 0 };
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<HealthReportView report={report} locale="zh" onLocate={vi.fn()}/>));
    const equation = host.querySelectorAll('article > section')[1]!;
    expect(equation.querySelector('p')!.textContent).toContain('仅工具 · 2.0 秒');
    report.partition.modelOnly = 0; report.partition.toolOnly = 0;
    act(() => root.render(<HealthReportView report={report} locale="zh" onLocate={vi.fn()}/>));
    expect(equation.textContent).not.toContain('最大分区优先核对证据'); expect(equation.textContent).toContain('等用户');
  } finally { act(() => root.unmount()); }
});

it('displays gap endpoints as local clocks and labels legacy offsets without guessing t0', () => {
  const report = analyzeTaskHealth(input as HealthInput, undefined, { id: 'clock', generatedAt: input.snapshotAt });
  report.t0 = new Date(2026, 0, 1, 12, 34, 0).toISOString();
  report.metrics = [{ ...report.metrics[0]!, key: 'ux.max_gap_log', facets: { startMs: '1814401000', endMs: '1814402000' } }];
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<HealthReportView report={report} locale="zh" onLocate={vi.fn()}/>));
    expect(host.textContent).toContain('开始 01-22 12:34:01 / 结束 01-22 12:34:02'); expect(host.textContent).not.toContain('相对任务起点');
    delete report.t0;
    act(() => root.render(<HealthReportView report={report} locale="zh" onLocate={vi.fn()}/>));
    expect(host.textContent).toContain('开始 21.0 天（相对任务起点）');
    act(() => root.render(<HealthReportView report={report} locale="en" onLocate={vi.fn()}/>));
    expect(host.textContent).toContain('relative to task origin');
  } finally { act(() => root.unmount()); }
});
