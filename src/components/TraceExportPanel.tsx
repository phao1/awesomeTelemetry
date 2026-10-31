import { useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import { fetchTraceExport, TraceExportReadError } from '../api/trace-export.js';
import { TRACE_EXPORT_MAX_EVENTS, TRACE_EXPORT_MAX_OFFSET } from '../core/trace-export.js';
import type { TraceExportCoverage } from '../core/trace-export.js';

const COPY = {
  en: { title: 'Export scan Trace (OTLP JSON)', scope: 'Read-only local download of one retained native scan metadata page. No cloud upload, model/tool requests, proxy captures, original bodies, titles, errors, paths or fees.',
    timing: 'Spans mark observation points, not measured instantaneous executions. Normalized durations are separate attributes. Generated IDs are not native IDs; no parent, causal or retry links are inferred.',
    page: 'Pages are independent live snapshots. Source-history completeness is unknown, even when all retained metadata is covered. No automatic paging.',
    offset: 'Event offset', limit: 'Page size', range: 'Use an integer offset 0–1000000 and page size 1–200.', action: 'Download OTLP JSON', retry: 'Retry local export',
    cancel: 'Cancel export', cancelled: 'Export cancelled; no download requested.', pending: 'Reading retained metadata…', timeout: 'Export exceeded 10 seconds; retry explicitly.',
    error: 'Export failed; no download requested. Check the local service and retry.', invalid: 'Export response is invalid or too large. Try a smaller page.',
    saved: 'Download requested. Check your browser; saving is not confirmed.', partial: 'Partial retained metadata', complete: 'All currently retained metadata covered',
    returned: 'Rows read', total: 'Retained rows', omitted: 'Invalid-time rows omitted', unloaded: 'Details are not fully loaded. Open the native session, then export again.',
    mismatch: 'Index count differs from retained rows.', next: 'Select next page', empty: 'No exportable observations on this page.',
  },
  zh: { title: '导出 scan Trace（OTLP JSON）', scope: '只读、本地下载一个原生 scan 会话的已存元数据页。不上传云端、不请求模型或工具，不包含代理采集、原文、标题、错误文本、路径或费用。',
    timing: 'span 表示观测时间点，不是实测的瞬时执行。标准化时长单独保留为属性。导出 ID 为生成值，不是原生 ID；不推断父子、因果或重试关系。',
    page: '各页是独立的实时快照。即使覆盖全部已存元数据，原始历史是否完整仍未知。不自动翻页。',
    offset: '事件偏移', limit: '每页数量', range: '偏移须为 0–1000000 的整数，每页数量须为 1–200。', action: '下载 OTLP JSON', retry: '重试本地导出',
    cancel: '取消导出', cancelled: '已取消导出，未请求下载。', pending: '正在读取已存元数据…', timeout: '导出超过 10 秒，请显式重试。',
    error: '导出失败，未请求下载。请检查本地服务后重试。', invalid: '导出响应无效或过大，请尝试缩小分页。',
    saved: '已请求下载，请检查浏览器；尚未确认文件已保存。', partial: '部分已存元数据', complete: '已覆盖当前全部已存元数据',
    returned: '读取行数', total: '已存总行数', omitted: '无效时间遗漏行数', unloaded: '详情尚未全部加载，请打开原生会话后重新导出。',
    mismatch: '索引数量与已存事件数量不一致。', next: '选择下一页', empty: '本页没有可导出的观测记录。',
  },
} as const;

export interface TraceExportPanelProps {
  sessionKey: string;
  locale: Locale;
  invalidateKey?: string | number;
}

function ExportPage({ sessionKey, locale }: TraceExportPanelProps) {
  const copy = COPY[locale];
  const [offsetText, setOffset] = useState('0');
  const [limitText, setLimit] = useState('100');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [coverage, setCoverage] = useState<TraceExportCoverage | null>(null);
  const operation = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const generation = useRef(0);
  const objectUrl = useRef<string | null>(null);
  const offset = Number(offsetText), limit = Number(limitText);
  const validRange = /^(0|[1-9]\d*)$/.test(offsetText) && /^[1-9]\d*$/.test(limitText) && Number.isSafeInteger(offset) && offset <= TRACE_EXPORT_MAX_OFFSET && limit <= TRACE_EXPORT_MAX_EVENTS;
  const invalidate = (): void => {
    generation.current++;
    if (operation.current) { clearTimeout(operation.current.timer); operation.current.controller.abort(); operation.current = null; }
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
  };
  useLayoutEffect(() => () => invalidate(), []);
  const changeRange = (kind: 'offset' | 'limit', text: string): void => {
    invalidate(); setPending(false); setError(null); setCancelled(false); setCoverage(null);
    if (kind === 'offset') setOffset(text); else setLimit(text);
  };
  const download = async (): Promise<void> => {
    if (!validRange || operation.current) return;
    invalidate(); const owned = generation.current;
    const controller = new AbortController();
    const current = (): boolean => owned === generation.current && !controller.signal.aborted;
    const timer = setTimeout(() => {
      if (!current()) return;
      invalidate(); setPending(false); setError('EXPORT_TIMEOUT');
    }, 10_000);
    operation.current = { controller, timer };
    setPending(true); setError(null); setCancelled(false); setCoverage(null);
    try {
      const result = await fetchTraceExport(sessionKey, offset, limit, controller.signal);
      if (!current()) return;
      objectUrl.current = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl.current; anchor.download = `scan-trace-page-${offset}.otlp.json`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setCoverage(result.coverage);
    } catch (cause) {
      if (current()) {
        setError(cause instanceof TraceExportReadError ? cause.code : 'EXPORT_UNAVAILABLE');
        if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
      }
    } finally {
      clearTimeout(timer);
      if (owned === generation.current) { operation.current = null; setPending(false); }
    }
  };
  return <details className="trace-export-panel">
    <summary>{copy.title}</summary>
    <p>{copy.scope}</p><p>{copy.timing}</p><p>{copy.page}</p>
    <div className="trace-export-range">
      <label>{copy.offset}<input type="text" inputMode="numeric" value={offsetText} onChange={event => changeRange('offset', event.target.value)} /></label>
      <label>{copy.limit}<input type="text" inputMode="numeric" value={limitText} onChange={event => changeRange('limit', event.target.value)} /></label>
    </div>
    {!validRange && <p role="alert">{copy.range}</p>}
    <div className="trace-export-actions">
      <button type="button" className="btn" disabled={!validRange || pending} onClick={() => void download()}>{error ? copy.retry : copy.action}</button>
      {pending && <button type="button" className="btn" onClick={() => { invalidate(); setPending(false); setCancelled(true); }}>{copy.cancel}</button>}
    </div>
    {pending && <p role="status">{copy.pending}</p>}
    {cancelled && <p role="status">{copy.cancelled}</p>}
    {error && <p role="alert">{error === 'EXPORT_TIMEOUT' ? copy.timeout : error === 'INVALID_EXPORT' || error === 'EXECUTION_METADATA_LIMIT' ? copy.invalid : copy.error} <code>{error}</code></p>}
    {coverage && <div role="status">
      <p>{copy.saved}</p><p><strong>{coverage.partial ? copy.partial : copy.complete}</strong></p>
      <p>{copy.returned}: {coverage.returned} · {copy.total}: {coverage.eventTotal} · {copy.omitted}: {coverage.omittedInvalidTime}</p>
      {coverage.returned === coverage.omittedInvalidTime && <p>{copy.empty}</p>}
      {!coverage.detailLoaded && <p>{copy.unloaded}</p>}
      {coverage.countMismatch && <p>{copy.mismatch}</p>}
      {coverage.nextOffset !== null && coverage.nextOffset <= TRACE_EXPORT_MAX_OFFSET && <button type="button" className="btn" onClick={() => changeRange('offset', String(coverage.nextOffset))}>{copy.next}</button>}
    </div>}
  </details>;
}

/** Parent invalidation/remount cancels ownership without reading or restoring stale downloads. */
export function TraceExportPanel(props: TraceExportPanelProps) {
  return <ExportPage key={JSON.stringify([props.sessionKey, props.invalidateKey ?? null])} {...props} />;
}
