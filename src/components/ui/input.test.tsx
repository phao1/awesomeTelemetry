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
  it('按 / 聚焦搜索框（输入框聚焦时除外）', () => {
    const container = render(<SearchInput placeholder="搜索" />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    expect(document.activeElement).toBe(input);
  });

  it('清除按钮清空并保持焦点', () => {
    const container = render(<SearchInput defaultValue="abc" />);
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // 直接触发受控/非受控值变化：模拟输入
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'abc');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    const clear = container.querySelector('.ui-input-clear button') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    act(() => clear.click());
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });
});
