import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n.js';
import { AppHeader, StatusBar, ViewTabs } from './AppShell.js';

const hosts: Array<{ node: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];
function mount(node: React.ReactNode): HTMLDivElement {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); hosts.push({ node: host, root });
  act(() => root.render(node)); return host;
}
afterEach(() => { for (const host of hosts.splice(0)) { act(() => host.root.unmount()); host.node.remove(); } });

describe('workbench shared shell', () => {
  it.each(['zh', 'en'] as const)('offers a visible, actionable global search (%s)', locale => {
    const search = vi.fn();
    const host = mount(<AppHeader locale={locale} onSearch={search}><button>settings</button></AppHeader>);
    expect(host.textContent).toContain('AwesomeTelemetry');
    const button = host.querySelector<HTMLButtonElement>('.app-header-search');
    expect(button?.getAttribute('aria-label')).toBe(t('workbench.search', locale));
    expect(button?.textContent).toContain('⌘ K');
    act(() => button?.click()); expect(search).toHaveBeenCalledTimes(1);
    expect(host.querySelector('header')?.textContent).toContain('settings');
  });

  it('does not render a dead search action without a handler', () => {
    expect(mount(<AppHeader locale="en" />).querySelector('.app-header-search')).toBeNull();
  });

  it.each(['zh', 'en'] as const)('keeps six views accessible and labels their icons (%s)', locale => {
    const change = vi.fn(); const host = mount(<ViewTabs active="proxy" onChange={change} locale={locale} />);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(6);
    expect(tabs.filter(tab => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(tabs[3]?.textContent).toBe(t('view.proxy', locale));
    for (const tab of tabs) expect(tab.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    act(() => tabs[2]?.click()); expect(change).toHaveBeenCalledWith('compare');
  });

  it.each(['zh', 'en'] as const)('distinguishes native index source and unknown capacity (%s)', locale => {
    const scan = vi.fn();
    const host = mount(<StatusBar live locale={locale} sessionCount={12} eventCount={34} scanning={false}
      lastScanAt={null} dbSizeBytes={null} walSizeBytes={null} offlineSamples={false} onScan={scan} />);
    expect(host.textContent).toContain(t('workbench.nativeIndex', locale));
    expect(host.textContent).toContain('—');
    act(() => host.querySelector<HTMLButtonElement>('.statusbar-scan')?.click());
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
