import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SessionIndexEntry } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { api, type SessionListResponse } from '../api/client.js';

export interface SampleRailProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: Locale;
  load?: (params: { dataSource: 'scan'; limit: number; cursor?: string }) => Promise<SessionListResponse>;
}

/** REQ-008：左侧会话选择器（虚拟滚动 + 搜索/provider 过滤）。 */
export function SampleRail({ selectedId, onSelect, locale, load = api.listSessions }: SampleRailProps) {
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [loading, setLoading] = useState(false);
  const firstLoadRef = useRef(false);

  const fetchPage = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      try {
        const result = await load({ dataSource: 'scan', limit: 50, cursor: nextCursor });
        setSessions((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]));
          for (const item of result.items) {
            byId.set(item.id, item);
          }
          return [...byId.values()];
        });
        setCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } catch {
        // 列表加载失败保留旧数据
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    if (!firstLoadRef.current) {
      firstLoadRef.current = true;
      void fetchPage();
    }
  }, [fetchPage]);

  const filtered = useMemo(
    () =>
      sessions.filter(
        (s) =>
          (search === '' ||
            s.title.toLowerCase().includes(search.toLowerCase()) ||
            s.id.toLowerCase().includes(search.toLowerCase())) &&
          (provider === '' || s.provider === provider),
      ),
    [sessions, search, provider],
  );

  const { containerRef, range, onScroll } = useVirtualList(filtered.length, 28);

  useEffect(() => {
    if (hasMore && range.endIndex >= filtered.length - 10 && !loading) {
      void fetchPage(cursor ?? undefined);
    }
  }, [range.endIndex, filtered.length, hasMore, loading, cursor, fetchPage]);

  const providers = useMemo(
    () => [...new Set(sessions.map((s) => s.provider))].sort(),
    [sessions],
  );

  return (
    <aside className="rail">
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
      {loading && <div className="hint">{t('common.loading', locale)}</div>}
    </aside>
  );
}
