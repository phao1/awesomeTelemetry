import type { HealthFinding, HealthReport } from './types.js';
import { unionDuration } from './intervals.js';
/** Authentication material is never a public evidence excerpt. */
export const redactHealthText = (text: string): string => text
  .replace(/\b(Bearer|Basic)\s+[a-z0-9+/_.=-]+/gi, '$1 [redacted]')
  .replace(/((?:api[_-]?key|authorization|password|secret|access[_-]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
const escapeHtml = (v: unknown) => redactHealthText(String(v ?? '')).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const escapeMd = (v: unknown) => escapeHtml(v).replace(/[\\`*_{}[\]()#+.!|~:]/g, '\\$&').replace(/\r?\n/g, ' ');
const ranked = (report: HealthReport): HealthFinding[] => [...report.findings].sort((a, b) => unionDuration(b.intervalMs ?? []) - unionDuration(a.intervalMs ?? []) || a.id.localeCompare(b.id));
/** Plain text sections shared by both offline renderers; no source-derived links. */
function sections(r: HealthReport): [string, string[]][] {
  const show = (n: number | null, unit = '') => n === null ? '未知 / unavailable' : `${n} ${unit}`;
  const metric = (prefix: string) => r.metrics.filter(m => m.key.startsWith(prefix)).map(m => `${m.key} [${m.layer ?? m.timing}; ${JSON.stringify(m.facets)}; ${m.stat}]: ${show(m.value, m.unit)} (n=${m.samples}, ${m.coverage}${m.reason ? ', ' + m.reason : ''})`);
  const status = r.dimensions.quality;
  const partition = r.partition ? Object.entries(r.partition).map(([key, value]) => `${key}: ${value} ms`) : ['时间分区未知 / partition unavailable'];
  const dominant = r.partition ? Object.entries(r.partition).sort((a, b) => b[1] - a[1])[0] : null;
  return [
    ['结论', [...ranked(r).slice(0, 5).map(f => f.recommendation.action), `覆盖：${r.coverage.members.loaded}/${r.coverage.members.total} 成员；${r.coverage.reasons.join(', ') || '无已知覆盖缺口'}；上限：${r.coverage.limits.join(', ') || '未触达'}`, `质量门：${status}；独立质量验收未知，不推断优化后更快且等质量。`]],
    ['范围与快照', [`任务 ${r.taskId}`, `成员 ${r.scope.member}；时间窗 ${r.scope.from ?? '起点'} → ${r.scope.to ?? '终点'}`, `revision ${r.revision}`, `快照 ${r.snapshotAt}；${r.running ? '运行中' : '历史快照'}`, `计时分布 ${JSON.stringify(r.coverage.timing)}`]],
    ['根方程对账', [...metric('overview.e2e_ms'), ...metric('plan.rounds'), ...metric('model.sum_ms'), ...metric('act.sum_ms'), ...metric('act.union_ms'), ...partition, dominant ? `阿姆达尔判断：最大分区 ${dominant[0]} (${dominant[1]} ms)；先核对该区间证据，不承诺节省秒数。` : '阿姆达尔判断：计时覆盖不足，无法判断。']],
    ['体验（日志代理）', ['日志口径，非界面实测。', ...metric('ux.')]],
    ['五维诊断', (['perceived', 'plan', 'act', 'model', 'startup'] as const).flatMap(d => [`${d}: ${r.dimensions[d]}`, ...r.findings.filter(f => f.dimension === d).flatMap(f => [f.recommendation.action, `事实 ${JSON.stringify(f.facts)}`, `证据 ${f.evidenceIds.join(', ')}`, `条件 ${f.recommendation.conditions}`, `复测 ${f.recommendation.retest.join(', ')}`])])],
    ['质量门', [`状态 ${status}；验收来源未知；收尾总结未评估。`, ...r.findings.filter(f => f.dimension === 'quality').map(f => f.recommendation.action)]],
    ['建议汇总（感→少→并→快）', (['perceived', 'plan', 'act', 'model', 'startup'] as const).map(d => `${d}: ${ranked(r).filter(f => f.dimension === d).map(f => `${f.recommendation.action} 条件：${f.recommendation.conditions}；复测：${f.recommendation.retest.join(', ')}`).join('；') || r.dimensions[d]}`)],
    ['计算依据', [`calcVersion=${r.calcVersion}; ruleVersion=${r.ruleVersion}`, `阈值 ${JSON.stringify(r.thresholds)}`, ...r.metrics.map(m => `${m.key} (${m.layer ?? m.timing}, ${m.stat}, ${JSON.stringify(m.facets)}): ${show(m.value, m.unit)}；n=${m.samples}；${m.coverage}`), ...r.limitations]],
    ['证据', r.evidence.map(e => `${e.id}；${e.recordIds.join(', ')}；${e.title.slice(0, 200)}；${(e.summary ?? '').slice(0, 1500)}${e.truncated || (e.summary?.length ?? 0) > 1500 ? ' （截断）' : ''}`)],
  ];
}
export function renderTaskHealthMarkdown(report: HealthReport): string {
  return `# 健康监测\n\n${sections(report).map(([title, lines]) => `## ${escapeMd(title)}\n\n${lines.map(line => `- ${escapeMd(line).replace(' （截断）', ' [截断]')}`).join('\n')}`).join('\n\n')}\n`;
}
export function renderTaskHealthHtml(report: HealthReport): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>健康监测</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#17243a}h2{border-bottom:1px solid #cbd5e1}li{overflow-wrap:anywhere;margin:.5rem 0}</style></head><body><h1>健康监测</h1>${sections(report).map(([title, lines]) => `<section><h2>${escapeHtml(title)}</h2><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul></section>`).join('')}</body></html>`;
}
