import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import type { CompareResult } from './compare-types.js';
import { TraceTimeline } from './TraceTimeline.js';
import { EventInspector } from './EventInspector.js';
import { TranscriptModal } from './TranscriptModal.js';
import { TokenTextModal } from './TokenTextModal.js';

export type CompareSide = 'left' | 'right';

/** REQ-115：回退分页时的每页事件数。 */
export const COMPARE_TIMELINE_PAGE_SIZE = 200;
/** REQ-115：低于该 FPS 判定虚拟滚动不达标，回退分页。 */
export const FPS_FALLBACK_THRESHOLD = 50;
/** REQ-115：一次帧率采样窗口（ms）。 */
const FPS_SAMPLE_MS = 320;

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

export interface CompareTimelineProps {
  result: CompareResult;
  locale: Locale;
  /** 测试注入：直接进入 REQ-115 的分页回退模式。 */
  initialPaged?: boolean;
}

/**
 * 建议 8 + REQ-114/115：Compare 时间线。
 * - 左右各自独立的时间/序列模式切换
 * - 事件可点选 → 右侧 compact Inspector（复用 EventInspector 的 Summary + Raw）
 * - 无 200 事件硬上限：默认虚拟滚动（TraceTimeline 内置），FPS 不达标回退分页
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
        <TraceTimeline
          events={shown}
          total={total}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={(event) => setSelected({ side, event })}
          selectedEventId={selected?.event.id ?? null}
          locale={locale}
          layoutMode={mode}
          onLayoutModeChange={onModeChange}
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
            <EventInspector
              sessionKey={selectedSession.id}
              event={selected.event}
              locale={locale}
              fontPx={13}
              width={0}
              collapsed={false}
              fillParent
              initialTab="summary"
              visibleTabs={['summary', 'raw']}
              onResize={() => undefined}
              onToggleCollapse={() => setSelected(null)}
              onOpenTranscript={setTranscript}
              onOpenTokens={setTokenEvent}
              onClose={() => setSelected(null)}
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
