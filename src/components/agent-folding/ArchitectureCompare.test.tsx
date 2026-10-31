import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ArchitectureComparisonResult, ImportedArchitectureCompare } from './ArchitectureCompare.js';
import fixture from '../../core/__fixtures__/ruoyi-perf-management-3x3.json';
import type { FoldingMetricRun } from '../../core/agent-folding-metrics.js';
it('renders imported comparison states through the active locale', () => {
  sessionStorage.removeItem('agent-architecture-comparison');
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<ImportedArchitectureCompare locale="en" onLocate={() => {}} onClose={() => {}}/>));
    expect(host.querySelector('h2')!.textContent).toBe('Imported comparison');
    expect(host.textContent).toContain('Temporary report in this tab'); expect(host.textContent).toContain('Select two different groups with 1–40 runs each.'); expect(host.textContent).not.toContain('导入结果对比');
    act(() => root.render(<ImportedArchitectureCompare locale="zh" onLocate={() => {}} onClose={() => {}}/>));
    expect(host.textContent).toContain('导入结果对比'); expect(host.textContent).toContain('请选择两个不同');
  } finally { act(() => root.unmount()); }
});
it('localizes source-task navigation in comparison details', () => {
  const host = document.createElement('div'), root = createRoot(host), runs = fixture.rows.map(row => row.item as unknown as FoldingMetricRun);
  try {
    act(() => root.render(<ArchitectureComparisonResult a={runs.slice(0, 1)} b={runs.slice(3, 4)} locale="en" onLocate={() => {}}/>));
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Open source task')).toBe(true);
    expect(host.textContent).not.toContain('查看来源任务');
  } finally { act(() => root.unmount()); }
});
