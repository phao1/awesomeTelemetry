import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { ProxyRequest, ProxyRequestListItem } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Drawer } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { Badge } from './ui/Badge.js';

export interface ProxyViewProps {
  locale: Locale;
}

interface ProxyStatus {
  running: boolean;
  starting: boolean;
  port: number | null;
  requestCount: number;
  startedAt: string | null;
}

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

/** REQ-020：代理视图。控制条 + 密排请求表 + 详情抽屉（8.4）。 */
export function ProxyView({ locale }: ProxyViewProps): React.JSX.Element {
  const [items, setItems] = useState<ProxyRequestListItem[]>([]);
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [port, setPort] = useState('');
  const [confirming, setConfirming] = useState<'stop' | 'clear' | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProxyRequest | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [methodFilter, setMethodFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([api.proxyRequests(), api.proxyStatus()]);
      setItems(list.items);
      setStatus(st);
      setError(null);
    } catch (err) {
      console.error('[proxy] 加载失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await api.proxyStop();
      setStatus((prev) => (prev === null ? prev : { ...prev, running: false, starting: false, port: null, startedAt: null }));
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
      setItems([]);
      setError(null);
    } catch (err) {
      console.error('[proxy] 清空失败:', err);
      setError(err instanceof Error ? err.message : String(err));
      console.error(t('proxy.notImplemented', locale));
    }
  }, [locale]);

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
    setSelected(id);
    setDetail(null);
    setDetailError(null);
    try {
      const request = await api.proxyRequest(id);
      setDetail(request);
    } catch (err) {
      console.error('[proxy] 详情加载失败:', err);
      setDetailError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const filtered = useMemo(
    () => (methodFilter === '' ? items : items.filter((item) => item.method === methodFilter)),
    [items, methodFilter],
  );

  const methods = useMemo(() => [...new Set(items.map((item) => item.method))].sort(), [items]);
  const running = status?.running === true;
  const starting = status?.starting === true;

  const statusLabel = starting
    ? t('proxy.status.starting', locale)
    : running
      ? `${t('proxy.status.running', locale)} :${status?.port ?? ''}`
      : t('proxy.status.stopped', locale);

  return (
    <section className="view" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="proxy-controlbar">
        <span className={`status-dot ${running ? 'status-success' : starting ? 'status-running' : 'status-unknown'}`} aria-hidden="true" />
        <span>{statusLabel}</span>
        {!running && (
          <>
            <input
              className="ui-input ui-btn-sm"
              style={{ width: 'var(--space-10)' }}
              placeholder={t('proxy.port', locale)}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
            />
            <button type="button" className="btn" onClick={() => void start()} disabled={starting}>
              {t('proxy.start', locale)}
            </button>
          </>
        )}
        {running && (
          <button type="button" className="btn ui-btn-danger" onClick={() => setConfirming('stop')}>
            {t('proxy.stop', locale)}
          </button>
        )}
        <button type="button" className="btn" onClick={() => void downloadCa()}>
          {t('proxy.downloadCa', locale)}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {t('proxy.caHint', locale)}
        </span>
        <span className="spacer" />
        <span className="mono">{status?.requestCount ?? 0} req</span>
        <button type="button" className="btn" onClick={() => setConfirming('clear')} disabled={items.length === 0}>
          {t('proxy.clear', locale)}
        </button>
        <button type="button" className="btn" onClick={() => void load()}>
          {t('common.refresh', locale)}
        </button>
      </div>
      {error !== null && <ErrorState code="PROXY_LOAD_FAILED" message={error} onRetry={() => void load()} />}
      {error === null && status === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={4} />
        </div>
      )}
      {error === null && status !== null && items.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('state.proxyNotRunning', locale)}
          description={t('proxy.caHint', locale)}
          action={
            <button type="button" className="btn" onClick={() => void start()} disabled={starting}>
              {t('proxy.start', locale)}
            </button>
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
                  <td className="mono">{item.durationMs === null ? '—' : `${item.durationMs}ms`}</td>
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
        onClose={() => setSelected(null)}
      >
        {detailError !== null && <ErrorState code="PROXY_DETAIL_FAILED" message={detailError} onRetry={() => selected !== null && void openDetail(selected)} />}
        {detail !== null && (
          <ProxyDetailDrawer request={detail} locale={locale} />
        )}
      </Drawer>
    </section>
  );
}

function ProxyDetailDrawer({
  request,
  locale,
}: {
  request: ProxyRequest;
  locale: Locale;
}): React.JSX.Element {
  const [tab, setTab] = useState<'request' | 'response' | 'headers' | 'timing'>('request');
  const desensitized = request.rawRequestBody !== null && request.rawRequestBody !== request.requestBody;
  const desensitizedResponse = request.rawResponseBody !== null && request.rawResponseBody !== request.responseBody;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Tabs
        variant="pill"
        activeId={tab}
        onChange={(id) => setTab(id as typeof tab)}
        items={[
          { id: 'request', label: t('proxy.request', locale) },
          { id: 'response', label: t('proxy.response', locale) },
          { id: 'headers', label: t('proxy.headers', locale) },
          { id: 'timing', label: t('proxy.timing', locale) },
        ]}
      />
      {tab === 'request' && (
        <div>
          {desensitized && <Badge tone="attention">{t('proxy.desensitized', locale)}</Badge>}
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--canvas-inset)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
            {request.requestBody ?? '—'}
          </pre>
        </div>
      )}
      {tab === 'response' && (
        <div>
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
          </tbody>
        </table>
      )}
      {tab === 'timing' && (
        <dl className="meta" style={{ flexDirection: 'column' }}>
          <dt>{t('proxy.time', locale)}</dt>
          <dd className="mono">{new Date(request.startedAt).toLocaleString()}</dd>
          <dt>{t('proxy.duration', locale)}</dt>
          <dd className="mono">{request.durationMs === null ? '—' : `${request.durationMs}ms`}</dd>
          <dt>capture</dt>
          <dd className="mono">{request.captureMethod}</dd>
        </dl>
      )}
    </div>
  );
}
