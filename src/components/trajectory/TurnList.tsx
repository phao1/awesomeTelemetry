import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  DurationSource,
  TraceEvent,
  TraceEventRaw,
  TraceTurn,
  TurnModel,
} from '../../core/trace-types.js';
import { useVirtualList } from '../../hooks/useVirtualList.js';
import { TurnCard } from './TurnCard.js';
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

/**
 * D12 TurnList：索引序回合列表，折叠行高固定（--row-lg），>50 回合虚拟滚动
 * （复用 useVirtualList）；展开的回合脱离高度虚拟化、按自然高度渲染
 * （D20）。incompleteness banner 常驻，命名被省略的事件数（D17）。
 */
export function TurnList({
  model,
  sessionKey,
  locale,
  durationSource,
  expandedIndex,
  onToggleTurn,
  onActiveTurnChange,
  focusTurnIndex = null,
  loadDetail,
  loadRaw,
}: TurnListProps): React.JSX.Element {
  const virtualize = model.turns.length > VIRTUAL_THRESHOLD && expandedIndex === null;
  const { containerRef, range, onScroll: hookOnScroll } = useVirtualList(
    virtualize ? model.turns.length : 0,
    ROW_HEIGHT,
  );
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
  const rafRef = useRef(0);

  const itemHeight = useCallback(
    (index: number): number =>
      index === expandedIndex ? (expandedHeight ?? ROW_HEIGHT) : ROW_HEIGHT,
    [expandedIndex, expandedHeight],
  );

  /** top-most fully visible 回合：第一行 top >= scrollTop（两种路径同一公式）。 */
  const topMostVisibleIndex = useCallback(
    (scrollTop: number): number => {
      const count = model.turns.length;
      if (count === 0) {
        return -1;
      }
      let offset = 0;
      for (let index = 0; index < count; index += 1) {
        const height = itemHeight(index);
        if (offset + height > scrollTop) {
          return index;
        }
        offset += height;
      }
      return count - 1;
    },
    [model.turns.length, itemHeight],
  );

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      hookOnScroll(event);
      const top = event.currentTarget.scrollTop;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const index = topMostVisibleIndex(top);
        onActiveTurnChange?.(index < 0 ? null : index);
      });
    },
    [hookOnScroll, topMostVisibleIndex, onActiveTurnChange],
  );

  // 色带激活 / findings 定位：滚动到目标回合并展开（零请求，D16）。
  useEffect(() => {
    if (focusTurnIndex === null) {
      return;
    }
    onToggleTurn(focusTurnIndex);
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el === null) {
        return;
      }
      let offset = 0;
      for (let index = 0; index < focusTurnIndex; index += 1) {
        offset += itemHeight(index);
      }
      el.scrollTop = offset;
    });
    return () => cancelAnimationFrame(raf);
    // 仅 focusTurnIndex 驱动；避免展开态变化重触发。
  }, [focusTurnIndex]);

  const expandedRef = useCallback(
    (el: HTMLDivElement | null): void => {
      if (el !== null) {
        const height = el.getBoundingClientRect().height;
        if (height > 0) {
          setExpandedHeight(height);
        }
      }
    },
    [expandedIndex],
  );

  const rows =
    virtualize
      ? model.turns.slice(range.startIndex, range.endIndex)
      : model.turns;

  return (
    <div className="turn-list">
      {!model.complete && (
        <div className="turn-list-banner" role="alert">
          <IconWarning size={12} />
          {t('trajectory.incomplete.banner', locale).replace('{n}', String(model.omittedEventCount))}
        </div>
      )}
      <div
        ref={containerRef}
        className="turn-list-scroll"
        role="list"
        aria-label={t('trajectory.pill.turns', locale)}
        onScroll={onScroll}
      >
        {virtualize ? (
          <div style={{ height: range.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${range.offsetY}px)` }}>
              {rows.map((turn) => (
                <TurnRow
                  key={turn.index}
                  turn={turn}
                  locale={locale}
                  expanded={turn.index === expandedIndex}
                  onToggle={() => onToggleTurn(turn.index)}
                  expandedRef={turn.index === expandedIndex ? expandedRef : undefined}
                  sessionKey={sessionKey}
                  durationSource={durationSource}
                  loadDetail={loadDetail}
                  loadRaw={loadRaw}
                />
              ))}
            </div>
          </div>
        ) : (
          rows.map((turn) => (
            <TurnRow
              key={turn.index}
              turn={turn}
              locale={locale}
              expanded={turn.index === expandedIndex}
              onToggle={() => onToggleTurn(turn.index)}
              expandedRef={turn.index === expandedIndex ? expandedRef : undefined}
              sessionKey={sessionKey}
              durationSource={durationSource}
              loadDetail={loadDetail}
              loadRaw={loadRaw}
            />
          ))
        )}
        {model.turns.length === 0 && (
          <p className="hint" style={{ padding: 'var(--space-3)' }}>
            {t('trajectory.turn.empty', locale)}
          </p>
        )}
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
          {t('trajectory.pill.cacheRate', locale)} {turn.tokens.cacheRead.toLocaleString()} ·{' '}
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
