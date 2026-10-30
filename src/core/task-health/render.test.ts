import { expect, it } from 'vitest';
import input from '../__fixtures__/task-health/g1-serial.input.json';
import type { HealthInput } from './types.js';
import { analyzeTaskHealth } from './report.js';
import { renderTaskHealthHtml, renderTaskHealthMarkdown } from './render.js';
const report = () => analyzeTaskHealth(input as HealthInput, undefined, { id: 'r', generatedAt: '2026-10-30T00:00:00.000Z' });
it('escapes titles, evidence and all finding source strings in offline HTML', () => {
  const r = report(); r.taskId = '<script>alert(1)</script>'; r.evidence[0]!.title = '<script src="https://evil.invalid"></script>'; r.evidence[0]!.summary = '</li><img src=x onerror=alert(1)>';
  r.findings[0]!.recommendation.action = '<script>alert(2)</script>';
  const html = renderTaskHealthHtml(r); expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('<style>'); expect(html).not.toMatch(/<link|<iframe|<a\s/i);
});
it('escapes Markdown delimiters and unsafe link destinations without creating links', () => {
  const r = report(); r.evidence[0]!.title = '[open](javascript:alert(1))'; r.evidence[0]!.summary = '<script>alert(1)</script>\n# injected';
  const md = renderTaskHealthMarkdown(r); expect(md).toContain('\\[open\\]\\(javascript\\:'); expect(md).not.toContain('<script>'); expect(md).not.toContain('\n# injected');
});
it('includes all eight report sections, samples, quality caveat and bounded public evidence', () => {
  const r = report(); r.evidence[0]!.summary = 'x'.repeat(1600);
  const md = renderTaskHealthMarkdown(r); for (const title of ['结论', '范围与快照', '根方程对账', '体验', '五维诊断', '质量门', '建议汇总', '计算依据']) expect(md).toContain(title);
  expect(md).toContain('[截断]'); expect(md).not.toContain('x'.repeat(1501)); expect(md).toContain('质量验收未知'); expect(md).toContain('n=');
});
it('omits authentication values from rendered source excerpts', () => {
  const r = report(); r.evidence[0]!.summary = 'Authorization: Bearer SECRET123 api_key="PRIVATE456" https://user:password@example.test';
  for (const text of [renderTaskHealthHtml(r), renderTaskHealthMarkdown(r)]) { expect(text).not.toContain('SECRET123'); expect(text).not.toContain('PRIVATE456'); expect(text).not.toContain('user:password'); }
});
