import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  SessionIndexEntry,
  TraceEventSlim,
  TracePhase,
} from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Popover } from './ui/Overlay.js';
import { SearchInput } from './ui/Input.js';
import { TimeCompositionBar } from './TimeCompositionBar.js';
import { computeTimeComposition } from '../core/time-composition.js';
import { ContextBar } from './ContextBar.js';
import { groupEvents } from '../core/event-groups.js';
import { diffPct, fmtMs, SIGNIFICANT_DIFF, TEST_CMD } from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { CompareVerdict } from './CompareVerdict.js';
import { CompareKPI } from './CompareKPI.js';
import { CompareSpeedMetrics } from './CompareSpeedMetrics.js';
import { CompareDimensions } from './CompareDimensions.js';
import { CompareToolAnalysis } from './CompareToolAnalysis.js';
import { CompareCharts } from './CompareCharts.js';
import { CompareTimeline } from './CompareTimeline.js';
import { IconChevronDown, IconChevronRight } from './icons/index.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';

export type { CompareResult } from './compare-types.js';

function SessionPicker({
  side,
  sessions,
  value,
  locale,
  onSelect,
  open,
  onOpenChange,
}: {
  side: 'L' | 'R';
  sessions: SessionIndexEntry[];
  value: string;
  locale: Locale;
  onSelect: (key: string) => void;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const selected = sessions.find((s) => s.id === value);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        q === '' || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [sessions, search]);
  const sideColor = side === 'L' ? 'accent' : 'attention';
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSearch('');
        }
      }}
      trigger={(props) => (
        <button type="button" className="btn compare-picker" {...props}>
          <span
            className="compare-side-mark"
            style={{
              background: `var(--${sideColor}-subtle)`,
              color: `var(--${sideColor}-fg)`,
            }}
          >
            {side}
          </span>
          <span style={{ maxWidth: 'var(--space-10)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected !== undefined ? selected.title || selected.id : t(`compare.${side === 'L' ? 'left' : 'right'}`, locale)}
          </span>
        </button>
      )}
      style={{ maxHeight: '60vh', overflowY: 'auto', width: 'var(--rail-width)' }}
    >
      <div style={{ padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <SearchInput placeholder={t('session.search', locale)} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="compare-picker-list">
          {filtered.slice(0, PICKER_LIMIT).map((session) => (
            <button
              key={session.id}
              type="button"
              className={`compare-picker-item ${session.id === value ? 'compare-picker-item-on' : ''}`}
              onClick={() => {
                onSelect(session.id);
                onOpenChange(false);
              }}
            >
              <span className="compare-picker-title">{session.title || session.id}</span>
              <span className="mono">{session.eventCount} ev</span>
            </button>
          ))}
          {filtered.length > PICKER_LIMIT && (
            <p className="hint" style={{ margin: 0 }}>
              {t('compare.pickerMore', locale).replace('{n}', String(filtered.length - PICKER_LIMIT))}
            </p>
          )}
        </div>
      </div>
    </Popover>
  );
}

/** REQ-019：选择器列表上限 —— 数百会话时 Popover 不因全量渲染卡顿。 */
const PICKER_LIMIT = 100;

export interface CompareSelectorBarProps {
  sessions: SessionIndexEntry[];
  locale: Locale;
  onCompare: (left: string, right: string) => void;
  leftKey: string;
  rightKey: string;
  onLeftChange: (key: string) => void;
  onRightChange: (key: string) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onLeftOpenChange: (next: boolean) => void;
  onRightOpenChange: (next: boolean) => void;
}

export function CompareSelectorBar({
  sessions,
  locale,
  onCompare,
  leftKey,
  rightKey,
  onLeftChange,
  onRightChange,
  leftOpen,
  rightOpen,
  onLeftOpenChange,
  onRightOpenChange,
}: CompareSelectorBarProps): React.JSX.Element {
  return (
    <div className="compare-bar">
      <SessionPicker
        side="L"
        sessions={sessions}
        value={leftKey}
        locale={locale}
        onSelect={onLeftChange}
        open={leftOpen}
        onOpenChange={onLeftOpenChange}
      />
      <SessionPicker
        side="R"
        sessions={sessions}
        value={rightKey}
        locale={locale}
        onSelect={onRightChange}
        open={rightOpen}
        onOpenChange={onRightOpenChange}
      />
      <button
        type="button"
        className="btn"
        disabled={leftKey === '' || rightKey === ''}
        onClick={() => onCompare(leftKey, rightKey)}
      >
        {t('compare.load', locale)}
      </button>
    </div>
  );
}

/** §5.5：左右 PhaseRibbon 上下对照，共享同一时间比例尺。 */
function PhaseRibbonPair({
  left,
  right,
  locale,
}: {
  left: TraceEventSlim[];
  right: TraceEventSlim[];
  locale: Locale;
}): React.JSX.Element {
  const axis = useMemo(() => {
    const all = [...left, ...right];
    if (all.length === 0) {
      return null;
    }
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const e of all) {
      const s = Date.parse(e.startedAt);
      if (s < start) {
        start = s;
      }
      const finish = s + e.durationMs;
      if (finish > end) {
        end = finish;
      }
    }
    return { start, span: Math.max(1, end - start) };
  }, [left, right]);

  const ribbon = (events: TraceEventSlim[], side: 'L' | 'R'): React.JSX.Element => {
    if (axis === null) {
      return <div className="phase-ribbon phase-ribbon-empty" aria-hidden="true" />;
    }
    const totals = new Map<TracePhase, number>();
    for (const e of events) {
      totals.set(e.phase, (totals.get(e.phase) ?? 0) + e.durationMs);
    }
    const totalMs = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
    return (
      <div className="phase-ribbon" role="img" aria-label={`${side} ${t('session.phaseRibbon', locale)}`}>
        {TRACE_PHASES.map((phase) => {
          const ms = totals.get(phase) ?? 0;
          if (ms <= 0) {
            return null;
          }
          return (
            <div
              key={phase}
              className="phase-ribbon-seg"
              style={{ width: `${(ms / totalMs) * 100}%`, background: `var(--phase-${phase})` }}
              title={`${t(`phase.${phase}`, locale)} · ${(ms / 1000).toFixed(1)}s`}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="compare-ribbons">
      <div className="compare-ribbon-row">
        <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
        {ribbon(left, 'L')}
      </div>
      <div className="compare-ribbon-row">
        <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
        {ribbon(right, 'R')}
      </div>
    </div>
  );
}

/** ⑤ 详细指标表（L3，差异优先）。 */
function DetailMetricsTable({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));
  const [showAll, setShowAll] = useState(false);
  const leftLoops = groupEvents(leftEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const rightLoops = groupEvents(rightEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const lUnitTests = leftEvents.some((e) => e.phase === 'verify' && TEST_CMD.test(e.title)) ? 1 : 0;
  const rUnitTests = rightEvents.some((e) => e.phase === 'verify' && TEST_CMD.test(e.title)) ? 1 : 0;

  const rows: Array<{ label: string; lv: number; rv: number; lowerBetter: boolean; fmt: (v: number) => string }> = [
    { label: 'e2e', lv: speed.left.e2eMs ?? 0, rv: speed.right.e2eMs ?? 0, lowerBetter: true, fmt: fmtMs },
    { label: 'TTFT', lv: speed.left.ttftMs ?? 0, rv: speed.right.ttftMs ?? 0, lowerBetter: true, fmt: fmtMs },
    { label: 'TPS', lv: speed.left.tps ?? 0, rv: speed.right.tps ?? 0, lowerBetter: false, fmt: (v) => v.toFixed(1) },
    { label: 'TPOT', lv: speed.left.tpotMs ?? 0, rv: speed.right.tpotMs ?? 0, lowerBetter: true, fmt: (v) => `${v.toFixed(1)}ms` },
    { label: 'turnGap', lv: speed.left.turnGapMedianMs ?? 0, rv: speed.right.turnGapMedianMs ?? 0, lowerBetter: true, fmt: fmtMs },
    { label: 'pureInference', lv: speed.left.pureInferenceMs ?? 0, rv: speed.right.pureInferenceMs ?? 0, lowerBetter: true, fmt: fmtMs },
    { label: 'token.input', lv: left.tokenUsage.input, rv: right.tokenUsage.input, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.output', lv: left.tokenUsage.output, rv: right.tokenUsage.output, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.reasoning', lv: left.tokenUsage.reasoning, rv: right.tokenUsage.reasoning, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.cacheRead', lv: left.tokenUsage.cacheRead, rv: right.tokenUsage.cacheRead, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.netInput', lv: left.tokenUsage.netInput, rv: right.tokenUsage.netInput, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.total', lv: left.tokenUsage.total, rv: right.tokenUsage.total, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'cost', lv: left.costUsd, rv: right.costUsd, lowerBetter: true, fmt: (v) => `$${v.toFixed(4)}` },
    { label: 'messages', lv: left.messageCount, rv: right.messageCount, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'events', lv: left.eventCount, rv: right.eventCount, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'tool calls', lv: leftEvents.filter((e) => e.tool !== null).length, rv: rightEvents.filter((e) => e.tool !== null).length, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'llm calls', lv: leftEvents.filter((e) => e.kind === 'llm').length, rv: rightEvents.filter((e) => e.kind === 'llm').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'total tool duration', lv: leftEvents.filter((e) => e.tool !== null).reduce((s, e) => s + e.durationMs, 0), rv: rightEvents.filter((e) => e.tool !== null).reduce((s, e) => s + e.durationMs, 0), lowerBetter: true, fmt: fmtMs },
    { label: 'file writes', lv: leftEvents.filter((e) => e.kind === 'file_write').length, rv: rightEvents.filter((e) => e.kind === 'file_write').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'user rounds', lv: leftEvents.filter((e) => e.kind === 'user_prompt').length, rv: rightEvents.filter((e) => e.kind === 'user_prompt').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'fix loops', lv: leftLoops, rv: rightLoops, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'unit tests', lv: lUnitTests, rv: rUnitTests, lowerBetter: false, fmt: fmtYesNo },
    { label: 'error events', lv: leftEvents.filter((e) => e.status === 'error').length, rv: rightEvents.filter((e) => e.status === 'error').length, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'verify events', lv: leftEvents.filter((e) => e.phase === 'verify').length, rv: rightEvents.filter((e) => e.phase === 'verify').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'error rate', lv: leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.status === 'error').length / leftEvents.length, rv: rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.status === 'error').length / rightEvents.length, lowerBetter: true, fmt: pct },
    { label: 'verify coverage', lv: leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.phase === 'verify').length / leftEvents.length, rv: rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.phase === 'verify').length / rightEvents.length, lowerBetter: false, fmt: pct },
  ];

  const ranked = useMemo(
    () => [...rows].sort((a, b) => diffPct(b.lv, b.rv) - diffPct(a.lv, a.rv)),
    [rows],
  );
  const significant = ranked.filter((row) => diffPct(row.lv, row.rv) >= SIGNIFICANT_DIFF);
  const shown = showAll ? ranked : significant;

  return (
    <div className="compare-table-wrap">
      <table className="ui-table ui-table-compact compare-table cmp-detail-table">
        <thead>
          <tr>
            <th>{t('compare.diffSort', locale)}</th>
            <th style={{ textAlign: 'right' }}>L</th>
            <th style={{ textAlign: 'right' }}>R</th>
            <th style={{ textAlign: 'right' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const leftBetter = row.lv === row.rv ? null : row.lowerBetter ? row.lv < row.rv : row.lv > row.rv;
            const diff = diffPct(row.lv, row.rv);
            return (
              <tr key={row.label}>
                <td className="mono">{row.label}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{row.fmt(row.lv)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{row.fmt(row.rv)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {leftBetter === null ? '=' : `${diff.toFixed(0)}%`}
                  {leftBetter !== null && (
                    <span className={`compare-delta-badge ${leftBetter ? 'compare-delta-win' : 'compare-delta-lose'}`}>
                      {leftBetter ? 'L' : 'R'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ranked.length - significant.length > 0 && (
        <button type="button" className="compare-fold" onClick={() => setShowAll((prev) => !prev)}>
          {showAll
            ? t('compare.collapse', locale)
            : t('compare.diffInsignificant', locale).replace('{n}', String(ranked.length - significant.length))}
          {showAll ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      )}
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  index,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  index?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={`compare-section ${open ? 'compare-section-open' : ''}`} id={id} data-anchor={id}>
      <button type="button" className="compare-section-header" onClick={onToggle} aria-expanded={open}>
        <span className="compare-section-chevron">
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </span>
        <span className="compare-section-title">
          {index !== undefined ? `${index}. ` : ''}{title}
        </span>
      </button>
      {open && <div className="compare-section-body">{children}</div>}
    </section>
  );
}

export interface CompareBoardProps {
  sessions: SessionIndexEntry[];
  /** 会话列表仍在加载时显示骨架，避免首帧误显示「暂无数据」。 */
  sessionsLoading?: boolean;
  locale: Locale;
  leftKey: string;
  rightKey: string;
  onLeftChange: (key: string) => void;
  onRightChange: (key: string) => void;
  loadCompare?: (left: string, right: string) => Promise<CompareResult>;
}

/** REQ-019 + UI-TASKS 2：对比视图 —— 外壳组合各子组件（v2 拆分）。 */
export function CompareBoard({
  sessions,
  sessionsLoading = false,
  locale,
  leftKey,
  rightKey,
  onLeftChange,
  onRightChange,
  loadCompare,
}: CompareBoardProps): React.JSX.Element {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'compare-speed': true,
    'compare-dims': true,
    'compare-time-phase': true,
    'compare-metrics': false,
    'compare-tools': false,
    'compare-timelines': false,
    'compare-charts': true,
  });
  const [contextVisible, setContextVisible] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState('compare-verdict');
  const scrollRef = useRef<HTMLElement | null>(null);
  const leftComposition = useMemo(
    () => computeTimeComposition((result?.left.events ?? []) as TraceEventSlim[]),
    [result],
  );
  const rightComposition = useMemo(
    () => computeTimeComposition((result?.right.events ?? []) as TraceEventSlim[]),
    [result],
  );

  const onCompare = (left: string, right: string): void => {
    const loader = loadCompare ?? ((l: string, r: string) => api.compare(l, r));
    setLoading(true);
    setError(null);
    void loader(left, right)
      .then(setResult)
      .catch((err: unknown) => {
        console.error('[compare] 对比失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  // 首帧 hash / 快捷对比：选中两个会话后自动加载，无需再点「加载对比」。
  useEffect(() => {
    if (
      leftKey === '' ||
      rightKey === '' ||
      loading ||
      (result !== null && result.left.session.id === leftKey && result.right.session.id === rightKey)
    ) {
      return;
    }
    onCompare(leftKey, rightKey);
  }, [leftKey, rightKey, loading, result]);

  const toggleSection = (id: string): void => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const collapseAll = (): void => {
    setOpenSections({
      'compare-speed': false,
      'compare-dims': false,
      'compare-time-phase': false,
      'compare-metrics': false,
      'compare-tools': false,
      'compare-timelines': false,
      'compare-charts': false,
    });
  };

  const expandAll = (): void => {
    setOpenSections({
      'compare-speed': true,
      'compare-dims': true,
      'compare-time-phase': true,
      'compare-metrics': true,
      'compare-tools': true,
      'compare-timelines': true,
      'compare-charts': true,
    });
  };

  const onScroll = (event: UIEvent<HTMLElement>): void => {
    const el = event.currentTarget;
    setContextVisible(el.scrollTop > 240);
    const anchorIds = ['compare-verdict', 'compare-kpi', 'compare-speed', 'compare-dims', 'compare-time-phase', 'compare-metrics', 'compare-tools', 'compare-timelines', 'compare-charts'];
    let current = anchorIds[0]!;
    for (const id of anchorIds) {
      const node = el.querySelector<HTMLElement>(`#${id}`);
      if (node !== null && node.offsetTop - 120 <= el.scrollTop) {
        current = id;
      }
    }
    setActiveAnchor(current);
  };

  const hasSelection = sessions.length > 0;
  const leftName = result?.left.session.title || result?.left.session.id || '';
  const rightName = result?.right.session.title || result?.right.session.id || '';
  const anchors = [
    { id: 'compare-verdict', label: t('compare.verdict', locale) },
    { id: 'compare-kpi', label: t('compare.kpiGrid', locale) },
    { id: 'compare-speed', label: t('compare.speedMetrics', locale) },
    { id: 'compare-dims', label: t('compare.dims', locale) },
    { id: 'compare-time-phase', label: t('compare.timePhase', locale) },
    { id: 'compare-metrics', label: t('compare.detailMetrics', locale) },
    { id: 'compare-tools', label: t('compare.toolAnalysis', locale) },
    { id: 'compare-timelines', label: t('compare.timelines', locale) },
    { id: 'compare-charts', label: t('compare.charts', locale) },
  ];

  return (
    <section
      className="compare compare-scroll"
      ref={(node) => {
        scrollRef.current = node;
      }}
      onScroll={onScroll}
    >
      <CompareSelectorBar
        sessions={sessions}
        locale={locale}
        onCompare={onCompare}
        leftKey={leftKey}
        rightKey={rightKey}
        onLeftChange={onLeftChange}
        onRightChange={onRightChange}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onLeftOpenChange={setLeftOpen}
        onRightOpenChange={setRightOpen}
      />
      {error !== null && (
        <ErrorState
          code="COMPARE_FAILED"
          message={error}
          onRetry={() => {
            if (leftKey !== '' && rightKey !== '') {
              onCompare(leftKey, rightKey);
            } else {
              setError(null);
            }
          }}
        />
      )}
      {(loading || sessionsLoading) && result === null && error === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={5} />
        </div>
      )}
      {!loading && !sessionsLoading && error === null && result === null && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('state.selectTwo', locale)}
          description={hasSelection ? undefined : t('state.empty', locale)}
          action={
            <button type="button" className="btn" onClick={() => setLeftOpen(true)}>
              {t('compare.pickLeft', locale)}
            </button>
          }
        />
      )}
      {result !== null && (
        <>
          <ContextBar
            visible={contextVisible}
            anchors={anchors}
            activeId={activeAnchor}
            locale={locale}
            onCollapseAll={collapseAll}
            onExpandAll={expandAll}
          />
          <div className="compare-summary" aria-label={`${leftName} vs ${rightName}`}>
            <ErrorBoundary label={t('compare.verdict', locale)}>
              <CompareVerdict result={result} locale={locale} />
            </ErrorBoundary>
            <ErrorBoundary label={t('compare.kpiGrid', locale)}>
              <CompareKPI result={result} locale={locale} />
            </ErrorBoundary>
          </div>
          <CollapsibleSection
            id="compare-speed"
            title={t('compare.speedMetrics', locale)}
            index={3}
            open={openSections['compare-speed']!}
            onToggle={() => toggleSection('compare-speed')}
          >
            <ErrorBoundary label={t('compare.speedMetrics', locale)}>
              <CompareSpeedMetrics speed={result.speed} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-dims"
            title={t('compare.dims', locale)}
            index={4}
            open={openSections['compare-dims']!}
            onToggle={() => toggleSection('compare-dims')}
          >
            <ErrorBoundary label={t('compare.dims', locale)}>
              <CompareDimensions result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-time-phase"
            title={t('compare.timePhase', locale)}
            index={5}
            open={openSections['compare-time-phase']!}
            onToggle={() => toggleSection('compare-time-phase')}
          >
            <ErrorBoundary label={t('compare.timePhase', locale)}>
              <div className="compare-timepair">
                <div className="compare-timepair-side">
                  <h4>
                    <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
                    {' '}{leftName}
                  </h4>
                  <TimeCompositionBar
                    composition={leftComposition}
                    locale={locale}
                    active={null}
                    onToggle={() => undefined}
                    interactive={false}
                  />
                </div>
                <div className="compare-timepair-side">
                  <h4>
                    <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
                    {' '}{rightName}
                  </h4>
                  <TimeCompositionBar
                    composition={rightComposition}
                    locale={locale}
                    active={null}
                    onToggle={() => undefined}
                    interactive={false}
                  />
                </div>
              </div>
              <PhaseRibbonPair
                left={result.left.events as TraceEventSlim[]}
                right={result.right.events as TraceEventSlim[]}
                locale={locale}
              />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-metrics"
            title={t('compare.detailMetrics', locale)}
            index={6}
            open={openSections['compare-metrics']!}
            onToggle={() => toggleSection('compare-metrics')}
          >
            <ErrorBoundary label={t('compare.detailMetrics', locale)}>
              <DetailMetricsTable result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-tools"
            title={t('compare.toolAnalysis', locale)}
            index={7}
            open={openSections['compare-tools']!}
            onToggle={() => toggleSection('compare-tools')}
          >
            <ErrorBoundary label={t('compare.toolAnalysis', locale)}>
              <CompareToolAnalysis result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-timelines"
            title={t('compare.timelines', locale)}
            index={8}
            open={openSections['compare-timelines']!}
            onToggle={() => toggleSection('compare-timelines')}
          >
            <ErrorBoundary label={t('compare.timelines', locale)}>
              <CompareTimeline result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-charts"
            title={t('compare.charts', locale)}
            index={9}
            open={openSections['compare-charts']!}
            onToggle={() => toggleSection('compare-charts')}
          >
            <ErrorBoundary label={t('compare.charts', locale)}>
              <CompareCharts result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
        </>
      )}
    </section>
  );
}
