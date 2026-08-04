import { useEffect, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';

export interface FridaViewProps {
  locale: Locale;
}

/** REQ-008：Frida 控制 + 捕获列表（朴素版）。 */
export function FridaView({ locale }: FridaViewProps) {
  const [status, setStatus] = useState<{ running: boolean; pid: number | null } | null>(null);
  const [captures, setCaptures] = useState<Array<{ id: number; capturedAt: string; captureType: string; model: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    void Promise.all([api.fridaStatus(), api.fridaCaptures()])
      .then(([st, list]) => {
        setStatus(st);
        setCaptures(list.items);
        setError(null);
      })
      .catch((err: unknown) => {
        console.error('[frida] 加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [retryKey]);

  return (
    <section className="view">
      <h2>Frida</h2>
      {error !== null && (
        <ErrorState code="FRIDA_LOAD_FAILED" message={error} onRetry={() => setRetryKey((k) => k + 1)} />
      )}
      {error === null && status === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={3} />
        </div>
      )}
      {error === null && status !== null && captures.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('state.empty', locale)}
          description={t('state.empty', locale)}
        />
      )}
      <ul>
        {captures.map((c) => (
          <li key={c.id} className="proxy-row">
            <span className="mono">{c.captureType}</span>
            <span>{c.model ?? '-'}</span>
            <span>{c.capturedAt}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
