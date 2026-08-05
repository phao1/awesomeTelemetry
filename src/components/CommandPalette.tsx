import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SessionIndexEntry } from '../core/trace-types.js';
import { Modal } from './ui/Modal.js';
import { SearchInput } from './ui/Input.js';
import { VirtualList } from './ui/VirtualList.js';
import { ProviderBadge } from './ui/Badge.js';

export type PaletteAction =
  | { type: 'session'; key: string }
  | { type: 'view'; view: string }
  | { type: 'theme' }
  | { type: 'language' }
  | { type: 'scan' }
  | { type: 'settings' };

export interface CommandPaletteProps {
  sessions: SessionIndexEntry[];
  locale: Locale;
  onClose: () => void;
  onAction: (action: PaletteAction) => void;
}

interface Command {
  id: string;
  label: string;
  hint: string;
  action: PaletteAction;
}

/** REQ-025：命令面板。复用共享 store，不发任何请求。 */
export function CommandPalette({
  sessions,
  locale,
  onClose,
  onAction,
}: CommandPaletteProps): React.JSX.Element {
  const [search, setSearch] = useState('');

  const commands = useMemo<Command[]>(() => {
    const q = search.trim().toLowerCase();
    const sessionCommands: Command[] = sessions
      .filter(
        (session) =>
          q === '' ||
          session.title.toLowerCase().includes(q) ||
          session.id.toLowerCase().includes(q),
      )
      .slice(0, 200)
      .map((session) => ({
        id: `session-${session.id}`,
        label: session.title || session.id,
        hint: session.id,
        action: { type: 'session', key: session.id },
      }));
    const staticCommands: Command[] = [
      { id: 'view-agent', label: t('view.agent', locale), hint: 'view', action: { type: 'view', view: 'agent' } },
      { id: 'view-compare', label: t('view.compare', locale), hint: 'view', action: { type: 'view', view: 'compare' } },
      { id: 'view-proxy', label: t('view.proxy', locale), hint: 'view', action: { type: 'view', view: 'proxy' } },
      { id: 'view-frida', label: t('view.frida', locale), hint: 'view', action: { type: 'view', view: 'frida' } },
      { id: 'view-mission', label: t('view.mission', locale), hint: 'view', action: { type: 'view', view: 'mission' } },
      { id: 'theme', label: t('palette.theme', locale), hint: '⌘\\', action: { type: 'theme' } },
      { id: 'language', label: t('palette.language', locale), hint: 'zh/en', action: { type: 'language' } },
      { id: 'scan', label: t('palette.scan', locale), hint: 'scan', action: { type: 'scan' } },
      { id: 'settings', label: t('palette.settings', locale), hint: 'settings', action: { type: 'settings' } },
    ];
    return [...sessionCommands, ...staticCommands];
  }, [sessions, search, locale]);

  const run = (command: Command): void => {
    onAction(command.action);
    onClose();
  };

  return (
    <Modal title={t('palette.title', locale)} onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <SearchInput
          autoFocus
          placeholder={t('palette.searchPlaceholder', locale)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ height: '50vh' }}>
          <VirtualList
            items={commands}
            rowHeight={32}
            getKey={(command) => command.id}
            renderRow={(command) => {
              const action = command.action;
              return (
                <button
                  type="button"
                  className="palette-row"
                  onClick={() => run(command)}
                  style={{ height: '100%', width: '100%' }}
                >
                  {action.type === 'session' && (
                    <ProviderBadge
                      provider={sessions.find((s) => s.id === action.key)?.provider ?? 'codex'}
                      locale={locale}
                    />
                  )}
                  <span className="palette-row-label">{command.label}</span>
                  <span className="mono palette-row-hint">{command.hint}</span>
                </button>
              );
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
