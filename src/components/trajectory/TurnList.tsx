import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  DurationSource,
  TraceEvent,
  TraceEventRaw,
  TraceTurn,
  TurnModel,
} from '../../core/trace-types.js';
import { TurnCard } from './TurnCard.js';
import { useVirtualList } from '../../hooks/useVirtualList.js';
import {
  IconChevronDown,
  IconCommand,
  IconError,
  IconRunning,
  IconSuccess,
  IconSystem,
  IconTool,
  IconUnderstand,
  IconWarning,
  type IconProps,
} from '../icons/index.js';

export interface TurnListProps {
  model: TurnModel;
  sessionKey: string;
  locale: Locale;
  durationSource?: DurationSource;
  /** 展开的回合索引（hash `turn`，D18）；null = 全部折叠。 */
  expandedIndex: number | null;
  onToggleTurn: (index: number) => void;
  /** 双向高亮写回：列表滚动 → top-most fully visible 回合（rAF 节流）。 */
  onActiveTurnChange?: (index: number | null) => void;
  /** 色带激活 / findings 定位：滚动到该回合并展开（零请求）。 */
  focusTurnIndex?: number | null;
  focusRequest?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
}

/** 折叠行高 = --row-lg（G-DS-1：虚拟滚动 itemHeight 必须为常量）。 */
const ROW_HEIGHT = 44;
/** D20：虚拟滚动在 50 回合以上激活。 */
const VIRTUAL_THRESHOLD = 50;

const BADGE_ICON: Record<string, (props: IconProps) => React.JSX.Element> = {
  init: IconSystem,
  user: IconCommand,
  tools: IconTool,
  stop: IconSuccess,
  error: IconError,
  subagent: IconUnderstand,
  compact: IconChevronDown,
  running: IconRunning,
};

function fmtTime(iso: string): string {
  return iso.slice(11, 19);
}

function fmtDur(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

/** Window collapsed rows around a single naturally sized expanded turn. */
export function computeTurnWindow(
  count: number, scrollTop: number, viewport: number,
  expandedPosition: number, expandedHeight: number,
): { start: number; end: number; total: number; offset: (position: number) => number } {
  const extra = expandedPosition < 0 ? 0 : expandedHeight;
  const offset = (position: number): number => position * ROW_HEIGHT +
    (expandedPosition >= 0 && position > expandedPosition ? extra : 0);
  // Binary search handles a very tall expanded turn without losing subsequent rows.
  const locate = (pixel: number): number => {
    let low = 0;
    let high = count;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (offset(mid + 1) <= pixel) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return {
    start: Math.max(0, locate(scrollTop) - 10),
    end: Math.min(count, locate(scrollTop + viewport) + 11),
    total: count * ROW_HEIGHT + extra,
    offset,
  };
}

export function TurnList({
  model, sessionKey, locale, durationSource, expandedIndex, onToggleTurn,
  onActiveTurnChange, focusTurnIndex = null, focusRequest = 0, loadDetail, loadRaw,
  hasMore = false, loadingMore = false, loadMoreError = null, onLoadMore,
}: TurnListProps): React.JSX.Element {
  const virtualize = model.turns.length > VIRTUAL_THRESHOLD;
  const { containerRef, range, onScroll: collapsedOnScroll } = useVirtualList(
    virtualize ? model.turns.length : 0, ROW_HEIGHT,
  );
  const expandedElement = useRef<HTMLDivElement | null>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const rafRef = useRef(0);
  const expandedPosition = model.turns.findIndex((turn) => turn.index === expandedIndex);
  const window = expandedPosition < 0
    ? { start: range.startIndex, end: range.endIndex, total: range.totalHeight, offset: (position: number) => position * ROW_HEIGHT }
    : computeTurnWindow(model.turns.length, scrollTop, viewport, expandedPosition, expandedHeight);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => setViewport(el.clientHeight || 600);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  // Re-measure when an event body, tool renderer or Raw pane changes height.
  useLayoutEffect(() => {
    setExpandedHeight(0);
    const el = expandedElement.current;
    if (!el) return;
    const measure = (): void => setExpandedHeight(el.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [expandedIndex, sessionKey]);

  const scrollToPosition = (position: number): void => {
    const el = containerRef.current;
    if (!el) return;
    // Called after choosing a turn: all preceding rows are now collapsed.
    const top = Math.max(0, position * ROW_HEIGHT);
    el.scrollTop = top;
    setScrollTop(el.scrollTop);
    onActiveTurnChange?.(model.turns[position]?.index ?? null);
  };

  useLayoutEffect(() => {
    if (expandedPosition >= 0) scrollToPosition(expandedPosition);
    // Selection changes should reveal its header; body measurements must not reset reading.
  }, [expandedIndex, sessionKey]);

  useEffect(() => {
    if (focusTurnIndex === null) return;
    const position = model.turns.findIndex((turn) => turn.index === focusTurnIndex);
    if (position < 0) return;
    if (expandedIndex !== focusTurnIndex) onToggleTurn(focusTurnIndex);
    else scrollToPosition(position);
  }, [focusTurnIndex, focusRequest]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    collapsedOnScroll(event);
    const el = event.currentTarget;
    const top = el.scrollTop;
    if (hasMore && !loadingMore && loadMoreError === null && el.scrollHeight - top - el.clientHeight < ROW_HEIGHT * 5) {
      onLoadMore?.();
    }
    setScrollTop(top);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const current = computeTurnWindow(model.turns.length, top, 0, expandedPosition, expandedHeight);
      const position = Math.min(model.turns.length - 1, current.start + 10);
      // At the beginning the overscan clamps; derive the actual containing row.
      let visible = Math.max(0, position);
      while (visible > 0 && current.offset(visible) > top) visible -= 1;
      while (visible + 1 < model.turns.length && current.offset(visible + 1) <= top) visible += 1;
      onActiveTurnChange?.(model.turns[visible]?.index ?? null);
    });
  };

  const positions = virtualize
    ? Array.from({ length: Math.max(0, window.end - window.start) }, (_, i) => window.start + i)
    : model.turns.map((_, i) => i);
  // Keep the expanded card mounted while scrolling away, preserving body state and cache.
  if (virtualize && expandedPosition >= 0 && !positions.includes(expandedPosition)) {
    positions.push(expandedPosition);
    positions.sort((a, b) => a - b);
  }
  const row = (position: number): React.JSX.Element => {
    const turn = model.turns[position]!;
    return <TurnRow key={turn.index} turn={turn} locale={locale}
      expanded={turn.index === expandedIndex} onToggle={() => onToggleTurn(turn.index)}
      expandedRef={turn.index === expandedIndex ? (el) => { expandedElement.current = el; } : undefined}
      sessionKey={sessionKey} durationSource={durationSource} loadDetail={loadDetail} loadRaw={loadRaw} />;
  };

  return (
    <div className="turn-list">
      {!model.complete && <div className="turn-list-banner" role="alert"><IconWarning size={12} />
        <span>{t('trajectory.incomplete.banner', locale).replace('{n}', String(model.omittedEventCount))}</span>
        {hasMore && onLoadMore && <button type="button" className="btn ui-btn-sm" disabled={loadingMore}
          onClick={onLoadMore}>{t(loadingMore ? 'trajectory.loadingMore' : 'trajectory.loadMore', locale)}</button>}
        {loadMoreError && <span>{loadMoreError}</span>}
      </div>}
      <div ref={containerRef} className="turn-list-scroll" role="list" tabIndex={0}
        aria-label={t('trajectory.pill.turns', locale)} onScroll={onScroll}>
        {virtualize ? <div style={{ height: window.total, position: 'relative' }}>
          {positions.map((position) => <div key={model.turns[position]!.index}
            style={{ position: 'absolute', top: window.offset(position), width: '100%' }}>{row(position)}</div>)}
        </div> : positions.map(row)}
        {!model.turns.length && <p className="hint" style={{ padding: 'var(--space-3)' }}>{t('trajectory.turn.empty', locale)}</p>}
      </div>
    </div>
  );
}

function TurnRow({
  turn,
  locale,
  expanded,
  onToggle,
  expandedRef,
  sessionKey,
  durationSource,
  loadDetail,
  loadRaw,
}: {
  turn: TraceTurn;
  locale: Locale;
  expanded: boolean;
  onToggle: () => void;
  expandedRef?: (el: HTMLDivElement | null) => void;
  sessionKey: string;
  durationSource?: DurationSource;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
}): React.JSX.Element {
  return (
    <div className={expanded ? 'turn-row-cell-expanded' : 'turn-row-cell'}>
      <button
        type="button"
        className={`turn-row ${expanded ? 'turn-row-on' : ''}`}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="turn-row-index mono">
          {t('trajectory.turn.title', locale).replace('{index}', String(turn.index))}
        </span>
        <span className="turn-row-time mono">{fmtTime(turn.startedAt)}</span>
        <span className="turn-row-model mono" title={turn.model ?? undefined}>
          {turn.model ?? '—'}
        </span>
        <span className="turn-row-badges">
          {turn.badges.map((badge) => {
            const Icon = BADGE_ICON[badge];
            if (Icon === undefined) {
              return null;
            }
            return (
              <span key={badge} className={`turn-badge turn-badge-${badge}`}>
                <Icon size={12} />
                {t(`trajectory.badge.${badge}` as const, locale)}
              </span>
            );
          })}
        </span>
        <span className="turn-row-tokens mono">
          {t('trajectory.pill.input', locale)} {turn.tokens.input.toLocaleString()} ·{' '}
          {t('trajectory.cachedTokens', locale)} {turn.tokens.cacheRead.toLocaleString()} ·{' '}
          {t('trajectory.pill.output', locale)} {turn.tokens.output.toLocaleString()}
        </span>
        <span className="turn-row-duration mono">{fmtDur(turn.durationMs)}</span>
        <span className="turn-row-duration mono">{turn.messageCount} msg</span>
      </button>
      {expanded && (
        <div ref={expandedRef}>
          <TurnCard
            turn={turn}
            sessionKey={sessionKey}
            locale={locale}
            durationSource={durationSource}
            loadDetail={loadDetail}
            loadRaw={loadRaw}
          />
        </div>
      )}
    </div>
  );
}
