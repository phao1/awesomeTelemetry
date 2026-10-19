import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProxyRequestListItem } from '../core/trace-types.js';
import { t, type Locale } from '../i18n.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { Badge } from './ui/Badge.js';

export interface CaptureRequestListProps {
  items: ProxyRequestListItem[];
  selected: number | null;
  pending: boolean;
  error: string | null;
  hasMore: boolean;
  locale: Locale;
  onOpen: (id: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onClear?: () => void;
  cleared?: boolean;
}

function statusTone(status: number | null): 'success' | 'neutral' | 'attention' | 'danger' {
  return status === null || status < 200 || status >= 300 && status < 400 ? 'neutral' : status < 300 ? 'success' : status < 500 ? 'attention' : 'danger';
}

function RequestRows({ items, selected, locale, onOpen }: Pick<CaptureRequestListProps, 'items' | 'selected' | 'locale' | 'onOpen'>): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(items.length, 28, 10, 360);
  return <div ref={containerRef} className="capture-request-scroll" role="region" tabIndex={0} aria-label={t('capture.requestRegion', locale)} onScroll={onScroll}>
    <table className="ui-table ui-table-compact proxy-table capture-request-table">
      <thead><tr><th>{t('proxy.method', locale)}</th><th>{t('capture.target', locale)}</th><th>{t('capture.modelProtocol', locale)}</th>
        <th>{t('proxy.statusCode', locale)}</th><th title={t('capture.durationBasis', locale)}>{t('capture.networkInterval', locale)}</th><th>{t('proxy.time', locale)}</th></tr></thead>
      <tbody>
        {range.offsetY > 0 && <tr aria-hidden="true"><td colSpan={6} className="capture-row-spacer" style={{ height: range.offsetY }} /></tr>}
        {items.slice(range.startIndex, range.endIndex).map(item => <tr key={item.id} className={'proxy-table-row' + (selected === item.id ? ' capture-request-selected' : '')}
          aria-selected={selected === item.id} onClick={() => onOpen(item.id)}>
          <td><Badge tone="neutral">{item.method}</Badge></td>
          <td className="capture-target-cell"><button type="button" className="capture-request-open" title={item.url}
            aria-label={t('capture.inspectRequest', locale) + ' #' + item.id + ' · ' + item.method + ' ' + item.url}>
            <strong>{item.hostname}</strong><span className="mono">{item.url}</span><span className="mono">#{item.id}</span>
          </button></td>
          <td className="capture-model-cell" title={(item.model ?? '—') + ' · ' + item.requestFormat}><span>{item.model ?? '—'}</span><span className="mono">{item.requestFormat}</span></td>
          <td><Badge tone={statusTone(item.responseStatus)}>{item.responseStatus ?? '—'}</Badge></td>
          <td className="mono" title={t('capture.durationBasis', locale)}>{item.durationMs === null ? '—' : Math.round(item.durationMs).toLocaleString() + 'ms'}</td>
          <td className="mono"><time dateTime={item.startedAt} title={item.startedAt}>{new Date(item.startedAt).toLocaleTimeString()}</time></td>
        </tr>)}
        {range.totalHeight > range.endIndex * 28 && <tr aria-hidden="true"><td colSpan={6} className="capture-row-spacer" style={{ height: range.totalHeight - range.endIndex * 28 }} /></tr>}
      </tbody>
    </table>
  </div>;
}

/** Loaded metadata only. Changing filters does not issue server/body requests. */
export function CaptureRequestList({ items, selected, pending, error, hasMore, locale, onOpen, onRefresh, onLoadMore, onRetry, onCancel, onClear, cleared = false }: CaptureRequestListProps): React.JSX.Element {
  const [query, setQuery] = useState(''), [method, setMethod] = useState(''), [status, setStatus] = useState('');
  const refreshButton = useRef<HTMLButtonElement>(null);
  const [clearActivation, setClearActivation] = useState(0);
  // Focus after the parent has released a cancelled page's disabled state.
  useLayoutEffect(() => { if (clearActivation > 0) refreshButton.current?.focus(); }, [clearActivation]);
  const deferred = useDeferredValue(query);
  const methods = useMemo(() => [...new Set([...items.map(item => item.method), ...(method === '' ? [] : [method])])].sort(), [items, method]);
  const filtered = useMemo(() => {
    const needle = deferred.trim().toLowerCase();
    return items.filter(item => (method === '' || item.method === method) && (status === '' || status === 'unknown' ? status === '' || item.responseStatus === null : item.responseStatus !== null && Math.floor(item.responseStatus / 100) + 'xx' === status) &&
      (needle === '' || [item.hostname, item.url, item.requestId, String(item.id), item.model ?? '', item.requestFormat].some(value => value.toLowerCase().includes(needle))));
  }, [items, method, status, deferred]);
  return <section className="capture-requests" aria-label={t('capture.savedRequests', locale)}>
    <div className="capture-toolbar"><h3>{t('capture.savedRequests', locale)}</h3><span className="mono">{filtered.length} / {items.length}</span>
      <button ref={refreshButton} type="button" className="btn ui-btn-sm" disabled={pending} onClick={onRefresh}>{t('capture.refreshList', locale)}</button>
      {onClear !== undefined && <button type="button" className="btn ui-btn-sm" disabled={items.length === 0} onClick={() => { onClear();setClearActivation(value => value + 1); }} title={t('capture.clearHint', locale)}>{t('proxy.clear', locale)}</button>}
      {pending && <button type="button" className="btn ui-btn-sm" onClick={onCancel}>{t('capture.cancelWaiting', locale)}</button>}</div>
    {cleared && <p className="hint" role="status">{t('capture.listCleared', locale)}</p>}
    <p className="hint">{t('capture.loadedScope', locale)}</p>
    <div className="capture-filters">
      <label>{t('capture.search', locale)}<input className="ui-input" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>{t('proxy.method', locale)}<select className="ui-select" value={method} onChange={event => setMethod(event.target.value)}><option value="">{t('capture.all', locale)}</option>{methods.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>{t('proxy.statusCode', locale)}<select className="ui-select" value={status} onChange={event => setStatus(event.target.value)}><option value="">{t('capture.all', locale)}</option>{['1xx', '2xx', '3xx', '4xx', '5xx'].map(value => <option key={value}>{value}</option>)}<option value="unknown">{t('capture.unknownStatus', locale)}</option></select></label>
      {(query !== '' || method !== '' || status !== '') && <button type="button" className="btn ui-btn-sm" onClick={() => { setQuery('');setMethod('');setStatus(''); }}>{t('capture.resetFilters', locale)}</button>}
    </div>
    {query !== deferred && <p className="hint" role="status">{t('capture.filtering', locale)}</p>}
    {error !== null && <div className="ui-error" role="alert"><code>PROXY_LIST_FAILED</code><p>{error}</p><button type="button" className="btn" disabled={pending} onClick={onRetry}>{t('common.retry', locale)}</button></div>}
    {pending && <p className="hint" role="status">{t('common.loading', locale)}</p>}
    {!pending && error === null && filtered.length === 0 && !(cleared && items.length === 0) && <p className="hint">{t(items.length === 0 ? 'capture.noSavedRequests' : 'capture.noFilterMatch', locale)}</p>}
    {filtered.length > 0 && <RequestRows key={JSON.stringify([deferred, method, status])} items={filtered} selected={selected} locale={locale} onOpen={onOpen} />}
    {hasMore && <button type="button" className="btn capture-more" disabled={pending} onClick={onLoadMore}>{t('capture.loadMore', locale)}</button>}
  </section>;
}
