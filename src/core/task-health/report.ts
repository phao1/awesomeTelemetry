import type { Dimension, HealthEvidence, HealthFinding, HealthInput, HealthReport, HealthThresholds, Timing } from './types.js';
import type { FindingDraft, RuleContext } from './metrics.js';
import { computeMetrics, evidenceId, metric, scopePartial } from './metrics.js';
import { buildSnapshot, located } from './snapshot.js';
import { intersect, partition, subtract, union, unionDuration } from './intervals.js';
import { validateHealthThresholds } from './thresholds.js';
import { coverageReasons, coverageRules } from './rules/coverage.js';
import { perceivedRules } from './rules/perceived.js';
import { planRules } from './rules/plan.js';
import { actRules } from './rules/act.js';
import { modelRules } from './rules/model.js';
import { startupRules } from './rules/startup.js';
import { qualityRules } from './rules/quality.js';
import { relativeTime } from './snapshot-tracelog.js';
export const HEALTH_CALC_VERSION = 1;
export const HEALTH_RULE_VERSION = 1;
const dimensions: Dimension[] = ['perceived', 'plan', 'act', 'model', 'startup', 'quality', 'coverage'];
/** Bilingual templates consume fact parameters; rule predicates contain no prose. */
const templates: Record<string, [
    string,
    string,
    string[]
]> = {
    'cov.incomplete': ['数据覆盖不足：{reason}；先补数据。 / Incomplete coverage: {reason}; prepare the missing data.', '仅对保留证据作结论。 / Conclusions cover retained evidence only.', ['coverage reasons cleared']],
    'act.long_tool': ['{tool}耗时{duration}；检查类别后尝试预检或后台化。 / {tool} took {duration}; inspect its class and test preflight or background execution.', '配对/实测区间或明确的推导下界；不承诺节省时间。 / Paired/measured interval or derived lower bound; no promised savings.', ['act.long_tool_count', 'overview.e2e_ms']],
    'act.duplicate_install': ['同依赖安装{count}次；核对环境是否重置，再测试依赖复用。 / Dependency installation repeated {count} times; check whether the environment reset, then test reuse.', '没有观察到重置不代表环境持久；先核对目录与命令。 / Absence of reset observations does not prove persistence; check directory and command.', ['act.duplicate_install', 'overview.e2e_ms']],
    'act.cd_prefix_long': ['{count}条长命令带cd前缀；可控制变量测试PATH方案。 / {count} long commands use a cd prefix; test a PATH alternative under controlled conditions.', '先确认命令语义及环境一致。 / First confirm equivalent command semantics and environment.', ['act.long_tool_count', 'act.union_ms', 'overview.e2e_ms']],
    'act.tool_errors': ['{tool}出现{errors}次错误；检查环境、参数和契约。 / {tool} has {errors} errors; inspect environment, arguments and contracts.', '仅计显式错误；必要重试不等于浪费。 / Only explicit errors; necessary retries are not waste.', ['act.tool_errors', 'plan.rounds']],
    'act.small_write_batches': ['单文件写入轮占{pct}%；可测试每轮批量写3–5个无依赖文件。 / Single-file rounds account for {pct}%; test batches of 3–5 independent files.', '先确认文件无依赖并保持验收。 / Check file independence and retain acceptance checks.', ['act.files_per_write_round', 'plan.rounds']],
    'act.serial_independent': ['{count}次不同目标只读调用串行；确认无依赖后测试并行。 / {count} read-only calls to distinct targets are serial; test parallel calls after checking dependencies.', '目标不同仅支持独立性假设，不证明无依赖。 / Distinct targets suggest but do not prove independence.', ['act.parallel_rounds', 'act.union_ms']],
    'plan.many_rounds': ['轮数{N}高于基线；测试规划先行和工具合并。 / {N} rounds exceed the baseline; test earlier planning and combined tools.', '基线必须来自相同任务类别。 / Baseline must represent the same task class.', ['plan.rounds', 'overview.e2e_ms']],
    'plan.explore_heavy': ['首写前耗时占{pct}%；可先给候选文件和路径判断。 / {pct}% elapsed before the first write; test earlier candidate files and path assessment.', '首写是日志代理，探索可能必要。 / First write is a log proxy; exploration may be necessary.', ['ux.first_write_log', 'plan.rounds']],
    'plan.repeated_reads': ['{file}在无写入期间读取{count}次；检查上下文保留。 / {file} was read {count} times without a write; inspect context retention.', '仅排除已观察到的写入，不能断言读取无效。 / Only observed writes are excluded; necessity remains unknown.', ['act.calls']],
    'plan.rework_chain': ['观察到{count}轮返工链；先定位根因，必要测试修复不等于浪费。 / A {count}-round rework chain was observed; diagnose the cause, as necessary test repair is not waste by itself.', '要求同目标的显式失败验证链接。 / Requires explicit failed-verification links to the same target.', ['plan.rounds', 'overview.e2e_ms']],
    'model.slow_first_output': ['{layer}首条输出P50为{delay}；检查输入、缓存和思考策略。 / First-output P50 at {layer} is {delay}; inspect input, caching and reasoning strategy.', '仅限相同层级和计时来源。 / Compare within the same layer and timing source.', ['model.ttft']],
    'model.always_reasoning': ['思考轮占{pct}%；可测试简单推进轮的动态thinking。 / Reasoning rounds account for {pct}%; test dynamic thinking for simple progress rounds.', '思考状态全部已知；固定任务与独立质量门复测。 / All reasoning states are known; retest with fixed task and independent quality gate.', ['model.reasoning_rounds', 'model.round_avg_ms']],
    'model.reasoning_split': ['思考组延迟为无思考组{ratio}倍；以同任务实验验证。 / Reasoning-group delay is {ratio} times the zero-reasoning group; verify with a fixed-task experiment.', '相关性不说明因果；固定质量门。 / Correlation does not establish causality; retain quality gate.', ['model.reasoning_split']],
    'model.low_cache': ['第2轮起缓存命中率{pct}%；检查稳定前缀和压缩策略。 / Cache hit from round 2 is {pct}%; inspect stable prefixes and compression policy.', '仅使用包含关系与计数已知的usage。 / Requires known usage counters and inclusion semantics.', ['model.cache_hit']],
    'perceived.long_gap': ['最大日志空窗{gap}，归因为{cause}；测试阶段进度反馈。 / Maximum log gap is {gap}, attributed to {cause}; test progress updates.', '日志代理不代表界面体验或排队时间。 / Log proxy does not measure UI experience or queue time.', ['ux.max_gap_log']],
    'quality.unverified': ['最后写入后未观察到验证。 / Verification was not observed after the last write.', '仅限所选覆盖范围；验收状态未知。 / Selected coverage only; acceptance remains unknown.', ['ux.first_verified_log', 'independent quality gate']],
    'quality.error_end': ['记录终态为{status}，先核对质量与取消原因。 / Recorded terminal state is {status}; inspect quality and cancellation cause first.', '记录状态不代替独立验收。 / Recorded status does not replace independent acceptance.', ['terminal state', 'independent quality gate']],
};
export function renderFinding(draft: FindingDraft): HealthFinding {
    const [action, conditions, retest] = templates[draft.rule]!;
    const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, key: string) => String(draft.facts[key] ?? 'unknown'));
    return { ...draft, recommendation: { action: fill(action), conditions: fill(conditions), retest: [...retest] } };
}
function states(c: RuleContext, findings: HealthFinding[]): HealthReport['dimensions'] {
    const s = c.snapshot, result = {} as HealthReport['dimensions'];
    const global = s.members.some(m => !m.detailLoaded) && metric(c, 'model.cache_hit')?.value === null;
    const partial = scopePartial(s);
    for (const dimension of dimensions) {
        if (global) {
            result[dimension] = 'insufficient';
            continue;
        }
        if (findings.some(f => f.dimension === dimension)) {
            result[dimension] = partial ? 'insufficient' : 'findings';
            continue;
        }
        if (partial) {
            result[dimension] = 'insufficient';
            continue;
        }
        if (dimension === 'startup') {
            result[dimension] = s.members.length === 1 ? 'not_applicable' : metric(c, 'startup.delegate_latency_ms')?.value == null ? 'insufficient' : 'not_observed';
            continue;
        }
        if (dimension === 'quality') {
            result[dimension] = 'insufficient';
            continue;
        }
        if (dimension === 'coverage') {
            result[dimension] = coverageReasons(c).length ? 'insufficient' : 'not_observed';
            continue;
        }
        if (dimension === 'model') {
            result[dimension] = metric(c, 'model.cache_hit')?.value == null || s.rounds.some(r => r.reasoning === 'unknown') ? 'insufficient' : 'not_observed';
            continue;
        }
        if (dimension === 'act') {
            result[dimension] = !s.tools.length ? 'not_applicable' : s.tools.some(t => t.source.native.command === null && t.targets.length === 0 || !['measured', 'observed'].includes(t.span.timing)) ? 'insufficient' : 'not_observed';
            continue;
        }
        if (dimension === 'plan') {
            result[dimension] = !s.rounds.length || c.thresholds.roundBaseline === null ? 'insufficient' : 'not_observed';
            continue;
        }
        result[dimension] = metric(c, 'ux.max_gap_log')?.value == null ? 'insufficient' : 'not_observed';
    }
    return result;
}
/** No IO, randomness or clock reads. Caller owns report identity and timestamp. */
export function analyzeTaskHealth(input: HealthInput, thresholds: Partial<HealthThresholds> | undefined, meta: {
    id: string;
    generatedAt: string;
}): HealthReport {
    const resolved = validateHealthThresholds(thresholds), s = buildSnapshot(input), metrics = computeMetrics(s, resolved), context: RuleContext = { snapshot: s, metrics, thresholds: resolved };
    const evidence: HealthEvidence[] = s.records.map(r => { const span = s.tools.find(t => t.records.includes(r))?.span ?? s.spans.find(x => x.recordId === r.recordId); const time = relativeTime(input, r.event?.startedAt ?? r.importedTurn?.requestTime ?? null); return { id: evidenceId(r.recordId), memberId: r.memberId, recordIds: [r.recordId], captureIds: input.captures.filter(c => c.recordIds.includes(r.recordId)).map(c => c.id), title: (r.event?.title ?? r.importedTurn?.turnId ?? 'record').slice(0, 200), summary: null, truncated: false, intervalMs: span ? located(span) : time === null ? null : [time, time], timing: span?.timing ?? 'observed' }; });
    const findings = [...coverageRules(context), ...perceivedRules(context), ...planRules(context), ...actRules(context), ...modelRules(context), ...startupRules(context), ...qualityRules(context)].map(renderFinding);
    // Interval union is the only ranking weight. Shared intervals are never summed.
    const order: Record<Dimension, number> = { perceived: 0, plan: 1, act: 2, model: 3, startup: 4, quality: 5, coverage: 6 };
    for (const f of findings)
        if (f.intervalMs)
            f.intervalMs = union(f.intervalMs);
    findings.sort((a, b) => order[a.dimension] - order[b.dimension] || unionDuration(b.intervalMs ?? []) - unionDuration(a.intervalMs ?? []) || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id));
    let credited: [
        number,
        number
    ][] = [];
    const impact = new Map<HealthFinding, number>();
    for (const finding of findings) {
        impact.set(finding, unionDuration(subtract(finding.intervalMs ?? [], credited)));
        credited = union([...credited, ...finding.intervalMs ?? []]);
    }
    findings.sort((a, b) => order[a.dimension] - order[b.dimension] || impact.get(b)! - impact.get(a)! || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id));
    let resultPartition: HealthReport['partition'] = null;
    if (s.bounds && s.members.every(m => m.timestampSemantics !== 'unknown')) {
        const models = s.spans.filter(x => x.kind === 'model').flatMap(x => { const i = located(x); return i ? [i] : []; }), tools = s.tools.filter(t => t.span.kind === 'tool').flatMap(x => { const i = located(x.span); return i ? [i] : []; });
        const overlaps = models.flatMap(m => tools.flatMap(t => { const i = intersect(m, t); return i ? [i] : []; }));
        resultPartition = partition(s.bounds, [{ key: 'userWait', intervals: s.userWait }, { key: 'delegateWait', intervals: s.delegateWait }, { key: 'undivided', intervals: s.undivided }, { key: 'overlap', intervals: overlaps }, { key: 'modelOnly', intervals: models }, { key: 'toolOnly', intervals: tools }], 'unattributed');
    }
    const timing = Object.fromEntries((['measured', 'observed', 'derived', 'reported', 'model_judged', 'unknown', 'unavailable'] as Timing[]).map(t => [t, s.spans.filter(x => x.timing === t).length])) as Record<Timing, number>;
    const report: HealthReport = { version: 1, id: meta.id, taskId: input.taskId, mode: 'standard', scope: { ...input.scope }, revision: input.revision, generatedAt: meta.generatedAt, snapshotAt: input.snapshotAt, running: input.running, thresholds: resolved, calcVersion: HEALTH_CALC_VERSION, ruleVersion: HEALTH_RULE_VERSION, coverage: { members: { loaded: s.members.filter(m => m.detailLoaded).length, total: s.totalMembers }, timing, limits: s.limits, reasons: [...new Set(s.reasons)] }, metrics, partition: resultPartition, rounds: s.rounds, spans: s.spans, dimensions: states(context, findings), findings, evidence, limitations: [...coverageReasons(context), '日志指标是代理；无独立验收来源时质量未知。 / Log metrics are proxies; acceptance is unknown without independent evidence.'] };
    if (new TextEncoder().encode(JSON.stringify(report)).length > 1024 * 1024) {
        report.coverage.limits.push('report_bytes');
        report.limitations.push('Verbose span/evidence projection omitted to meet report budget');
        report.spans = [];
        report.evidence = report.evidence.map(e => ({ ...e, title: '', summary: null, truncated: true }));
        report.dimensions = Object.fromEntries(dimensions.map(d => [d, 'insufficient'])) as HealthReport['dimensions'];
        if (new TextEncoder().encode(JSON.stringify(report)).length > 1024 * 1024)
            throw new RangeError('Health report exceeds 1MiB');
    }
    return report;
}
