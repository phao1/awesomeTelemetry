import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SpeedMetrics, TraceSession } from '../core/trace-types.js';
import { fmtMs } from './compare-stats.js';
import { useState } from 'react';
import { TokenTextModal, type TokenClass } from './TokenTextModal.js';
interface SpeedMetricDef {
  key: string;
  /** SpeedMetrics 真实字段名（tpot → tpotMs 等，防止 undefined 崩溃）。 */
  field: keyof SpeedMetrics;
  label: string;
  lowerBetter: boolean;
  fmt: (v: number | null) => string;
}

const fmtNumber = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toFixed(1);
const fmtTpot = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${v.toFixed(1)}ms`;
const fmtMsSafe = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : fmtMs(v);

/** 建议 2：速度指标独立 section —— 6 指标（e2e / TTFT / TPS / TPOT / turnGap / pureInference）。 */
export function CompareSpeedMetrics({
  speed,
  locale,
  sessions,
}: {
  speed: { left: SpeedMetrics; right: SpeedMetrics };
  locale: Locale;
  /** REQ-101：Token 堆叠条需要会话 tokenUsage；CompareBoard 传入。 */
  sessions?: { left: TraceSession; right: TraceSession };
}): React.JSX.Element {
  const defs: SpeedMetricDef[] = [
    { key: 'e2e', field: 'e2eMs', label: t('compare.metric.e2e', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'ttft', field: 'ttftMs', label: t('compare.metric.ttft', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'tps', field: 'tps', label: t('compare.metric.tps', locale), lowerBetter: false, fmt: fmtNumber },
    { key: 'tpot', field: 'tpotMs', label: t('compare.metric.tpot', locale), lowerBetter: true, fmt: fmtTpot },
    { key: 'turnGap', field: 'turnGapMedianMs', label: t('compare.metric.turnGap', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'pureInference', field: 'pureInferenceMs', label: t('compare.metric.pureInference', locale), lowerBetter: true, fmt: fmtMsSafe },
  ];

  const [openToken, setOpenToken] = useState<{ side: 'left' | 'right'; tokenClass: TokenClass } | null>(null);

  const tokenValues = (side: 'left' | 'right'): Record<TokenClass, number> => {
    const session = sessions?.[side];
    return {
      system: speed[side].systemPromptTokensEstimate ?? 0,
      input: session?.tokenUsage.input ?? 0,
      reasoning: session?.tokenUsage.reasoning ?? 0,
      output: session?.tokenUsage.output ?? 0,
    };
  };

  const stack = (side: 'left' | 'right'): React.JSX.Element => {
    const values = tokenValues(side);
    const total = Object.values(values).reduce((a, b) => a + b, 0) || 1;
    const session = sessions?.[side];
    return (
      <div className="token-stack" role="group" aria-label={t('compare.charts.tokenDonut', locale)}>
        {session !== undefined && (
          <span className="compare-side-mark" style={{ color: side === 'left' ? 'var(--accent-fg)' : 'var(--attention-fg)' }}>
            {side === 'left' ? 'L' : 'R'}
          </span>
        )}
        <div className="token-stack-bar">
          {(['system', 'input', 'reasoning', 'output'] as const).map((cls) => {
            const value = values[cls];
            if (value <= 0) {
              return null;
            }
            return (
              <button
                key={cls}
                type="button"
                className={`token-stack-seg token-stack-${cls}`}
                style={{ width: `${(value / total) * 100}%` }}
                title={`${t(`compare.charts.tokenClass.${cls}`, locale)} · ${value.toLocaleString()}`}
                aria-label={`${side === 'left' ? 'L' : 'R'} ${cls}`}
                onClick={() => setOpenToken({ side, tokenClass: cls })}
              >
                <span className="token-stack-seg-label">{t(`compare.charts.tokenClass.${cls}`, locale)}</span>
                <span className="mono token-stack-seg-count">{value.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const openSession = openToken === null || sessions === undefined ? null : sessions[openToken.side];

  return (
    <>
      <div className="compare-speed-grid">
        {defs.map((def) => {
          const lv = (speed.left[def.field] ?? null) as number | null;
          const rv = (speed.right[def.field] ?? null) as number | null;
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
      {sessions !== undefined && (
        <div className="compare-token-stacks">
          <h4 className="compare-token-stacks-title">{t('compare.charts.tokenDonut', locale)}</h4>
          {stack('left')}
          {stack('right')}
        </div>
      )}
      {openToken !== null && openSession !== null && (
        <TokenTextModal
          sessionKey={openSession.id}
          provider={openSession.provider}
          agentName={openSession.sourceAgent}
          tokenClass={openToken.tokenClass}
          tokenCount={tokenValues(openToken.side)[openToken.tokenClass]}
          locale={locale}
          onClose={() => setOpenToken(null)}
        />
      )}
    </>
  );
}
