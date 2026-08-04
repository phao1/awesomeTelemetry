import type { Locale } from '../i18n.js';

export interface LanguageToggleProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
}

export function LanguageToggle({ locale, onChange }: LanguageToggleProps) {
  return (
    <button
      type="button"
      className="btn"
      onClick={() => onChange(locale === 'zh' ? 'en' : 'zh')}
      title="language"
    >
      {locale === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
