import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { I18nKey, Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { BusEvents, CaptureBodyStatus, MonitorAgent, ProxyCaptureBodies, ProxyProtocolAnalysis, ProxyRequest, ProxyRequestListItem, ProxyRuntimeStatus, SessionIndexEntry } from '../core/trace-types.js';
import { api, ApiError } from '../api/client.js';
import { ErrorState, Skeleton } from './ui/States.js';
import { Drawer, Modal } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { Badge } from './ui/Badge.js';
import { RequestContextDiffPanel } from './RequestContextDiffPanel.js';
import { ProxyTraceLinksPanel } from './TraceLinksPanel.js';
import { OriginalDeletionControl } from './OriginalDeletionControl.js';
import { CaptureRequestList } from './CaptureRequestList.js';
import { CaptureBodyText } from './CaptureBodyText.js';
const ProxyInsights = lazy(() => import('./ProxyInsights.js').then(module => ({ default: module.ProxyInsights })));
const CodexCallsPanel = lazy(() => import('./CodexCallsPanel.js').then(module => ({ default: module.CodexCallsPanel })));
const TraceLogImportPanel = lazy(() => import('./TraceLogImportPanel.js').then(module => ({ default: module.TraceLogImportPanel })));
const MonitorSetupPanel = lazy(() => import('./MonitorSetupPanel.js').then(module => ({ default: module.MonitorSetupPanel })));
const MonitorCapabilitiesPanel = lazy(() => import('./MonitorCapabilitiesPanel.js').then(module => ({ default: module.MonitorCapabilitiesPanel })));
const CaptureCapacityPanel = lazy(() => import('./CaptureCapacityPanel.js').then(module => ({ default: module.CaptureCapacityPanel })));
const CaptureTimingPanel = lazy(() => import('./CaptureTimingPanel.js').then(module => ({ default: module.CaptureTimingPanel })));
const CaptureExportControl = lazy(() => import('./CaptureExportControl.js').then(module => ({ default: module.CaptureExportControl })));
const CaptureReparseControl = lazy(() => import('./CaptureReparseControl.js').then(module => ({ default: module.CaptureReparseControl })));
const CaptureComparisonPanel = lazy(() => import('./CaptureComparisonPanel.js').then(module => ({ default: module.CaptureComparisonPanel })));

const DETAIL_READ_TIMEOUT = 'PROXY_DETAIL_READ_TIMEOUT';
/** Own only this local read; abort/unmount/timeout never retries an Agent call. */
function beginDetailRead<T>(read: (signal: AbortSignal) => Promise<T>, value: (result: T) => void,
  error: (message: string | null) => void, pending: (value: boolean) => void, timeoutMs = 5000, timeoutCode = DETAIL_READ_TIMEOUT): () => void {
  const controller = new AbortController();
  let current = true;
  pending(true); error(null);
  const deadline = setTimeout(() => {
    if (!current) return;
    current = false; controller.abort(); console.error('[proxy] operation deadline:', timeoutCode);error(timeoutCode); pending(false);
  }, timeoutMs);
  void (async () => read(controller.signal))().then(result => { if (current) value(result); }).catch((cause: unknown) => {
    if (current) { console.error('[proxy] operation failed:', cause);error(cause instanceof ApiError ? cause.code + ': ' + cause.message : cause instanceof Error ? cause.message : String(cause)); }
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
  livePreview?: ReactNode;
}

type ProxyStatus = ProxyRuntimeStatus;

function validStatus(value: ProxyStatus): boolean {
  return value !== null && typeof value.running === 'boolean' && typeof value.starting === 'boolean' &&
    Number.isFinite(value.requestCount) && (value.port === null || typeof value.port === 'number');
}

function mergeRuntimePatch(base: ProxyRuntimeStatus, patch: BusEvents['proxy_status']): ProxyRuntimeStatus {
  const sameRun = base.running && patch.running && base.port === (patch.port ?? null) && base.diagnostics?.runId === patch.diagnostics?.runId;
  return { running: patch.running, starting: patch.starting, port: patch.port ?? null, requestCount: base.requestCount,
    startedAt: sameRun ? base.startedAt : null, diagnostics: patch.diagnostics };
}

function mergeLiveItems(items: ProxyRequestListItem[], updates: BusEvents['proxy_request'][], excluded: Set<number>): ProxyRequestListItem[] {
  const merged = new Map(items.filter(item => !excluded.has(item.id)).map(item => [item.id, item]));
  for (const update of updates) {
    if (update.item !== undefined && !excluded.has(update.id)) merged.set(update.id, update.item);
  }
  return [...merged.values()].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.id - left.id);
}
function withoutBodies(request: ProxyRequest): ProxyRequest {
  return { ...request, requestBody: null, responseBody: null, rawRequestBody: null, rawResponseBody: null, systemPrompt: null, systemPromptLen: 0 };
}

/** REQ-020：代理视图。控制条 + 密排请求表 + 详情抽屉（8.4）。 */
export function ProxyView({ locale, liveStatus, liveUpdates, sessions = [], focusedRequestId = null, onFocusedRequestHandled, onOpenSession, traceInvalidateKey = 0, livePreview }: ProxyViewProps): React.JSX.Element {
  const [items, setItems] = useState<ProxyRequestListItem[]>([]);
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const statusNow = useRef<ProxyStatus | null>(null);
  const commitStatus = useCallback((next: ProxyStatus) => { statusNow.current = next;setStatus(next); }, []);
  const [statusPending, setStatusPending] = useState(true), [statusError, setStatusError] = useState<string | null>(null);
  const [listPending, setListPending] = useState(true), [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const nextCursor = useRef<string | null>(null), listMode = useRef<'replace' | 'append'>('replace');
  const statusCleanup = useRef<(() => void) | null>(null), listCleanup = useRef<(() => void) | null>(null);
  const statusBusy = useRef(false), listBusy = useRef(false);
  const statusBuffer = useRef<{ patch: BusEvents['proxy_status'] | null; count: number | null } | null>(null);
  const listBuffer = useRef<Map<number, BusEvents['proxy_request']> | null>(null);
  const seenStatus = useRef(liveStatus), seenUpdates = useRef(liveUpdates);
  const excludedLiveIds = useRef(new Set<number>());
  const [listCleared, setListCleared] = useState(false);
  const [error, setError] = useState<string | null>(null), [port, setPort] = useState('');
  const [command, setCommand] = useState<'start' | 'stop' | null>(null);
  const commandBusy = useRef(false), commandCleanup = useRef<(() => void) | null>(null);
  const [uncertain, setUncertain] = useState(false), uncertainNow = useRef(false);
  const markUncertain = useCallback((value: boolean) => { uncertainNow.current = value;setUncertain(value); }, []);
  const [caPending, setCaPending] = useState(false), caCleanup = useRef<(() => void) | null>(null);
  const [setupOpen, setSetupOpen] = useState(false), [setupAgent, setSetupAgent] = useState<MonitorAgent | undefined>();
  const [setupInteraction, setSetupInteraction] = useState({ dirty: false, pending: false, affectsRuntime: false });
  const [confirmSetupClose, setConfirmSetupClose] = useState(false);
  const onSetupInteraction = useCallback((state: typeof setupInteraction) => setSetupInteraction(state), []);
  const closeSetup = (): void => {
    if (setupInteraction.dirty || setupInteraction.pending) setConfirmSetupClose(true);else setSetupOpen(false);
  };
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false), [capacityOpen, setCapacityOpen] = useState(false), [importOpen, setImportOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const closeCapacity = useCallback(() => setCapacityOpen(false), []);
  const [confirming, setConfirming] = useState<'stop' | null>(null);
  const [selected, setSelected] = useState<number | null>(null), [detail, setDetail] = useState<ProxyRequest | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null), [detailPending, setDetailPending] = useState(false);
  const detailGeneration = useRef(0), detailCleanup = useRef<(() => void) | null>(null);
  const blockedBodyIds = useRef(new Set<number>());
  const [detailWidth, setDetailWidth] = useState(() => Math.min(720, window.innerWidth * 0.96)), dragCleanup = useRef<(() => void) | null>(null);
  const maximumWidth = (): number => Math.min(900, window.innerWidth * 0.96);
  const clampWidth = (value: number): number => Math.max(Math.min(280, maximumWidth()), Math.min(maximumWidth(), value));
  const blockBodies = useCallback((id: number) => {
    blockedBodyIds.current.add(id);detailGeneration.current += 1;
    setDetail(previous => previous?.id === id ? withoutBodies(previous) : previous);
  }, []);
  const loadStatus = useCallback(() => {
    if (statusBusy.current) return;
    const buffer = { patch: null as BusEvents['proxy_status'] | null, count: null as number | null };
    statusBuffer.current = buffer;
    statusCleanup.current = beginDetailRead(signal => api.proxyStatus(signal), value => {
      if (!validStatus(value)) throw new Error('Invalid proxy status response');
      const patch = buffer.patch;
      const next = patch === null ? value : mergeRuntimePatch(value, patch);
      if (buffer.count !== null) next.requestCount = buffer.count;
      commitStatus(next);markUncertain(false);
    }, setStatusError, pending => {
      statusBusy.current = pending;setStatusPending(pending);
      if (!pending) { statusCleanup.current = null;statusBuffer.current = null; }
    }, 5000, 'PROXY_READ_TIMEOUT');
  }, [commitStatus, markUncertain]);

  const loadList = useCallback((mode: 'replace' | 'append' = 'replace') => {
    if (listBusy.current || mode === 'append' && nextCursor.current === null) return;
    listMode.current = mode;
    const buffer = new Map<number, BusEvents['proxy_request']>();
    listBuffer.current = buffer;
    listCleanup.current = beginDetailRead(signal => api.proxyRequests(mode === 'append' ? { cursor: nextCursor.current! } : {}, signal), value => {
      if (value === null || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean' ||
        value.nextCursor !== null && typeof value.nextCursor !== 'string' || value.hasMore && !value.nextCursor) throw new Error('Invalid proxy page response');
      // A failed/cancelled refresh must not release local hiding or revive old SSE.
      if (mode === 'replace') { excludedLiveIds.current.clear();setListCleared(false); }
      setItems(previous => mergeLiveItems(mode === 'append' ? [...previous, ...value.items] : value.items, [...buffer.values()], excludedLiveIds.current));
      nextCursor.current = value.nextCursor;setHasMore(value.hasMore);
    }, setListError, pending => {
      listBusy.current = pending;setListPending(pending);
      if (!pending) { listCleanup.current = null;listBuffer.current = null; }
    }, 5000, 'PROXY_READ_TIMEOUT');
  }, []);

  useEffect(() => {
    loadStatus();loadList();
    return () => {
      statusCleanup.current?.();listCleanup.current?.();commandCleanup.current?.();caCleanup.current?.();detailCleanup.current?.();dragCleanup.current?.();
      statusBusy.current = false;listBusy.current = false;commandBusy.current = false;statusBuffer.current = null;listBuffer.current = null;
      detailGeneration.current += 1;
    };
  }, [loadStatus, loadList]);

  useEffect(() => {
    if (liveStatus === null || liveStatus === undefined) return;
    const changed = seenStatus.current !== liveStatus;seenStatus.current = liveStatus;
    if (changed && statusBuffer.current !== null) statusBuffer.current.patch = liveStatus;
    if (statusNow.current !== null) commitStatus(mergeRuntimePatch(statusNow.current, liveStatus));
    if (changed) { markUncertain(false);setStatusError(null); }
    setError(liveStatus.diagnostics?.phase === 'degraded' ? null : liveStatus.error ?? null);
  }, [liveStatus, commitStatus, markUncertain]);

  useEffect(() => {
    if (liveUpdates === undefined || liveUpdates.length === 0) return;
    const changed = seenUpdates.current !== liveUpdates;seenUpdates.current = liveUpdates;
    if (changed && listBuffer.current !== null) for (const update of liveUpdates) listBuffer.current.set(update.id, update);
    setItems(previous => mergeLiveItems(previous, liveUpdates, excludedLiveIds.current));
    const count = liveUpdates.at(-1)?.requestCount;
    if (count !== undefined) {
      if (changed && statusBuffer.current !== null) statusBuffer.current.count = count;
      if (statusNow.current !== null) commitStatus({ ...statusNow.current, requestCount: count });
    }
  }, [liveUpdates, commitStatus]);

  useEffect(() => {
    const resize = (): void => setDetailWidth(value => Math.max(Math.min(280, Math.min(900, window.innerWidth * 0.96)), Math.min(Math.min(900, window.innerWidth * 0.96), value)));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const clearList = (): void => {
    // Only this mounted view changes. Revoke pending snapshots before hiding rows.
    for (const item of items) excludedLiveIds.current.add(item.id);
    for (const update of liveUpdates ?? []) excludedLiveIds.current.add(update.id);
    for (const id of listBuffer.current?.keys() ?? []) excludedLiveIds.current.add(id);
    listCleanup.current?.();listCleanup.current = null;listBuffer.current = null;listBusy.current = false;
    setListPending(false);setListError(null);listMode.current = 'replace';
    setItems([]);nextCursor.current = null;setHasMore(false);setListCleared(true);
  };

  const runCommand = useCallback((kind: 'start' | 'stop', read: (signal: AbortSignal) => Promise<ProxyStatus>) => {
    if (commandBusy.current) return;
    setConfirming(null);setError(null);
    commandCleanup.current = beginDetailRead(read, value => {
      if (!validStatus(value)) throw new Error('Invalid proxy control response');
      // Start may return a starting snapshot after a newer ready SSE arrived.
      if (!(kind === 'start' && value.starting && statusNow.current?.running)) commitStatus(value);
      markUncertain(false);
    }, message => {
      setError(message);
      if (message !== null) markUncertain(true);
    }, pending => {
      commandBusy.current = pending;setCommand(pending ? kind : null);
      if (!pending) commandCleanup.current = null;
    }, 12000, 'PROXY_CONTROL_TIMEOUT');
  }, [commitStatus, markUncertain]);
  const canControl = status !== null && !statusPending && statusError === null && !uncertain && command === null && !setupInteraction.affectsRuntime;
  const running = status?.running === true, starting = status?.starting === true;
  const diagnostics = status?.diagnostics, stopping = diagnostics?.phase === 'stopping';
  const ownsResources = running || starting || diagnostics?.cleanupPending === true;
  const portText = port.trim(), invalidPort = portText !== '' && (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535);
  const start = (): void => {
    const current = statusNow.current;
    if (current === null || statusBusy.current || uncertainNow.current || commandBusy.current || invalidPort ||
      current.running || current.starting || current.diagnostics?.cleanupPending === true) return;
    runCommand('start', signal => api.proxyStart(portText === '' ? undefined : Number(portText), signal));
  };
  const stop = (): void => {
    const current = statusNow.current;
    if (current === null || statusBusy.current || uncertainNow.current || commandBusy.current || current.diagnostics?.phase === 'stopping') return;
    if (!current.running && !current.starting && !current.diagnostics?.cleanupPending) { setConfirming(null);return; }
    runCommand('stop', signal => api.proxyStop(signal));
  };
  const cancelCommand = (): void => {
    commandCleanup.current?.();commandCleanup.current = null;commandBusy.current = false;setCommand(null);
    markUncertain(true);setError('PROXY_CONTROL_CANCELLED');
  };
  const cancelStatus = (): void => { statusCleanup.current?.();statusCleanup.current = null;statusBuffer.current = null;statusBusy.current = false;setStatusPending(false);setStatusError('PROXY_READ_CANCELLED'); };
  const cancelList = (): void => { listCleanup.current?.();listCleanup.current = null;listBuffer.current = null;listBusy.current = false;setListPending(false);setListError('PROXY_READ_CANCELLED'); };

  const downloadCa = (): void => {
    if (caCleanup.current !== null) return;
    caCleanup.current = beginDetailRead(signal => api.caCert(signal), pem => {
      if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('Invalid CA certificate response');
      const url = URL.createObjectURL(new Blob([pem], { type: 'application/x-pem-file' }));
      const anchor = document.createElement('a');anchor.href = url;anchor.download = 'agent-observe-proxy-ca-cert.pem';anchor.click();URL.revokeObjectURL(url);
    }, setError, pending => { setCaPending(pending);if (!pending) caCleanup.current = null; }, 5000, 'PROXY_READ_TIMEOUT');
  };
  const closeDetail = (): void => { detailGeneration.current += 1;detailCleanup.current?.();detailCleanup.current = null;dragCleanup.current?.();setSelected(null);setDetail(null);setDetailPending(false); };
  const openPanel = (panel: 'setup' | 'capabilities' | 'capacity' | 'import'): void => {
    closeDetail();setSetupOpen(panel === 'setup');setCapabilitiesOpen(panel === 'capabilities');setCapacityOpen(panel === 'capacity');setImportOpen(panel === 'import');
    if (panel === 'setup') setSetupAgent(undefined);
  };
  const openDetail = useCallback((id: number) => {
    setImportOpen(false);setCapacityOpen(false);setSetupOpen(false);setCapabilitiesOpen(false);
    detailCleanup.current?.();const token = ++detailGeneration.current;
    setSelected(id);setDetail(null);setDetailError(null);
    detailCleanup.current = beginDetailRead(signal => api.proxyRequest(id, signal), request => {
      if (request === null || request.id !== id || typeof request.url !== 'string') throw new Error('Invalid selected capture response');
      if (token === detailGeneration.current) setDetail(blockedBodyIds.current.has(id) ? withoutBodies(request) : request);
    }, setDetailError, pending => { setDetailPending(pending);if (!pending) detailCleanup.current = null; });
  }, []);
  useEffect(() => {
    if (focusedRequestId === null) return;
    openDetail(focusedRequestId);onFocusedRequestHandled?.();
  }, [focusedRequestId, onFocusedRequestHandled, openDetail]);
  const message = (value: string): string => value === 'PROXY_READ_TIMEOUT' || value === DETAIL_READ_TIMEOUT ? t('capture.readTimeout', locale)
    : value === 'PROXY_READ_CANCELLED' ? t('capture.readCancelled', locale) : value === 'PROXY_CONTROL_TIMEOUT' ? t('capture.controlTimeout', locale)
    : value === 'PROXY_CONTROL_CANCELLED' ? t('capture.controlUncertain', locale) : value;
  const statusLabel = status === null ? t('capture.statusUnknown', locale) : diagnostics !== undefined
    ? t(('proxy.phase.' + diagnostics.phase) as I18nKey, locale) + (status.port === null ? '' : ' :' + status.port)
    : starting ? t('proxy.status.starting', locale) : running ? t('proxy.status.running', locale) + ' :' + (status.port ?? '—') : t('proxy.status.stopped', locale);

  return <section className="view capture-workbench">
    <header className="capture-header"><h2>{t('capture.title', locale)}</h2><p className="hint">{t('capture.scope', locale)}</p></header>
    <ol className="capture-steps">{(['capture.stepSetup', 'capture.stepListen', 'capture.stepInspect'] as const).map(key => <li key={key}>{t(key, locale)}</li>)}</ol>
    <section className="capture-control-section" aria-label={t('capture.control', locale)}>
      <div className="capture-toolbar">
        <span className={'status-dot ' + (running ? 'status-success' : starting ? 'status-running' : 'status-unknown')} aria-hidden="true" /><strong role="status">{statusLabel}</strong>
        <span className="spacer" /><span className="mono">{t('capture.historyCount', locale)}: {status?.requestCount ?? '—'} req</span>
      </div>
      <div className="capture-toolbar">
        {!ownsResources && <><label>{t('proxy.port', locale)}<input className="ui-input ui-btn-sm capture-port" value={port} inputMode="numeric"
          onChange={event => setPort(event.target.value)} aria-invalid={invalidPort} /></label>
          <button type="button" className="btn ui-btn-primary" onClick={start} disabled={!canControl || invalidPort}>{t('proxy.start', locale)}</button></>}
        {ownsResources && <button type="button" className="btn ui-btn-danger" disabled={!canControl || stopping} onClick={() => setConfirming('stop')}>{t('proxy.stop', locale)}</button>}
        <button type="button" className="btn" disabled={statusPending || command !== null || setupInteraction.affectsRuntime} onClick={loadStatus}>{t('capture.refreshStatus', locale)}</button>
        {(statusPending || command !== null) && <button type="button" className="btn ui-btn-sm" onClick={command === null ? cancelStatus : cancelCommand}>{t('capture.cancelWaiting', locale)}</button>}
      </div>
      <p className="hint">{t('capture.portHint', locale)}</p>
      {invalidPort && <p role="alert">{t('capture.portInvalid', locale)}</p>}
      {statusPending && <p className="hint" role="status">{t('common.loading', locale)}</p>}
      {statusError !== null && <DetailReadError code="PROXY_STATUS_FAILED" message={message(statusError)} locale={locale} onRetry={loadStatus} />}
      {command !== null && <p className="hint" role="status">{t('capture.controlPending', locale)}</p>}
      {uncertain && <p role="status">{t('capture.controlUncertain', locale)}</p>}
      {error !== null && <div className="ui-error" role="alert"><code>{error}</code><p>{message(error)}</p></div>}
    </section>
    <div className="capture-toolbar">
      <button type="button" className="btn" onClick={() => openPanel('setup')}>{t('monitor.title', locale)}</button>
      <button type="button" className="btn" onClick={() => openPanel('import')}>{t('traceImport.title', locale)}</button>
      <details className="capture-tools"><summary>{t('capture.moreTools', locale)}</summary><div className="capture-toolbar">
        <button type="button" className="btn" disabled={caPending} onClick={downloadCa}>{t('proxy.downloadCa', locale)}</button>
        <button type="button" className="btn" onClick={() => openPanel('capabilities')}>{t('monitor.capabilities.title', locale)}</button>
        <button type="button" className="btn" onClick={() => openPanel('capacity')}>{t('proxy.capacity.title', locale)}</button>
      </div></details>
    </div>
    {diagnostics !== undefined && <details className="capture-run"><summary>{t('proxy.activity', locale)} · {t('capture.observed', locale)} {diagnostics.observedRequests} · {t('capture.persisted', locale)} {diagnostics.persistedRequests}</summary>
      <p className="hint">{t('capture.runScope', locale)}</p><dl className="capture-run-grid">
        {([['capture.observed', diagnostics.observedRequests], ['capture.active', diagnostics.activeRequests], ['capture.pendingWrites', diagnostics.pendingWrites],
          ['capture.persisted', diagnostics.persistedRequests], ['capture.interrupted', diagnostics.interruptedRequests], ['capture.captureErrors', diagnostics.captureErrors]] as const)
          .map(([key, value]) => <div key={key}><dt>{t(key, locale)}</dt><dd className="mono">{value}</dd></div>)}
      </dl>{diagnostics.lastError !== null && <p>{t('capture.runLastError', locale)}: <code>{diagnostics.lastError}</code></p>}
      {diagnostics.resources !== undefined && <section><h3>{t('capture.resourceTitle', locale)}</h3><p className="hint">{t('capture.resourceScope', locale)}</p>
        <p className="mono">{t('proxy.resources', locale)}: {diagnostics.resources.previewBytes}/{diagnostics.resources.previewLimitBytes} · {diagnostics.resources.previewCollectors}/{diagnostics.resources.previewCollectorLimit} · {diagnostics.resources.queuedBytes}/{diagnostics.resources.queuedByteLimit} · {diagnostics.resources.queuedJobs}/{diagnostics.resources.queuedJobLimit} · {diagnostics.resources.workers}/{diagnostics.resources.workerLimit}; {diagnostics.resources.previewLimitedRequests} / {diagnostics.resources.processingRejectedRequests} / {diagnostics.resources.slowSseDisconnects}</p>
      </section>}
    </details>}
    {livePreview !== undefined && <details className="capture-live" onToggle={event => setLiveOpen(event.currentTarget.open)}><summary>{t('capture.livePreview', locale)}</summary>
      {liveOpen ? livePreview : <p className="hint">{t('capture.liveHint', locale)}</p>}
    </details>}
    {status !== null && items.length === 0 && !listPending && !listCleared && <p className="hint" role="status">
      {t(diagnostics?.phase === 'capturing' || stopping ? 'proxy.inFlightHint' : running ? 'proxy.waitingHint' : 'proxy.caHint', locale)}
    </p>}
    <CaptureRequestList items={items} selected={selected} pending={listPending} error={listError === null ? null : message(listError)} hasMore={hasMore}
      locale={locale} onOpen={openDetail} onRefresh={() => loadList()} onLoadMore={() => loadList('append')} onRetry={() => loadList(listMode.current)} onCancel={cancelList}
      onClear={clearList} cleared={listCleared} />
    {setupOpen && <Drawer open className="monitor-setup-drawer" width={720} title={t('monitor.title', locale)} onClose={closeSetup}>
      <Suspense fallback={<p>{t('common.loading', locale)}</p>}><MonitorSetupPanel locale={locale} initialAgent={setupAgent} runtimeStatus={status}
        listenerBlocked={status === null || statusPending || statusError !== null || command !== null || uncertain} onInteractionState={onSetupInteraction}
        onRuntimeUncertain={() => { markUncertain(true);setError('PROXY_CONTROL_CANCELLED'); }}
        onOpenCapture={openDetail} onStatus={next => { commitStatus(next);markUncertain(false);setError(null); }} /></Suspense>
    </Drawer>}
    {confirmSetupClose && <Modal size="sm" title={t('monitor.flow.closeTitle', locale)} onClose={() => setConfirmSetupClose(false)}>
      <p>{t('monitor.flow.closeHint', locale)}</p><div className="capture-toolbar"><button type="button" className="btn" onClick={() => setConfirmSetupClose(false)}>{t('settings.keepEditing', locale)}</button>
      <button type="button" className="btn ui-btn-danger" onClick={() => { setConfirmSetupClose(false);setSetupOpen(false);setSetupInteraction({ dirty: false, pending: false, affectsRuntime: false }); }}>{t('monitor.flow.close', locale)}</button></div>
    </Modal>}
    {importOpen && <Drawer open className="trace-import-drawer" title={t('traceImport.title', locale)} onClose={() => setImportOpen(false)}>
      <Suspense fallback={<p>{t('common.loading', locale)}</p>}><TraceLogImportPanel locale={locale} stopped={status !== null && canControl && !ownsResources && !stopping} /></Suspense>
    </Drawer>}
    {capabilitiesOpen && <Drawer open title={t('monitor.capabilities.title', locale)} onClose={() => setCapabilitiesOpen(false)}>
      <Suspense fallback={<p>{t('common.loading', locale)}</p>}><MonitorCapabilitiesPanel locale={locale} onConfigure={agent => { setCapabilitiesOpen(false);setSetupAgent(agent);setSetupOpen(true); }} /></Suspense>
    </Drawer>}
    {capacityOpen && <Drawer open title={t('proxy.capacity.title', locale)} onClose={closeCapacity}>
      <Suspense fallback={<p>{t('common.loading', locale)}</p>}><CaptureCapacityPanel locale={locale} runtimeStatus={status} /></Suspense>
    </Drawer>}
    {confirming !== null && <Modal size="sm" title={t('proxy.confirmStop', locale)} onClose={() => setConfirming(null)}>
      <p>{t('proxy.confirmStop', locale)}</p>
      <div className="capture-toolbar"><button type="button" className="btn" onClick={() => setConfirming(null)}>{t('common.close', locale)}</button>
        <button type="button" className="btn ui-btn-danger" disabled={command !== null} onClick={stop}>{t('common.confirm', locale)}</button></div>
    </Modal>}
    <Drawer title={t('capture.detailTitle', locale) + ' #' + (selected ?? '') + (detail === null ? '' : ' · ' + detail.hostname)}
      className="capture-detail-drawer" width={detailWidth} open={selected !== null} onClose={closeDetail}>
      <div className="capture-detail-resize" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('capture.detailResize', locale)}
        aria-valuemin={Math.min(280, maximumWidth())} aria-valuemax={maximumWidth()} aria-valuenow={detailWidth}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;event.preventDefault();
          setDetailWidth(value => clampWidth(event.key === 'Home' ? 280 : event.key === 'End' ? 900 : value + (event.key === 'ArrowLeft' ? 16 : -16))); }}
        onMouseDown={event => { event.preventDefault();dragCleanup.current?.();const x = event.clientX, initial = detailWidth;
          const move = (next: MouseEvent): void => setDetailWidth(clampWidth(initial + x - next.clientX));
          const end = (): void => { window.removeEventListener('mousemove', move);window.removeEventListener('mouseup', end);dragCleanup.current = null; };
          dragCleanup.current = end;window.addEventListener('mousemove', move);window.addEventListener('mouseup', end);
        }} />
      {detailPending && <div role="status"><p>{t('capture.detailLoading', locale)}</p><Skeleton count={2} /><button type="button" className="btn" onClick={() => {
        detailCleanup.current?.();detailCleanup.current = null;detailGeneration.current += 1;setDetailPending(false);setDetailError('PROXY_READ_CANCELLED');
      }}>{t('capture.cancelWaiting', locale)}</button></div>}
      {detailError !== null && <DetailReadError code="PROXY_DETAIL_FAILED" message={message(detailError)} locale={locale} onRetry={() => selected !== null && openDetail(selected)} />}
      {detail !== null && <><div className="capture-request-meta"><code>{detail.requestId}</code><p>{detail.method} · {detail.url}</p><p>{detail.model ?? '—'} · {detail.requestFormat}</p></div>
        <ProxyDetailDrawer key={detail.id} request={detail} locale={locale} loadedItems={items} onOpenRequest={openDetail}
          sessions={sessions} onOpenSession={onOpenSession} traceInvalidateKey={traceInvalidateKey} monitorStopped={status !== null && canControl && !ownsResources && !stopping}
          bodyBlocked={blockedBodyIds.current.has(detail.id)} onBlockBodies={blockBodies} />
      </>}
    </Drawer>
  </section>;
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
  const [tab, setTab] = useState<'request' | 'response' | 'headers' | 'timing' | 'contextDiff' | 'analysis' | 'traceLinks' | 'comparison' | 'codex'>('request');
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
  const analysisRoot = useRef<HTMLDivElement>(null);
  const [analysisEvidence, setAnalysisEvidence] = useState<{ key: string } | null>(null);
  const [availability, setAvailability] = useState<'loading' | 'available' | 'blocked' | 'unknown'>('loading');
  const bodyEpoch = useRef(0);
  const analysisReadCleanup = useRef<(() => void) | null>(null);
  const analysisFromReparse = useRef(false);
  const reparseBodyEpoch = useRef<number | null>(null);
  const availabilityNow = useRef(availability);
  const previousTraceInvalidation = useRef(traceInvalidateKey);
  const bodyHidden = bodyBlocked || availability !== 'available';
  const isWebSocket = request.method === 'WS' || capture?.transport?.websocket !== undefined;
  const inspectAnalysisEvidence = (key: string): void => {
    if (key.startsWith('item-')) setAnalysisPage(Math.floor(Number(key.slice(5)) / 50));
    setAnalysisEvidence({ key });
  };
  useEffect(() => {
    if (analysisEvidence === null || bodyHidden) return;
    const element = analysisRoot.current?.querySelector<HTMLElement>('[data-analysis-evidence="' + analysisEvidence.key + '"]');
    if (element instanceof HTMLDetailsElement) element.open = true;
    const group = element?.closest('details');
    if (group) group.open = true;
    element?.focus();
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [analysisEvidence, bodyHidden]);
  const onAvailability = useCallback((value: 'loading' | 'available' | 'blocked' | 'unknown') => {
    availabilityNow.current = value;
    setAvailability(value);
    if (value === 'blocked') {
      bodyEpoch.current += 1; setAnalysis(null); setAnalysisError(null); setAnalysisPage(0);
      analysisFromReparse.current = false; reparseBodyEpoch.current = null;
      setAnalysisActivated(false); setContextDiffActivated(false); onBlockBodies(request.id);
    }
  }, [onBlockBodies, request.id]);
  useEffect(() => {
    if (!analysisActivated || bodyHidden || analysisFromReparse.current) return;
    const epoch = bodyEpoch.current;
    setAnalysis(null); setAnalysisPage(0);
    const cleanup = beginDetailRead(signal => api.proxyAnalysis(request.id, signal), value => {
      if (epoch === bodyEpoch.current) setAnalysis(value);
    }, setAnalysisError, setAnalysisPending);
    analysisReadCleanup.current = cleanup;
    return () => { cleanup(); if (analysisReadCleanup.current === cleanup) analysisReadCleanup.current = null; };
  }, [analysisActivated, request.id, bodyHidden, analysisAttempt]);
  useEffect(() => {
    if (previousTraceInvalidation.current === traceInvalidateKey) return;
    previousTraceInvalidation.current = traceInvalidateKey;
    if (!analysisFromReparse.current && reparseBodyEpoch.current === null) return;
    bodyEpoch.current += 1; reparseBodyEpoch.current = null; analysisFromReparse.current = false;
    analysisReadCleanup.current?.(); setAnalysis(null); setAnalysisError(null); setAnalysisPending(false);
    setAnalysisPage(0); setAnalysisEvidence(null); setAnalysisActivated(false); setContextDiffActivated(false);
  }, [traceInvalidateKey]);
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
        <a className="btn" href={`/api/proxy/requests/${request.id}/body/${direction}`} download>{t(isWebSocket ? 'proxy.websocket.download' : 'proxy.capture.download', locale)}</a>
        {truncated && <span className="hint">{t('proxy.capture.preview', locale)}</span>}
      </div>
    );
  };
  const desensitized = request.rawRequestBody !== null && request.rawRequestBody !== request.requestBody;
  const desensitizedResponse = request.rawResponseBody !== null && request.rawResponseBody !== request.responseBody;
  const showContextDiff = tab === 'contextDiff' || contextDiffActivated;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <details className="capture-maintenance"><summary>{t('capture.maintenance', locale)}</summary>
      <OriginalDeletionControl id={request.id} requestId={request.requestId} locale={locale} monitorStopped={monitorStopped}
        supported={capture?.request != null && capture?.response != null} onAvailability={onAvailability} />
      <Suspense fallback={<Skeleton count={1} />}>
        <CaptureExportControl id={request.id} locale={locale} blocked={availability === 'loading'} metadataOnly={bodyHidden} />
        {!isWebSocket && <CaptureReparseControl id={request.id} requestId={request.requestId} locale={locale} blocked={bodyHidden} invalidateKey={traceInvalidateKey}
          onBegin={() => {
            bodyEpoch.current += 1; reparseBodyEpoch.current = bodyEpoch.current; analysisFromReparse.current = false;
            analysisReadCleanup.current?.(); setAnalysis(null); setAnalysisError(null); setAnalysisPending(false);
            setAnalysisPage(0); setAnalysisEvidence(null); setAnalysisActivated(false); setContextDiffActivated(false); setTab('request');
          }}
          onParsed={result => {
            if (availabilityNow.current !== 'available' || bodyHidden || reparseBodyEpoch.current !== bodyEpoch.current ||
              result.status.proxyId !== request.id || result.status.requestId !== request.requestId) return;
            // The user may have opened ordinary analysis while POST was still
            // pending. Cancel that newer read too, not just the one at begin.
            analysisReadCleanup.current?.(); bodyEpoch.current += 1;
            reparseBodyEpoch.current = null; analysisFromReparse.current = true;
            setAnalysis(result.analysis); setAnalysisError(null); setAnalysisPending(false); setAnalysisPage(0);
            setAnalysisActivated(true); setTab('analysis');
          }} />}
      </Suspense>
      </details>
      {bodyHidden && <p className="hint" role="status">{t(availability === 'loading' && !bodyBlocked ? 'proxy.deletion.checkingBody' : 'proxy.deletion.hidden', locale)}</p>}
      {capturePending && <Skeleton count={1} />}
      {captureError !== null && <DetailReadError code="CAPTURE_METADATA_FAILED" message={captureError} locale={locale} onRetry={() => setCaptureAttempt(attempt => attempt + 1)} />}
      {isWebSocket && <section aria-label={t('proxy.websocket.scope', locale)}>
        <h3>{t('proxy.websocket.scope', locale)}</h3><p className="hint">{t('proxy.websocket.notice', locale)}</p>
        {capture?.transport?.websocket !== undefined && <p className="mono">{t('proxy.websocket.counts', locale)}: {capture.transport.websocket.requestMessages} / {capture.transport.websocket.responseMessages}; {capture.transport.websocket.clientCloseCode ?? '—'} / {capture.transport.websocket.upstreamCloseCode ?? '—'}</p>}
      </section>}
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
          ...(!isWebSocket ? [{ id: 'analysis', label: t('proxy.analysis.title', locale) }] : []),
          ...(isWebSocket ? [{ id: 'codex', label: locale === 'zh' ? 'Codex 调用链路' : 'Codex call chain' }] : []),
          { id: 'traceLinks', label: t('trace.links.title', locale) },
          ...(!isWebSocket ? [{ id: 'contextDiff', label: t('proxy.contextDiff.title', locale) }, { id: 'comparison', label: t('proxy.comparison.title', locale) }] : []),
        ]}
      />
      {tab === 'codex' && isWebSocket && !bodyHidden && <Suspense fallback={<Skeleton count={2} />}>
        <CodexCallsPanel key={request.id + ':' + traceInvalidateKey} source={{ id: request.id }} locale={locale} onOpenSession={onOpenSession} invalidateKey={traceInvalidateKey} />
      </Suspense>}
      {tab === 'request' && !bodyHidden && (
        <div>
          {originalInfo('request')}
          {desensitized && <Badge tone="attention">{t('proxy.desensitized', locale)}</Badge>}
          <CaptureBodyText value={request.requestBody} locale={locale} />
        </div>
      )}
      {tab === 'response' && !bodyHidden && (
        <div>
          {originalInfo('response')}
          {desensitizedResponse && <Badge tone="attention">{t('proxy.desensitized', locale)}</Badge>}
          <CaptureBodyText value={request.responseBody} locale={locale} />
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
        <div><dl className="meta" style={{ flexDirection: 'column' }}>
          <dt>{t('proxy.time', locale)}</dt>
          <dd className="mono">{new Date(request.startedAt).toLocaleString()}</dd>
          <dt>{t('proxy.duration', locale)}</dt>
          <dd className="mono">{request.durationMs === null ? '—' : `${Math.round(request.durationMs)}ms`}</dd>
          <dt>capture</dt>
          <dd className="mono">{request.captureMethod}</dd>
        </dl>
        {!isWebSocket && !capturePending && captureError === null && <Suspense fallback={<Skeleton count={1} />}>
          <CaptureTimingPanel timing={capture?.transport?.timing} locale={locale} />
        </Suspense>}
        </div>
      )}
      {tab === 'analysis' && !bodyHidden && (
        <div ref={analysisRoot} className="capture-protocol-analysis" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {analysisError !== null && <DetailReadError code="PROTOCOL_ANALYSIS_FAILED" message={analysisError} locale={locale} onRetry={() => { analysisFromReparse.current = false; setAnalysisAttempt(attempt => attempt + 1); }} />}
          {analysisPending && <Skeleton count={3} />}
          {analysis !== null && (
            <>
              <p className="hint">{t('proxy.analysis.evidenceOnly', locale)}</p>
              <Suspense fallback={<Skeleton count={1} />}><ProxyInsights analysis={analysis} locale={locale} onInspect={inspectAnalysisEvidence} /></Suspense>
              <div className="meta"><span>{analysis.requestFormat}</span><span>{analysis.model ?? '—'}</span><Badge tone={analysis.state === 'completed' ? 'success' : 'attention'}>{analysis.state}</Badge><span>{analysis.stopReason ?? '—'}</span></div>
              {!analysis.completeness.complete && <p role="status">{t('proxy.analysis.partial', locale)}: {analysis.completeness.reasons.join(', ')}</p>}
              <dl className="meta">
                {(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'] as const).map(key => (
                  <div key={key}><dt>{key}</dt><dd className="mono">{analysis.usage[key] ?? '—'}</dd></div>
                ))}
              </dl>
              <p className="hint">{t('proxy.analysis.accounting', locale)}: {analysis.usage.accounting} · unknown events: {analysis.unknownEvents}</p>
              {analysis.system !== null && <details data-analysis-evidence="system" tabIndex={-1}><summary>System</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{analysis.system}</pre></details>}
              <details><summary>{t('proxy.analysis.declarations', locale)} ({analysis.declarations.length})</summary>{analysis.declarations.map((tool, index) => <pre key={index} data-analysis-evidence={'declaration-' + index} tabIndex={-1} style={{ whiteSpace: 'pre-wrap' }}>{tool.definition}</pre>)}</details>
              <details data-analysis-evidence="usage" tabIndex={-1}><summary>{t('proxy.analysis.nativeUsage', locale)}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(analysis.usage.snapshots, null, 2)}</pre></details>
              {analysis.errors.map((error, index) => <div key={index} data-analysis-evidence={'error-' + index} tabIndex={-1}><ErrorState code={error.code ?? 'PROTOCOL_ERROR'} message={error.message} /></div>)}
              {analysis.items.slice(analysisPage * 50, (analysisPage + 1) * 50).map((item, index) => (
                <details key={analysisPage * 50 + index} data-analysis-evidence={'item-' + (analysisPage * 50 + index)} tabIndex={-1}>
                  <summary>{item.phase === 'request' ? t('proxy.analysis.history', locale) : t('proxy.analysis.response', locale)} · {item.kind} · {item.name ?? item.callId ?? item.id ?? '—'} {!item.complete && '…'}</summary>
                  <p className="hint mono">{item.sourcePath}{item.callId !== null ? ' · callId=' + item.callId : ''}</p>
                  {typeof item.toolResultIsError === 'boolean' && <p className="hint mono">{item.sourcePath}.is_error = {String(item.toolResultIsError)} · {t('proxy.analysis.toolResultFlag', locale)}</p>}
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
      {tab === 'comparison' && availability !== 'loading' && <Suspense fallback={<Skeleton count={1} />}>
        <CaptureComparisonPanel targetId={request.id} locale={locale} loadedItems={loadedItems} onOpenRequest={onOpenRequest} invalidateKey={traceInvalidateKey} metadataOnly={bodyHidden} />
      </Suspense>}
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
