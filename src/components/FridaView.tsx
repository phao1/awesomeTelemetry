import { useEffect, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { api } from '../api/client.js';

export interface FridaViewProps {
  locale: Locale;
}

/** REQ-008：Frida 控制 + 捕获列表（朴素版）。 */
export function FridaView({ locale }: FridaViewProps) {
  const [status, setStatus] = useState<{ running: boolean; pid: number | null } | null>(null);
  const [captures, setCaptures] = useState<Array<{ id: number; capturedAt: string; captureType: string; model: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api.fridaStatus(), api.fridaCaptures()])
      .then(([st, list]) => {
        setStatus(st);
        setCaptures(list.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className="view">
      <h2>Frida</h2>
      {error !== null && <p className="hint">{t('common.error', locale)}: {error}</p>}
      <p className="hint">
        {status === null
          ? t('common.loading', locale)
          : status.running
            ? `running pid=${status.pid}`
            : 'stopped'}
      </p>
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
