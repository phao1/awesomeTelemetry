import { scanTimingReason, scanTimingValue } from '../core/scan-timing.js';
import type { ScanTimingMetric } from '../core/scan-timing.js';
import { useId, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SessionIndexEntry, TraceEventSlim } from '../core/trace-types.js';
import { TRACE_KINDS } from '../core/trace-types.js';
import {
  compareSideStats,
  compareActivity,
  errorDistribution,
  eventKindCounts,
  fmtMs,
} from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { classifyErrorText } from '../core/error-classifier.js';
import { HBarChart } from './charts/HBarChart.js';
import { Sparkline, type SparklineSeries } from './charts/Sparkline.js';
import { BarMeter } from './ui/Misc.js';
import { CompareMiniTimeline } from './CompareTimeline.js';
import { IconChevronDown } from './icons/index.js';

interface KpiItem {
  key: string;
  label: string;
  lv: string;
  rv: string;
  lnum: number | null;
  rnum: number | null;
  timing?: ScanTimingMetric;
  lowerBetter: boolean;
  /** 有 drill-down 明细的 key 才可展开。 */
  drill?: boolean;
}

function eventTokenTotal(e: TraceEventSlim): number {
  return e.tokens === null ? 0 : e.tokens.total;
}

type OpenRecord = (key: string, eventId?: string) => void;

function EvidenceRecord({event, sessionKey, mark, locale, onOpenRun}: {
  event: TraceEventSlim; sessionKey: string; mark: 'L' | 'R'; locale: Locale; onOpenRun?: OpenRecord;
}): React.JSX.Element {
  return <button type="button" className="cmp-record-link" disabled={!onOpenRun}
    data-evidence-session={sessionKey} data-evidence-event={event.id}
    title={event.id} aria-label={`${mark} #${event.sequence} ${event.title} · ${t('compare.evidence.openRecord',locale)}`}
    onClick={() => onOpenRun?.(sessionKey,event.id)}>
    <span className="mono">#{event.sequence}</span><span>{event.title || event.tool || event.id}</span>
  </button>;
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
  result,
  onOpenRun,
}: {
  leftEvents: TraceEventSlim[];
  rightEvents: TraceEventSlim[];
  locale: Locale;
  result: CompareResult;
  onOpenRun?: OpenRecord;
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
              <EvidenceRecord event={e} sessionKey={result[mark === 'L' ? 'left' : 'right'].session.id} mark={mark} locale={locale} onOpenRun={onOpenRun}/>
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
  result,
  onOpenRun,
}: {
  leftEvents: TraceEventSlim[];
  rightEvents: TraceEventSlim[];
  locale: Locale;
  result: CompareResult;
  onOpenRun?: OpenRecord;
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
                <EvidenceRecord event={e} sessionKey={result[mark === 'L' ? 'left' : 'right'].session.id} mark={mark} locale={locale} onOpenRun={onOpenRun}/>
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

/** REQ-100 DrillDownDuration：双自包含紧凑时间线（20 行上限）。 */
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
      <CompareMiniTimeline
        events={events.slice(0, 20)}
        total={Math.min(20, events.length)}
        locale={locale}
        mode="time"
        compact
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
  onOpenRun,
}: {
  item: KpiItem;
  result: CompareResult;
  locale: Locale;
  onOpenRun?: OpenRecord;
}): React.JSX.Element | null {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;

  const rows: Array<{ label: string; lv: string; rv: string }> = [];

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
        <DrillDownTokens leftEvents={leftEvents} rightEvents={rightEvents} locale={locale} result={result} onOpenRun={onOpenRun}/>
      </div>
    );
  }
  if (item.key === 'failures') {
    return (
      <div className="compare-kpi-detail kpi-drilldown-panel">
        <DrillDownErrors leftEvents={leftEvents} rightEvents={rightEvents} locale={locale} result={result} onOpenRun={onOpenRun}/>
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
    const numeric = (value: unknown): string => scanTimingValue(value)?.toFixed(1) ?? '—';
    const milliseconds = (value: unknown): string => fmtMs(scanTimingValue(value));
    const perToken = (value: unknown): string => scanTimingValue(value) === null ? '—' : `${scanTimingValue(value)!.toFixed(1)}ms`;
    rows.push(
      { label: 'TTFT', lv: milliseconds(speed.left.ttftMs), rv: milliseconds(speed.right.ttftMs) },
      { label: 'TPS', lv: numeric(speed.left.tps), rv: numeric(speed.right.tps) },
      { label: 'TPOT', lv: perToken(speed.left.tpotMs), rv: perToken(speed.right.tpotMs) },
      { label: t('compare.metric.turnGap', locale), lv: milliseconds(speed.left.turnGapMedianMs), rv: milliseconds(speed.right.turnGapMedianMs) },
      { label: t('compare.metric.pureInference', locale), lv: milliseconds(speed.left.pureInferenceMs), rv: milliseconds(speed.right.pureInferenceMs) },
      { label: t('compare.kpi.avgLlmDuration', locale), lv: milliseconds(speed.left.avgLlmDurationMs), rv: milliseconds(speed.right.avgLlmDurationMs) },
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
  onOpenRun,
}: {
  result: CompareResult;
  locale: Locale;
  /** REQ-122：App 共享的会话索引，用于跨会话趋势。MUST NOT 发额外请求（G11.9）。 */
  sessions?: readonly SessionIndexEntry[];
  onOpenRun?: OpenRecord;
}): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const [expanded, setExpanded] = useState<string | null>(null);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeDetails = (): void => { triggerRef.current?.focus(); setExpanded(null); };
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
  const la = compareActivity(result.left);
  const ra = compareActivity(result.right);
  const fmtPct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const fmtNum = (v: number | null): string => (v === null ? '—' : v.toLocaleString());
  const fmtConcise = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));

  const items: KpiItem[] = [
    {
      key: 'events',
      label: t('compare.kpi.events', locale),
      lv: result.left.eventTotal.toLocaleString(),
      rv: result.right.eventTotal.toLocaleString(),
      lnum: result.left.eventTotal,
      rnum: result.right.eventTotal,
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
    { key: 'e2e', label: t('compare.profile.wallClock', locale), lv: fmtMs(scanTimingValue(result.speed.left.e2eMs)), rv: fmtMs(scanTimingValue(result.speed.right.e2eMs)), lnum: scanTimingValue(result.speed.left.e2eMs), rnum: scanTimingValue(result.speed.right.e2eMs), timing: 'e2e', lowerBetter: true, drill: true },
    { key: 'avgLlmDuration', label: t('compare.kpi.avgLlmDuration', locale), lv: fmtMs(scanTimingValue(ls.avgLlmDuration)), rv: fmtMs(scanTimingValue(rs.avgLlmDuration)), lnum: scanTimingValue(ls.avgLlmDuration), rnum: scanTimingValue(rs.avgLlmDuration), timing: 'eventDuration', lowerBetter: true },
    { key: 'totalToolDuration', label: t('compare.kpi.totalToolDuration', locale), lv: fmtMs(scanTimingValue(ls.totalToolDuration)), rv: fmtMs(scanTimingValue(rs.totalToolDuration)), lnum: scanTimingValue(ls.totalToolDuration), rnum: scanTimingValue(rs.totalToolDuration), timing: 'eventDuration', lowerBetter: true },
    { key: 'cacheHitRate', label: t('compare.kpi.cacheHitRate', locale), lv: fmtPct(ls.cacheHitRate), rv: fmtPct(rs.cacheHitRate), lnum: ls.cacheHitRate, rnum: rs.cacheHitRate, lowerBetter: false },
    { key: 'cacheRead', label: t('compare.kpi.cacheRead', locale), lv: fmtNum(ls.cacheRead), rv: fmtNum(rs.cacheRead), lnum: ls.cacheRead, rnum: rs.cacheRead, lowerBetter: true },
    { key: 'netInput', label: t('compare.kpi.netInput', locale), lv: fmtNum(ls.netInput), rv: fmtNum(rs.netInput), lnum: ls.netInput, rnum: rs.netInput, lowerBetter: true },
    { key: 'fileWrites', label: t('compare.kpi.fileWrites', locale), lv: String(ls.fileWrites), rv: String(rs.fileWrites), lnum: ls.fileWrites, rnum: rs.fileWrites, lowerBetter: false },
    { key: 'codeConciseness', label: t('compare.activity.stepsPerWrite', locale), lv: fmtConcise(la.complete ? ls.codeConciseness : null), rv: fmtConcise(ra.complete ? rs.codeConciseness : null), lnum: la.complete ? ls.codeConciseness : null, rnum: ra.complete ? rs.codeConciseness : null, lowerBetter: true },
    { key: 'hasUnitTests', label: t('compare.activity.testCommand', locale), lv: la.complete ? fmtYesNo(ls.hasUnitTests ? 1 : 0) : '—', rv: ra.complete ? fmtYesNo(rs.hasUnitTests ? 1 : 0) : '—', lnum: la.complete ? Number(ls.hasUnitTests) : null, rnum: ra.complete ? Number(rs.hasUnitTests) : null, lowerBetter: false, drill: true },
    { key: 'userRounds', label: t('compare.kpi.userRounds', locale), lv: String(ls.userRounds), rv: String(rs.userRounds), lnum: ls.userRounds, rnum: rs.userRounds, lowerBetter: false },
    { key: 'fixLoops', label: t('compare.kpi.fixLoops', locale), lv: String(ls.fixLoops), rv: String(rs.fixLoops), lnum: ls.fixLoops, rnum: rs.fixLoops, lowerBetter: true, drill: true },
    {
      key: 'errorRate',
      label: t('compare.activity.errorSteps', locale),
      lv: fmtPct(la.errorRate), rv: fmtPct(ra.errorRate),
      lnum: la.errorRate, rnum: ra.errorRate,
      lowerBetter: true,
      drill: true,
    },
    {
      key: 'verificationCoverage',
      label: t('compare.activity.verification', locale),
      lv: fmtPct(la.verification), rv: fmtPct(ra.verification),
      lnum: la.verification, rnum: ra.verification,
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

  const eventDerived = new Set(['failures','llmCalls','avgLlmDuration','totalToolDuration','cacheRead','fileWrites','codeConciseness','hasUnitTests','userRounds','fixLoops','errorRate','verificationCoverage']);
  const renderItem = (item: KpiItem): React.JSX.Element => {
        const rawDiff = item.lnum === null || item.rnum === null ? null : item.rnum - item.lnum;
        const reason = item.timing === undefined ? null : scanTimingReason(result.left, result.right, item.timing, item.lnum, item.rnum)
          ?? (rawDiff !== null && !Number.isFinite(rawDiff) ? 'invalid_value' : null);
        const incomplete = eventDerived.has(item.key) && (!la.complete || !ra.complete);
        const diff = rawDiff !== null && Number.isFinite(rawDiff) && !incomplete && item.key !== 'hasUnitTests' ? rawDiff : null;
        const ratio = item.key === 'errorRate' || item.key === 'verificationCoverage' || item.key === 'cacheHitRate';
        const delta = diff === null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${item.timing ? fmtMs(Math.abs(diff)) : (Math.abs(diff) * (ratio ? 100 : 1)).toLocaleString(locale,{maximumFractionDigits:2})}${ratio ? ` ${t('compare.activity.percentagePoints',locale)}` : ''}`;
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
              className="compare-delta"
              data-scan-timing-reason={reason ?? undefined}
            >
              {reason !== null ? `${t('scan.timing.notComparable', locale)}: ${t(`scan.timing.reason.${reason}`, locale)}` : diff === null ? t(incomplete ? 'compare.activity.partial' : 'compare.activity.unavailable',locale) : `R − L: ${delta}`}
            </span>
          </>
        );
        const inner =
          item.drill === true ? (
            <button
              type="button"
              className="compare-kpi compare-kpi-drill"
              aria-expanded={isExpanded}
              aria-controls={isExpanded ? panelId : undefined}
              aria-label={`${item.label} ${t('compare.kpiDrill', locale)}`}
              onClick={event => { triggerRef.current = event.currentTarget; setExpanded(isExpanded ? null : item.key); }}
            >
              {content}
            </button>
          ) : (
            <div className="compare-kpi">{content}</div>
          );
        return (
          <div key={item.key} className="compare-kpi-cell">
            {inner}
          </div>
        );
  };
  const expandedPanel = (group: KpiItem[]): React.JSX.Element | null => {
    const item=group.find(entry=>entry.key===expanded&&entry.drill===true);
    return item===undefined?null:<section className="compare-kpi-expanded" id={panelId} aria-label={`${item.label} · ${t('compare.kpiDrill',locale)}`}
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDetails();}}}>
      <header><strong>{item.label}</strong><button type="button" className="btn ui-btn-sm" onClick={closeDetails}>{t('common.close',locale)}</button></header>
      <KpiDrilldown item={item} result={result} locale={locale} onOpenRun={onOpenRun}/>
    </section>;
  };
  return (
    <section id="compare-kpi">
      <div className="compare-kpi-scope">
        <p>{t('compare.activity.scope',locale)} · L {leftEvents.length.toLocaleString()} / {result.left.eventTotal.toLocaleString()} · R {rightEvents.length.toLocaleString()} / {result.right.eventTotal.toLocaleString()}</p>
        <p className="hint">{t('compare.activity.criteria',locale)}</p>
        {(la.unknownStatuses > 0 || ra.unknownStatuses > 0) && <p role="status">{t('compare.activity.unknownStatuses',locale)} · L {la.unknownStatuses} / R {ra.unknownStatuses}</p>}
      </div>
      <div className="compare-kpis compare-kpi-primary">{items.slice(0,6).map(renderItem)}{expandedPanel(items.slice(0,6))}</div>
      <details className="compare-kpi-more">
        <summary>{t('compare.activity.more',locale)} · {items.length - 6}</summary>
        <div className="compare-kpis">{items.slice(6).map(renderItem)}{expandedPanel(items.slice(6))}</div>
      </details>
    </section>
  );
}
