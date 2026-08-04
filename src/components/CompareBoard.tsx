import { useCallback, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  SessionDetailResponse,
  SessionIndexEntry,
  SpeedMetrics,
  TraceEventSlim,
} from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';

export interface CompareResult {
  left: SessionDetailResponse;
  right: SessionDetailResponse;
  speed: { left: SpeedMetrics; right: SpeedMetrics };
}

export function CompareSelectorBar({
  sessions,
  locale,
  onCompare,
}: {
  sessions: SessionIndexEntry[];
  locale: Locale;
  onCompare: (left: string, right: string) => void;
}) {
  const [leftKey, setLeftKey] = useState('');
  const [rightKey, setRightKey] = useState('');
  return (
    <div className="compare-bar">
      <select value={leftKey} onChange={(e) => setLeftKey(e.target.value)}>
        <option value="">{t('compare.left', locale)}</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title || s.id}
          </option>
        ))}
      </select>
      <select value={rightKey} onChange={(e) => setRightKey(e.target.value)}>
        <option value="">{t('compare.right', locale)}</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title || s.id}
          </option>
        ))}
      </select>
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

export function CompareSpeedMetrics({
  speed,
  locale,
}: {
  speed: { left: SpeedMetrics; right: SpeedMetrics };
  locale: Locale;
}) {
  return (
    <section>
      <h3>{t('compare.speed', locale)}</h3>
      <table>
        <thead>
          <tr>
            <th />
            <th>{t('compare.left', locale)}</th>
            <th>{t('compare.right', locale)}</th>
          </tr>
        </thead>
        <tbody>
          {(['ttftMs', 'tps', 'tpotMs', 'e2eMs', 'turnGapMedianMs', 'pureInferenceMs'] as const).map((key) => (
            <tr key={key}>
              <td>{key}</td>
              <td>{speed.left[key] === null ? '-' : Number(speed.left[key]).toFixed(2)}</td>
              <td>{speed.right[key] === null ? '-' : Number(speed.right[key]).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Timeline({ events }: { events: TraceEventSlim[] }) {
  return (
    <ol className="timeline">
      {events.slice(0, 100).map((event) => (
        <li key={`${event.id}-${event.sequence}`}>
          #{event.sequence} {event.phase} {event.title}
        </li>
      ))}
    </ol>
  );
}

export function CompareTimeline({
  left,
  right,
  locale,
}: {
  left: TraceEventSlim[];
  right: TraceEventSlim[];
  locale: Locale;
}) {
  return (
    <section className="compare-columns">
      <h3>{t('compare.timeline', locale)}</h3>
      <div className="columns">
        <Timeline events={left} />
        <Timeline events={right} />
      </div>
    </section>
  );
}

export function AgentComparisonBand({
  left,
  right,
  locale,
}: {
  left: SessionDetailResponse;
  right: SessionDetailResponse;
  locale: Locale;
}) {
  const band = (label: string, leftValue: number, rightValue: number) => {
    const max = Math.max(leftValue, rightValue, 1);
    return (
      <div className="band-row">
        <span className="band-label">{label}</span>
        <div className="band-track">
          <div className="band-left" style={{ width: `${(leftValue / max) * 50}%` }} />
          <div className="band-right" style={{ width: `${(rightValue / max) * 50}%` }} />
        </div>
      </div>
    );
  };
  return (
    <section>
      <h3>{t('compare.band', locale)}</h3>
      {band('events', left.events.length, right.events.length)}
      {band('tokens', left.session.tokenUsage.total, right.session.tokenUsage.total)}
      {band('cost', left.session.costUsd, right.session.costUsd)}
    </section>
  );
}

export interface CompareBoardProps {
  sessions: SessionIndexEntry[];
  locale: Locale;
  loadCompare?: (left: string, right: string) => Promise<CompareResult>;
}

/** REQ-008：左右并排对比。 */
export function CompareBoard({ sessions, locale, loadCompare }: CompareBoardProps) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCompare = useCallback(
    (left: string, right: string) => {
      const loader = loadCompare ?? ((l: string, r: string) => api.compare(l, r));
      setLoading(true);
      setError(null);
      void loader(left, right)
        .then(setResult)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    },
    [loadCompare],
  );

  return (
    <section className="compare">
      <CompareSelectorBar sessions={sessions} locale={locale} onCompare={onCompare} />
      {error !== null && (
        <ErrorState code="COMPARE_FAILED" message={error} onRetry={() => undefined} />
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
          description={t('state.empty', locale)}
        />
      )}
      {result !== null && (
        <>
          <CompareSpeedMetrics speed={result.speed} locale={locale} />
          <CompareTimeline
            left={result.left.events as TraceEventSlim[]}
            right={result.right.events as TraceEventSlim[]}
            locale={locale}
          />
          <AgentComparisonBand left={result.left} right={result.right} locale={locale} />
        </>
      )}
    </section>
  );
}
