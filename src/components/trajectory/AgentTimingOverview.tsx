import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { AgentGraph, AgentLaneSpan } from '../../core/agent-graph.js';

export interface AgentTimingOverviewProps {
  locale: Locale;
  graph: AgentGraph;
  selectedNodeId: string | null;
  activeTurnIndex: number | null;
  onFocusEvent: (eventId: string) => void;
}

const LANE_HEIGHT = 18;
const LABEL_WIDTH = 88;
const MIN_BAR_PX = 2;

function laneColor(index: number): string {
  const tokens = [
    'var(--role-assistant-fg)',
    'var(--role-tool-fg)',
    'var(--role-user-fg)',
    'var(--role-reasoning-fg)',
    'var(--role-system-fg)',
    'var(--neutral-fg)',
  ];
  return tokens[index % tokens.length]!;
}

function visibleSpans(graph: AgentGraph, selectedNodeId: string | null): AgentLaneSpan[] {
  if (selectedNodeId === null) {
    return graph.spans;
  }
  const focused = graph.spans.filter((span) => span.nodeId === selectedNodeId);
  return focused.length > 0 ? focused : graph.spans;
}

/**
 * DSH-inspired timing overview: one lane per in-session agent, bars projected
 * from real event start/duration. Click a bar to jump the turn ledger.
 * Zero extra requests. Colors are paired with lane labels so color never
 * carries meaning alone (design-system T2).
 */
export function AgentTimingOverview({
  locale,
  graph,
  selectedNodeId,
  activeTurnIndex,
  onFocusEvent,
}: AgentTimingOverviewProps): React.JSX.Element | null {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(640);

  useEffect(() => {
    const el = hostRef.current;
    if (el === null) {
      return;
    }
    const measure = (): void => {
      if (el.clientWidth > 0) {
        setWidthPx(el.clientWidth);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const lanes = graph.nodes;
  const windowMs = Math.max(1, graph.endMs - graph.startMs);
  const plotWidth = Math.max(120, widthPx - LABEL_WIDTH);
  const height = Math.max(LANE_HEIGHT, lanes.length * LANE_HEIGHT);
  const spans = useMemo(
    () => visibleSpans(graph, selectedNodeId),
    [graph, selectedNodeId],
  );

  if (graph.spans.length === 0 || lanes.length === 0) {
    return null;
  }

  return (
    <section
      ref={hostRef}
      className="agent-timing"
      aria-label={t('trajectory.timing.title', locale)}
    >
      <header className="agent-timing-head">
        <span>{t('trajectory.timing.title', locale)}</span>
        <span className="mono">
          {t('trajectory.timing.parallel', locale).replace(
            '{ratio}',
            graph.parallelismRatio.toFixed(2),
          )}
        </span>
      </header>
      <svg
        className="agent-timing-svg"
        width="100%"
        height={height}
        viewBox={`0 0 ${Math.max(widthPx, LABEL_WIDTH + 120)} ${height}`}
        role="img"
      >
        {lanes.map((lane, index) => {
          const y = index * LANE_HEIGHT;
          return (
            <g key={lane.id}>
              <text
                x={4}
                y={y + LANE_HEIGHT * 0.72}
                className="agent-timing-label"
              >
                {lane.label.slice(0, 12)}
              </text>
              <line
                x1={LABEL_WIDTH}
                x2={LABEL_WIDTH + plotWidth}
                y1={y + LANE_HEIGHT - 1}
                y2={y + LANE_HEIGHT - 1}
                className="agent-timing-grid"
              />
              {spans
                .filter((span) => span.nodeId === lane.id)
                .map((span) => {
                  const left =
                    LABEL_WIDTH +
                    ((span.startMs - graph.startMs) / windowMs) * plotWidth;
                  const rawW = ((span.endMs - span.startMs) / windowMs) * plotWidth;
                  const w = Math.max(MIN_BAR_PX, rawW);
                  const active =
                    activeTurnIndex !== null && span.turnIndex === activeTurnIndex;
                  return (
                    <rect
                      key={span.eventId}
                      x={left}
                      y={y + 3}
                      width={w}
                      height={LANE_HEIGHT - 6}
                      rx={1}
                      className={
                        span.status === 'error'
                          ? 'agent-timing-bar agent-timing-bar-error'
                          : active
                            ? 'agent-timing-bar agent-timing-bar-active'
                            : 'agent-timing-bar'
                      }
                      fill={span.status === 'error' ? 'var(--danger-fg)' : laneColor(index)}
                      opacity={active ? 1 : 0.72}
                      role="button"
                      tabIndex={0}
                      onClick={() => onFocusEvent(span.eventId)}
                    >
                      <title>{span.title}</title>
                    </rect>
                  );
                })}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
