import type { ReactNode } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { IconAgents, IconCompare, IconFrida, IconProxy, IconSearch, IconSessions, IconStability } from './icons/index.js';
import { Tabs } from './ui/Tabs.js';

export type AppView = 'session' | 'agent' | 'compare' | 'proxy' | 'frida' | 'mission' | 'task' | 'intake';

export interface AppHeaderProps {
  locale: Locale;
  onSearch?: () => void;
  children?: ReactNode;
}

/** REQ-015：全局头 48px（--header-height）。 */
export function AppHeader({ locale, onSearch, children }: AppHeaderProps): React.JSX.Element {
  return (
    <header
      className="app-header"
      style={{ height: 'var(--header-height)' }}
    >
      <div className="app-brand">
        <span className="app-brand-mark" aria-hidden="true"><IconStability size={20} /></span>
        <span className="app-brand-copy">
          <span className="app-title">AwesomeTelemetry</span>
          <span className="app-brand-caption">{t('workbench.subtitle', locale)}</span>
        </span>
      </div>
      <span className="spacer" />
      {onSearch !== undefined && <button type="button" className="app-header-search" onClick={onSearch}
        aria-label={t('workbench.search', locale)} title={t('workbench.search', locale)}>
        <IconSearch size={16} />
        <span className="app-header-search-label">{t('workbench.search', locale)}</span>
        <kbd aria-hidden="true">⌘ K / Ctrl K</kbd>
      </button>}
      <div className="app-header-actions">{children}</div>
    </header>
  );
}

export interface ViewTabsProps {
  active: Exclude<AppView, 'task' | 'intake'>;
  onChange: (view: AppView) => void;
  locale: Locale;
}

/** REQ-015：视图切换条 40px，underline 变体（GitHub 式）。 */
export function ViewTabs({ active, onChange, locale }: ViewTabsProps): React.JSX.Element {
  const icons = { session: IconSessions, agent: IconAgents, compare: IconCompare, proxy: IconProxy, frida: IconFrida, mission: IconStability };
  return (
    <div className="view-tabs" style={{ height: 'var(--tabs-height)' }}>
      <Tabs
        variant="underline"
        activeId={active}
        onChange={(id) => onChange(id as AppView)}
        items={(['session', 'agent', 'compare', 'proxy', 'frida', 'mission'] as const).map((view) => {
          const Icon = icons[view];
          return { id: view, label: <span className="workbench-nav-label"><Icon size={16} /><span>{t(`view.${view}`, locale)}</span></span> };
        })}
      />
    </div>
  );
}

export interface StatusBarProps {
  live: boolean;
  locale: Locale;
  sessionCount: number;
  eventCount: number;
  scanning: boolean;
  lastScanAt: string | null;
  dbSizeBytes: number | null;
  walSizeBytes: number | null;
  offlineSamples: boolean;
  onScan: () => void;
}

/** REQ-023：状态栏 28px，MUST NOT 轮询 /api/health。 */
export function StatusBar({
  live,
  locale,
  sessionCount,
  eventCount,
  scanning,
  lastScanAt,
  dbSizeBytes,
  walSizeBytes,
  offlineSamples,
  onScan,
}: StatusBarProps): React.JSX.Element {
  const fmtBytes = (bytes: number | null): string =>
    bytes === null ? '—' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(1)}KB`;
  return (
    <footer className="statusbar" style={{ height: 'var(--statusbar-height)' }}>
      <span className={`status-dot ${live ? 'status-dot-live' : 'status-dot-dead'}`} aria-hidden="true" />
      <span role="status" aria-live="polite">{live ? t('live.connected', locale) : t('live.disconnected', locale)}</span>
      <span className="statusbar-sep" aria-hidden="true" />
      <span>{sessionCount.toLocaleString()} {t('workbench.sessions', locale)} · {eventCount.toLocaleString()} {t('workbench.events', locale)}</span>
      <span className="statusbar-sep" aria-hidden="true" />
      <button type="button" className="statusbar-scan" onClick={onScan} disabled={scanning} aria-busy={scanning}
        title={lastScanAt ?? t('workbench.scanReady', locale)}>
        {scanning ? t('state.loading', locale) : lastScanAt === null ? t('workbench.scanReady', locale) : `${t('workbench.lastScan', locale)} ${new Date(lastScanAt).toLocaleTimeString()}`}
      </button>
      <span className="statusbar-sep" aria-hidden="true" />
      <span>
        db {fmtBytes(dbSizeBytes)} · wal {fmtBytes(walSizeBytes)}
      </span>
      <span className="spacer" />
      <span className="mono workbench-source">{offlineSamples ? 'offline samples' : t('workbench.nativeIndex', locale)}</span>
      <span className="mono">v0.1.0</span>
    </footer>
  );
}
