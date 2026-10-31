import { describe, expect, it } from 'vitest';

import {
  installKeyboardShortcuts,
  overlayCount,
  pushOverlay,
  registerShortcut,
} from './keyboard.js';

function keydown(key: string, opts: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('REQ-008 全局快捷键分发（D1）', () => {
  it('does not consume native button Enter or background navigation while an overlay owns focus', () => {
    installKeyboardShortcuts(); const calls: string[] = [];
    const unregister = registerShortcut({ key: 'Enter' }, () => calls.push('background-open'));
    const removeOverlay = pushOverlay(() => {}), button = document.createElement('button'); document.body.appendChild(button); button.focus();
    try {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false); expect(calls).toEqual([]);
      removeOverlay(); keydown('Enter'); expect(calls).toEqual(['background-open']);
    } finally { removeOverlay(); unregister(); button.remove(); }
  });
  it('keeps already-handled keys with their native/component owner instead of dispatching globally', () => {
    installKeyboardShortcuts(); let calls = 0; const unregister = registerShortcut({ key: 'j' }, () => { calls += 1; });
    try { const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }); event.preventDefault(); document.dispatchEvent(event); expect(calls).toBe(0); }
    finally { unregister(); }
  });
  it('preserves native activation of focused buttons and links even without an overlay', () => {
    installKeyboardShortcuts(); let calls = 0; const unregister = registerShortcut({ key: 'Enter' }, () => { calls += 1; });
    const button = document.createElement('button'), link = document.createElement('a'); link.href = '#synthetic'; document.body.append(button, link);
    try {
      for (const target of [button, link]) {
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); target.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(calls).toBe(0); keydown('Enter'); expect(calls).toBe(1);
    } finally { unregister(); button.remove(); link.remove(); }
  });
  it('单一 keydown 监听 + 映射表：注册的键触发，未注册的不触发', () => {
    installKeyboardShortcuts();
    const calls: string[] = [];
    registerShortcut({ key: 'j' }, () => calls.push('j'));
    registerShortcut({ key: '1' }, () => calls.push('1'));
    keydown('j');
    keydown('z');
    keydown('1');
    expect(calls).toEqual(['j', '1']);
  });

  it('输入框聚焦或 isComposing 时只放行 Esc（中文输入法安全）', () => {
    installKeyboardShortcuts();
    const calls: string[] = [];
    registerShortcut({ key: 'j' }, () => calls.push('j'));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(calls).toEqual([]);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(calls).toEqual([]);
    input.remove();
    keydown('j');
    expect(calls).toEqual(['j']);
  });

  it('Esc 按浮层层级出栈关闭（D2）：只关栈顶', () => {
    installKeyboardShortcuts();
    const closed: string[] = [];
    const popFirst = pushOverlay(() => closed.push('first'));
    const popSecond = pushOverlay(() => closed.push('second'));
    keydown('Escape');
    expect(closed).toEqual(['second']);
    keydown('Escape');
    expect(closed).toEqual(['second', 'first']);
    expect(overlayCount()).toBe(0);
    popFirst();
    popSecond();
  });
});
