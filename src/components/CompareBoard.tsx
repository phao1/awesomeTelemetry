import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  SessionDetailResponse,
  SessionIndexEntry,
  SpeedMetrics,
  TraceEventSlim,
  TracePhase,
} from '../core/trace-types.js';
import { TRACE_PHASES } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Popover } from './ui/Overlay.js';
import { SearchInput } from './ui/Input.js';
import { TraceTimeline } from './TraceTimeline.js';

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

/** REQ-019 ②：结论条 —— 一句话给出「谁快多少 / 谁省多少」。 */
export function CompareConclusion({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const leftName = result.left.session.title || result.left.session.id;
  const rightName = result.right.session.title || result.right.session.id;
  const parts: string[] = [];
  const lt = result.speed.left.ttftMs;
  const rt = result.speed.right.ttftMs;
  if (lt !== null && rt !== null && lt !== rt) {
    const faster = lt < rt ? result.left : result.right;
    const ratio = Math.max(lt, rt) / Math.min(lt, rt);
    parts.push(`${faster.session.title || faster.session.id} ${t('compare.faster', locale)} ${ratio.toFixed(1)}×`);
  }
  const ltok = result.left.session.tokenUsage.total;
  const rtok = result.right.session.tokenUsage.total;
  if (ltok !== rtok) {
    const diff = (Math.abs(ltok - rtok) / Math.max(1, Math.min(ltok, rtok))) * 100;
    const more = ltok > rtok ? result.left : result.right;
    parts.push(`${more.session.title || more.session.id} ${t('compare.moreTokens', locale)} ${diff.toFixed(0)}%`);
  }
  const sentence = parts.length > 0 ? parts.join('，') : t('compare.parity', locale);
  return (
    <div className="compare-conclusion" role="status">
      <span className="compare-conclusion-left">{leftName}</span>
      <span>{sentence}</span>
      <span className="compare-conclusion-right">{rightName}</span>
    </div>
  );
}

/** REQ-019 ③：四维双条对比，按「谁更优」着色；L/R 必带字母标记。 */
export function CompareDims({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const left = result.left;
  const right = result.right;
  const dims = [
    {
      label: t('metric.speed', locale),
      lv: result.speed.left.e2eMs ?? 0,
      rv: result.speed.right.e2eMs ?? 0,
      lowerBetter: true,
    },
    {
      label: t('metric.cost', locale),
      lv: left.session.costUsd,
      rv: right.session.costUsd,
      lowerBetter: true,
    },
    {
      label: t('metric.accuracy', locale),
      lv: left.events.filter((e) => e.kind === 'test').length,
      rv: right.events.filter((e) => e.kind === 'test').length,
      lowerBetter: false,
    },
    {
      label: t('metric.stability', locale),
      lv: left.events.filter((e) => e.status === 'error').length,
      rv: right.events.filter((e) => e.status === 'error').length,
      lowerBetter: true,
    },
  ];
  return (
    <section className="compare-dims">
      <h3>{t('compare.dimensions', locale)}</h3>
      {dims.map((dim) => {
        const max = Math.max(dim.lv, dim.rv, 0.001);
        const leftBetter = dim.lowerBetter ? dim.lv <= dim.rv : dim.lv >= dim.rv;
        return (
          <div key={dim.label} className="compare-dim">
            <span className="band-label">{dim.label}</span>
            <div className="compare-dim-bars">
              <div className="compare-dim-bar-row">
                <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
                <div className="ui-bar-meter" style={{ flex: 1 }}>
                  <div
                    className="ui-bar-meter-fill"
                    style={{
                      width: `${(dim.lv / max) * 100}%`,
                      background: leftBetter ? 'var(--success-emphasis)' : 'var(--danger-emphasis)',
                    }}
                  />
                </div>
                <span className="mono">{dim.lv.toFixed(2)}</span>
              </div>
              <div className="compare-dim-bar-row">
                <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
                <div className="ui-bar-meter" style={{ flex: 1 }}>
                  <div
                    className="ui-bar-meter-fill"
                    style={{
                      width: `${(dim.rv / max) * 100}%`,
                      background: !leftBetter ? 'var(--success-emphasis)' : 'var(--danger-emphasis)',
                    }}
                  />
                </div>
                <span className="mono">{dim.rv.toFixed(2)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** REQ-019 ④：PhaseRibbon 上下对照，共享同一时间比例尺。 */
export function PhaseRibbonPair({
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
    <section className="compare-ribbons">
      <div className="compare-ribbon-row">
        <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
        {ribbon(left, 'L')}
      </div>
      <div className="compare-ribbon-row">
        <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
        {ribbon(right, 'R')}
      </div>
    </section>
  );
}

export function CompareSpeedMetrics({
  speed,
  locale,
}: {
  speed: { left: SpeedMetrics; right: SpeedMetrics };
  locale: Locale;
}): React.JSX.Element {
  return (
    <section>
      <h3>{t('compare.speed', locale)}</h3>
      <table className="ui-table ui-table-compact">
        <thead>
          <tr>
            <th />
            <th style={{ textAlign: 'right' }}>L</th>
            <th style={{ textAlign: 'right' }}>R</th>
          </tr>
        </thead>
        <tbody>
          {(['ttftMs', 'tps', 'tpotMs', 'e2eMs', 'turnGapMedianMs', 'pureInferenceMs'] as const).map((key) => (
            <tr key={key}>
              <td className="mono">{key}</td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {speed.left[key] === null ? '—' : Number(speed.left[key]).toFixed(2)}
              </td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {speed.right[key] === null ? '—' : Number(speed.right[key]).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

/** REQ-019：对比视图。未选择时给 EmptyState 引导，不是两个空下拉。 */
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

  const hasSelection = sessions.length > 0;
  return (
    <section className="compare">
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
        <div className="compare-result">
          <CompareConclusion result={result} locale={locale} />
          <CompareDims result={result} locale={locale} />
          <PhaseRibbonPair
            left={result.left.events as TraceEventSlim[]}
            right={result.right.events as TraceEventSlim[]}
            locale={locale}
          />
          <CompareSpeedMetrics speed={result.speed} locale={locale} />
          <div className="compare-columns">
            <h3>
              <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
              {' '}{result.left.session.title || result.left.session.id}
            </h3>
            <TraceTimeline
              events={(result.left.events as TraceEventSlim[]).slice(0, 100)}
              total={result.left.eventTotal}
              hasMore={false}
              onLoadMore={() => undefined}
              onSelectEvent={() => undefined}
              selectedEventId={null}
              locale={locale}
            />
          </div>
          <div className="compare-columns">
            <h3>
              <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
              {' '}{result.right.session.title || result.right.session.id}
            </h3>
            <TraceTimeline
              events={(result.right.events as TraceEventSlim[]).slice(0, 100)}
              total={result.right.eventTotal}
              hasMore={false}
              onLoadMore={() => undefined}
              onSelectEvent={() => undefined}
              selectedEventId={null}
              locale={locale}
            />
          </div>
        </div>
      )}
    </section>
  );
}
