import { useEffect, useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { AgentOverviewRow, SessionIndexEntry } from '../core/trace-types.js';
import { api, type AgentOverviewResponse } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Table, type TableColumn } from './ui/Table.js';
import { BarMeter, MetricCard, Sparkline } from './ui/Misc.js';
import { ProviderBadge } from './ui/Badge.js';
import { IconAccuracy, IconCost, IconSpeed, IconStability } from './icons/index.js';

export interface AgentOverviewProps {
  locale: Locale;
  load?: () => Promise<AgentOverviewResponse>;
  /** REQ-018：展开行复用共享 store，MUST NOT 逐会话 fetch（G11.9）。 */
  sessions?: SessionIndexEntry[];
  onSelectSession?: (key: string) => void;
}

const fmtNum = (v: number): string => v.toLocaleString();

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(0)}%`;
}

/** REQ-018：Agent 概览。①KPI 行 ②可排序对比表（1 个请求，G11.9）。 */
export function AgentOverview({
  locale,
  load = () => api.agentOverview(),
  sessions = [],
  onSelectSession,
}: AgentOverviewProps): React.JSX.Element {
  const [rows, setRows] = useState<AgentOverviewRow[] | null>(null);
  const [cached, setCached] = useState(false);
  const [stamp, setStamp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    void load()
      .then((result) => {
        setRows(result.rows);
        setCached(result.cached);
        setStamp(result.stamp);
      })
      .catch((err: unknown) => {
        console.error('[agent-overview] 加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [load, retryKey]);

  const kpi = useMemo(() => {
    if (rows === null || rows.length === 0) {
      return null;
    }
    const n = rows.length;
    const totalCost = rows.reduce((sum, r) => sum + r.costUsd, 0);
    const totalTokens = rows.reduce((sum, r) => sum + r.tokenTotal, 0);
    const avgTool = rows.reduce((sum, r) => sum + (r.avgToolDurationMs ?? 0), 0) / n;
    const verify = rows.reduce((sum, r) => sum + (r.verificationCoverage ?? 0), 0) / n;
    const error = rows.reduce((sum, r) => sum + (r.errorRate ?? 0), 0) / n;
    const speedScore = avgTool > 0 ? 1000 / avgTool : null;
    return {
      speed: speedScore === null ? '—' : `${speedScore.toFixed(1)}`,
      speedUnit: 'tool/s',
      accuracy: pct(verify),
      accuracyUnit: '',
      stability: pct(1 - error),
      stabilityUnit: '',
      cost: `$${totalCost.toFixed(3)}`,
      costUnit: `${fmtNum(totalTokens)} tok`,
    };
  }, [rows]);

  const sortedRows = useMemo(() => {
    if (rows === null || sort === null) {
      return rows ?? [];
    }
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key as keyof AgentOverviewRow];
      const bv = b[sort.key as keyof AgentOverviewRow];
      const an = typeof av === 'number' ? av : Number(av ?? 0);
      const bn = typeof bv === 'number' ? bv : Number(bv ?? 0);
      return (an - bn) * direction;
    });
  }, [rows, sort]);

  const maxTokens = useMemo(
    () => Math.max(1, ...(rows ?? []).map((r) => r.tokenTotal)),
    [rows],
  );
  const maxCost = useMemo(
    () => Math.max(0.001, ...(rows ?? []).map((r) => r.costUsd)),
    [rows],
  );

  const recentByProvider = useMemo(() => {
    const map = new Map<string, SessionIndexEntry[]>();
    const sorted = [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    for (const session of sorted) {
      const list = map.get(session.provider) ?? [];
      if (list.length < 10) {
        list.push(session);
        map.set(session.provider, list);
      }
    }
    return map;
  }, [sessions]);

  const columns: Array<TableColumn<AgentOverviewRow>> = [
    {
      key: 'provider',
      label: t('session.provider', locale),
      sortable: true,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <ProviderBadge provider={row.provider} locale={locale} />
          <span>{row.provider}</span>
          <span style={{ color: 'var(--fg-subtle)' }}>{row.sourceAgent}</span>
        </span>
      ),
    },
    {
      key: 'sessionCount',
      label: t('agent.sessions', locale),
      sortable: true,
      align: 'right',
      render: (row) => <span className="mono">{fmtNum(row.sessionCount)}</span>,
    },
    {
      key: 'eventCount',
      label: t('agent.events', locale),
      sortable: true,
      align: 'right',
      render: (row) => {
        const spark = (recentByProvider.get(row.provider) ?? []).map((s) => s.eventCount);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="mono">{fmtNum(row.eventCount)}</span>
            {spark.length >= 2 && <Sparkline points={spark} width={64} height={16} />}
          </span>
        );
      },
    },
    {
      key: 'tokenTotal',
      label: t('agent.tokens', locale),
      sortable: true,
      align: 'right',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="mono">{fmtNum(row.tokenTotal)}</span>
          <BarMeter value={row.tokenTotal} max={maxTokens} tone="neutral" />
        </span>
      ),
    },
    {
      key: 'costUsd',
      label: t('agent.cost', locale),
      sortable: true,
      align: 'right',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="mono">${row.costUsd.toFixed(3)}</span>
          <BarMeter value={row.costUsd} max={maxCost} tone="attention" />
        </span>
      ),
    },
    {
      key: 'verificationCoverage',
      label: t('agent.verification', locale),
      sortable: true,
      align: 'right',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="mono">{pct(row.verificationCoverage)}</span>
          {row.verificationCoverage !== null && (
            <BarMeter value={row.verificationCoverage} max={1} tone="success" />
          )}
        </span>
      ),
    },
    {
      key: 'errorRate',
      label: t('agent.errorRate', locale),
      sortable: true,
      align: 'right',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="mono">{pct(row.errorRate)}</span>
          {row.errorRate !== null && <BarMeter value={row.errorRate} max={1} tone="danger" />}
        </span>
      ),
    },
    {
      key: 'debugEntryRate',
      label: t('agent.debugRate', locale),
      sortable: true,
      align: 'right',
      render: (row) => <span className="mono">{pct(row.debugEntryRate)}</span>,
    },
    {
      key: 'avgToolDurationMs',
      label: t('agent.toolDuration', locale),
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className="mono">{row.avgToolDurationMs === null ? '—' : `${row.avgToolDurationMs.toFixed(0)}ms`}</span>
      ),
    },
  ];

  if (error !== null) {
    return (
      <ErrorState code="OVERVIEW_LOAD_FAILED" message={error} onRetry={() => setRetryKey((k) => k + 1)} />
    );
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
    <section className="overview" style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="overview-kpis">
        {kpi !== null && (
          <>
            <MetricCard icon={<IconSpeed size={16} />} label={t('metric.speed', locale)} value={kpi.speed} unit={kpi.speedUnit} />
            <MetricCard icon={<IconAccuracy size={16} />} label={t('metric.accuracy', locale)} value={kpi.accuracy} unit="" />
            <MetricCard icon={<IconStability size={16} />} label={t('metric.stability', locale)} value={kpi.stability} unit="" />
            <MetricCard icon={<IconCost size={16} />} label={t('metric.cost', locale)} value={kpi.cost} unit={kpi.costUnit} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className="hint" style={{ margin: 0 }}>
          {cached ? 'cached' : 'fresh'} · {stamp ?? '—'}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn ui-btn-sm"
          onClick={() => {
            setRows(null);
            setRetryKey((k) => k + 1);
          }}
        >
          {t('common.refresh', locale)}
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <Table
          columns={columns}
          rows={sortedRows}
          density="compact"
          rowKey={(row) => `${row.provider}/${row.sourceAgent}`}
          sort={sort}
          onSort={(key) =>
            setSort((prev) =>
              prev?.key === key
                ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
                : { key, direction: 'asc' },
            )
          }
          renderExpand={(row) => (
            <tr key={`expand-${row.provider}`}>
              <td colSpan={columns.length}>
                <div className="overview-expand">
                  {(recentByProvider.get(row.provider) ?? []).length === 0 ? (
                    <span className="hint">{t('common.empty', locale)}</span>
                  ) : (
                    (recentByProvider.get(row.provider) ?? []).map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className="overview-expand-row"
                        onClick={() => onSelectSession?.(session.id)}
                      >
                        <span className="mono">{session.id.slice(0, 14)}</span>
                        <span>{session.title}</span>
                        <span className="mono">{session.eventCount} ev</span>
                      </button>
                    ))
                  )}
                </div>
              </td>
            </tr>
          )}
          expandedKey={expanded}
          onToggleExpand={(key) => setExpanded((prev) => (prev === key ? null : key))}
        />
      </div>
    </section>
  );
}
