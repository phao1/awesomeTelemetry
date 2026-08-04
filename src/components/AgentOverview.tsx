import { useEffect, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { AgentOverviewRow } from '../core/trace-types.js';
import { api, type AgentOverviewResponse } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';

export interface AgentOverviewProps {
  locale: Locale;
  load?: () => Promise<AgentOverviewResponse>;
}

/** REQ-003：Agent 视图，1 个请求。 */
export function AgentOverview({ locale, load = () => api.agentOverview() }: AgentOverviewProps) {
  const [rows, setRows] = useState<AgentOverviewRow[] | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setRows(null);
    setError(null);
    void load()
      .then((result) => {
        setRows(result.rows);
        setCached(result.cached);
      })
      .catch((err: unknown) => {
        console.error('[agent-overview] 加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [load, retryKey]);

  if (error !== null) {
    return <ErrorState code="OVERVIEW_LOAD_FAILED" message={error} onRetry={() => setRetryKey((k) => k + 1)} />;
  }
  if (rows === null) {
    return (
      <div style={{ padding: 'var(--space-3)' }}>
        <Skeleton variant="row" count={8} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('common.empty', locale)}
        description={t('state.empty', locale)}
      />
    );
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
