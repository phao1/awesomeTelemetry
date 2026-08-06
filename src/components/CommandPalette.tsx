import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  ProviderKey,
  SessionIndexEntry,
  TraceEventSlim,
} from '../core/trace-types.js';
import { PROVIDER_KEYS } from '../core/trace-types.js';
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
  | { type: 'settings' }
  /** REQ-111：直接发起 compare（左右两个会话 key）。 */
  | { type: 'compare'; left: string; right: string }
  /** REQ-112：跳转到当前会话的指定事件。 */
  | { type: 'goto'; eventId: string }
  /** REQ-113：按 provider 过滤会话列表（App 侧做 toggle）。 */
  | { type: 'filter'; provider: ProviderKey };

export interface CommandPaletteProps {
  sessions: SessionIndexEntry[];
  locale: Locale;
  onClose: () => void;
  onAction: (action: PaletteAction) => void;
  /** REQ-112：当前会话事件（Session 视图已加载详情时传入）。MUST NOT 由面板自行请求。 */
  events?: TraceEventSlim[];
  /** REQ-112：当前视图；非 session 时 `/goto` 为禁用态。 */
  view?: string;
  /** REQ-113：当前 provider 过滤，用于显示开/关状态。 */
  providerFilter?: readonly ProviderKey[];
}

type PaletteCategory = 'session' | 'nav' | 'action' | 'advanced' | 'goto' | 'filter' | 'compare';

interface Command {
  id: string;
  label: string;
  hint: string;
  category: PaletteCategory;
  /** 执行入口。禁用行不带 run。 */
  run?: () => void;
  /** 会话 / provider 行的字母章。 */
  provider?: ProviderKey;
  disabled?: boolean;
  checked?: boolean;
}

/** REQ-111：`/compare` 子模式只取最近 10 个会话（G11.9：读共享 store，不发请求）。 */
const COMPARE_PICK_LIMIT = 10;
/** REQ-112：`/goto` 事件候选上限。 */
const GOTO_LIMIT = 20;

const PREFIXES = [
  { prefix: '/compare', category: 'compare' as const },
  { prefix: '/filter', category: 'filter' as const },
  { prefix: '/goto', category: 'goto' as const },
  { prefix: '/nav', category: 'nav' as const },
  { prefix: '/act', category: 'action' as const },
  { prefix: '/s', category: 'session' as const },
];

function parsePrefix(raw: string): { category: PaletteCategory | null; query: string } {
  const lower = raw.toLowerCase();
  for (const entry of PREFIXES) {
    if (lower === entry.prefix || lower.startsWith(`${entry.prefix} `)) {
      const space = raw.indexOf(' ');
      return { category: entry.category, query: space >= 0 ? raw.slice(space + 1).trim() : '' };
    }
  }
  return { category: null, query: raw.trim() };
}

/** REQ-025 + REQ-110 + REQ-111/112/113：命令面板 —— 会话/导航/动作 + compare/goto/filter。
 * `/s`、`/nav`、`/act`、`/compare`、`/goto`、`/filter` 前缀过滤；无前缀混合搜索。
 * 全部数据来自 props（共享 store），MUST NOT 发额外请求。 */
export function CommandPalette({
  sessions,
  locale,
  onClose,
  onAction,
  events = [],
  view = 'session',
  providerFilter = [],
}: CommandPaletteProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  /** REQ-111：`/compare` 二段式 —— 点动作后进入会话挑选模式。 */
  const [comparePicking, setComparePicking] = useState(false);
  const [comparePick, setComparePick] = useState<string[]>([]);

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, COMPARE_PICK_LIMIT),
    [sessions],
  );

  const run = (action: PaletteAction): void => {
    onAction(action);
    onClose();
  };

  const pickCompare = (key: string): void => {
    const next = comparePick.includes(key)
      ? comparePick.filter((k) => k !== key)
      : [...comparePick, key];
    if (next.length === 2) {
      run({ type: 'compare', left: next[0]!, right: next[1]! });
      return;
    }
    setComparePick(next);
  };

  const { category: prefix, query } = parsePrefix(search.trim());
  const q = query.toLowerCase();

  const commands = useMemo<Command[]>(() => {
    const matches = (label: string): boolean => q === '' || label.toLowerCase().includes(q);

    // REQ-111：挑选模式覆盖普通列表 —— 只显示最近 10 个会话。
    if (comparePicking) {
      if (recentSessions.length === 0) {
        return [
          {
            id: 'compare-empty',
            label: t('palette.compare.empty', locale),
            hint: 'compare',
            category: 'compare',
            disabled: true,
          },
        ];
      }
      return recentSessions.map((session) => ({
        id: `compare-pick-${session.id}`,
        label: session.title || session.id,
        hint: session.id,
        category: 'compare',
        provider: session.provider,
        checked: comparePick.includes(session.id),
        run: () => pickCompare(session.id),
      }));
    }

    const sessionCommands: Command[] =
      prefix === null || prefix === 'session'
        ? sessions
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
              category: 'session' as const,
              provider: session.provider,
              run: () => run({ type: 'session', key: session.id }),
            }))
        : [];

    const navCommands: Command[] =
      prefix === null || prefix === 'nav'
        ? (['agent', 'compare', 'proxy', 'frida', 'mission'] as const)
            .map((target) => ({
              id: `view-${target}`,
              label: t(`view.${target}`, locale),
              hint: 'nav',
              category: 'nav' as const,
              run: () => run({ type: 'view', view: target }),
            }))
            .filter((command) => matches(command.label))
        : [];

    const actionCommands: Command[] =
      prefix === null || prefix === 'action'
        ? (
            [
              { id: 'export', label: t('palette.export', locale), action: { type: 'export' } as PaletteAction },
              { id: 'theme', label: t('palette.theme', locale), action: { type: 'theme' } as PaletteAction },
              { id: 'language', label: t('palette.language', locale), action: { type: 'language' } as PaletteAction },
              { id: 'scan', label: t('palette.scan', locale), action: { type: 'scan' } as PaletteAction },
              { id: 'settings', label: t('palette.settings', locale), action: { type: 'settings' } as PaletteAction },
            ]
          )
            .map((entry) => ({
              id: entry.id,
              label: entry.label,
              hint: 'act',
              category: 'action' as const,
              run: () => run(entry.action),
            }))
            .filter((command) => matches(command.label))
        : [];

    // REQ-111：`/compare` 动作入口 + 无会话禁用态。
    const compareCommands: Command[] =
      prefix === 'compare'
        ? recentSessions.length < 2
          ? [
              {
                id: 'compare-empty',
                label: t('palette.compare.empty', locale),
                hint: 'compare',
                category: 'compare',
                disabled: true,
              },
            ]
          : [
              {
                id: 'compare-open',
                label: t('palette.compare', locale),
                hint: 'compare',
                category: 'compare',
                run: () => {
                  setComparePick([]);
                  setComparePicking(true);
                },
              },
            ]
        : [];

    // REQ-112：`/goto` —— 非 Session 视图 / 无事件时禁用；数字按序号，其余按标题关键词。
    const gotoCommands: Command[] = ((): Command[] => {
      if (prefix !== 'goto') {
        return [];
      }
      if (view !== 'session' || events.length === 0) {
        return [
          {
            id: 'goto-disabled',
            label: t('palette.goto.disabled', locale),
            hint: 'goto',
            category: 'goto',
            disabled: true,
          },
        ];
      }
      const numeric = /^\d+$/.test(query);
      const hits = numeric
        ? events.filter((event) => String(event.sequence).startsWith(query))
        : query === ''
          ? events
          : events.filter((event) => event.title.toLowerCase().includes(q));
      if (hits.length === 0) {
        return [
          {
            id: 'goto-nomatch',
            label: t('palette.goto.noMatch', locale),
            hint: 'goto',
            category: 'goto',
            disabled: true,
          },
        ];
      }
      return hits.slice(0, GOTO_LIMIT).map((event) => ({
        id: `goto-${event.id}`,
        label: `#${event.sequence} ${event.title}`,
        hint: 'goto',
        category: 'goto' as const,
        run: () => run({ type: 'goto', eventId: event.id }),
      }));
    })();

    // REQ-113：`/filter` —— 9 个 provider，带字母章，再次点击取消。
    const filterCommands: Command[] =
      prefix === 'filter'
        ? PROVIDER_KEYS.map((provider) => ({
            id: `filter-${provider}`,
            label: t(`provider.${provider}`, locale),
            hint: providerFilter.includes(provider)
              ? t('palette.filter.on', locale)
              : t('palette.filter.off', locale),
            category: 'filter' as const,
            provider,
            checked: providerFilter.includes(provider),
            run: () => run({ type: 'filter', provider }),
          })).filter((command) => matches(command.label) || matches(command.provider))
        : [];

    // 无前缀混合搜索时，3 个高级动作入口也参与匹配。
    const advancedCommands: Command[] =
      prefix === null
        ? (
            [
              {
                id: 'adv-compare',
                label: t('palette.compare', locale),
                run: () => {
                  setComparePick([]);
                  setComparePicking(true);
                },
              },
              { id: 'adv-goto', label: t('palette.goto', locale), run: () => setSearch('/goto ') },
              { id: 'adv-filter', label: t('palette.filter', locale), run: () => setSearch('/filter ') },
            ]
          )
            .map((entry) => ({ ...entry, hint: 'adv', category: 'advanced' as const }))
            .filter((command) => matches(command.label))
        : [];

    return [
      ...sessionCommands,
      ...navCommands,
      ...actionCommands,
      ...advancedCommands,
      ...compareCommands,
      ...gotoCommands,
      ...filterCommands,
    ];
  }, [
    sessions,
    recentSessions,
    events,
    providerFilter,
    view,
    locale,
    prefix,
    q,
    query,
    comparePicking,
    comparePick,
  ]);

  return (
    <Modal title={t('palette.title', locale)} onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {comparePicking ? (
          <div className="palette-mode-head">
            <span>
              {t('palette.compare.pick', locale).replace('{n}', String(comparePick.length))}
            </span>
            <button
              type="button"
              className="btn ui-btn-sm"
              onClick={() => {
                setComparePicking(false);
                setComparePick([]);
              }}
            >
              {t('common.cancel', locale)}
            </button>
          </div>
        ) : (
          <SearchInput
            autoFocus
            placeholder={t('palette.searchPlaceholder', locale)}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <div style={{ height: '50vh' }}>
          <VirtualList
            items={commands}
            rowHeight={32}
            getKey={(command) => command.id}
            renderRow={(command) => (
              <button
                type="button"
                className={`palette-row ${command.checked === true ? 'palette-row-on' : ''}`}
                disabled={command.disabled === true}
                aria-disabled={command.disabled === true}
                aria-pressed={command.checked}
                onClick={() => command.run?.()}
                style={{ height: '100%', width: '100%' }}
              >
                {command.provider !== undefined && (
                  <ProviderBadge provider={command.provider} locale={locale} />
                )}
                {command.provider === undefined && (
                  <span className="palette-row-icon" aria-hidden="true">
                    <IconChevronRight size={12} />
                  </span>
                )}
                <span className="palette-row-label">{command.label}</span>
                <span className="mono palette-row-hint">{command.hint}</span>
              </button>
            )}
          />
        </div>
        <p className="mono palette-prefix-hint">{t('palette.prefixHint', locale)}</p>
      </div>
    </Modal>
  );
}
