import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim, TracePhase, TraceStatus } from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import { groupEvents, type EventGroup, type GanttRow } from '../core/event-groups.js';
import { fmtDur } from '../core/session-findings.js';
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
  IconSearch,
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
  /** ui-design-v2 §3.4.2：语义折叠开关（默认开）。 */
  semanticGroup?: boolean;
  onSemanticGroupChange?: (next: boolean) => void;
  /** ContextBar「折叠/展开全部」的命令句柄。 */
  actionsRef?: { current: { collapseAll: () => void; expandAll: () => void } | null };
  /** 甘特布局：时间比例（默认）/ 序列等宽。 */
  layoutMode?: 'time' | 'sequence';
  onLayoutModeChange?: (mode: 'time' | 'sequence') => void;
  /** 阶段过滤 chips（App 持有过滤状态；缺省不过滤）。 */
  phaseFilter?: TracePhase[];
  onPhaseToggle?: (phase: TracePhase) => void;
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

type DisplayRow =
  | { kind: 'event'; event: TraceEventSlim; depth: number }
  | { kind: 'group'; group: EventGroup; depth: number; collapsed: boolean };

interface SearchToken {
  field: 'file' | 'tool' | 'status' | 'phase' | null;
  text: string;
}

function parseSearchTokens(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  for (const raw of query.split(/\s+/)) {
    const token = raw.trim();
    if (token === '') {
      continue;
    }
    const match = /^(file|tool|status|phase):(.+)$/i.exec(token);
    if (match !== null) {
      tokens.push({ field: match[1]!.toLowerCase() as SearchToken['field'], text: match[2]!.toLowerCase() });
    } else {
      tokens.push({ field: null, text: token.toLowerCase() });
    }
  }
  return tokens;
}

function eventHaystack(event: TraceEventSlim): string {
  return [event.title, event.tool ?? '', event.actor, event.error ?? '', event.kind, event.phase, event.id]
    .join(' ')
    .toLowerCase();
}

function matches(event: TraceEventSlim, haystack: string, tokens: SearchToken[]): boolean {
  if (tokens.length === 0) {
    return true;
  }
  for (const token of tokens) {
    if (token.field === 'file') {
      if (!haystack.includes(token.text)) {
        return false;
      }
    } else if (token.field === 'tool') {
      if (!(event.tool ?? '').toLowerCase().includes(token.text)) {
        return false;
      }
    } else if (token.field === 'status') {
      if (!event.status.toLowerCase().includes(token.text)) {
        return false;
      }
    } else if (token.field === 'phase') {
      if (!event.phase.toLowerCase().includes(token.text)) {
        return false;
      }
    } else if (!haystack.includes(token.text)) {
      return false;
    }
  }
  return true;
}

function highlightTitle(title: string, tokens: SearchToken[]): React.JSX.Element {
  const plain = tokens.find((token) => token.field === null);
  if (plain === undefined || plain.text === '') {
    return <>{title}</>;
  }
  const index = title.toLowerCase().indexOf(plain.text);
  if (index < 0) {
    return <>{title}</>;
  }
  return (
    <>
      {title.slice(0, index)}
      <mark>{title.slice(index, index + plain.text.length)}</mark>
      {title.slice(index + plain.text.length)}
    </>
  );
}

function groupLabel(group: EventGroup, locale: Locale): string {
  switch (group.type) {
    case 'repair_loop':
      return t('timeline.groupRepairLoop', locale)
        .replace('{rounds}', String(group.rounds ?? 0))
        .replace('{steps}', String(group.stepCount))
        .replace('{dur}', fmtDur(group.durationMs));
    case 'retry_burst':
      return t('timeline.groupRetryBurst', locale)
        .replace('{tool}', group.toolName ?? '')
        .replace('{count}', String(group.stepCount))
        .replace('{fails}', String(group.failCount ?? 0))
        .replace('{dur}', fmtDur(group.durationMs));
    case 'read_burst':
      return t('timeline.groupReadBurst', locale)
        .replace('{count}', String(group.stepCount))
        .replace('{dur}', fmtDur(group.durationMs));
    case 'write_batch':
      return t('timeline.groupWriteBatch', locale)
        .replace('{dir}', group.dirName ?? '')
        .replace('{count}', String(group.stepCount))
        .replace('{dur}', fmtDur(group.durationMs));
    case 'subagent':
      return t('timeline.groupSubagent', locale)
        .replace('{title}', (group.subTitle ?? '').slice(0, 24))
        .replace('{steps}', String(group.stepCount))
        .replace('{dur}', fmtDur(group.durationMs));
  }
}

/**
 * REQ-017 ④ + ui-design-v2 §3.4：时间比例甘特 + 语义折叠分组。
 * repair_loop 默认展开、其余默认折叠；搜索前缀 file:/tool:/status:/phase:；
 * 相对/绝对时间切换；j/k/h/l/Enter 键盘导航（焦点在甘特内时生效）。
 */
export function TraceTimeline({
  events,
  total,
  hasMore,
  onLoadMore,
  onSelectEvent,
  selectedEventId,
  locale,
  semanticGroup = true,
  onSemanticGroupChange,
  actionsRef,
  layoutMode = 'time',
  onLayoutModeChange,
  phaseFilter = [...TRACE_PHASES],
  onPhaseToggle,
}: TraceTimelineProps): React.JSX.Element {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [absoluteTime, setAbsoluteTime] = useState(false);
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
  const [dragSel, setDragSel] = useState<{ startPct: number; endPct: number } | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const axisRef = useRef<HTMLDivElement | null>(null);

  const grouped = useMemo(() => groupEvents(events), [events]);

  // 搜索索引：会话加载时一次性构建（扁平化可搜字段），避免每次输入遍历树。
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      map.set(event.id, eventHaystack(event));
    }
    return map;
  }, [events]);

  const tokens = useMemo(() => parseSearchTokens(query), [query]);

  // 新增分组默认按规则折叠（repair_loop 默认展开），已有分组的用户状态保留。
  const groupIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of grouped) {
      if (row.kind === 'group') {
        ids.push(row.group.id);
      }
    }
    return ids;
  }, [grouped]);

  useEffect(() => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of groupIds) {
        const group = grouped.find(
          (row): row is { kind: 'group'; group: EventGroup } => row.kind === 'group' && row.group.id === id,
        );
        if (group !== undefined && group.group.type !== 'repair_loop' && !prev.has(id)) {
          next.add(id);
        }
      }
      return next;
    });
  }, [groupIds, grouped]);

  const baseRows = useMemo<GanttRow[]>(() => {
    if (semanticGroup) {
      return grouped;
    }
    const flat: GanttRow[] = [];
    for (const row of grouped) {
      if (row.kind === 'event') {
        flat.push(row);
      } else {
        for (const id of row.group.eventIds) {
          const event = events.find((e) => e.id === id);
          if (event !== undefined) {
            flat.push({ kind: 'event', event });
          }
        }
      }
    }
    return flat;
  }, [grouped, semanticGroup, events]);

  const axis = useMemo(() => {
    if (baseRows.length === 0) {
      return null;
    }
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const row of baseRows) {
      const startEvent = row.kind === 'event' ? row.event : row.group.start;
      const endEvent = row.kind === 'event' ? row.event : row.group.end;
      const s = Date.parse(startEvent.startedAt);
      if (s < start) {
        start = s;
      }
      const e = Date.parse(endEvent.startedAt) + endEvent.durationMs;
      if (e > end) {
        end = e;
      }
    }
    return { start, span: Math.max(1, end - start) };
  }, [baseRows]);

  const maxSeq = useMemo(() => events.reduce((max, e) => Math.max(max, e.sequence), 0), [events]);

  /** 可点击阶段轴分段：时间模式按时间占比，序列模式按事件数占比。 */
  const phaseSegments = useMemo(() => {
    if (baseRows.length === 0) {
      return [];
    }
    const acc = new Map<TracePhase, { count: number; start: number; end: number }>();
    for (const row of baseRows) {
      if (row.kind === 'event') {
        const e = row.event;
        const p = acc.get(e.phase) ?? { count: 0, start: Number.POSITIVE_INFINITY, end: 0 };
        p.count += 1;
        p.start = Math.min(p.start, Date.parse(e.startedAt));
        p.end = Math.max(p.end, Date.parse(e.startedAt) + e.durationMs);
        acc.set(e.phase, p);
      } else {
        const g = row.group;
        const p = acc.get(g.phase) ?? { count: 0, start: Number.POSITIVE_INFINITY, end: 0 };
        p.count += g.eventIds.length;
        p.start = Math.min(p.start, Date.parse(g.start.startedAt));
        p.end = Math.max(p.end, Date.parse(g.end.startedAt) + g.end.durationMs);
        acc.set(g.phase, p);
      }
    }
    const phases = TRACE_PHASES.filter((ph) => acc.has(ph));
    if (layoutMode === 'sequence') {
      const total = phases.reduce((sum, ph) => sum + (acc.get(ph)?.count ?? 0), 0) || 1;
      let left = 0;
      return phases.map((ph) => {
        const width = ((acc.get(ph)?.count ?? 0) / total) * 100;
        const seg = { phase: ph, left, width, count: acc.get(ph)?.count ?? 0 };
        left += width;
        return seg;
      });
    }
    const totalStart = Math.min(...phases.map((ph) => acc.get(ph)!.start));
    const totalEnd = Math.max(...phases.map((ph) => acc.get(ph)!.end));
    const span = Math.max(1, totalEnd - totalStart);
    return phases.map((ph) => {
      const data = acc.get(ph)!;
      return {
        phase: ph,
        left: ((data.start - totalStart) / span) * 100,
        width: Math.max(0, ((data.end - data.start) / span) * 100),
        count: data.count,
      };
    });
  }, [baseRows, layoutMode]);

  const phaseCounts = useMemo(() => {
    const counts = new Map<TracePhase, number>();
    for (const event of events) {
      counts.set(event.phase, (counts.get(event.phase) ?? 0) + 1);
    }
    return counts;
  }, [events]);

  const viewWindow = useMemo(() => {
    if (axis === null) {
      return null;
    }
    return zoomRange ?? { start: axis.start, end: axis.start + axis.span };
  }, [axis, zoomRange]);

  const visibleRows = useMemo<DisplayRow[]>(() => {
    const windowStart = viewWindow?.start ?? Number.NEGATIVE_INFINITY;
    const windowEnd = viewWindow?.end ?? Number.POSITIVE_INFINITY;
    const intersects = (startMs: number, endMs: number): boolean =>
      endMs >= windowStart && startMs <= windowEnd;
    const out: DisplayRow[] = [];
    for (const row of baseRows) {
      if (row.kind === 'event') {
        const event = row.event;
        const startMs = Date.parse(event.startedAt);
        if (
          intersects(startMs, startMs + event.durationMs) &&
          matches(event, searchIndex.get(event.id) ?? '', tokens)
        ) {
          out.push({ kind: 'event', event, depth: 0 });
        }
        continue;
      }
      const group = row.group;
      const groupStart = Date.parse(group.start.startedAt);
      const groupEnd = Date.parse(group.end.startedAt) + group.end.durationMs;
      const hasMatch =
        intersects(groupStart, groupEnd) &&
        group.eventIds.some((id) => {
          const event = events.find((e) => e.id === id);
          return event !== undefined && matches(event, searchIndex.get(id) ?? '', tokens);
        });
      if (!hasMatch) {
        continue;
      }
      const collapsedGroup = collapsedIds.has(group.id);
      out.push({ kind: 'group', group, depth: 0, collapsed: collapsedGroup });
      if (!collapsedGroup) {
        for (const id of group.eventIds) {
          const event = events.find((e) => e.id === id);
          if (event !== undefined && intersects(Date.parse(event.startedAt), Date.parse(event.startedAt) + event.durationMs) && matches(event, searchIndex.get(id) ?? '', tokens)) {
            out.push({ kind: 'event', event, depth: 1 });
          }
        }
      }
    }
    return out;
  }, [baseRows, events, searchIndex, tokens, collapsedIds, viewWindow]);

  const matchCount = useMemo(
    () => events.filter((event) => matches(event, searchIndex.get(event.id) ?? '', tokens)).length,
    [events, searchIndex, tokens],
  );

  const { containerRef, range, onScroll } = useVirtualList(visibleRows.length, ROW_HEIGHT);

  useEffect(() => {
    if (hasMore && range.endIndex >= visibleRows.length - 20) {
      onLoadMore();
    }
  }, [hasMore, range.endIndex, visibleRows.length, onLoadMore]);

  const toggleGroup = (group: EventGroup): void => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(group.id)) {
        next.delete(group.id);
      } else {
        next.add(group.id);
      }
      return next;
    });
  };

  const collapseAll = (): void => {
    setCollapsedIds(new Set(groupIds));
  };

  const expandAll = (): void => {
    setCollapsedIds(new Set());
  };

  /** 点击阶段轴片段：展开所在分组、清除缩放，滚动定位到该阶段第一个事件并选中。 */
  const locatePhase = useCallback(
    (phase: TracePhase): void => {
      const needsExpand = grouped.some(
        (row) => row.kind === 'group' && row.group.phase === phase && collapsedIds.has(row.group.id),
      );
      if (needsExpand) {
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          for (const row of grouped) {
            if (row.kind === 'group' && row.group.phase === phase) {
              next.delete(row.group.id);
            }
          }
          return next;
        });
      }
      const clearedZoom = zoomRange !== null;
      if (clearedZoom) {
        setZoomRange(null);
      }
      const target = baseRows.find((row) => row.kind === 'event' && row.event.phase === phase);
      if (target === undefined || target.kind !== 'event') {
        return;
      }
      onSelectEvent(target.event);
      const scrollTo = (): void => {
        const el = rowRefs.current.get(target.event.id);
        el?.scrollIntoView?.({ block: 'nearest' });
        setCursorKey(target.event.id);
      };
      if (needsExpand || clearedZoom) {
        requestAnimationFrame(scrollTo);
      } else {
        scrollTo();
      }
    },
    [baseRows, collapsedIds, grouped, onSelectEvent, zoomRange],
  );

  useEffect(() => {
    if (actionsRef === undefined) {
      return;
    }
    actionsRef.current = { collapseAll, expandAll };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, collapseAll, expandAll]);

  const rowKey = (row: DisplayRow): string => (row.kind === 'event' ? row.event.id : row.group.id);

  const moveCursor = (delta: number): void => {
    const currentIndex = visibleRows.findIndex((row) => rowKey(row) === cursorKey);
    const nextIndex = Math.min(
      visibleRows.length - 1,
      Math.max(0, currentIndex < 0 ? 0 : currentIndex + delta),
    );
    const next = visibleRows[nextIndex];
    if (next !== undefined) {
      setCursorKey(rowKey(next));
    }
  };

  useEffect(() => {
    if (cursorKey === null) {
      return;
    }
    const element = rowRefs.current.get(cursorKey);
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [cursorKey]);

  const onContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing || isEditableTarget(event.target)) {
      return;
    }
    if (event.key === '/' && searchRef.current !== null) {
      event.preventDefault();
      event.stopPropagation();
      searchRef.current.focus();
      return;
    }
    if (visibleRows.length === 0) {
      return;
    }
    const key = event.key;
    if (key === 'j' || key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveCursor(1);
    } else if (key === 'k' || key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveCursor(-1);
    } else if (key === 'h' || key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      const current = visibleRows.find((row) => rowKey(row) === cursorKey);
      if (current !== undefined && current.kind === 'group' && !current.collapsed) {
        toggleGroup(current.group);
      }
    } else if (key === 'l' || key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      const current = visibleRows.find((row) => rowKey(row) === cursorKey);
      if (current !== undefined && current.kind === 'group' && current.collapsed) {
        toggleGroup(current.group);
      }
    } else if (key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const current = visibleRows.find((row) => rowKey(row) === cursorKey);
      if (current === undefined) {
        return;
      }
      if (current.kind === 'event') {
        onSelectEvent(current.event);
      } else {
        toggleGroup(current.group);
      }
    }
  };

  const onAxisPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (layoutMode === 'sequence') {
      return;
    }
    const el = axisRef.current;
    if (el === null || axis === null) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const pctOf = (clientX: number): number =>
      Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const startPct = pctOf(e.clientX);
    const onMove = (ev: globalThis.PointerEvent): void => {
      setDragSel({ startPct, endPct: pctOf(ev.clientX) });
    };
    const onUp = (ev: globalThis.PointerEvent): void => {
      const endPct = pctOf(ev.clientX);
      const lo = Math.min(startPct, endPct);
      const hi = Math.max(startPct, endPct);
      if (hi - lo >= 4) {
        setZoomRange({
          start: axis.start + (lo / 100) * axis.span,
          end: axis.start + (hi / 100) * axis.span,
        });
      }
      setDragSel(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const zoomLabel = (ms: number): string =>
    absoluteTime
      ? new Date(ms).toLocaleTimeString([], { hour12: false })
      : fmtOffset(ms - (axis?.start ?? 0));

  if (baseRows.length === 0) {
    return (
      <div className="gantt ui-empty">
        <span>{t('common.empty', locale)}</span>
      </div>
    );
  }

  const showEmptySearch = query !== '' && matchCount === 0;

  return (
    <div className="gantt-wrap">
      <div className="timeline-toolbar">
        <div className="timeline-mode" role="group" aria-label={t('timeline.mode', locale)}>
          <button
            type="button"
            className={`timeline-chip ${layoutMode === 'time' ? 'timeline-chip-on' : ''}`}
            aria-pressed={layoutMode === 'time'}
            onClick={() => onLayoutModeChange?.('time')}
          >
            {t('timeline.modeTime', locale)}
          </button>
          <button
            type="button"
            className={`timeline-chip ${layoutMode === 'sequence' ? 'timeline-chip-on' : ''}`}
            aria-pressed={layoutMode === 'sequence'}
            onClick={() => onLayoutModeChange?.('sequence')}
          >
            {t('timeline.modeSequence', locale)}
          </button>
        </div>
        <div className="timeline-search">
          <IconSearch size={12} />
          <input
            ref={searchRef}
            type="search"
            className="timeline-search-input"
            placeholder={t('timeline.search', locale)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('timeline.search', locale)}
          />
          {query !== '' && (
            <span className="mono timeline-matches">
              {t('timeline.matches', locale).replace('{n}', String(matchCount))}
            </span>
          )}
        </div>
        <span className="spacer" />
        <button
          type="button"
          className={`timeline-chip ${semanticGroup ? 'timeline-chip-on' : ''}`}
          aria-pressed={semanticGroup}
          title={t('timeline.semanticGroup', locale)}
          onClick={() => onSemanticGroupChange?.(!semanticGroup)}
        >
          <IconChevronDown size={12} />
          {t('timeline.semanticGroup', locale)}
        </button>
        <button type="button" className="timeline-chip" onClick={collapseAll}>
          {t('timeline.collapseAll', locale)}
        </button>
        <button type="button" className="timeline-chip" onClick={expandAll}>
          {t('timeline.expandAll', locale)}
        </button>
        {layoutMode === 'time' && (
          <button
            type="button"
            className="timeline-chip"
            aria-pressed={absoluteTime}
            onClick={() => setAbsoluteTime((prev) => !prev)}
          >
            {absoluteTime ? t('timeline.absolute', locale) : t('timeline.relative', locale)}
          </button>
        )}
        {layoutMode === 'time' && zoomRange !== null && (
          <button
            type="button"
            className="timeline-chip timeline-chip-on"
            onClick={() => setZoomRange(null)}
            title={t('timeline.axisHint', locale)}
          >
            {t('timeline.zoomed', locale)
              .replace('{start}', zoomLabel(zoomRange.start))
              .replace('{end}', zoomLabel(zoomRange.end))}
            {' ✕'}
          </button>
        )}
      </div>
      {onPhaseToggle !== undefined && (
        <div className="timeline-phase-chips" role="group" aria-label={t('timeline.phaseAxis', locale)}>
          {TRACE_PHASES.map((phase) => {
            const active = phaseFilter.includes(phase);
            const PhaseIcon = PHASE_ICON[phase];
            return (
              <button
                key={phase}
                type="button"
                className={`timeline-phase-chip ${active ? 'timeline-phase-chip-on' : ''}`}
                data-phase={phase}
                aria-pressed={active}
                onClick={() => onPhaseToggle(phase)}
              >
                <PhaseIcon size={12} />
                <span>{t(`phase.${phase}`, locale)}</span>
                <span className="mono">{phaseCounts.get(phase) ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}
      {phaseSegments.length > 0 && (
        <div
          className="timeline-phase-axis"
          role="navigation"
          aria-label={t('timeline.phaseAxis', locale)}
          title={t('timeline.phaseAxisHint', locale)}
        >
          {phaseSegments.map((seg) => (
            <button
              key={seg.phase}
              type="button"
              className="timeline-phase-seg"
              data-phase={seg.phase}
              style={{
                left: `${seg.left}%`,
                width: `${Math.max(0.5, seg.width)}%`,
                background: `var(--phase-${seg.phase})`,
              }}
              title={`${t(`phase.${seg.phase}`, locale)} · ${seg.count}`}
              aria-label={`${t(`phase.${seg.phase}`, locale)} ${seg.count}`}
              onClick={() => locatePhase(seg.phase)}
            >
              <span className="timeline-phase-seg-label">
                {t(`phase.${seg.phase}`, locale)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div
        ref={axisRef}
        className={`timeline-axis ${layoutMode === 'sequence' ? 'timeline-axis-seq' : ''}`}
        role="slider"
        aria-label={t('timeline.axisHint', locale)}
        onPointerDown={onAxisPointerDown}
        onDoubleClick={() => setZoomRange(null)}
      >
        {[0, 25, 50, 75, 100].map((pct) => (
          <span
            key={pct}
            className="timeline-axis-tick mono"
            style={{ left: `${pct}%` }}
          >
            {layoutMode === 'sequence'
              ? `#${Math.max(1, Math.round(((pct / 100) * Math.max(1, maxSeq - 1)) + 1))}`
              : axis !== null &&
                zoomLabel(
                  axis.start +
                    (pct / 100) *
                      (viewWindow === null ? axis.span : viewWindow.end - viewWindow.start),
                )}
          </span>
        ))}
        {dragSel !== null && (
          <span
            className="timeline-axis-sel"
            style={{
              left: `${Math.min(dragSel.startPct, dragSel.endPct)}%`,
              width: `${Math.abs(dragSel.endPct - dragSel.startPct)}%`,
            }}
          />
        )}
      </div>
      <div
        ref={(node) => {
          containerRef.current = node;
          scrollRef.current = node;
        }}
        className="gantt"
        style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
        onScroll={onScroll}
        tabIndex={0}
        onKeyDown={onContainerKeyDown}
        aria-label={t('session.phaseRibbon', locale)}
      >
        {showEmptySearch ? (
          <div className="gantt-empty-search">
            <span>{t('timeline.noMatches', locale)}</span>
          </div>
        ) : (
          <div style={{ height: range.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${range.offsetY}px)` }}>
              {visibleRows.slice(range.startIndex, range.endIndex).map((row) => {
                const key = rowKey(row);
                const isCursor = key === cursorKey;
                if (row.kind === 'group') {
                  const group = row.group;
                  const Icon = PHASE_ICON[group.phase];
                  const left =
                    layoutMode === 'sequence'
                      ? ((Math.max(1, group.start.sequence) - 1) / Math.max(1, maxSeq)) * 100
                      : viewWindow === null
                        ? 0
                        : ((Date.parse(group.start.startedAt) - viewWindow.start) /
                            (viewWindow.end - viewWindow.start)) *
                          100;
                  const width =
                    layoutMode === 'sequence'
                      ? ((group.end.sequence - group.start.sequence + 1) / Math.max(1, maxSeq)) * 100
                      : viewWindow === null
                        ? 0
                        : ((Date.parse(group.end.startedAt) +
                            group.end.durationMs -
                            Date.parse(group.start.startedAt)) /
                            (viewWindow.end - viewWindow.start)) *
                          100;
                  return (
                    <div
                      key={key}
                      ref={(node) => {
                        rowRefs.current.set(key, node);
                      }}
                      className={`gantt-row gantt-group-row ${isCursor ? 'gantt-row-cursor' : ''} ${
                        group.failed ? 'gantt-group-failed' : ''
                      }`}
                      style={{ height: ROW_HEIGHT }}
                      tabIndex={0}
                      onClick={() => {
                        scrollRef.current?.focus();
                        setCursorKey(key);
                        toggleGroup(group);
                      }}
                    >
                      <button
                        type="button"
                        className="timeline-toggle"
                        aria-label="toggle group"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCursorKey(key);
                          toggleGroup(group);
                        }}
                      >
                        {row.collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                      </button>
                      <span className="mono gantt-seq">#{group.start.sequence}</span>
                      <Icon className={`timeline-phase-${group.phase}`} size={12} />
                      <div className="timeline-track" aria-hidden="true">
                        <div
                          className="timeline-bar"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(0, width)}%`,
                            minWidth: 'calc(var(--space-1) / 2)',
                            background: `var(--phase-${group.phase})`,
                          }}
                        />
                      </div>
                      <span className="gantt-title gantt-group-title" title={groupLabel(group, locale)}>
                        {groupLabel(group, locale)}
                      </span>
                      <span className="mono gantt-status">{fmtDur(group.durationMs)}</span>
                      {group.failed ? <IconError size={12} /> : <IconSuccess size={12} />}
                    </div>
                  );
                }
                const event = row.event;
                const Icon = PHASE_ICON[event.phase];
                const StatusIcon = STATUS_ICON[event.status];
                const left =
                  layoutMode === 'sequence'
                    ? ((Math.max(1, event.sequence) - 1) / Math.max(1, maxSeq)) * 100
                    : viewWindow === null
                      ? 0
                      : ((Date.parse(event.startedAt) - viewWindow.start) /
                          (viewWindow.end - viewWindow.start)) *
                        100;
                const width =
                  layoutMode === 'sequence'
                    ? (1 / Math.max(1, maxSeq)) * 100
                    : viewWindow === null
                      ? 0
                      : (event.durationMs / (viewWindow.end - viewWindow.start)) * 100;
                const timeLabel =
                  absoluteTime || layoutMode === 'sequence'
                    ? new Date(event.startedAt).toLocaleTimeString([], { hour12: false })
                    : fmtOffset(Date.parse(event.startedAt) - (axis?.start ?? 0));
                return (
                  <div
                    key={key}
                    ref={(node) => {
                      rowRefs.current.set(key, node);
                    }}
                    className={`gantt-row ${event.id === selectedEventId ? 'gantt-row-on' : ''} ${
                      isCursor ? 'gantt-row-cursor' : ''
                    } ${row.depth > 0 ? 'gantt-child-row' : ''}`}
                    data-kind={event.kind}
                    style={{ height: ROW_HEIGHT, paddingLeft: `calc(var(--space-3) * ${row.depth})` }}
                    tabIndex={0}
                    onClick={() => {
                      scrollRef.current?.focus();
                      setCursorKey(key);
                      onSelectEvent(event);
                    }}
                  >
                    <span className="mono gantt-seq">#{event.sequence}</span>
                    <Icon className={`timeline-phase-${event.phase}`} size={12} label={t(`phase.${event.phase}`, locale)} />
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
                      {highlightTitle(event.title, tokens)}
                    </span>
                    {event.hasInput && (
                      <span className="io-badge io-badge-in" title={t('timeline.ioIn', locale)}>
                        in
                      </span>
                    )}
                    {event.hasOutput && (
                      <span className="io-badge io-badge-out" title={t('timeline.ioOut', locale)}>
                        out
                      </span>
                    )}
                    <span className="mono gantt-time">{timeLabel}</span>
                    <span className="mono gantt-status">
                      {event.durationMs >= 1000 ? `${(event.durationMs / 1000).toFixed(1)}s` : `${event.durationMs}ms`}
                    </span>
                    <StatusIcon size={12} label={t(`status.${event.status}`, locale)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {visibleRows.length < total && <div className="hint">…</div>}
      </div>
    </div>
  );
}

function fmtOffset(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }
  const seconds = ms / 1000;
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${Math.round(seconds)}s`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}
