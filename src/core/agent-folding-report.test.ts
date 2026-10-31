import { expect, it } from 'vitest';
import fixture from './__fixtures__/ruoyi-perf-management-3x3.json';
import type { FoldingMetricRun } from './agent-folding-metrics.js';
import { buildFoldingComparisonReport } from './agent-folding-report.js';
it('exports all three formats in wireframe order, escaping data without session bodies', () => {
  const a = fixture.rows.slice(3, 6).map(r => structuredClone(r.item) as unknown as FoldingMetricRun), b = fixture.rows.slice(6).map(r => r.item as unknown as FoldingMetricRun);
  a[0]!.labels.productMode = '<script>alert("x")</script>'; a[0]!.id = '=HYPERLINK("evil")';
  a[0]!.run.error = 'SECRET_SESSION_BODY';
  for (const format of ['html', 'markdown', 'csv'] as const) {
    const report = buildFoldingComparisonReport(a, b, format);
    let previous = -1;
    for (const label of ['1 · 质量', '2 · 职责去向', '3 · 调用链', '4 · 过程与时延', '5 · Token 与开销', '6 · 逐次明细']) { const i = report.indexOf(label); expect(i).toBeGreaterThan(previous); previous = i; }
    expect(report).toContain('无法判断有没有用例从通过变失败'); expect(report).toContain('不可比');
    expect(report).not.toContain('SECRET_SESSION_BODY');
    if (format === 'html') { expect(report).not.toContain('<script>'); expect(report).toContain('&lt;script&gt;'); }
    if (format === 'csv') expect(report).toContain('"\'=HYPERLINK');
  }
});
