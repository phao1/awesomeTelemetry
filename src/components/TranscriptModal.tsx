import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEvent } from '../core/trace-types.js';

export interface TranscriptModalProps {
  title: string;
  events: TraceEvent[];
  locale: Locale;
  onClose: () => void;
}

/** REQ-008：完整 transcript（mode=full）。 */
export function TranscriptModal({ title, events, locale, onClose }: TranscriptModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close', locale)}
          </button>
        </header>
        <div className="modal-body transcript">
          {events.map((event) => (
            <div key={event.id} className="transcript-row">
              <span className="mono">#{event.sequence}</span>
              <span>{event.phase}</span>
              <span>{event.title}</span>
              {event.inputSummary !== null && <pre>{event.inputSummary}</pre>}
              {event.outputSummary !== null && <pre>{event.outputSummary}</pre>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
