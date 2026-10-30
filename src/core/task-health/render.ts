import { coverageReason, formatDuration, formatFact, healthLabel, metricText, reconciliationRows, basisMetrics, dimensionMetrics, compactMetricRows, missingMetricsText, dominantAgentPartition } from './format.js';
import type { DeepHealthReport, HealthFinding, HealthMetric, HealthReport } from './types.js';
import { unionDuration } from './intervals.js';
/** Authentication material is never a public evidence excerpt. */
export const redactHealthText = (text: string): string => text
  .replace(/\b(Bearer|Basic)\s+[a-z0-9+/_.=-]+/gi, '$1 [redacted]')
  .replace(/((?:api[_-]?key|authorization|password|secret|access[_-]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
const escapeHtml = (v: unknown) => redactHealthText(String(v ?? '')).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const escapeMd = (v: unknown) => redactHealthText(String(v ?? '')).replace(/\r?\n/g, ' ').replace(/[|*_`<>[\]]/g, '\\$&').replace(/^#/, '\\#');
const dimensions = ['perceived', 'plan', 'act', 'model', 'startup'] as const;
const ranked = (report: HealthReport): HealthFinding[] => [...report.findings].sort((a, b) => unionDuration(b.intervalMs ?? []) - unionDuration(a.intervalMs ?? []) || a.id.localeCompare(b.id));
function findingLines(f: HealthFinding): string[] {
  return [f.recommendation.action, ...Object.entries(f.facts).map(([key, value]) => `事实 ${key}: ${formatFact(key, value)}`), `证据 ${f.evidenceIds.join(', ')}`, `条件 ${f.recommendation.conditions}`, `复测 ${f.recommendation.retest.join(', ')}`];
}
function metricLines(r: HealthReport, metrics: HealthMetric[]): string[] {
  const compact = compactMetricRows(metrics);
  const missing = missingMetricsText(metrics, 'zh', r.t0);
  return [...compact.rows.filter(m => m.value !== null).map(m => metricText(m, 'zh', r.t0) + (m.key.startsWith('ux.') || m.layer === 'log_upper_bound' ? ' · 日志口径' : '')), ...(missing ? [missing] : [])];
}
function dimensionLines(r: HealthReport, d: typeof dimensions[number]): string[] {
  return [healthLabel(r.dimensions[d]), ...ranked(r).filter(f => f.dimension === d).flatMap(findingLines), ...(d === 'perceived' ? ['体验指标见下方“体验（日志代理）”板块。'] : metricLines(r, dimensionMetrics(r, d)))];
}
/** Source strings are plain text, never HTML or source-derived links. */
function sections(r: HealthReport): [string, string[]][] {
  const dominant = dominantAgentPartition(r);
  return [
    ['结论', [...ranked(r).slice(0, 5).map(f => f.recommendation.action), `覆盖：${r.coverage.members.loaded}/${r.coverage.members.total} 成员；${r.coverage.members.loaded < r.coverage.members.total || r.coverage.reasons.length || r.coverage.limits.length ? '数据覆盖不足；' : ''}${r.coverage.reasons.map(x => coverageReason(x)).join(' ') || (r.coverage.members.loaded < r.coverage.members.total ? '部分成员尚未解析' : '无已知覆盖缺口')}；上限：${r.coverage.limits.map(x => coverageReason(x)).join(' ') || '未触达'}`, `质量门：${healthLabel(r.dimensions.quality)}；独立质量验收未知，不推断优化后更快且等质量。`]],
    ['根方程对账', dominant ? [ `阿姆达尔判断：最大分区 ${healthLabel(dominant[0])} ${formatDuration(dominant[1])}；先核对证据，不承诺节省秒数。`] : r.partition ? [] : ['计时覆盖不足，无法判断最大分区。']],
    ['五维诊断', []],
    ['范围与快照', [`任务 ${r.taskId}`, `成员 ${r.scope.member}；时间窗 ${r.scope.from ?? '起点'} → ${r.scope.to ?? '终点'}`, `revision ${r.revision}`, `快照 ${r.snapshotAt}；${r.running ? '运行中，截至快照' : '历史快照'}`, `计时分布 ${Object.entries(r.coverage.timing).map(([key, value]) => `${healthLabel(key)} ${value}`).join(' / ')}`]],
    ['体验（日志代理）', ['日志口径，非界面实测。', ...metricLines(r, r.metrics.filter(m => m.key.startsWith('ux.')))]],
    ['质量门', [`状态 ${healthLabel(r.dimensions.quality)}；验收来源未知；收尾总结未评估。`, ...r.findings.filter(f => f.dimension === 'quality').flatMap(findingLines)]],
    ['建议汇总（感→少→并→快）', dimensions.map(d => `${healthLabel(d)}: ${ranked(r).filter(f => f.dimension === d).map(f => `${f.recommendation.action} 条件：${f.recommendation.conditions}；复测：${f.recommendation.retest.join(', ')}`).join('；') || healthLabel(r.dimensions[d])}`)],
    ['计算依据', [`calcVersion=${r.calcVersion}; ruleVersion=${r.ruleVersion}`, ...Object.entries(r.thresholds).map(([key, value]) => `阈值 ${key}: ${key.endsWith('Ms') ? formatDuration(value as number | null) : value ?? '—'}`), '各指标及有效样本数见对应板块。', ...metricLines(r, basisMetrics(r)), ...r.limitations.map(x => /^[a-z_]+(?::|$)/.test(x) ? coverageReason(x) : x), '单任务诊断，不代表产品整体。']],
    ['证据', r.evidence.map(e => `${e.id}；${e.recordIds.join(', ')}；${e.title.slice(0, 200)}；${(e.summary ?? '').slice(0, 1500)}${e.truncated || (e.summary?.length ?? 0) > 1500 ? ' （截断）' : ''}`)],
  ];
}
export function renderTaskHealthMarkdown(report: HealthReport | DeepHealthReport): string {
  if (!('mode' in report)) return `# 深度健康报告\n\n${deepSections(report).map(([title, lines]) => `## ${escapeMd(title)}\n\n${lines.map(x => `- ${escapeMd(x)}`).join('\n')}`).join('\n\n')}\n`;
  const list = (lines: string[]) => lines.map(line => `- ${escapeMd(line).replace(' （截断）', ' [截断]')}`).join('\n');
  return `# 健康监测\n\n${sections(report).map(([title, lines], i) => {
    const table = i === 1 ? `| 项 | 值 | 层级 |\n| --- | --- | --- |\n${reconciliationRows(report).map(row => `| ${row.map(escapeMd).join(' | ')} |`).join('\n')}\n\n` : '';
    const cards = i === 2 ? dimensions.map(d => `### ${healthLabel(d)}\n\n${list(dimensionLines(report, d))}`).join('\n\n') : '';
    return `## ${escapeMd(title)}\n\n${table}${cards}${list(lines)}`;
  }).join('\n\n')}\n`;
}
export function renderTaskHealthHtml(report: HealthReport | DeepHealthReport): string {
  if (!('mode' in report)) return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>深度健康报告</title><body><h1>深度健康报告</h1>${deepSections(report).map(([title, lines]) => `<section><h2>${escapeHtml(title)}</h2><ul>${lines.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section>`).join('')}</body></html>`;
  const list = (lines: string[]) => `<ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>健康监测</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#17243a}h2{border-bottom:1px solid #cbd5e1}li,td{overflow-wrap:anywhere;margin:.5rem 0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th,.health-card{border:1px solid #cbd5e1;padding:.5rem}.health-card{margin:1rem 0}</style></head><body><h1>健康监测</h1>${sections(report).map(([title, lines], i) => {
    const table = i === 1 ? `<table><thead><tr><th>项</th><th>值</th><th>层级</th></tr></thead><tbody>${reconciliationRows(report).map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    const cards = i === 2 ? dimensions.map(d => `<section class="health-card"><h3>${healthLabel(d)}</h3>${list(dimensionLines(report, d))}</section>`).join('') : '';
    return `<section><h2>${escapeHtml(title)}</h2>${table}${cards}${list(lines)}</section>`;
  }).join('')}</body></html>`;
}

function deepSections(r: DeepHealthReport): [string, string[]][] {
  const items = (rows: object[]) => rows.map(row => Object.entries(row).map(([k,v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('；'));
  return [['最值得验证的原因', items(r.causes)], ['价值时刻判定', items(r.valueMoments)], ['必要性判定', items(r.necessity)], ['优化假设与实验', items(r.experiments)], ['被拒绝 / 未采纳', items(r.rejected)], ['分析记录', [`${r.provider} / ${r.model}; ${r.status}; model_judged`, `promptVersion ${r.promptVersion}; digest ${r.digest}`, `inputTokens ${r.analysis.inputTokens ?? 'unknown'}; outputTokens ${r.analysis.outputTokens ?? 'unknown'}; durationMs ${r.analysis.durationMs}`, ...r.limitations]]];
}
