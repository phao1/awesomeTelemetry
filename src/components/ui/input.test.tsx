import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { SearchInput } from './Input.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

describe('REQ-005 SearchInput', () => {
  it('清除按钮清空并保持焦点', () => {
    const container = render(<SearchInput defaultValue="abc" />);
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    // D1：SearchInput 自身不再挂 / 监听（全局快捷键管理器负责聚焦）
    expect(document.activeElement).not.toBe(input);
    act(() => input.focus());
    const clear = container.querySelector('.ui-input-clear button') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    act(() => clear.click());
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });
});
