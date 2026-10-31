import { useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import { fetchLinkedTraceExport, LinkedTraceExportReadError } from '../api/linked-trace-export.js';
import { TRACE_EXPORT_MAX_EVENTS, TRACE_EXPORT_MAX_OFFSET } from '../core/trace-export.js';
import type { LinkedExportCoverage } from '../core/linked-trace-export.js';
import '../styles/components/linked-trace-export.css';

const COPY = {
  en: { title: 'Export linked metadata (OTLP JSON)', scope: 'Local read-only download of native observations and accepted capture memberships. No upload or model/tool execution. Bodies, titles, errors, paths, headers, URLs, models, tokens and fees are excluded. Originals remain available through their existing downloads.',
    timing: 'Scan spans are observation points. Network spans describe observed intervals or explicitly unknown ends; WebSockets describe a connection. These are not model inference times or proof of instantaneous execution. Generated IDs and memberships do not certify unique owners, causality, retries, billing or Agent success.',
    page: 'Native and capture pages are independent. Each download is a live snapshot; multiple pages are not a consistent archive. Source-history completeness and retry identity remain unknown. Capture page size is 20.',
    offset: 'Event offset', limit: 'Native page size', cursor: 'Capture cursor (empty = first batch)', range: 'Use offset 0–1000000, native page size 1–200 and an empty cursor or positive safe integer.', action: 'Download linked OTLP JSON', retry: 'Retry local export',
    cancel: 'Cancel export', cancelled: 'Export cancelled; no download requested.', pending: 'Reading retained metadata…', timeout: 'Export exceeded 10 seconds; retry explicitly.',
    error: 'Export failed; no download requested. Check the local service and retry.', invalid: 'Export is invalid, over its metadata bound or contains truncated identity data. Try a smaller page; retained identity limits may require separate evidence downloads.',
    saved: 'Download requested. Check your browser; saving is not confirmed.', partial: 'Partial retained native metadata', complete: 'All currently retained native metadata covered',
    returned: 'Native rows read', total: 'Retained native rows', omitted: 'Invalid-time rows omitted', unloaded: 'Native detail is not fully loaded.', mismatch: 'Index count differs from retained rows.',
    next: 'Select next native page', nextCapture: 'Select next capture page', empty: 'No exportable observations on this page.',
    capture: 'Capture rows read', capturePartial: 'Partial capture coverage', captureComplete: 'All currently accepted captures covered', identity: 'Retained identity locators', identityComplete: 'Loaded identity manifests complete (source history still unknown)', identityIncomplete: 'Identity evidence incomplete', missing: 'Omitted evidence count', reasons: 'Evidence reasons (codes)',
  },
  zh: { title: '导出关联元数据（OTLP JSON）', scope: '只读、本地下载原生日志观测与已接受的采集归属。不上传、不执行模型或工具。不包含正文、标题、错误文本、路径、请求头、URL、模型、Token 或费用；原文仍可通过已有入口独立下载。',
    timing: 'scan span 是观测点；网络 span 是观测区间或明确标记结束未知的记录，WebSocket 表示连接范围。这不是模型推理耗时或瞬时执行证明。生成 ID 与归属不能认证唯一所有者、因果、重试、计费或 Agent 成功。',
    page: '原生事件与采集独立分页，每次下载是实时快照，多页不保证一致。源历史完整性与重试身份始终未知。采集每页固定 20 条。',
    offset: '事件偏移', limit: '原生每页数量', cursor: '采集游标（留空为首批）', range: '偏移为 0–1000000，原生每页数量为 1–200；采集游标留空或输入安全正整数。', action: '下载关联 OTLP JSON', retry: '重试本地导出',
    cancel: '取消导出', cancelled: '已取消导出，未请求下载。', pending: '正在读取已存元数据…', timeout: '导出超过 10 秒，请显式重试。',
    error: '导出失败，未请求下载。请检查本地服务后重试。', invalid: '导出响应无效、超出元数据上限或身份被截断。可缩小分页；保留身份超限时需要独立证据下载。',
    saved: '已请求下载，请检查浏览器；尚未确认文件已保存。', partial: '部分已存原生元数据', complete: '已覆盖当前全部已存原生元数据',
    returned: '读取原生行数', total: '已存原生总行数', omitted: '无效时间遗漏行数', unloaded: '原生详情尚未全部加载。', mismatch: '索引数量与已存事件数量不一致。',
    next: '选择下一原生页', nextCapture: '选择下一采集页', empty: '本页没有可导出的观测记录。',
    capture: '读取采集行数', capturePartial: '部分采集覆盖', captureComplete: '已覆盖当前全部已接受采集', identity: '保留身份定位数', identityComplete: '已加载身份清单完整（源历史仍未知）', identityIncomplete: '身份依据不完整', missing: '遗漏依据计数', reasons: '依据原因（代码）',
  },
} as const;

export interface LinkedTraceExportPanelProps {
  sessionKey: string;
  locale: Locale;
  invalidateKey?: string | number;
}

function ExportPage({ sessionKey, locale }: LinkedTraceExportPanelProps) {
  const copy = COPY[locale];
  const [offsetText, setOffset] = useState('0');
  const [limitText, setLimit] = useState('100');
  const [cursorText, setCursor] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [coverage, setCoverage] = useState<LinkedExportCoverage | null>(null);
  const operation = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const generation = useRef(0);
  const objectUrl = useRef<string | null>(null);
  const offset = Number(offsetText), limit = Number(limitText);
  const validRange = /^(0|[1-9]\d*)$/.test(offsetText) && /^[1-9]\d*$/.test(limitText) && Number.isSafeInteger(offset) && offset <= TRACE_EXPORT_MAX_OFFSET && limit <= TRACE_EXPORT_MAX_EVENTS
    && (cursorText === '' || (/^[1-9]\d*$/.test(cursorText) && Number.isSafeInteger(Number(cursorText))));
  const invalidate = (): void => {
    generation.current++;
    if (operation.current) { clearTimeout(operation.current.timer); operation.current.controller.abort(); operation.current = null; }
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
  };
  useLayoutEffect(() => () => invalidate(), []);
  const changeRange = (kind: 'offset' | 'limit' | 'cursor', text: string): void => {
    invalidate(); setPending(false); setError(null); setCancelled(false); setCoverage(null);
    if (kind === 'offset') setOffset(text); else if (kind === 'limit') setLimit(text); else setCursor(text);
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
      const result = await fetchLinkedTraceExport(sessionKey, { eventOffset: offset, eventLimit: limit, captureLimit: 20, ...(cursorText === '' ? {} : { captureCursor: Number(cursorText) }) }, controller.signal);
      if (!current()) return;
      objectUrl.current = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl.current; anchor.download = `linked-trace-page-${offset}.otlp.json`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setCoverage(result.coverage);
    } catch (cause) {
      if (current()) {
        setError(cause instanceof LinkedTraceExportReadError ? cause.code : 'EXPORT_UNAVAILABLE');
        if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
      }
    } finally {
      clearTimeout(timer);
      if (owned === generation.current) { operation.current = null; setPending(false); }
    }
  };
  return <details className="linked-trace-export-panel">
    <summary>{copy.title}</summary>
    <p>{copy.scope}</p><p>{copy.timing}</p><p>{copy.page}</p>
    <div className="linked-trace-export-range">
      <label>{copy.offset}<input type="text" inputMode="numeric" value={offsetText} onChange={event => changeRange('offset', event.target.value)} /></label>
      <label>{copy.limit}<input type="text" inputMode="numeric" value={limitText} onChange={event => changeRange('limit', event.target.value)} /></label>
      <label>{copy.cursor}<input type="text" inputMode="numeric" value={cursorText} onChange={event => changeRange('cursor', event.target.value)} /></label>
    </div>
    {!validRange && <p role="alert">{copy.range}</p>}
    <div className="linked-trace-export-actions">
      <button type="button" className="btn" disabled={!validRange || pending} onClick={() => void download()}>{error ? copy.retry : copy.action}</button>
      {pending && <button type="button" className="btn" onClick={() => { invalidate(); setPending(false); setCancelled(true); }}>{copy.cancel}</button>}
    </div>
    {pending && <p role="status">{copy.pending}</p>}
    {cancelled && <p role="status">{copy.cancelled}</p>}
    {error && <p role="alert">{error === 'EXPORT_TIMEOUT' ? copy.timeout : error === 'INVALID_EXPORT' || error === 'EXECUTION_METADATA_LIMIT' ? copy.invalid : copy.error} <code>{error}</code></p>}
    {coverage && <div role="status">
      <p>{copy.saved}</p><p><strong>{coverage.native.partial ? copy.partial : copy.complete}</strong></p>
      <p>{copy.returned}: {coverage.native.returned} · {copy.total}: {coverage.native.eventTotal} · {copy.omitted}: {coverage.native.omittedInvalidTime}</p>
      <p>{copy.capture}: {coverage.capture.returned} · {copy.omitted}: {coverage.capture.omittedInvalidTime} · {coverage.capture.partial ? copy.capturePartial : copy.captureComplete}</p>
      <p>{copy.identity}: {coverage.identity.returned} · {copy.missing}: {coverage.identity.omittedCount}</p>
      <p>{coverage.identity.complete ? copy.identityComplete : copy.identityIncomplete}</p>
      {coverage.identity.reasons.length > 0 && <p>{copy.reasons}: {coverage.identity.reasons.join(', ')}</p>}
      {coverage.capture.nextCursor !== null && <button type="button" className="btn" onClick={() => changeRange('cursor', String(coverage.capture.nextCursor))}>{copy.nextCapture}</button>}
      {coverage.native.returned === coverage.native.omittedInvalidTime && coverage.capture.returned === coverage.capture.omittedInvalidTime && <p>{copy.empty}</p>}
      {!coverage.native.detailLoaded && <p>{copy.unloaded}</p>}
      {coverage.native.countMismatch && <p>{copy.mismatch}</p>}
      {coverage.native.nextOffset !== null && coverage.native.nextOffset <= TRACE_EXPORT_MAX_OFFSET && <button type="button" className="btn" onClick={() => changeRange('offset', String(coverage.native.nextOffset))}>{copy.next}</button>}
    </div>}
  </details>;
}

/** Parent invalidation/remount cancels ownership without reading or restoring stale downloads. */
export function LinkedTraceExportPanel(props: LinkedTraceExportPanelProps) {
  return <ExportPage key={JSON.stringify([props.sessionKey, props.invalidateKey ?? null])} {...props} />;
}
