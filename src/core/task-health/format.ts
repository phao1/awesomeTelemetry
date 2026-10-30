import type { HealthMetric, HealthReport } from './types.js';
export type HealthLocale = 'zh' | 'en';
const labels: Record<string, [string, string]> = {
  model: ['模型', 'Model'], tool: ['工具', 'Tool'], unattributed: ['未归因', 'Unattributed'], userWait: ['等用户', 'User wait'], delegateWait: ['子 Agent 进行中', 'Delegation wait'], modelOnly: ['仅模型', 'Model only'], toolOnly: ['仅工具', 'Tool only'], overlap: ['模型与工具重叠', 'Model/tool overlap'], undivided: ['模型或工具（不可拆）', 'Undivided model/tool'],
  error: ['错误', 'Error'], cancelled: ['已取消', 'Cancelled'], success: ['成功', 'Success'], fingerprint: ['依赖指纹', 'Dependency fingerprint'], input: ['输入', 'Input'], output: ['输出', 'Output'], cacheRead: ['缓存读取', 'Cache read'], cacheWrite: ['缓存写入', 'Cache write'], reasoning: ['思考', 'Reasoning'], total: ['总计', 'Total'], assistant: ['助手', 'Assistant'], user: ['用户', 'User'], tool_result: ['工具结果', 'Tool result'],
  measured: ['实测', 'Measured'], observed: ['日志观测', 'Observed'], derived: ['推导', 'Derived'], reported: ['上报', 'Reported'], model_judged: ['模型判断', 'Model judged'], unavailable: ['不可用', 'Unavailable'], unknown: ['未知', 'Unknown'],
  findings: ['有发现', 'Findings'], not_observed: ['未发现问题', 'No issue observed'], insufficient: ['数据不足', 'Insufficient data'], not_applicable: ['不适用', 'Not applicable'],
  perceived: ['体验可感知', 'Perceived progress'], plan: ['减少轮次', 'Fewer rounds'], act: ['工具与并行', 'Tools and parallelism'], startup: ['启动与委派', 'Startup and delegation'], quality: ['质量门', 'Quality gate'], coverage: ['数据覆盖', 'Coverage'],
  reads: ['读取次数', 'Read count'], maas: ['MaaS', 'MaaS'], inferhub: ['InferHub', 'InferHub'], kernel: ['Kernel', 'Kernel'],
  active: ['活跃', 'Active'], raw: ['原值', 'Raw'], component: ['口径', 'Basis'], cause: ['归因', 'Cause'], class: ['类别', 'Class'], state: ['状态', 'State'], group: ['分组', 'Group'], layer: ['层级', 'Layer'], present: ['有思考', 'Reasoning present'], zero: ['明确无思考', 'Explicit zero'], percentage: ['占比', 'Percentage'], normalized: ['规范化', 'Normalized'], 'rounds2+': ['第 2 轮起', 'From round 2'],
  sum: ['累计', 'Sum'], value: ['值', 'Value'], mean: ['平均', 'Mean'], max: ['最大', 'Maximum'], p50: ['中位数', 'P50'], p95: ['第 95 百分位', 'P95'], union: ['墙钟并集', 'Wall union'], time: ['耗时', 'Time'], rounds: ['轮数', 'Rounds'], calls: ['调用', 'Calls'], work: ['工作量', 'Work'], tokens: ['Token', 'Tokens'], rate: ['比率', 'Rate'], first_output: ['首条输出', 'First output'], round_duration: ['轮耗时', 'Round duration'], ttft: ['首 Token 延迟', 'TTFT'], log_upper_bound: ['日志延迟上界', 'Log upper bound'], exporter: ['导入上报', 'Exporter'], proxy: ['网络代理', 'Proxy'],
  install: ['安装依赖', 'Install'], build: ['构建', 'Build'], test: ['测试', 'Test'], 'lint/typecheck': ['检查与类型检查', 'Lint/typecheck'], read: ['读取', 'Read'], search: ['搜索', 'Search'], 'write/edit': ['写入与编辑', 'Write/edit'], web: ['网络访问', 'Web'], delegate: ['委派', 'Delegate'], shell: ['命令', 'Shell'], other: ['其他', 'Other'],
};
const metricNames: Record<string, [string, string]> = {
  'overview.e2e_ms': ['任务端到端耗时', 'Task E2E'], 'plan.rounds': ['轮数', 'Rounds'], 'model.sum_ms': ['模型累计耗时 Σ', 'Model cumulative Σ'], 'model.union_ms': ['模型墙钟并集 ∪', 'Model wall union ∪'], 'model.round_avg_ms': ['每轮模型平均耗时', 'Mean model time per round'], 'act.sum_ms': ['工具累计耗时 Σ', 'Tool cumulative Σ'], 'act.union_ms': ['工具墙钟并集 ∪', 'Tool wall union ∪'],
  'model.calls': ['模型调用数', 'Model calls'], 'act.calls': ['工具调用数', 'Tool calls'], 'act.avg_ms': ['工具平均耗时', 'Mean tool time'], 'act.p50_ms': ['工具耗时中位数', 'Median tool time'], 'act.p95_ms': ['工具耗时 P95', 'Tool P95'], 'act.max_ms': ['工具最长耗时', 'Maximum tool time'], 'act.long_tool_count': ['长工具调用数', 'Long tool calls'], 'act.parallel_rounds': ['并行轮数', 'Parallel rounds'], 'act.files_per_write_round': ['每写入轮文件数', 'Files per write round'], 'act.single_file_write_round_rate': ['单文件写入轮占比', 'Single-file round rate'],
  'ux.first_reviewable_log': ['首次可审阅结果', 'First reviewable result'], 'ux.ttfr_log': ['首次回复延迟', 'First reply delay'], 'ux.first_locate_log': ['首次定位', 'First locate'], 'ux.first_write_log': ['首次写入', 'First write'], 'ux.first_verified_log': ['首次通过验证', 'First verification'], 'ux.max_gap_log': ['最大日志空窗', 'Maximum log gap'], 'ux.volume_log': ['信息负担', 'Information volume'], 'ux.ttfmp_judged': ['首个有效信息', 'First meaningful progress'],
  'model.reasoning_rounds': ['思考轮', 'Reasoning rounds'], 'model.ttft': ['首 Token 延迟', 'TTFT'], 'model.tpot': ['每 Token 延迟', 'TPOT'], 'model.reasoning_split': ['思考分组延迟', 'Reasoning group delay'], 'model.cache_hit': ['缓存命中率', 'Cache hit'], 'cost.tokens': ['Token 用量', 'Token usage'], 'act.tool_errors': ['工具错误', 'Tool errors'], 'plan.delegations': ['委派次数', 'Delegations'], 'startup.delegate_latency_ms': ['委派启动延迟', 'Delegation startup delay'], 'plan.main_wait_ms': ['主 Agent 等待', 'Main Agent wait'], 'plan.explore_before_first_write': ['首写前探索', 'Exploration before first write'], 'act.duplicate_install': ['重复依赖安装', 'Repeated installs'], 'model.by_model': ['按模型统计', 'By model'],
};
const reasons: Record<string, [string, string]> = {
  unknown_timestamp_semantics: ['时间戳语义未知，无法拆分时间。', 'Unknown timestamp semantics; partition unavailable.'], fallback_segmentation: ['缺少原生轮次身份，按模型产出段切分。', 'No native turn identity; segmented by model output.'], cross_turn_interval_clipped: ['跨轮次区间已裁剪到轮次边界。', 'Cross-turn interval clipped to turn boundary.'], model_attempts: ['模型请求尝试次数与逻辑调用数不同。', 'Model attempts differ from logical calls.'], public_projection_omitted: ['为满足大小预算，报告省略了部分公开投影。', 'Public projection omitted to meet size budget.'], origin_unconfirmed: ['任务来源尚未确认。', 'Task origin is unconfirmed.'], member_limit: ['任务成员数达到读取上限。', 'Task member limit reached.'], event_limit: ['任务事件数达到读取上限。', 'Task event limit reached.'],
  relationship_conflict: ['成员关系存在冲突，不能确认完整任务范围。', 'Conflicting membership prevents complete scope.'], relationship_unresolved: ['部分成员父子关系尚未解析。', 'Some parent relationships remain unresolved.'], structure_limit: ['原生结构读取达到预算上限。', 'Native structure read limit reached.'], identity_incomplete: ['原生身份投影不完整。', 'Native identity projection is incomplete.'],
  native_line_limit: ['原生日志单行超过读取上限。', 'A native log line exceeds the read limit.'], native_bytes: ['原生日志读取达到字节预算。', 'Native log byte budget reached.'], native_metadata_invalid: ['原生日志元数据无法解析。', 'Native metadata is invalid.'], native_metadata_unavailable: ['原生日志元数据不可读取。', 'Native metadata is unavailable.'], native_detail_not_loaded: ['部分成员明细尚未解析。', 'Some member details are not loaded.'], unparsed_member: ['成员明细尚未解析。', 'Member details are not loaded.'], unknown_token_semantics: ['Token 包含关系未知。', 'Token semantics are unknown.'], no_observed_timing: ['缺少实测或日志观测计时。', 'Measured or observed timing is missing.'], missing_eligible_evidence: ['缺少符合口径的证据。', 'No eligible evidence.'], partial_scope: ['当前范围的数据覆盖不完整。', 'Scope coverage is partial.'], fewer_than_5_samples: ['有效样本少于 5 个，无法给出 P95。', 'Fewer than five samples; P95 unavailable.'], rounds_may_be_omitted: ['成员或事件缺失，轮数可能不完整。', 'Missing members or events may omit rounds.'], usage_counter_reset: ['用量计数发生重置。', 'Usage counters reset.'], missing_origin: ['任务起始时间未知。', 'Task origin is missing.'], invalid_tool_clock: ['工具时间端点无效。', 'Invalid tool clock.'], invalid_turn_clock: ['轮次时间端点无效。', 'Invalid turn clock.'], turn_end_unknown: ['轮次结束时间未知。', 'Turn end is unknown.'], invalid_capture_clock: ['抓包时间端点无效。', 'Invalid capture clock.'], selected_member_total: ['任务成员数大于已选择成员数。', 'Some task members are missing.'], capture_matches: ['抓包关联达到预算上限。', 'Capture match limit reached.'], identity_projection: ['身份投影达到预算上限。', 'Identity projection limit reached.'], members: ['成员数达到预算上限。', 'Member limit reached.'], events: ['事件数达到预算上限。', 'Event limit reached.'], spans: ['时间段数达到预算上限。', 'Span limit reached.'], report_bytes: ['报告达到大小上限。', 'Report size limit reached.'], unreferenced_evidence_omitted: ['为满足报告上限，省略未引用证据。', 'Unreferenced evidence omitted for size.'],
};
export const healthLabel = (key: string, locale: HealthLocale = 'zh'): string => labels[key]?.[locale === 'zh' ? 0 : 1] ?? key;
export const metricName = (key: string, locale: HealthLocale = 'zh'): string => metricNames[key]?.[locale === 'zh' ? 0 : 1] ?? (locale === 'zh' ? '指标' : 'Metric');
export function coverageReason(code: string, locale: HealthLocale = 'zh'): string {
  return code.split(/,\s*/).map(part => { const [key, ...detail] = part.split(':'); return (reasons[key!]?.[locale === 'zh' ? 0 : 1] ?? (locale === 'zh' ? '覆盖受限，请核对来源。' : 'Limited coverage; inspect the source.')) + (detail.length ? ` (${detail.join(':')})` : ''); }).join(' ');
}
export function formatDuration(value: number | null, locale: HealthLocale = 'zh'): string {
  if (value === null) return '—';
  const n = Math.abs(value), zh = locale === 'zh';
  if (n < 1000) return `${Number(value.toFixed(1))} ms`;
  if (n < 60000) return `${(value / 1000).toFixed(1)} ${zh ? '秒' : 's'}`;
  if (n < 3600000) { const seconds = Math.round(value / 1000); return `${Math.floor(seconds / 60)} ${zh ? '分' : 'min'} ${seconds % 60} ${zh ? '秒' : 's'}`; }
  return n < 172800000 ? `${(value / 3600000).toFixed(1)} ${zh ? '小时' : 'h'}` : `${(value / 86400000).toFixed(1)} ${zh ? '天' : 'days'}`;
}
export function metricValue(m: Pick<HealthMetric, 'value' | 'unit' | 'reason'>, locale: HealthLocale = 'zh'): string {
  if (m.value === null) return `— (${coverageReason(m.reason ?? 'missing_eligible_evidence', locale)})`;
  return m.unit === 'ms' ? formatDuration(m.value, locale) : m.unit === 'pct' ? `${m.value.toFixed(1)}%` : m.unit === 'chars' ? `${m.value} ${locale === 'zh' ? '字符' : 'characters'}` : String(m.value);
}
export function formatOffset(offset: number, t0: string | null | undefined, locale: HealthLocale = 'zh'): string {
  const origin = t0 ? Date.parse(t0) : NaN;
  const at = new Date(origin + offset);
  if (!Number.isFinite(at.getTime())) return `${formatDuration(offset, locale)}（${locale === 'zh' ? '相对任务起点' : 'relative to task origin'}）`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
export const formatFacets = (facets: Record<string, string>, locale: HealthLocale = 'zh', t0?: string | null): string => Object.entries(facets).map(([key, value]) => ['startMs', 'endMs'].includes(key) ? `${key === 'startMs' ? (locale === 'zh' ? '开始' : 'Start') : (locale === 'zh' ? '结束' : 'End')} ${formatOffset(Number(value), t0, locale)}` : healthLabel(value, locale)).join(' / ');
export const metricFacets = (m: Pick<HealthMetric, 'key' | 'facets'>, locale: HealthLocale = 'zh', t0?: string | null): string => formatFacets(m.facets, locale, t0) || healthLabel(['ux.ttfr_log', 'ux.first_locate_log', 'ux.first_write_log', 'ux.first_reviewable_log', 'ux.first_verified_log'].includes(m.key) ? 'active' : 'raw', locale);
export const metricText = (m: HealthMetric, locale: HealthLocale = 'zh', t0?: string | null): string => `${metricName(m.key, locale)}（${m.key}） · ${metricFacets(m, locale, t0)} · ${healthLabel(m.stat, locale)}: ${metricValue(m, locale)} · ${healthLabel(m.timing, locale)}${m.layer ? ' / ' + healthLabel(m.layer, locale) : ''} · n=${m.samples}`;

/** Presentation partitions reference original metrics; no calculation or mutation. */
export const ROOT_METRIC_KEYS = ['overview.e2e_ms', 'plan.rounds', 'model.sum_ms', 'model.union_ms', 'model.round_avg_ms', 'act.sum_ms', 'act.union_ms'];
export function dominantAgentPartition(r: HealthReport): [string, number] | null {
  return r.partition ? Object.entries(r.partition).filter(([key, value]) => key !== 'userWait' && value > 0).sort((a, b) => b[1] - a[1])[0] ?? null : null;
}
export function dimensionMetrics(r: HealthReport, dimension: string): HealthMetric[] {
  return dimension === 'perceived' ? [] : r.metrics.filter(m => m.key.startsWith(dimension + '.') && !ROOT_METRIC_KEYS.includes(m.key));
}
export function basisMetrics(r: HealthReport): HealthMetric[] {
  return r.metrics.filter(m => !ROOT_METRIC_KEYS.includes(m.key) && !['ux.', 'plan.', 'act.', 'model.', 'startup.'].some(prefix => m.key.startsWith(prefix)));
}
export interface EmptyHealthLayers { key: string; layers: string[]; reasons: string[] }
export function compactMetricRows(metrics: HealthMetric[]): { rows: HealthMetric[]; emptyLayers: EmptyHealthLayers[] } {
  const keys = ['model.ttft', 'model.tpot', 'model.reasoning_split'];
  const emptyLayers: EmptyHealthLayers[] = [];
  const omitted = new Set<HealthMetric>();
  for (const key of keys) {
    const matching = metrics.filter(m => m.key === key && m.layer !== null);
    const empty: EmptyHealthLayers = { key, layers: [], reasons: [] };
    for (const layer of new Set(matching.map(m => m.layer!))) {
      const group = matching.filter(m => m.layer === layer);
      if (group.some(m => m.samples > 0)) continue;
      empty.layers.push(layer);
      for (const m of group) { omitted.add(m); empty.reasons.push(m.reason ?? 'missing_eligible_evidence'); }
    }
    if (empty.layers.length) emptyLayers.push({ ...empty, reasons: [...new Set(empty.reasons)] });
  }
  return { rows: metrics.filter(m => !omitted.has(m)), emptyLayers };
}
export function emptyLayersText(group: EmptyHealthLayers, locale: HealthLocale = 'zh'): string {
  return `${metricName(group.key, locale)}：${group.layers.map(layer => healthLabel(layer, locale)).join(locale === 'zh' ? '、' : ', ')} ${locale === 'zh' ? '暂无样本' : 'have no samples'}（${group.reasons.map(reason => coverageReason(reason, locale)).join(' ')}）`;
}
export function missingMetricsText(metrics: HealthMetric[], locale: HealthLocale = 'zh', t0?: string | null): string | null {
  const missing = metrics.filter(m => m.value === null);
  if (!missing.length) return null;
  const compact = compactMetricRows(metrics);
  return `${locale === 'zh' ? '暂无数据的指标' : 'Metrics without data'}（${missing.length}）: ${[...compact.rows.filter(m => m.value === null).map(m => metricText(m, locale, t0)), ...compact.emptyLayers.map(group => emptyLayersText(group, locale))].join('；')}`;
}
export const formatCause = (value: string, locale: HealthLocale = 'zh'): string => ['model', 'tool', 'unattributed', 'userWait', 'delegateWait'].includes(value) ? healthLabel(value, locale) : `${healthLabel('tool', locale)} (${healthLabel(value, locale)})`;
export function formatFact(key: string, value: number | string | null, locale: HealthLocale = 'zh'): string {
  if (value === null) return '—';
  if (key === 'reason') return coverageReason(String(value), locale);
  if (key === 'cause') return formatCause(String(value), locale);
  if (key === 'duration' && value === '≥300s（推导值封顶）' && locale === 'en') return '≥300s (derived duration capped)';
  if (typeof value === 'number') return ['gap', 'delay', 'durationMs'].includes(key) ? formatDuration(value, locale) : key === 'pct' ? value.toFixed(1) : String(value);
  if (key === 'duration' && /^\d+(\.\d+)?s$/.test(value)) return formatDuration(parseFloat(value) * 1000, locale);
  return healthLabel(value, locale);
}
export function reconciliationRows(r: HealthReport, locale: HealthLocale = 'zh'): [string, string, string][] {
  const rows = r.metrics.filter(m => ROOT_METRIC_KEYS.includes(m.key)).map(m => [`${metricName(m.key, locale)} · ${metricFacets(m, locale)}`, metricValue(m, locale), `${healthLabel(m.timing, locale)} · n=${m.samples}`] as [string, string, string]);
  for (const key of ['model.sum_ms', 'model.union_ms', 'act.sum_ms', 'act.union_ms']) if (!r.metrics.some(m => m.key === key)) rows.push([metricName(key, locale), `— (${coverageReason('missing_eligible_evidence', locale)})`, healthLabel('unavailable', locale)]);
  for (const key of ['modelOnly', 'toolOnly', 'overlap', 'undivided', 'delegateWait', 'userWait', 'unattributed'] as const) rows.push([healthLabel(key, locale), r.partition ? formatDuration(r.partition[key], locale) : `— (${coverageReason('unknown_timestamp_semantics', locale)})`, r.partition ? healthLabel('derived', locale) : healthLabel('unavailable', locale)]);
  return rows;
}
