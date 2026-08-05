import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  SessionDetailResponse,
  SessionIndexEntry,
  SpeedMetrics,
  TraceEventSlim,
  TraceKind,
  TracePhase,
} from '../core/trace-types.js';
import { TRACE_KINDS, TRACE_PHASES } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Popover } from './ui/Overlay.js';
import { SearchInput } from './ui/Input.js';
import { TraceTimeline } from './TraceTimeline.js';
import { TimeCompositionBar } from './TimeCompositionBar.js';
import { computeTimeComposition } from '../core/time-composition.js';
import { ContextBar } from './ContextBar.js';
import { fmtDur } from '../core/session-findings.js';
import { groupEvents } from '../core/event-groups.js';
import {
  IconAccuracy,
  IconChevronDown,
  IconChevronRight,
  IconCost,
  IconSpeed,
  type IconProps,
} from './icons/index.js';
import type { I18nKey } from '../i18n.js';

export interface CompareResult {
  left: SessionDetailResponse;
  right: SessionDetailResponse;
  speed: { left: SpeedMetrics; right: SpeedMetrics };
}

function SessionPicker({
  side,
  sessions,
  value,
  locale,
  onSelect,
}: {
  side: 'L' | 'R';
  sessions: SessionIndexEntry[];
  value: string;
  locale: Locale;
  onSelect: (key: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
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
        setOpen(next);
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
          {filtered.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`compare-picker-item ${session.id === value ? 'compare-picker-item-on' : ''}`}
              onClick={() => {
                onSelect(session.id);
                setOpen(false);
              }}
            >
              <span className="compare-picker-title">{session.title || session.id}</span>
              <span className="mono">{session.eventCount} ev</span>
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

export function CompareSelectorBar({
  sessions,
  locale,
  onCompare,
  leftKey,
  rightKey,
  onLeftChange,
  onRightChange,
}: {
  sessions: SessionIndexEntry[];
  locale: Locale;
  onCompare: (left: string, right: string) => void;
  leftKey: string;
  rightKey: string;
  onLeftChange: (key: string) => void;
  onRightChange: (key: string) => void;
}): React.JSX.Element {
  return (
    <div className="compare-bar">
      <SessionPicker side="L" sessions={sessions} value={leftKey} locale={locale} onSelect={onLeftChange} />
      <SessionPicker side="R" sessions={sessions} value={rightKey} locale={locale} onSelect={onRightChange} />
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

/* ===== 差异计算（P2 差异优先） ===== */

function diffPct(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  const base = Math.max(
    1,
    absA === 0 || absB === 0 ? Math.max(absA, absB) : Math.min(absA, absB),
  );
  return (Math.abs(a - b) / base) * 100;
}

const SIGNIFICANT_DIFF = 10; // 差异 < 10% 视为不显著

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : fmtDur(ms);
}

/* ===== ① 裁决摘要（L1） ===== */

interface VerdictDim {
  key: 'fast' | 'frugal' | 'quality';
  winner: 'L' | 'R' | 'tie';
  detail: string;
}

/** §6.3（calibrate-tokens-and-compare-report）：代码精炼度 = totalSteps / fileWriteCount。
 * 与 metrics-analysis delta spec 同口径；分母为 0 时 null，UI 渲染 —。 */
const STEP_KINDS = new Set([
  'llm', 'tool', 'file_read', 'file_write', 'bash', 'test', 'agent',
]);
const TEST_CMD = /(npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint)/;
const FAILED_COMMAND_KINDS = new Set([
  'bash', 'test', 'tool', 'file_write', 'file_read', 'agent',
]);

interface CompareSideStats {
  llmCalls: number;
  totalLlmDuration: number;
  avgLlmDuration: number | null;
  totalToolDuration: number;
  cacheHitRate: number | null;
  cacheRead: number;
  netInput: number;
  fileWrites: number;
  fileReads: number;
  totalSteps: number;
  hasUnitTests: boolean;
  userRounds: number;
  codeConciseness: number | null;
  fixLoops: number;
  failedCommands: number;
}

function compareSideStats(
  events: TraceEventSlim[],
  speed: SpeedMetrics,
  session: SessionDetailResponse['session'],
): CompareSideStats {
  const llmEvents = events.filter((e) => e.kind === 'llm');
  const toolEvents = events.filter((e) => e.tool !== null);
  const fileWrites = events.filter((e) => e.kind === 'file_write').length;
  const fileReads = events.filter((e) => e.kind === 'file_read').length;
  const totalSteps = events.filter((e) => STEP_KINDS.has(e.kind)).length;
  const verifyEvents = events.filter((e) => e.phase === 'verify');
  const cacheRead = events.reduce((sum, e) => sum + (e.tokens?.cacheRead ?? 0), 0);
  const fixLoops = groupEvents(events).filter(
    (r) => r.kind === 'group' && r.group.type === 'repair_loop',
  ).length;
  return {
    llmCalls: llmEvents.length,
    totalLlmDuration: llmEvents.reduce((sum, e) => sum + e.durationMs, 0),
    avgLlmDuration: speed.avgLlmDurationMs,
    totalToolDuration: toolEvents.reduce((sum, e) => sum + e.durationMs, 0),
    cacheHitRate: speed.cacheHitRate,
    cacheRead,
    netInput: session.tokenUsage.netInput,
    fileWrites,
    fileReads,
    totalSteps,
    hasUnitTests: verifyEvents.some((e) => TEST_CMD.test(e.title)),
    userRounds: events.filter((e) => e.kind === 'user_prompt').length,
    codeConciseness: fileWrites === 0 ? null : totalSteps / fileWrites,
    fixLoops,
    failedCommands: events.filter(
      (e) => e.status === 'error' && FAILED_COMMAND_KINDS.has(e.kind),
    ).length,
  };
}

function computeVerdict(result: CompareResult, locale: Locale): { dims: VerdictDim[]; wins: number; losses: number; winner: 'L' | 'R' | 'tie' } {
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

function VerdictCard({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
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

/* ===== ② 关键指标网格（L1） ===== */

function KpiGrid({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const ls = compareSideStats(leftEvents, result.speed.left, left);
  const rs = compareSideStats(rightEvents, result.speed.right, right);
  const fmtPct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const fmtNum = (v: number | null): string => (v === null ? '—' : v.toLocaleString());
  const fmtConcise = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));

  const items: Array<{
    key: string;
    label: string;
    lv: string;
    rv: string;
    lnum: number;
    rnum: number;
    lowerBetter: boolean;
  }> = [
    { key: 'e2e', label: t('metric.speed', locale), lv: fmtMs(result.speed.left.e2eMs ?? null), rv: fmtMs(result.speed.right.e2eMs ?? null), lnum: result.speed.left.e2eMs ?? 0, rnum: result.speed.right.e2eMs ?? 0, lowerBetter: true },
    { key: 'tokens', label: t('session.tokens', locale), lv: left.tokenUsage.total.toLocaleString(), rv: right.tokenUsage.total.toLocaleString(), lnum: left.tokenUsage.total, rnum: right.tokenUsage.total, lowerBetter: true },
    { key: 'cost', label: t('session.cost', locale), lv: `$${left.costUsd.toFixed(4)}`, rv: `$${right.costUsd.toFixed(4)}`, lnum: left.costUsd, rnum: right.costUsd, lowerBetter: true },
    // §6.2 新增 KPI（design §6 / tasks 5.5）：速度与质量维度的新指标
    { key: 'llmCalls', label: t('compare.kpi.llmCalls', locale), lv: String(ls.llmCalls), rv: String(rs.llmCalls), lnum: ls.llmCalls, rnum: rs.llmCalls, lowerBetter: false },
    { key: 'avgLlmDuration', label: t('compare.kpi.avgLlmDuration', locale), lv: fmtMs(ls.avgLlmDuration), rv: fmtMs(rs.avgLlmDuration), lnum: ls.avgLlmDuration ?? 0, rnum: rs.avgLlmDuration ?? 0, lowerBetter: true },
    { key: 'totalToolDuration', label: t('compare.kpi.totalToolDuration', locale), lv: fmtMs(ls.totalToolDuration), rv: fmtMs(rs.totalToolDuration), lnum: ls.totalToolDuration, rnum: rs.totalToolDuration, lowerBetter: true },
    { key: 'cacheHitRate', label: t('compare.kpi.cacheHitRate', locale), lv: fmtPct(ls.cacheHitRate), rv: fmtPct(rs.cacheHitRate), lnum: ls.cacheHitRate ?? 0, rnum: rs.cacheHitRate ?? 0, lowerBetter: false },
    { key: 'cacheRead', label: t('compare.kpi.cacheRead', locale), lv: fmtNum(ls.cacheRead), rv: fmtNum(rs.cacheRead), lnum: ls.cacheRead, rnum: rs.cacheRead, lowerBetter: true },
    { key: 'netInput', label: t('compare.kpi.netInput', locale), lv: fmtNum(ls.netInput), rv: fmtNum(rs.netInput), lnum: ls.netInput, rnum: rs.netInput, lowerBetter: true },
    { key: 'fileWrites', label: t('compare.kpi.fileWrites', locale), lv: String(ls.fileWrites), rv: String(rs.fileWrites), lnum: ls.fileWrites, rnum: rs.fileWrites, lowerBetter: false },
    { key: 'codeConciseness', label: t('compare.kpi.codeConciseness', locale), lv: fmtConcise(ls.codeConciseness), rv: fmtConcise(rs.codeConciseness), lnum: ls.codeConciseness ?? 0, rnum: rs.codeConciseness ?? 0, lowerBetter: true },
    { key: 'hasUnitTests', label: t('compare.kpi.hasUnitTests', locale), lv: fmtYesNo(ls.hasUnitTests ? 1 : 0), rv: fmtYesNo(rs.hasUnitTests ? 1 : 0), lnum: ls.hasUnitTests ? 1 : 0, rnum: rs.hasUnitTests ? 1 : 0, lowerBetter: false },
    { key: 'userRounds', label: t('compare.kpi.userRounds', locale), lv: String(ls.userRounds), rv: String(rs.userRounds), lnum: ls.userRounds, rnum: rs.userRounds, lowerBetter: false },
    { key: 'fixLoops', label: t('compare.kpi.fixLoops', locale), lv: String(ls.fixLoops), rv: String(rs.fixLoops), lnum: ls.fixLoops, rnum: rs.fixLoops, lowerBetter: true },
  ];

  return (
    <section className="compare-kpis" id="compare-kpi">
      {items.map((item) => {
        const leftBetter = item.lnum === item.rnum ? null : item.lowerBetter ? item.lnum < item.rnum : item.lnum > item.rnum;
        const diff = diffPct(item.lnum, item.rnum);
        return (
          <div key={item.key} className="compare-kpi">
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
          </div>
        );
      })}
    </section>
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

/* ===== ③ 三维度对比（L2，差异优先） ===== */

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

function DimsCompare({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const ls = compareSideStats(leftEvents, speed.left, left);
  const rs = compareSideStats(rightEvents, speed.right, right);
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
      // 边读边写比 = file_read / file_write；无写入时 null（禁止 0 冒充）
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
      // §6.3：代码精炼度 = totalSteps / fileWriteCount（分母为 0 → null）
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

/* ===== ⑤ 详细指标表（L3，差异优先） ===== */

function DetailMetricsTable({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const ls = compareSideStats(leftEvents, speed.left, left);
  const rs = compareSideStats(rightEvents, speed.right, right);
  const fmtYesNo = (v: number): string => (v === 1 ? t('compare.yes', locale) : t('compare.no', locale));
  const [showAll, setShowAll] = useState(false);

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
    { label: 'llm calls', lv: ls.llmCalls, rv: rs.llmCalls, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'total tool duration', lv: ls.totalToolDuration, rv: rs.totalToolDuration, lowerBetter: true, fmt: fmtMs },
    { label: 'file writes', lv: ls.fileWrites, rv: rs.fileWrites, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'user rounds', lv: ls.userRounds, rv: rs.userRounds, lowerBetter: false, fmt: (v) => String(v) },
    { label: 'fix loops', lv: ls.fixLoops, rv: rs.fixLoops, lowerBetter: true, fmt: (v) => String(v) },
    { label: 'unit tests', lv: ls.hasUnitTests ? 1 : 0, rv: rs.hasUnitTests ? 1 : 0, lowerBetter: false, fmt: fmtYesNo },
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

/* ===== ⑥ 工具调用分析（L3） ===== */

function ToolAnalysis({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const counts = useMemo(() => {
    const map = new Map<string, { lc: number; rc: number; lf: number; rf: number }>();
    for (const e of leftEvents) {
      if (e.tool !== null) {
        const v = map.get(e.tool) ?? { lc: 0, rc: 0, lf: 0, rf: 0 };
        v.lc += 1;
        if (e.status === 'error') {
          v.lf += 1;
        }
        map.set(e.tool, v);
      }
    }
    for (const e of rightEvents) {
      if (e.tool !== null) {
        const v = map.get(e.tool) ?? { lc: 0, rc: 0, lf: 0, rf: 0 };
        v.rc += 1;
        if (e.status === 'error') {
          v.rf += 1;
        }
        map.set(e.tool, v);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].lc + b[1].rc - (a[1].lc + a[1].rc)).slice(0, 15);
  }, [leftEvents, rightEvents]);
  const max = Math.max(1, ...counts.map(([, v]) => Math.max(v.lc, v.rc)));

  return (
    <table className="ui-table ui-table-compact">
      <thead>
        <tr>
          <th>{t('session.provider', locale)}</th>
          <th style={{ textAlign: 'right' }}>{t('compare.toolCall', locale)} L</th>
          <th style={{ textAlign: 'right' }}>{t('compare.toolCall', locale)} R</th>
          <th style={{ textAlign: 'right' }}>{t('compare.toolFailRate', locale)} L</th>
          <th style={{ textAlign: 'right' }}>{t('compare.toolFailRate', locale)} R</th>
        </tr>
      </thead>
      <tbody>
        {counts.map(([tool, v]) => (
          <tr key={tool}>
            <td className="mono">{tool}</td>
            <td className="mono" style={{ textAlign: 'right' }}>
              {v.lc}
              <div className="ui-bar-meter" style={{ marginTop: 'var(--space-1)' }}>
                <div className="ui-bar-meter-fill" style={{ width: `${(v.lc / max) * 100}%`, background: 'var(--accent-emphasis)' }} />
              </div>
            </td>
            <td className="mono" style={{ textAlign: 'right' }}>
              {v.rc}
              <div className="ui-bar-meter" style={{ marginTop: 'var(--space-1)' }}>
                <div className="ui-bar-meter-fill" style={{ width: `${(v.rc / max) * 100}%`, background: 'var(--attention-emphasis)' }} />
              </div>
            </td>
            <td className="mono" style={{ textAlign: 'right' }}>{v.lc === 0 ? '—' : `${((v.lf / v.lc) * 100).toFixed(0)}%`}</td>
            <td className="mono" style={{ textAlign: 'right' }}>{v.rc === 0 ? '—' : `${((v.rf / v.rc) * 100).toFixed(0)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ===== ⑧ 图表（L3，精简为雷达 + 事件分布） ===== */

function ChartsSection({ result, locale }: { result: CompareResult; locale: Locale }): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const left = result.left.session;
  const right = result.right.session;
  const speed = result.speed;
  const lErr = leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.status === 'error').length / leftEvents.length;
  const rErr = rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.status === 'error').length / rightEvents.length;
  const lVerify = leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.phase === 'verify').length / leftEvents.length;
  const rVerify = rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.phase === 'verify').length / rightEvents.length;

  const axes = useMemo(() => {
    const defs: Array<{ label: string; lv: number; rv: number; lowerBetter: boolean }> = [
      { label: t('metric.speed', locale), lv: speed.left.e2eMs ?? 0, rv: speed.right.e2eMs ?? 0, lowerBetter: true },
      { label: t('session.tokens', locale), lv: left.tokenUsage.total, rv: right.tokenUsage.total, lowerBetter: true },
      { label: t('session.cost', locale), lv: left.costUsd, rv: right.costUsd, lowerBetter: true },
      { label: t('agent.errorRate', locale), lv: lErr, rv: rErr, lowerBetter: true },
      { label: t('agent.verification', locale), lv: lVerify, rv: rVerify, lowerBetter: false },
    ];
    const lValues = defs.map((d) => d.lv);
    const rValues = defs.map((d) => d.rv);
    return defs.map((d, i) => {
      const max = Math.max(lValues[i]!, rValues[i]!, 0.001);
      const norm = (v: number): number =>
        d.lowerBetter ? (max - v) / max : max === 0 ? 0 : v / max;
      return { ...d, l: norm(d.lv), r: norm(d.rv) };
    });
  }, [left, right, speed, lErr, rErr, lVerify, rVerify, locale]);

  const points = (side: 'l' | 'r'): string => {
    const n = axes.length;
    const cx = 60;
    const cy = 60;
    const radius = 44;
    return axes
      .map((axis, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const value = axis[side];
        return `${(cx + Math.cos(angle) * radius * value).toFixed(1)},${(cy + Math.sin(angle) * radius * value).toFixed(1)}`;
      })
      .join(' ');
  };

  const kindCount = (events: TraceEventSlim[]): Map<TraceKind, number> => {
    const map = new Map<TraceKind, number>();
    for (const e of events) {
      map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    }
    return map;
  };
  const lKinds = kindCount(leftEvents);
  const rKinds = kindCount(rightEvents);
  const kindMax = Math.max(1, ...TRACE_KINDS.map((k) => Math.max(lKinds.get(k) ?? 0, rKinds.get(k) ?? 0)));

  return (
    <div className="compare-charts">
      <div className="compare-chart">
        <h4>{t('compare.radar', locale)}</h4>
        <svg viewBox="0 0 120 120" width={200} height={200} role="img" aria-label={t('compare.radar', locale)}>
          {axes.map((axis, i) => {
            const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            return (
              <line
                key={axis.label}
                x1={60}
                y1={60}
                x2={60 + Math.cos(angle) * 44}
                y2={60 + Math.sin(angle) * 44}
                stroke="var(--border-muted)"
                strokeWidth={1}
              />
            );
          })}
          <polygon points={axes.map((_, i) => {
            const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            return `${60 + Math.cos(angle) * 44},${60 + Math.sin(angle) * 44}`;
          }).join(' ')} fill="none" stroke="var(--border-default)" strokeWidth={1} />
          <polygon points={points('l')} fill="var(--accent-subtle)" stroke="var(--accent-fg)" strokeWidth={1.5} />
          <polygon points={points('r')} fill="var(--attention-subtle)" stroke="var(--attention-fg)" strokeWidth={1.5} />
          {axes.map((axis, i) => {
            const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            return (
              <text
                key={axis.label}
                x={60 + Math.cos(angle) * 52}
                y={60 + Math.sin(angle) * 52}
                fontSize={6}
                fill="var(--fg-muted)"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {axis.label}
              </text>
            );
          })}
        </svg>
      </div>
      <div className="compare-chart">
        <h4>{t('compare.distribution', locale)}</h4>
        <div className="compare-dist">
          {TRACE_KINDS.map((kind) => {
            const lc = lKinds.get(kind) ?? 0;
            const rc = rKinds.get(kind) ?? 0;
            if (lc === 0 && rc === 0) {
              return null;
            }
            return (
              <div key={kind} className="compare-dist-row">
                <span className="mono compare-dist-label">{kind}</span>
                <div className="compare-dist-bars">
                  <div className="ui-bar-meter">
                    <div className="ui-bar-meter-fill" style={{ width: `${(lc / kindMax) * 100}%`, background: 'var(--accent-emphasis)' }} />
                  </div>
                  <div className="ui-bar-meter">
                    <div className="ui-bar-meter-fill" style={{ width: `${(rc / kindMax) * 100}%`, background: 'var(--attention-emphasis)' }} />
                  </div>
                </div>
                <span className="mono compare-dist-count">{lc} / {rc}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===== ContextBar + 可折叠区块 ===== */

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
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
        <span className="compare-section-title">{title}</span>
      </button>
      {open && <div className="compare-section-body">{children}</div>}
    </section>
  );
}

export interface CompareBoardProps {
  sessions: SessionIndexEntry[];
  locale: Locale;
  leftKey: string;
  rightKey: string;
  onLeftChange: (key: string) => void;
  onRightChange: (key: string) => void;
  loadCompare?: (left: string, right: string) => Promise<CompareResult>;
}

/** REQ-019 + ui-design-v2 §5：对比视图三层收敛。 */
export function CompareBoard({
  sessions,
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'compare-dims': true,
    'compare-time-phase': true,
    'compare-metrics': false,
    'compare-tools': false,
    'compare-timelines': false,
    'compare-charts': false,
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
    const anchorIds = ['compare-verdict', 'compare-kpi', 'compare-dims', 'compare-time-phase', 'compare-metrics', 'compare-tools', 'compare-timelines', 'compare-charts'];
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
      {loading && result === null && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Skeleton variant="row" count={5} />
        </div>
      )}
      {!loading && error === null && result === null && (
        <EmptyState
          icon={<span aria-hidden="true" />}
          title={t('state.selectTwo', locale)}
          description={hasSelection ? undefined : t('state.empty', locale)}
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
            <VerdictCard result={result} locale={locale} />
            <KpiGrid result={result} locale={locale} />
          </div>
          <CollapsibleSection
            id="compare-dims"
            title={t('compare.dims', locale)}
            open={openSections['compare-dims']!}
            onToggle={() => toggleSection('compare-dims')}
          >
            <DimsCompare result={result} locale={locale} />
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-time-phase"
            title={t('compare.timePhase', locale)}
            open={openSections['compare-time-phase']!}
            onToggle={() => toggleSection('compare-time-phase')}
          >
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
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-metrics"
            title={t('compare.detailMetrics', locale)}
            open={openSections['compare-metrics']!}
            onToggle={() => toggleSection('compare-metrics')}
          >
            <DetailMetricsTable result={result} locale={locale} />
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-tools"
            title={t('compare.toolAnalysis', locale)}
            open={openSections['compare-tools']!}
            onToggle={() => toggleSection('compare-tools')}
          >
            <ToolAnalysis result={result} locale={locale} />
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-timelines"
            title={t('compare.timelines', locale)}
            open={openSections['compare-timelines']!}
            onToggle={() => toggleSection('compare-timelines')}
          >
            <div className="compare-timelines">
              <div className="compare-timeline">
                <h4>
                  <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
                  {' '}{leftName}
                </h4>
                <TraceTimeline
                  events={(result.left.events as TraceEventSlim[]).slice(0, 200)}
                  total={result.left.eventTotal}
                  hasMore={false}
                  onLoadMore={() => undefined}
                  onSelectEvent={() => undefined}
                  selectedEventId={null}
                  locale={locale}
                />
              </div>
              <div className="compare-timeline">
                <h4>
                  <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
                  {' '}{rightName}
                </h4>
                <TraceTimeline
                  events={(result.right.events as TraceEventSlim[]).slice(0, 200)}
                  total={result.right.eventTotal}
                  hasMore={false}
                  onLoadMore={() => undefined}
                  onSelectEvent={() => undefined}
                  selectedEventId={null}
                  locale={locale}
                />
              </div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            id="compare-charts"
            title={t('compare.charts', locale)}
            open={openSections['compare-charts']!}
            onToggle={() => toggleSection('compare-charts')}
          >
            <ChartsSection result={result} locale={locale} />
          </CollapsibleSection>
        </>
      )}
    </section>
  );
}
