import { useDeferredValue, useMemo, useState } from 'react';
import type { TurnModel, TurnMessage } from '../../core/trace-types.js';
import { t, type Locale } from '../../i18n.js';
import { SearchInput } from '../ui/Input.js';
import { IconError, IconSpeed } from '../icons/index.js';

export interface InvestigationToolbarProps {
  model: TurnModel;
  locale: Locale;
  selectedEventId: string | null;
  onInspect: (eventId: string) => void;
  focused?: boolean;
  onToggleFocus?: () => void;
  agentsOpen: boolean;
  onToggleAgents: () => void;
}

const RESULT_LIMIT = 20;
const hasError = (message: TurnMessage): boolean => message.status === 'error' || message.error !== null;
const fmtDuration = (ms: number): string => !Number.isFinite(ms) ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

/** Only already-loaded metadata is searched; neither search nor ranking fetches bodies. */
export function InvestigationToolbar({ model, locale, selectedEventId, onInspect, focused, onToggleFocus, agentsOpen, onToggleAgents }: InvestigationToolbarProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const entries = useMemo(() => model.turns.flatMap(turn => turn.messages.map(message => ({ turn: turn.index, message }))), [model]);
  const errors = useMemo(() => entries.filter(entry => hasError(entry.message)), [entries]);
  const longest = useMemo(() => entries.reduce<typeof entries[number] | null>((best, entry) =>
    Number.isFinite(entry.message.durationMs) && entry.message.durationMs > 0 && (best === null || entry.message.durationMs > best.message.durationMs) ? entry : best, null), [entries]);
  const matches = useMemo(() => entries.filter(({message}) => (!errorsOnly || hasError(message)) &&
    (!deferredQuery || `${message.title} ${message.tool ?? ''} ${message.eventId} ${message.sequence}`.toLocaleLowerCase().includes(deferredQuery))), [entries, errorsOnly, deferredQuery]);
  const showResults = (query.trim() !== '' || errorsOnly) && resultsOpen;
  const inspect = (id: string): void => { setResultsOpen(false); onInspect(id); };
  const errorIndex = errors.findIndex(entry => entry.message.eventId === selectedEventId);
  return <section className="investigation-toolbar" aria-label={t('investigation.title', locale)}>
    <div className="investigation-controls">
      <SearchInput placeholder={t('investigation.search', locale)} aria-label={t('investigation.search', locale)}
        value={query} onFocus={() => setResultsOpen(true)} onChange={event => { setQuery(event.target.value); setResultsOpen(true); }} />
      <button type="button" className="btn ui-btn-sm" aria-pressed={errorsOnly} aria-expanded={showResults} onClick={() => { setErrorsOnly(value => !value); setResultsOpen(true); }}>
        <IconError size={12} />{t('investigation.errors', locale)} {errors.length}
      </button>
      <button type="button" className="btn ui-btn-sm" disabled={errors.length === 0}
        onClick={() => { const next = errors[(errorIndex + 1) % errors.length]; if (next) inspect(next.message.eventId); }}>
        {t('investigation.nextError', locale)}
      </button>
      <button type="button" className="btn ui-btn-sm" disabled={longest === null} title={t('investigation.durationBoundary', locale)}
        onClick={() => { if (longest) inspect(longest.message.eventId); }}>
        <IconSpeed size={12} />{t('investigation.longest', locale)}{longest && ` · ${fmtDuration(longest.message.durationMs)}`}
      </button>
      <span className="spacer" />
      <button type="button" className="btn ui-btn-sm" aria-pressed={agentsOpen} onClick={onToggleAgents}>{t('trajectory.agentsToggle', locale)}</button>
      {onToggleFocus && <button type="button" className="btn ui-btn-sm" aria-pressed={focused} onClick={onToggleFocus}>{t(focused ? 'trajectory.exitFocus' : 'trajectory.focus', locale)}</button>}
    </div>
    <div className="investigation-scope">
      <span>{t('investigation.scope', locale).replace('{n}', String(entries.length))}</span>
      {!model.complete && <span className="investigation-partial">{t('investigation.partial', locale).replace('{n}', String(model.omittedEventCount))}</span>}
      <span>{t('investigation.durationBoundary', locale)}</span>
    </div>
    {showResults && <div className="investigation-search-results">
      <p role="status">{t('investigation.matches', locale).replace('{n}', String(matches.length)).replace('{limit}', String(RESULT_LIMIT))}</p>
      {matches.length === 0 && <p>{t('investigation.noMatches', locale)}</p>}
      <ul>
        {matches.slice(0, RESULT_LIMIT).map(({turn, message}) => <li key={message.eventId}>
          <button type="button" className="investigation-result" aria-pressed={selectedEventId === message.eventId} onClick={() => inspect(message.eventId)}>
            <span className="mono">#{message.sequence}</span>
            <span className="investigation-result-title" title={message.title}>{message.title || message.eventId}</span>
            <span>{message.tool ?? message.kind}</span>
            <span className="mono">{t('trajectory.turn.title', locale).replace('{index}', String(turn))}</span>
            {hasError(message) && <IconError size={12} />}
            <span className="mono">{fmtDuration(message.durationMs)}</span>
          </button>
        </li>)}
      </ul>
    </div>}
  </section>;
}
