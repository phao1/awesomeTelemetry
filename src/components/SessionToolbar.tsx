import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEvent, TraceEventSlim, TraceSession } from '../core/trace-types.js';
import { computeSpeedMetrics } from '../core/speed-metrics.js';
import { DropdownMenu } from './ui/Overlay.js';
import { ProviderBadge, StatusBadge } from './ui/Badge.js';
import { IconAccuracy, IconCost, IconKebab, IconSpeed, IconStability } from './icons/index.js';

export interface SessionToolbarProps {
  session: TraceSession;
  events: TraceEventSlim[];
  locale: Locale;
  onRescan?: () => void;
  onDelete?: () => void;
  onCopyId?: () => void;
  onExport?: () => void;
  onPromptContext?: () => void;
}

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

/**
 * 页面 IA 重构（fix-session-detail-display delta）：粘性会话工具条——
 * provider + 标题 + 状态 + 可复制 ID + 四维紧凑指标 + 操作菜单。
 * null 指标显示 —（加 title 说明），不得用 0 冒充。
 */
export function SessionToolbar({
  session,
  events,
  locale,
  onRescan,
  onDelete,
  onCopyId,
  onExport,
  onPromptContext,
}: SessionToolbarProps): React.JSX.Element {
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

  return (
    <header className="session-toolbar">
      <div className="session-toolbar-main">
        <ProviderBadge provider={session.provider} locale={locale} />
        <h2 className="session-toolbar-title" title={session.title || session.id}>
          {session.title || session.id}
        </h2>
        <StatusBadge status={session.status} locale={locale} />
        <button
          type="button"
          className="session-toolbar-id mono"
          onClick={onCopyId}
          title={`${session.id} — ${t('session.copyId', locale)}`}
        >
          {session.id}
        </button>
      </div>
      <div className="session-toolbar-metrics">
        <div className="session-toolbar-metric" title={metrics.hasData ? t('metric.speed', locale) : t('session.insufficientData', locale)}>
          <span className="session-toolbar-metric-label">
            <IconSpeed size={12} /> {t('metric.speed', locale)}
          </span>
          <span className="mono">{fmtMs(metrics.speed.ttftMs)}</span>
        </div>
        <div className="session-toolbar-metric">
          <span className="session-toolbar-metric-label">
            <IconAccuracy size={12} /> {t('metric.accuracy', locale)}
          </span>
          <span className="mono">{pct(metrics.verification)}</span>
        </div>
        <div className="session-toolbar-metric">
          <span className="session-toolbar-metric-label">
            <IconStability size={12} /> {t('metric.stability', locale)}
          </span>
          <span className="mono">{pct(metrics.errorRate)}</span>
        </div>
        <div className="session-toolbar-metric">
          <span className="session-toolbar-metric-label">
            <IconCost size={12} /> {t('metric.cost', locale)}
          </span>
          <span className="mono">
            {session.tokenUsage.total.toLocaleString()} tok · ${session.costUsd.toFixed(4)}
          </span>
        </div>
      </div>
      <button type="button" className="btn session-toolbar-prompt" onClick={onPromptContext}>
        {t('prompt.open', locale)}
      </button>
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
    </header>
  );
}
