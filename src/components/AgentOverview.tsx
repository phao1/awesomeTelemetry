import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  AgentOverviewRow,
  ProviderKey,
  SessionIndexEntry,
  TracePhase,
} from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import { api, type AgentOverviewResponse } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Table, type TableColumn } from './ui/Table.js';
import { BarMeter, MetricCard, Sparkline } from './ui/Misc.js';
import { ProviderBadge } from './ui/Badge.js';
import {
  IconAccuracy,
  IconCompare,
  IconCost,
  IconSpeed,
  IconStability,
} from './icons/index.js';
import { fmtDur } from '../core/session-findings.js';

export interface AgentOverviewProps {
  locale: Locale;
  load?: () => Promise<AgentOverviewResponse>;
  /** REQ-018：展开行复用共享 store，MUST NOT 逐会话 fetch（G11.9）。 */
  sessions?: SessionIndexEntry[];
  onSelectSession?: (key: string) => void;
  /** 勾选两个 Agent 后快捷对比（App 负责跳转对比视图）。 */
  onCompareProviders?: (left: ProviderKey, right: ProviderKey) => void;
}

/** REQ-107 / G-UI-5：视图模式持久化 key（新前缀）。 */
export const AGENT_VIEW_KEY = 'awesome-telemetry.agentViewMode';

const fmtNum = (v: number): string => v.toLocaleString();

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(0)}%`;
}

function readViewMode(): 'table' | 'cards' {
  try {
    return localStorage.getItem(AGENT_VIEW_KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

/** 建议 4：堆叠 Phase 条 —— 6 段对应 6 个 Phase 颜色，宽度 = 各阶段耗时占比。 */
function PhaseStackBar({
  durations,
  locale,
}: {
  durations: Record<TracePhase, number>;
  locale: Locale;
}): React.JSX.Element {
  const total = TRACE_PHASES.reduce((sum, phase) => sum + durations[phase], 0);
  if (total <= 0) {
    return <div className="agent-phase-stack agent-phase-stack-empty" aria-hidden="true" />;
  }
  return (
    <div
      className="agent-phase-stack"
      role="img"
      aria-label={t('agent.phaseDist', locale)}
    >
      {TRACE_PHASES.map((phase) => {
        const ms = durations[phase];
        if (ms <= 0) {
          return null;
        }
        return (
          <div
            key={phase}
            className="agent-phase-stack-seg"
            style={{ width: `${(ms / total) * 100}%`, background: `var(--phase-${phase})` }}
            title={`${t(`phase.${phase}`, locale)} · ${(ms / 1000).toFixed(1)}s`}
          />
        );
      })}
    </div>
  );
}

/** REQ-018：Agent 概览。①KPI 行 ②可排序对比表（1 个请求，G11.9）。 */
export function AgentOverview({
  locale,
  load,
  sessions = [],
  onSelectSession,
  onCompareProviders,
}: AgentOverviewProps): React.JSX.Element {
  const defaultLoad = useCallback((): Promise<AgentOverviewResponse> => api.agentOverview(), []);
  const loader = load ?? defaultLoad;
  const [rows, setRows] = useState<AgentOverviewRow[] | null>(null);
  const [cached, setCached] = useState(false);
  const [stamp, setStamp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(readViewMode);

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_VIEW_KEY, viewMode);
    } catch {
      return;
    }
  }, [viewMode]);

  useEffect(() => {
    setRows(null);
    setError(null);
    void loader()
      .then((result) => {
        setRows(result.rows);
        setCached(result.cached);
        setStamp(result.stamp);
      })
      .catch((err: unknown) => {
        console.error('[agent-overview] 加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [loader, retryKey]);

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

  // ui-design-v2 §4.1：顶部结论条 —— 最快 / 最省 / 最稳。
  const conclusion = useMemo(() => {
    if (rows === null || rows.length === 0) {
      return null;
    }
    const withDuration = rows.filter((r) => r.avgWallClockMs > 0);
    const fastest =
      withDuration.length > 0
        ? withDuration.reduce((a, b) => (a.avgWallClockMs < b.avgWallClockMs ? a : b))
        : null;
    const slowest =
      withDuration.length > 0
        ? withDuration.reduce((a, b) => (a.avgWallClockMs > b.avgWallClockMs ? a : b))
        : null;
    const perSessionTokens = rows
      .filter((r) => r.sessionCount > 0 && r.tokenTotal > 0)
      .map((r) => ({ row: r, per: r.tokenTotal / r.sessionCount }));
    const frugal =
      perSessionTokens.length > 0
        ? perSessionTokens.reduce((a, b) => (a.per < b.per ? a : b))
        : null;
    const stable = rows.reduce((a, b) => ((a.errorRate ?? 1) < (b.errorRate ?? 1) ? a : b));
    return {
      fastest,
      slowest,
      fastestRatio: fastest !== null && slowest !== null && fastest.avgWallClockMs > 0 ? slowest.avgWallClockMs / fastest.avgWallClockMs : null,
      frugal: frugal?.row ?? null,
      frugalPer: frugal?.per ?? 0,
      stable,
    };
  }, [rows]);

  const sortChips: Array<{ key: keyof AgentOverviewRow; label: string; direction: 'asc' | 'desc' }> = [
    { key: 'avgToolDurationMs', label: t('agent.sortDuration', locale), direction: 'asc' },
    { key: 'tokenTotal', label: t('agent.sortTokens', locale), direction: 'desc' },
    { key: 'errorRate', label: t('agent.sortError', locale), direction: 'asc' },
    { key: 'verificationCoverage', label: t('agent.sortVerify', locale), direction: 'desc' },
  ];

  const toggleCompare = (key: string): void => {
    setCompareSelection((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      }
      if (prev.length >= 2) {
        return [...prev.slice(1), key];
      }
      return [...prev, key];
    });
  };

  const runCompare = (): void => {
    if (compareSelection.length !== 2 || rows === null || onCompareProviders === undefined) {
      return;
    }
    const providers = compareSelection.map((key) => rows.find((r) => `${r.provider}/${r.sourceAgent}` === key));
    if (providers[0] !== undefined && providers[1] !== undefined) {
      onCompareProviders(providers[0].provider, providers[1].provider);
    }
  };

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
      key: 'compare',
      label: '',
      sortable: false,
      width: 'var(--control-height-sm)',
      render: (row) => {
        const key = `${row.provider}/${row.sourceAgent}`;
        const checked = compareSelection.includes(key);
        return (
          <input
            type="checkbox"
            aria-label={t('compare.left', locale)}
            checked={checked}
            onChange={() => toggleCompare(key)}
            onClick={(e) => e.stopPropagation()}
          />
        );
      },
    },
    {
      key: 'provider',
      label: t('session.provider', locale),
      sortable: true,
      render: (row) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 140 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ProviderBadge provider={row.provider} locale={locale} />
            <span>{row.provider}</span>
            <span style={{ color: 'var(--fg-muted)' }}>{row.sourceAgent}</span>
          </span>
          <PhaseStackBar durations={row.durationByPhase} locale={locale} />
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

  /** REQ-107 + REQ-118：卡片网格视图 —— compare 复选框 + ProviderBadge + agent 名 +
   * 会话数 + 堆叠 Phase 条 + 6 指标 + Phase 分解。选中态与表格视图共享同一 state。 */
  const cardGrid = (
    <div className="agent-card-grid">
      {sortedRows.map((row) => {
        const compareKey = `${row.provider}/${row.sourceAgent}`;
        const metrics: Array<{ label: string; value: string }> = [
          { label: t('agent.sessions', locale), value: fmtNum(row.sessionCount) },
          { label: t('agent.tokens', locale), value: fmtNum(row.tokenTotal) },
          { label: t('agent.cost', locale), value: `$${row.costUsd.toFixed(3)}` },
          { label: t('agent.avgDuration', locale), value: row.avgWallClockMs > 0 ? fmtDur(row.avgWallClockMs) : '—' },
          { label: t('agent.verification', locale), value: pct(row.verificationCoverage) },
          { label: t('agent.errorRate', locale), value: pct(row.errorRate) },
        ];
        return (
          <article
            key={compareKey}
            className={`agent-card ${compareSelection.includes(compareKey) ? 'agent-card-on' : ''}`}
          >
            <header className="agent-card-head">
              <input
                type="checkbox"
                className="agent-card-compare"
                aria-label={`${t('compare.left', locale)} ${compareKey}`}
                checked={compareSelection.includes(compareKey)}
                onChange={() => toggleCompare(compareKey)}
              />
              <ProviderBadge provider={row.provider} locale={locale} />
              <span className="agent-card-name">{row.sourceAgent || row.provider}</span>
              <span className="mono agent-card-provider">{row.provider}</span>
              <span className="mono agent-card-count">{fmtNum(row.sessionCount)} {t('agent.sessions', locale)}</span>
            </header>
            <PhaseStackBar durations={row.durationByPhase} locale={locale} />
            <dl className="agent-card-metrics">
              {metrics.map((metric) => (
                <div key={metric.label} className="agent-card-metric">
                  <dt>{metric.label}</dt>
                  <dd className="mono">{metric.value}</dd>
                </div>
              ))}
            </dl>
            <details className="agent-card-phases">
              <summary>{t('agent.phaseBreakdown', locale)}</summary>
              <ul className="agent-card-phase-list">
                {TRACE_PHASES.map((phase) => {
                  const ms = row.durationByPhase[phase];
                  if (ms <= 0) {
                    return null;
                  }
                  return (
                    <li key={phase}>
                      <span className="agent-card-phase-dot" style={{ background: `var(--phase-${phase})` }} aria-hidden="true" />
                      <span>{t(`phase.${phase}`, locale)}</span>
                      <span className="mono">{fmtDur(ms)}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          </article>
        );
      })}
    </div>
  );

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
      {conclusion !== null && (
        <div className="agent-conclusion">
          <span className="agent-conclusion-title">
            {rows!.length} {t('agent.sessions', locale)} · {t('agent.conclusion', locale)}
          </span>
          <div className="agent-conclusion-items">
            {conclusion.fastest !== null && (
              <div className="agent-conclusion-item">
                <span className="agent-conclusion-label">{t('agent.fastest', locale)}</span>
                <ProviderBadge provider={conclusion.fastest.provider} locale={locale} />
                <span className="agent-conclusion-name">{conclusion.fastest.sourceAgent || conclusion.fastest.provider}</span>
                <span className="mono agent-conclusion-detail">
                  {conclusion.fastestRatio !== null
                    ? t('agent.fastestDetail', locale)
                        .replace('{dur}', fmtDur(conclusion.fastest.avgWallClockMs))
                        .replace('{ratio}', conclusion.fastestRatio.toFixed(1))
                    : fmtDur(conclusion.fastest.avgWallClockMs)}
                </span>
              </div>
            )}
            {conclusion.frugal !== null && (
              <div className="agent-conclusion-item">
                <span className="agent-conclusion-label">{t('agent.frugal', locale)}</span>
                <ProviderBadge provider={conclusion.frugal.provider} locale={locale} />
                <span className="agent-conclusion-name">{conclusion.frugal.sourceAgent || conclusion.frugal.provider}</span>
                <span className="mono agent-conclusion-detail">
                  {t('agent.frugalDetail', locale).replace('{n}', Math.round(conclusion.frugalPer).toLocaleString())}
                </span>
              </div>
            )}
            <div className="agent-conclusion-item">
              <span className="agent-conclusion-label">{t('agent.stable', locale)}</span>
              <ProviderBadge provider={conclusion.stable.provider} locale={locale} />
              <span className="agent-conclusion-name">{conclusion.stable.sourceAgent || conclusion.stable.provider}</span>
              <span className="mono agent-conclusion-detail">
                {t('agent.stableDetail', locale).replace('{pct}', ((conclusion.stable.errorRate ?? 0) * 100).toFixed(1))}
              </span>
            </div>
          </div>
        </div>
      )}
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
        <div className="agent-view-toggle" role="group" aria-label={t('agent.viewMode', locale)}>
          <button
            type="button"
            className={`timeline-chip ${viewMode === 'table' ? 'timeline-chip-on' : ''}`}
            aria-pressed={viewMode === 'table'}
            onClick={() => setViewMode('table')}
          >
            {t('agent.viewTable', locale)}
          </button>
          <button
            type="button"
            className={`timeline-chip ${viewMode === 'cards' ? 'timeline-chip-on' : ''}`}
            aria-pressed={viewMode === 'cards'}
            onClick={() => setViewMode('cards')}
          >
            {t('agent.viewCards', locale)}
          </button>
        </div>
        {sortChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={`timeline-chip ${sort?.key === chip.key ? 'timeline-chip-on' : ''}`}
            onClick={() => setSort({ key: chip.key, direction: chip.direction })}
          >
            {chip.label}
          </button>
        ))}
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
      {viewMode === 'table' ? (
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
                    <PhaseStackBar durations={row.durationByPhase} locale={locale} />
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
      ) : (
        cardGrid
      )}
      {compareSelection.length === 2 && onCompareProviders !== undefined && (
        <button type="button" className="compare-float-btn" onClick={runCompare}>
          <IconCompare size={16} />
          {t('agent.compareSelected', locale)}
        </button>
      )}
    </section>
  );
}
