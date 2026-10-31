/**
 * add-agent-team-observability §7.5 — TeamRunList.
 *
 * keyset loading、search/provider/status/topology/completeness 过滤、虚拟化、
 * real titles、六状态（loading/empty/error+retry/success/partial/unavailable）。
 *
 * **App-owned**：items/selectedId/filters 全部受控（App 单一持有 run-list state，
 * 禁止第二个私有 run-list state，§7.4）。本组件只负责渲染与过滤 UI 事件上抛。
 */

import { useState } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  CompletenessLevel,
  ProviderKey,
  TeamRunStatus,
  TeamRunSummary,
  TeamTopologyKind,
} from '../../core/trace-types.js';
import { useVirtualList } from '../../hooks/useVirtualList.js';
import { EmptyState, ErrorState, Skeleton } from '../ui/States.js';
import { ProviderBadge } from '../ui/Badge.js';
import { SearchInput } from '../ui/Input.js';
import { Popover } from '../ui/Overlay.js';

// ── 过滤候选（闭合枚举，来自契约 §12.1） ─────────────────────

const PROVIDERS: ProviderKey[] = [
  'claude', 'codex', 'opencode', 'codearts', 'codeagent', 'codeagent2',
  'trae', 'qoder', 'workbuddy',
];

const RUN_STATUSES: TeamRunStatus[] = [
  'planned', 'running', 'blocked', 'success', 'error', 'cancelled', 'unknown',
];

const TOPOLOGIES: TeamTopologyKind[] = [
  'two_level', 'three_level', 'deep_tree', 'peer_graph', 'hybrid', 'unknown',
];

const COMPLETENESS_LEVELS: CompletenessLevel[] = [
  'complete', 'partial', 'unavailable', 'conflicted',
];

const RANGES: Array<'today' | '7d' | '30d' | 'all'> = ['today', '7d', '30d', 'all'];

const RANGE_LABEL: Record<'today' | '7d' | '30d' | 'all', I18nKey> = {
  today: 'session.rangeToday',
  '7d': 'session.range7d',
  '30d': 'session.range30d',
  all: 'session.rangeAll',
};

// ── 六状态（§7.11） ──────────────────────────────────────────

export type TeamLoadState =
  | 'loading' // 首帧加载中
  | 'empty' // 加载成功但 0 条
  | 'error' // 加载失败（可重试）
  | 'success' // 加载成功且有数据
  | 'partial' // 源扫描未完成（TEAM_SOURCE_INCOMPLETE），数据部分可用
  | 'unavailable'; // 维度不可用（如 communication 对两 provider 均 unavailable）

function stateFor(
  loading: boolean,
  error: string | null,
  items: TeamRunSummary[],
  partial: boolean,
  unavailable: boolean,
): TeamLoadState {
  if (loading && items.length === 0) {
    return 'loading';
  }
  if (error !== null && items.length === 0) {
    return 'error';
  }
  if (unavailable && items.length === 0) {
    return 'unavailable';
  }
  if (items.length === 0) {
    return 'empty';
  }
  if (partial) {
    return 'partial';
  }
  return 'success';
}

// ── 行高（与 CSS --row-lg 一致，虚拟滚动 itemHeight 输入） ────

const ROW_HEIGHT = 44;

// ── 相对时间（与 SessionList 同风格） ────────────────────────

function relativeTime(iso: string | null, locale: Locale): string {
  if (iso === null) {
    return '—';
  }
  const diffMs = Date.now() - Date.parse(iso);
  if (diffMs < 0) {
    return t('time.justNow', locale);
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return t('time.justNow', locale);
  }
  if (minutes < 60) {
    return t('time.minutesAgo', locale).replace('{n}', String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('time.hoursAgo', locale).replace('{n}', String(hours));
  }
  const days = Math.floor(hours / 24);
  return t('time.daysAgo', locale).replace('{n}', String(days));
}

// ── 过滤徽章计数 ─────────────────────────────────────────────

function filterBadge(count: number): string {
  return count > 0 ? ` (${count})` : '';
}

// ── TeamRunListProps ─────────────────────────────────────────

export interface TeamRunListProps {
  /** §7.4 App-owned run list（受控）。 */
  items: TeamRunSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: Locale;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /** TEAM_SOURCE_INCOMPLETE 时为 true（partial 态）。 */
  partial: boolean;
  /** 维度整体 unavailable（如 communication 对两 provider 均 unavailable）。 */
  unavailable: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  // 受控过滤（App 持有并同步 team hash）
  providerFilter: ProviderKey[];
  statusFilter: TeamRunStatus[];
  topologyFilter: TeamTopologyKind[];
  completenessFilter: CompletenessLevel[];
  q: string;
  range: 'today' | '7d' | '30d' | 'all';
  onQChange: (q: string) => void;
  onRangeChange: (range: 'today' | '7d' | '30d' | 'all') => void;
  onProviderFilterChange: (providers: ProviderKey[]) => void;
  onStatusFilterChange: (statuses: TeamRunStatus[]) => void;
  onTopologyFilterChange: (topologies: TeamTopologyKind[]) => void;
  onCompletenessFilterChange: (levels: CompletenessLevel[]) => void;
  /** 当前过滤条件下的总条数（服务端 total）。 */
  total: number;
  /** URL 中存在但服务端 404 的 run id（invalid 提示）。 */
  invalidRunId: string | null;
  /** 刚被删除的 run id（删除确认提示）。 */
  deletedRunId: string | null;
}

/**
 * §7.5 TeamRunList —— 左侧 team run 选择器。
 *
 * 设计要点：
 * - **受控**：items/filters 全部由 App 持有，本组件不发请求（§7.4 App-owned）。
 * - **虚拟化**：复用 useVirtualList，行高 44px（与 SessionList 一致）。
 * - **real titles**：直接渲染 `summary.title`（来自服务端，非伪造）。
 * - **六状态**：loading/empty/error+retry/success/partial/unavailable，每个都有
 *   可达的 UI（§7.11）。
 * - **无 color-only meaning**：status 用 `status-dot` + 文字 label（既有 pattern）；
 *   topology/completeness 用文字 badge，颜色仅辅助。
 */
export function TeamRunList({
  items,
  selectedId,
  onSelect,
  locale,
  hasMore,
  loading,
  error,
  partial,
  unavailable,
  onLoadMore,
  onRetry,
  providerFilter,
  statusFilter,
  topologyFilter,
  completenessFilter,
  q,
  range,
  onQChange,
  onRangeChange,
  onProviderFilterChange,
  onStatusFilterChange,
  onTopologyFilterChange,
  onCompletenessFilterChange,
  total,
  invalidRunId,
  deletedRunId,
}: TeamRunListProps): React.JSX.Element {
  const [providerOpen, setProviderOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [topologyOpen, setTopologyOpen] = useState(false);
  const [completenessOpen, setCompletenessOpen] = useState(false);

  const { containerRef, range: virtualRange, onScroll } = useVirtualList(items.length, ROW_HEIGHT);
  const loadState = stateFor(loading, error, items, partial, unavailable);

  return (
    <aside className="team-rail" aria-label={t('team.railLabel', locale)}>
      <div className="team-rail-header">
        <span className="team-rail-title">{t('team.runListTitle', locale)}</span>
        <span className="team-rail-total mono">{t('session.total', locale).replace('{n}', String(total))}</span>
      </div>

      {/* 六状态提示条 */}
      {loadState === 'partial' && (
        <div className="team-state-banner team-state-partial" role="status">
          {t('team.statePartial', locale)}
        </div>
      )}
      {loadState === 'unavailable' && (
        <div className="team-state-banner team-state-unavailable" role="status">
          {t('team.stateUnavailable', locale)}
        </div>
      )}
      {invalidRunId !== null && (
        <div className="team-state-banner team-state-invalid" role="alert">
          {t('team.invalidRunId', locale).replace('{id}', invalidRunId)}
        </div>
      )}
      {deletedRunId !== null && (
        <div className="team-state-banner team-state-deleted" role="status">
          {t('team.deletedRunId', locale).replace('{id}', deletedRunId)}
        </div>
      )}

      <div className="team-filters">
        <SearchInput
          placeholder={t('team.searchPlaceholder', locale)}
          value={q}
          onChange={(e) => onQChange(e.target.value)}
        />
        <div className="team-range-row" role="group" aria-label={t('session.range', locale)}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={`session-range-btn ${r === range ? 'session-range-btn-on' : ''}`}
              aria-pressed={r === range}
              onClick={() => onRangeChange(r)}
            >
              {t(RANGE_LABEL[r], locale)}
            </button>
          ))}
        </div>
        <div className="team-filter-row">
          <Popover
            open={providerOpen}
            onOpenChange={setProviderOpen}
            trigger={(props) => (
              <button type="button" className="btn ui-btn-sm" {...props}>
                {t('session.provider', locale)}
                {filterBadge(providerFilter.length)}
              </button>
            )}
          >
            <div className="session-filter-list">
              {PROVIDERS.map((provider) => {
                const checked = providerFilter.includes(provider);
                return (
                  <label key={provider} className="session-filter-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onProviderFilterChange(
                          checked ? providerFilter.filter((p) => p !== provider) : [...providerFilter, provider],
                        )
                      }
                    />
                    <ProviderBadge provider={provider} locale={locale} />
                    <span>{t(`provider.${provider}`, locale)}</span>
                  </label>
                );
              })}
            </div>
          </Popover>
          <Popover
            open={statusOpen}
            onOpenChange={setStatusOpen}
            trigger={(props) => (
              <button type="button" className="btn ui-btn-sm" {...props}>
                {t('session.status', locale)}
                {filterBadge(statusFilter.length)}
              </button>
            )}
          >
            <div className="session-filter-list">
              {RUN_STATUSES.map((status) => {
                const checked = statusFilter.includes(status);
                return (
                  <label key={status} className="session-filter-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onStatusFilterChange(
                          checked ? statusFilter.filter((s) => s !== status) : [...statusFilter, status],
                        )
                      }
                    />
                    <span>{t(`team.status.${status}` as I18nKey, locale)}</span>
                  </label>
                );
              })}
            </div>
          </Popover>
          <Popover
            open={topologyOpen}
            onOpenChange={setTopologyOpen}
            trigger={(props) => (
              <button type="button" className="btn ui-btn-sm" {...props}>
                {t('team.topologyFilter', locale)}
                {filterBadge(topologyFilter.length)}
              </button>
            )}
          >
            <div className="session-filter-list">
              {TOPOLOGIES.map((topology) => {
                const checked = topologyFilter.includes(topology);
                return (
                  <label key={topology} className="session-filter-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onTopologyFilterChange(
                          checked ? topologyFilter.filter((s) => s !== topology) : [...topologyFilter, topology],
                        )
                      }
                    />
                    <span>{t(`team.topology.${topology}` as I18nKey, locale)}</span>
                  </label>
                );
              })}
            </div>
          </Popover>
          <Popover
            open={completenessOpen}
            onOpenChange={setCompletenessOpen}
            trigger={(props) => (
              <button type="button" className="btn ui-btn-sm" {...props}>
                {t('team.completenessFilter', locale)}
                {filterBadge(completenessFilter.length)}
              </button>
            )}
          >
            <div className="session-filter-list">
              {COMPLETENESS_LEVELS.map((level) => {
                const checked = completenessFilter.includes(level);
                return (
                  <label key={level} className="session-filter-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onCompletenessFilterChange(
                          checked ? completenessFilter.filter((s) => s !== level) : [...completenessFilter, level],
                        )
                      }
                    />
                    <span>{t(`team.completeness.${level}` as I18nKey, locale)}</span>
                  </label>
                );
              })}
            </div>
          </Popover>
        </div>
      </div>

      {/* 六状态主区 */}
      {loadState === 'error' && (
        <ErrorState code="TEAM_LIST_FAILED" message={error ?? ''} onRetry={onRetry} />
      )}
      {loadState === 'loading' && (
        <div style={{ padding: 'var(--space-2)' }}>
          <Skeleton variant="row" count={6} />
        </div>
      )}
      {loadState === 'empty' && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('team.emptyTitle', locale)}
          description={t('team.emptyHint', locale)}
          action={
            <button type="button" className="btn" onClick={onRetry}>
              {t('common.retry', locale)}
            </button>
          }
        />
      )}
      {loadState === 'unavailable' && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('team.unavailableTitle', locale)}
          description={t('team.unavailableHint', locale)}
        />
      )}

      {/* success / partial 共用列表（partial 时顶部已有 banner） */}
      {(loadState === 'success' || loadState === 'partial') && (
        <div
          ref={containerRef}
          className="team-rail-list"
          role="listbox"
          aria-label={t('team.runListTitle', locale)}
          style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
          onScroll={onScroll}
        >
          <div style={{ height: virtualRange.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${virtualRange.offsetY}px)` }}>
              {items.slice(virtualRange.startIndex, virtualRange.endIndex).map((run) => {
                const selected = run.id === selectedId;
                return (
                  <div key={run.id} className="team-row-cell" style={{ height: ROW_HEIGHT }}>
                    <div
                      className={`team-row ${selected ? 'team-row-on' : ''}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => onSelect(run.id)}
                      title={`${run.title}\n${run.nativeRunId}`}
                    >
                      <div className="team-row-main">
                        <span className={`status-dot status-${run.status}`} aria-hidden="true" />
                        <span className="team-row-title">{run.title}</span>
                      </div>
                      <div className="team-row-meta">
                        <ProviderBadge provider={run.provider} locale={locale} />
                        <span className="team-row-topo">{t(`team.topology.${run.topologyKind}` as I18nKey, locale)}</span>
                        <span className="mono">{run.counts.agents}a · {run.counts.tasks}t</span>
                        <span>{relativeTime(run.startedAt, locale)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {hasMore && (
            <button
              type="button"
              className="team-load-more"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? t('state.loading', locale) : t('session.loadMore', locale)}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
