import { useEffect } from 'react';

import type { TraceEventSlim } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';

export interface TraceGanttTreeProps {
  events: TraceEventSlim[];
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelectEvent: (event: TraceEventSlim) => void;
  selectedEventId: string | null;
}

const ROW_HEIGHT = 24;

/** REQ-006/007：Gantt 风格时间线树（虚拟滚动 + 分页衔接）。 */
export function TraceGanttTree({
  events,
  total,
  hasMore,
  onLoadMore,
  onSelectEvent,
  selectedEventId,
}: TraceGanttTreeProps) {
  const { containerRef, range, onScroll } = useVirtualList(events.length, ROW_HEIGHT);

  useEffect(() => {
    if (hasMore && range.endIndex >= events.length - 20) {
      onLoadMore();
    }
  }, [hasMore, range.endIndex, events.length, onLoadMore]);

  return (
    <div
      ref={containerRef}
      className="gantt"
      style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
      onScroll={onScroll}
    >
      <div style={{ height: range.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${range.offsetY}px)` }}>
          {events.slice(range.startIndex, range.endIndex).map((event) => (
            <div
              key={`${event.id}-${event.sequence}`}
              className={`gantt-row ${event.id === selectedEventId ? 'gantt-row-on' : ''}`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelectEvent(event)}
            >
              <span className="mono gantt-seq">#{event.sequence}</span>
              <span className={`phase-dot phase-${event.phase}`} title={event.phase} />
              <span className="gantt-title">{event.title}</span>
              <span className="mono">{event.durationMs}ms</span>
              <span className="gantt-status">{event.status}</span>
            </div>
          ))}
        </div>
      </div>
      {events.length < total && <div className="hint">…</div>}
    </div>
  );
}
