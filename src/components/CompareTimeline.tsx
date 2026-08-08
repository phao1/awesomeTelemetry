import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEvent, TraceEventRaw, TraceEventSlim, TracePhase, TraceStatus } from '../core/trace-types.js';
import type { CompareResult } from './compare-types.js';
import { api } from '../api/client.js';
import { eventDetailCache } from '../cache/caches.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { ErrorState, Skeleton } from './ui/States.js';
import { Tabs } from './ui/Tabs.js';
import { TranscriptModal } from './TranscriptModal.js';
import { TokenTextModal } from './TokenTextModal.js';
import {
  IconCancelled,
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

export type CompareSide = 'left' | 'right';

/** REQ-115：回退分页时的每页事件数。 */
export const COMPARE_TIMELINE_PAGE_SIZE = 200;
/** REQ-115：低于该 FPS 判定虚拟滚动不达标，回退分页。 */
export const FPS_FALLBACK_THRESHOLD = 50;
/** REQ-115：一次帧率采样窗口（ms）。 */
const FPS_SAMPLE_MS = 320;

const ROW_HEIGHT = 28; // --row-sm（与虚拟滚动 itemHeight 一致的常量）

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

/** REQ-115：由 rAF 时间戳序列算平均 FPS。样本不足或时间跨度为 0 时返回 null。 */
export function measureFps(frameTimes: number[]): number | null {
  if (frameTimes.length < 2) {
    return null;
  }
  const span = frameTimes[frameTimes.length - 1]! - frameTimes[0]!;
  if (span <= 0) {
    return null;
  }
  return ((frameTimes.length - 1) / span) * 1000;
}

/**
 * REQ-115：滚动帧率哨兵 —— 虚拟滚动期间采样一次 rAF 节奏，
 * 平均 FPS < 50 时永久回退分页（G-C2：实现细节，不暴露为用户开关）。
 */
function useScrollFpsGuard(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || degraded || el === null) {
      return;
    }
    let sampling = false;
    let raf = 0;
    const onScroll = (): void => {
      if (sampling) {
        return;
      }
      sampling = true;
      const frames: number[] = [];
      const tick = (ts: number): void => {
        frames.push(ts);
        if (ts - frames[0]! < FPS_SAMPLE_MS) {
          raf = requestAnimationFrame(tick);
          return;
        }
        sampling = false;
        const fps = measureFps(frames);
        if (fps !== null && fps < FPS_FALLBACK_THRESHOLD) {
          setDegraded(true);
        }
      };
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener('scroll', onScroll, true);
    return () => {
      el.removeEventListener('scroll', onScroll, true);
      cancelAnimationFrame(raf);
    };
  }, [ref, enabled, degraded]);
  return degraded;
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
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

/**
 * 自包含紧凑时间线（建议 8 / REQ-114/115）。
 *
 * 原来的实现复用 `TraceTimeline`（时间/序列双模式甘特）+ `EventInspector`。
 * `TraceTimeline` / `EventInspector` 已随 add-trajectory-inspector 删除
 * （tasks §6.1，orchestrator 授权的最小化 compare 改造），本组件改为内置的
 * 无依赖迷你时间线：相同的 `.gantt-wrap` / `.timeline-mode` / `.gantt-row`
 * 结构，虚拟滚动 + FPS 回退分页语义保持不变。
 */
export interface CompareMiniTimelineProps {
  events: TraceEventSlim[];
  total: number;
  locale: Locale;
  mode: 'time' | 'sequence';
  onModeChange?: (mode: 'time' | 'sequence') => void;
  selectedEventId?: string | null;
  onSelectEvent?: (event: TraceEventSlim) => void;
  /** KPI drilldown 等嵌入场景：无工具栏、无选择、无虚拟滚动。 */
  compact?: boolean;
}

export function CompareMiniTimeline({
  events,
  total,
  locale,
  mode,
  onModeChange,
  selectedEventId = null,
  onSelectEvent,
  compact = false,
}: CompareMiniTimelineProps): React.JSX.Element {
  const maxDuration = useMemo(
    () => events.reduce((max, e) => Math.max(max, e.durationMs), 0),
    [events],
  );
  const { containerRef, range, onScroll } = useVirtualList(events.length, ROW_HEIGHT);
  const shown = compact ? events : events.slice(range.startIndex, range.endIndex);
  const offsetY = compact ? 0 : range.startIndex * ROW_HEIGHT;
  const totalHeight = compact ? 0 : events.length * ROW_HEIGHT;

  return (
    <div className="gantt-wrap">
      {!compact && (
        <div className="timeline-mode" role="group" aria-label={t('timeline.mode', locale)}>
          <button
            type="button"
            className={`timeline-chip ${mode === 'time' ? 'timeline-chip-on' : ''}`}
            aria-pressed={mode === 'time'}
            onClick={() => onModeChange?.('time')}
          >
            {t('timeline.modeTime', locale)}
          </button>
          <button
            type="button"
            className={`timeline-chip ${mode === 'sequence' ? 'timeline-chip-on' : ''}`}
            aria-pressed={mode === 'sequence'}
            onClick={() => onModeChange?.('sequence')}
          >
            {t('timeline.modeSequence', locale)}
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="compare-timeline-scroll"
        style={{ position: 'relative', overflowY: 'auto', flex: 1, minHeight: 0 }}
        onScroll={onScroll}
      >
        <div style={{ height: compact ? 'auto' : totalHeight, position: 'relative' }}>
          <div style={compact ? undefined : { transform: `translateY(${offsetY}px)` }}>
            {shown.map((event) => {
              const PhaseIcon = PHASE_ICON[event.phase];
              const StatusIcon = STATUS_ICON[event.status];
              const selected = event.id === selectedEventId;
              const barWidth =
                mode === 'sequence' || maxDuration === 0
                  ? '100%'
                  : `${Math.max(0, (event.durationMs / maxDuration) * 100)}%`;
              return (
                <div
                  key={event.id}
                  className={`gantt-row ${selected ? 'gantt-row-on' : ''}`}
                  data-side-row
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onSelectEvent?.(event)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectEvent?.(event);
                    }
                  }}
                >
                  <span className="mono gantt-seq">#{event.sequence}</span>
                  <PhaseIcon
                    className={`timeline-phase-${event.phase}`}
                    size={12}
                    label={t(`phase.${event.phase}`, locale)}
                  />
                  <div className="timeline-track" aria-hidden="true">
                    <div
                      className="timeline-bar"
                      style={{ width: barWidth, background: `var(--phase-${event.phase})` }}
                    />
                  </div>
                  <span className="gantt-title" title={event.title}>
                    {event.title}
                  </span>
                  <span className="mono gantt-time">{fmtOffset(event.durationMs)}</span>
                  <span className="mono gantt-status">{fmtDuration(event.durationMs)}</span>
                  <StatusIcon size={12} label={t(`status.${event.status}`, locale)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!compact && shown.length < total && <p className="hint">…</p>}
    </div>
  );
}

type PanelTab = 'summary' | 'raw';

/**
 * 替换被删除 `EventInspector` 的 compact 事件面板（REQ-114）：
 * Summary + Raw 两个页签，正文按需拉取（eventDetailCache 100 项 LRU）。
 */
function CompareEventPanel({
  sessionKey,
  event,
  locale,
  onClose,
  onOpenTranscript,
  onOpenTokens,
}: {
  sessionKey: string;
  event: TraceEventSlim;
  locale: Locale;
  onClose: () => void;
  onOpenTranscript: (event: TraceEventSlim) => void;
  onOpenTokens: (event: TraceEventSlim) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<PanelTab>('summary');
  const [detail, setDetail] = useState<TraceEvent | TraceEventRaw | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheKey = `${sessionKey}:${event.id}`;

  useEffect(() => {
    setDetail(null);
    setRaw(null);
    setError(null);
    const cached = eventDetailCache.get(cacheKey);
    if (cached !== undefined) {
      setDetail(cached);
      return;
    }
    void api
      .eventDetail(sessionKey, event.id)
      .then((loaded) => {
        eventDetailCache.set(cacheKey, loaded);
        setDetail(loaded);
      })
      .catch((err: unknown) => {
        console.error('[compare] 事件正文加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [sessionKey, event.id, cacheKey]);

  useEffect(() => {
    if (tab !== 'raw' || event === null || raw !== null || rawLoading) {
      return;
    }
    setRawLoading(true);
    void api
      .eventDetail(sessionKey, event.id, true)
      .then((loaded) => {
        setRaw((loaded as TraceEventRaw).raw ?? null);
        setRawLoading(false);
      })
      .catch((err: unknown) => {
        console.error('[compare] raw 拉取失败:', err);
        setRawLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [tab, raw, rawLoading, sessionKey, event.id]);

  const retry = (): void => {
    setError(null);
    setDetail(null);
    void api
      .eventDetail(sessionKey, event.id)
      .then((loaded) => {
        eventDetailCache.set(cacheKey, loaded);
        setDetail(loaded);
      })
      .catch((err: unknown) => {
        console.error('[compare] 重试失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'raw', label: t('event.raw', locale) },
  ];

  return (
    <div className="compare-event-panel">
      <header className="inspector-header">
        <span className="mono">#{event.sequence}</span>
        <span className="compare-event-panel-title" title={event.title}>
          {event.title}
        </span>
        <button
          type="button"
          className="ui-icon-btn ui-btn-sm"
          aria-label={t('a11y.close', locale)}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="inspector-tabs">
        <Tabs
          variant="underline"
          activeId={tab}
          onChange={(id) => setTab(id as PanelTab)}
          items={tabs}
        />
      </div>
      <div className="inspector-body">
        {error !== null && (
          <ErrorState code="EVENT_DETAIL_FAILED" message={error} onRetry={retry} />
        )}
        {error === null && detail === null && <Skeleton variant="block" count={2} />}
        {error === null && detail !== null && tab === 'summary' && (
          <div>
            <p className="meta">
              {event.kind} · {event.phase} · {event.status} · {event.durationMs}ms
            </p>
            <p>
              {event.actor} · {event.tool ?? '—'}
            </p>
            {event.error !== null && (
              <section>
                <h5>{t('event.error', locale)}</h5>
                <pre className="mono">{event.error}</pre>
              </section>
            )}
            <div className="inspector-actions">
              <button type="button" className="btn" onClick={() => onOpenTranscript(event)}>
                {t('transcript.title', locale)}
              </button>
              <button type="button" className="btn" onClick={() => onOpenTokens(event)}>
                {t('token.title', locale)}
              </button>
            </div>
          </div>
        )}
        {error === null && tab === 'raw' &&
          (rawLoading ? (
            <Skeleton variant="block" count={1} />
          ) : raw === null ? (
            <p className="hint">{t('common.empty', locale)}</p>
          ) : (
            <pre className="mono">{raw}</pre>
          ))}
      </div>
    </div>
  );
}

export interface CompareTimelineProps {
  result: CompareResult;
  locale: Locale;
  /** 测试注入：直接进入 REQ-115 的分页回退模式。 */
  initialPaged?: boolean;
}

/**
 * 建议 8 + REQ-114/115：Compare 时间线。
 * - 左右各自独立的时间/序列模式切换
 * - 事件可点选 → 右侧 compact 事件面板（Summary + Raw）
 * - 无 200 事件硬上限：默认虚拟滚动，FPS 不达标回退分页
 */
export function CompareTimeline({
  result,
  locale,
  initialPaged = false,
}: CompareTimelineProps): React.JSX.Element {
  const [leftMode, setLeftMode] = useState<'time' | 'sequence'>('time');
  const [rightMode, setRightMode] = useState<'time' | 'sequence'>('time');
  const [selected, setSelected] = useState<{ side: CompareSide; event: TraceEventSlim } | null>(null);
  const [page, setPage] = useState<Record<CompareSide, number>>({ left: 0, right: 0 });
  const [transcript, setTranscript] = useState<TraceEventSlim | null>(null);
  const [tokenEvent, setTokenEvent] = useState<TraceEventSlim | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const degraded = useScrollFpsGuard(wrapRef, !initialPaged);
  const paged = initialPaged || degraded;

  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const leftName = result.left.session.title || result.left.session.id;
  const rightName = result.right.session.title || result.right.session.id;

  // REQ-114：Esc 取消选中并关闭面板。
  useEffect(() => {
    if (selected === null) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const pageCount = (events: TraceEventSlim[]): number =>
    Math.max(1, Math.ceil(events.length / COMPARE_TIMELINE_PAGE_SIZE));

  const sideEvents = (side: CompareSide, events: TraceEventSlim[]): TraceEventSlim[] => {
    if (!paged) {
      return events;
    }
    const start = page[side] * COMPARE_TIMELINE_PAGE_SIZE;
    return events.slice(start, start + COMPARE_TIMELINE_PAGE_SIZE);
  };

  const selectedSession = useMemo(
    () => (selected === null ? null : result[selected.side].session),
    [selected, result],
  );

  const renderSide = (
    side: CompareSide,
    events: TraceEventSlim[],
    total: number,
    name: string,
    mode: 'time' | 'sequence',
    onModeChange: (mode: 'time' | 'sequence') => void,
  ): React.JSX.Element => {
    const shown = sideEvents(side, events);
    const pages = pageCount(events);
    const current = Math.min(page[side], pages - 1);
    return (
      <div className="compare-timeline" data-side={side}>
        <h4>
          <span
            className="compare-side-mark"
            style={{ color: side === 'left' ? 'var(--accent-fg)' : 'var(--attention-fg)' }}
          >
            {side === 'left' ? 'L' : 'R'}
          </span>
          {' '}{name}
        </h4>
        <CompareMiniTimeline
          events={shown}
          total={total}
          locale={locale}
          mode={mode}
          onModeChange={onModeChange}
          selectedEventId={selected?.event.id ?? null}
          onSelectEvent={(event) => setSelected({ side, event })}
        />
        <footer className="compare-timeline-foot">
          <span className="mono compare-timeline-count">
            {t('compare.timeline.showing', locale)
              .replace('{x}', String(shown.length))
              .replace('{y}', String(Math.max(total, events.length)))}
          </span>
          {paged && pages > 1 && (
            <span className="compare-timeline-pager">
              <button
                type="button"
                className="timeline-chip"
                disabled={current <= 0}
                aria-label={t('compare.timeline.prevPage', locale)}
                onClick={() => setPage((prev) => ({ ...prev, [side]: Math.max(0, current - 1) }))}
              >
                ←
              </button>
              <span className="mono">
                {t('compare.timeline.page', locale)
                  .replace('{n}', String(current + 1))
                  .replace('{total}', String(pages))}
              </span>
              <button
                type="button"
                className="timeline-chip"
                disabled={current >= pages - 1}
                aria-label={t('compare.timeline.nextPage', locale)}
                onClick={() => setPage((prev) => ({ ...prev, [side]: Math.min(pages - 1, current + 1) }))}
              >
                →
              </button>
            </span>
          )}
        </footer>
      </div>
    );
  };

  return (
    <>
      <div
        className={`compare-timelines ${selected !== null ? 'compare-timelines-inspecting' : ''}`}
        ref={wrapRef}
        onClick={(e) => {
          // REQ-114：点击空白区域取消选中。
          if (e.target === e.currentTarget) {
            setSelected(null);
          }
        }}
      >
        {renderSide('left', leftEvents, result.left.eventTotal, leftName, leftMode, setLeftMode)}
        {renderSide('right', rightEvents, result.right.eventTotal, rightName, rightMode, setRightMode)}
        {selected !== null && selectedSession !== null && (
          <div className="timeline-inspector-panel" role="complementary">
            <CompareEventPanel
              sessionKey={selectedSession.id}
              event={selected.event}
              locale={locale}
              onClose={() => setSelected(null)}
              onOpenTranscript={setTranscript}
              onOpenTokens={setTokenEvent}
            />
          </div>
        )}
      </div>
      {transcript !== null && selectedSession !== null && (
        <TranscriptModal
          sessionKey={selectedSession.id}
          title={transcript.title}
          locale={locale}
          onClose={() => setTranscript(null)}
        />
      )}
      {tokenEvent !== null && selectedSession !== null && (
        <TokenTextModal
          sessionKey={selectedSession.id}
          provider={selectedSession.provider}
          agentName={selectedSession.sourceAgent}
          tokenClass={tokenEvent.kind === 'user_prompt' ? 'input' : tokenEvent.kind === 'system' ? 'system' : 'output'}
          tokenCount={tokenEvent.tokens?.total ?? 0}
          locale={locale}
          onClose={() => setTokenEvent(null)}
        />
      )}
    </>
  );
}
