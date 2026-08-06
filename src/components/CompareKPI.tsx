import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import {
  compareSideStats,
  diffPct,
  errorDistribution,
  fmtMs,
} from './compare-stats.js';
import type { CompareResult } from './compare-types.js';

interface KpiItem {
  key: string;
  label: string;
  lv: string;
  rv: string;
  lnum: number;
  rnum: number;
  lowerBetter: boolean;
  /** 有 drill-down 明细的 key 才可展开。 */
  drill?: boolean;
}

/** 建议 7：KPI 卡片 drill-down —— 速度/Token/错误率/验证覆盖率 的构成明细。 */
function KpiDrilldown({
  item,
  result,
  locale,
}: {
  item: KpiItem;
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element | null {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const left = result.left.session;
  const right = result.right.session;

  const rows: Array<{ label: string; lv: string; rv: string }> = [];
  const fmtNum = (v: number): string => v.toLocaleString();

  if (item.key === 'e2e') {
    rows.push(
      { label: 'TTFT', lv: fmtMs(speed.left.ttftMs), rv: fmtMs(speed.right.ttftMs) },
      { label: 'TPS', lv: speed.left.tps?.toFixed(1) ?? '—', rv: speed.right.tps?.toFixed(1) ?? '—' },
      { label: 'TPOT', lv: speed.left.tpotMs === null ? '—' : `${speed.left.tpotMs.toFixed(1)}ms`, rv: speed.right.tpotMs === null ? '—' : `${speed.right.tpotMs.toFixed(1)}ms` },
      { label: t('compare.metric.turnGap', locale), lv: fmtMs(speed.left.turnGapMedianMs), rv: fmtMs(speed.right.turnGapMedianMs) },
      { label: t('compare.metric.pureInference', locale), lv: fmtMs(speed.left.pureInferenceMs), rv: fmtMs(speed.right.pureInferenceMs) },
      { label: t('compare.kpi.avgLlmDuration', locale), lv: fmtMs(speed.left.avgLlmDurationMs), rv: fmtMs(speed.right.avgLlmDurationMs) },
    );
  } else if (item.key === 'tokens') {
    for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'netInput', 'total'] as const) {
      rows.push({
        label: `token.${key}`,
        lv: fmtNum(left.tokenUsage[key]),
        rv: fmtNum(right.tokenUsage[key]),
      });
    }
  } else if (item.key === 'cost') {
    rows.push(
      { label: t('session.cost', locale), lv: `$${left.costUsd.toFixed(4)}`, rv: `$${right.costUsd.toFixed(4)}` },
      { label: t('session.tokens', locale), lv: fmtNum(left.tokenUsage.total), rv: fmtNum(right.tokenUsage.total) },
      { label: t('compare.kpi.netInput', locale), lv: fmtNum(left.tokenUsage.netInput), rv: fmtNum(right.tokenUsage.netInput) },
    );
  } else if (item.key === 'failedCommands' || item.key === 'fixLoops') {
    // 建议 7：错误率 / 失败类卡片 → 按错误动作分组统计
    const buckets = errorDistribution(leftEvents, rightEvents);
    if (buckets.length === 0) {
      rows.push({ label: t('compare.noErrors', locale), lv: '—', rv: '—' });
    } else {
      for (const bucket of buckets) {
        rows.push({
          label: bucket.tool,
          lv: String(bucket.lf),
          rv: String(bucket.rf),
        });
      }
    }
  } else if (item.key === 'hasUnitTests' || item.key === 'verificationCoverage') {
    // 建议 7：验证覆盖率 / 单元测试 → 验证事件列表
    const lVerify = leftEvents.filter((e) => e.phase === 'verify').slice(0, 5);
    const rVerify = rightEvents.filter((e) => e.phase === 'verify').slice(0, 5);
    const lvText = lVerify.length === 0 ? '—' : lVerify.map((e) => e.title).join('\n');
    const rvText = rVerify.length === 0 ? '—' : rVerify.map((e) => e.title).join('\n');
    rows.push({ label: t('compare.kpi.verifyEvents', locale), lv: lvText, rv: rvText });
  } else if (item.key === 'errorRate') {
    // 建议 7：错误率 → 按错误类型分组统计
    const buckets = errorDistribution(leftEvents, rightEvents);
    if (buckets.length === 0) {
      rows.push({ label: t('compare.noErrors', locale), lv: '—', rv: '—' });
    } else {
      for (const bucket of buckets) {
        rows.push({ label: bucket.tool, lv: String(bucket.lf), rv: String(bucket.rf) });
      }
    }
  } else {
    return null;
  }

  return (
    <div className="compare-kpi-detail">
      <table className="ui-table ui-table-compact">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="mono">{row.label}</td>
              <td className="mono" style={{ textAlign: 'right', whiteSpace: 'pre-wrap' }}>{row.lv}</td>
              <td className="mono" style={{ textAlign: 'right', whiteSpace: 'pre-wrap' }}>{row.rv}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {item.key === 'failedCommands' || item.key === 'fixLoops' || item.key === 'errorRate' ? (
        <p className="hint">{t('compare.criteria.errorDist', locale)}</p>
      ) : null}
    </div>
  );
}

export function CompareKPI({
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const ls = useMemo(() => compareSideStats(leftEvents, result.speed.left, left), [leftEvents, result.speed.left, left]);
  const rs = useMemo(() => compareSideStats(rightEvents, result.speed.right, right), [rightEvents, result.speed.right, right]);
  const fmtPct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const fmtNum = (v: number | null): string => (v === null ? '—' : v.toLocaleString());
  const fmtConcise = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));

  const items: KpiItem[] = [
    { key: 'e2e', label: t('metric.speed', locale), lv: fmtMs(result.speed.left.e2eMs ?? null), rv: fmtMs(result.speed.right.e2eMs ?? null), lnum: result.speed.left.e2eMs ?? 0, rnum: result.speed.right.e2eMs ?? 0, lowerBetter: true, drill: true },
    { key: 'tokens', label: t('session.tokens', locale), lv: left.tokenUsage.total.toLocaleString(), rv: right.tokenUsage.total.toLocaleString(), lnum: left.tokenUsage.total, rnum: right.tokenUsage.total, lowerBetter: true, drill: true },
    { key: 'cost', label: t('session.cost', locale), lv: `$${left.costUsd.toFixed(4)}`, rv: `$${right.costUsd.toFixed(4)}`, lnum: left.costUsd, rnum: right.costUsd, lowerBetter: true, drill: true },
    { key: 'llmCalls', label: t('compare.kpi.llmCalls', locale), lv: String(ls.llmCalls), rv: String(rs.llmCalls), lnum: ls.llmCalls, rnum: rs.llmCalls, lowerBetter: false },
    { key: 'avgLlmDuration', label: t('compare.kpi.avgLlmDuration', locale), lv: fmtMs(ls.avgLlmDuration), rv: fmtMs(rs.avgLlmDuration), lnum: ls.avgLlmDuration ?? 0, rnum: rs.avgLlmDuration ?? 0, lowerBetter: true },
    { key: 'totalToolDuration', label: t('compare.kpi.totalToolDuration', locale), lv: fmtMs(ls.totalToolDuration), rv: fmtMs(rs.totalToolDuration), lnum: ls.totalToolDuration, rnum: rs.totalToolDuration, lowerBetter: true },
    { key: 'cacheHitRate', label: t('compare.kpi.cacheHitRate', locale), lv: fmtPct(ls.cacheHitRate), rv: fmtPct(rs.cacheHitRate), lnum: ls.cacheHitRate ?? 0, rnum: rs.cacheHitRate ?? 0, lowerBetter: false },
    { key: 'cacheRead', label: t('compare.kpi.cacheRead', locale), lv: fmtNum(ls.cacheRead), rv: fmtNum(rs.cacheRead), lnum: ls.cacheRead, rnum: rs.cacheRead, lowerBetter: true },
    { key: 'netInput', label: t('compare.kpi.netInput', locale), lv: fmtNum(ls.netInput), rv: fmtNum(rs.netInput), lnum: ls.netInput, rnum: rs.netInput, lowerBetter: true },
    { key: 'fileWrites', label: t('compare.kpi.fileWrites', locale), lv: String(ls.fileWrites), rv: String(rs.fileWrites), lnum: ls.fileWrites, rnum: rs.fileWrites, lowerBetter: false },
    { key: 'codeConciseness', label: t('compare.kpi.codeConciseness', locale), lv: fmtConcise(ls.codeConciseness), rv: fmtConcise(rs.codeConciseness), lnum: ls.codeConciseness ?? 0, rnum: rs.codeConciseness ?? 0, lowerBetter: true },
    { key: 'hasUnitTests', label: t('compare.kpi.hasUnitTests', locale), lv: fmtYesNo(ls.hasUnitTests ? 1 : 0), rv: fmtYesNo(rs.hasUnitTests ? 1 : 0), lnum: ls.hasUnitTests ? 1 : 0, rnum: rs.hasUnitTests ? 1 : 0, lowerBetter: false, drill: true },
    { key: 'userRounds', label: t('compare.kpi.userRounds', locale), lv: String(ls.userRounds), rv: String(rs.userRounds), lnum: ls.userRounds, rnum: rs.userRounds, lowerBetter: false },
    { key: 'fixLoops', label: t('compare.kpi.fixLoops', locale), lv: String(ls.fixLoops), rv: String(rs.fixLoops), lnum: ls.fixLoops, rnum: rs.fixLoops, lowerBetter: true, drill: true },
    {
      key: 'errorRate',
      label: t('compare.kpi.errorRate', locale),
      lv: fmtPct(leftEvents.length === 0 ? null : leftEvents.filter((e) => e.status === 'error').length / leftEvents.length),
      rv: fmtPct(rightEvents.length === 0 ? null : rightEvents.filter((e) => e.status === 'error').length / rightEvents.length),
      lnum: leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.status === 'error').length / leftEvents.length,
      rnum: rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.status === 'error').length / rightEvents.length,
      lowerBetter: true,
      drill: true,
    },
    {
      key: 'verificationCoverage',
      label: t('compare.kpi.verificationCoverage', locale),
      lv: fmtPct(leftEvents.length === 0 ? null : leftEvents.filter((e) => e.phase === 'verify').length / leftEvents.length),
      rv: fmtPct(rightEvents.length === 0 ? null : rightEvents.filter((e) => e.phase === 'verify').length / rightEvents.length),
      lnum: leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.phase === 'verify').length / leftEvents.length,
      rnum: rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.phase === 'verify').length / rightEvents.length,
      lowerBetter: false,
      drill: true,
    },
  ];

  return (
    <section className="compare-kpis" id="compare-kpi">
      {items.map((item) => {
        const leftBetter = item.lnum === item.rnum ? null : item.lowerBetter ? item.lnum < item.rnum : item.lnum > item.rnum;
        const diff = diffPct(item.lnum, item.rnum);
        const isExpanded = expanded === item.key;
        const content = (
          <>
            <span className="compare-kpi-label">{item.label}</span>
            <div className="compare-kpi-values">
              <span className="mono compare-kpi-side">
                <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
                {item.lv}
              </span>
              <span className="mono compare-kpi-side">
                <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
                {item.rv}
              </span>
            </div>
            <span
              className={`compare-delta ${leftBetter === null ? '' : leftBetter ? 'compare-delta-win' : 'compare-delta-lose'}`}
            >
              {leftBetter === null ? '=' : `${diff.toFixed(0)}% ${leftBetter ? '← L' : '→ R'}`}
            </span>
          </>
        );
        const inner =
          item.drill === true ? (
            <button
              type="button"
              className="compare-kpi compare-kpi-drill"
              aria-expanded={isExpanded}
              aria-label={`${item.label} ${t('compare.kpiDrill', locale)}`}
              onClick={() => setExpanded(isExpanded ? null : item.key)}
            >
              {content}
            </button>
          ) : (
            <div className="compare-kpi">{content}</div>
          );
        return (
          <div key={item.key} className="compare-kpi-cell">
            {inner}
            {isExpanded && item.drill === true && (
              <KpiDrilldown item={item} result={result} locale={locale} />
            )}
          </div>
        );
      })}
    </section>
  );
}
