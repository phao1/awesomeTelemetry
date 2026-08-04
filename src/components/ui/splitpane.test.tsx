import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { SplitPane } from './SplitPane.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  const split = container.querySelector('.ui-split') as HTMLElement;
  Object.defineProperty(split, 'clientWidth', { value: 1000, configurable: true });
  return container;
}

describe('REQ-005 SplitPane', () => {
  it('拖拽更新主窗格尺寸并持久化到 localStorage', () => {
    const storageKey = 'test.split.width';
    const container = render(
      <SplitPane
        initialSize={300}
        min={100}
        max={800}
        storageKey={storageKey}
        first={<div>a</div>}
        second={<div>b</div>}
      />,
    );
    const handle = container.querySelector('.ui-split-handle') as HTMLDivElement;
    const pane = container.querySelector('.ui-split-pane') as HTMLElement;
    expect(handle).not.toBeNull();

    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300 }));
    });
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 }));
      document.dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(Number(localStorage.getItem(storageKey))).toBe(500);
    expect(pane.style.flexBasis).toBe('500px');
  });
});
