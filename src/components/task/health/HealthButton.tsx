import { Button } from '../../ui/Button.js';
import type { Locale } from '../../../i18n.js';
import { healthCopy } from './health-copy.js';
export function HealthButton({ locale, open, onClick }: { locale: Locale; open: boolean; onClick: () => void }) {
  return <Button variant="primary" aria-expanded={open} aria-controls="task-health-drawer" onClick={onClick}>{healthCopy(locale).title}</Button>;
}
