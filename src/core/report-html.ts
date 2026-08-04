import type { TraceRecord } from './trace-types.js';
import { computeMetrics } from './metrics.js';
import { computeSpeedMetrics } from './speed-metrics.js';
import { extractTokenText } from './token-breakdown.js';

const EXTERNAL_JSON_THRESHOLD = 100 * 1024;
const DATA_FILE = 'report-data.js';

export interface TraceReportResult {
  html: string;
  externalDataFile: string | null;
  /** 大 JSON 时的外部数据 JS 内容，由调用方（server 路由）持久化。 */
  externalDataJs?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * REQ-008 / G7.6：自包含 HTML 报告。
 * 大 JSON（>100KB）必须写入外部 .js 文件并用 <script src> 引用，禁止内联。
 */
export function buildTraceReportHtml(
  record: TraceRecord,
): TraceReportResult {
  const json = JSON.stringify(record);
  const metrics = computeMetrics(record);
  const speed = computeSpeedMetrics(record);

  const summary = `
    <h1>${escapeHtml(record.session.title || record.session.id)}</h1>
    <dl>
      <dt>provider</dt><dd>${escapeHtml(record.session.provider)}</dd>
      <dt>status</dt><dd>${escapeHtml(record.session.status)}</dd>
      <dt>events</dt><dd>${record.events.length}</dd>
      <dt>tokens</dt><dd>${escapeHtml(extractTokenText(record.session.tokenUsage))}</dd>
      <dt>e2e</dt><dd>${speed.e2eMs} ms</dd>
      <dt>ttft</dt><dd>${speed.ttftMs ?? 'n/a'} ms</dd>
      <dt>tps</dt><dd>${speed.tps === null ? 'n/a' : speed.tps.toFixed(2)}</dd>
      <dt>tokensPerStep</dt><dd>${metrics.tokensPerStep.toFixed(2)}</dd>
      <dt>errorRate</dt><dd>${metrics.errorRate.toFixed(3)}</dd>
      <dt>verification</dt><dd>${metrics.verificationPresent ? 'yes' : 'no'}</dd>
    </dl>
  `;

  if (json.length > EXTERNAL_JSON_THRESHOLD) {
    return {
      html: `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${escapeHtml(record.session.title)}</title></head>
<body>${summary}<div id="app"></div><script src="${DATA_FILE}"></script>
<script>const data = window.__TRACE_DATA__; document.getElementById('app').textContent = 'events: ' + data.events.length;</script>
</body></html>`,
      externalDataFile: DATA_FILE,
      externalDataJs: `window.__TRACE_DATA__ = ${json};`,
    };
  }

  return {
    html: `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${escapeHtml(record.session.title)}</title></head>
<body>${summary}<script id="trace-data" type="application/json">${json}</script>
<script>const data = JSON.parse(document.getElementById('trace-data').textContent); document.body.insertAdjacentHTML('beforeend', '<p>events: ' + data.events.length + '</p>');</script>
</body></html>`,
    externalDataFile: null,
  };
}
