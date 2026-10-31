import type { TraceRecord } from './trace-types.js';
import { computeMetrics } from './metrics.js';
import { computeSpeedMetrics } from './speed-metrics.js';
import { computeTokenBreakdown } from './token-breakdown.js';
import { scanTimingValue } from './scan-timing.js';

export type ReportLocale = 'zh' | 'en';

/** 导出报告标签：node 项目不含 src/i18n，这里自带双语表（与前端 i18n 语义一致）。 */
const REPORT_LABELS = {
  zh: {
    title: '对比报告',
    speedMetrics: '速度指标',
    turnGapMedian: 'turnGap 中位数',
    avgLlmLatency: '响应延迟均值',
    pureInference: 'pureInferenceMs（旧 LLM 日志时长累计）',
    tokenBreakdown: 'Token 分解',
    phaseDurations: '阶段时长分布',
    noPhases: '无耗时阶段',
    competitiveDims: '竞争力维度',
  },
  en: {
    title: 'Comparison Report',
    speedMetrics: 'Speed metrics',
    turnGapMedian: 'Median turn gap',
    avgLlmLatency: 'Avg LLM latency',
    pureInference: 'pureInferenceMs (legacy LLM log duration sum)',
    tokenBreakdown: 'Token breakdown',
    phaseDurations: 'Phase duration distribution',
    noPhases: 'No phases with duration',
    competitiveDims: 'Competitive dimensions',
  },
} as const;

type ReportLabelKey = keyof (typeof REPORT_LABELS)['zh'];

function reportLabel(key: ReportLabelKey, locale: ReportLocale): string {
  return REPORT_LABELS[locale][key];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Server reports share the same legacy formulas without importing browser i18n. */
export function scanTimingCriteriaHtml(record: TraceRecord, locale: ReportLocale): string {
  const declared = record.session.durationSource;
  const source = declared === 'measured' || declared === 'derived' ? declared : 'unknown';
  const derived = source === 'derived';
  const partial = record.events.length < record.session.eventCount;
  const copy = locale === 'zh'
    ? ['旧扫描指标口径', `会话时长来源声明：${source}；逐事件实测依据仍未知。`,
      derived ? '时长可由相邻时间戳推导，含调度间隙，不是工具实测耗时。' : '声明不是每条事件的测量证明；日志零时长不是瞬时执行证明。',
      'TTFT：首 user_prompt 到首 LLM 日志起点，不是网络首 token 或代理首内容。',
      'TPS：有效 LLM 事件 output/duration 的算术平均；TPOT：有效 LLM 时长合计 / output 合计。',
      'pureInferenceMs：旧 LLM 日志时长累计，不保证纯模型实测；E2E：会话墙钟，非模型推理时间。',
      '任务、工具、参数与质量是否相同尚未验证；墙钟差不是因果性能提升。',
      ...(partial ? ['事件仅部分加载：基于当前事件页的指标不是完整会话指标。'] : [])]
    : ['Legacy scan timing', `Session duration declaration: ${source}; not per-event measurement proof.`,
      derived ? 'Durations may be derived from adjacent timestamps; includes scheduling gaps, not measured tool execution.' : 'The declaration does not prove individual measurements; zero log duration does not prove instantaneous execution.',
      'TTFT: first user_prompt to first LLM log start, not wire first token or proxy first content.',
      'TPS: arithmetic mean of valid per-LLM output/duration; TPOT: sum valid LLM durations / sum output.',
      'pureInferenceMs: legacy normalized LLM duration sum, not guaranteed measured inference; E2E: session wall-clock.',
      'Task/tool/config/quality equivalence is unproven; wall-clock difference is not a causal performance improvement.',
      ...(partial ? ['Events are partially loaded: current event-page metrics are not full-session metrics.'] : [])];
  return `<aside class="scan-timing-criteria">${copy.map(text => `<p>${escapeHtml(text)}</p>`).join('')}</aside>`;
}

function column(title: string, record: TraceRecord, locale: ReportLocale): string {
  const metrics = computeMetrics(record);
  const speed = computeSpeedMetrics(record);
  const time = (value: number | null, digits?: number): string => {
    const safe = scanTimingValue(value);
    return safe === null ? 'n/a' : `${digits === undefined ? safe : safe.toFixed(digits)} ms`;
  };
  const tokens = computeTokenBreakdown(record);
  const phases = Object.entries(metrics.durationByPhase)
    .filter(([, ms]) => ms > 0)
    .map(([phase, ms]) => `<li>${escapeHtml(phase)}: ${ms} ms</li>`)
    .join('');
  // §6.2/§6.3（calibrate-tokens-and-compare-report）：三维竞争力区块。
  // 代码精炼度 = totalSteps / fileWriteCount；分母为 0 显示 n/a（禁止 0 冒充）。
  const fileReads = record.events.filter((e) => e.kind === 'file_read').length;
  const fileWrites = record.events.filter((e) => e.kind === 'file_write').length;
  const readWriteRatio = fileWrites === 0 ? 'n/a' : (fileReads / fileWrites).toFixed(2);
  const codeConciseness =
    fileWrites === 0 ? 'n/a' : (metrics.totalSteps / fileWrites).toFixed(2);
  return `<section class="column">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(record.session.title || record.session.id)}</p>
    <h3>${reportLabel('speedMetrics', locale)}</h3>
    ${scanTimingCriteriaHtml(record, locale)}
    <ul>
      <li>e2e: ${time(speed.e2eMs)}</li>
      <li>ttft: ${time(speed.ttftMs)}</li>
      <li>tps: ${scanTimingValue(speed.tps)?.toFixed(2) ?? 'n/a'}</li>
      <li>tpot: ${time(speed.tpotMs, 1)}</li>
      <li>${reportLabel('turnGapMedian', locale)}: ${time(speed.turnGapMedianMs)}</li>
      <li>${reportLabel('avgLlmLatency', locale)}: ${time(speed.avgLlmResponseLatencyMs)}</li>
      <li>${reportLabel('pureInference', locale)}: ${time(speed.pureInferenceMs)}</li>
    </ul>
    <h3>${reportLabel('tokenBreakdown', locale)}</h3>
    <ul>
      <li>input: ${tokens.input}</li>
      <li>output: ${tokens.output}</li>
      <li>reasoning: ${tokens.reasoning}</li>
      <li>cacheRead: ${tokens.cacheRead}</li>
      <li>cacheWrite: ${tokens.cacheWrite}</li>
      <li>total: ${tokens.total}</li>
    </ul>
    <h3>${reportLabel('phaseDurations', locale)}</h3>
    <ul>${phases === '' ? `<li>${reportLabel('noPhases', locale)}</li>` : phases}</ul>
    <h3>${reportLabel('competitiveDims', locale)}</h3>
    <ul>
      <li>fast: e2e ${time(speed.e2eMs)}, llmCalls ${metrics.llmCallCount},
        totalToolDuration ${time(metrics.totalToolDurationMs)},
        avgLlmDuration ${time(speed.avgLlmDurationMs, 1)}</li>
      <li>frugal: total ${tokens.total}, netInput ${tokens.netInput}</li>
      <li>quality: readWriteRatio ${readWriteRatio}, fileWrites ${fileWrites},
        codeConciseness ${codeConciseness} (totalSteps / fileWriteCount),
        verificationCoverage ${metrics.verificationCoverage.toFixed(3)},
        hasUnitTests ${metrics.hasUnitTests ? 'yes' : 'no'},
        failedCommands ${metrics.failedCommandCount},
        repairLoops ${metrics.repairLoop === true ? 'yes' : 'no'},
        userRounds ${metrics.userInteractionRounds}</li>
    </ul>
  </section>`;
}

/** REQ-009（#18）：左右对比报告，含速度指标 / token 分解 / 阶段时长分布。 */
export function buildCompareReportHtml(
  left: TraceRecord,
  right: TraceRecord,
  locale: ReportLocale = 'zh',
): string {
  return buildComparisonShell('Compare', `<h1>${reportLabel('title', locale)}</h1><div class="columns">${column('Left', left, locale)}${column('Right', right, locale)}</div>`, locale);
}

/** Shared static HTML shell; callers must escape every data cell in trustedBody. */
export function buildComparisonShell(title: string, trustedBody: string, locale: ReportLocale = 'zh'): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:24px auto;padding:16px;color:#222}.columns{display:flex;gap:24px}.column{flex:1;border:1px solid #ccc;padding:12px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ccc;padding:6px;text-align:left}h2{margin-top:28px}</style></head><body>${trustedBody}</body></html>`;
}
