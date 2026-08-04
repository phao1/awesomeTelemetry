import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SessionIndexEntry } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { IconSidebar } from './icons/index.js';

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

/** REQ-008：左侧会话选择器（虚拟滚动 + 搜索/provider 过滤，受控）。 */
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
  const [provider, setProvider] = useState('');

  const filtered = useMemo(
    () =>
      items.filter(
        (s) =>
          (search === '' ||
            s.title.toLowerCase().includes(search.toLowerCase()) ||
            s.id.toLowerCase().includes(search.toLowerCase())) &&
          (provider === '' || s.provider === provider),
      ),
    [items, search, provider],
  );

  const { containerRef, range, onScroll } = useVirtualList(filtered.length, 28);

  useEffect(() => {
    if (hasMore && range.endIndex >= filtered.length - 10 && !loading) {
      onLoadMore();
    }
  }, [range.endIndex, filtered.length, hasMore, loading, onLoadMore]);

  const providers = useMemo(() => [...new Set(items.map((s) => s.provider))].sort(), [items]);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragStart = (event: ReactMouseEvent<HTMLElement>): void => {
    if (collapsed) {
      return;
    }
    dragRef.current = { startX: event.clientX, startWidth: width };
    const onMove = (ev: globalThis.MouseEvent): void => {
      if (dragRef.current !== null) {
        onResize(Math.max(260, Math.min(480, dragRef.current.startWidth + (ev.clientX - dragRef.current.startX))));
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

  return (
    <aside className="rail" style={{ width: collapsed ? 0 : width }}>
      <div className="rail-header">
        <button
          type="button"
          className="ui-icon-btn ui-btn-sm"
          aria-label="collapse rail"
          onClick={onToggleCollapse}
        >
          <IconSidebar size={12} />
        </button>
      </div>
      <input
        type="search"
        placeholder={t('session.search', locale)}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="">{t('session.provider', locale)}</option>
        {providers.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
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
            {filtered.slice(range.startIndex, range.endIndex).map((session) => (
              <div
                key={session.id}
                className={`rail-row ${session.id === selectedId ? 'rail-row-on' : ''}`}
                onClick={() => onSelect(session.id)}
              >
                <span className="mono">{session.id}</span>
                <span className="rail-title">{session.title}</span>
                <span>{new Date(session.startedAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {loading && items.length > 0 && <div className="hint">{t('common.loading', locale)}</div>}
      <div className="rail-resize" onMouseDown={onDragStart} aria-hidden="true" />
    </aside>
  );
}
