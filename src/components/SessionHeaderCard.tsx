import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEvent, TraceEventSlim, TraceSession } from '../core/trace-types.js';
import { computeSpeedMetrics } from '../core/speed-metrics.js';
import { DropdownMenu } from './ui/Overlay.js';
import { MetricCard } from './ui/Misc.js';
import { StatusBadge } from './ui/Badge.js';
import { IconAccuracy, IconCost, IconKebab, IconSpeed, IconStability } from './icons/index.js';

export interface SessionHeaderCardProps {
  session: TraceSession;
  events: TraceEventSlim[];
  locale: Locale;
  onRescan?: () => void;
  onDelete?: () => void;
  onCopyId?: () => void;
  onExport?: () => void;
}

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

/** REQ-017 ①：会话头 + 四维指标条（null 显示 — 加 tooltip，不得用 0 冒充）。 */
export function SessionHeaderCard({
  session,
  events,
  locale,
  onRescan,
  onDelete,
  onCopyId,
  onExport,
}: SessionHeaderCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const metrics = useMemo(() => {
    const total = events.length || 1;
    const errorEvents = events.filter((e) => e.status === 'error').length;
    const testEvents = events.filter((e) => e.kind === 'test').length;
    const debugEvents = events.filter((e) => e.phase === 'debug').length;
    const speed = computeSpeedMetrics({
      session,
      events: events as TraceEvent[],
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
      // v7 未持久化 provenance；B 阶段由 API 提供真实值
      turnKeySource: 'unavailable',
    });
    const tokensPerStep = total > 0 ? session.tokenUsage.total / total : 0;
    return {
      speed,
      verification: total > 0 ? testEvents / total : null,
      errorRate: total > 0 ? errorEvents / total : null,
      debugRate: total > 0 ? debugEvents / total : null,
      tokensPerStep,
      hasData: total > 1,
    };
  }, [session, events]);

  const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);
  const na = metrics.hasData ? '' : ` — ${t('session.insufficientData', locale)}`;

  return (
    <div className="session-header">
      <div className="session-header-row">
        <h2 className="session-header-title">{session.title || session.id}</h2>
        <StatusBadge status={session.status} locale={locale} />
        <span className="spacer" />
        <DropdownMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={(props) => (
            <button type="button" className="ui-icon-btn" aria-label="session menu" {...props}>
              <IconKebab size={16} />
            </button>
          )}
          items={[
            { id: 'rescan', label: t('session.rescan', locale), onSelect: onRescan },
            { id: 'copy', label: t('session.copyId', locale), onSelect: onCopyId },
            { id: 'export', label: t('session.exportReport', locale), onSelect: onExport },
            { id: 'delete', label: t('session.delete', locale), onSelect: onDelete },
          ]}
        />
      </div>
      <dl className="meta session-meta">
        <dt>{t('session.provider', locale)}</dt>
        <dd className="mono">{session.provider}</dd>
        <dt>{t('session.cwd', locale)}</dt>
        <dd className="mono session-cwd">{session.cwd ?? '—'}</dd>
        <dt>{t('session.startedAt', locale)}</dt>
        <dd className="mono">{new Date(session.startedAt).toLocaleString()}</dd>
        <dt>{t('session.duration', locale)}</dt>
        <dd className="mono">{fmtMs(session.totalDurationMs)}</dd>
      </dl>
      <div className="session-metrics">
        <MetricCard
          icon={<IconSpeed size={16} />}
          label={t('metric.speed', locale)}
          value={fmtMs(metrics.speed.ttftMs)}
          unit={`ttft · tps ${metrics.speed.tps === null ? '—' : metrics.speed.tps.toFixed(1)}`}
          trend={`e2e ${fmtMs(metrics.speed.e2eMs)}${na}`}
        />
        <MetricCard
          icon={<IconAccuracy size={16} />}
          label={t('metric.accuracy', locale)}
          value={pct(metrics.verification)}
          unit="test events"
          trend={metrics.verification === null ? t('metric.na', locale) : undefined}
        />
        <MetricCard
          icon={<IconStability size={16} />}
          label={t('metric.stability', locale)}
          value={pct(metrics.errorRate)}
          unit="error rate"
          trend={`debug ${pct(metrics.debugRate)}`}
        />
        <MetricCard
          icon={<IconCost size={16} />}
          label={t('metric.cost', locale)}
          value={`${session.tokenUsage.total.toLocaleString()}`}
          unit={`tok · $${session.costUsd.toFixed(4)}`}
          trend={`${metrics.tokensPerStep.toFixed(0)} tok/step`}
        />
      </div>
    </div>
  );
}
