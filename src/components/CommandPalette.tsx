import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { SessionIndexEntry } from '../core/trace-types.js';
import { Modal } from './ui/Modal.js';
import { SearchInput } from './ui/Input.js';
import { VirtualList } from './ui/VirtualList.js';
import { ProviderBadge } from './ui/Badge.js';
import { IconChevronRight } from './icons/index.js';

export type PaletteAction =
  | { type: 'session'; key: string }
  | { type: 'view'; view: string }
  | { type: 'export' }
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
  category: 'session' | 'nav' | 'action';
}

/** REQ-025 + REQ-110：命令面板 —— 3 类动作（会话/导航/动作）。
 * `/s`、`/nav`、`/act` 前缀过滤；无前缀混合搜索。复用共享 store，不发请求。 */
export function CommandPalette({
  sessions,
  locale,
  onClose,
  onAction,
}: CommandPaletteProps): React.JSX.Element {
  const [search, setSearch] = useState('');

  const commands = useMemo<Command[]>(() => {
    const raw = search.trim();
    const lower = raw.toLowerCase();
    const prefix =
      lower === '/s' || lower.startsWith('/s ')
        ? 'session'
        : lower === '/nav' || lower.startsWith('/nav ')
          ? 'nav'
          : lower === '/act' || lower.startsWith('/act ')
            ? 'action'
            : null;
    const space = raw.indexOf(' ');
    const q = (prefix === null ? raw : space >= 0 ? raw.slice(space + 1) : '').toLowerCase();
    const sessionCommands: Command[] = sessions
      .filter(
        (session) =>
          (prefix === null || prefix === 'session') &&
          (q === '' ||
            session.title.toLowerCase().includes(q) ||
            session.id.toLowerCase().includes(q)),
      )
      .slice(0, 200)
      .map((session) => ({
        id: `session-${session.id}`,
        label: session.title || session.id,
        hint: session.id,
        action: { type: 'session', key: session.id },
        category: 'session',
      }));
    const navCommands: Command[] = (
      [
        { id: 'view-agent', label: t('view.agent', locale), hint: 'nav', action: { type: 'view', view: 'agent' } },
        { id: 'view-compare', label: t('view.compare', locale), hint: 'nav', action: { type: 'view', view: 'compare' } },
        { id: 'view-proxy', label: t('view.proxy', locale), hint: 'nav', action: { type: 'view', view: 'proxy' } },
        { id: 'view-frida', label: t('view.frida', locale), hint: 'nav', action: { type: 'view', view: 'frida' } },
        { id: 'view-mission', label: t('view.mission', locale), hint: 'nav', action: { type: 'view', view: 'mission' } },
      ] as Array<Command & { label: string }>
    ).map((command) => ({ ...command, category: 'nav' as const }));
    const actionCommands: Command[] = [
      { id: 'export', label: t('palette.export', locale), hint: 'act', action: { type: 'export' }, category: 'action' },
      { id: 'theme', label: t('palette.theme', locale), hint: 'act', action: { type: 'theme' }, category: 'action' },
      { id: 'language', label: t('palette.language', locale), hint: 'act', action: { type: 'language' }, category: 'action' },
      { id: 'scan', label: t('palette.scan', locale), hint: 'act', action: { type: 'scan' }, category: 'action' },
      { id: 'settings', label: t('palette.settings', locale), hint: 'act', action: { type: 'settings' }, category: 'action' },
    ];
    const matches = (label: string): boolean => q === '' || label.toLowerCase().includes(q);
    const nav = (prefix === null || prefix === 'nav') ? navCommands.filter((c) => matches(c.label)) : [];
    const action = (prefix === null || prefix === 'action') ? actionCommands.filter((c) => matches(c.label)) : [];
    return [...sessionCommands, ...nav, ...action];
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
                  {command.category !== 'session' && (
                    <span className="palette-row-icon" aria-hidden="true">
                      <IconChevronRight size={12} />
                    </span>
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
