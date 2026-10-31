import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { DeepHealthReportView } from './DeepHealthReportView.js';
import type { DeepHealthReport, HealthInput } from '../../../core/task-health/types.js';
import { analyzeTaskHealth } from '../../../core/task-health/report.js';
import input from '../../../core/__fixtures__/task-health/g1-serial.input.json';
import { renderTaskHealthHtml, renderTaskHealthMarkdown } from '../../../core/task-health/render.js';
const parent = analyzeTaskHealth(input as HealthInput, undefined, { id: 'parent', generatedAt: input.snapshotAt });
const id = 'a'.repeat(64), record = 'record:'.repeat(10);
parent.findings[0]!.id = id;
const report: DeepHealthReport = { version: 1, id: 'deep', taskId: parent.taskId, reportId: parent.id, generatedAt: input.snapshotAt, promptVersion: 2, digest: 'digest', provider: 'openai-compatible', model: 'fixture', status: 'partial', timing: 'model_judged', causes: [{ hypothesis: '需要验证', support: '有证据', against: '覆盖有限', evidenceIds: [record] }], valueMoments: [{ kind: 'ttv', recordId: record, reason: '无法判断', counterEvidence: '无法判断', evidenceIds: [record] }], necessity: [{ findingId: id, verdict: 'necessary', alternative: '无法判断', evidenceIds: [record] }], experiments: [{ variable: '反馈', primaryMetric: '耗时', qualityGate: '验收', fixedTask: '固定任务', expectedInterval: '无法判断', evidenceIds: [record] }], rejected: [{ section: 'causes', index: 0, reason: 'Numeric claim outside fact table; not adopted.', token: '两次', excerpt: '出现两次长等待' }], analysis: { inputTokens: 22859, outputTokens: 1505, durationMs: 47843 }, limitations: ['native_line_limit', 'budget_rounds_60', 'facts_compacted', 'null_metrics: model.ttft, model.tpot', 'future_code'] };
it('uses shared Chinese presentation in UI and exports with titled identifiers', () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<DeepHealthReportView report={report} parent={parent} locale="zh"/>));
    for (const text of [host.textContent!, renderTaskHealthHtml(report, parent), renderTaskHealthMarkdown(report, parent)]) {
      for (const label of ['假设', '支持依据', '反对依据', '证据', '交付价值时刻', '必要', '变量', '主指标', '质量门槛', '固定任务', '预期区间', '部分采纳', '模型判断', '数字或单位换算不在事实表内', '所属部分', '序号: 1', '两次', '出现两次长等待', '输入 22,859 token · 输出 1,505 token · 用时 47.8 秒', '2 项指标无数据', 'future_code']) expect(text.replace(/<[^>]*>/g, '').replaceAll('\\_', '_')).toContain(label);
      expect(text).not.toContain('Numeric claim outside'); expect(text).not.toContain('inputTokens'); expect(text).not.toContain('model_judged');
    }
    expect(host.textContent).toContain('日志反馈空窗过长');
    expect(host.querySelector(`[title="${id}"]`)).not.toBeNull(); expect(host.querySelector(`[title="${record}"]`)).not.toBeNull();
    expect(host.querySelector('nav')!.textContent).toBe('HTML · Markdown · JSON');
    expect(host.querySelector('details summary')!.textContent).toBe('2 项指标无数据');
    expect(host.textContent).toContain('首 Token 延迟');
  } finally { act(() => root.unmount()); }
});
it('reads old rejection entries and falls back to short finding IDs without a parent', () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<DeepHealthReportView report={{ ...report, promptVersion: 1, rejected: [{ section: 'report', index: null, reason: 'Invalid model output schema.' }] }} locale="zh"/>));
    expect(host.textContent).toContain('模型输出结构不符合要求'); expect(host.querySelector(`[title="${id}"]`)!.textContent).toBe('aaaaaaaaaaaa…aaaaaa');
  } finally { act(() => root.unmount()); }
});
