import type { ReactNode } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { IconCommand } from './icons/index.js';
import { Tabs } from './ui/Tabs.js';

export type AppView = 'session' | 'agent' | 'compare' | 'proxy' | 'frida';

export interface AppHeaderProps {
  locale: Locale;
  children?: ReactNode;
}

/** REQ-015：全局头 48px（--header-height）。 */
export function AppHeader({ children }: AppHeaderProps): React.JSX.Element {
  return (
    <header
      className="app-header"
      style={{ height: 'var(--header-height)' }}
    >
      <span className="app-title">Agent Observability</span>
      <span className="app-header-hint">
        <IconCommand size={12} />
      </span>
      <span className="spacer" />
      {children}
    </header>
  );
}

export interface ViewTabsProps {
  active: AppView;
  onChange: (view: AppView) => void;
  locale: Locale;
}

/** REQ-015：视图切换条 40px，underline 变体（GitHub 式）。 */
export function ViewTabs({ active, onChange, locale }: ViewTabsProps): React.JSX.Element {
  return (
    <div className="view-tabs" style={{ height: 'var(--tabs-height)' }}>
      <Tabs
        variant="underline"
        activeId={active}
        onChange={(id) => onChange(id as AppView)}
        items={(['session', 'agent', 'compare', 'proxy', 'frida'] as const).map((view) => ({
          id: view,
          label: t(`view.${view}`, locale),
        }))}
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
    <footer className="statusbar" style={{ height: 'var(--statusbar-height)' }} aria-live="polite">
      <span className={`status-dot ${live ? 'status-dot-live' : 'status-dot-dead'}`} aria-hidden="true" />
      <span>{live ? t('live.connected', locale) : t('live.disconnected', locale)}</span>
      <span className="statusbar-sep" aria-hidden="true" />
      <span>{sessionCount} sessions · {eventCount.toLocaleString()} events</span>
      <span className="statusbar-sep" aria-hidden="true" />
      <button type="button" className="statusbar-scan" onClick={onScan} disabled={scanning}>
        {scanning ? t('state.loading', locale) : lastScanAt === null ? 'idle' : `last scan ${new Date(lastScanAt).toLocaleTimeString()}`}
      </button>
      <span className="statusbar-sep" aria-hidden="true" />
      <span>
        db {fmtBytes(dbSizeBytes)} · wal {fmtBytes(walSizeBytes)}
      </span>
      <span className="spacer" />
      <span className="mono">{offlineSamples ? 'offline samples' : 'scan'}</span>
      <span className="mono">v0.1.0</span>
    </footer>
  );
}
