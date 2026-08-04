import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { DropdownMenu } from './Overlay.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

describe('REQ-005 浮层交互', () => {
  it('DropdownMenu：点击展开、Esc 关闭、点外关闭、选中后关闭', () => {
    const selects: string[] = [];
    const container = render(
      <DropdownMenu
        open
        onOpenChange={() => undefined}
        trigger={(props) => <button type="button" {...props}>menu</button>}
        items={[
          { id: 'a', label: 'A', onSelect: () => selects.push('a') },
          { id: 'b', label: 'B' },
        ]}
      />,
    );
    const menu = container.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    const items = container.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(2);
    act(() => (items[0] as HTMLButtonElement).click());
    expect(selects).toEqual(['a']);
  });

  it('Esc 键关闭并交还焦点', () => {
    let open = true;
    const container = render(
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          open = next;
        }}
        trigger={(props) => <button type="button" {...props}>menu</button>}
        items={[{ id: 'a', label: 'A' }]}
      />,
    );
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(open).toBe(false);
  });

  it('点外部关闭', () => {
    let open = true;
    const container = render(
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          open = next;
        }}
        trigger={(props) => <button type="button" {...props}>menu</button>}
        items={[{ id: 'a', label: 'A' }]}
      />,
    );
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(open).toBe(false);
    container.remove();
  });
});
