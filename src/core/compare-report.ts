import type { TraceRecord } from './trace-types.js';
import { computeMetrics } from './metrics.js';
import { computeSpeedMetrics } from './speed-metrics.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function column(title: string, record: TraceRecord): string {
  const metrics = computeMetrics(record);
  const speed = computeSpeedMetrics(record);
  return `<section class="column">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(record.session.title || record.session.id)}</p>
    <ul>
      <li>e2e: ${speed.e2eMs} ms</li>
      <li>tps: ${speed.tps === null ? 'n/a' : speed.tps.toFixed(2)}</li>
      <li>errorRate: ${metrics.errorRate.toFixed(3)}</li>
      <li>verification: ${metrics.verificationPresent ? 'yes' : 'no'}</li>
      <li>tokensPerStep: ${metrics.tokensPerStep.toFixed(2)}</li>
      <li>costUsd: ${metrics.costUsd.toFixed(4)}</li>
    </ul>
  </section>`;
}

/** REQ-009：左右对比报告（雷达图/时间线以朴素文本+列表呈现）。 */
export function buildCompareReportHtml(left: TraceRecord, right: TraceRecord): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Compare</title>
<style>.columns{display:flex;gap:24px}.column{flex:1;border:1px solid #ccc;padding:12px}</style></head>
<body><h1>对比报告</h1><div class="columns">${column('Left', left)}${column('Right', right)}</div></body></html>`;
}
