import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEvent } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { ErrorState, Skeleton } from './ui/States.js';

export interface TranscriptModalProps {
  sessionKey: string;
  title: string;
  locale: Locale;
  onClose: () => void;
  pageSize?: number;
}

const ROW_HEIGHT = 72;

/** REQ-017 Scenario（G7.8）：Transcript 分页拉取 mode=full + 弹层内虚拟滚动，不得一次全量。 */
export function TranscriptModal({
  sessionKey,
  title,
  locale,
  onClose,
  pageSize = 500,
}: TranscriptModalProps): React.JSX.Element {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nextOffsetRef = useRef(0);

  const loadPage = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const result = await api.sessionDetail(sessionKey, 'full', offset, pageSize);
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...(result.events as TraceEvent[]).filter((e) => !seen.has(e.id))];
        });
        nextOffsetRef.current = offset + result.events.length;
        setHasMore(result.hasMore);
        setError(null);
      } catch (err) {
        console.error('[transcript] 分页加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionKey, pageSize],
  );

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const { containerRef, range, onScroll } = useVirtualList(events.length, ROW_HEIGHT);

  useEffect(() => {
    if (hasMore && range.endIndex >= events.length - 20 && !loading) {
      void loadPage(nextOffsetRef.current);
    }
  }, [hasMore, range.endIndex, events.length, loading, loadPage]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close', locale)}
          </button>
        </header>
        <div className="modal-body">
          {error !== null && (
            <ErrorState
              code="TRANSCRIPT_LOAD_FAILED"
              message={error}
              onRetry={() => void loadPage(0)}
            />
          )}
          {error === null && loading && events.length === 0 && <Skeleton variant="row" count={5} />}
          <div
            ref={containerRef}
            style={{ height: '55vh', overflowY: 'auto', position: 'relative' }}
            onScroll={onScroll}
          >
            <div style={{ height: range.totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${range.offsetY}px)` }}>
                {events.slice(range.startIndex, range.endIndex).map((event) => (
                  <div key={`${event.id}-${event.sequence}`} className="transcript-row" style={{ height: ROW_HEIGHT }}>
                    <span className="mono">#{event.sequence}</span>
                    <span className="mono">{event.phase}</span>
                    <span>{event.title}</span>
                    {event.inputSummary !== null && <pre>{event.inputSummary}</pre>}
                    {event.outputSummary !== null && <pre>{event.outputSummary}</pre>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
