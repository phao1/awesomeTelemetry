import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { extractTokenText } from '../core/token-breakdown.js';
import type { TraceEvent } from '../core/trace-types.js';

export interface TokenTextModalProps {
  event: TraceEvent;
  locale: Locale;
  onClose: () => void;
}

/** REQ-008：token 分解下钻。 */
export function TokenTextModal({ event, locale, onClose }: TokenTextModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{t('token.title', locale)}</h3>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close', locale)}
          </button>
        </header>
        <div className="modal-body">
          <p className="mono">{extractTokenText(event.tokens)}</p>
        </div>
      </div>
    </div>
  );
}
