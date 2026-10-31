import type { TaskComparisonSnapshot, TaskSummary } from './task-types.js';
import type { FoldingMetricRun } from './agent-folding-metrics.js';
import { foldingComparison, foldingSummary } from './agent-folding-metrics.js';
import type { HealthFinding, HealthReport } from './task-health/types.js';
type Locale = 'zh' | 'en';
const healthProse = (value:string,locale:Locale) => {const parts=value.split(' / ');return parts.length===2?parts[locale==='zh'?0:1]!:value;};

export type ComparisonVerdict = 'better' | 'worse' | 'equal' | 'unavailable';
export interface ComparisonRow {
  key: string; label: string; unit: string;
  a: ReturnType<typeof foldingSummary>; b: ReturnType<typeof foldingSummary>;
  verdict: ComparisonVerdict; reason: string | null; delta: number | null; ratio: number | null;
}
export const comparisonText = (locale: Locale, zh: string, en: string) => locale === 'zh' ? zh : en;
export const verdictLabel = (verdict: ComparisonVerdict, locale: Locale) => (locale === 'zh'
  ? { better: '变好', worse: '变坏', equal: '持平', unavailable: '不可比' }
  : { better: 'Better', worse: 'Worse', equal: 'Unchanged', unavailable: 'Not comparable' })[verdict];
export const comparisonNumber = (v: number | null) => v === null ? '—' : Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumSignificantDigits: 6 });
/** Shared presentation for conclusion cards, metric cells and offline exports. */
export function formatComparisonValue(value:number|null,unit:string,locale:Locale,signed=false):string{
  if(value===null||!Number.isFinite(value))return '—';
  const sign=signed&&value>0?'+':value<0?'−':'';
  const abs=Math.abs(value),number=(n:number,fixed=false)=>n.toLocaleString('en-US',{minimumFractionDigits:fixed?1:0,maximumFractionDigits:1});
  if(unit==='ms'){
    const [scale,label]:[number,string]=abs>=86400000?[86400000,locale==='zh'?'天':'days']:abs>=3600000?[3600000,'h']:abs>=60000?[60000,'min']:abs>=1000?[1000,'s']:[1,'ms'];
    return `${sign}${number(abs/scale)} ${label}`;
  }
  if(unit==='%')return `${sign}${number(abs,true)}${signed?(locale==='zh'?' 个百分点':' pp'):'%'}`;
  return sign+(unit==='USD'||unit==='CNY'?comparisonNumber(abs)+' '+unit:number(abs));
}
export function formatComparisonRatio(value:number|null):string{
  if(value===null||!Number.isFinite(value))return '—';
  if(value>0&&value<0.005)return '<0.01×';
  return value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'×';
}
export function exactComparisonValue(value:number|null,unit=''):string{return value===null?'—':`${value}${unit?' '+unit:''}`;}
export function comparisonRow(key: string, label: string, unit: string, a: Array<number | null>, b: Array<number | null>, reason: string | null = null): ComparisonRow {
  const sa = foldingSummary(a), sb = foldingSummary(b);
  reason ??= sa.n !== a.length || sb.n !== b.length || !sa.n || !sb.n ? 'missing' : null;
  const delta = reason === null ? sb.median! - sa.median! : null;
  return { key, label, unit, a: sa, b: sb, reason, delta, ratio: reason === null && sa.median !== 0 ? sb.median! / sa.median! : null,
    verdict: delta === null ? 'unavailable' : delta < 0 ? 'better' : delta > 0 ? 'worse' : 'equal' };
}
export function comparisonReason(reason: string | null, locale: Locale): string {
  const t = (zh: string, en: string) => comparisonText(locale, zh, en);
  if (!reason) return '';
  if (reason === 'missing') return t('缺少可靠测量或覆盖不完整', 'Missing reliable measurements or incomplete coverage');
  if (reason === 'cost') return t('币种、费用来源不同或费用覆盖不完整', 'Currency, cost source or coverage differs');
  if (reason === 'health') return t('请读取两侧同口径、完整的标准健康报告', 'Read complete standard health reports with matching conventions');
  if (reason === 'Token 口径不同或未知') return t(reason, 'Token accounting differs or is unknown');
  return locale === 'zh' ? reason : 'Missing or incompatible measurement conventions';
}
export function taskComparisonRows(snapshot: TaskComparisonSnapshot, runs: { a: FoldingMetricRun[]; b: FoldingMetricRun[] } | null, reports: { a: HealthReport[]; b: HealthReport[] } | null, locale: Locale): ComparisonRow[] {
  const t = (zh: string, en: string) => comparisonText(locale, zh, en);
  const fold = runs ? foldingComparison(runs.a, runs.b) : null;
  const row = (key: string, label: string, unit: string, value: (task: TaskSummary) => number | null, reason: string | null = null) => comparisonRow(key, label, unit, snapshot.a.map(value), snapshot.b.map(value), reason);
  const tokenReason = fold?.rows.find(r => r.key === 'tokens')?.reason ?? (fold ? null : 'Token 口径不同或未知');
  const rows = [
    row('duration', t('时长', 'Duration'), 'ms', task => task.metrics?.durationMs ?? null),
    row('tokens', 'Token', '', task => { const m = task.metrics, c = m?.coverage?.correctedTotal; return c && c.known === c.total ? m?.correctedTotal ?? null : null; }, tokenReason),
    row('errors', t('错误数', 'Errors'), '', task => task.metrics?.errors ?? null),
    row('toolFailure', t('工具失败率', 'Tool failure rate'), '%', task => { const m = task.metrics; return m?.toolResults && m.toolFailures != null ? 100 * m.toolFailures / m.toolResults : null; }),
    row('toolCalls', t('工具调用数', 'Tool calls'), '', task => task.metrics?.toolCalls ?? null),
  ];
  for (const currency of ['USD', 'CNY']) {
    const amounts = [...snapshot.a, ...snapshot.b].map(task => task.metrics?.costs);
    const sources = amounts.map(c => c?.amounts.find(a => a.currency === currency)?.source);
    const valid = amounts.every(c => c && c.known === c.total && c.total > 0 && c.amounts.some(a=>a.currency===currency)) && new Set(sources).size === 1 && !sources.includes('mixed');
    rows.push(row('cost' + currency, t('费用', 'Cost') + ' ' + currency, currency, task => task.metrics?.costs?.amounts.find(a => a.currency === currency)?.amount ?? null, valid ? null : 'cost'));
  }
  for (const key of ['subAgents', 'delegations'] as const) {
    const f = fold?.rows.find(r => r.key === key);
    rows.push(comparisonRow(key, key === 'subAgents' ? t('子 Agent 数', 'Sub-agents') : t('委派数', 'Delegations'), '', runs?.a.map(r => r.architecture[key]) ?? snapshot.a.map(() => null), runs?.b.map(r => r.architecture[key]) ?? snapshot.b.map(() => null), f?.reason ?? null));
  }
  const healthValid = reports && reports.a.length === snapshot.a.length && reports.b.length === snapshot.b.length && compatibleHealth([...reports.a, ...reports.b]);
  rows.push(comparisonRow('health', t('健康问题数', 'Health findings'), '', reports?.a.map(r => r.findings.length) ?? snapshot.a.map(() => null), reports?.b.map(r => r.findings.length) ?? snapshot.b.map(() => null), healthValid ? null : 'health'));
  return rows;
}
export function compatibleHealth(reports: HealthReport[]): boolean {
  return reports.length > 0 && reports.every(r => !r.running && r.scope.member === 'all' && r.scope.from === null && r.scope.to === null && r.coverage.members.loaded === r.coverage.members.total && !r.coverage.limits.length && !r.coverage.reasons.length)
    && new Set(reports.map(r => JSON.stringify([r.calcVersion, r.ruleVersion, Object.entries(r.thresholds).sort()]))).size === 1;
}
export interface HealthOccurrence { report: HealthReport; finding: HealthFinding }
export interface HealthDifference { key: string; rule: string; status: 'new' | 'resolved' | 'persisting' | 'uncertain'; a: HealthOccurrence[]; b: HealthOccurrence[] }
/** TC-004: rule is stable; finding.id/evidence.id are report-local and never match keys.
 * Normalize opaque member/record IDs to first-seen ordinals in the saved evidence
 * sequence. Do not compare prose, timestamps, raw bodies or task/session IDs.
 * This is positional matching, not proof of semantic equivalence. Missing record
 * positions stay unique to a report; incomplete evidence cannot certify absence. */
function normalizedLocations(report:HealthReport){
  const members=new Map<string,{index:number;records:Map<string,number>}>(),evidence=new Map(report.evidence.map(e=>[e.id,e]));
  for(const e of report.evidence){
    let member=members.get(e.memberId);
    if(!member){member={index:members.size,records:new Map()};members.set(e.memberId,member);}
    for(const record of e.recordIds)if(!member.records.has(record))member.records.set(record,member.records.size);
  }
  return (finding:HealthFinding)=>{
    const locations=finding.evidenceIds.flatMap(id=>{
      const e=evidence.get(id);if(!e)return [];
      const member=members.get(e.memberId)!;
      return e.recordIds.map(record=>`${member.index}:${member.records.get(record)}`);
    });
    const complete=finding.evidenceIds.length>0&&finding.evidenceIds.every(id=>Boolean(evidence.get(id)?.recordIds.length));
    return JSON.stringify([finding.rule,complete?[...new Set(locations)].sort():['unlocated',report.id,finding.id]]);
  };
}
export function findingLocation(report:HealthReport,finding:HealthFinding):string{return normalizedLocations(report)(finding);}
export function healthDifferences(a: HealthReport[], b: HealthReport[]): HealthDifference[] {
  const map = new Map<string, HealthDifference>(), reliable = compatibleHealth([...a, ...b]);
  for (const [side, reports] of [['a', a], ['b', b]] as const) for (const report of reports) { const position=normalizedLocations(report);for (const finding of report.findings) {
    const key = position(finding), item = map.get(key) ?? { key, rule: finding.rule, status: 'uncertain', a: [], b: [] };
    item[side].push({ report, finding }); map.set(key, item);
  }}
  return [...map.values()].map(item => {
    const located=[...item.a,...item.b].every(o=>o.finding.evidenceIds.length>0&&o.finding.evidenceIds.every(id=>o.report.evidence.some(e=>e.id===id&&e.recordIds.length>0)));
    const dimension=[...item.a,...item.b][0]!.finding.dimension;
    const absenceCovered=[...a,...b].every(r=>r.dimensions[dimension]!=='insufficient'&&r.dimensions[dimension]!=='not_applicable');
    return {...item,status:item.a.length&&item.b.length?'persisting' as const:!reliable||!located||!absenceCovered?'uncertain' as const:item.a.length?'resolved' as const:'new' as const};
  });
}
export function healthRuleCounts(reports: HealthReport[], rule: string) {
  const tasks = new Set(reports.filter(r => r.findings.some(f => f.rule === rule)).map(r => r.taskId));
  return { count: tasks.size, total: reports.length, ratio: reports.length ? tasks.size / reports.length : null };
}
export function comparisonConfounded(snapshot: TaskComparisonSnapshot, runs: { a: FoldingMetricRun[]; b: FoldingMetricRun[] } | null) {
  return new Set([...snapshot.a, ...snapshot.b].map(t => t.provider)).size > 1 || Boolean(runs && foldingComparison(runs.a, runs.b).confounded);
}
export function comparisonLimitations(locale: Locale, single: boolean, confounded: boolean): string[] {
  const t = (zh: string, en: string) => comparisonText(locale, zh, en);
  return [t('描述性对比；更少的工具、Agent、Token 或费用不证明质量改善或因果收益。', 'Descriptive comparison; fewer tools, agents, tokens or lower costs do not prove quality or causal benefits.'),
    t('任务难度与未知配置可能混杂；时长是任务墙钟，不是模型推理时间。', 'Task difficulty and unknown configuration may confound results; duration is task wall clock, not model inference.'),
    t('健康匹配按规则与证据序位，不证明语义等价；证据不足不能判定问题消失。', 'Health matching uses rule and evidence position, not semantic equivalence; insufficient evidence cannot prove resolution.'),
    ...(single ? [t('单样本，不能证明因果', 'Single sample; cannot prove causality')] : []),
    ...(confounded ? [t('混杂：跨工具/provider 或多个配置变化', 'Confounded: different tools/providers or multiple configuration changes')] : [])];
}
const escaped = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const md = (s: string) => s.replace(/[\\`*_{}[\]()#+!|<>]/g, '\\$&').replace(/[\r\n]/g, ' ');
export function exportTaskComparison(rows: ComparisonRow[], differences: HealthDifference[] | null, limitations: string[], locale: Locale, format: 'md' | 'html', url: string, snapshot?: TaskComparisonSnapshot): string {
  const t = (zh: string, en: string) => comparisonText(locale, zh, en);
  const heading = t('优化前后对比', 'Before / after comparison');
  const status = { new: t('新出现', 'New'), resolved: t('已消失', 'Resolved'), persisting: t('仍存在', 'Persisting'), uncertain: t('证据不足', 'Insufficient evidence') };
  const lines = [heading, url, ...(snapshot ? [t('基线', 'Baseline') + ': ' + snapshot.a.map(t => t.title + ' (' + t.id + ')').join(', '), t('改进', 'Improvement') + ': ' + snapshot.b.map(t => t.title + ' (' + t.id + ')').join(', ')] : []), t('结论与指标（中位数）', 'Conclusions and metrics (median)'), ...rows.map(r => `${r.label}: A ${formatComparisonValue(r.a.median,r.unit,locale)} / B ${formatComparisonValue(r.b.median,r.unit,locale)}; ${verdictLabel(r.verdict, locale)}; B − A ${formatComparisonValue(r.delta,r.unit,locale,true)}; B/A ${formatComparisonRatio(r.ratio)}; ${comparisonReason(r.reason, locale)}; n=${r.a.n}/${r.b.n}`), t('健康差异', 'Health differences'), ...(differences ? differences.map(d => `${d.rule}: ${status[d.status]}; A ${new Set(d.a.map(o => o.report.taskId)).size} / B ${new Set(d.b.map(o => o.report.taskId)).size}; ` + [...d.a, ...d.b].map(o => `${o.report.taskId}: ${healthProse(o.finding.recommendation.action, locale)}`).join('; ')) : [t('尚未读取标准报告', 'Standard reports not read')]), t('限制', 'Limitations'), ...limitations];
  if (differences && snapshot) for (const rule of new Set(differences.map(d => d.rule))) lines.push(`${rule}: A ${healthRuleCounts(differences.flatMap(d => d.a.map(o => o.report)).filter((r, i, all) => all.findIndex(x => x.taskId === r.taskId) === i), rule).count}/${snapshot.a.length}; B ${new Set(differences.filter(d => d.rule === rule).flatMap(d => d.b.map(o => o.report.taskId))).size}/${snapshot.b.length}`);
  lines.push(t('原始精确值', 'Exact raw values'),...rows.map(r=>`${r.label}: A ${exactComparisonValue(r.a.median,r.unit)} / B ${exactComparisonValue(r.b.median,r.unit)}; B − A ${exactComparisonValue(r.delta,r.unit)}; B/A ${exactComparisonValue(r.ratio)}`));
  return format === 'html' ? `<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${escaped(heading)}</title><body>${lines.map(line => `<p>${escaped(line)}</p>`).join('')}</body></html>` : lines.map((line, i) => i === 0 ? '# ' + md(line) : md(line)).join('\n\n');
}
