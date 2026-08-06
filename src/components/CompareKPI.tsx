import { formatCostUsd } from '../core/pricing.js';
import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SessionIndexEntry, TraceEventSlim } from '../core/trace-types.js';
import { TRACE_KINDS } from '../core/trace-types.js';
import {
  compareSideStats,
  diffPct,
  errorDistribution,
  eventKindCounts,
  fmtMs,
} from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { classifyErrorText } from '../core/error-classifier.js';
import { HBarChart } from './charts/HBarChart.js';
import { Sparkline, type SparklineSeries } from './charts/Sparkline.js';
import { BarMeter } from './ui/Misc.js';
import { TraceTimeline } from './TraceTimeline.js';
import { IconChevronDown } from './icons/index.js';

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

function eventTokenTotal(e: TraceEventSlim): number {
  return e.tokens === null ? 0 : e.tokens.total;
}

/** REQ-100 DrillDownEvents：事件类型分布双条形图（L/R 各一，复用 HBarChart）。 */
function DrillDownEvents({
  leftEvents,
  rightEvents,
  locale,
}: {
  leftEvents: TraceEventSlim[];
  rightEvents: TraceEventSlim[];
  locale: Locale;
}): React.JSX.Element {
  const lCounts = eventKindCounts(leftEvents);
  const rCounts = eventKindCounts(rightEvents);
  const rows = TRACE_KINDS.map((kind) => ({
    kind,
    l: lCounts.get(kind) ?? 0,
    r: rCounts.get(kind) ?? 0,
  }))
    .filter((row) => row.l > 0 || row.r > 0)
    .sort((a, b) => b.l + b.r - (a.l + a.r));
  const peak = Math.max(1, ...rows.map((row) => Math.max(row.l, row.r)));
  if (rows.length === 0) {
    return <p className="hint">{t('compare.drilldown.noEvents', locale)}</p>;
  }
  const toSlices = (side: 'l' | 'r'): Array<{ label: string; value: number }> =>
    rows.map((row) => ({ label: row.kind, value: row[side] }));
  return (
    <div className="kpi-drilldown kpi-drilldown-events">
      <div className="kpi-drilldown-chart">
        <h5 className="kpi-drilldown-title">
          <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
          {t('compare.drilldown.events', locale)}
        </h5>
        <HBarChart rows={toSlices('l')} max={peak} tone="accent" height={rows.length * 24 + 12} />
      </div>
      <div className="kpi-drilldown-chart">
        <h5 className="kpi-drilldown-title">
          <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
          {t('compare.drilldown.events', locale)}
        </h5>
        <HBarChart rows={toSlices('r')} max={peak} tone="attention" height={rows.length * 24 + 12} />
      </div>
    </div>
  );
}

/** REQ-100 DrillDownTokens：Top-10 token 消耗事件双列对比表。 */
function DrillDownTokens({
  leftEvents,
  rightEvents,
  locale,
}: {
  leftEvents: TraceEventSlim[];
  rightEvents: TraceEventSlim[];
  locale: Locale;
}): React.JSX.Element {
  const side = (events: TraceEventSlim[]): TraceEventSlim[] =>
    events
      .filter((e) => e.tokens !== null && e.tokens.total > 0)
      .sort((a, b) => eventTokenTotal(b) - eventTokenTotal(a))
      .slice(0, 10);
  const lTop = side(leftEvents);
  const rTop = side(rightEvents);
  if (lTop.length === 0 && rTop.length === 0) {
    return <p className="hint">{t('compare.drilldown.noTokens', locale)}</p>;
  }
  const max = Math.max(1, ...lTop.map(eventTokenTotal), ...rTop.map(eventTokenTotal));
  const column = (events: TraceEventSlim[], mark: 'L' | 'R'): React.JSX.Element => (
    <div className="kpi-drilldown-token-col">
      <h5 className="kpi-drilldown-title">
        <span className="compare-side-mark" style={{ color: mark === 'L' ? 'var(--accent-fg)' : 'var(--attention-fg)' }}>{mark}</span>
        {t('compare.drilldown.tokens', locale)}
      </h5>
      {events.length === 0 ? (
        <p className="hint">{t('compare.drilldown.noTokens', locale)}</p>
      ) : (
        <ul className="kpi-drilldown-token-list">
          {events.map((e) => (
            <li key={e.id} className="kpi-drilldown-token-row">
              <span className="kpi-drilldown-token-title" title={e.title}>{e.title}</span>
              <span className="mono kpi-drilldown-token-count">{eventTokenTotal(e).toLocaleString()}</span>
              <BarMeter value={eventTokenTotal(e)} max={max} tone={mark === 'L' ? 'accent' : 'attention'} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="kpi-drilldown kpi-drilldown-tokens">
      {column(lTop, 'L')}
      {column(rTop, 'R')}
    </div>
  );
}

/** REQ-100 DrillDownErrors：失败事件列表（L/R 各列：标题 + 错误类型 + 时间）。 */
function DrillDownErrors({
  leftEvents,
  rightEvents,
  locale,
}: {
  leftEvents: TraceEventSlim[];
  rightEvents: TraceEventSlim[];
  locale: Locale;
}): React.JSX.Element {
  const failed = (events: TraceEventSlim[]): TraceEventSlim[] =>
    events.filter((e) => e.status === 'error');
  const column = (events: TraceEventSlim[], mark: 'L' | 'R'): React.JSX.Element => {
    const list = failed(events);
    return (
      <div className="kpi-drilldown-error-col">
        <h5 className="kpi-drilldown-title">
          <span className="compare-side-mark" style={{ color: mark === 'L' ? 'var(--accent-fg)' : 'var(--attention-fg)' }}>{mark}</span>
          {t('compare.drilldown.errors', locale)}
        </h5>
        {list.length === 0 ? (
          <p className="hint">{t('compare.drilldown.noFailures', locale)}</p>
        ) : (
          <ul className="kpi-drilldown-error-list">
            {list.slice(0, 20).map((e) => (
              <li key={e.id} className="kpi-drilldown-error-row">
                <span className="kpi-drilldown-error-title" title={e.title}>{e.title}</span>
                <span className="kpi-drilldown-error-meta">
                  <span className="kpi-drilldown-error-class">{classifyErrorText(e.error)}</span>
                  <span className="mono kpi-drilldown-error-time">{e.startedAt.slice(11, 19)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <div className="kpi-drilldown kpi-drilldown-errors">
      {column(leftEvents, 'L')}
      {column(rightEvents, 'R')}
    </div>
  );
}

/** REQ-100 DrillDownDuration：双 TraceTimeline compact（20 行上限）。 */
function DrillDownDuration({
  leftEvents,
  rightEvents,
  locale,
}: {
  leftEvents: TraceEventSlim[];
  rightEvents: TraceEventSlim[];
  locale: Locale;
}): React.JSX.Element {
  const timeline = (events: TraceEventSlim[], mark: 'L' | 'R'): React.JSX.Element => (
    <div className="kpi-drilldown-timeline">
      <h5 className="kpi-drilldown-title">
        <span className="compare-side-mark" style={{ color: mark === 'L' ? 'var(--accent-fg)' : 'var(--attention-fg)' }}>{mark}</span>
        {t('compare.drilldown.duration', locale)}
      </h5>
      <TraceTimeline
        events={events.slice(0, 20)}
        total={Math.min(20, events.length)}
        hasMore={false}
        onLoadMore={() => undefined}
        onSelectEvent={() => undefined}
        selectedEventId={null}
        locale={locale}
        layoutMode="time"
        semanticGroup={false}
      />
    </div>
  );
  return (
    <div className="kpi-drilldown kpi-drilldown-duration">
      {timeline(leftEvents, 'L')}
      {timeline(rightEvents, 'R')}
    </div>
  );
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

  if (item.key === 'events') {
    return (
      <div className="compare-kpi-detail kpi-drilldown-panel">
        <DrillDownEvents leftEvents={leftEvents} rightEvents={rightEvents} locale={locale} />
      </div>
    );
  }
  if (item.key === 'tokens') {
    return (
      <div className="compare-kpi-detail kpi-drilldown-panel">
        <DrillDownTokens leftEvents={leftEvents} rightEvents={rightEvents} locale={locale} />
      </div>
    );
  }
  if (item.key === 'failures') {
    return (
      <div className="compare-kpi-detail kpi-drilldown-panel">
        <DrillDownErrors leftEvents={leftEvents} rightEvents={rightEvents} locale={locale} />
      </div>
    );
  }
  if (item.key === 'llmCalls') {
    return (
      <div className="compare-kpi-detail kpi-drilldown-panel">
        <DrillDownDuration leftEvents={leftEvents} rightEvents={rightEvents} locale={locale} />
      </div>
    );
  }
  if (item.key === 'e2e') {
    rows.push(
      { label: 'TTFT', lv: fmtMs(speed.left.ttftMs), rv: fmtMs(speed.right.ttftMs) },
      { label: 'TPS', lv: speed.left.tps?.toFixed(1) ?? '—', rv: speed.right.tps?.toFixed(1) ?? '—' },
      { label: 'TPOT', lv: speed.left.tpotMs === null ? '—' : `${speed.left.tpotMs.toFixed(1)}ms`, rv: speed.right.tpotMs === null ? '—' : `${speed.right.tpotMs.toFixed(1)}ms` },
      { label: t('compare.metric.turnGap', locale), lv: fmtMs(speed.left.turnGapMedianMs), rv: fmtMs(speed.right.turnGapMedianMs) },
      { label: t('compare.metric.pureInference', locale), lv: fmtMs(speed.left.pureInferenceMs), rv: fmtMs(speed.right.pureInferenceMs) },
      { label: t('compare.kpi.avgLlmDuration', locale), lv: fmtMs(speed.left.avgLlmDurationMs), rv: fmtMs(speed.right.avgLlmDurationMs) },
    );
  } else if (item.key === 'cost') {
    rows.push(
      { label: t('session.cost', locale), lv: formatCostUsd(left.costUsd, left.costSource), rv: formatCostUsd(right.costUsd, right.costSource) },
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

/** REQ-122：可从会话索引直接取到历史序列的 KPI（其余 KPI 无跨会话历史，不画趋势）。 */
const KPI_TREND_METRIC: Record<string, (session: SessionIndexEntry) => number> = {
  events: (s) => s.eventCount,
  tokens: (s) => s.tokenTotal,
  cost: (s) => s.costUsd,
  userRounds: (s) => s.messageCount,
};

/** REQ-122：少于该会话数不画趋势线。 */
export const MIN_TREND_SESSIONS = 3;

/** 取某个 agent（provider + sourceAgent）的历史会话，按开始时间升序。 */
function agentHistory(
  sessions: readonly SessionIndexEntry[],
  provider: string,
  sourceAgent: string,
): SessionIndexEntry[] {
  return sessions
    .filter((s) => s.provider === provider && s.sourceAgent === sourceAgent)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}

export function CompareKPI({
  result,
  locale,
  sessions = [],
}: {
  result: CompareResult;
  locale: Locale;
  /** REQ-122：App 共享的会话索引，用于跨会话趋势。MUST NOT 发额外请求（G11.9）。 */
  sessions?: readonly SessionIndexEntry[];
}): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const [expanded, setExpanded] = useState<string | null>(null);
  // REQ-122：两侧 agent 的历史会话（从共享 store 派生，不发请求）。
  const history = useMemo(
    () => ({
      left: agentHistory(sessions, left.provider, left.sourceAgent),
      right: agentHistory(sessions, right.provider, right.sourceAgent),
    }),
    [sessions, left.provider, left.sourceAgent, right.provider, right.sourceAgent],
  );
  const ls = useMemo(() => compareSideStats(leftEvents, result.speed.left, left), [leftEvents, result.speed.left, left]);
  const rs = useMemo(() => compareSideStats(rightEvents, result.speed.right, right), [rightEvents, result.speed.right, right]);
  const fmtPct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const fmtNum = (v: number | null): string => (v === null ? '—' : v.toLocaleString());
  const fmtConcise = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));

  const items: KpiItem[] = [
    {
      key: 'events',
      label: t('compare.kpi.events', locale),
      lv: left.eventCount.toLocaleString(),
      rv: right.eventCount.toLocaleString(),
      lnum: left.eventCount,
      rnum: right.eventCount,
      lowerBetter: false,
      drill: true,
    },
    {
      key: 'tokens',
      label: t('session.tokens', locale),
      lv: left.tokenUsage.total.toLocaleString(),
      rv: right.tokenUsage.total.toLocaleString(),
      lnum: left.tokenUsage.total,
      rnum: right.tokenUsage.total,
      lowerBetter: true,
      drill: true,
    },
    {
      key: 'failures',
      label: t('compare.kpi.failures', locale),
      lv: String(leftEvents.filter((e) => e.status === 'error').length),
      rv: String(rightEvents.filter((e) => e.status === 'error').length),
      lnum: leftEvents.filter((e) => e.status === 'error').length,
      rnum: rightEvents.filter((e) => e.status === 'error').length,
      lowerBetter: true,
      drill: true,
    },
    {
      key: 'llmCalls',
      label: t('compare.kpi.llmCalls', locale),
      lv: String(ls.llmCalls),
      rv: String(rs.llmCalls),
      lnum: ls.llmCalls,
      rnum: rs.llmCalls,
      lowerBetter: false,
      drill: true,
    },
    { key: 'e2e', label: t('metric.speed', locale), lv: fmtMs(result.speed.left.e2eMs ?? null), rv: fmtMs(result.speed.right.e2eMs ?? null), lnum: result.speed.left.e2eMs ?? 0, rnum: result.speed.right.e2eMs ?? 0, lowerBetter: true, drill: true },
    { key: 'cost', label: t('session.cost', locale), lv: formatCostUsd(left.costUsd, left.costSource), rv: formatCostUsd(right.costUsd, right.costSource), lnum: left.costUsd, rnum: right.costUsd, lowerBetter: true, drill: true },
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

  /** REQ-122：KPI 卡上方的双线趋势条。两侧都不足 3 个历史会话时给出提示而非空图。 */
  const trendFor = (key: string): React.JSX.Element | null => {
    const metric = KPI_TREND_METRIC[key];
    if (metric === undefined) {
      return null;
    }
    const series: SparklineSeries[] = [];
    const push = (rows: SessionIndexEntry[], color: string, label: string): void => {
      if (rows.length < MIN_TREND_SESSIONS) {
        return;
      }
      series.push({
        label,
        color,
        points: rows.map((s) => ({
          value: metric(s),
          label: s.title || s.id,
          at: s.startedAt.slice(0, 16).replace('T', ' '),
        })),
      });
    };
    push(history.left, `var(--provider-${left.provider})`, 'L');
    push(history.right, `var(--provider-${right.provider})`, 'R');
    if (series.length === 0) {
      return (
        <span className="compare-kpi-trend compare-kpi-trend-empty">
          {t('compare.trend.needMore', locale).replace('{n}', String(MIN_TREND_SESSIONS))}
        </span>
      );
    }
    return (
      <span className="compare-kpi-trend">
        <Sparkline
          series={series}
          width={140}
          height={26}
          ariaLabel={t('compare.trend.label', locale)}
        />
      </span>
    );
  };

  return (
    <section className="compare-kpis" id="compare-kpi">
      {items.map((item) => {
        const leftBetter = item.lnum === item.rnum ? null : item.lowerBetter ? item.lnum < item.rnum : item.lnum > item.rnum;
        const diff = diffPct(item.lnum, item.rnum);
        const isExpanded = expanded === item.key;
        const trend = trendFor(item.key);
        const content = (
          <>
            {trend}
            <span className="compare-kpi-head">
              <span className="compare-kpi-label">{item.label}</span>
              {item.drill === true && (
                <span className={`compare-kpi-chevron ${isExpanded ? 'compare-kpi-chevron-open' : ''}`} aria-hidden="true">
                  <IconChevronDown size={12} />
                </span>
              )}
            </span>
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
