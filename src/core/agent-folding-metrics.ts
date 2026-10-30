import { benchmarkMetrics, benchmarkStats, correctedUsage, METRIC_LABELS } from './benchmark-analysis.js';
import type { BenchmarkMetric, BenchmarkMetrics } from './benchmark-analysis.js';
import type { BenchmarkRun } from './benchmark-types.js';
export interface FoldingMetricLabels {
  productMode: string | null; environment: string | null; model: string | null; definitionFingerprint: string | null;
  instructionFile: string | null; toolPermissions: string | null; acceptanceSource: string | null; cliVersion: string | null;
  caseId: string | null; host: string | null; qualitySource: string | null; qualityScope: string | null;
  ttftSource: 'proxy' | 'reported' | 'unknown';
}
export interface FoldingMetricRun {
  id: string; taskId: string | null; run: BenchmarkRun; expectedTests: number | null; labels: FoldingMetricLabels;
  architecture: { subAgents: number | null; delegations: number | null; linkedDelegations: number | null; subagentTokens: number | null; mainWaitMs: number | null };
  recorded?: Partial<BenchmarkMetrics> & { cacheCombined?: number | null; reportedTokens?: number | null; reportedCacheHit?: number | null };
  limitations: string[];
}
export const EMPTY_FOLDING_LABELS: FoldingMetricLabels = { productMode: null, environment: null, model: null, definitionFingerprint: null, instructionFile: null, toolPermissions: null, acceptanceSource: null, cliVersion: null, caseId: null, host: null, qualitySource: null, qualityScope: null, ttftSource: 'unknown' };
export const EMPTY_FOLDING_ARCHITECTURE: FoldingMetricRun['architecture'] = { subAgents: null, delegations: null, linkedDelegations: null, subagentTokens: null, mainWaitMs: null };
const derivedLabels = { uncachedInput: '未缓存输入', tokensPerPassed: '每个通过用例的 Token', warningsPerKloc: '每千行静态告警',
  modelShare: '模型 / E2E (%)', toolShare: '工具 / E2E (%)', otherShare: '其余 / E2E (%)', subAgents: '子 Agent 数', delegations: '委派次数',
  subagentShare: '子 Agent Token 占比 (%)', mainWaitMs: '主 Agent 等待 (ms)', linkCompleteness: '关联完整度 (%)' };
export type FoldingMetricKey = BenchmarkMetric | keyof typeof derivedLabels;
export type FoldingMetrics = Record<FoldingMetricKey, number | null>;
const divide = (a: number | null, b: number | null, scale = 1) => a === null || b === null || b <= 0 ? null : a / b * scale;
export function foldingRunMetrics(item: FoldingMetricRun): FoldingMetrics {
  const base = benchmarkMetrics(item.run, item.expectedTests ?? item.run.verdict?.total ?? 1);
  const recorded = item.recorded ?? {};
  for (const key of Object.keys(METRIC_LABELS) as BenchmarkMetric[]) {
    if (key in recorded && !['tokens', 'cacheHit', 'cache', 'cacheRead', 'cacheWrite', 'success', 'passed', 'total', 'passRate'].includes(key)) base[key] = recorded[key] ?? null;
  }
  // Aggregate imports are not a license to assert a corrected token convention.
  const u = item.run.telemetry?.usage;
  if (u && item.run.telemetry?.complete) { const corrected = correctedUsage(u); base.tokens = corrected.total; base.cacheHit = corrected.hit; }
  if (!item.run.verdict) base.success = null;
  if (item.labels.ttftSource === 'unknown') { base.ttft = null; base.tpot = null; }
  const rawInput = u && u.input !== null && u.inputIncludesCache !== null
    ? u.inputIncludesCache ? u.cacheRead !== null && (u.cacheWriteReported === false || u.cacheWrite !== null)
      ? u.input - u.cacheRead - (u.cacheWriteReported === false ? 0 : u.cacheWrite!) : null : u.input : null;
  const canSplit = base.e2e !== null && base.e2e > 0 && base.modelSum !== null && base.toolSum !== null && base.modelSum + base.toolSum <= base.e2e;
  const a = item.architecture;
  return { ...base, uncachedInput: rawInput !== null && rawInput >= 0 ? rawInput : null,
    tokensPerPassed: divide(base.tokens, base.passed), warningsPerKloc: divide(base.staticWarnings, base.loc, 1000),
    modelShare: canSplit ? base.modelSum! / base.e2e! * 100 : null, toolShare: canSplit ? base.toolSum! / base.e2e! * 100 : null,
    otherShare: canSplit ? (base.e2e! - base.modelSum! - base.toolSum!) / base.e2e! * 100 : null,
    subAgents: a.subAgents, delegations: a.delegations, subagentShare: divide(a.subagentTokens, base.tokens, 100), mainWaitMs: a.mainWaitMs,
    linkCompleteness: divide(a.linkedDelegations, a.delegations, 100) };
}
export function foldingSummary(values: Array<number | null>) {
  const stats = benchmarkStats(values), known = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return { n: stats.n, mean: stats.mean, median: stats.median, min: known.length ? Math.min(...known) : null,
    max: known.length ? Math.max(...known) : null, cv: stats.cv, single: stats.n < 2, variable: stats.cv !== null && stats.cv > 30 };
}
const quality = new Set<string>(['loc', 'vulnerabilities', 'duplicationPct', 'complexity', 'redundancy', 'buildWarnings', 'staticWarnings', 'critical', 'major', 'minor', 'suggestion', 'warningsPerKloc']);
const token = new Set<string>(['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'cache', 'tokens', 'cacheHit', 'uncachedInput', 'tokensPerPassed', 'subagentShare']);
const chain = new Set<string>(['subAgents', 'delegations', 'linkCompleteness', 'subagentShare', 'mainWaitMs']);
const qualitySection = new Set<string>(['success', 'passed', 'total', 'passRate', ...quality]);
export interface FoldingMetricThresholds { version: string; durationToleranceMinutes: number; duplicationPct: number; toolAvgSeconds: number }
export const DEFAULT_FOLDING_METRIC_THRESHOLDS: FoldingMetricThresholds = { version: 'architecture-metrics-r4-1', durationToleranceMinutes: .11, duplicationPct: 30, toolAvgSeconds: 3 };
export function foldingDataIssues(item: FoldingMetricRun, thresholds = DEFAULT_FOLDING_METRIC_THRESHOLDS): string[] {
  const r = item.recorded, issues = [...item.limitations];
  if (item.run.telemetry?.usage.cacheWriteReported === false) issues.push('该工具不单独报告缓存写入');
  if (!item.run.verdict?.cases) issues.push('无法判断有没有用例从通过变失败：没有逐用例结果');
  if (!r) return issues;
  issues.push(`汇总诊断阈值版本：${thresholds.version}（启发式，可配置）`);
  if (r.cacheCombined != null) issues.push('缓存读写未分开；原表命中率包含写入，修正命中率未知');
  if (r.reportedTokens != null && r.cacheCombined != null && r.input != null && r.output != null && r.reasoning != null) {
    const input = { input: r.input, output: r.output, reasoning: r.reasoning, cacheRead: r.cacheCombined, cacheWrite: 0, inputIncludesCache: false, outputIncludesReasoning: true };
    const included = correctedUsage(input).total, separate = correctedUsage({ ...input, outputIncludesReasoning: false }).total;
    issues.push(r.reportedTokens === included ? '原表总量使用输入+输出+合并缓存（未加思考）；真实口径仍未知'
      : r.reportedTokens === separate ? '原表总量另加思考；真实口径仍未知' : '原表总量与两种候选公式均不一致');
  }
  for (const [count, avg, sum, label] of [['modelCalls', 'modelAvg', 'modelSum', '模型'], ['toolCalls', 'toolAvg', 'toolSum', '工具']] as const) {
    if (r[count] != null && r[avg] != null && r[sum] != null && Math.abs(r[count]! * r[avg]! / 60 - r[sum]!) > thresholds.durationToleranceMinutes) issues.push(`${label}平均耗时 × 次数与总耗时不一致`);
  }
  if ((r.duplicationPct ?? 0) > thresholds.duplicationPct) issues.push(`函数重复率超过 ${thresholds.duplicationPct}%，疑似异常值（启发式）`);
  if ((r.toolAvg ?? 0) > thresholds.toolAvgSeconds) issues.push(`工具平均耗时超过 ${thresholds.toolAvgSeconds} 秒，疑似异常值（启发式）`);
  return [...new Set(issues)];
}
export function foldingComparison(a: FoldingMetricRun[], b: FoldingMetricRun[]) {
  if (!a.length || !b.length || a.length > 40 || b.length > 40) throw new Error('Comparison requires 1..40 runs per group');
  const all = [...a, ...b], ma = a.map(foldingRunMetrics), mb = b.map(foldingRunMetrics);
  const sameKnown = (values: unknown[]) => values.every(v => v !== null && v !== undefined && v !== 'unknown') && new Set(values.map(v => JSON.stringify(v))).size === 1;
  const fields = ['productMode', 'environment', 'model', 'definitionFingerprint', 'instructionFile', 'toolPermissions', 'acceptanceSource', 'cliVersion'] as const;
  const changes = fields.filter(key => { const aa = new Set(a.map(r => r.labels[key]).filter(x => x !== null)), bb = new Set(b.map(r => r.labels[key]).filter(x => x !== null)); return aa.size > 0 && bb.size > 0 && JSON.stringify([...aa].sort()) !== JSON.stringify([...bb].sort()); });
  const limitations = [...new Set(all.flatMap(r => foldingDataIssues(r)))];
  if (fields.some(k => all.some(r => r.labels[k] === null))) limitations.push('部分配置标识未知，不能确认只改了一处');
  if (!sameKnown(all.map(r => r.labels.caseId))) limitations.push('题目 ID 未知或不同，任务难度可能混杂');
  const keys = [...Object.keys(METRIC_LABELS), ...Object.keys(derivedLabels)] as FoldingMetricKey[];
  const rows = keys.map(key => {
    const sa = foldingSummary(ma.map(m => m[key])), sb = foldingSummary(mb.map(m => m[key]));
    let reason: string | null = null;
    if (token.has(key) && !['inputIncludesCache', 'outputIncludesReasoning', 'cacheWriteReported'].every(k => sameKnown(all.map(r => r.run.telemetry?.usage[k as 'inputIncludesCache'])))) reason = 'Token 口径不同或未知';
    if (['ttft', 'tpot'].includes(key) && !sameKnown(all.map(r => r.labels.ttftSource))) reason = '首 Token 来源不同或未知';
    if (quality.has(key) && (!sameKnown(all.map(r => r.labels.qualitySource)) || !sameKnown(all.map(r => r.labels.qualityScope)))) reason = '扫描器或 LOC 统计范围不同/未知';
    if (sa.median === null || sb.median === null) reason ??= '缺少测量';
    return { key, label: key in METRIC_LABELS ? METRIC_LABELS[key as BenchmarkMetric][0] : derivedLabels[key as keyof typeof derivedLabels],
      section: qualitySection.has(key) ? 'quality' as const : chain.has(key) ? 'chains' as const : token.has(key) ? 'tokens' as const : 'process' as const,
      a: sa, b: sb, comparable: reason === null, reason, delta: reason === null ? sb.median! - sa.median! : null,
      ratio: reason === null && sa.median !== 0 ? sb.median! / sa.median! : null };
  });
  let regressions: string[] | null = null;
  if (all.every(r => r.run.verdict?.cases)) {
    const cases = (runs: FoldingMetricRun[]) => {
      const map = new Map<string, boolean[]>();
      for (const r of runs) for (const c of r.run.verdict!.cases!) { const key = JSON.stringify([r.labels.caseId, c.id]), values = map.get(key) ?? []; values.push(c.passed); map.set(key, values); }
      return map;
    };
    const before = cases(a), after = cases(b);
    regressions = [...before].filter(([id, passes]) => passes.some(Boolean) && (!after.has(id) || after.get(id)!.some(v => !v))).map(([id]) => id);
  }
  return { rows, changes, confounded: changes.length > 1, limitations, regressions };
}
