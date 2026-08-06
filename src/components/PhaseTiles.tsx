import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TracePhase } from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import {
  IconDebug,
  IconImplement,
  IconPlan,
  IconReport,
  IconUnderstand,
  IconVerify,
  type IconProps,
} from './icons/index.js';
import { Sparkline } from './ui/Misc.js';

export interface PhaseTilesProps {
  active: TracePhase[];
  onToggle: (phase: TracePhase) => void;
  locale: Locale;
  counts: Record<TracePhase, number>;
  visibleCount: number;
  onSelectAll: () => void;
  onClearAll: () => void;
  /** ui-design-v2 §3.3：命中 Finding 的阶段显示异常色点。 */
  findingPhases?: TracePhase[];
  /** 建议 10：每个 tile 底部该阶段的会话内历史趋势（时间桶时长）。 */
  trends?: Record<TracePhase, number[]>;
}

const PHASE_ICON: Record<TracePhase, (props: IconProps) => React.JSX.Element> = {
  understand: IconUnderstand,
  plan: IconPlan,
  implement: IconImplement,
  debug: IconDebug,
  verify: IconVerify,
  report: IconReport,
};

/** REQ-017 ③：6 个 phase tile，选中态用 phase 色 -subtle 底 + 图标 + 计数徽标。 */
export function PhaseTiles({
  active,
  onToggle,
  locale,
  counts,
  visibleCount,
  onSelectAll,
  onClearAll,
  findingPhases = [],
  trends,
}: PhaseTilesProps): React.JSX.Element {
  const allSelected = active.length === TRACE_PHASES.length;
  const findingSet = new Set(findingPhases);
  return (
    <div className="phase-tiles">
      {TRACE_PHASES.map((phase) => {
        const Icon = PHASE_ICON[phase];
        const selected = active.includes(phase);
        const flagged = findingSet.has(phase);
        const points = trends?.[phase] ?? [];
        const hasTrend = counts[phase] > 0 && points.some((v) => v > 0);
        return (
          <button
            key={phase}
            type="button"
            className="phase-tile"
            style={
              selected
                ? {
                    background: `var(--phase-${phase}-subtle)`,
                    color: `var(--phase-${phase})`,
                    borderColor: `var(--phase-${phase})`,
                  }
                : undefined
            }
            onClick={() => onToggle(phase)}
          >
            <Icon size={12} />
            {t(`phase.${phase}`, locale)}
            {flagged && <span className="phase-tile-dot" aria-label={t('findings.title', locale)} />}
            <span className="phase-tile-count mono">{counts[phase]}</span>
            {hasTrend && (
              <span className="phase-tile-trend" aria-hidden="true">
                <Sparkline points={points} width={56} height={10} />
              </span>
            )}
          </button>
        );
      })}
      <span className="spacer" />
      <span className="phase-tiles-meta mono">{visibleCount} events</span>
      <button type="button" className="btn ui-btn-sm" onClick={onSelectAll} disabled={allSelected}>
        {t('session.selectAll', locale)}
      </button>
      <button type="button" className="btn ui-btn-sm" onClick={onClearAll} disabled={active.length === 0}>
        {t('session.deselectAll', locale)}
      </button>
    </div>
  );
}
