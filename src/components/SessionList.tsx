import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';

import type { Locale, I18nKey } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  ProviderKey,
  SessionIndexEntry,
  SessionRange,
  TraceStatus,
} from '../core/trace-types.js';
import { SESSION_RANGES } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { IconSidebar } from './icons/index.js';
import { ProviderBadge } from './ui/Badge.js';
import { SearchInput } from './ui/Input.js';
import { Popover } from './ui/Overlay.js';

export interface SessionListProps {
  /** REQ-015（G7.6）：会话索引由 App 单一持有，本组件是纯受控组件。 */
  items: SessionIndexEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: Locale;
  hasMore: boolean;
  loading: boolean;
  error?: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  offlineSamples: boolean;
  /** REQ-016/REQ-024：受控过滤（App 持有并同步 URL hash） */
  providerFilter: ProviderKey[];
  statusFilter: TraceStatus[];
  /** 服务端搜索（标题 / ID 子串），受控。 */
  q: string;
  onQChange: (q: string) => void;
  /** 时间范围（服务端过滤），受控。 */
  range: SessionRange;
  onRangeChange: (range: SessionRange) => void;
  onProviderFilterChange: (providers: ProviderKey[]) => void;
  onStatusFilterChange: (statuses: TraceStatus[]) => void;
  /** 当前过滤条件下的总条数（服务端 total）。 */
  total: number;
  /** REQ-008：键盘浏览游标 + 全局 `/` 聚焦入口 */
  cursorIndex: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** REQ-015/REQ-026：受控宽度与折叠（App 单一持有并持久化） */
  width: number;
  collapsed: boolean;
  onResize: (width: number) => void;
  onToggleCollapse: () => void;
}

const PROVIDERS: ProviderKey[] = [
  'claude',
  'codex',
  'opencode',
  'codearts',
  'codeagent',
  'codeagent2',
  'trae',
  'qoder',
  'workbuddy',
];

const STATUSES: TraceStatus[] = ['success', 'error', 'running', 'cancelled', 'unknown'];

const RANGE_LABEL: Record<SessionRange, I18nKey> = {
  today: 'session.rangeToday',
  '7d': 'session.range7d',
  '30d': 'session.range30d',
  all: 'session.rangeAll',
};

function relativeTime(iso: string, locale: Locale): string {
  const diffMs = Date.now() - Date.parse(iso);
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

/** REQ-008/REQ-016：左侧会话选择器（44px 双行密排，虚拟滚动，受控）。 */
export function SessionList({
  items,
  selectedId,
  onSelect,
  locale,
  hasMore,
  loading,
  error,
  onLoadMore,
  onRetry,
  offlineSamples,
  providerFilter,
  statusFilter,
  q,
  onQChange,
  range,
  onRangeChange,
  onProviderFilterChange,
  onStatusFilterChange,
  total,
  cursorIndex,
  searchInputRef,
  width,
  collapsed,
  onResize,
  onToggleCollapse,
}: SessionListProps): React.JSX.Element {
  const [providerOpen, setProviderOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // REQ-016（delta）：过滤全部服务端化——App 按 q/range/provider/status 拉取，
  // 本组件不再对已加载页做纯前端过滤（分页下只过滤已加载项会漏数据）。
  const { containerRef, range: virtualRange, onScroll } = useVirtualList(items.length, 44);

  // REQ-008：游标滚动进视口
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || cursorIndex < 0) {
      return;
    }
    const top = cursorIndex * 44;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (top + 44 > container.scrollTop + container.clientHeight) {
      container.scrollTop = top + 44 - container.clientHeight;
    }
  }, [cursorIndex, containerRef]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onDragStart = (event: ReactMouseEvent<HTMLElement>): void => {
    if (collapsed) {
      return;
    }
    dragRef.current = { startX: event.clientX, startWidth: width };
    const onMove = (ev: globalThis.MouseEvent): void => {
      if (dragRef.current !== null) {
        onResize(
          Math.max(260, Math.min(480, dragRef.current.startWidth + (ev.clientX - dragRef.current.startX))),
        );
      }
    };
    const onUp = (): void => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const filterBadge = (count: number): string => (count > 0 ? ` (${count})` : '');

  return (
    <aside className="rail" style={{ width: collapsed ? 0 : width }}>
      <div className="rail-header">
        <button type="button" className="ui-icon-btn ui-btn-sm" aria-label="collapse rail" onClick={onToggleCollapse}>
          <IconSidebar size={12} />
        </button>
      </div>
      <div className="session-filters">
        <SearchInput
          inputRef={searchInputRef}
          placeholder={t('session.search', locale)}
          value={q}
          onChange={(e) => onQChange(e.target.value)}
        />
        <div className="session-range-row" role="group" aria-label={t('session.range', locale)}>
          {SESSION_RANGES.map((r) => (
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
        <div className="session-filter-row">
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
              {STATUSES.map((status) => {
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
                    <span>{t(`status.${status}` as I18nKey, locale)}</span>
                  </label>
                );
              })}
            </div>
          </Popover>
        </div>
      </div>
      {error !== null && error !== undefined && (
        <ErrorState code="LIST_LOAD_FAILED" message={error} onRetry={onRetry} />
      )}
      {loading && items.length === 0 && (
        <div style={{ padding: 'var(--space-2)' }}>
          <Skeleton variant="row" count={6} />
        </div>
      )}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('common.empty', locale)}
          description={offlineSamples ? t('state.offlineSamples', locale) : undefined}
          action={
            <button type="button" className="btn" onClick={onRetry}>
              {t('common.retry', locale)}
            </button>
          }
        />
      )}
      <div
        ref={containerRef}
        className="rail-list"
        role="listbox"
        aria-label={t('session.title', locale)}
        style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
        onScroll={onScroll}
      >
        <div style={{ height: virtualRange.totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${virtualRange.offsetY}px)` }}>
            {items.slice(virtualRange.startIndex, virtualRange.endIndex).map((session, visibleIndex) => {
              const index = virtualRange.startIndex + visibleIndex;
              const selected = session.id === selectedId;
              return (
                <div
                  key={session.id}
                  className={`session-row ${selected ? 'session-row-on' : ''} ${
                    index === cursorIndex ? 'session-row-cursor' : ''
                  }`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(session.id)}
                  title={`${session.title}\n${new Date(session.startedAt).toLocaleString()}`}
                >
                  <div className="session-row-main">
                    <span
                      className={`status-dot status-${session.status}`}
                      aria-hidden="true"
                    />
                    <span className="session-row-title">{session.title}</span>
                  </div>
                  <div className="session-row-meta">
                    <ProviderBadge provider={session.provider} locale={locale} />
                    <span className="mono session-row-id" title={session.id}>
                      {session.id}
                    </span>
                    <span>{relativeTime(session.startedAt, locale)}</span>
                    <span className="mono">{session.eventCount} ev</span>
                    <span className="mono">{(session.tokenTotal / 1000).toFixed(1)}k tok</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="session-list-footer">
        <span className="session-total mono">
          {t('session.total', locale).replace('{n}', String(total))}
        </span>
        {hasMore && (
          <button
            type="button"
            className="btn ui-btn-sm"
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? t('common.loading', locale) : t('session.loadMore', locale)}
          </button>
        )}
      </div>
      <div className="rail-resize" onMouseDown={onDragStart} aria-hidden="true" />
    </aside>
  );
}
