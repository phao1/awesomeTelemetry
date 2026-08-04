import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';

export interface LiveIndicatorProps {
  connected: boolean;
  locale: Locale;
}

export function LiveIndicator({ connected, locale }: LiveIndicatorProps) {
  return (
    <span
      className={`live ${connected ? 'live-on' : 'live-off'}`}
      title={t(connected ? 'live.connected' : 'live.disconnected', locale)}
    >
      {t(connected ? 'live.connected' : 'live.disconnected', locale)}
    </span>
  );
}
