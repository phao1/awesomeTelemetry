import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SpeedMetrics, TraceEventSlim, TraceSession } from '../core/trace-types.js';
import { diffPct, fmtMs } from './compare-stats.js';
import { TokenTextModal, type TokenClass } from './TokenTextModal.js';
import { IconWarning } from './icons/index.js';

interface SpeedMetricDef {
  key: string;
  /** SpeedMetrics 真实字段名（tpot → tpotMs 等，防止 undefined 崩溃）。 */
  field: keyof SpeedMetrics;
  label: string;
  lowerBetter: boolean;
  fmt: (v: number | null) => string;
}

interface AuxRow {
  key: string;
  label: string;
  lv: string;
  rv: string;
  lnum: number | null;
  rnum: number | null;
  lowerBetter: boolean;
}

const fmtNumber = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toFixed(1);
const fmtTpot = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${v.toFixed(1)}ms`;
const fmtMsSafe = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : fmtMs(v);
const fmtPct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;

/** 建议 2 + REQ-102：速度指标 —— 6 核心卡 + 4 辅助卡 + TTFT 启动开销警告。 */
export function CompareSpeedMetrics({
  speed,
  locale,
  sessions,
  events,
}: {
  speed: { left: SpeedMetrics; right: SpeedMetrics };
  locale: Locale;
  /** REQ-101：Token 堆叠条需要会话 tokenUsage；CompareBoard 传入。 */
  sessions?: { left: TraceSession; right: TraceSession };
  /** REQ-102：辅助指标 LLM Calls / 工具总时长按事件计数（G-UI-4 之外的字段）。 */
  events?: { left: TraceEventSlim[]; right: TraceEventSlim[] };
}): React.JSX.Element {
  const defs: SpeedMetricDef[] = [
    { key: 'e2e', field: 'e2eMs', label: t('compare.metric.e2e', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'ttft', field: 'ttftMs', label: t('compare.metric.ttft', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'tps', field: 'tps', label: t('compare.metric.tps', locale), lowerBetter: false, fmt: fmtNumber },
    { key: 'tpot', field: 'tpotMs', label: t('compare.speed.tpot', locale), lowerBetter: true, fmt: fmtTpot },
    { key: 'turnGap', field: 'turnGapMedianMs', label: t('compare.speed.turnGap', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'pureInference', field: 'pureInferenceMs', label: t('compare.speed.pureInference', locale), lowerBetter: true, fmt: fmtMsSafe },
  ];

  const [openToken, setOpenToken] = useState<{ side: 'left' | 'right'; tokenClass: TokenClass } | null>(null);

  /** 辅助 4 卡：LLM Calls / avgLlmDuration / totalToolDuration / cacheHitRate。
   * avgLlmDuration 与 cacheHitRate MUST 从 SpeedMetrics 取（calibrate B2 已实现），
   * 其余两卡按事件计数（G-UI-4）。 */
  const auxRows = useMemo<AuxRow[]>(() => {
    const lEvents = events?.left ?? [];
    const rEvents = events?.right ?? [];
    const llmCallsL = lEvents.filter((e) => e.kind === 'llm').length;
    const llmCallsR = rEvents.filter((e) => e.kind === 'llm').length;
    const toolDurL = lEvents.filter((e) => e.tool !== null).reduce((sum, e) => sum + e.durationMs, 0);
    const toolDurR = rEvents.filter((e) => e.tool !== null).reduce((sum, e) => sum + e.durationMs, 0);
    return [
      { key: 'llmCalls', label: t('compare.speed.llmCalls', locale), lv: String(llmCallsL), rv: String(llmCallsR), lnum: llmCallsL, rnum: llmCallsR, lowerBetter: false },
      { key: 'avgLlmDuration', label: t('compare.speed.avgLlmDuration', locale), lv: fmtMs(speed.left.avgLlmDurationMs), rv: fmtMs(speed.right.avgLlmDurationMs), lnum: speed.left.avgLlmDurationMs, rnum: speed.right.avgLlmDurationMs, lowerBetter: true },
      { key: 'totalToolDuration', label: t('compare.speed.totalToolDuration', locale), lv: fmtMs(toolDurL), rv: fmtMs(toolDurR), lnum: toolDurL, rnum: toolDurR, lowerBetter: true },
      { key: 'cacheHitRate', label: t('compare.speed.cacheHitRate', locale), lv: fmtPct(speed.left.cacheHitRate), rv: fmtPct(speed.right.cacheHitRate), lnum: speed.left.cacheHitRate, rnum: speed.right.cacheHitRate, lowerBetter: false },
    ];
  }, [events, speed, locale]);

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
          const warns: Array<{ side: 'L' | 'R'; ms: number }> = [];
          if (def.key === 'ttft') {
            if ((speed.left.ttftMs ?? 0) > 5000) {
              warns.push({ side: 'L', ms: speed.left.ttftMs! });
            }
            if ((speed.right.ttftMs ?? 0) > 5000) {
              warns.push({ side: 'R', ms: speed.right.ttftMs! });
            }
          }
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
              {warns.map((warn) => (
                <div key={warn.side} className="compare-speed-warn" role="status">
                  <IconWarning size={12} />
                  <span className="compare-side-mark" style={{ color: warn.side === 'L' ? 'var(--accent-fg)' : 'var(--attention-fg)' }}>{warn.side}</span>
                  {t('compare.speed.startupOverhead', locale).replace('{s}', fmtMs(warn.ms))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="compare-speed-aux">
        {auxRows.map((row) => {
          const leftBetter =
            row.lnum === null || row.rnum === null || row.lnum === row.rnum
              ? null
              : row.lowerBetter
                ? row.lnum < row.rnum
                : row.lnum > row.rnum;
          const diff = row.lnum === null || row.rnum === null ? 0 : diffPct(row.lnum, row.rnum);
          return (
            <div key={row.key} className="compare-speed-aux-card">
              <span className="compare-speed-aux-label">{row.label}</span>
              <span className="mono compare-speed-aux-value">
                <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
                {row.lv}
              </span>
              <span className="mono compare-speed-aux-value">
                <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
                {row.rv}
              </span>
              <span className={`compare-delta ${leftBetter === null ? '' : leftBetter ? 'compare-delta-win' : 'compare-delta-lose'}`}>
                {leftBetter === null ? '=' : `${diff.toFixed(0)}% ${leftBetter ? '← L' : '→ R'}`}
              </span>
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
