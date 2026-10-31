import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStart, type SessionStartProps } from './SessionStart.js';

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
afterEach(() => act(() => { for (const {root,host} of mounted.splice(0)) { root.unmount(); host.remove(); } }));

function mount(overrides: Partial<SessionStartProps> = {}): HTMLDivElement {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); mounted.push({root,host});
  act(() => root.render(<SessionStart locale="zh" recent={{ id: 'codex-recent', provider: 'codex', title: 'Read synthetic evidence' }} loading={false}
    onClearFilters={() => undefined} onSelect={() => undefined} onSearch={() => undefined} onCapture={() => undefined} onTeams={() => undefined} onSettings={() => undefined} {...overrides} />));
  return host;
}

describe('WB-002 investigation entry', () => {
  it('opens the recent metadata record without owning or loading another session list', () => {
    const select = vi.fn(); const host = mount({onSelect:select});
    act(() => (host.querySelector('.session-start-primary') as HTMLButtonElement).click());
    expect(select).toHaveBeenCalledExactlyOnceWith('codex-recent');
    expect(host.textContent).toContain('Read synthetic evidence');
    expect(host.querySelectorAll('.session-start-steps li')).toHaveLength(3);
  });
  it('routes search, capture setup and Team exploration through explicit user actions', () => {
    const search = vi.fn(); const capture = vi.fn(); const teams = vi.fn();
    const host = mount({onSearch:search,onCapture:capture,onTeams:teams});
    act(() => (host.querySelector('.session-start-search') as HTMLButtonElement).click());
    const actions = host.querySelectorAll<HTMLElement>('.session-start-action');
    act(() => { actions[1]!.click(); actions[2]!.click(); });
    expect(search).toHaveBeenCalledTimes(1); expect(capture).toHaveBeenCalledTimes(1); expect(teams).toHaveBeenCalledTimes(1);
  });
  it('offers source setup only after a successful empty metadata result, not while loading', () => {
    const settings = vi.fn(); const host = mount({recent:null, loading:true, onSettings:settings});
    const action = host.querySelector<HTMLButtonElement>('.session-start-primary')!;
    expect(action.disabled).toBe(true); act(() => action.click()); expect(settings).not.toHaveBeenCalled();
  });
  it('opens settings for a missing local source without starting network monitoring', () => {
    const settings = vi.fn(); const capture = vi.fn(); const host = mount({recent:null,onSettings:settings,onCapture:capture});
    act(() => (host.querySelector('.session-start-primary') as HTMLButtonElement).click());
    expect(settings).toHaveBeenCalledTimes(1); expect(capture).not.toHaveBeenCalled();
  });
  it('broadens empty filtered results instead of treating them as a missing local source', () => {
    const settings = vi.fn(); const clear = vi.fn(); const host = mount({recent:null,filtered:true,onSettings:settings,onClearFilters:clear});
    const primary = host.querySelector<HTMLButtonElement>('.session-start-primary')!;
    expect(primary.textContent).toContain('清除筛选');
    expect(primary.textContent).not.toContain('检查本地扫描目录');
    act(() => primary.click()); expect(clear).toHaveBeenCalledTimes(1); expect(settings).not.toHaveBeenCalled();
  });
  it('explicitly identifies offline examples instead of presenting them as native execution proof', () => {
    const host = mount({offlineSamples:true});
    expect(host.querySelector('.session-start-primary')?.textContent).toContain('查看离线样本');
  });
  it('localizes the workflow and preserves the native/network evidence boundary', () => {
    const host = mount({locale:'en'});
    expect(host.querySelector('h1')?.textContent).toBe('Start with an execution');
    expect(host.querySelector('.session-start-boundary')?.textContent).toContain('kept separate');
    expect(host.querySelector('.session-start-boundary')?.textContent).toContain('not complete visibility');
  });
});
