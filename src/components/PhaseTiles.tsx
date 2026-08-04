import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TracePhase } from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';

export interface PhaseTilesProps {
  active: TracePhase[];
  onToggle: (phase: TracePhase) => void;
  locale: Locale;
}

/** REQ-008：6 个 phase 过滤 tile。 */
export function PhaseTiles({ active, onToggle, locale }: PhaseTilesProps) {
  return (
    <div className="phase-tiles">
      {TRACE_PHASES.map((phase) => (
        <button
          key={phase}
          type="button"
          className={`phase-tile ${active.includes(phase) ? 'phase-tile-on' : ''}`}
          onClick={() => onToggle(phase)}
        >
          {t(`phase.${phase}`, locale)}
        </button>
      ))}
    </div>
  );
}
