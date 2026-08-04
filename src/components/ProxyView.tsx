import { useCallback, useEffect, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { ProxyRequestListItem } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';

export interface ProxyViewProps {
  locale: Locale;
}

/** REQ-013：proxy 独立视图。 */
export function ProxyView({ locale }: ProxyViewProps) {
  const [items, setItems] = useState<ProxyRequestListItem[]>([]);
  const [status, setStatus] = useState<{ running: boolean; requestCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="view">
      <div className="view-toolbar">
        <span className="hint">
          {status?.running === true ? t('live.connected', locale) : 'proxy: stopped'} · {status?.requestCount ?? 0}
        </span>
        <button type="button" className="btn" onClick={() => void load()}>
          {t('common.refresh', locale)}
        </button>
      </div>
      {error !== null && (
        <ErrorState code="PROXY_LOAD_FAILED" message={error} onRetry={() => void load()} />
      )}
      {error === null && status === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={4} />
        </div>
      )}
      <ul className="proxy-list">
        {items.map((item) => (
          <li key={item.id} className="proxy-row">
            <span className="mono">{item.method}</span>
            <span className="proxy-url">{item.url}</span>
            <span>{item.responseStatus ?? '-'}</span>
            <span>{item.durationMs ?? '-'}ms</span>
            <span>{item.startedAt}</span>
          </li>
        ))}
      </ul>
      {error === null && status !== null && items.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('state.proxyNotRunning', locale)}
          description={t('state.empty', locale)}
        />
      )}
    </section>
  );
}
