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
  const md = renderTaskHealthMarkdown(r); expect(md).toContain('\\[open\\](javascript:'); expect(md).not.toContain('<script>'); expect(md).not.toContain('\n# injected');
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

it('renders readable values, root table and five cards before detailed basis without HTML entities in Markdown', () => {
  const r = report(); r.coverage.reasons.push('native_line_limit');
  const md = renderTaskHealthMarkdown(r), html = renderTaskHealthHtml(r);
  expect(md.indexOf('## 结论')).toBeLessThan(md.indexOf('## 根方程对账'));
  expect(md.indexOf('## 根方程对账')).toBeLessThan(md.indexOf('## 五维诊断'));
  expect(md).toContain('| 项 | 值 | 层级 |'); expect(md).toContain('任务端到端耗时'); expect(md).toContain('2 分 50 秒');
  expect(md).toContain('原生日志单行超过读取上限'); expect(md).not.toContain('&quot;'); expect(md).not.toContain('overview\\.');
  expect(md).not.toContain('{"measured"'); expect(md).not.toContain('{}'); expect(html.match(/class="health-card"/g)).toHaveLength(5);
});
it('compacts empty layers and null metric rows, preserves reasons and avoids duplicate complete metrics', () => {
  const r = report(), base = r.metrics[0]!;
  r.metrics = [
    ...(['model.ttft', 'model.tpot', 'model.reasoning_split'] as const).flatMap(key => ['proxy', 'exporter'].map(layer => ({ ...base, key, layer: layer as 'proxy' | 'exporter', value: null, samples: 0, reason: 'missing_eligible_evidence', facets: {} }))),
    { ...base, key: 'model.ttft', layer: 'kernel', value: 800, samples: 1, facets: {} },
    { ...base, key: 'model.ttft', layer: 'kernel', value: null, samples: 1, stat: 'p95', reason: 'fewer_than_5_samples', facets: {} },
    { ...base, key: 'model.cache_hit', value: null, reason: 'native_line_limit', facets: {} },
    { ...base, key: 'ux.volume_log', unit: 'chars', value: 42, facets: {} },
    { ...base, key: 'plan.explore_before_first_write', value: 3, facets: { component: 'reads' } },
  ];
  const before = JSON.stringify(r);
  for (const output of [renderTaskHealthMarkdown(r), renderTaskHealthHtml(r)]) {
    expect(output).toContain('首 Token 延迟：网络代理、导入上报 暂无样本');
    expect(output).toContain('每 Token 延迟：网络代理、导入上报 暂无样本');
    expect(output).toContain('思考分组延迟：网络代理、导入上报 暂无样本');
    expect(output).toContain('暂无数据的指标（8）'); expect(output).toContain('有效样本少于 5'); expect(output).toContain('原生日志单行超过');
    expect(output).toContain('800 ms'); expect(output).toContain('42 字符'); expect(output).toContain('读取次数'); expect(output).not.toContain('reads');
    expect(output.match(/信息负担（ux.volume/g)).toHaveLength(1);
  }
  const md = renderTaskHealthMarkdown(r);
  const missing = md.split('\n').find(line => line.includes('暂无数据的指标（8）'))!;
  expect(missing).toContain('缓存命中率'); expect(missing).toContain('首 Token 延迟');
  expect(JSON.stringify(r)).toBe(before);
});
it('selects Agent partitions excluding userWait and omits the hint if only user wait remains', () => {
  const r = report(); r.partition = { modelOnly: 1000, toolOnly: 2000, overlap: 0, undivided: 0, delegateWait: 0, userWait: 999999, unattributed: 0 };
  for (const output of [renderTaskHealthMarkdown(r), renderTaskHealthHtml(r)]) expect(output).toContain('最大分区 仅工具 2.0 秒');
  r.partition.modelOnly = 0; r.partition.toolOnly = 0;
  for (const output of [renderTaskHealthMarkdown(r), renderTaskHealthHtml(r)]) { expect(output).not.toContain('最大分区'); expect(output).toContain('等用户'); }
});
it('exports gap local clock endpoints using report t0 and explicitly falls back for older reports', () => {
  const r = report(); r.t0 = new Date(2026, 0, 1, 12, 34, 0).toISOString();
  r.metrics = [{ ...r.metrics[0]!, key: 'ux.max_gap_log', facets: { startMs: '1814401000', endMs: '1814402000' } }];
  for (const output of [renderTaskHealthMarkdown(r), renderTaskHealthHtml(r)]) { expect(output).toContain('开始 01-22 12:34:01 / 结束 01-22 12:34:02'); expect(output).not.toContain('相对任务起点'); }
  delete r.t0;
  for (const output of [renderTaskHealthMarkdown(r), renderTaskHealthHtml(r)]) expect(output).toContain('开始 21.0 天（相对任务起点）');
});
