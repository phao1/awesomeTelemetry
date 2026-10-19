import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t, type Locale, type I18nKey } from '../i18n.js';
import type { AgentOverviewRow, ProviderKey, SessionIndexEntry, TracePhase } from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import { api, ApiError, type AgentOverviewResponse } from '../api/client.js';
import { EmptyState, Skeleton } from './ui/States.js';
import { Table, type TableColumn } from './ui/Table.js';
import { BarMeter, MetricCard, Sparkline } from './ui/Misc.js';
import { ProviderBadge } from './ui/Badge.js';
import { IconAgents, IconCompare, IconCost, IconMessage, IconSessions } from './icons/index.js';
import { fmtDur } from '../core/session-findings.js';
import { groupRecentOverviewSessions, overviewGroupKey, overviewTotals, sortOverviewRows, type OverviewSort } from './agent-overview-model.js';

export interface AgentOverviewProps {
  locale: Locale;
  load?: (signal?: AbortSignal) => Promise<AgentOverviewResponse>;
  /** REQ-018: only reuse the shared, possibly filtered/paged index. */
  sessions?: SessionIndexEntry[];
  onSelectSession?: (key: string) => void;
  onBrowseSessions?: (provider?: ProviderKey) => void;
  onCompareProviders?: (left: ProviderKey, right: ProviderKey, sourceAgents: readonly [string, string]) => void;
}

export const AGENT_VIEW_KEY = 'awesome-telemetry.agentViewMode';
const fmtNum = (value: number): string => value.toLocaleString();
const pct = (value: number | null): string => value === null ? '—' : (value * 100).toFixed(1) + '%';
const duration = (value: number | null): string => value === null ? '—' : fmtDur(value);
const name = (row: AgentOverviewRow): string => row.sourceAgent || row.provider;

function readViewMode(): 'table' | 'cards' {
  try { return localStorage.getItem(AGENT_VIEW_KEY) === 'cards' ? 'cards' : 'table'; }
  catch { return 'table'; }
}

function PhaseStackBar({ durations, locale }: { durations: Record<TracePhase, number>; locale: Locale }): React.JSX.Element {
  const total = TRACE_PHASES.reduce((sum, phase) => sum + durations[phase], 0);
  if (total <= 0) return <div className="agent-phase-stack agent-phase-stack-empty" aria-hidden="true" />;
  const description = TRACE_PHASES.filter(phase => durations[phase] > 0)
    .map(phase => t(`phase.${phase}`, locale) + ': ' + fmtDur(durations[phase])).join(' · ');
  return <div className="agent-phase-stack" role="img" aria-label={t('agent.phaseDist', locale) + ': ' + description}>
    {TRACE_PHASES.filter(phase => durations[phase] > 0).map(phase => <div key={phase} className="agent-phase-stack-seg"
      style={{ width: (durations[phase] / total) * 100 + '%', background: 'var(--phase-' + phase + ')' }}
      title={t(`phase.${phase}`, locale) + ' · ' + fmtDur(durations[phase])} />)}
  </div>;
}

function PhaseDetails({ row, locale }: { row: AgentOverviewRow; locale: Locale }): React.JSX.Element {
  return <details className="agent-card-phases">
    <summary>{t('agent.phaseBreakdown', locale)}</summary>
    <p className="hint">{t('agent.phaseBasis', locale)}</p>
    <ul className="agent-card-phase-list">
      {TRACE_PHASES.map(phase => <li key={phase}>
        <span className="agent-card-phase-dot" style={{ background: 'var(--phase-' + phase + ')' }} aria-hidden="true" />
        <span>{t(`phase.${phase}`, locale)}</span><span className="mono">{fmtDur(row.durationByPhase[phase])}</span>
      </li>)}
    </ul>
  </details>;
}

function RecentSessions({ row, recent, locale, onSelectSession, onBrowseSessions }: {
  row: AgentOverviewRow; recent: SessionIndexEntry[]; locale: Locale;
  onSelectSession: AgentOverviewProps['onSelectSession']; onBrowseSessions: AgentOverviewProps['onBrowseSessions'];
}): React.JSX.Element {
  return <div className="overview-expand">
    <h3>{t('agent.recentLoaded', locale)} · {recent.length} / {fmtNum(row.sessionCount)}</h3>
    <p className="hint">{t('agent.indexScope', locale)}</p>
    {recent.length === 0 ? <p className="hint">{t('agent.noLoadedMatch', locale)}</p> : recent.map(session =>
      <button key={session.id} type="button" className="overview-expand-row" disabled={onSelectSession === undefined}
        onClick={() => onSelectSession?.(session.id)}>
        <span className="overview-session-title">{session.title || session.id}<span className="mono hint">{session.id}</span></span>
        <time className="mono hint" dateTime={session.startedAt}>{session.startedAt.slice(0, 16).replace('T', ' ')} UTC</time>
        <span className="mono">{fmtNum(session.eventCount)} {t('agent.events', locale)}</span>
      </button>)}
    {onBrowseSessions !== undefined && <button type="button" className="btn ui-btn-sm"
      onClick={() => onBrowseSessions(row.provider)}>{t('agent.browseProvider', locale)} · {row.provider}</button>}
  </div>;
}

/** REQ-003/018: one aggregation read, no per-session fan-out. */
export function AgentOverview({ locale, load, sessions = [], onSelectSession, onBrowseSessions, onCompareProviders }: AgentOverviewProps): React.JSX.Element {
  const defaultLoad = useCallback((signal?: AbortSignal) => api.agentOverview('scan', signal), []);
  const loader = load ?? defaultLoad;
  const [snapshot, setSnapshot] = useState<AgentOverviewResponse | null>(null);
  const [error, setError] = useState<{ code: string; key: I18nKey; detail?: string } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [sort, setSort] = useState<OverviewSort | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(readViewMode);
  const cancelRead = useRef<(() => void) | null>(null);

  useEffect(() => {
    try { localStorage.setItem(AGENT_VIEW_KEY, viewMode); } catch { return; }
  }, [viewMode]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSnapshot(null);
    setError(null);
    const fail = (failure: { code: string; key: I18nKey; detail?: string }): void => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      controller.abort();
      setError(failure);
    };
    const timer = setTimeout(() => {
      if (active) console.error('[agent-overview] read timed out after 5000ms');
      fail({ code: 'OVERVIEW_TIMEOUT', key: 'agent.timeout' });
    }, 5000);
    cancelRead.current = () => fail({ code: 'OVERVIEW_CANCELLED', key: 'agent.cancelled' });
    void (async () => {
      try {
        const result = await loader(controller.signal);
        if (!active) return;
        if (result === null || !Array.isArray(result.rows) || typeof result.stamp !== 'string' || typeof result.cached !== 'boolean') {
          throw new Error('Invalid overview response');
        }
        active = false;
        clearTimeout(timer);
        setSnapshot(result);
        const valid = new Set(result.rows.map(overviewGroupKey));
        setCompareSelection(selected => selected.filter(key => valid.has(key)));
        setExpanded(key => key !== null && valid.has(key) ? key : null);
      } catch (cause: unknown) {
        if (!active) return;
        console.error('[agent-overview] load failed:', cause);
        fail({ code: cause instanceof ApiError ? cause.code : 'OVERVIEW_LOAD_FAILED', key: 'agent.loadFailed', detail: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); cancelRead.current = null; };
  }, [loader, retryKey]);

  const rows = snapshot?.rows ?? [];
  const totals = useMemo(() => overviewTotals(snapshot?.rows ?? []), [snapshot]);
  const sortedRows = useMemo(() => sortOverviewRows(snapshot?.rows ?? [], sort), [snapshot, sort]);
  const recentByGroup = useMemo(() => groupRecentOverviewSessions(snapshot?.rows ?? [], sessions), [snapshot, sessions]);
  const maxTokens = Math.max(1, ...rows.map(row => row.tokenTotal));
  const recent = (row: AgentOverviewRow): SessionIndexEntry[] => recentByGroup.get(overviewGroupKey(row)) ?? [];
  const toggleCompare = (key: string): void => setCompareSelection(selected => selected.includes(key) ? selected.filter(item => item !== key) : [...selected.slice(-1), key]);
  const toggleExpand = (key: string): void => setExpanded(previous => previous === key ? null : key);
  const selectionName = (row: AgentOverviewRow): string => t('agent.selectGroup', locale) + ' ' + name(row) + ' · ' + row.provider;
  const expandName = (row: AgentOverviewRow): string => t('agent.recentLoaded', locale) + ' · ' + name(row) + ' · ' + row.provider;
  const renderRecent = (row: AgentOverviewRow): React.JSX.Element => <RecentSessions row={row} recent={recent(row)} locale={locale}
    onSelectSession={onSelectSession} onBrowseSessions={onBrowseSessions} />;
  const ratio = (value: number | null): React.JSX.Element => <span className="agent-number-meter">
    <span className="mono">{pct(value)}</span>{value !== null && <BarMeter value={value} max={1} tone="neutral" />}
  </span>;

  const columns: Array<TableColumn<AgentOverviewRow>> = [
    { key: 'compare', label: t('agent.selectColumn', locale), render: row => <input type="checkbox" aria-label={selectionName(row)}
      checked={compareSelection.includes(overviewGroupKey(row))} onChange={() => toggleCompare(overviewGroupKey(row))} /> },
    { key: 'provider', label: t('session.provider', locale), sortable: true, render: row => <div className="agent-provider-cell">
      <span><ProviderBadge provider={row.provider} locale={locale} /> <strong>{name(row)}</strong></span>
      <span className="mono hint">{row.provider}</span><PhaseStackBar durations={row.durationByPhase} locale={locale} />
    </div> },
    { key: 'sessionCount', label: t('agent.sessions', locale), sortable: true, align: 'right', render: row => <span className="mono">{fmtNum(row.sessionCount)}</span> },
    { key: 'eventCount', label: t('agent.events', locale), sortable: true, align: 'right', render: row => {
      const buckets = new Map<string, number>();
      for (const session of [...recent(row)].reverse()) {
        const day = session.startedAt.slice(0, 10);
        buckets.set(day, (buckets.get(day) ?? 0) + session.eventCount);
      }
      return <span className="agent-number-meter"><span className="mono">{fmtNum(row.eventCount)}</span>
        {buckets.size > 1 && <span title={t('agent.sparkScope', locale)}><Sparkline points={[...buckets.values()]} width={64} height={16} label={t('agent.sparkScope', locale)} /></span>}
      </span>;
    } },
    { key: 'tokenTotal', label: t('agent.tokens', locale), sortable: true, align: 'right', render: row => <span className="agent-number-meter">
      <span className="mono">{fmtNum(row.tokenTotal)}</span><BarMeter value={row.tokenTotal} max={maxTokens} tone="neutral" />
    </span> },
    { key: 'verificationCoverage', label: t('agent.verification', locale), sortable: true, align: 'right', render: row => ratio(row.verificationCoverage) },
    { key: 'errorRate', label: t('agent.errorRate', locale), sortable: true, align: 'right', render: row => ratio(row.errorRate) },
    { key: 'debugEntryRate', label: t('agent.debugRate', locale), sortable: true, align: 'right', render: row => <span className="mono">{pct(row.debugEntryRate)}</span> },
    { key: 'avgToolDurationMs', label: t('agent.toolDuration', locale), sortable: true, align: 'right', render: row => <span className="mono">{duration(row.avgToolDurationMs)}</span> },
  ];

  const retry = <button type="button" className="btn ui-btn-sm" onClick={() => setRetryKey(key => key + 1)}>{t('common.retry', locale)}</button>;
  if (error !== null) return <section className="overview"><div className="ui-error" role="alert">
    <code>{error.code}</code><p>{t(error.key, locale)}</p>{error.detail !== undefined && <p>{error.detail}</p>}{retry}
  </div></section>;
  if (snapshot === null) return <section className="overview" aria-label={t('view.agent', locale)}>
    <Skeleton variant="row" count={8} /><button type="button" className="btn ui-btn-sm" onClick={() => cancelRead.current?.()}>{t('agent.cancelWaiting', locale)}</button>
  </section>;
  if (rows.length === 0) return <section className="overview"><EmptyState icon={<IconAgents />} title={t('agent.emptyTitle', locale)}
    description={t('agent.emptyDescription', locale)} action={<div className="agent-toolbar">{retry}{onBrowseSessions !== undefined &&
      <button type="button" className="btn ui-btn-sm" onClick={() => onBrowseSessions()}>{t('agent.browseSessions', locale)}</button>}</div>} /></section>;

  return <section className={'overview overview-' + viewMode} aria-label={t('view.agent', locale)}>
    <header className="agent-overview-header">
      <div><h2>{t('view.agent', locale)}</h2><p className="hint">{t('agent.scope', locale)}</p></div>
      <button type="button" className="btn ui-btn-sm" onClick={() => { setSnapshot(null); setRetryKey(key => key + 1); }}>{t('common.refresh', locale)}</button>
    </header>
    <div className="overview-kpis">
      <MetricCard icon={<IconSessions />} label={t('agent.sessions', locale)} value={fmtNum(totals.sessions)} tone="neutral" />
      <MetricCard icon={<IconAgents />} label={t('agent.groups', locale)} value={fmtNum(totals.groups)} tone="neutral" />
      <MetricCard icon={<IconMessage />} label={t('agent.events', locale)} value={fmtNum(totals.events)} tone="neutral" />
      <MetricCard icon={<IconCost />} label={t('agent.tokens', locale)} value={fmtNum(totals.tokens)} tone="neutral" />
    </div>
    <details className="agent-methodology">
      <summary>{t('agent.methodology', locale)}</summary>
      <ul>{(['agent.groupBasis', 'agent.ratioBasis', 'agent.toolBasis', 'agent.phaseBasis', 'agent.qualityLimit'] as const).map(key => <li key={key}>{t(key, locale)}</li>)}</ul>
    </details>
    <div className="agent-toolbar">
      <div className="agent-view-toggle" role="group" aria-label={t('agent.viewMode', locale)}>
        {(['table', 'cards'] as const).map(mode => <button key={mode} type="button" className={'timeline-chip' + (viewMode === mode ? ' timeline-chip-on' : '')}
          aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{t(mode === 'table' ? 'agent.viewTable' : 'agent.viewCards', locale)}</button>)}
      </div>
      {(['avgToolDurationMs', 'tokenTotal', 'errorRate', 'verificationCoverage'] as const).map((key, index) => <button key={key} type="button"
        className={'timeline-chip' + (sort?.key === key ? ' timeline-chip-on' : '')} aria-pressed={sort?.key === key}
        onClick={() => setSort({ key, direction: key === 'tokenTotal' || key === 'verificationCoverage' ? 'desc' : 'asc' })}>
        {t((['agent.sortDuration', 'agent.sortTokens', 'agent.sortError', 'agent.sortVerify'] as const)[index]!, locale)}
      </button>)}
      {sort !== null && <button type="button" className="btn ui-btn-sm" onClick={() => setSort(null)}>{t('agent.resetSort', locale)}</button>}
      <span className="hint agent-freshness">{t(snapshot.cached ? 'agent.cached' : 'agent.fresh', locale)} · {t('agent.sourceStamp', locale)} <time dateTime={snapshot.stamp}>{snapshot.stamp}</time></span>
    </div>
    <div className="agent-toolbar">
      <p className="hint">{t('agent.selectHint', locale)} · {compareSelection.length}/2 · {t('agent.compareBasis', locale)}</p>
      {compareSelection.length === 2 && onCompareProviders !== undefined && <button type="button" className="btn compare-float-btn" onClick={() => {
        const pair = compareSelection.map(key => rows.find(row => overviewGroupKey(row) === key));
        if (pair[0] !== undefined && pair[1] !== undefined) onCompareProviders(pair[0].provider, pair[1].provider, [pair[0].sourceAgent, pair[1].sourceAgent]);
      }}><IconCompare />{t('agent.compareSelected', locale)}</button>}
    </div>
    {viewMode === 'table' ? <div className="agent-table-region" role="region" tabIndex={0} aria-label={t('agent.tableLabel', locale)}>
      <p className="hint">{t('agent.tableLabel', locale)}</p>
      <Table columns={columns} rows={sortedRows} density="compact" rowKey={overviewGroupKey} sort={sort}
        onSort={key => setSort(previous => ({ key, direction: previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))}
        expandedKey={expanded} onToggleExpand={toggleExpand} expandLabel={expandName}
        renderExpand={row => <tr><td colSpan={columns.length + 1}>{renderRecent(row)}
          <div className="agent-detail-metrics"><span>{t('agent.avgDuration', locale)}: {duration(row.avgWallClockMs)}</span>
            <span>{t('agent.tokenParts', locale)}: {fmtNum(row.tokenInput)} / {fmtNum(row.tokenOutput)}</span></div>
          <PhaseDetails row={row} locale={locale} /></td></tr>} />
    </div> : <div className="agent-card-grid">
      {sortedRows.map(row => {
        const key = overviewGroupKey(row);
        const metrics = [
          [t('agent.sessions', locale), fmtNum(row.sessionCount)], [t('agent.tokens', locale), fmtNum(row.tokenTotal)],
          [t('agent.events', locale), fmtNum(row.eventCount)], [t('agent.avgDuration', locale), duration(row.avgWallClockMs)],
          [t('agent.verification', locale), pct(row.verificationCoverage)], [t('agent.errorRate', locale), pct(row.errorRate)],
        ];
        return <article key={key} className={'agent-card' + (compareSelection.includes(key) ? ' agent-card-on' : '')}>
          <header className="agent-card-head"><input type="checkbox" className="agent-card-compare" aria-label={selectionName(row)}
            checked={compareSelection.includes(key)} onChange={() => toggleCompare(key)} /><ProviderBadge provider={row.provider} locale={locale} />
            <h3 className="agent-card-name">{name(row)}</h3><span className="mono agent-card-provider">{row.provider}</span>
          </header>
          <PhaseStackBar durations={row.durationByPhase} locale={locale} />
          <dl className="agent-card-metrics">{metrics.map(([label, value]) => <div key={label} className="agent-card-metric"><dt>{label}</dt><dd className="mono">{value}</dd></div>)}</dl>
          <div className="agent-detail-metrics"><span>{t('agent.toolDuration', locale)}: {duration(row.avgToolDurationMs)}</span>
            <span>{t('agent.debugRate', locale)}: {pct(row.debugEntryRate)}</span>
            <span>{t('agent.tokenParts', locale)}: {fmtNum(row.tokenInput)} / {fmtNum(row.tokenOutput)}</span></div>
          <PhaseDetails row={row} locale={locale} />
          <button type="button" className="btn ui-btn-sm" aria-expanded={expanded === key} onClick={() => toggleExpand(key)}>{expandName(row)}</button>
          {expanded === key && renderRecent(row)}
        </article>;
      })}
    </div>}
  </section>;
}
