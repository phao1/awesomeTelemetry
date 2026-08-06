import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SpeedMetrics } from '../core/trace-types.js';
import { fmtMs } from './compare-stats.js';
interface SpeedMetricDef {
  key: string;
  label: string;
  lowerBetter: boolean;
  fmt: (v: number | null) => string;
}

const fmtNumber = (v: number | null): string => (v === null ? '—' : v.toFixed(1));
const fmtTpot = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}ms`);

/** 建议 2：速度指标独立 section —— 6 指标（e2e / TTFT / TPS / TPOT / turnGap / pureInference）。 */
export function CompareSpeedMetrics({
  speed,
  locale,
}: {
  speed: { left: SpeedMetrics; right: SpeedMetrics };
  locale: Locale;
}): React.JSX.Element {
  const defs: SpeedMetricDef[] = [
    { key: 'e2e', label: t('compare.metric.e2e', locale), lowerBetter: true, fmt: fmtMs },
    { key: 'ttft', label: t('compare.metric.ttft', locale), lowerBetter: true, fmt: fmtMs },
    { key: 'tps', label: t('compare.metric.tps', locale), lowerBetter: false, fmt: fmtNumber },
    { key: 'tpot', label: t('compare.metric.tpot', locale), lowerBetter: true, fmt: fmtTpot },
    { key: 'turnGap', label: t('compare.metric.turnGap', locale), lowerBetter: true, fmt: fmtMs },
    { key: 'pureInference', label: t('compare.metric.pureInference', locale), lowerBetter: true, fmt: fmtMs },
  ];

  return (
    <div className="compare-speed-grid">
      {defs.map((def) => {
        const lv = speed.left[def.key as keyof SpeedMetrics] as number | null;
        const rv = speed.right[def.key as keyof SpeedMetrics] as number | null;
        const leftBetter =
          lv === null || rv === null || lv === rv
            ? null
            : def.lowerBetter
              ? lv < rv
              : lv > rv;
        return (
          <div
            key={def.key}
            className={`compare-speed-card ${leftBetter === null ? '' : leftBetter ? 'compare-speed-card-l' : 'compare-speed-card-r'}`}
          >
            <div className="compare-speed-card-head">
              <span className="compare-speed-card-label">{def.label}</span>
              <span className="compare-speed-card-dir">
                {def.lowerBetter ? t('compare.lowerBetter', locale) : t('compare.higherBetter', locale)}
              </span>
            </div>
            <div className="compare-speed-values">
              <span className="mono compare-speed-value">
                <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
                {def.fmt(lv)}
              </span>
              <span className="mono compare-speed-value">
                <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
                {def.fmt(rv)}
              </span>
            </div>
            <div className="compare-speed-winner" aria-hidden="true">
              {leftBetter === null
                ? t('compare.parity', locale)
                : leftBetter
                  ? 'L ✓'
                  : 'R ✓'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
