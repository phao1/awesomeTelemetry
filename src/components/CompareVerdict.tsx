import { useMemo } from 'react';

import type { I18nKey, Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import { groupEvents } from '../core/event-groups.js';
import { scanTimingRatio, scanTimingReason, scanTimingValue } from '../core/scan-timing.js';
import type { ScanTimingReason } from '../core/scan-timing.js';
import { fmtMs, STEP_KINDS } from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import {
  IconAccuracy,
  IconCost,
  IconSpeed,
  type IconProps,
} from './icons/index.js';

interface VerdictDim {
  key: 'fast' | 'frugal' | 'quality';
  winner: 'L' | 'R' | 'tie' | 'unavailable';
  detail: string;
  reason?: ScanTimingReason;
}

/** Descriptive legacy observations, never a task/Agent correctness adjudication. */
export function computeVerdict(
  result: CompareResult,
  locale: Locale,
): {
  dims: VerdictDim[];
  /** REQ-104：Hero 摘要用到的比率（与裁决同一数据源，避免口径漂移）。 */
  summary: {
    fastRatio: number | null;
    leftCoveragePct: number | null;
    rightCoveragePct: number | null;
  };
} {
  const left = result.left.session;
  const right = result.right.session;

  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const leftVerify = leftEvents.filter((e) => e.phase === 'verify').length;
  const rightVerify = rightEvents.filter((e) => e.phase === 'verify').length;
  const leftLoops = groupEvents(leftEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const rightLoops = groupEvents(rightEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;

  const dims: VerdictDim[] = [];
  const add = (key: VerdictDim['key'], lv: number, rv: number, lowerBetter: boolean, detail: string): void => {
    const winner = lv === rv ? 'tie' : lowerBetter ? (lv < rv ? 'L' : 'R') : lv > rv ? 'L' : 'R';
    dims.push({ key, winner, detail });
  };

  const lE2e = scanTimingValue(result.speed.left.e2eMs);
  const rE2e = scanTimingValue(result.speed.right.e2eMs);
  const fastReason = scanTimingReason(result.left, result.right, 'e2e', result.speed.left.e2eMs, result.speed.right.e2eMs);
  const fastRatio = scanTimingRatio(result.left, result.right, 'e2e', result.speed.left.e2eMs, result.speed.right.e2eMs);
  if (fastReason !== null) dims.push({ key: 'fast', winner: 'unavailable', reason: fastReason,
    detail: `${fmtMs(lE2e)} vs ${fmtMs(rE2e)} · ${t('scan.timing.notComparable', locale)}: ${t(`scan.timing.reason.${fastReason}`, locale)}` });
  else add(
    'fast',
    lE2e!,
    rE2e!,
    true,
    `${fmtMs(lE2e)} vs ${fmtMs(rE2e)} · ${fastRatio === null ? t('scan.timing.wallClock', locale) : t('scan.timing.wallClockRatio', locale).replace('{ratio}', fastRatio.toFixed(1))}`,
  );

  const lTok = left.tokenUsage.total;
  const rTok = right.tokenUsage.total;
  add(
    'frugal',
    lTok,
    rTok,
    true,
    t('compare.frugalDetail', locale)
      .replace('{left}', lTok.toLocaleString())
      .replace('{right}', rTok.toLocaleString()),
  );

  const coverage=(side:CompareResult['left'],verify:number):number|null=>{
    const steps=side.events.filter(event=>STEP_KINDS.has(event.kind)).length;
    return side.pending||side.hasMore||side.eventOffset!==0||side.events.length<side.eventTotal||steps===0?null:verify/steps;
  };
  const leftCoverage=coverage(result.left,leftVerify);
  const rightCoverage=coverage(result.right,rightVerify);
  const percent=(value:number|null):string=>value===null?'—':`${(value*100).toFixed(0)}%`;
  dims.push({
    key: 'quality',
    // Verification/repair bookkeeping does not establish answer correctness.
    winner: 'unavailable',
    detail: t('compare.observed.verificationDetail', locale)
      .replace('{left}', percent(leftCoverage))
      .replace('{right}', percent(rightCoverage))
      .replace('{x}', String(leftLoops))
      .replace('{y}', String(rightLoops)),
  });

  return {
    dims,
    summary: {
      fastRatio,
      leftCoveragePct: leftCoverage===null?null:leftCoverage*100,
      rightCoveragePct: rightCoverage===null?null:rightCoverage*100,
    },
  };
}

const DIM_ICON: Record<'fast' | 'frugal' | 'quality', (props: IconProps) => React.JSX.Element> = {
  fast: IconSpeed,
  frugal: IconCost,
  quality: IconAccuracy,
};

const DIM_LABEL_KEY: Record<'fast' | 'frugal' | 'quality', I18nKey> = {
  fast: 'compare.observed.wallClock',
  frugal: 'compare.observed.tokens',
  quality: 'session.metric.verification',
};

export function CompareVerdict({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const verdict = useMemo(() => computeVerdict(result, locale), [result, locale]);
  const leftName = result.left.session.title || result.left.session.id;
  const rightName = result.right.session.title || result.right.session.id;

  return (
    <section className="compare-verdict" id="compare-verdict">
      <div className="compare-verdict-title">
        <span>{leftName}</span>
        <span className="compare-vs">vs</span>
        <span>{rightName}</span>
      </div>
      <p className="hint">{t('compare.observed.noWinner',locale)}</p>
      <div className="compare-verdict-dims">
        {verdict.dims.map((dim) => {
          const Icon = DIM_ICON[dim.key];
          return (
            <div
              key={dim.key}
              className="compare-verdict-dim"
            >
              <Icon size={16} />
              <span className="compare-verdict-dim-label">{t(DIM_LABEL_KEY[dim.key], locale)}</span>
              <span className="compare-verdict-dim-winner">
                {dim.key==='quality'?t('compare.observed.noCorrectness',locale):dim.winner === 'unavailable' ? t('scan.timing.notComparable', locale) : dim.winner === 'tie' ? t('compare.observed.same', locale) : t('compare.observed.lower', locale).replace('{side}', dim.winner)}
              </span>
              <span className="compare-verdict-dim-detail">{dim.detail}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
