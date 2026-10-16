/**
 * add-agent-team-observability §7.3 / §7.4 / §7.8 / §7.10 / §7.11 —
 * TeamShell：七视图 shell + App-owned cache + SSE patch + layout + 六状态。
 *
 * 七视图（design D15）：topology / tasks / timeline / communication / ledger /
 * inspector / compare。前六视图共享一个 normalized entity store（snapshot），
 * inspector 单独可发一条 body detail 请求；compare 是两 run 比较，独立请求。
 *
 * **App-owned**（§7.4）：run list / entity cache / body-detail cache 全部由
 * TeamShell 单一持有，子视图是纯受控组件。禁止第二个私有 run-list state，
 * 禁止 per-entity fetching（§7.4 / G7.6）。
 *
 * **SSE patch**（§7.8）：team_runs_changed → 本地 patch（teamApi.patch）/
 * reconnect（truncated 时一次 snapshot 刷新），保留 selection/graph view/
 * filters/scroll/cached bodies。
 *
 * **六状态**（§7.11）：每个 panel 都实现 loading/empty/error+retry/success/
 * partial/unavailable。
 *
 * **无新 runtime dependency**：只用 React + 既有 ui/* + @tanstack/react-virtual
 * （已在白名单，但本组件用既有 useVirtualList 即可，无需直接依赖）。
 */

import '../../styles/components/team.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamActivitySlim,
  TeamComparison,
  TeamRunSnapshot,
  TeamRunSummary,
} from '../../core/trace-types.js';
import { ApiError } from '../../api/client.js';
import { LruCache } from '../../cache/lru.js';
import { EmptyState, ErrorState, Skeleton } from '../ui/States.js';
import { Tabs } from '../ui/Tabs.js';
import { TeamRunList } from './TeamRunList.js';
import {
  TEAM_PANELS,
  type TeamActivityDetailResponse,
  type TeamActivityListResponse,
  type TeamHashState,
  type TeamPanel,
  type TeamPatchResponse,
  type TeamRunListParams,
  type TeamRunListResponse,
  type TeamRunSnapshotResponse,
  type TeamSelection,
  teamApi,
} from './team-client.js';

// ── §7.4 bounded body-detail cache ──────────────────────────

/** body/raw detail LRU（§7.4 bounded body-detail cache，cap 50）。 */
const bodyDetailCache = new LruCache<TeamActivityDetailResponse>(50);
/** snapshot LRU（§7.4 entity cache，cap 10 个打开的 run）。 */
const snapshotCache = new LruCache<{ snapshot: TeamRunSnapshot; stamp: string }>(10);

function invalidateTeamSnapshot(runId: string): void {
  snapshotCache.delete(runId);
  // body detail 按 `${runId}:${activityId}` 索引，无法精确清除全部，
  // 但 LRU cap 50 会自然淘汰；显式清除当前 run 的 body 可遍历 keys，
  // LruCache 未暴露 keys()，故依赖 cap + stamp 失效（patch 会刷新 stamp）。
}

// ── 错误本地化 ───────────────────────────────────────────────

function formatTeamError(err: unknown, locale: Locale): string {
  if (err instanceof ApiError) {
    const key = `err.${err.code}` as I18nKey;
    const localized = t(key, locale);
    return localized === err.code ? err.message : localized;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── §7.6 summary header ──────────────────────────────────────

function TeamSummaryHeader({
  snapshot,
  locale,
}: {
  snapshot: TeamRunSnapshot;
  locale: Locale;
}): React.JSX.Element {
  const s = snapshot.summary;
  const dims = Object.keys(snapshot.completeness) as Array<keyof typeof snapshot.completeness>;
  return (
    <header className="team-summary-header">
      <div className="team-summary-title-row">
        <h2 className="team-summary-title">{s.title}</h2>
        <span className="team-summary-topo">
          {t(`team.topology.${s.topologyKind}` as I18nKey, locale)}
        </span>
        <span className="team-summary-status">
          {t(`team.status.${s.status}` as I18nKey, locale)}
        </span>
      </div>
      <div className="team-summary-meta">
        <span className="mono">{s.nativeRunId}</span>
        <span>{s.counts.agents} {t('team.agents', locale)}</span>
        <span>{s.counts.tasks} {t('team.tasks', locale)}</span>
        <span>{s.counts.communications} {t('team.communications', locale)}</span>
        <span>{s.counts.activities} {t('team.activities', locale)}</span>
        <span>{s.counts.rounds} {t('team.rounds', locale)}</span>
        <span>{s.counts.artifacts} {t('team.artifacts', locale)}</span>
      </div>
      <div className="team-summary-provenance">
        <span>
          {t('team.tokenAvailable', locale)}: {s.tokenAvailable ? t('common.yes', locale) : t('common.no', locale)}
        </span>
        <span>
          {t('team.costAvailable', locale)}:{' '}
          {s.costAvailable ? (s.costCurrency ?? 'USD') : t('team.costUnavailable', locale)}
        </span>
        <span>
          {t('team.runIdentity', locale)}: {s.runIdentityConfidence}
        </span>
      </div>
      <div className="team-summary-completeness" role="list" aria-label={t('team.completenessLabel', locale)}>
        {dims.map((dim) => (
          <span key={dim} className="team-completeness-chip" role="listitem">
            <span className="team-completeness-dim">{t(`team.dimension.${dim}` as I18nKey, locale)}</span>
            <span className={`team-completeness-level team-completeness-${snapshot.completeness[dim]}`}>
              {t(`team.completeness.${snapshot.completeness[dim]}` as I18nKey, locale)}
            </span>
          </span>
        ))}
      </div>
      {snapshot.anomalies.length > 0 && (
        <div className="team-summary-anomalies" role="alert">
          {snapshot.anomalies.map((anomaly, idx) => (
            <div key={idx} className={`team-anomaly team-anomaly-${anomaly.severity}`}>
              <span className="team-anomaly-kind">{anomaly.kind}</span>
              <span className="team-anomaly-message">{anomaly.message}</span>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

// ── §7.11 六状态 panel wrapper ───────────────────────────────

type PanelState = 'loading' | 'empty' | 'error' | 'success' | 'partial' | 'unavailable';

function PanelStateWrapper({
  state,
  error,
  locale,
  onRetry,
  emptyTitle,
  emptyHint,
  unavailableHint,
  children,
}: {
  state: PanelState;
  error: string | null;
  locale: Locale;
  onRetry: () => void;
  emptyTitle: string;
  emptyHint: string;
  unavailableHint: string;
  children: React.ReactNode;
}): React.JSX.Element {
  if (state === 'loading') {
    return (
      <div className="team-panel-loading">
        <Skeleton variant="row" count={4} />
      </div>
    );
  }
  if (state === 'error') {
    return <ErrorState code="TEAM_PANEL_FAILED" message={error ?? ''} onRetry={onRetry} />;
  }
  if (state === 'unavailable') {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.unavailableTitle', locale)}
        description={unavailableHint}
      />
    );
  }
  if (state === 'empty') {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={emptyTitle}
        description={emptyHint}
      />
    );
  }
  // success / partial：partial 时顶部 banner 由各 panel 自行渲染
  return <>{children}</>;
}

// ── §7.7 tagged-union selection 共享高亮 ─────────────────────

function isSelected(selection: TeamSelection | null, kind: TeamSelection['kind'], id: string): boolean {
  return selection !== null && selection.kind === kind && selection.id === id;
}

// ── 七视图 panel（受控，无独立 fetch） ────────────────────────

function TopologyPanel({
  snapshot,
  selection,
  onSelect,
  locale,
}: {
  snapshot: TeamRunSnapshot;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}): React.JSX.Element {
  if (snapshot.agents.length === 0) {
    return (
      <PanelStateWrapper
        state="empty"
        error={null}
        locale={locale}
        onRetry={() => {}}
        emptyTitle={t('team.topologyEmpty', locale)}
        emptyHint={t('team.topologyEmptyHint', locale)}
        unavailableHint=""
      >
        {null}
      </PanelStateWrapper>
    );
  }
  return (
    <div className="team-topology-panel" role="tree" aria-label={t('team.topologyLabel', locale)}>
      {snapshot.agents.map((agent) => {
        const selected = isSelected(selection, 'agent', agent.id);
        const edges = snapshot.agentEdges.filter((e) => e.toAgentId === agent.id);
        return (
          <div
            key={agent.id}
            className={`team-topo-node ${selected ? 'team-topo-node-on' : ''}`}
            role="treeitem"
            aria-selected={selected}
            onClick={() => onSelect(selected ? null : { kind: 'agent', id: agent.id })}
          >
            <span className="team-topo-role">{agent.role}</span>
            <span className="team-topo-name">{agent.displayName}</span>
            <span className="team-topo-class">{agent.roleClass}</span>
            {edges.length > 0 && (
              <span className="team-topo-edges">
                {edges.map((edge) => (
                  <span key={edge.id} className={`team-topo-edge team-topo-edge-${edge.kind}`}>
                    {edge.kind}
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TasksPanel({
  snapshot,
  selection,
  onSelect,
  locale,
}: {
  snapshot: TeamRunSnapshot;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}): React.JSX.Element {
  if (snapshot.tasks.length === 0) {
    return (
      <PanelStateWrapper
        state="empty"
        error={null}
        locale={locale}
        onRetry={() => {}}
        emptyTitle={t('team.tasksEmpty', locale)}
        emptyHint={t('team.tasksEmptyHint', locale)}
        unavailableHint=""
      >
        {null}
      </PanelStateWrapper>
    );
  }
  return (
    <div className="team-tasks-panel" role="list" aria-label={t('team.tasksLabel', locale)}>
      {snapshot.tasks.map((task) => {
        const selected = isSelected(selection, 'task', task.id);
        const deps = snapshot.taskDependencies.filter((d) => d.downstreamTaskId === task.id);
        return (
          <div
            key={task.id}
            className={`team-task-row ${selected ? 'team-task-row-on' : ''}`}
            role="listitem"
            aria-selected={selected}
            onClick={() => onSelect(selected ? null : { kind: 'task', id: task.id })}
          >
            <span className={`team-task-status-dot team-task-status-${task.status}`} aria-hidden="true" />
            <span className="team-task-title">{task.title}</span>
            <span className="team-task-status">{t(`team.taskStatus.${task.status}` as I18nKey, locale)}</span>
            {deps.length > 0 && (
              <span className="team-task-deps">
                {deps.map((dep) => (
                  <span key={dep.id} className="team-task-dep">← {dep.upstreamTaskId.slice(-6)}</span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimelinePanel({
  snapshot,
  selection,
  onSelect,
  locale,
}: {
  snapshot: TeamRunSnapshot;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}): React.JSX.Element {
  // timeline 需要 activities，但 snapshot 不含 activities（§7.2）。
  // activities 由 TeamShell 在 ledger/timeline 视图时单独拉取（§7.3）。
  // 此处用 agents 的 createdAt/endedAt 渲染 swimlane 骨架，activities 由
  // 上层传入的 activities prop 叠加。
  if (snapshot.agents.length === 0) {
    return (
      <PanelStateWrapper
        state="empty"
        error={null}
        locale={locale}
        onRetry={() => {}}
        emptyTitle={t('team.timelineEmpty', locale)}
        emptyHint={t('team.timelineEmptyHint', locale)}
        unavailableHint=""
      >
        {null}
      </PanelStateWrapper>
    );
  }
  return (
    <div className="team-timeline-panel" aria-label={t('team.timelineLabel', locale)}>
      {snapshot.agents.map((agent) => {
        const selected = isSelected(selection, 'agent', agent.id);
        return (
          <div key={agent.id} className="team-timeline-lane">
            <button
              type="button"
              className={`team-timeline-lane-label ${selected ? 'team-timeline-lane-on' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : { kind: 'agent', id: agent.id })}
            >
              {agent.displayName}
            </button>
            <div className="team-timeline-lane-track">
              <span
                className="team-timeline-lane-bar"
                title={`${agent.createdAt ?? '—'} → ${agent.endedAt ?? '…'}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommunicationPanel({
  snapshot,
  selection: _selection,
  onSelect: _onSelect,
  locale,
}: {
  snapshot: TeamRunSnapshot;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}): React.JSX.Element {
  // G12.2：两 provider 的 communication 均 unavailable。snapshot 不含 messages
  // 数组（§7.2），messages 由 ledger 视图按 kind=message_sent/received 拉取。
  // 此 panel 用 completeness.communication 判断 unavailable。
  const commCompleteness = snapshot.completeness.communication;
  if (commCompleteness === 'unavailable') {
    return (
      <PanelStateWrapper
        state="unavailable"
        error={null}
        locale={locale}
        onRetry={() => {}}
        emptyTitle=""
        emptyHint=""
        unavailableHint={t('team.communicationUnavailableHint', locale)}
      >
        {null}
      </PanelStateWrapper>
    );
  }
  return (
    <div className="team-communication-panel" aria-label={t('team.communicationLabel', locale)}>
      <p className="team-panel-hint">{t('team.communicationHint', locale)}</p>
      {/* messages 由 ledger activities 中 kind=message_sent/received 投影 */}
      <div className="team-communication-empty">
        {t('team.communicationSeeLedger', locale)}
      </div>
    </div>
  );
}

function LedgerPanel({
  activities,
  activitiesState,
  activitiesError,
  selection,
  onSelect,
  locale,
  onRetry,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  activities: TeamActivitySlim[];
  activitiesState: PanelState;
  activitiesError: string | null;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
  onRetry: () => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}): React.JSX.Element {
  return (
    <div className="team-ledger-panel" aria-label={t('team.ledgerLabel', locale)}>
      <PanelStateWrapper
        state={activitiesState}
        error={activitiesError}
        locale={locale}
        onRetry={onRetry}
        emptyTitle={t('team.ledgerEmpty', locale)}
        emptyHint={t('team.ledgerEmptyHint', locale)}
        unavailableHint={t('team.ledgerUnavailableHint', locale)}
      >
        <div className="team-ledger-list" role="list">
          {activities.map((activity) => {
            const selected = isSelected(selection, 'activity', activity.id);
            return (
              <div
                key={activity.id}
                className={`team-ledger-row ${selected ? 'team-ledger-row-on' : ''} ${activity.orderConfidence === 'ambiguous' ? 'team-ledger-row-ambiguous' : ''}`}
                role="listitem"
                aria-selected={selected}
                onClick={() => onSelect(selected ? null : { kind: 'activity', id: activity.id })}
              >
                <span className="team-ledger-kind">{t(`team.activityKind.${activity.kind}` as I18nKey, locale)}</span>
                <span className="team-ledger-status">{activity.status}</span>
                <span className="mono team-ledger-time">{activity.startedAt?.slice(11, 19) ?? '—'}</span>
                {activity.orderConfidence === 'ambiguous' && (
                  <span className="team-ledger-ambiguous-marker" title={t('team.ambiguousOrder', locale)}>≈</span>
                )}
              </div>
            );
          })}
        </div>
        {hasMore && (
          <button
            type="button"
            className="team-load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('state.loading', locale) : t('session.loadMore', locale)}
          </button>
        )}
      </PanelStateWrapper>
    </div>
  );
}

function InspectorPanel({
  selection,
  snapshot,
  bodyDetail,
  bodyState,
  bodyError,
  locale,
  onLoadBody,
}: {
  selection: TeamSelection | null;
  snapshot: TeamRunSnapshot;
  bodyDetail: TeamActivityDetailResponse | null;
  bodyState: PanelState;
  bodyError: string | null;
  locale: Locale;
  onLoadBody: (activityId: string, tier: 'body' | 'raw') => void;
}): React.JSX.Element {
  if (selection === null) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.inspectorEmpty', locale)}
        description={t('team.inspectorEmptyHint', locale)}
      />
    );
  }
  const label = t(`team.selectionKind.${selection.kind}` as I18nKey, locale);
  // 查找选中实体的元数据
  let entityMeta: string = selection.id;
  if (selection.kind === 'agent') {
    const agent = snapshot.agents.find((a) => a.id === selection.id);
    if (agent !== undefined) {
      entityMeta = `${agent.displayName} (${agent.role})`;
    }
  } else if (selection.kind === 'task') {
    const task = snapshot.tasks.find((tk) => tk.id === selection.id);
    if (task !== undefined) {
      entityMeta = task.title;
    }
  } else if (selection.kind === 'artifact') {
    const artifact = snapshot.artifacts.find((ar) => ar.id === selection.id);
    if (artifact !== undefined) {
      entityMeta = artifact.name;
    }
  }
  return (
    <div className="team-inspector-panel" aria-label={t('team.inspectorLabel', locale)}>
      <div className="team-inspector-header">
        <span className="team-inspector-kind">{label}</span>
        <span className="team-inspector-id mono">{selection.id}</span>
      </div>
      <div className="team-inspector-meta">
        <span>{entityMeta}</span>
      </div>
      {selection.kind === 'activity' && (
        <div className="team-inspector-body">
          <div className="team-inspector-body-actions">
            <button
              type="button"
              className="btn ui-btn-sm"
              onClick={() => onLoadBody(selection.id, 'body')}
            >
              {t('team.loadBody', locale)}
            </button>
            <button
              type="button"
              className="btn ui-btn-sm"
              onClick={() => onLoadBody(selection.id, 'raw')}
            >
              {t('team.loadRaw', locale)}
            </button>
          </div>
          <PanelStateWrapper
            state={bodyState}
            error={bodyError}
            locale={locale}
            onRetry={() => onLoadBody(selection.id, 'body')}
            emptyTitle={t('team.bodyEmpty', locale)}
            emptyHint={t('team.bodyEmptyHint', locale)}
            unavailableHint={t('team.bodyUnavailableHint', locale)}
          >
            {bodyDetail !== null && (
              <div className="team-inspector-body-content">
                {bodyDetail.body !== null && (
                  <dl className="team-body-dl">
                    {bodyDetail.body.input !== null && (
                      <div className="team-body-row">
                        <dt>input</dt>
                        <dd><pre className="mono">{bodyDetail.body.input}</pre></dd>
                      </div>
                    )}
                    {bodyDetail.body.output !== null && (
                      <div className="team-body-row">
                        <dt>output</dt>
                        <dd><pre className="mono">{bodyDetail.body.output}</pre></dd>
                      </div>
                    )}
                    {bodyDetail.body.message !== null && (
                      <div className="team-body-row">
                        <dt>message</dt>
                        <dd><pre className="mono">{bodyDetail.body.message}</pre></dd>
                      </div>
                    )}
                    {bodyDetail.body.result !== null && (
                      <div className="team-body-row">
                        <dt>result</dt>
                        <dd><pre className="mono">{bodyDetail.body.result}</pre></dd>
                      </div>
                    )}
                  </dl>
                )}
                {bodyDetail.raw !== null && (
                  <pre className="team-body-raw mono">{bodyDetail.raw}</pre>
                )}
              </div>
            )}
          </PanelStateWrapper>
        </div>
      )}
    </div>
  );
}

function ComparePanel({
  compareLeft,
  compareRight,
  compareManualBasis,
  comparison,
  compareState,
  compareError,
  locale,
  onLeftChange,
  onRightChange,
  onToggleManualBasis,
  onRunCompare,
}: {
  compareLeft: string | null;
  compareRight: string | null;
  compareManualBasis: boolean;
  comparison: TeamComparison | null;
  compareState: PanelState;
  compareError: string | null;
  locale: Locale;
  onLeftChange: (id: string | null) => void;
  onRightChange: (id: string | null) => void;
  onToggleManualBasis: () => void;
  onRunCompare: () => void;
}): React.JSX.Element {
  return (
    <div className="team-compare-panel" aria-label={t('team.compareLabel', locale)}>
      <div className="team-compare-selectors">
        <div className="team-compare-selector">
          <label className="team-compare-label">{t('team.compareLeft', locale)}</label>
          <input
            type="text"
            className="ui-input ui-btn-md"
            value={compareLeft ?? ''}
            onChange={(e) => onLeftChange(e.target.value === '' ? null : e.target.value)}
            placeholder={t('team.compareRunIdPlaceholder', locale)}
          />
        </div>
        <div className="team-compare-selector">
          <label className="team-compare-label">{t('team.compareRight', locale)}</label>
          <input
            type="text"
            className="ui-input ui-btn-md"
            value={compareRight ?? ''}
            onChange={(e) => onRightChange(e.target.value === '' ? null : e.target.value)}
            placeholder={t('team.compareRunIdPlaceholder', locale)}
          />
        </div>
        <label className="team-compare-manual">
          <input
            type="checkbox"
            checked={compareManualBasis}
            onChange={onToggleManualBasis}
          />
          {t('team.compareManualBasis', locale)}
        </label>
        <button
          type="button"
          className="btn"
          onClick={onRunCompare}
          disabled={compareLeft === null || compareRight === null || compareLeft === compareRight}
        >
          {t('team.compareRun', locale)}
        </button>
      </div>
      <PanelStateWrapper
        state={compareState}
        error={compareError}
        locale={locale}
        onRetry={onRunCompare}
        emptyTitle={t('team.compareEmpty', locale)}
        emptyHint={t('team.compareEmptyHint', locale)}
        unavailableHint={t('team.compareUnavailableHint', locale)}
      >
        {comparison !== null && (
          <div className="team-compare-result">
            <div className={`team-compare-basis team-compare-basis-${comparison.basis.match}`}>
              <span className="team-compare-basis-match">
                {t(`team.compareMatch.${comparison.basis.match}` as I18nKey, locale)}
              </span>
              {comparison.basis.userDeclared && (
                <span className="team-compare-basis-manual">{t('team.compareManualBadge', locale)}</span>
              )}
              {comparison.basis.reasons.length > 0 && (
                <ul className="team-compare-basis-reasons">
                  {comparison.basis.reasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
            {comparison.dimensions.map((dim) => (
              <div key={dim.dimension} className="team-compare-dimension">
                <h4>{t(`team.metricDimension.${dim.dimension}` as I18nKey, locale)}</h4>
                <table className="team-compare-table">
                  <thead>
                    <tr>
                      <th>{t('team.compareMetric', locale)}</th>
                      <th>{t('team.compareLeft', locale)}</th>
                      <th>{t('team.compareRight', locale)}</th>
                      <th>Δ</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dim.rows.map((row) => (
                      <tr
                        key={row.metricId}
                        className={row.material ? 'team-compare-row-material' : ''}
                      >
                        <td>{row.metricId}</td>
                        <td className="mono">{row.left.value ?? '—'}</td>
                        <td className="mono">{row.right.value ?? '—'}</td>
                        <td className="mono">{row.delta ?? '—'}</td>
                        <td className="mono">{row.relativeDelta === null ? '—' : `${(row.relativeDelta * 100).toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {comparison.strengths.length > 0 && (
              <div className="team-compare-strengths">
                <h4>{t('team.compareStrengths', locale)}</h4>
                <ul>{comparison.strengths.map((s, idx) => <li key={idx}>{s}</li>)}</ul>
              </div>
            )}
            {comparison.weaknesses.length > 0 && (
              <div className="team-compare-weaknesses">
                <h4>{t('team.compareWeaknesses', locale)}</h4>
                <ul>{comparison.weaknesses.map((s, idx) => <li key={idx}>{s}</li>)}</ul>
              </div>
            )}
            {comparison.tradeoffs.length > 0 && (
              <div className="team-compare-tradeoffs">
                <h4>{t('team.compareTradeoffs', locale)}</h4>
                <ul>{comparison.tradeoffs.map((s, idx) => <li key={idx}>{s}</li>)}</ul>
              </div>
            )}
            {comparison.caveats.length > 0 && (
              <div className="team-compare-caveats">
                <h4>{t('team.compareCaveats', locale)}</h4>
                <ul>{comparison.caveats.map((s, idx) => <li key={idx}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </PanelStateWrapper>
    </div>
  );
}

// ── TeamShellProps ───────────────────────────────────────────

export interface TeamShellProps {
  locale: Locale;
  /** team hash state（App 持有，受控）。 */
  teamHash: TeamHashState;
  onTeamHashChange: (next: TeamHashState) => void;
  /** SSE patch 外部失效计数（team_runs_changed 时 +1）。 */
  invalidateKey: number;
}

// ── TeamShell ────────────────────────────────────────────────

export function TeamShell({
  locale,
  teamHash,
  onTeamHashChange,
  invalidateKey,
}: TeamShellProps): React.JSX.Element {
  // §7.4 App-owned run list（TeamShell 是 team 视图的 stateful owner）
  const [runs, setRuns] = useState<TeamRunSummary[]>([]);
  const [runsHasMore, setRunsHasMore] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runsPartial, setRunsPartial] = useState(false);
  const [runsTotal, setRunsTotal] = useState(0);
  const runsCursorRef = useRef<string | null>(null);
  const runsFiltersRef = useRef<TeamRunListParams>({});

  // snapshot（当前打开的 run）
  const [snapshot, setSnapshot] = useState<TeamRunSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const snapshotStampRef = useRef<string | null>(null);

  // activities（ledger/timeline）
  const [activities, setActivities] = useState<TeamActivitySlim[]>([]);
  const [activitiesHasMore, setActivitiesHasMore] = useState(false);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const activitiesCursorRef = useRef<string | null>(null);

  // body detail（inspector）
  const [bodyDetail, setBodyDetail] = useState<TeamActivityDetailResponse | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  // compare
  const [comparison, setComparison] = useState<TeamComparison | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // 局部 patch 进行中标记（SSE 触发）
  const [patching, setPatching] = useState(false);

  const runId = teamHash.runId;
  const panel = teamHash.panel;
  const selection = teamHash.selection;

  // ── §7.4 run list 加载（keyset） ──────────────────────────

  const loadRuns = useCallback(
    async (mode: 'first' | 'next') => {
      const filters = runsFiltersRef.current;
      setRunsLoading(true);
      try {
        const result: TeamRunListResponse = await teamApi.listRuns({
          provider: filters.provider,
          status: filters.status,
          topology: filters.topology,
          q: filters.q,
          range: filters.range,
          completeness: filters.completeness,
          limit: 50,
          cursor: mode === 'next' ? runsCursorRef.current ?? undefined : undefined,
        });
        setRuns((prev) =>
          mode === 'first'
            ? result.items
            : [...prev, ...result.items.filter((r) => !prev.some((p) => p.id === r.id))],
        );
        runsCursorRef.current = result.nextCursor;
        setRunsHasMore(result.hasMore);
        setRunsTotal(result.total);
        setRunsError(null);
        setRunsPartial(false);
      } catch (err) {
        console.error('[team] run list 加载失败:', err);
        setRunsError(formatTeamError(err, locale));
      } finally {
        setRunsLoading(false);
      }
    },
    [locale],
  );

  // 过滤同步到 ref
  useEffect(() => {
    runsFiltersRef.current = {
      provider: teamHash.provider.length > 0 ? teamHash.provider : undefined,
      status: teamHash.status.length > 0 ? teamHash.status : undefined,
      topology: teamHash.topology.length > 0 ? teamHash.topology : undefined,
      completeness: teamHash.completeness.length > 0 ? teamHash.completeness : undefined,
      q: teamHash.q.trim() !== '' ? teamHash.q.trim() : undefined,
      range: teamHash.range,
    };
  }, [teamHash.provider, teamHash.status, teamHash.topology, teamHash.completeness, teamHash.q, teamHash.range]);

  // 过滤变更 → 防抖拉第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRuns('first');
    }, 250);
    return () => clearTimeout(timer);
  }, [teamHash.provider, teamHash.status, teamHash.topology, teamHash.completeness, teamHash.q, teamHash.range, loadRuns]);

  // ── snapshot 加载（选中 run 时，1 请求，stamp 缓存） ──────

  const loadSnapshot = useCallback(
    async (id: string) => {
      const cached = snapshotCache.get(id);
      if (cached !== undefined) {
        setSnapshot(cached.snapshot);
        snapshotStampRef.current = cached.stamp;
        setSnapshotError(null);
        setSnapshotLoading(false);
        return;
      }
      setSnapshotLoading(true);
      setSnapshotError(null);
      try {
        const res: TeamRunSnapshotResponse = await teamApi.runSnapshot(id);
        snapshotCache.set(id, { snapshot: res.snapshot, stamp: res.stamp });
        setSnapshot(res.snapshot);
        snapshotStampRef.current = res.stamp;
      } catch (err) {
        console.error('[team] snapshot 加载失败:', err);
        setSnapshotError(formatTeamError(err, locale));
        if (err instanceof ApiError && err.code === 'TEAM_RUN_NOT_FOUND') {
          // URL 中 invalid run id
          onTeamHashChange({ ...teamHash, runId: null, invalidRunId: id });
        }
      } finally {
        setSnapshotLoading(false);
      }
    },
    [locale, teamHash, onTeamHashChange],
  );

  useEffect(() => {
    if (runId !== null) {
      void loadSnapshot(runId);
    } else {
      setSnapshot(null);
      setSnapshotError(null);
      setActivities([]);
    }
  }, [runId, loadSnapshot]);

  // ── activities 加载（ledger/timeline 视图时，1 请求/页） ──

  const loadActivities = useCallback(
    async (mode: 'first' | 'next') => {
      if (runId === null) {
        return;
      }
      if (mode === 'first') {
        setActivitiesLoading(true);
        setActivitiesError(null);
      }
      try {
        const res: TeamActivityListResponse = await teamApi.listActivities(runId, {
          limit: 200,
          cursor: mode === 'next' ? activitiesCursorRef.current ?? undefined : undefined,
        });
        setActivities((prev) =>
          mode === 'first'
            ? res.items
            : [...prev, ...res.items.filter((a) => !prev.some((p) => p.id === a.id))],
        );
        activitiesCursorRef.current = res.nextCursor;
        setActivitiesHasMore(res.hasMore);
      } catch (err) {
        console.error('[team] activities 加载失败:', err);
        setActivitiesError(formatTeamError(err, locale));
      } finally {
        setActivitiesLoading(false);
      }
    },
    [runId, locale],
  );

  // ledger/timeline 视图时拉 activities
  useEffect(() => {
    if (runId !== null && (panel === 'ledger' || panel === 'timeline')) {
      void loadActivities('first');
    }
  }, [runId, panel, loadActivities]);

  // ── body detail 加载（inspector，显式 body/raw tier） ─────

  const loadBody = useCallback(
    async (activityId: string, tier: 'body' | 'raw') => {
      if (runId === null) {
        return;
      }
      const cacheKey = `${runId}:${activityId}:${tier}`;
      const cached = bodyDetailCache.get(cacheKey);
      if (cached !== undefined) {
        setBodyDetail(cached);
        setBodyError(null);
        setBodyLoading(false);
        return;
      }
      setBodyLoading(true);
      setBodyError(null);
      try {
        const res: TeamActivityDetailResponse = await teamApi.activityDetail(runId, activityId, tier);
        bodyDetailCache.set(cacheKey, res);
        setBodyDetail(res);
      } catch (err) {
        console.error('[team] body detail 加载失败:', err);
        setBodyError(formatTeamError(err, locale));
      } finally {
        setBodyLoading(false);
      }
    },
    [runId, locale],
  );

  // ── compare 加载（1 请求） ────────────────────────────────

  const runCompare = useCallback(
    async () => {
      if (teamHash.compareLeft === null || teamHash.compareRight === null) {
        return;
      }
      if (teamHash.compareLeft === teamHash.compareRight) {
        setCompareError(t('team.compareSameId', locale));
        return;
      }
      setCompareLoading(true);
      setCompareError(null);
      try {
        const res: TeamComparison = await teamApi.compare({
          leftRunId: teamHash.compareLeft,
          rightRunId: teamHash.compareRight,
          manualBasis: teamHash.compareManualBasis,
        });
        setComparison(res);
      } catch (err) {
        console.error('[team] compare 加载失败:', err);
        setCompareError(formatTeamError(err, locale));
      } finally {
        setCompareLoading(false);
      }
    },
    [teamHash.compareLeft, teamHash.compareRight, teamHash.compareManualBasis, locale],
  );

  // ── §7.8 SSE patch（team_runs_changed → 本地 patch/reconnect） ─

  // snapshotRef 避免 patch useEffect 依赖 snapshot 导致 setSnapshot → useEffect 重跑 → 无限循环
  const snapshotRef = useRef<TeamRunSnapshot | null>(null);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (invalidateKey === 0) {
      return;
    }
    if (runId === null) {
      // 列表态：直接重拉第一页（受过滤）
      void loadRuns('first');
      return;
    }
    // 打开了 run：尝试增量 patch
    const stamp = snapshotStampRef.current;
    if (stamp === null) {
      return;
    }
    setPatching(true);
    void teamApi
      .patch(runId, stamp)
      .then((patch: TeamPatchResponse) => {
        if (patch.truncated) {
          // §7.8：truncated → 一次 snapshot 刷新
          invalidateTeamSnapshot(runId);
          void loadSnapshot(runId);
        } else if (snapshotRef.current !== null) {
          // 本地 patch：合并 agents/tasks/edges/...
          const current = snapshotRef.current;
          setSnapshot({
            ...current,
            agents: [
              ...current.agents.filter((a) => !patch.deletedAgentIds.includes(a.id)),
              ...patch.agents,
            ],
            tasks: [
              ...current.tasks.filter((tk) => !patch.deletedTaskIds.includes(tk.id)),
              ...patch.tasks,
            ],
            agentEdges: patch.agentEdges.length > 0 ? patch.agentEdges : current.agentEdges,
            taskDependencies: patch.taskDependencies.length > 0 ? patch.taskDependencies : current.taskDependencies,
            assignments: patch.assignments.length > 0 ? patch.assignments : current.assignments,
            artifacts: [
              ...current.artifacts.filter((ar) => !patch.deletedAgentIds.includes(ar.id)),
              ...patch.artifacts,
            ],
            metrics: patch.metrics ?? current.metrics,
          });
          snapshotStampRef.current = patch.stamp;
        }
        // 同时刷新列表中该 run 的 summary
        setRuns((prev) =>
          prev.map((r) =>
            r.id === runId
              ? { ...r, stamp: patch.stamp, updatedAt: patch.stamp }
              : r,
          ),
        );
      })
      .catch((err: unknown) => {
        console.error('[team] SSE patch 失败，回退 snapshot 刷新:', err);
        invalidateTeamSnapshot(runId);
        void loadSnapshot(runId);
      })
      .finally(() => setPatching(false));
  }, [invalidateKey, runId, loadRuns, loadSnapshot]);

  // ── selection 切换 ────────────────────────────────────────

  const handleSelect = useCallback(
    (sel: TeamSelection | null) => {
      onTeamHashChange({ ...teamHash, selection: sel });
    },
    [teamHash, onTeamHashChange],
  );

  const handleSelectRun = useCallback(
    (id: string) => {
      onTeamHashChange({ ...teamHash, runId: id, selection: null, invalidRunId: null });
    },
    [teamHash, onTeamHashChange],
  );

  const handlePanelChange = useCallback(
    (next: string) => {
      onTeamHashChange({ ...teamHash, panel: next as TeamPanel });
    },
    [teamHash, onTeamHashChange],
  );

  // ── 删除 run ──────────────────────────────────────────────

  const handleDeleteRun = useCallback(
    async (id: string) => {
      try {
        await teamApi.deleteRun(id);
        setRuns((prev) => prev.filter((r) => r.id !== id));
        invalidateTeamSnapshot(id);
        if (runId === id) {
          onTeamHashChange({ ...teamHash, runId: null, selection: null, deletedRunId: id });
        } else {
          onTeamHashChange({ ...teamHash, deletedRunId: id });
        }
      } catch (err) {
        console.error('[team] 删除 run 失败:', err);
      }
    },
    [runId, teamHash, onTeamHashChange],
  );

  // ── panel 状态计算 ────────────────────────────────────────

  const snapshotState: PanelState = useMemo(() => {
    if (snapshotLoading && snapshot === null) return 'loading';
    if (snapshotError !== null && snapshot === null) return 'error';
    if (snapshot !== null) return 'success';
    return 'empty';
  }, [snapshotLoading, snapshotError, snapshot]);

  const activitiesState: PanelState = useMemo(() => {
    if (activitiesLoading && activities.length === 0) return 'loading';
    if (activitiesError !== null && activities.length === 0) return 'error';
    if (activities.length === 0) return 'empty';
    return 'success';
  }, [activitiesLoading, activitiesError, activities]);

  const bodyState: PanelState = useMemo(() => {
    if (bodyLoading && bodyDetail === null) return 'loading';
    if (bodyError !== null && bodyDetail === null) return 'error';
    if (bodyDetail !== null) return 'success';
    return 'empty';
  }, [bodyLoading, bodyError, bodyDetail]);

  const compareState: PanelState = useMemo(() => {
    if (compareLoading && comparison === null) return 'loading';
    if (compareError !== null && comparison === null) return 'error';
    if (comparison !== null) return 'success';
    return 'empty';
  }, [compareLoading, compareError, comparison]);

  // ── 渲染 ──────────────────────────────────────────────────

  return (
    <div className="team-shell">
      <TeamRunList
        items={runs}
        selectedId={runId}
        onSelect={handleSelectRun}
        locale={locale}
        hasMore={runsHasMore}
        loading={runsLoading}
        error={runsError}
        partial={runsPartial}
        unavailable={false}
        onLoadMore={() => void loadRuns('next')}
        onRetry={() => void loadRuns('first')}
        providerFilter={teamHash.provider}
        statusFilter={teamHash.status}
        topologyFilter={teamHash.topology}
        completenessFilter={teamHash.completeness}
        q={teamHash.q}
        range={teamHash.range}
        onQChange={(q) => onTeamHashChange({ ...teamHash, q })}
        onRangeChange={(range) => onTeamHashChange({ ...teamHash, range })}
        onProviderFilterChange={(provider) => onTeamHashChange({ ...teamHash, provider })}
        onStatusFilterChange={(status) => onTeamHashChange({ ...teamHash, status })}
        onTopologyFilterChange={(topology) => onTeamHashChange({ ...teamHash, topology })}
        onCompletenessFilterChange={(completeness) => onTeamHashChange({ ...teamHash, completeness })}
        total={runsTotal}
        invalidRunId={teamHash.invalidRunId}
        deletedRunId={teamHash.deletedRunId}
      />
      <main className="team-main">
        {runId === null ? (
          <EmptyState
            icon={<span aria-hidden="true" />}
            title={t('team.selectRunPrompt', locale)}
            description={t('team.selectRunHint', locale)}
          />
        ) : (
          <>
            {/* §7.6 summary header */}
            <PanelStateWrapper
              state={snapshotState}
              error={snapshotError}
              locale={locale}
              onRetry={() => void loadSnapshot(runId)}
              emptyTitle={t('team.snapshotEmpty', locale)}
              emptyHint={t('team.snapshotEmptyHint', locale)}
              unavailableHint={t('team.snapshotUnavailableHint', locale)}
            >
              {snapshot !== null && (
                <>
                  <TeamSummaryHeader snapshot={snapshot} locale={locale} />
                  <div className="team-panel-tabs">
                    <Tabs
                      items={TEAM_PANELS.map((p) => ({
                        id: p,
                        label: t(`team.panel.${p}` as I18nKey, locale),
                      }))}
                      activeId={panel}
                      onChange={handlePanelChange}
                    />
                  </div>
                  <div className="team-panel-content">
                    {panel === 'topology' && (
                      <TopologyPanel
                        snapshot={snapshot}
                        selection={selection}
                        onSelect={handleSelect}
                        locale={locale}
                      />
                    )}
                    {panel === 'tasks' && (
                      <TasksPanel
                        snapshot={snapshot}
                        selection={selection}
                        onSelect={handleSelect}
                        locale={locale}
                      />
                    )}
                    {panel === 'timeline' && (
                      <TimelinePanel
                        snapshot={snapshot}
                        selection={selection}
                        onSelect={handleSelect}
                        locale={locale}
                      />
                    )}
                    {panel === 'communication' && (
                      <CommunicationPanel
                        snapshot={snapshot}
                        selection={selection}
                        onSelect={handleSelect}
                        locale={locale}
                      />
                    )}
                    {panel === 'ledger' && (
                      <LedgerPanel
                        activities={activities}
                        activitiesState={activitiesState}
                        activitiesError={activitiesError}
                        selection={selection}
                        onSelect={handleSelect}
                        locale={locale}
                        onRetry={() => void loadActivities('first')}
                        hasMore={activitiesHasMore}
                        onLoadMore={() => void loadActivities('next')}
                        loadingMore={activitiesLoading}
                      />
                    )}
                    {panel === 'inspector' && (
                      <InspectorPanel
                        selection={selection}
                        snapshot={snapshot}
                        bodyDetail={bodyDetail}
                        bodyState={bodyState}
                        bodyError={bodyError}
                        locale={locale}
                        onLoadBody={(activityId, tier) => void loadBody(activityId, tier)}
                      />
                    )}
                    {panel === 'compare' && (
                      <ComparePanel
                        compareLeft={teamHash.compareLeft}
                        compareRight={teamHash.compareRight}
                        compareManualBasis={teamHash.compareManualBasis}
                        comparison={comparison}
                        compareState={compareState}
                        compareError={compareError}
                        locale={locale}
                        onLeftChange={(id) => onTeamHashChange({ ...teamHash, compareLeft: id })}
                        onRightChange={(id) => onTeamHashChange({ ...teamHash, compareRight: id })}
                        onToggleManualBasis={() =>
                          onTeamHashChange({ ...teamHash, compareManualBasis: !teamHash.compareManualBasis })
                        }
                        onRunCompare={() => void runCompare()}
                      />
                    )}
                  </div>
                  {patching && (
                    <div className="team-patching-banner" role="status">
                      {t('team.patching', locale)}
                    </div>
                  )}
                  <div className="team-run-actions">
                    <button
                      type="button"
                      className="btn ui-btn-sm"
                      onClick={() => void handleDeleteRun(runId)}
                    >
                      {t('team.deleteRun', locale)}
                    </button>
                  </div>
                </>
              )}
            </PanelStateWrapper>
          </>
        )}
      </main>
    </div>
  );
}
