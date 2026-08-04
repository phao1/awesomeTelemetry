import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { Modal } from './ui/Modal.js';

export interface HelpModalProps {
  locale: Locale;
  onClose: () => void;
}

/** REQ-008：? 快捷键帮助浮层（内容走 i18n）。 */
export function HelpModal({ locale, onClose }: HelpModalProps): React.JSX.Element {
  const rows = [
    'shortcut.palette',
    'shortcut.views',
    'shortcut.search',
    'shortcut.navigate',
    'shortcut.open',
    'shortcut.collapse',
    'shortcut.theme',
    'shortcut.esc',
    'shortcut.help',
  ] as const;
  return (
    <Modal title={t('shortcut.title', locale)} onClose={onClose} size="sm">
      <table className="ui-table ui-table-compact">
        <tbody>
          {rows.map((key) => (
            <tr key={key}>
              <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--accent-fg)' }}>
                {key.split('.').pop()}
              </td>
              <td>{t(key, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
