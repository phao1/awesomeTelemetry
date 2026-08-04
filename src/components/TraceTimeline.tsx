import { useEffect, useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim, TracePhase, TraceStatus } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import {
  IconCancelled,
  IconChevronDown,
  IconChevronRight,
  IconDebug,
  IconError,
  IconImplement,
  IconPlan,
  IconReport,
  IconRunning,
  IconSuccess,
  IconUnderstand,
  IconVerify,
  IconWarning,
  type IconProps,
} from './icons/index.js';

export interface TraceTimelineProps {
  events: TraceEventSlim[];
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelectEvent: (event: TraceEventSlim) => void;
  selectedEventId: string | null;
  locale: Locale;
}

const ROW_HEIGHT = 28; // --row-sm（G-DS-1：虚拟滚动 itemHeight 必须为常量）

const PHASE_ICON: Record<TracePhase, (props: IconProps) => React.JSX.Element> = {
  understand: IconUnderstand,
  plan: IconPlan,
  implement: IconImplement,
  debug: IconDebug,
  verify: IconVerify,
  report: IconReport,
};

const STATUS_ICON: Record<TraceStatus, (props: IconProps) => React.JSX.Element> = {
  success: IconSuccess,
  error: IconError,
  running: IconRunning,
  cancelled: IconCancelled,
  unknown: IconWarning,
};

interface TimelineRow extends TraceEventSlim {
  depth: number;
}

/**
 * REQ-017 ④（design D4）：时间比例甘特 + 树形缩进（最多 3 级，可折叠）。
 * 左偏移与宽度按事件在会话时间轴上的真实位置/时长计算，不是等宽条；
 * 零时长事件渲染为最小 2px 竖线（MUST NOT 不可见）。
 */
export function TraceTimeline({
  events,
  total,
  hasMore,
  onLoadMore,
  onSelectEvent,
  selectedEventId,
  locale,
}: TraceTimelineProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo<TimelineRow[]>(() => {
    let depth = 0;
    return events.map((event) => {
      const kind = event.kind;
      if (kind === 'user_prompt' || kind === 'llm' || kind === 'message') {
        depth = 0;
      } else if (kind === 'tool' || kind === 'bash' || kind === 'file_read' || kind === 'file_write' || kind === 'test' || kind === 'system') {
        depth = Math.min(2, Math.max(1, depth + 1));
      } else if (kind === 'subagent_prompt' || kind === 'agent') {
        depth = 2;
      }
      return { ...event, depth };
    });
  }, [events]);

  const visibleRows = useMemo(() => {
    const out: TimelineRow[] = [];
    let hiddenBelow = -1;
    for (const row of rows) {
      if (hiddenBelow >= 0 && row.depth > hiddenBelow) {
        continue;
      }
      hiddenBelow = -1;
      out.push(row);
      if (collapsed.has(row.id)) {
        hiddenBelow = row.depth;
      }
    }
    return out;
  }, [rows, collapsed]);

  const axis = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const row of rows) {
      const s = Date.parse(row.startedAt);
      if (s < start) {
        start = s;
      }
      const e = s + row.durationMs;
      if (e > end) {
        end = e;
      }
    }
    const span = Math.max(1, end - start);
    return { start, span };
  }, [rows]);

  const { containerRef, range, onScroll } = useVirtualList(visibleRows.length, ROW_HEIGHT);

  useEffect(() => {
    if (hasMore && range.endIndex >= visibleRows.length - 20) {
      onLoadMore();
    }
  }, [hasMore, range.endIndex, visibleRows.length, onLoadMore]);

  const hasChildren = (index: number): boolean => {
    const current = visibleRows[index]!;
    const next = visibleRows[index + 1];
    return next !== undefined && next.depth > current.depth;
  };

  if (rows.length === 0) {
    return (
      <div className="gantt ui-empty">
        <span>{t('common.empty', locale)}</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="gantt"
      style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
      onScroll={onScroll}
    >
      <div style={{ height: range.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${range.offsetY}px)` }}>
          {visibleRows.slice(range.startIndex, range.endIndex).map((event, visibleIndex) => {
            const index = range.startIndex + visibleIndex;
            const Icon = PHASE_ICON[event.phase];
            const StatusIcon = STATUS_ICON[event.status];
            const collapsible = hasChildren(index);
            const left = axis === null ? 0 : ((Date.parse(event.startedAt) - axis.start) / axis.span) * 100;
            const width = axis === null ? 0 : (event.durationMs / axis.span) * 100;
            return (
              <div
                key={`${event.id}-${event.sequence}`}
                className={`gantt-row ${event.id === selectedEventId ? 'gantt-row-on' : ''}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSelectEvent(event);
                  }
                }}
                style={{
                  height: ROW_HEIGHT,
                  paddingLeft: `calc(var(--space-3) * ${event.depth})`,
                }}
                onClick={() => onSelectEvent(event)}
              >
                {collapsible && (
                  <button
                    type="button"
                    className="timeline-toggle"
                    aria-label="toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(event.id)) {
                          next.delete(event.id);
                        } else {
                          next.add(event.id);
                        }
                        return next;
                      });
                    }}
                  >
                    {collapsed.has(event.id) ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                  </button>
                )}
                <span className="mono gantt-seq">#{event.sequence}</span>
                <Icon
                  className={`timeline-phase-${event.phase}`}
                  size={12}
                  label={t(`phase.${event.phase}`, locale)}
                />
                <div className="timeline-track" aria-hidden="true">
                  <div
                    className="timeline-bar"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(0, width)}%`,
                      minWidth: 'calc(var(--space-1) / 2)',
                      background: `var(--phase-${event.phase})`,
                    }}
                  />
                </div>
                <span className="gantt-title" title={event.title}>
                  {event.title}
                </span>
                <span className="mono gantt-status">
                  {event.durationMs >= 1000 ? `${(event.durationMs / 1000).toFixed(1)}s` : `${event.durationMs}ms`}
                </span>
                <StatusIcon size={12} label={t(`status.${event.status}`, locale)} />
              </div>
            );
          })}
        </div>
      </div>
      {visibleRows.length < total && <div className="hint">…</div>}
    </div>
  );
}
