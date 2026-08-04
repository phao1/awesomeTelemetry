import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { Locale, I18nKey } from '../i18n.js';
import { t } from '../i18n.js';
import type { ProviderKey, SessionIndexEntry, TraceStatus } from '../core/trace-types.js';
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
  width,
  collapsed,
  onResize,
  onToggleCollapse,
}: SessionListProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<ProviderKey[]>([]);
  const [statusFilter, setStatusFilter] = useState<TraceStatus[]>([]);
  const [providerOpen, setProviderOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const filtered = useMemo(
    () =>
      items.filter(
        (s) =>
          (search === '' ||
            s.title.toLowerCase().includes(search.toLowerCase()) ||
            s.id.toLowerCase().includes(search.toLowerCase())) &&
          (providerFilter.length === 0 || providerFilter.includes(s.provider)) &&
          (statusFilter.length === 0 || statusFilter.includes(s.status)),
      ),
    [items, search, providerFilter, statusFilter],
  );

  const { containerRef, range, onScroll } = useVirtualList(filtered.length, 44);

  useEffect(() => {
    if (hasMore && range.endIndex >= filtered.length - 10 && !loading) {
      onLoadMore();
    }
  }, [range.endIndex, filtered.length, hasMore, loading, onLoadMore]);

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
        <SearchInput placeholder={t('session.search', locale)} value={search} onChange={(e) => setSearch(e.target.value)} />
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
                        setProviderFilter((prev) =>
                          checked ? prev.filter((p) => p !== provider) : [...prev, provider],
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
                        setStatusFilter((prev) =>
                          checked ? prev.filter((s) => s !== status) : [...prev, status],
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
        style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
        onScroll={onScroll}
      >
        <div style={{ height: range.totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${range.offsetY}px)` }}>
            {filtered.slice(range.startIndex, range.endIndex).map((session) => {
              const selected = session.id === selectedId;
              return (
                <div
                  key={session.id}
                  className={`session-row ${selected ? 'session-row-on' : ''}`}
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
      {loading && items.length > 0 && <div className="hint">{t('common.loading', locale)}</div>}
      <div className="rail-resize" onMouseDown={onDragStart} aria-hidden="true" />
    </aside>
  );
}
