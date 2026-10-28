import { benchmarkMetrics, benchmarkStats, METRIC_LABELS, runSuccess } from './benchmark-analysis.js';
import type { BenchmarkMetric, BenchmarkStats } from './benchmark-analysis.js';
import type { TeamExperimentEvent, TeamExperimentMode, TeamExperimentReport, TeamExperimentTrial } from './team-experiment-types.js';

export interface TeamExperimentMessage { code: string; zh: string; en: string; trialIds?: string[]; eventIds?: string[] }
export interface TeamTrialSummary {
  topology: 'single' | 'fan_out' | 'peer_network' | 'unknown';
  agentCount: number | null; peakActiveAgents: number | null; overlapMs: number | null;
  waitMs: number | null; messages: number | null; handoffs: number | null; reworks: number | null;
  contextTokens: number | null; warnings: TeamExperimentMessage[];
}
export interface TeamCaseFlip {
  repetition: number; caseId: string; leftVariantId: string; rightVariantId: string;
  leftStatus: 'passed' | 'failed' | 'unknown'; rightStatus: 'passed' | 'failed' | 'unknown';
  outcome: 'both_passed' | 'left_only' | 'right_only' | 'both_failed' | 'unknown';
}
const message = (code: string, zh: string, en: string): TeamExperimentMessage => ({ code, zh, en });
const workKinds = new Set(['model', 'tool', 'task', 'verification', 'artifact', 'rework']);
function union(intervals: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    const previous = out.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else out.push([start, end]);
  }
  return out;
}
const length = (a: Array<[number, number]>) => a.reduce((n, [s, e]) => n + e - s, 0);
function intervals(events: TeamExperimentEvent[]): Array<[number, number]> { return events.filter(e => e.timing === 'measured' && e.durationMs !== null && e.durationMs > 0).map(e => [e.startMs, e.startMs + e.durationMs!]); }

/** Describes recorded structure; never infers a provider's team implementation or speedup. */
export function summarizeTeamTrial(trial: TeamExperimentTrial): TeamTrialSummary {
  const evidence = trial.evidence, coverage = evidence?.coverage;
  const out: TeamTrialSummary = { topology: 'unknown', agentCount: coverage?.roster ? evidence!.agents.length : null, peakActiveAgents: null, overlapMs: null, waitMs: null, messages: null, handoffs: null, reworks: null, contextTokens: null, warnings: [] };
  if (!evidence) { out.warnings.push(message('no_evidence', '缺少协作证据，不能判断实际结构。', 'Collaboration evidence is missing; observed structure is unknown.')); return out; }
  if (coverage!.roster && evidence.agents.length === 1) out.topology = 'single';
  if (coverage!.roster && coverage!.communication && evidence.agents.length > 1) {
    const roster = new Map(evidence.agents.map(a => [a.id, a]));
    const ancestor = (parent: string, child: string): boolean => {
      let next = roster.get(child)?.parentId; const visited = new Set<string>();
      while (next && !visited.has(next)) { if (next === parent) return true; visited.add(next); next = roster.get(next)?.parentId; }
      return false;
    };
    const directPeer = evidence.events.some(e => e.kind === 'message' && e.targetAgentId !== null && e.targetAgentId !== e.agentId && !ancestor(e.agentId, e.targetAgentId) && !ancestor(e.targetAgentId, e.agentId));
    if (directPeer) out.topology = 'peer_network';
    else if (evidence.agents.filter(a => a.parentId === null).length === 1) out.topology = 'fan_out';
  }
  if (coverage!.communication) {
    out.messages = evidence.events.filter(e => e.kind === 'message').length;
    out.handoffs = evidence.events.filter(e => e.kind === 'handoff').length;
  }
  if (coverage!.activities) {
    out.reworks = evidence.events.filter(e => e.kind === 'rework').length;
    const contexts = evidence.events.filter(e => e.kind === 'context');
    const contextTokens = contexts.reduce((n, e) => n + (e.tokens ?? 0), 0);
    out.contextTokens = contexts.length > 0 && contexts.every(e => e.tokens !== null) && Number.isSafeInteger(contextTokens) ? contextTokens : null;
    const waits = evidence.events.filter(e => e.kind === 'wait');
    if (waits.every(e => e.timing === 'measured' && e.durationMs !== null)) out.waitMs = evidence.agents.reduce((n, a) => n + length(union(intervals(waits.filter(e => e.agentId === a.id)))), 0);
    const work = evidence.events.filter(e => workKinds.has(e.kind));
    if (coverage!.roster && work.every(e => e.timing === 'measured' && e.durationMs !== null)) {
      const edges: Array<[number, number]> = [];
      for (const agent of evidence.agents) for (const [s, e] of union(intervals(work.filter(w => w.agentId === agent.id)))) { edges.push([s, 1], [e, -1]); }
      edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let active = 0, previous = edges[0]?.[0] ?? 0, overlap = 0, peak = 0;
      for (const [time, delta] of edges) { if (active >= 2) overlap += time - previous; active += delta; peak = Math.max(peak, active); previous = time; }
      out.overlapMs = overlap; out.peakActiveAgents = peak;
    }
  }
  if (!coverage!.roster || !coverage!.activities || !coverage!.communication) out.warnings.push(message('partial_evidence', '协作覆盖不完整；缺失值保持未知，不能把空白时段当等待。', 'Collaboration coverage is incomplete; missing intervals are not assumed to be waits.'));
  if (trial.evidenceError) out.warnings.push(message('evidence_error', `证据错误：${trial.evidenceError}`, `Evidence error: ${trial.evidenceError}`));
  return out;
}

function namedAcceptance(trial: TeamExperimentTrial, expectedTests: number): { cases: Map<string, TeamCaseFlip['leftStatus']>; success: boolean | null } {
  const cases = new Map(trial.cases?.map(c => [c.id, c.status]) ?? []);
  const known = trial.cases !== null && cases.size === expectedTests && trial.run.verdict?.total === expectedTests && trial.cases.every(c => c.status !== 'unknown') && trial.cases.filter(c => c.status === 'passed').length === trial.run.verdict.passed;
  return { cases: known ? cases : new Map(), success: known ? runSuccess(trial.run, expectedTests) : null };
}
export function analyzeTeamExperiment(report: TeamExperimentReport) {
  const warnings: TeamExperimentMessage[] = [];
  const acceptance = new Map(report.trials.map(trial => [trial, namedAcceptance(trial, report.plan.task.expectedTests)]));
  const groups = report.plan.variants.map(variant => {
    const trials = report.trials.filter(t => t.variantId === variant.id), metrics = trials.map(t => { const m = benchmarkMetrics(t.run, report.plan.task.expectedTests), accepted = acceptance.get(t)!.success; return { ...m, success: accepted === null ? null : accepted ? 100 : 0 }; });
    return { variant, trials, metrics: Object.fromEntries(Object.keys(METRIC_LABELS).map(k => [k, benchmarkStats(metrics.map(m => m[k as BenchmarkMetric]))])) as Record<BenchmarkMetric, BenchmarkStats>, successes: trials.filter(t => acceptance.get(t)!.success === true).length, known: trials.filter(t => acceptance.get(t)!.success !== null).length, modelVerified: trials.length > 0 && trials.every(t => t.run.telemetry?.actualModel === variant.model) };
  });
  const caseFlips: TeamCaseFlip[] = [];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) for (let repetition = 1; repetition <= report.plan.repetitions; repetition++) {
    const left = groups[i]!, right = groups[j]!;
    for (const caseId of report.plan.task.caseIds) {
      const l = left.trials.find(t => t.repetition === repetition), r = right.trials.find(t => t.repetition === repetition);
      const leftStatus = l ? acceptance.get(l)!.cases.get(caseId) ?? 'unknown' : 'unknown', rightStatus = r ? acceptance.get(r)!.cases.get(caseId) ?? 'unknown' : 'unknown';
      const outcome = leftStatus === 'unknown' || rightStatus === 'unknown' ? 'unknown' : leftStatus === 'passed' ? rightStatus === 'passed' ? 'both_passed' : 'left_only' : rightStatus === 'passed' ? 'right_only' : 'both_failed';
      caseFlips.push({ repetition, caseId, leftVariantId: left.variant.id, rightVariantId: right.variant.id, leftStatus, rightStatus, outcome });
    }
  }
  const baseline = groups.find(g => g.variant.mode === 'single_loop');
  const comparisons = baseline ? groups.filter(g => g !== baseline).map(group => {
    const paired = baseline.trials.flatMap(left => { const right = group.trials.find(t => t.repetition === left.repetition); return right ? [{ left, right }] : []; });
    const ratios = (metric: 'e2e' | 'tokens') => paired.map(({ left, right }) => { const a = benchmarkMetrics(left.run, report.plan.task.expectedTests)[metric], b = benchmarkMetrics(right.run, report.plan.task.expectedTests)[metric]; return a !== null && b !== null && b > 0 ? a / b : null; });
    return { baselineId: baseline.variant.id, variantId: group.variant.id, pairs: paired.length, e2eRatio: benchmarkStats(ratios('e2e')), tokenRatio: benchmarkStats(ratios('tokens')) };
  }) : [];
  if (report.synthetic) warnings.push(message('synthetic', '这是模拟数据；建议仅演示分析方式，不代表真实模型表现。', 'Synthetic data: guidance illustrates the method and does not measure actual models.'));
  if (report.plan.schedule === 'parallel') warnings.push(message('contention', '双方同时运行会争用机器、网络和服务配额；需要顺序复测排除资源干扰。', 'Parallel variants may compete for host, network and service capacity; repeat sequentially to investigate contention.'));
  const changed = ['prompt', 'product', 'model', 'environment', 'parameters', 'toolSet'] as const;
  const differences = changed.filter(key => new Set(report.plan.variants.map(v => v[key])).size > 1);
  if (differences.length) warnings.push(message('configuration', `组合存在差异（${differences.join('、')}）；结论只适用于整个配置，不能归因于 Agent 架构。`, `Configurations differ (${differences.join(', ')}); results compare complete configurations, not architecture alone.`));
  const hosts = new Set(report.trials.map(t => t.run.host));
  if (hosts.size > 1) warnings.push(message('hosts', '观察到不同运行主机；硬件与资源条件尚未确认等价，保留质量与原始指标，暂不形成配置偏好。', 'Observed execution hosts differ. Hardware/resource equivalence is unconfirmed; quality and raw metrics remain visible, but a configuration preference is withheld.'));
  const modeContradictions = groups.flatMap(g => g.trials.filter(t => {
    if (!t.evidence?.coverage.roster) return false;
    const agents = t.evidence.agents;
    return g.variant.mode === 'single_loop' ? agents.length !== 1 : agents.length < 2 || (g.variant.mode === 'subagents' && !agents.some(a => a.parentId !== null));
  }));
  if (modeContradictions.length) warnings.push({ code: 'mode_contradiction', zh: '声明模式与完整成员记录矛盾：单 loop 应只有一个成员，主子 Agent 应有实际父子成员。先核对驱动模式，暂不形成偏好。', en: 'Declared mode conflicts with the complete roster: single loop requires one member, and subagents require an observed parent/child relation. Verify driver mode before preferring a configuration.', trialIds: modeContradictions.map(t => t.id) });
  const qualityKeys = ['vulnerabilities', 'duplicationPct', 'complexity', 'redundancy', 'buildWarnings', 'staticWarnings', 'critical', 'major', 'minor', 'suggestion'] as const;
  const qualityRegressions: Array<{ variantId: string; otherVariantId: string; metric: typeof qualityKeys[number]; trialId: string; value: number; otherValue: number }> = [];
  for (const group of groups) for (const other of groups.filter(g => g !== group)) for (const trial of group.trials) {
    const paired = other.trials.find(t => t.repetition === trial.repetition);
    for (const metric of qualityKeys) {
      const value = trial.run.verdict?.quality[metric], otherValue = paired?.run.verdict?.quality[metric];
      if (value != null && otherValue != null && value > otherValue) qualityRegressions.push({ variantId: group.variant.id, otherVariantId: other.variant.id, metric, trialId: trial.id, value, otherValue });
    }
  }
  if (qualityRegressions.length) warnings.push({ code: 'quality_regression', zh: `观察到代码质量退步（${[...new Set(qualityRegressions.map(r => r.metric))].join('、')}）；不能仅凭通过用例和速度建议有退步的配置，需检查同一分析器结果。`, en: `Observed code-quality regressions (${[...new Set(qualityRegressions.map(r => r.metric))].join(', ')}). Passing tests and speed cannot alone justify a regressing configuration; inspect the same analyzer's results.`, trialIds: [...new Set(qualityRegressions.map(r => r.trialId))] });
  if (report.trials.some(t => !t.run.verdict || qualityKeys.some(key => t.run.verdict!.quality[key] === null))) warnings.push(message('quality_coverage', '部分代码质量分析器未提供结果；空缺不当作零。建议仅覆盖固定验收及已观察指标，不能证明没有漏洞或其他质量问题。', 'Some code-quality analyzers are unavailable; missing values are not zero. Guidance covers fixed acceptance and observed metrics, not the absence of vulnerabilities or other quality issues.'));
  if (!baseline) warnings.push(message('baseline', '缺少单 loop 基线，无法给出单 loop 与多 Agent 的配对建议。', 'A single-loop baseline is required for paired mode guidance.'));
  if (caseFlips.some(c => c.outcome === 'unknown')) warnings.push(message('acceptance_unknown', '部分独立用例缺失或与汇总验收不一致；对应质量结论未知。', 'Some named cases are missing or disagree with aggregate acceptance; those quality comparisons are unknown.'));
  const complete = hosts.size === 1 && modeContradictions.length === 0 && groups.every(g => g.trials.length === report.plan.repetitions && g.trials.length >= 3 && g.known === g.trials.length && g.modelVerified && g.metrics.tokens.n === g.trials.length && g.metrics.e2e.n === g.trials.length && g.trials.every(t => t.run.telemetry?.complete && t.run.e2eMs !== null && t.run.e2eMs > 0 && t.evidence && Object.values(t.evidence.coverage).every(Boolean) && !t.evidenceError));
  if (!complete) warnings.push(message('insufficient', '至少需要每组3次完整运行、独立具名验收、实际模型及 Token 口径确认，才形成配置偏好。', 'A configuration preference requires at least three complete runs per variant, named independent acceptance, confirmed actual models and token accounting.'));
  type Recommendation = { status: 'illustrative' | 'insufficient' | 'preference' | 'tradeoff'; variantId: string | null; mode: TeamExperimentMode | null; zh: string; en: string; reasons: TeamExperimentMessage[] };
  let recommendation: Recommendation = { status: 'insufficient', variantId: null, mode: null, zh: '证据不足，先补齐或复测。', en: 'Insufficient evidence; complete capture or repeat the experiment.', reasons: warnings.filter(w => ['insufficient', 'baseline', 'acceptance_unknown', 'hosts', 'mode_contradiction'].includes(w.code)) };
  if (complete && baseline && new Set(groups.map(g => g.variant.mode)).size > 1) {
    const qualityDominates = (candidateId: string, otherId: string) => {
      const flips = caseFlips.filter(c => (c.leftVariantId === candidateId && c.rightVariantId === otherId) || (c.rightVariantId === candidateId && c.leftVariantId === otherId));
      return { gains: flips.filter(c => c.leftVariantId === candidateId ? c.outcome === 'left_only' : c.outcome === 'right_only').length, losses: flips.filter(c => c.leftVariantId === candidateId ? c.outcome === 'right_only' : c.outcome === 'left_only').length };
    };
    const qualityWinners = groups.filter(g => g.successes === g.trials.length && groups.filter(other => other !== g).every(other => { const d = qualityDominates(g.variant.id, other.variant.id); return d.gains > 0 && d.losses === 0; }));
    const qualityTied = caseFlips.every(c => c.outcome === 'both_passed' || c.outcome === 'both_failed');
    const efficient = qualityTied ? groups.filter(g => g.successes === g.trials.length && groups.filter(other => other !== g).every(other => g.metrics.e2e.median! <= other.metrics.e2e.median! && g.metrics.tokens.median! <= other.metrics.tokens.median! && (g.metrics.e2e.median! < other.metrics.e2e.median! * .95 || g.metrics.tokens.median! < other.metrics.tokens.median! * .95))) : [];
    const winner = [...qualityWinners, ...efficient].find(g => !qualityRegressions.some(r => r.variantId === g.variant.id));
    const reasons: TeamExperimentMessage[] = [message('rule', qualityWinners.length ? '规则：具名验收有增益且没有退步；先保质量，再评估时间与用量代价。' : '规则：验收全部通过，E2E 与 Token 中位数均不增加，至少一项改善超过5%；5%只是界面筛选阈值。', qualityWinners.length ? 'Rule: named acceptance improves without regressions; preserve quality before assessing time/token tradeoffs.' : 'Rule: all cases pass; neither median E2E nor tokens increases, and at least one improves by over 5%. The 5% threshold is a UI heuristic.')];
    if (winner) {
      const sampled = winner.trials[0]!, summary = summarizeTeamTrial(sampled);
      const priority = qualityWinners.length ? ['verification', 'rework', 'message', 'handoff', 'tool', 'context'] : ['wait', 'message', 'tool', 'handoff', 'verification', 'context'];
      const diagnosticEvents = sampled.evidence!.events.filter(e => priority.includes(e.kind)).sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind) || a.startMs - b.startMs);
      reasons.push({ code: 'collaboration', zh: `检查首轮协作证据：结构=${summary.topology}，峰值活动成员=${summary.peakActiveAgents ?? '未知'}，消息=${summary.messages ?? '未知'}，等待累计=${summary.waitMs ?? '未知'}ms。活动重叠仅作诊断；偏好来自配对E2E、用量和验收，不能据此证明原因。`, en: `Inspect the first trial: structure=${summary.topology}, peak active members=${summary.peakActiveAgents ?? 'unknown'}, messages=${summary.messages ?? 'unknown'}, accumulated waits=${summary.waitMs ?? 'unknown'}ms. Overlap is diagnostic only; paired E2E, usage and acceptance drive preference and do not establish cause.`, trialIds: [sampled.id], eventIds: diagnosticEvents.map(e => e.id) });
    }
    recommendation = winner ? { status: report.synthetic ? 'illustrative' : 'preference', variantId: winner.variant.id, mode: winner.variant.mode, zh: `${report.synthetic ? '模拟示例：' : '本任务配置偏好：'}${winner.variant.id}。仍需在相似真实任务中复验。`, en: `${report.synthetic ? 'Illustrative preference: ' : 'Task-scoped configuration preference: '}${winner.variant.id}. Validate on similar real tasks.`, reasons } : { status: report.synthetic ? 'illustrative' : 'tradeoff', variantId: null, mode: null, zh: '质量或效率存在权衡，当前没有同时占优的配置。', en: 'Quality or efficiency trades off; no configuration dominates.', reasons: [message('tradeoff', '逐项检查用例翻转及时间/Token代价，按任务优先级选择并复测。', 'Inspect case flips and time/token tradeoffs; select against task priorities and repeat.')] };
  }
  if (differences.length) recommendation.reasons.push(warnings.find(w => w.code === 'configuration')!);
  if (warnings.some(w => w.code === 'quality_regression')) recommendation.reasons.push(warnings.find(w => w.code === 'quality_regression')!);
  if (warnings.some(w => w.code === 'quality_coverage')) recommendation.reasons.push(warnings.find(w => w.code === 'quality_coverage')!);
  if (report.synthetic) recommendation.reasons.push(warnings.find(w => w.code === 'synthetic')!);
  return { groups, comparisons, caseFlips, qualityRegressions, warnings, recommendation };
}
