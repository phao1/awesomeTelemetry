import { useMemo } from 'react';

import type { I18nKey, Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import { groupEvents } from '../core/event-groups.js';
import { fmtMs } from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import {
  IconAccuracy,
  IconCost,
  IconSpeed,
  type IconProps,
} from './icons/index.js';

interface VerdictDim {
  key: 'fast' | 'frugal' | 'quality';
  winner: 'L' | 'R' | 'tie';
  detail: string;
}

/** §6.3 裁决（calibrate-tokens-and-compare-report）：快/省/质 三维裁决。 */
function computeVerdict(
  result: CompareResult,
  locale: Locale,
): {
  dims: VerdictDim[];
  wins: number;
  losses: number;
  winner: 'L' | 'R' | 'tie';
} {
  const left = result.left.session;
  const right = result.right.session;

  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const leftVerify = leftEvents.filter((e) => e.phase === 'verify').length;
  const rightVerify = rightEvents.filter((e) => e.phase === 'verify').length;
  const leftLoops = groupEvents(leftEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const rightLoops = groupEvents(rightEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const lErr = leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.status === 'error').length / leftEvents.length;
  const rErr = rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.status === 'error').length / rightEvents.length;

  const dims: VerdictDim[] = [];
  const add = (key: VerdictDim['key'], lv: number, rv: number, lowerBetter: boolean, detail: string): void => {
    const winner = lv === rv ? 'tie' : lowerBetter ? (lv < rv ? 'L' : 'R') : lv > rv ? 'L' : 'R';
    dims.push({ key, winner, detail });
  };

  const lE2e = result.speed.left.e2eMs ?? 0;
  const rE2e = result.speed.right.e2eMs ?? 0;
  const fastRatio = Math.max(lE2e, rE2e) / Math.max(1, Math.min(lE2e, rE2e));
  add(
    'fast',
    lE2e,
    rE2e,
    true,
    t('compare.fastDetail', locale)
      .replace('{left}', fmtMs(lE2e))
      .replace('{right}', fmtMs(rE2e))
      .replace('{ratio}', fastRatio.toFixed(1)),
  );

  const lTok = left.tokenUsage.total;
  const rTok = right.tokenUsage.total;
  const diffPct = (a: number, b: number): number => {
    if (a === b) {
      return 0;
    }
    const base = Math.max(1, Math.min(Math.abs(a), Math.abs(b)) || Math.max(Math.abs(a), Math.abs(b)));
    return (Math.abs(a - b) / base) * 100;
  };
  add(
    'frugal',
    lTok,
    rTok,
    true,
    t('compare.frugalDetail', locale)
      .replace('{left}', lTok.toLocaleString())
      .replace('{right}', rTok.toLocaleString())
      .replace('{pct}', diffPct(lTok, rTok).toFixed(0)),
  );

  const leftCoverage = leftEvents.length === 0 ? 0 : leftVerify / leftEvents.length;
  const rightCoverage = rightEvents.length === 0 ? 0 : rightVerify / rightEvents.length;
  // §6.2：stability 判据并入 quality —— 覆盖 → 修复循环 → 失败率 依次裁决。
  let qualityWinner: 'L' | 'R' | 'tie';
  if (leftCoverage !== rightCoverage) {
    qualityWinner = leftCoverage > rightCoverage ? 'L' : 'R';
  } else if (leftLoops !== rightLoops) {
    qualityWinner = leftLoops < rightLoops ? 'L' : 'R';
  } else {
    qualityWinner = lErr === rErr ? 'tie' : lErr < rErr ? 'L' : 'R';
  }
  dims.push({
    key: 'quality',
    winner: qualityWinner,
    detail: t('compare.qualityDetail', locale)
      .replace('{left}', `${(leftCoverage * 100).toFixed(0)}%`)
      .replace('{right}', `${(rightCoverage * 100).toFixed(0)}%`)
      .replace('{x}', String(leftLoops))
      .replace('{y}', String(rightLoops)),
  });

  let wins = 0;
  let losses = 0;
  for (const dim of dims) {
    if (dim.winner === 'L') {
      wins += 1;
    } else if (dim.winner === 'R') {
      losses += 1;
    }
  }
  const winner: 'L' | 'R' | 'tie' = wins > losses ? 'L' : losses > wins ? 'R' : 'tie';
  return { dims, wins, losses, winner };
}

const DIM_ICON: Record<'fast' | 'frugal' | 'quality', (props: IconProps) => React.JSX.Element> = {
  fast: IconSpeed,
  frugal: IconCost,
  quality: IconAccuracy,
};

const DIM_LABEL_KEY: Record<'fast' | 'frugal' | 'quality', I18nKey> = {
  fast: 'metric.speed',
  frugal: 'metric.cost',
  quality: 'metric.accuracy',
};

/** 建议 9：裁决可视化评分条 —— 水平条形，左 accent / 右 attention，宽度比 = wins:losses。 */
function VerdictScoreBar({ wins, losses }: { wins: number; losses: number }): React.JSX.Element {
  const total = wins + losses;
  const leftPct = total === 0 ? 50 : (wins / total) * 100;
  return (
    <div
      className="compare-verdict-bar"
      role="img"
      aria-label={`L ${wins} : ${losses} R`}
    >
      <div
        className="compare-verdict-bar-fill compare-verdict-bar-left"
        style={{ width: `${leftPct}%` }}
      />
      <div
        className="compare-verdict-bar-fill compare-verdict-bar-right"
        style={{ width: `${100 - leftPct}%` }}
      />
      <span className="compare-verdict-bar-mark compare-verdict-bar-mark-left">L {wins}</span>
      <span className="compare-verdict-bar-mark compare-verdict-bar-mark-right">{losses} R</span>
    </div>
  );
}

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
  const winnerName = verdict.winner === 'L' ? leftName : verdict.winner === 'R' ? rightName : null;
  const reasonParts: string[] = [];
  if (verdict.wins > 0) {
    reasonParts.push(
      verdict.dims
        .filter((d) => d.winner === 'L')
        .map((d) => t(`compare.why.${d.key}`, locale))
        .join('、'),
    );
  }
  if (verdict.losses > 0) {
    reasonParts.push(
      verdict.dims
        .filter((d) => d.winner === 'R')
        .map((d) => t(`compare.why.${d.key}`, locale))
        .join('、'),
    );
  }
  const scoreLine =
    winnerName !== null
      ? t('compare.wins', locale)
          .replace('{name}', winnerName)
          .replace('{wins}', String(Math.max(verdict.wins, verdict.losses)))
          .replace('{losses}', String(Math.min(verdict.wins, verdict.losses)))
      : t('compare.tie', locale);

  return (
    <section className="compare-verdict" id="compare-verdict">
      <div className="compare-verdict-title">
        <span>{leftName}</span>
        <span className="compare-vs">vs</span>
        <span>{rightName}</span>
      </div>
      <div className="compare-verdict-score">{scoreLine}</div>
      <VerdictScoreBar wins={verdict.wins} losses={verdict.losses} />
      {reasonParts.length > 0 && <div className="compare-verdict-reason">{reasonParts.join('；')}</div>}
      <div className="compare-verdict-dims">
        {verdict.dims.map((dim) => {
          const Icon = DIM_ICON[dim.key];
          const tone = dim.winner === 'L' ? 'var(--accent-fg)' : dim.winner === 'R' ? 'var(--attention-fg)' : 'var(--neutral-fg)';
          return (
            <button
              key={dim.key}
              type="button"
              className="compare-verdict-dim"
              onClick={() => document.getElementById('compare-dims')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <Icon size={16} />
              <span className="compare-verdict-dim-label">{t(DIM_LABEL_KEY[dim.key], locale)}</span>
              <span className="compare-verdict-dim-winner" style={{ color: tone }}>
                {dim.winner === 'tie' ? t('compare.parity', locale) : t('compare.leads', locale).replace('{name}', dim.winner === 'L' ? leftName : rightName)}
              </span>
              <span className="compare-verdict-dim-detail">{dim.detail}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
