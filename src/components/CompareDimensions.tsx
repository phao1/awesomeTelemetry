import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import { scanTimingReason, scanTimingValue, type ScanTimingMetric, type ScanTimingReason } from '../core/scan-timing.js';
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
  reason?: ScanTimingReason | null;
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
        const da = a.reason != null || a.lv === null || a.rv === null ? 0 : diffPct(a.lv, a.rv);
        const db = b.reason != null || b.lv === null || b.rv === null ? 0 : diffPct(b.lv, b.rv);
        return db - da;
      }),
    [rows],
  );
  const significant = ranked.filter(
    (row) => row.reason != null || row.lv === null || row.rv === null || diffPct(row.lv, row.rv) >= SIGNIFICANT_DIFF,
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
            const leftLarger =
              row.reason != null || row.lv === null || row.rv === null
                ? null
                : row.lv === row.rv
                  ? null
                  : row.lv > row.rv;
            const diff = row.reason != null || row.lv === null || row.rv === null ? 0 : diffPct(row.lv, row.rv);
            const barWidth = Math.min(diff, 100) / 2;
            return (
              <li key={row.label} className="compare-dim-row">
                <span className="compare-dim-row-label">{row.label}</span>
                <span className="mono compare-dim-row-value">{row.fmt(row.lv)}</span>
                <span className="compare-diff-track" aria-hidden="true">
                  {leftLarger === null ? null : (
                    <>
                      {leftLarger ? (
                        <span
                          className="compare-diff-fill compare-diff-fill-left"
                          style={{ width: `${barWidth}%`, background: 'var(--accent-emphasis)' }}
                        />
                      ) : (
                        <span
                          className="compare-diff-fill compare-diff-fill-right"
                          style={{ width: `${barWidth}%`, background: 'var(--attention-emphasis)' }}
                        />
                      )}
                    </>
                  )}
                </span>
                <span className="mono compare-dim-row-value">{row.fmt(row.rv)}</span>
                {row.reason != null && <small className="hint">{t('scan.timing.notComparable', locale)} · {t(`scan.timing.reason.${row.reason}`, locale)}</small>}
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
  const fmtYesNo = (v: number | null): string => v===null?'—':v===1?t('compare.yes',locale):t('compare.no',locale);
  const complete=(side:CompareResult['left']):boolean=>!side.pending&&!side.hasMore&&side.eventOffset===0&&side.events.length>=side.eventTotal;

  const timingRow = (label: string, metric: ScanTimingMetric, lv: number | null, rv: number | null, lowerBetter: boolean, fmt: DimRow['fmt']): DimRow => ({
    label, lv: scanTimingValue(lv), rv: scanTimingValue(rv), lowerBetter, fmt,
    reason: scanTimingReason(result.left, result.right, metric, lv, rv),
  });
  const speedRows: DimRow[] = [
    timingRow(t('compare.speed', locale), 'e2e', speed.left.e2eMs, speed.right.e2eMs, true, fmtMs),
    timingRow('TTFT', 'ttft', speed.left.ttftMs, speed.right.ttftMs, true, fmtMs),
    timingRow('TPS', 'tps', speed.left.tps, speed.right.tps, false, (v) => v?.toFixed(1) ?? '—'),
    timingRow('TPOT', 'tpot', speed.left.tpotMs, speed.right.tpotMs, true, (v) => v === null ? '—' : `${v.toFixed(1)}ms`),
    timingRow(t('compare.kpi.llmCalls', locale), 'eventDuration', ls.llmCalls, rs.llmCalls, false, (v) => String(v ?? '—')),
    timingRow(t('compare.kpi.totalToolDuration', locale), 'eventDuration', ls.totalToolDuration, rs.totalToolDuration, true, fmtMs),
  ];
  const costRows: DimRow[] = [
    { label: t('session.tokens', locale), lv: left.tokenUsage.total, rv: right.tokenUsage.total, lowerBetter: true, fmt: (v) => (v === null ? '—' : v.toLocaleString()) },
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
      lv: ls.totalSteps === 0 ? null : leftEvents.filter((e) => e.phase === 'verify').length / ls.totalSteps,
      rv: rs.totalSteps === 0 ? null : rightEvents.filter((e) => e.phase === 'verify').length / rs.totalSteps,
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
      <DimensionCard title={t('compare.dim.quality', locale)} rows={qualityRows.map(row=>({...row,lv:complete(result.left)?row.lv:null,rv:complete(result.right)?row.rv:null}))} locale={locale} />
      <p className="hint">{t('compare.observed.bars',locale)}</p>
      <p className="hint">{t('compare.dim.qualityDesc', locale)}</p>
      <p className="hint">{t('compare.criteria.codeConciseness', locale)}</p>
    </div>
  );
}
