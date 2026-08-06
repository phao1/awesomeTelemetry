import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import {
  compareSideStats,
  diffPct,
  fmtMs,
  SIGNIFICANT_DIFF,
  type CompareSideStats,
} from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { IconChevronDown, IconChevronRight } from './icons/index.js';

interface DimRow {
  label: string;
  /** null = 口径上算不出来（分母为 0），UI 渲染 —，禁止用 0 冒充。 */
  lv: number | null;
  rv: number | null;
  lowerBetter: boolean;
  fmt: (value: number | null) => string;
}

function DimensionCard({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: DimRow[];
  locale: Locale;
}): React.JSX.Element | null {
  const [showAll, setShowAll] = useState(false);
  const ranked = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const da = a.lv === null || a.rv === null ? 0 : diffPct(a.lv, a.rv);
        const db = b.lv === null || b.rv === null ? 0 : diffPct(b.lv, b.rv);
        return db - da;
      }),
    [rows],
  );
  const significant = ranked.filter(
    (row) => row.lv !== null && row.rv !== null && diffPct(row.lv, row.rv) >= SIGNIFICANT_DIFF,
  );
  const insignificantCount = ranked.length - significant.length;
  const shown = showAll ? ranked : significant;

  if (ranked.length === 0) {
    return null;
  }

  return (
    <section className="compare-dim-card">
      <h4 className="compare-dim-card-title">{title}</h4>
      {shown.length === 0 ? (
        <p className="hint">{t('compare.parity', locale)}</p>
      ) : (
        <ul className="compare-dim-rows">
          {shown.map((row) => {
            const leftBetter =
              row.lv === null || row.rv === null
                ? null
                : row.lv === row.rv
                  ? null
                  : row.lowerBetter
                    ? row.lv < row.rv
                    : row.lv > row.rv;
            const diff = row.lv === null || row.rv === null ? 0 : diffPct(row.lv, row.rv);
            const barWidth = Math.min(diff, 100) / 2;
            return (
              <li key={row.label} className="compare-dim-row">
                <span className="compare-dim-row-label">{row.label}</span>
                <span className="mono compare-dim-row-value">{row.fmt(row.lv)}</span>
                <span className="compare-diff-track" aria-hidden="true">
                  {leftBetter === null ? null : (
                    <>
                      {leftBetter ? (
                        <span
                          className="compare-diff-fill compare-diff-fill-left"
                          style={{ width: `${barWidth}%`, background: 'var(--success-emphasis)' }}
                        />
                      ) : (
                        <span
                          className="compare-diff-fill compare-diff-fill-right"
                          style={{ width: `${barWidth}%`, background: 'var(--danger-emphasis)' }}
                        />
                      )}
                    </>
                  )}
                </span>
                <span className="mono compare-dim-row-value">{row.fmt(row.rv)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {insignificantCount > 0 && (
        <button type="button" className="compare-fold" onClick={() => setShowAll((prev) => !prev)}>
          {showAll
            ? `${t('compare.collapse', locale)} · ${insignificantCount}`
            : t('compare.diffInsignificant', locale).replace('{n}', String(insignificantCount))}
          {showAll ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      )}
    </section>
  );
}

export function CompareDimensions({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const ls: CompareSideStats = compareSideStats(leftEvents, speed.left, left);
  const rs: CompareSideStats = compareSideStats(rightEvents, speed.right, right);
  const fmtConcise = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
  const fmtYesNo = (v: number | null): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));

  const speedRows: DimRow[] = [
    { label: t('compare.speed', locale), lv: speed.left.e2eMs ?? 0, rv: speed.right.e2eMs ?? 0, lowerBetter: true, fmt: fmtMs },
    { label: 'TTFT', lv: speed.left.ttftMs ?? 0, rv: speed.right.ttftMs ?? 0, lowerBetter: true, fmt: fmtMs },
    { label: 'TPS', lv: speed.left.tps ?? 0, rv: speed.right.tps ?? 0, lowerBetter: false, fmt: (v) => v?.toFixed(1) ?? '—' },
    { label: 'TPOT', lv: speed.left.tpotMs ?? 0, rv: speed.right.tpotMs ?? 0, lowerBetter: true, fmt: (v) => (v === null ? '—' : `${v.toFixed(1)}ms`) },
    { label: t('compare.kpi.llmCalls', locale), lv: ls.llmCalls, rv: rs.llmCalls, lowerBetter: false, fmt: (v) => String(v ?? '—') },
    { label: t('compare.kpi.totalToolDuration', locale), lv: ls.totalToolDuration, rv: rs.totalToolDuration, lowerBetter: true, fmt: fmtMs },
  ];
  const costRows: DimRow[] = [
    { label: t('session.tokens', locale), lv: left.tokenUsage.total, rv: right.tokenUsage.total, lowerBetter: true, fmt: (v) => (v === null ? '—' : v.toLocaleString()) },
    { label: t('session.cost', locale), lv: left.costUsd, rv: right.costUsd, lowerBetter: true, fmt: (v) => (v === null ? '—' : `$${v.toFixed(4)}`) },
  ];
  const qualityRows: DimRow[] = [
    {
      label: t('compare.kpi.readWriteRatio', locale),
      lv: ls.fileWrites === 0 ? null : ls.fileReads / ls.fileWrites,
      rv: rs.fileWrites === 0 ? null : rs.fileReads / rs.fileWrites,
      lowerBetter: false,
      fmt: (v) => (v === null ? '—' : v.toFixed(2)),
    },
    {
      label: t('compare.kpi.fileWrites', locale),
      lv: ls.fileWrites,
      rv: rs.fileWrites,
      lowerBetter: false,
      fmt: (v) => String(v ?? '—'),
    },
    {
      label: t('compare.kpi.codeConciseness', locale),
      lv: ls.codeConciseness,
      rv: rs.codeConciseness,
      lowerBetter: true,
      fmt: fmtConcise,
    },
    {
      label: t('agent.verification', locale),
      lv: leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.phase === 'verify').length / leftEvents.length,
      rv: rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.phase === 'verify').length / rightEvents.length,
      lowerBetter: false,
      fmt: (v) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`),
    },
    {
      label: t('compare.kpi.hasUnitTests', locale),
      lv: ls.hasUnitTests ? 1 : 0,
      rv: rs.hasUnitTests ? 1 : 0,
      lowerBetter: false,
      fmt: fmtYesNo,
    },
    {
      label: t('compare.kpi.failedCommands', locale),
      lv: ls.failedCommands,
      rv: rs.failedCommands,
      lowerBetter: true,
      fmt: (v) => String(v ?? '—'),
    },
    {
      label: t('compare.kpi.fixLoops', locale),
      lv: ls.fixLoops,
      rv: rs.fixLoops,
      lowerBetter: true,
      fmt: (v) => String(v ?? '—'),
    },
    {
      label: t('compare.kpi.userRounds', locale),
      lv: ls.userRounds,
      rv: rs.userRounds,
      lowerBetter: false,
      fmt: (v) => String(v ?? '—'),
    },
  ];

  return (
    <div className="compare-dims-grid">
      <DimensionCard title={t('metric.speed', locale)} rows={speedRows} locale={locale} />
      <DimensionCard title={t('metric.cost', locale)} rows={costRows} locale={locale} />
      <DimensionCard title={t('compare.dim.quality', locale)} rows={qualityRows} locale={locale} />
      <p className="hint">{t('compare.dim.qualityDesc', locale)}</p>
      <p className="hint">{t('compare.criteria.codeConciseness', locale)}</p>
    </div>
  );
}
