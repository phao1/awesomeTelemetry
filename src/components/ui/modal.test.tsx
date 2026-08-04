import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { Modal } from './Modal.js';

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  act(() => {
    root.render(node);
  });
  return container;
}

afterEach(() => {
  while (roots.length > 0) {
    const entry = roots.pop()!;
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe('REQ-005 Modal', () => {
  it('role=dialog + aria-modal，Esc 关闭', () => {
    let closed = false;
    const container = render(
      <Modal title="标题" onClose={() => {
        closed = true;
      }}>
        <button type="button">inside</button>
      </Modal>,
    );
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('标题');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it('焦点陷阱：打开后焦点进入弹窗，Tab 在内部循环', () => {
    const container = render(
      <Modal title="标题" onClose={() => undefined}>
        <button type="button">inside</button>
      </Modal>,
    );
    const dialog = container.querySelector('[role="dialog"]')!;
    const buttons = Array.from(dialog.querySelectorAll('button'));
    expect(buttons).toHaveLength(2); // close + inside
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[1]);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[0]); // 循环回第一个
  });
});
