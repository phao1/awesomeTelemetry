import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceSession } from '../core/trace-types.js';

export interface SessionHeaderCardProps {
  session: TraceSession;
  locale: Locale;
  onOpenSystemPrompt?: () => void;
}

/** REQ-008：会话元数据 + system prompt 入口。 */
export function SessionHeaderCard({
  session,
  locale,
  onOpenSystemPrompt,
}: SessionHeaderCardProps) {
  return (
    <div className="session-header">
      <h2>{session.title || session.id}</h2>
      <dl className="meta">
        <dt>{t('session.provider', locale)}</dt>
        <dd>{session.provider}</dd>
        <dt>{t('session.status', locale)}</dt>
        <dd>{session.status}</dd>
        <dt>{t('session.events', locale)}</dt>
        <dd>{session.eventCount}</dd>
        <dt>{t('session.tokens', locale)}</dt>
        <dd>{session.tokenUsage.total}</dd>
        <dt>{t('session.cost', locale)}</dt>
        <dd>${session.costUsd.toFixed(4)}</dd>
      </dl>
      {session.systemPrompt !== null && (
        <button type="button" className="btn" onClick={onOpenSystemPrompt}>
          {t('session.systemPrompt', locale)}
        </button>
      )}
    </div>
  );
}
