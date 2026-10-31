import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs.js';

const hosts: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
function setup(active = 'a') {
  const changed = vi.fn();
  function Harness() {
    const [selected, select] = useState(active);
    return <Tabs activeId={selected} onChange={id => { changed(id); select(id); }}
      items={[{ id: 'a', label: 'A' }, { id: 'disabled', label: 'Disabled', disabled: true }, { id: 'c', label: 'C' }]} />;
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); hosts.push({ root, host }); act(() => root.render(<Harness />));
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  return { host, tabs, changed };
}
afterEach(() => { for (const { root, host } of hosts.splice(0)) { act(() => root.unmount()); host.remove(); } });
function key(tab: HTMLButtonElement, value: string, ctrlKey = false) {
  act(() => tab.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true, cancelable: true })));
}

describe('Tabs keyboard navigation', () => {
  it('keeps IDs unique across nested workbench and Team tab lists with shared item keys', () => {
    const first = setup(); const second = setup();
    const ids = [...first.tabs, ...second.tabs].map(tab => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    key(second.tabs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(second.tabs[2]);
    expect(first.tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });
  it('does not announce a fabricated panel target when the caller has no tabpanel', () => {
    const { tabs } = setup();
    for (const tab of tabs) expect(tab.hasAttribute('aria-controls')).toBe(false);
  });
  it('has one tab stop on the selected enabled tab', () => {
    const { tabs } = setup(); expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
  });
  it('moves right, skips disabled tabs and transfers focus and selection', () => {
    const { tabs, changed } = setup(); key(tabs[0]!, 'ArrowRight');
    expect(changed).toHaveBeenLastCalledWith('c'); expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true'); expect(tabs[2]?.tabIndex).toBe(0);
  });
  it('wraps in both directions', () => {
    const { tabs, changed } = setup(); key(tabs[0]!, 'ArrowLeft'); expect(changed).toHaveBeenLastCalledWith('c');
    key(tabs[2]!, 'ArrowRight'); expect(changed).toHaveBeenLastCalledWith('a');
  });
  it('supports Home and End', () => {
    const { tabs, changed } = setup(); key(tabs[0]!, 'End'); expect(changed).toHaveBeenLastCalledWith('c');
    key(tabs[2]!, 'Home'); expect(changed).toHaveBeenLastCalledWith('a');
  });
  it('does not consume modified keys or unrelated native activation', () => {
    const { tabs, changed } = setup(); key(tabs[0]!, 'ArrowRight', true); key(tabs[0]!, 'Enter');
    expect(changed).not.toHaveBeenCalled(); act(() => tabs[2]?.click()); expect(changed).toHaveBeenCalledWith('c');
  });
  it('keeps the first enabled tab reachable when the active id is unavailable', () => {
    const { tabs } = setup('missing'); expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
  });
});
