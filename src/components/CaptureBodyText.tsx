import { useMemo, useState } from 'react';
import { t, type Locale } from '../i18n.js';

/** Examine at most64KiB of UTF-8, never allocate an encoding of the whole field. */
function prefix(text: string): { text: string; truncated: boolean } {
  let end = 0, bytes = 0;
  while (end < text.length) {
    const code = text.codePointAt(end)!;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > 65536) break;
    bytes += size;end += code > 0xffff ? 2 : 1;
  }
  return { text: text.slice(0, end), truncated: end < text.length };
}

export function CaptureBodyText({ value, locale }: { value: string | null; locale: Locale }): React.JSX.Element {
  const [font, setFont] = useState(14), [expandedValue, setExpandedValue] = useState<string | null>(null);
  const preview = useMemo(() => value === null ? null : prefix(value), [value]);
  const expanded = value !== null && expandedValue === value;
  return <section className="capture-body-text">
    <div className="capture-toolbar">
      <span className="hint">{t('capture.bodyScope', locale)}</span>
      <button type="button" className="btn ui-btn-sm" aria-label={t('capture.fontDecrease', locale)} disabled={font <= 8} onClick={() => setFont(n => Math.max(8, n - 1))}>A−</button>
      <button type="button" className="btn ui-btn-sm" aria-label={t('capture.fontIncrease', locale)} disabled={font >= 28} onClick={() => setFont(n => Math.min(28, n + 1))}>A+</button>
      <button type="button" className="btn ui-btn-sm" aria-label={t('capture.fontReset', locale)} onClick={() => setFont(14)}>R</button>
    </div>
    {preview?.truncated && <p className="hint">{t('capture.bodyPreview', locale)} <button type="button" className="btn ui-btn-sm" onClick={() => setExpandedValue(expanded ? null : value)}>{t(expanded ? 'capture.collapseField' : 'capture.expandField', locale)}</button></p>}
    {value === null ? <p className="hint">{t('capture.bodyUnavailable', locale)}</p> : value === '' ? <p className="hint">{t('capture.bodyEmpty', locale)}</p> :
      <pre className="capture-body-content" style={{ fontSize: font }}>{expanded ? value : preview?.text}</pre>}
  </section>;
}
