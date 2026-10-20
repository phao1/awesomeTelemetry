import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  SessionIndexEntry,
  TraceEventSlim,
  TracePhase,
} from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import { api, ApiError } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Popover } from './ui/Overlay.js';
import { SearchInput } from './ui/Input.js';
import { TimeCompositionBar } from './TimeCompositionBar.js';
import { computeTimeComposition } from '../core/time-composition.js';
import { scanTimingReason, scanTimingValue } from '../core/scan-timing.js';
import type { ScanTimingMetric } from '../core/scan-timing.js';
import { ScanTimingCriteria } from './ScanTimingCriteria.js';
import { ContextBar } from './ContextBar.js';
import { groupEvents } from '../core/event-groups.js';
import { compareActivity, diffPct, fmtMs, SIGNIFICANT_DIFF, TEST_CMD } from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { CompareVerdict } from './CompareVerdict.js';
import { CompareHeroHeader } from './CompareHeroHeader.js';
import { CompareKPI } from './CompareKPI.js';
import { CompareSpeedMetrics } from './CompareSpeedMetrics.js';
import { CompareDimensions } from './CompareDimensions.js';
import { CompareToolAnalysis } from './CompareToolAnalysis.js';
import { CompareCharts } from './CompareCharts.js';
import { CompareTimeline } from './CompareTimeline.js';
import { CompareRunEvidence } from './CompareRunEvidence.js';
import { IconChevronDown, IconChevronRight } from './icons/index.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';

const ExperimentRecordsPanel = lazy(() => import('./ExperimentRecordsPanel.js').then(module => ({ default: module.ExperimentRecordsPanel })));

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
  const inputRef=useRef<HTMLInputElement>(null);
  const deferredSearch=useDeferredValue(search);
  useEffect(()=>{if(open)inputRef.current?.focus();else setSearch('');},[open]);
  const selected = sessions.find((s) => s.id === value);
  const selectedName=selected?.title||value||t(`compare.${side === 'L' ? 'left' : 'right'}`,locale);
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return sessions.filter(
      (s) =>
        q === '' || `${s.title} ${s.id} ${s.provider} ${s.sourceAgent}`.toLowerCase().includes(q),
    );
  }, [sessions, deferredSearch]);
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
        <button type="button" className="btn compare-picker" aria-label={`${side} · ${selectedName}`} title={`${selectedName}${selected?' · '+selected.provider+' / '+selected.sourceAgent:''}`} {...props}>
          <span
            className="compare-side-mark"
            style={{
              background: `var(--${sideColor}-subtle)`,
              color: `var(--${sideColor}-fg)`,
            }}
          >
            {side}
          </span>
          <span className="compare-picker-selected">
            {selectedName}
          </span>
        </button>
      )}
      style={{ maxHeight: '60vh', overflowY: 'auto', width: 'var(--rail-width)' }}
    >
      <div style={{ padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <SearchInput inputRef={inputRef} aria-label={`${side} ${t('compare.pickerSearch',locale)}`} placeholder={t('compare.pickerSearch', locale)} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="compare-picker-list">
          {filtered.length===0&&<p className="hint" role="status">{t(sessions.length===0?'compare.pickerEmpty':'compare.pickerNoMatch',locale)}</p>}
          {filtered.slice(0, PICKER_LIMIT).map((session) => (
            <button
              key={session.id}
              type="button"
              className={`compare-picker-item ${session.id === value ? 'compare-picker-item-on' : ''}`}
              aria-pressed={session.id===value}
              title={`${session.provider} / ${session.sourceAgent} · ${session.id}`}
              onClick={() => {
                onSelect(session.id);
                onOpenChange(false);
              }}
            >
              <span className="compare-picker-title">{session.title || session.id}</span>
              <span className="mono">{session.provider} · {session.eventCount} ev</span>
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
  loading?: boolean;
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
  loading = false,
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
        disabled={loading || leftKey === '' || rightKey === '' || leftKey === rightKey}
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
  const la=compareActivity(result.left);
  const ra=compareActivity(result.right);
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));
  const [showAll, setShowAll] = useState(false);
  const leftLoops = groupEvents(leftEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const rightLoops = groupEvents(rightEvents).filter((r) => r.kind === 'group' && r.group.type === 'repair_loop').length;
  const lUnitTests = leftEvents.some((e) => e.phase === 'verify' && TEST_CMD.test(e.title)) ? 1 : 0;
  const rUnitTests = rightEvents.some((e) => e.phase === 'verify' && TEST_CMD.test(e.title)) ? 1 : 0;

  const rows: Array<{ label: string; lv: number | null; rv: number | null; timing?: ScanTimingMetric; lowerBetter: boolean; fmt: (v: number) => string }> = [
    { label: 'e2e', lv: scanTimingValue(speed.left.e2eMs), rv: scanTimingValue(speed.right.e2eMs), timing: 'e2e', lowerBetter: true, fmt: fmtMs },
    { label: 'TTFT', lv: scanTimingValue(speed.left.ttftMs), rv: scanTimingValue(speed.right.ttftMs), timing: 'ttft', lowerBetter: true, fmt: fmtMs },
    { label: 'TPS', lv: scanTimingValue(speed.left.tps), rv: scanTimingValue(speed.right.tps), timing: 'tps', lowerBetter: false, fmt: (v) => v.toFixed(1) },
    { label: 'TPOT', lv: scanTimingValue(speed.left.tpotMs), rv: scanTimingValue(speed.right.tpotMs), timing: 'tpot', lowerBetter: true, fmt: (v) => `${v.toFixed(1)}ms` },
    { label: 'turnGap', lv: scanTimingValue(speed.left.turnGapMedianMs), rv: scanTimingValue(speed.right.turnGapMedianMs), timing: 'turnGap', lowerBetter: true, fmt: fmtMs },
    { label: 'pureInference', lv: scanTimingValue(speed.left.pureInferenceMs), rv: scanTimingValue(speed.right.pureInferenceMs), timing: 'eventDuration', lowerBetter: true, fmt: fmtMs },
    { label: 'token.input', lv: left.tokenUsage.input, rv: right.tokenUsage.input, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.output', lv: left.tokenUsage.output, rv: right.tokenUsage.output, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.reasoning', lv: left.tokenUsage.reasoning, rv: right.tokenUsage.reasoning, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.cacheRead', lv: left.tokenUsage.cacheRead, rv: right.tokenUsage.cacheRead, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.cacheWrite', lv: left.tokenUsage.cacheWrite, rv: right.tokenUsage.cacheWrite, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.netInput', lv: left.tokenUsage.netInput, rv: right.tokenUsage.netInput, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'token.total', lv: left.tokenUsage.total, rv: right.tokenUsage.total, lowerBetter: true, fmt: (v) => v.toLocaleString() },
    { label: 'messages', lv: left.messageCount, rv: right.messageCount, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'events', lv: result.left.eventTotal, rv: result.right.eventTotal, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'tool calls', lv: leftEvents.filter((e) => e.tool !== null).length, rv: rightEvents.filter((e) => e.tool !== null).length, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'llm calls', lv: leftEvents.filter((e) => e.kind === 'llm').length, rv: rightEvents.filter((e) => e.kind === 'llm').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'total tool duration', lv: scanTimingValue(leftEvents.filter((e) => e.tool !== null).reduce((s, e) => s + e.durationMs, 0)), rv: scanTimingValue(rightEvents.filter((e) => e.tool !== null).reduce((s, e) => s + e.durationMs, 0)), timing: 'eventDuration', lowerBetter: true, fmt: fmtMs },
    { label: 'file writes', lv: leftEvents.filter((e) => e.kind === 'file_write').length, rv: rightEvents.filter((e) => e.kind === 'file_write').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'user rounds', lv: leftEvents.filter((e) => e.kind === 'user_prompt').length, rv: rightEvents.filter((e) => e.kind === 'user_prompt').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'fix loops', lv: leftLoops, rv: rightLoops, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'unit tests', lv: la.complete?lUnitTests:null, rv: ra.complete?rUnitTests:null, lowerBetter: false, fmt: fmtYesNo },
    { label: 'error events', lv: leftEvents.filter((e) => e.status === 'error').length, rv: rightEvents.filter((e) => e.status === 'error').length, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'verify events', lv: leftEvents.filter((e) => e.phase === 'verify').length, rv: rightEvents.filter((e) => e.phase === 'verify').length, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'error rate', lv: la.errorRate, rv: ra.errorRate, lowerBetter: true, fmt: pct },
    { label: 'verify coverage', lv: la.verification, rv: ra.verification, lowerBetter: false, fmt: pct },
  ];
  const activityKeys=new Set(['tool calls','llm calls','total tool duration','file writes','user rounds','fix loops','unit tests','error events','verify events','error rate','verify coverage']);
  const labels:Record<string,string>={
    e2e:t('compare.profile.wallClock',locale),turnGap:t('compare.metric.turnGap',locale),pureInference:t('compare.metric.pureInference',locale),
    'token.input':`${t('session.tokens',locale)} · input`,'token.output':`${t('session.tokens',locale)} · output`,
    'token.reasoning':`${t('session.tokens',locale)} · reasoning`,'token.cacheRead':t('compare.charts.tokenClass.cacheRead',locale),
    'token.cacheWrite':t('compare.charts.tokenClass.cacheWrite',locale),'token.netInput':t('compare.kpi.netInput',locale),'token.total':t('compare.token.total',locale),
    messages:t('compare.activity.messages',locale),events:t('compare.kpi.events',locale),
    'tool calls':t('compare.activity.tools',locale),'llm calls':t('compare.kpi.llmCalls',locale),'total tool duration':t('compare.kpi.totalToolDuration',locale),
    'file writes':t('compare.kpi.fileWrites',locale),'user rounds':t('compare.kpi.userRounds',locale),'fix loops':t('compare.kpi.fixLoops',locale),
    'unit tests':t('compare.activity.testCommand',locale),'error events':t('compare.kpi.failures',locale),'verify events':t('compare.kpi.verifyEvents',locale),
    'error rate':t('compare.activity.errorSteps',locale),'verify coverage':t('compare.activity.verification',locale),
  };
  const interpreted = rows.map(row => ({ ...row, reason:
    activityKeys.has(row.label)&&(!la.complete||!ra.complete)?'partial_evidence' as const:
    row.timing===undefined?(row.lv===null||row.rv===null?'missing_value' as const:null):scanTimingReason(result.left,result.right,row.timing,row.lv,row.rv)
    ??(row.lv!==null&&row.rv!==null&&!Number.isFinite(row.rv-row.lv)?'invalid_value' as const:null) }));
  const difference = (row: typeof interpreted[number]): number => row.reason !== null || row.lv === null || row.rv === null ? 0 : diffPct(row.lv, row.rv);
  const ranked = [...interpreted].sort((a, b) => difference(b) - difference(a));
  // Unknown measurements remain visible but cannot rank as significant advantages.
  const significant = ranked.filter(row => row.reason !== null || difference(row) >= SIGNIFICANT_DIFF);
  const shown = showAll ? ranked : significant;

  return (
    <div className="compare-table-wrap">
      <p className="hint">{t('compare.activity.scope',locale)} · L {leftEvents.length} / {result.left.eventTotal} · R {rightEvents.length} / {result.right.eventTotal}</p>
      <table className="ui-table ui-table-compact compare-table cmp-detail-table">
        <thead>
          <tr>
            <th>{t('compare.diffSort', locale)}</th>
            <th style={{ textAlign: 'right' }}>L</th>
            <th style={{ textAlign: 'right' }}>R</th>
            <th style={{ textAlign: 'right' }}>R − L</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const diff=row.reason!==null||row.lv===null||row.rv===null||row.label==='unit tests'?null:row.rv-row.lv;
            const ratio=row.label==='error rate'||row.label==='verify coverage';
            const delta=diff===null||!Number.isFinite(diff)?null:`${diff>0?'+':diff<0?'−':''}${ratio?`${(Math.abs(diff)*100).toFixed(1)} ${t('compare.activity.percentagePoints',locale)}`:row.fmt(Math.abs(diff))}`;
            return (
              <tr key={row.label} data-compare-metric={row.label}>
                <td>{labels[row.label]??row.label}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{row.lv === null ? '—' : row.fmt(row.lv)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{row.rv === null ? '—' : row.fmt(row.rv)}</td>
                <td className="mono" style={{ textAlign: 'right' }} data-scan-timing-reason={row.reason ?? undefined}>
                  {row.reason !== null ? `${t('scan.timing.notComparable', locale)}: ${t(`scan.timing.reason.${row.reason}`, locale)}` : delta??'—'}
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
  loadCompare?: (left: string, right: string, signal?: AbortSignal) => Promise<CompareResult>;
  onOpenRun?: (key:string,eventId?:string)=>void;
  onOpenCalls?:()=>void;
  onBrowseRuns?:()=>void;
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
  onOpenRun,
  onOpenCalls,
  onBrowseRuns,
}: CompareBoardProps): React.JSX.Element {
  const [snapshot, setResult] = useState<CompareResult | null>(null);
  const pair = JSON.stringify([leftKey,rightKey]);
  const validPair = leftKey !== '' && rightKey !== '' && leftKey !== rightKey;
  const [resultPair,setResultPair] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode,setErrorCode] = useState('COMPARE_FAILED');
  const loaderRef = useRef(loadCompare ?? api.compare);
  useEffect(()=>{loaderRef.current=loadCompare ?? api.compare;},[loadCompare]);
  const requestRef = useRef<{key:string;controller:AbortController;timer:ReturnType<typeof setTimeout>|null}|null>(null);
  const cancelPending = useCallback(()=>{
    const request=requestRef.current;
    if(request===null)return;
    requestRef.current=null;
    if(request.timer!==null)clearTimeout(request.timer);
    request.controller.abort();
  },[]);
  // Ownership is the requested pair, not callback identity or a guessed native ID.
  const currentLoading = validPair && (loading || resultPair !== pair);
  const currentError = resultPair === pair ? error : null;
  const result = resultPair === pair && !currentLoading && currentError === null ? snapshot : null;
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
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
    () => computeTimeComposition((result?.left?.events ?? []) as TraceEventSlim[]),
    [result],
  );
  const rightComposition = useMemo(
    () => computeTimeComposition((result?.right?.events ?? []) as TraceEventSlim[]),
    [result],
  );

  const onCompare = useCallback((left:string,right:string):void=>{
    if(left==='' || right==='' || left===right)return;
    const key=JSON.stringify([left,right]);
    if(requestRef.current?.key===key)return;
    cancelPending();
    const request={key,controller:new AbortController(),timer:null as ReturnType<typeof setTimeout>|null};
    requestRef.current=request;
    setResultPair(key);setResult(null);setError(null);setErrorCode('COMPARE_FAILED');setLoading(true);
    const fail=(err:unknown):void=>{
      if(requestRef.current!==request)return;
      console.error('[compare] 对比失败:',err);
      setErrorCode(err instanceof ApiError?err.code:'COMPARE_FAILED');
      setError(err instanceof Error?err.message:String(err));
    };
    request.timer=setTimeout(()=>{
      if(requestRef.current!==request)return;
      cancelPending();setErrorCode('COMPARE_TIMEOUT');setError('COMPARE_TIMEOUT');setLoading(false);
    },5000);
    try {
      void loaderRef.current(left,right,request.controller.signal).then(value=>{
        if(requestRef.current===request)setResult(value);
      }).catch(fail).finally(()=>{
        if(requestRef.current!==request)return;
        if(request.timer!==null)clearTimeout(request.timer);
        requestRef.current=null;setLoading(false);
      });
    } catch(err) {
      fail(err);cancelPending();setLoading(false);
    }
  },[cancelPending]);

  // 首帧 hash / 快捷对比：选中两个会话后自动加载，无需再点「加载对比」。
  useEffect(() => {
    if(validPair)onCompare(leftKey,rightKey);
    return cancelPending;
  }, [leftKey, rightKey, validPair, onCompare, cancelPending]);

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
    const anchorIds = ['compare-hero', 'compare-verdict', 'compare-kpi', 'compare-speed', 'compare-charts', 'compare-dims', 'compare-time-phase', 'compare-tools', 'compare-timelines', 'compare-metrics'];
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
    { id: 'compare-hero', label: t('compare.hero.title', locale) },
    { id: 'compare-verdict', label: t('compare.verdict', locale) },
    { id: 'compare-kpi', label: t('compare.kpiGrid', locale) },
    { id: 'compare-speed', label: t('compare.speedMetrics', locale) },
    { id: 'compare-charts', label: t('compare.charts', locale) },
    { id: 'compare-dims', label: t('compare.dims', locale) },
    { id: 'compare-time-phase', label: t('compare.timePhase', locale) },
    { id: 'compare-tools', label: t('compare.toolAnalysis', locale) },
    { id: 'compare-timelines', label: t('compare.timelines', locale) },
    { id: 'compare-metrics', label: t('compare.detailMetrics', locale) },
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
        loading={currentLoading}
      />
      <button className="btn" type="button" onClick={() => setExperimentsOpen(true)}>{locale === 'zh' ? '手工实验记录' : 'Manual experiment records'}</button>
      {experimentsOpen && <ErrorBoundary label={locale === 'zh' ? '手工实验记录' : 'Manual experiment records'} fallback={() => <div role="alert">
        <p>{locale === 'zh' ? '面板加载失败，请关闭后重试。' : 'Panel loading failed. Close and retry.'}</p>
        <button className="btn" type="button" onClick={() => setExperimentsOpen(false)}>{locale === 'zh' ? '关闭' : 'Close'}</button>
      </div>}><Suspense fallback={<p role="status">{locale === 'zh' ? '正在加载手工实验面板…' : 'Loading manual experiment panel…'}</p>}>
        <ExperimentRecordsPanel sessions={sessions} locale={locale} onClose={() => setExperimentsOpen(false)} onCompare={(left, right) => {
          if (left === leftKey && right === rightKey) onCompare(left, right);
          else { onLeftChange(left); onRightChange(right); }
        }} />
      </Suspense></ErrorBoundary>}
      <div className="cmp-selector-scope"><span>{t('compare.pickerScope',locale).replace('{n}',String(sessions.length))}</span>
        {onBrowseRuns&&<button type="button" className="btn ui-btn-sm" onClick={onBrowseRuns}>{t('compare.browseRuns',locale)}</button>}</div>
      {currentLoading && <p role="status" className="hint compare-read-status">{t('compare.read.loading',locale)}{' '}
        <button type="button" className="btn ui-btn-sm" onClick={()=>{cancelPending();setLoading(false);setErrorCode('COMPARE_CANCELLED');setError('COMPARE_CANCELLED');}}>{t('compare.read.cancel',locale)}</button></p>}
      {currentError !== null && (
        <ErrorState
          code={errorCode}
          message={errorCode==='COMPARE_TIMEOUT'?t('compare.read.timeout',locale):errorCode==='COMPARE_CANCELLED'?t('compare.read.cancelled',locale):currentError}
          onRetry={() => {
            if (leftKey !== '' && rightKey !== '') {
              onCompare(leftKey, rightKey);
            } else {
              setError(null);
            }
          }}
        />
      )}
      {(currentLoading || sessionsLoading) && result === null && currentError === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={5} />
        </div>
      )}
      {!currentLoading && !sessionsLoading && currentError === null && result === null && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t(leftKey!=='' && leftKey===rightKey?'compare.read.distinct':'state.selectTwo', locale)}
          description={hasSelection ? t('compare.selectHint', locale) : t('state.empty', locale)}
          /* 行动按钮跟随选择进度推进：此前选好左侧之后它仍然写着「选择左侧会话」，
             点下去只会把已经选好的那一侧再打开一次。 */
          action={
            leftKey === '' ? (
              <button type="button" className="btn" onClick={() => setLeftOpen(true)}>
                {t('compare.pickLeft', locale)}
              </button>
            ) : rightKey === '' ? (
              <button type="button" className="btn" onClick={() => setRightOpen(true)}>
                {t('compare.pickRight', locale)}
              </button>
            ) : undefined
          }
        />
      )}
      {result !== null && (
        <>
          <ErrorBoundary label={t('compare.hero.title', locale)}>
            <CompareRunEvidence result={result} locale={locale} onOpenRun={onOpenRun} onOpenCalls={onOpenCalls}/>
            <ScanTimingCriteria left={result.left.session} right={result.right.session}
              partial={result.left.pending || result.right.pending || result.left.hasMore || result.right.hasMore || result.left.eventOffset !== 0 || result.right.eventOffset !== 0} locale={locale} compact />
            <CompareHeroHeader result={result} locale={locale} />
          </ErrorBoundary>
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
              <CompareKPI result={result} locale={locale} sessions={sessions} onOpenRun={onOpenRun}/>
            </ErrorBoundary>
          </div>
          <CollapsibleSection
            id="compare-speed"
            title={t('compare.speedMetrics', locale)}
            index={4}
            open={openSections['compare-speed']!}
            onToggle={() => toggleSection('compare-speed')}
          >
            <ErrorBoundary label={t('compare.speedMetrics', locale)}>
              <CompareSpeedMetrics
                speed={result.speed}
                locale={locale}
                sessions={{ left: result.left.session, right: result.right.session }}
                sides={{ left: result.left, right: result.right }}
                events={{ left: result.left.events as TraceEventSlim[], right: result.right.events as TraceEventSlim[] }}
              />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-charts"
            title={t('compare.charts', locale)}
            index={5}
            open={openSections['compare-charts']!}
            onToggle={() => toggleSection('compare-charts')}
          >
            <ErrorBoundary label={t('compare.charts', locale)}>
              <CompareCharts result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-dims"
            title={t('compare.dims', locale)}
            index={6}
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
            index={7}
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
            id="compare-tools"
            title={t('compare.toolAnalysis', locale)}
            index={8}
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
            index={9}
            open={openSections['compare-timelines']!}
            onToggle={() => toggleSection('compare-timelines')}
          >
            <ErrorBoundary label={t('compare.timelines', locale)}>
              <CompareTimeline result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-metrics"
            title={t('compare.detailMetrics', locale)}
            index={10}
            open={openSections['compare-metrics']!}
            onToggle={() => toggleSection('compare-metrics')}
          >
            <ErrorBoundary label={t('compare.detailMetrics', locale)}>
              <DetailMetricsTable result={result} locale={locale} />
            </ErrorBoundary>
          </CollapsibleSection>
        </>
      )}
    </section>
  );
}
