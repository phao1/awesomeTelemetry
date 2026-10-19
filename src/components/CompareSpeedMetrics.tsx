import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SpeedMetrics, TraceEventSlim, TraceSession } from '../core/trace-types.js';
import { scanTimingReason, scanTimingValue, type ScanTimingMetric, type ScanTimingSide } from '../core/scan-timing.js';
import { fmtMs } from './compare-stats.js';
import { TokenTextModal, type TokenClass } from './TokenTextModal.js';
import { IconWarning } from './icons/index.js';
import { CompareTokenUsage } from './CompareTokenUsage.js';

interface SpeedMetricDef {
  key: string;
  metric: ScanTimingMetric;
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
  sides,
}: {
  speed: { left: SpeedMetrics; right: SpeedMetrics };
  locale: Locale;
  /** REQ-101：Token 堆叠条需要会话 tokenUsage；CompareBoard 传入。 */
  sessions?: { left: TraceSession; right: TraceSession };
  /** REQ-102：辅助指标 LLM Calls / 工具总时长按事件计数（G-UI-4 之外的字段）。 */
  events?: { left: TraceEventSlim[]; right: TraceEventSlim[] };
  /** Full page readiness wins over session-only fallback. */
  sides?: { left: ScanTimingSide; right: ScanTimingSide };
}): React.JSX.Element {
  const leftSide = sides?.left ?? (sessions === undefined ? undefined : { session: sessions.left });
  const rightSide = sides?.right ?? (sessions === undefined ? undefined : { session: sessions.right });
  const defs: SpeedMetricDef[] = [
    { key: 'e2e', metric: 'e2e', field: 'e2eMs', label: t('compare.metric.e2e', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'ttft', metric: 'ttft', field: 'ttftMs', label: t('compare.metric.ttft', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'tps', metric: 'tps', field: 'tps', label: t('compare.metric.tps', locale), lowerBetter: false, fmt: fmtNumber },
    { key: 'tpot', metric: 'tpot', field: 'tpotMs', label: t('compare.speed.tpot', locale), lowerBetter: true, fmt: fmtTpot },
    { key: 'turnGap', metric: 'turnGap', field: 'turnGapMedianMs', label: t('compare.speed.turnGap', locale), lowerBetter: true, fmt: fmtMsSafe },
    { key: 'pureInference', metric: 'eventDuration', field: 'pureInferenceMs', label: t('compare.speed.pureInference', locale), lowerBetter: true, fmt: fmtMsSafe },
  ];

  const [openToken, setOpenToken] = useState<{ side: 'left' | 'right'; tokenClass: TokenClass } | null>(null);

  /** 辅助 4 卡：LLM Calls / avgLlmDuration / totalToolDuration / cacheHitRate。
   * avgLlmDuration 与 cacheHitRate MUST 从 SpeedMetrics 取（calibrate B2 已实现），
   * 其余两卡按事件计数（G-UI-4）。 */
  const auxRows = useMemo<AuxRow[]>(() => {
    const lEvents = events?.left ?? [];
    const rEvents = events?.right ?? [];
    const llmCallsL = events === undefined ? null : lEvents.filter((e) => e.kind === 'llm').length;
    const llmCallsR = events === undefined ? null : rEvents.filter((e) => e.kind === 'llm').length;
    const toolDurL = events === undefined ? null : lEvents.filter((e) => e.tool !== null).reduce((sum, e) => sum + e.durationMs, 0);
    const toolDurR = events === undefined ? null : rEvents.filter((e) => e.tool !== null).reduce((sum, e) => sum + e.durationMs, 0);
    return [
      { key: 'llmCalls', label: t('compare.speed.llmCalls', locale), lv: String(llmCallsL ?? '—'), rv: String(llmCallsR ?? '—'), lnum: llmCallsL, rnum: llmCallsR, lowerBetter: false },
      { key: 'avgLlmDuration', label: t('compare.speed.avgLlmDuration', locale), lv: fmtMsSafe(scanTimingValue(speed.left.avgLlmDurationMs)), rv: fmtMsSafe(scanTimingValue(speed.right.avgLlmDurationMs)), lnum: speed.left.avgLlmDurationMs, rnum: speed.right.avgLlmDurationMs, lowerBetter: true },
      { key: 'totalToolDuration', label: t('compare.speed.totalToolDuration', locale), lv: fmtMsSafe(scanTimingValue(toolDurL)), rv: fmtMsSafe(scanTimingValue(toolDurR)), lnum: toolDurL, rnum: toolDurR, lowerBetter: true },
      { key: 'cacheHitRate', label: t('compare.speed.cacheHitRate', locale), lv: fmtPct(scanTimingValue(speed.left.cacheHitRate)), rv: fmtPct(scanTimingValue(speed.right.cacheHitRate)), lnum: speed.left.cacheHitRate, rnum: speed.right.cacheHitRate, lowerBetter: false },
    ];
  }, [events, speed, locale]);

  const openSession = openToken === null || sessions === undefined ? null : sessions[openToken.side];

  return (
    <>
      <p className="hint">{t('scan.timing.scope', locale)} {t('scan.timing.wallClock', locale)}</p>
      <div className="compare-speed-grid">
        {defs.map((def) => {
          const lv = scanTimingValue(speed.left[def.field]);
          const rv = scanTimingValue(speed.right[def.field]);
          const reason = scanTimingReason(leftSide, rightSide, def.metric, speed.left[def.field], speed.right[def.field]);
          const delta=reason!==null||lv===null||rv===null?null:rv-lv;
          const observed=delta===null||!Number.isFinite(delta)?null:`R − L: ${delta>0?'+':delta<0?'−':''}${def.fmt(Math.abs(delta))}`;
          const warns: Array<{ side: 'L' | 'R'; ms: number }> = [];
          if (def.key === 'ttft') {
            if (lv !== null && lv > 5000) {
              warns.push({ side: 'L', ms: lv });
            }
            if (rv !== null && rv > 5000) {
              warns.push({ side: 'R', ms: rv });
            }
          }
          return (
            <div
              key={def.key}
              className="compare-speed-card"
            >
              <div className="compare-speed-card-head">
                <span className="compare-speed-card-label">{def.label}</span>
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
              <div className="compare-speed-observation">
                {reason !== null ? `${t('scan.timing.notComparable', locale)} · ${t(`scan.timing.reason.${reason}`, locale)}` : observed??t('compare.activity.unavailable',locale)}
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
          const reason = scanTimingReason(leftSide, rightSide, 'eventDuration', row.lnum, row.rnum);
          const diff = reason !== null || row.lnum === null || row.rnum === null ? null : row.rnum-row.lnum;
          const delta=diff===null||!Number.isFinite(diff)?null:`R − L: ${diff>0?'+':diff<0?'−':''}${row.key==='llmCalls'?Math.abs(diff).toLocaleString(locale):row.key==='cacheHitRate'?`${(Math.abs(diff)*100).toFixed(1)} ${t('compare.activity.percentagePoints',locale)}`:fmtMs(Math.abs(diff))}`;
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
              <span className="compare-delta">
                {reason !== null ? `${t('scan.timing.notComparable', locale)} · ${t(`scan.timing.reason.${reason}`, locale)}`
                  : delta??t('compare.activity.unavailable',locale)}
              </span>
            </div>
          );
        })}
      </div>
      {sessions !== undefined && (
        <div className="compare-token-stacks">
          <h4 className="compare-token-stacks-title">{t('compare.charts.tokenDonut', locale)}</h4>
          <CompareTokenUsage visual="bars" locale={locale} usage={{left:sessions.left.tokenUsage,right:sessions.right.tokenUsage}}
            estimates={{left:speed.left.systemPromptTokensEstimate,right:speed.right.systemPromptTokensEstimate}}
            pending={{left:leftSide?.pending,right:rightSide?.pending}} onInspectText={(side,tokenClass)=>setOpenToken({side,tokenClass})}/>
        </div>
      )}
      {openToken !== null && openSession !== null && (
        <TokenTextModal
          sessionKey={openSession.id}
          provider={openSession.provider}
          agentName={openSession.sourceAgent}
          tokenClass={openToken.tokenClass}
          tokenCount={openToken.tokenClass==='system'?speed[openToken.side].systemPromptTokensEstimate??0:openSession.tokenUsage[openToken.tokenClass]}
          locale={locale}
          onClose={() => setOpenToken(null)}
        />
      )}
    </>
  );
}
