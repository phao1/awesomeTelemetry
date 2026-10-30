import { QUALITY_KEYS } from './benchmark-types.js';
import type { BenchmarkReport, BenchmarkRun, BenchmarkSpan, BenchmarkUsage } from './benchmark-types.js';

export const METRIC_LABELS = {
  success: ['验收成功率', 'Acceptance success (%)'], passed: ['通过用例', 'Passed tests'], total: ['用例总数', 'Total tests'], passRate: ['用例通过率 (%)', 'Test pass rate (%)'],
  e2e: ['E2E (分钟)', 'E2E (min)'], ttft: ['平均 TTFT (ms)', 'Mean TTFT (ms)'], tpot: ['TPOT (ms)', 'TPOT (ms)'],
  modelCalls: ['模型调用次数', 'Model calls'], modelAvg: ['模型平均耗时 (s)', 'Mean model time (s)'], modelSum: ['模型累计耗时 (分钟)', 'Summed model time (min)'],
  toolCalls: ['工具调用次数', 'Tool calls'], toolAvg: ['工具平均耗时 (s)', 'Mean tool time (s)'], toolSum: ['工具累计耗时 (分钟)', 'Summed tool time (min)'],
  input: ['输入 Token', 'Input tokens'], output: ['输出 Token', 'Output tokens'], reasoning: ['思考 Token', 'Reasoning tokens'],
  cacheRead: ['缓存命中 Token', 'Cache-read tokens'], cacheWrite: ['缓存写入 Token', 'Cache-write tokens'], cache: ['缓存命中 + 写入', 'Cache read + write'],
  tokens: ['修正 Token 总量', 'Corrected tokens'], cacheHit: ['缓存命中率 (%)', 'Cache hit (%)'],
  loc: ['代码规模 (LOC)', 'Lines of code'], vulnerabilities: ['漏洞', 'Vulnerabilities'], duplicationPct: ['函数重复率 (%)', 'Function duplication (%)'],
  complexity: ['平均圈复杂度', 'Mean cyclomatic complexity'], redundancy: ['冗余', 'Redundancy'], buildWarnings: ['编译告警', 'Build warnings'], staticWarnings: ['静态告警', 'Static warnings'],
  critical: ['Critical', 'Critical'], major: ['Major', 'Major'], minor: ['Minor', 'Minor'], suggestion: ['Suggestion', 'Suggestion'],
} as const;
export type BenchmarkMetric = keyof typeof METRIC_LABELS;
export type BenchmarkMetrics = Record<BenchmarkMetric, number | null>;
export function correctedUsage(u: BenchmarkUsage): { total: number | null; hit: number | null } {
  const { input, output, reasoning, cacheRead, inputIncludesCache, outputIncludesReasoning } = u;
  const cacheWrite = u.cacheWriteReported === false ? 0 : u.cacheWrite;
  if (input === null || output === null || (reasoning === null && outputIncludesReasoning !== true) || cacheRead === null || cacheWrite === null || inputIncludesCache === null || outputIncludesReasoning === null) return { total: null, hit: null };
  if ((inputIncludesCache && cacheRead + cacheWrite > input) || (outputIncludesReasoning && reasoning !== null && reasoning > output)) return { total: null, hit: null };
  const allInput = input + (inputIncludesCache ? 0 : cacheRead + cacheWrite);
  const total = allInput + output + (outputIncludesReasoning ? 0 : reasoning!);
  return { total: Number.isSafeInteger(total) ? total : null, hit: allInput > 0 ? cacheRead / allInput * 100 : null };
}
export function runSuccess(run: BenchmarkRun, expectedTests: number): boolean | null {
  if (run.status !== 'completed') return false;
  if (!run.verdict || run.verdict.total !== expectedTests) return null;
  return run.verdict.passed === expectedTests;
}
function sum(a: number[]): number { return a.reduce((n, x) => n + x, 0); }
function measured(spans: BenchmarkSpan[]): boolean { return spans.every(s => s.timing === 'measured' && s.durationMs !== null); }
export function benchmarkMetrics(run: BenchmarkRun, expectedTests: number): BenchmarkMetrics {
  const m = Object.fromEntries(Object.keys(METRIC_LABELS).map(k => [k, null])) as BenchmarkMetrics;
  const success = runSuccess(run, expectedTests);
  m.success = success === null ? null : success ? 100 : 0;
  m.e2e = run.e2eMs === null ? null : run.e2eMs / 60000;
  if (run.verdict) {
    m.passed = run.verdict.passed; m.total = run.verdict.total; m.passRate = m.passed / m.total * 100;
    for (const key of QUALITY_KEYS) m[key] = run.verdict.quality[key];
  }
  const telemetry = run.telemetry;
  if (!telemetry?.complete) return m;
  const u = telemetry.usage, normalized = correctedUsage(u);
  for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'] as const) m[key] = u[key];
  m.cacheWrite = u.cacheWriteReported === false ? 0 : u.cacheWrite;
  m.cache = u.cacheRead !== null && m.cacheWrite !== null ? u.cacheRead + m.cacheWrite : null;
  m.tokens = normalized.total; m.cacheHit = normalized.hit;
  const models = telemetry.spans.filter(s => s.kind === 'model'), tools = telemetry.spans.filter(s => s.kind === 'tool');
  m.modelCalls = models.length; m.toolCalls = tools.length;
  for (const [spans, avg, total] of [[models, 'modelAvg', 'modelSum'], [tools, 'toolAvg', 'toolSum']] as const) {
    if (measured(spans)) { const duration = sum(spans.map(s => s.durationMs!)); m[total] = duration / 60000; m[avg] = spans.length ? duration / spans.length / 1000 : null; }
  }
  if (models.length && measured(models) && models.every(s => s.firstTokenMs !== null)) {
    m.ttft = sum(models.map(s => s.firstTokenMs!)) / models.length;
    if (models.every(s => s.outputTokens !== null && s.outputTokens > 1)) m.tpot = sum(models.map(s => s.durationMs! - s.firstTokenMs!)) / sum(models.map(s => s.outputTokens! - 1));
  }
  return m;
}
export interface BenchmarkStats { n: number; mean: number | null; median: number | null; p95: number | null; sd: number | null; cv: number | null }
export function benchmarkStats(values: Array<number | null>): BenchmarkStats {
  const a = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((x, y) => x - y), n = a.length;
  if (!n) return { n, mean: null, median: null, p95: null, sd: null, cv: null };
  const mean = sum(a) / n, sd = Math.sqrt(sum(a.map(x => (x - mean) ** 2)) / n);
  return { n, mean, median: n % 2 ? a[Math.floor(n / 2)]! : (a[n / 2 - 1]! + a[n / 2]!) / 2, p95: a[Math.ceil(n * .95) - 1]!, sd: n > 1 ? sd : null, cv: n > 1 && mean > 0 ? sd / mean * 100 : null };
}
export function benchmarkGroups(report: BenchmarkReport) {
  return report.manifest.variants.map(variant => {
    const runs = report.runs.filter(r => r.variantId === variant.id), metrics = runs.map(r => benchmarkMetrics(r, report.manifest.task.expectedTests));
    return { variant, runs, metrics: Object.fromEntries(Object.keys(METRIC_LABELS).map(k => [k, benchmarkStats(metrics.map(m => m[k as BenchmarkMetric]))])) as Record<BenchmarkMetric, BenchmarkStats>,
      modelVerified: runs.length > 0 && runs.every(r => r.telemetry?.actualModel === variant.model),
      successes: runs.filter(r => runSuccess(r, report.manifest.task.expectedTests) === true).length,
      known: runs.filter(r => runSuccess(r, report.manifest.task.expectedTests) !== null).length };
  });
}
export const DIAGNOSIS_COPY = {
  failure: ['验收未通过', 'Acceptance did not pass', '先修复失败用例；用同一验收器复跑，再比较速度与 Token。', 'Fix failing tests; rerun the same evaluator before comparing speed and tokens.'],
  unknown: ['验收证据不足', 'Acceptance evidence missing', '检查独立验收报告及固定用例数；不要用助手自述判断成功。', 'Check the independent verdict and fixed test count; do not use assistant claims.'],
  partial: ['采集不完整', 'Incomplete telemetry', '检查驱动结束条件和采集覆盖；补齐后复跑，避免遗漏调用。', 'Check driver completion and capture coverage, then rerun to avoid missing calls.'],
  model: ['实际模型未确认或不一致', 'Actual model unknown or mismatched', '核对 GUI 模型设置与响应模型标识；固定后重复同一任务。', 'Verify GUI model settings against response model identity, then repeat.'],
  errors: ['观察到工具错误', 'Observed tool errors', '从错误泳道检查参数、权限和依赖；修复后观察错误率和验收变化。', 'Inspect parameters, permissions and dependencies at the error spans; rerun and compare errors and acceptance.'],
  slow: ['模型首 Token 偏慢', 'Slow model first token', '阈值 5000ms；检查请求上下文、网络和服务排队。逐项控制变量复测。', 'Threshold 5000ms; inspect context, network and service queues. Change one factor per rerun.'],
  cache: ['缓存命中偏低', 'Low cache hit rate', '阈值 50%；检查前缀稳定性、模型和缓存策略。固定输入复测命中率。', 'Threshold 50%; inspect prefix stability and cache policy. Repeat fixed inputs.'],
  usage: ['Token 口径未对齐', 'Token accounting unresolved', '明确缓存是否包含于输入、思考是否包含于输出；校验原始 usage 再比较。', 'Resolve cache/input and reasoning/output inclusion against native usage before comparison.'],
  quality: ['代码质量需要检查', 'Code quality needs review', '阈值：漏洞 >0、重复率 >10% 或圈复杂度 >10；打开分析器报告，优化后用同一规则复验。', 'Thresholds: vulnerabilities >0, duplication >10%, or complexity >10. Inspect analyzer results and recheck using the same rules.'],
} as const;
export interface BenchmarkFinding { rule: keyof typeof DIAGNOSIS_COPY; spanIds: string[] }
export function diagnoseBenchmarkRun(run: BenchmarkRun, report: BenchmarkReport): BenchmarkFinding[] {
  const out: BenchmarkFinding[] = [], m = benchmarkMetrics(run, report.manifest.task.expectedTests), success = runSuccess(run, report.manifest.task.expectedTests);
  const add = (rule: BenchmarkFinding['rule'], spanIds: string[] = []) => out.push({ rule, spanIds });
  if (success !== true) add(success === false ? 'failure' : 'unknown', run.phases.filter(s => s.name === 'evaluate' || s.status === 'error').map(s => s.id));
  if (!run.telemetry?.complete) add('partial');
  if (run.telemetry?.actualModel !== report.manifest.variants.find(v => v.id === run.variantId)?.model) add('model');
  const errors = run.telemetry?.spans.filter(s => s.kind === 'tool' && s.status === 'error') ?? [];
  if (errors.length) add('errors', errors.map(s => s.id));
  const slow = run.telemetry?.spans.filter(s => s.kind === 'model' && s.timing === 'measured' && s.firstTokenMs !== null && s.firstTokenMs > 5000) ?? [];
  if (slow.length) add('slow', slow.map(s => s.id));
  if (m.cacheHit !== null && m.cacheHit < 50) add('cache');
  if (m.tokens === null) add('usage');
  if ((m.vulnerabilities ?? 0) > 0 || (m.duplicationPct ?? 0) > 10 || (m.complexity ?? 0) > 10) add('quality');
  return out;
}
