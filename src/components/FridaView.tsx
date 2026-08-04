import { useCallback, useEffect, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';

export interface FridaViewProps {
  locale: Locale;
}

interface FridaStatus {
  running: boolean;
  starting: boolean;
  pid: number | null;
}

/** REQ-021：Frida 视图。控制条 + 捕获列表 + 前置条件说明。 */
export function FridaView({ locale }: FridaViewProps): React.JSX.Element {
  const [status, setStatus] = useState<FridaStatus | null>(null);
  const [captures, setCaptures] = useState<Array<{ id: number; capturedAt: string; captureType: string; model: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pid, setPid] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([api.fridaStatus(), api.fridaCaptures()]);
      setStatus(st);
      setCaptures(list.items);
      setError(null);
    } catch (err) {
      console.error('[frida] 加载失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, retryKey]);

  const start = useCallback(async () => {
    const target = pid === '' ? undefined : Number(pid);
    try {
      const next = await api.fridaStart(target);
      setStatus(next);
      setError(null);
      void load();
    } catch (err) {
      console.error('[frida] 启动失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pid, load]);

  const stop = useCallback(async () => {
    try {
      await api.fridaStop();
      setStatus((prev) => (prev === null ? prev : { ...prev, running: false, starting: false, pid: null }));
    } catch (err) {
      console.error('[frida] 停止失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const running = status?.running === true;
  return (
    <section className="view" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
      <div className="proxy-controlbar">
        <span className={`status-dot ${running ? 'status-success' : 'status-unknown'}`} aria-hidden="true" />
        <span>
          {running
            ? `${t('frida.status.running', locale)} pid=${status?.pid ?? '—'}`
            : t('frida.status.stopped', locale)}
        </span>
        <input
          className="ui-input ui-btn-sm"
          style={{ width: 'var(--space-10)' }}
          placeholder={t('frida.pid', locale)}
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          inputMode="numeric"
          disabled={running}
        />
        {running ? (
          <button type="button" className="btn ui-btn-danger" onClick={() => void stop()}>
            {t('frida.stop', locale)}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void start()}>
            {t('frida.start', locale)}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => void load()}>
          {t('common.refresh', locale)}
        </button>
      </div>
      {error !== null && <ErrorState code="FRIDA_LOAD_FAILED" message={error} onRetry={() => setRetryKey((k) => k + 1)} />}
      {error === null && status === null && (
        <div>
          <Skeleton variant="row" count={3} />
        </div>
      )}
      {error === null && status !== null && captures.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('frida.prereq', locale)}
          description={t('frida.prereqHint', locale)}
        />
      )}
      {captures.length > 0 && (
        <table className="ui-table ui-table-compact">
          <thead>
            <tr>
              <th>type</th>
              <th>model</th>
              <th>{t('proxy.time', locale)}</th>
            </tr>
          </thead>
          <tbody>
            {captures.map((capture) => (
              <tr key={capture.id}>
                <td className="mono">{capture.captureType}</td>
                <td className="mono">{capture.model ?? '—'}</td>
                <td className="mono">{new Date(capture.capturedAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
