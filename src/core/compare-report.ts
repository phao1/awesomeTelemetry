import type { TraceRecord } from './trace-types.js';
import { computeMetrics } from './metrics.js';
import { computeSpeedMetrics } from './speed-metrics.js';
import { computeTokenBreakdown } from './token-breakdown.js';

export type ReportLocale = 'zh' | 'en';

/** 导出报告标签：node 项目不含 src/i18n，这里自带双语表（与前端 i18n 语义一致）。 */
const REPORT_LABELS = {
  zh: {
    title: '对比报告',
    speedMetrics: '速度指标',
    turnGapMedian: 'turnGap 中位数',
    avgLlmLatency: '响应延迟均值',
    pureInference: '纯推理时长',
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
    pureInference: 'Pure inference time',
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

function column(title: string, record: TraceRecord, locale: ReportLocale): string {
  const metrics = computeMetrics(record);
  const speed = computeSpeedMetrics(record);
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
    <ul>
      <li>e2e: ${speed.e2eMs} ms</li>
      <li>ttft: ${speed.ttftMs === null ? 'n/a' : `${speed.ttftMs} ms`}</li>
      <li>tps: ${speed.tps === null ? 'n/a' : speed.tps.toFixed(2)}</li>
      <li>tpot: ${speed.tpotMs === null ? 'n/a' : `${speed.tpotMs.toFixed(1)} ms`}</li>
      <li>${reportLabel('turnGapMedian', locale)}: ${speed.turnGapMedianMs === null ? 'n/a' : `${speed.turnGapMedianMs} ms`}</li>
      <li>${reportLabel('avgLlmLatency', locale)}: ${speed.avgLlmResponseLatencyMs === null ? 'n/a' : `${speed.avgLlmResponseLatencyMs} ms`}</li>
      <li>${reportLabel('pureInference', locale)}: ${speed.pureInferenceMs} ms</li>
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
      <li>fast: e2e ${speed.e2eMs} ms, llmCalls ${metrics.llmCallCount},
        totalToolDuration ${metrics.totalToolDurationMs} ms,
        avgLlmDuration ${speed.avgLlmDurationMs === null ? 'n/a' : `${speed.avgLlmDurationMs.toFixed(1)} ms`}</li>
      <li>frugal: total ${tokens.total}, netInput ${tokens.netInput},
        cost ${metrics.costUsd.toFixed(4)}</li>
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
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Compare</title>
<style>.columns{display:flex;gap:24px}.column{flex:1;border:1px solid #ccc;padding:12px}</style></head>
<body><h1>${reportLabel('title', locale)}</h1><div class="columns">${column('Left', left, locale)}${column('Right', right, locale)}</div></body></html>`;
}
