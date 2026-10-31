import { buildComparisonShell } from './compare-report.js';
import { foldingComparison, foldingRunMetrics } from './agent-folding-metrics.js';
import type { FoldingMetricRun } from './agent-folding-metrics.js';
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const md = (s: string) => s.replace(/[\r\n]/g, ' ').replace(/[\\`*_[\]<>|#]/g, '\\$&');
const csv = (s: string) => '"' + (/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
const n = (v: number | null) => v === null ? '未知' : Number.isInteger(v) ? String(v) : v.toFixed(3);
export function buildFoldingComparisonReport(a: FoldingMetricRun[], b: FoldingMetricRun[], format: 'html' | 'markdown' | 'csv'): string {
  const report = foldingComparison(a, b), sections: Array<{ title: string; headers: string[]; rows: string[][] }> = [];
  const summary = (v: typeof report.rows[number]['a']) => `${n(v.median)} (n=${v.n}; 均值 ${n(v.mean)}; ${n(v.min)}–${n(v.max)}; CV ${n(v.cv)}%${v.single ? '; 单样本' : ''}${v.variable ? '; 组内波动大' : ''})`;
  const metricRows = (section: typeof report.rows[number]['section']) => report.rows.filter(r => r.section === section).map(r => [r.label, summary(r.a), summary(r.b), r.comparable ? n(r.delta) : '不可比', r.comparable ? n(r.ratio) : '不可比', r.reason ?? '']);
  const headers = ['指标', 'A 中位数 / 组内', 'B 中位数 / 组内', 'B − A', 'B / A', '说明'];
  sections.push({ title: '1 · 质量', headers, rows: metricRows('quality') });
  sections.push({ title: '2 · 职责去向', headers: ['状态'], rows: [['未知：指标汇总不证明职责已被替代；请检查边界证据及独立验证。']] });
  sections.push({ title: '3 · 调用链', headers, rows: [...metricRows('chains'), ['评测覆盖的生产链', '未知', '未知', '不可比', '不可比', '需导入覆盖该生产范围的基线评测；关联完整度不等于调用链覆盖']] });
  sections.push({ title: '4 · 过程与时延', headers, rows: metricRows('process') });
  sections.push({ title: '5 · Token 与开销', headers, rows: metricRows('tokens') });
  const keys = Object.keys(foldingRunMetrics(a[0]!)) as Array<keyof ReturnType<typeof foldingRunMetrics>>;
  sections.push({ title: '6 · 逐次明细', headers: ['组', '运行', '产品模式', '环境', '模型', '执行机', '原表合并缓存', '原表总量（口径未核实）', '原表命中率（含写入）', ...keys], rows: [...a.map(r => ['A', r] as const), ...b.map(r => ['B', r] as const)].map(([g, r]) => [g, r.id, r.labels.productMode ?? '未知', r.labels.environment ?? '未知', r.labels.model ?? '未知', r.labels.host ?? '未知', n(r.recorded?.cacheCombined ?? null), n(r.recorded?.reportedTokens ?? null), n(r.recorded?.reportedCacheHit ?? null), ...keys.map(k => n(foldingRunMetrics(r)[k]))]) });
  const title = 'Agent 架构对比报告';
  const conclusion = report.confounded ? `有混杂：${report.changes.join('、')}` : '描述性对比；不能据此证明单一改动的因果收益';
  const notes = [conclusion, report.regressions === null ? '无法判断有没有用例从通过变失败' : `逐用例回归：${report.regressions.join('、') || '未观察到'}`, ...report.limitations, '未设置单价，不显示费用。'];
  let result: string;
  if (format === 'html') result = buildComparisonShell(title, `<h1>${html(title)}</h1>${notes.map(x => `<p>${html(x)}</p>`).join('')}${sections.map(s => `<h2>${html(s.title)}</h2><table><thead><tr>${s.headers.map(h => `<th>${html(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map(c => `<td>${html(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}`);
  else if (format === 'markdown') result = `# ${title}\n\n${notes.map(x => md(x)).join('\n\n')}\n\n` + sections.map(s => `## ${s.title}\n\n| ${s.headers.map(md).join(' | ')} |\n| ${s.headers.map(() => '---').join(' | ')} |\n${s.rows.map(r => `| ${r.map(md).join(' | ')} |`).join('\n')}`).join('\n\n');
  else result = [[title], ...notes.map(x => [x]), ...sections.flatMap(s => [[s.title], s.headers, ...s.rows])].map(row => row.map(csv).join(',')).join('\r\n');
  if (new TextEncoder().encode(result).length > 8 * 1024 * 1024) throw new Error('Report exceeds 8MiB');
  return result;
}
