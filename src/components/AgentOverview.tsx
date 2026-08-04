import { useEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { AgentOverviewRow } from '../core/trace-types.js';
import { api, type AgentOverviewResponse } from '../api/client.js';

export interface AgentOverviewProps {
  locale: Locale;
  load?: () => Promise<AgentOverviewResponse>;
}

/** REQ-003：Agent 视图，1 个请求。 */
export function AgentOverview({ locale, load = () => api.agentOverview() }: AgentOverviewProps) {
  const [rows, setRows] = useState<AgentOverviewRow[] | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    void load()
      .then((result) => {
        setRows(result.rows);
        setCached(result.cached);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  if (error !== null) {
    return <p className="hint">{t('common.error', locale)}: {error}</p>;
  }
  if (rows === null) {
    return <p className="hint">{t('common.loading', locale)}</p>;
  }
  return (
    <section className="overview">
      <p className="hint">{cached ? 'cached' : 'fresh'}</p>
      <table>
        <thead>
          <tr>
            <th>{t('session.provider', locale)}</th>
            <th>{t('agent.sessions', locale)}</th>
            <th>{t('agent.events', locale)}</th>
            <th>{t('agent.tokens', locale)}</th>
            <th>{t('agent.cost', locale)}</th>
            <th>{t('agent.verification', locale)}</th>
            <th>{t('agent.errorRate', locale)}</th>
            <th>{t('agent.debugRate', locale)}</th>
            <th>{t('agent.toolDuration', locale)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.provider}/${row.sourceAgent}`}>
              <td>{row.provider} · {row.sourceAgent}</td>
              <td>{row.sessionCount}</td>
              <td>{row.eventCount}</td>
              <td>{row.tokenTotal}</td>
              <td>${row.costUsd.toFixed(3)}</td>
              <td>{row.verificationCoverage === null ? '-' : `${(row.verificationCoverage * 100).toFixed(0)}%`}</td>
              <td>{row.errorRate === null ? '-' : `${(row.errorRate * 100).toFixed(1)}%`}</td>
              <td>{row.debugEntryRate === null ? '-' : `${(row.debugEntryRate * 100).toFixed(1)}%`}</td>
              <td>{row.avgToolDurationMs === null ? '-' : `${row.avgToolDurationMs.toFixed(0)}ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
