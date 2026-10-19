import type { SessionIndexEntry } from '../core/trace-types.js';
import { t, type Locale } from '../i18n.js';
import { IconAgents, IconChevronRight, IconProxy, IconSearch, IconSessions } from './icons/index.js';
import { ProviderBadge } from './ui/Badge.js';

export interface SessionStartProps {
  locale: Locale;
  recent: Pick<SessionIndexEntry, 'id' | 'title' | 'provider'> | null;
  loading: boolean;
  filtered?: boolean;
  offlineSamples?: boolean;
  onClearFilters: () => void;
  onSelect: (id: string) => void;
  onSearch: () => void;
  onCapture: () => void;
  onTeams: () => void;
  onSettings: () => void;
}

/** WB-002: actionable investigation entry; uses metadata already owned by App. */
export function SessionStart({ locale, recent, loading, filtered = false, offlineSamples = false, onClearFilters, onSelect, onSearch, onCapture, onTeams, onSettings }: SessionStartProps): React.JSX.Element {
  return <section className="session-start" aria-labelledby="session-start-title">
    <div className="session-start-inner">
      <header className="session-start-head">
        <span className="session-start-eyebrow"><IconSessions size={16} />{t('session.start.eyebrow', locale)}</span>
        <h1 id="session-start-title">{t('session.start.title', locale)}</h1>
        <p>{t('session.selectHint', locale)}</p>
        <button type="button" className="btn session-start-search" onClick={onSearch}>
          <IconSearch size={16} />{t('session.start.search', locale)}<kbd>⌘ K / Ctrl K</kbd>
        </button>
      </header>
      <div className="session-start-options">
        <button type="button" className="session-start-action session-start-primary" disabled={loading && recent === null}
          onClick={() => recent !== null ? onSelect(recent.id) : filtered ? onClearFilters() : onSettings()}>
          <span className="session-start-action-title"><IconSessions size={20} />{t(offlineSamples ? 'session.start.sample' : 'session.start.local', locale)}<IconChevronRight size={16} /></span>
          <span className="session-start-action-hint">{t(offlineSamples ? 'state.offlineSamples' : 'session.start.localHint', locale)}</span>
          <span className="session-start-recent" title={recent?.title}>
            {recent !== null && <ProviderBadge provider={recent.provider} locale={locale} />}
            <span>{loading && recent === null ? t('common.loading', locale) : recent?.title || t(filtered ? 'session.clearFilters' : 'session.start.configure', locale)}</span>
          </span>
        </button>
        <a href="#/proxy" className="session-start-action" onClick={(event) => { event.preventDefault(); onCapture(); }}>
          <span className="session-start-action-title"><IconProxy size={20} />{t('session.start.capture', locale)}<IconChevronRight size={16} /></span>
          <span className="session-start-action-hint">{t('session.start.captureHint', locale)}</span>
          <span className="session-start-action-next">{t('session.start.captureNext', locale)}</span>
        </a>
        <a href="#/team" className="session-start-action" onClick={(event) => { event.preventDefault(); onTeams(); }}>
          <span className="session-start-action-title"><IconAgents size={20} />{t('session.start.teams', locale)}<IconChevronRight size={16} /></span>
          <span className="session-start-action-hint">{t('session.start.teamsHint', locale)}</span>
          <span className="session-start-action-next">{t('session.start.teamsNext', locale)}</span>
        </a>
      </div>
      <ol className="session-start-steps" aria-label={t('session.start.workflow', locale)}>
        {(['locate', 'follow', 'inspect'] as const).map((step, index) => <li key={step}>
          <span className="session-start-step-number" aria-hidden="true">{index + 1}</span>
          <div><strong>{t(`session.start.${step}`, locale)}</strong><p>{t(`session.start.${step}Hint`, locale)}</p></div>
        </li>)}
      </ol>
      <p className="session-start-boundary">{t('session.start.boundary', locale)}</p>
    </div>
  </section>;
}
