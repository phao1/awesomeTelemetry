import { useMemo } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim, TracePhase } from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';

export interface PhaseRibbonProps {
  events: TraceEventSlim[];
  active: TracePhase[];
  onSelectOnly: (phase: TracePhase) => void;
  locale: Locale;
}

interface Segment {
  phase: TracePhase;
  ms: number;
  count: number;
  pct: number;
}

/**
 * REQ-017 ②（design D3）：PhaseRibbon 产品 signature。
 * 按时间占比铺满宽度的色带；悬停显示 phase/时长/事件数；点击等价于只选该 phase。
 */
export function PhaseRibbon({ events, active, onSelectOnly, locale }: PhaseRibbonProps): React.JSX.Element {
  const segments = useMemo<Segment[]>(() => {
    const totals = new Map<TracePhase, { ms: number; count: number }>();
    for (const event of events) {
      const current = totals.get(event.phase) ?? { ms: 0, count: 0 };
      current.ms += event.durationMs;
      current.count += 1;
      totals.set(event.phase, current);
    }
    const totalMs = [...totals.values()].reduce((sum, v) => sum + v.ms, 0) || 1;
    return TRACE_PHASES.map((phase) => {
      const v = totals.get(phase) ?? { ms: 0, count: 0 };
      return { phase, ms: v.ms, count: v.count, pct: (v.ms / totalMs) * 100 };
    }).filter((segment) => segment.count > 0);
  }, [events]);

  if (segments.length === 0) {
    return <div className="phase-ribbon phase-ribbon-empty" aria-hidden="true" />;
  }
  return (
    <div
      className="phase-ribbon"
      role="img"
      aria-label={t('session.phaseRibbon', locale)}
    >
      {segments.map((segment) => {
        const only = active.length === 1 && active[0] === segment.phase;
        const label = `${t(`phase.${segment.phase}`, locale)} · ${(segment.ms / 1000).toFixed(1)}s · ${segment.count} events`;
        return (
          <button
            key={segment.phase}
            type="button"
            className={`phase-ribbon-seg ${only ? 'phase-ribbon-only' : ''}`}
            style={{
              width: `${segment.pct}%`,
              background: `var(--phase-${segment.phase})`,
            }}
            title={label}
            aria-label={label}
            onClick={() => onSelectOnly(segment.phase)}
          />
        );
      })}
    </div>
  );
}
