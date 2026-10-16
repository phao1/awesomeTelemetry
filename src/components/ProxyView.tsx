import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { BusEvents, CaptureBodyStatus, ProxyCaptureBodies, ProxyProtocolAnalysis, ProxyRequest, ProxyRequestListItem, ProxyRuntimeStatus, SessionIndexEntry } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Drawer } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { Badge } from './ui/Badge.js';
import { RequestContextDiffPanel } from './RequestContextDiffPanel.js';
import { ProxyTraceLinksPanel } from './TraceLinksPanel.js';
import { OriginalDeletionControl } from './OriginalDeletionControl.js';
const MonitorSetupPanel = lazy(() => import('./MonitorSetupPanel.js').then(module => ({ default: module.MonitorSetupPanel })));
const CaptureCapacityPanel = lazy(() => import('./CaptureCapacityPanel.js').then(module => ({ default: module.CaptureCapacityPanel })));

const DETAIL_READ_TIMEOUT = 'PROXY_DETAIL_READ_TIMEOUT';
/** Own only this local read; abort/unmount/timeout never retries an Agent call. */
function beginDetailRead<T>(read: (signal: AbortSignal) => Promise<T>, value: (result: T) => void,
  error: (message: string | null) => void, pending: (value: boolean) => void): () => void {
  const controller = new AbortController();
  let current = true;
  pending(true); error(null);
  const deadline = setTimeout(() => {
    if (!current) return;
    current = false; controller.abort(); error(DETAIL_READ_TIMEOUT); pending(false);
  }, 5000);
  void read(controller.signal).then(result => { if (current) value(result); }).catch((cause: unknown) => {
    if (current) error(cause instanceof Error ? cause.message : String(cause));
  }).finally(() => { clearTimeout(deadline); if (current) pending(false); });
  return () => { current = false; clearTimeout(deadline); controller.abort(); };
}

function DetailReadError({ code, message, locale, onRetry }: {
  code: string; message: string; locale: Locale; onRetry: () => void;
}): React.JSX.Element {
  return <div className="ui-error" role="alert">
    <span className="ui-error-code">{code}</span>
    <div className="ui-error-message">{message === DETAIL_READ_TIMEOUT ? t('proxy.detail.readTimeout', locale) : message}</div>
    <button className="btn" type="button" onClick={onRetry}>{t('common.retry', locale)}</button>
  </div>;
}

export interface ProxyViewProps {
  locale: Locale;
  liveStatus?: BusEvents['proxy_status'] | null;
  liveUpdates?: BusEvents['proxy_request'][];
  sessions?: SessionIndexEntry[];
  focusedRequestId?: number | null;
  onFocusedRequestHandled?: () => void;
  onOpenSession?: (key: string) => void;
  traceInvalidateKey?: number;
}

type ProxyStatus = ProxyRuntimeStatus;

function methodTone(method: string): 'success' | 'attention' | 'danger' | 'neutral' {
  if (method === 'GET') {
    return 'success';
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    return 'attention';
  }
  if (method === 'DELETE') {
    return 'danger';
  }
  return 'neutral';
}

function statusTone(status: number | null): 'success' | 'attention' | 'danger' | 'neutral' {
  if (status === null) {
    return 'neutral';
  }
  if (status < 300) {
    return 'success';
  }
  if (status < 400) {
    return 'neutral';
  }
  if (status < 500) {
    return 'attention';
  }
  return 'danger';
}

function fmtSize(item: ProxyRequestListItem): string {
  // ProxyRequestListItem 按契约 §4 排除全部 body 列，列表无大小字段（D-009 同类缺口）
  void item;
  return '—';
}

function mergeLiveItems(items: ProxyRequestListItem[], updates: BusEvents['proxy_request'][], excluded: Set<number>): ProxyRequestListItem[] {
  const merged = new Map(items.filter(item => !excluded.has(item.id)).map(item => [item.id, item]));
  for (const update of updates) {
    if (update.item !== undefined && !excluded.has(update.id)) merged.set(update.id, update.item);
  }
  return [...merged.values()].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.id - left.id).slice(0, 50);
}
function withoutBodies(request: ProxyRequest): ProxyRequest {
  return { ...request, requestBody: null, responseBody: null, rawRequestBody: null, rawResponseBody: null, systemPrompt: null, systemPromptLen: 0 };
}

/** REQ-020：代理视图。控制条 + 密排请求表 + 详情抽屉（8.4）。 */
export function ProxyView({ locale, liveStatus, liveUpdates, sessions = [], focusedRequestId = null, onFocusedRequestHandled, onOpenSession, traceInvalidateKey = 0 }: ProxyViewProps): React.JSX.Element {
  const [items, setItems] = useState<ProxyRequestListItem[]>([]);
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [port, setPort] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const closeCapacity = useCallback(() => setCapacityOpen(false), []);
  const [confirming, setConfirming] = useState<'stop' | 'clear' | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProxyRequest | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailGeneration = useRef(0);
  const blockedBodyIds = useRef(new Set<number>());
  const blockBodies = useCallback((id: number) => {
    blockedBodyIds.current.add(id); detailGeneration.current += 1;
    setDetail(previous => previous?.id === id ? withoutBodies(previous) : previous);
  }, []);
  const [methodFilter, setMethodFilter] = useState('');
  const excludedLiveIds = useRef(new Set<number>());
  const loadingBuffer = useRef<{ updates: BusEvents['proxy_request'][]; status: BusEvents['proxy_status'] | null } | null>(null);

  const load = useCallback(async () => {
    const buffer = { updates: [] as BusEvents['proxy_request'][], status: null as BusEvents['proxy_status'] | null };
    loadingBuffer.current = buffer;
    try {
      const [list, st] = await Promise.all([api.proxyRequests(), api.proxyStatus()]);
      if (loadingBuffer.current !== buffer) return;
      setItems(mergeLiveItems(list.items, buffer.updates, excludedLiveIds.current));
      const patch = buffer.status;
      setStatus({
        ...st,
        ...(patch === null ? {} : {
          running: patch.running, starting: patch.starting, port: patch.port ?? null,
          diagnostics: patch.diagnostics,
          startedAt: patch.running ? st.startedAt ?? new Date().toISOString() : null,
        }),
        requestCount: buffer.updates.at(-1)?.requestCount ?? st.requestCount,
      });
      setError(patch?.diagnostics?.phase === 'degraded' ? null : patch?.error ?? null);
    } catch (err) {
      if (loadingBuffer.current !== buffer) return;
      console.error('[proxy] 加载失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (loadingBuffer.current === buffer) loadingBuffer.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (liveStatus === null || liveStatus === undefined) return;
    if (loadingBuffer.current !== null) loadingBuffer.current.status = liveStatus;
    setStatus(previous => ({
      running: liveStatus.running, starting: liveStatus.starting, port: liveStatus.port ?? null,
      diagnostics: liveStatus.diagnostics,
      requestCount: previous?.requestCount ?? 0,
      startedAt: liveStatus.running ? previous?.startedAt ?? new Date().toISOString() : null,
    }));
    if (liveStatus.error && liveStatus.diagnostics?.phase !== 'degraded') setError(liveStatus.error);
  }, [liveStatus]);

  useEffect(() => {
    if (liveUpdates === undefined || liveUpdates.length === 0) return;
    if (loadingBuffer.current !== null) loadingBuffer.current.updates = liveUpdates;
    setItems(previous => mergeLiveItems(previous, liveUpdates, excludedLiveIds.current));
    const count = liveUpdates.at(-1)?.requestCount;
    if (count !== undefined) setStatus(previous => previous === null ? previous : { ...previous, requestCount: count });
  }, [liveUpdates]);

  const start = useCallback(async () => {
    const parsed = port === '' ? undefined : Number(port);
    try {
      const next = await api.proxyStart(parsed);
      setStatus(next);
      setError(null);
    } catch (err) {
      console.error('[proxy] 启动失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [port]);

  const stop = useCallback(async () => {
    setConfirming(null);
    try {
      const next = await api.proxyStop();
      setStatus(next);
      setError(null);
    } catch (err) {
      console.error('[proxy] 停止失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const clearRequests = useCallback(async () => {
    setConfirming(null);
    try {
      await api.clearProxyRequests();
      loadingBuffer.current = null; // A pre-clear snapshot must never resurrect deleted rows.
      excludedLiveIds.current = new Set([...items.map(item => item.id), ...(liveUpdates ?? []).map(update => update.id)]);
      setItems([]);
      setStatus(previous => previous === null ? null : { ...previous, requestCount: 0 });
      setError(null);
    } catch (err) {
      console.error('[proxy] 清空失败:', err);
      setError(err instanceof Error ? err.message : String(err));
      console.error(t('proxy.notImplemented', locale));
    }
  }, [locale, items, liveUpdates]);

  const downloadCa = useCallback(async () => {
    try {
      const pem = await api.caCert();
      const blob = new Blob([pem], { type: 'application/x-pem-file' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'agent-observe-proxy-ca-cert.pem';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[proxy] CA 下载失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openDetail = useCallback(async (id: number) => {
    setCapacityOpen(false);
    const token = ++detailGeneration.current;
    setSelected(id);
    setDetail(null);
    setDetailError(null);
    try {
      const request = await api.proxyRequest(id);
      if (token === detailGeneration.current) setDetail(blockedBodyIds.current.has(id) ? withoutBodies(request) : request);
    } catch (err) {
      if (token !== detailGeneration.current) return;
      console.error('[proxy] 详情加载失败:', err);
      setDetailError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => () => { detailGeneration.current += 1; }, []);
  useEffect(() => {
    if (focusedRequestId === null) return;
    void openDetail(focusedRequestId);
    onFocusedRequestHandled?.();
  }, [focusedRequestId, onFocusedRequestHandled, openDetail]);

  const filtered = useMemo(
    () => (methodFilter === '' ? items : items.filter((item) => item.method === methodFilter)),
    [items, methodFilter],
  );

  const methods = useMemo(() => [...new Set(items.map((item) => item.method))].sort(), [items]);
  const running = status?.running === true;
  const starting = status?.starting === true;
  const diagnostics = status?.diagnostics;
  const stopping = diagnostics?.phase === 'stopping';
  const ownsResources = running || starting || diagnostics?.cleanupPending === true;

  const statusLabel = diagnostics !== undefined
    ? `${t(`proxy.phase.${diagnostics.phase}`, locale)}${status?.port == null ? '' : ` :${status.port}`}`
    : starting
    ? t('proxy.status.starting', locale)
    : running
      ? `${t('proxy.status.running', locale)} :${status?.port ?? ''}`
      : t('proxy.status.stopped', locale);

  return (
    <section className="view" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="proxy-controlbar">
        <span className={`status-dot ${running ? 'status-success' : starting ? 'status-running' : 'status-unknown'}`} aria-hidden="true" />
        <span>{statusLabel}</span>
        {!ownsResources && (
          <>
            <input
              className="ui-input ui-btn-sm"
              style={{ width: '7ch' }}
              placeholder={t('proxy.port', locale)}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
            />
            <button type="button" className="btn" onClick={() => void start()} disabled={starting || stopping}>
              {t('proxy.start', locale)}
            </button>
          </>
        )}
        {ownsResources && (
          <button type="button" className="btn ui-btn-danger" disabled={stopping} onClick={() => setConfirming('stop')}>
            {t('proxy.stop', locale)}
          </button>
        )}
        <button type="button" className="btn" onClick={() => void downloadCa()}>
          {t('proxy.downloadCa', locale)}
        </button>
        <button type="button" className="btn" onClick={() => { setSelected(null); setCapacityOpen(false); setSetupOpen(true); }}>{t('monitor.title', locale)}</button>
        <button type="button" className="btn" onClick={() => { detailGeneration.current += 1; setSelected(null); setSetupOpen(false); setCapacityOpen(true); }}>{t('proxy.capacity.title', locale)}</button>
        {/* CA 说明只在运行时留在工具栏；未运行时它与下方空状态的引导逐字重复。 */}
        {running && (
          <span className="hint" style={{ margin: 0 }}>
            {t('proxy.caHint', locale)}
          </span>
        )}
        <span className="spacer" />
        <span className="mono">{status?.requestCount ?? 0} req</span>
        <button type="button" className="btn" onClick={() => setConfirming('clear')} disabled={items.length === 0}>
          {t('proxy.clear', locale)}
        </button>
        <button type="button" className="btn" onClick={() => void load()}>
          {t('common.refresh', locale)}
        </button>
      </div>
      {setupOpen && <Drawer open title={t('monitor.title', locale)} onClose={() => setSetupOpen(false)}>
        <Suspense fallback={<p>{t('common.loading', locale)}</p>}><MonitorSetupPanel locale={locale} runtimeStatus={status} onStatus={next => { setStatus(next); setError(null); }} /></Suspense>
      </Drawer>}
      {capacityOpen && <Drawer open title={t('proxy.capacity.title', locale)} onClose={closeCapacity}>
        <Suspense fallback={<p>{t('common.loading', locale)}</p>}><CaptureCapacityPanel locale={locale} runtimeStatus={status} /></Suspense>
      </Drawer>}
      {diagnostics !== undefined && (
        <div className="hint" role="status">
          {t('proxy.activity', locale)}: {diagnostics.observedRequests} / {diagnostics.activeRequests} / {diagnostics.pendingWrites} / {diagnostics.persistedRequests} / {diagnostics.interruptedRequests}
          {diagnostics.lastError !== null && <span> — {diagnostics.lastError}</span>}
          {diagnostics.resources !== undefined && <p>{t('proxy.resources', locale)}: {diagnostics.resources.previewBytes}/{diagnostics.resources.previewLimitBytes} · {diagnostics.resources.previewCollectors}/{diagnostics.resources.previewCollectorLimit} · {diagnostics.resources.queuedBytes}/{diagnostics.resources.queuedByteLimit} · {diagnostics.resources.queuedJobs}/{diagnostics.resources.queuedJobLimit} · {diagnostics.resources.workers}/{diagnostics.resources.workerLimit}; {diagnostics.resources.previewLimitedRequests} / {diagnostics.resources.processingRejectedRequests} / {diagnostics.resources.slowSseDisconnects}</p>}
        </div>
      )}
      {error !== null && <ErrorState code="PROXY_LOAD_FAILED" message={error} onRetry={() => void load()} />}
      {error === null && status === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={4} />
        </div>
      )}
      {/* 「未运行」和「已运行但还没抓到请求」是两种状态，
          此前都渲染成「代理未运行」，运行中的用户会以为没启动成功。 */}
      {error === null && status !== null && items.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={diagnostics !== undefined && diagnostics.phase !== 'idle'
            ? t(`proxy.phase.${diagnostics.phase}`, locale)
            : t(running ? 'proxy.waitingTraffic' : 'state.proxyNotRunning', locale)}
          description={t(diagnostics?.phase === 'capturing' || stopping
            ? 'proxy.inFlightHint' : running ? 'proxy.waitingHint' : 'proxy.caHint', locale)}
          action={
            ownsResources ? undefined : (
              <button type="button" className="btn" onClick={() => void start()} disabled={ownsResources || stopping}>
                {t('proxy.start', locale)}
              </button>
            )
          }
        />
      )}
      {items.length > 0 && (
        <div className="proxy-list-wrap">
          <div className="proxy-filters">
            <select className="ui-select ui-btn-sm" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="">{t('proxy.method', locale)}</option>
              {methods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <table className="ui-table ui-table-compact proxy-table">
            <thead>
              <tr>
                <th>{t('proxy.method', locale)}</th>
                <th>{t('proxy.hostname', locale)}</th>
                <th>{t('proxy.statusCode', locale)}</th>
                <th>{t('proxy.duration', locale)}</th>
                <th>{t('proxy.size', locale)}</th>
                <th>{t('proxy.time', locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="proxy-table-row" onClick={() => void openDetail(item.id)}>
                  <td>
                    <Badge tone={methodTone(item.method)}>{item.method}</Badge>
                  </td>
                  <td className="proxy-url-cell" title={item.url}>
                    {item.hostname}
                  </td>
                  <td>
                    <Badge tone={statusTone(item.responseStatus)}>{item.responseStatus ?? '—'}</Badge>
                  </td>
                  <td className="mono">{item.durationMs === null ? '—' : `${Math.round(item.durationMs)}ms`}</td>
                  <td className="mono">{fmtSize(item)}</td>
                  <td className="mono">{new Date(item.startedAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirming !== null && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal ui-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <p>{t(confirming === 'stop' ? 'proxy.confirmStop' : 'proxy.confirmClear', locale)}</p>
              <div className="inspector-actions">
                <button type="button" className="btn ui-btn-danger" onClick={() => void (confirming === 'stop' ? stop() : clearRequests())}>
                  {t('common.confirm', locale)}
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(null)}>
                  {t('common.close', locale)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <Drawer
        title={detail?.url ?? `#${selected ?? ''}`}
        open={selected !== null}
        onClose={() => { detailGeneration.current += 1; setSelected(null); setDetail(null); }}
      >
        {detailError !== null && <ErrorState code="PROXY_DETAIL_FAILED" message={detailError} onRetry={() => selected !== null && void openDetail(selected)} />}
        {detail !== null && (
          <ProxyDetailDrawer
            key={detail.id}
            request={detail}
            locale={locale}
            loadedItems={items}
            onOpenRequest={(id) => void openDetail(id)}
            sessions={sessions}
            onOpenSession={onOpenSession}
            traceInvalidateKey={traceInvalidateKey}
            monitorStopped={status !== null && !ownsResources && !stopping}
            bodyBlocked={blockedBodyIds.current.has(detail.id)}
            onBlockBodies={blockBodies}
          />
        )}
      </Drawer>
    </section>
  );
}

function ProxyDetailDrawer({
  request,
  locale,
  loadedItems,
  onOpenRequest,
  sessions,
  onOpenSession,
  traceInvalidateKey,
  monitorStopped,
  bodyBlocked,
  onBlockBodies,
}: {
  request: ProxyRequest;
  locale: Locale;
  loadedItems: ProxyRequestListItem[];
  onOpenRequest: (id: number) => void;
  sessions: SessionIndexEntry[];
  onOpenSession?: (key: string) => void;
  traceInvalidateKey: number;
  monitorStopped: boolean;
  bodyBlocked: boolean;
  onBlockBodies: (id: number) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<'request' | 'response' | 'headers' | 'timing' | 'contextDiff' | 'analysis' | 'traceLinks'>('request');
  // 首次激活 Context Diff 后保持挂载，切走/回来时复用本地缓存而不重发（design D14）。
  const [contextDiffActivated, setContextDiffActivated] = useState(false);
  const [capture, setCapture] = useState<ProxyCaptureBodies | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturePending, setCapturePending] = useState(true);
  const [captureAttempt, setCaptureAttempt] = useState(0);
  const [analysisActivated, setAnalysisActivated] = useState(false);
  const [analysis, setAnalysis] = useState<ProxyProtocolAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [analysisPage, setAnalysisPage] = useState(0);
  const [availability, setAvailability] = useState<'loading' | 'available' | 'blocked'>('loading');
  const bodyEpoch = useRef(0);
  const bodyHidden = bodyBlocked || availability !== 'available';
  const onAvailability = useCallback((value: 'loading' | 'available' | 'blocked') => {
    setAvailability(value);
    if (value === 'blocked') {
      bodyEpoch.current += 1; setAnalysis(null); setAnalysisError(null); setAnalysisPage(0);
      setAnalysisActivated(false); setContextDiffActivated(false); onBlockBodies(request.id);
    }
  }, [onBlockBodies, request.id]);
  useEffect(() => {
    if (!analysisActivated || bodyHidden) return;
    const epoch = bodyEpoch.current;
    setAnalysis(null); setAnalysisPage(0);
    return beginDetailRead(signal => api.proxyAnalysis(request.id, signal), value => {
      if (epoch === bodyEpoch.current) setAnalysis(value);
    }, setAnalysisError, setAnalysisPending);
  }, [analysisActivated, request.id, bodyHidden, analysisAttempt]);
  useEffect(() => {
    return beginDetailRead(signal => api.proxyCapture(request.id, signal), setCapture, setCaptureError, setCapturePending);
  }, [request.id, captureAttempt]);
  const statusKey = {
    complete: 'proxy.capture.complete', body_limit: 'proxy.capture.bodyLimit',
    quota_exceeded: 'proxy.capture.quota', queue_full: 'proxy.capture.queue',
    write_error: 'proxy.capture.writeError', interrupted: 'proxy.capture.interrupted',
  } as const satisfies Record<CaptureBodyStatus, string>;
  const originalInfo = (direction: 'request' | 'response'): React.JSX.Element | null => {
    if (bodyHidden) return null;
    const ref = capture?.[direction];
    if (ref === null) return <p className="hint">{t('proxy.capture.unavailable', locale)}</p>;
    if (ref === undefined) return null;
    const truncated = direction === 'request' ? capture?.requestPreviewTruncated : capture?.responsePreviewTruncated;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Badge tone={ref.status === 'complete' ? 'success' : 'attention'}>{t(statusKey[ref.status], locale)}</Badge>
        <span className="mono" title={ref.sha256}>{ref.bytes.toLocaleString()} B</span>
        <a className="btn" href={`/api/proxy/requests/${request.id}/body/${direction}`} download>{t('proxy.capture.download', locale)}</a>
        {truncated && <span className="hint">{t('proxy.capture.preview', locale)}</span>}
      </div>
    );
  };
  const desensitized = request.rawRequestBody !== null && request.rawRequestBody !== request.requestBody;
  const desensitizedResponse = request.rawResponseBody !== null && request.rawResponseBody !== request.responseBody;
  const showContextDiff = tab === 'contextDiff' || contextDiffActivated;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <OriginalDeletionControl id={request.id} requestId={request.requestId} locale={locale} monitorStopped={monitorStopped}
        supported={capture?.request != null && capture?.response != null} onAvailability={onAvailability} />
      {bodyHidden && <p className="hint" role="status">{t(availability === 'loading' && !bodyBlocked ? 'proxy.deletion.checkingBody' : 'proxy.deletion.hidden', locale)}</p>}
      {capturePending && <Skeleton count={1} />}
      {captureError !== null && <DetailReadError code="CAPTURE_METADATA_FAILED" message={captureError} locale={locale} onRetry={() => setCaptureAttempt(attempt => attempt + 1)} />}
      {capture?.transport !== undefined && <div role="status" className="hint">
        {t('proxy.transport.title', locale)}: {t(`proxy.transport.${capture.transport.state}`, locale)}
        {capture.transport.error !== null && <span> — <code>{capture.transport.error}</code></span>}
        <p>{t('proxy.transport.statusCode', locale)}: {capture.transport.statusCode ?? '—'} · {t('proxy.transport.directions', locale)}: {String(capture.transport.requestEnded)} / {String(capture.transport.responseEnded)}</p>
      </div>}
      {capture?.processing !== undefined && <div role="status" className="hint">
        {t('proxy.processing.title', locale)}: {t(`proxy.processing.${capture.processing.status}`, locale)}
        {capture.processing.error !== null && <span> — <code>{capture.processing.error}</code></span>}
        {capture.processing.previewDroppedBytes !== undefined && <p>{t('proxy.processing.previewDropped', locale)}: {capture.processing.previewDroppedBytes.request} / {capture.processing.previewDroppedBytes.response}</p>}
        {!bodyHidden && capture.processing.status !== 'ok' && <p>{t('proxy.processing.originals', locale)}</p>}
        {capture.processing.contentDecoding !== undefined && (capture.processing.contentDecoding.request !== 'identity' || capture.processing.contentDecoding.response !== 'identity') && <p>{t('proxy.processing.decodedView', locale)}</p>}
      </div>}
      <Tabs
        variant="pill"
        className="proxy-detail-tabs"
        activeId={tab}
        onChange={(id) => {
          const next = id as typeof tab;
          if (next === 'contextDiff') {
            setContextDiffActivated(true);
          }
          if (next === 'analysis') setAnalysisActivated(true);
          setTab(next);
        }}
        items={[
          { id: 'request', label: t('proxy.request', locale) },
          { id: 'response', label: t('proxy.response', locale) },
          { id: 'headers', label: t('proxy.headers', locale) },
          { id: 'timing', label: t('proxy.timing', locale) },
          { id: 'analysis', label: t('proxy.analysis.title', locale) },
          { id: 'traceLinks', label: t('trace.links.title', locale) },
          { id: 'contextDiff', label: t('proxy.contextDiff.title', locale) },
        ]}
      />
      {tab === 'request' && !bodyHidden && (
        <div>
          {originalInfo('request')}
          {desensitized && <Badge tone="attention">{t('proxy.desensitized', locale)}</Badge>}
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--canvas-inset)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
            {request.requestBody ?? '—'}
          </pre>
        </div>
      )}
      {tab === 'response' && !bodyHidden && (
        <div>
          {originalInfo('response')}
          {desensitizedResponse && <Badge tone="attention">{t('proxy.desensitized', locale)}</Badge>}
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--canvas-inset)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
            {request.responseBody ?? '—'}
          </pre>
        </div>
      )}
      {tab === 'headers' && (
        <table className="ui-table ui-table-compact">
          <tbody>
            {Object.entries(request.requestHeaders).map(([key, value]) => (
              <tr key={key}>
                <td className="mono">{key}</td>
                <td className="mono">{value}</td>
              </tr>
            ))}
            {capture !== null && Object.entries(capture.responseHeaders ?? {}).map(([key, value]) => (
              <tr key={`response-${key}`}>
                <td className="mono">{t('proxy.response', locale)} · {key}</td>
                <td className="mono">{Array.isArray(value) ? value.join('\n') : value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'timing' && (
        <dl className="meta" style={{ flexDirection: 'column' }}>
          <dt>{t('proxy.time', locale)}</dt>
          <dd className="mono">{new Date(request.startedAt).toLocaleString()}</dd>
          <dt>{t('proxy.duration', locale)}</dt>
          <dd className="mono">{request.durationMs === null ? '—' : `${Math.round(request.durationMs)}ms`}</dd>
          <dt>capture</dt>
          <dd className="mono">{request.captureMethod}</dd>
        </dl>
      )}
      {tab === 'analysis' && !bodyHidden && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {analysisError !== null && <DetailReadError code="PROTOCOL_ANALYSIS_FAILED" message={analysisError} locale={locale} onRetry={() => setAnalysisAttempt(attempt => attempt + 1)} />}
          {analysisPending && <Skeleton count={3} />}
          {analysis !== null && (
            <>
              <p className="hint">{t('proxy.analysis.evidenceOnly', locale)}</p>
              <div className="meta"><span>{analysis.requestFormat}</span><span>{analysis.model ?? '—'}</span><Badge tone={analysis.state === 'completed' ? 'success' : 'attention'}>{analysis.state}</Badge><span>{analysis.stopReason ?? '—'}</span></div>
              {!analysis.completeness.complete && <p role="status">{t('proxy.analysis.partial', locale)}: {analysis.completeness.reasons.join(', ')}</p>}
              <dl className="meta">
                {(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'] as const).map(key => (
                  <div key={key}><dt>{key}</dt><dd className="mono">{analysis.usage[key] ?? '—'}</dd></div>
                ))}
              </dl>
              <p className="hint">{t('proxy.analysis.accounting', locale)}: {analysis.usage.accounting} · unknown events: {analysis.unknownEvents}</p>
              {analysis.system !== null && <details><summary>System</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{analysis.system}</pre></details>}
              <details><summary>{t('proxy.analysis.declarations', locale)} ({analysis.declarations.length})</summary>{analysis.declarations.map((tool, index) => <pre key={index} style={{ whiteSpace: 'pre-wrap' }}>{tool.definition}</pre>)}</details>
              <details><summary>{t('proxy.analysis.nativeUsage', locale)}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(analysis.usage.snapshots, null, 2)}</pre></details>
              {analysis.errors.map((error, index) => <ErrorState key={index} code={error.code ?? 'PROTOCOL_ERROR'} message={error.message} />)}
              {analysis.items.slice(analysisPage * 50, (analysisPage + 1) * 50).map((item, index) => (
                <details key={analysisPage * 50 + index}>
                  <summary>{item.phase === 'request' ? t('proxy.analysis.history', locale) : t('proxy.analysis.response', locale)} · {item.kind} · {item.name ?? item.callId ?? item.id ?? '—'} {!item.complete && '…'}</summary>
                  <p className="hint mono">{item.sourcePath}{item.callId !== null ? ' · callId=' + item.callId : ''}</p>
                  <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{item.content}</pre>
                </details>
              ))}
              {analysis.items.length > 50 && (
                <div>
                  <button className="btn" type="button" disabled={analysisPage === 0} onClick={() => setAnalysisPage(page => page - 1)}>{t('proxy.analysis.previous', locale)}</button>
                  <span> {analysisPage + 1}/{Math.ceil(analysis.items.length / 50)} </span>
                  <button className="btn" type="button" disabled={(analysisPage + 1) * 50 >= analysis.items.length} onClick={() => setAnalysisPage(page => page + 1)}>{t('proxy.analysis.next', locale)}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {tab === 'traceLinks' && <ProxyTraceLinksPanel proxyId={request.id} sessions={sessions} locale={locale} onOpenSession={onOpenSession} invalidateKey={traceInvalidateKey} />}
      {showContextDiff && !bodyHidden && (
        <div hidden={tab !== 'contextDiff'}>
          <RequestContextDiffPanel
            targetId={request.id}
            targetFormat={request.requestFormat}
            locale={locale}
            loadedItems={loadedItems}
            onOpenRequest={onOpenRequest}
            invalidateKey={traceInvalidateKey}
          />
        </div>
      )}
    </div>
  );
}
