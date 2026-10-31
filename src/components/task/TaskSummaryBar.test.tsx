import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import type { TaskContext } from '../../core/task-types.js';
import { TaskSummaryBar } from './TaskSummaryBar.js';
it('localizes status, exposes every calculation basis and preserves unknowns and multiple models', () => {
  const context = { task: { recordedStatus: 'running', startedAt: '2026-10-31T00:00:00Z', memberCount: 2, eventCount: 9688 }, metrics: { durationMs: 120000, input: 60, output: 20, cacheRead: 30, correctedTotal: 120, toolCalls: 12, errors: 0, costUsd: null, models: ['a', 'b'] } } as TaskContext;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<TaskSummaryBar context={context} locale="zh"/>));
    expect(host.textContent).toContain('运行中'); expect(host.textContent).toContain('费用未知'); expect(host.textContent).toContain('模型多个');
    expect([...host.querySelectorAll('dl>div')].every(node => Boolean(node.getAttribute('title')))).toBe(true);
    expect(host.querySelector('dl>div:last-child')!.getAttribute('title')).toBe('a, b');
    act(() => root.render(<TaskSummaryBar context={{ ...context, metrics: { ...context.metrics!, costUsd: 1.25 } }} locale="en"/>));
    expect(host.textContent).toContain('Running'); expect(host.textContent).toContain('$1.2500'); expect(host.textContent).toContain('ModelMultiple');
  } finally { act(() => root.unmount()); }
});
it('supports older contexts without invented zero values', () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<TaskSummaryBar context={{ task: { recordedStatus: 'unknown', memberCount: 1, eventCount: 0 } } as TaskContext} locale="en"/>));
    expect(host.textContent).toContain('Corrected totalUnknown'); expect(host.textContent).toContain('Tool callsUnknown');
  } finally { act(() => root.unmount()); }
});
it('shows per-field partial sums and known model lists with localized member-specific missing reasons', () => {
  const coverage = { known: 1, total: 3, missing: [
    { memberId: 'empty', name: 'Maxwell', reason: 'not_reported' as const },
    { memberId: 'unloaded', name: 'Newton', reason: 'detail_not_loaded' as const },
  ] };
  const context = { task: { recordedStatus: 'success', memberCount: 3, eventCount: 9688 }, metrics: { input: 60, output: 20, cacheRead: 30, correctedTotal: 110, models: ['known-model'], coverage: { input: coverage, output: coverage, cacheRead: coverage, correctedTotal: coverage, models: coverage } } } as TaskContext;
  const host = document.createElement('div'), root = createRoot(host);
  const field = (label: string) => [...host.querySelectorAll('dl>div')].find(node => node.querySelector('dt')?.textContent === label)!;
  try {
    act(() => root.render(<TaskSummaryBar context={context} locale="zh"/>));
    for (const label of ['输入 Token', '输出 Token', '缓存读', '修正总量', '模型']) {
      expect(field(label).textContent).toContain('部分（1/3 成员）');
      expect(field(label).getAttribute('title')).toContain('Maxwell (empty): 未报告');
      expect(field(label).getAttribute('title')).toContain('Newton (unloaded): 详情未加载');
    }
    expect(field('修正总量').textContent).toContain('110'); expect(field('模型').textContent).toContain('known-model');
    act(() => root.render(<TaskSummaryBar context={context} locale="en"/>));
    expect(field('Input tokens').textContent).toContain('60 · Partial (1/3 members)');
    expect(field('Input tokens').getAttribute('title')).toContain('Newton (unloaded): Detail not loaded');
    act(() => root.render(<TaskSummaryBar context={{ ...context, metrics: { ...context.metrics!, input: null, coverage: { ...context.metrics!.coverage!, input: { ...coverage, known: 0 } } } }} locale="zh"/>));
    expect(field('输入 Token').textContent).toBe('输入 Token未知');
  } finally { act(() => root.unmount()); }
});
