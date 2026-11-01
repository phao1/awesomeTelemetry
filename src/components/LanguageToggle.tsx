import { IconLanguages } from './icons/index.js';
import { IconButton } from './ui/Button.js';
import { Tooltip } from './ui/Overlay.js';
import type { Locale } from '../i18n.js';

export interface LanguageToggleProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
}

export function LanguageToggle({ locale, onChange }: LanguageToggleProps) {
  const label=locale==='zh'?'语言：切换为 English':'Language: switch to 中文';
  return <Tooltip label={label}><IconButton label={label} icon={<IconLanguages/>} onClick={()=>onChange(locale==='zh'?'en':'zh')}/></Tooltip>;
}
