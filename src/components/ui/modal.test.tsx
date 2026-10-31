import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installKeyboardShortcuts } from '../../keyboard.js';
import { Drawer, Modal } from './Modal.js';

const roots: Root[] = [];
afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.replaceChildren();
});

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

function SearchDialog(): React.JSX.Element {
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return <>
    <button onClick={() => setOpen(true)}>Open search</button>
    {open && <Modal title="Search" onClose={() => setOpen(false)} initialFocusRef={search}>
      <input ref={search} aria-label="Search records" />
      <button onClick={() => setCount(count + 1)}>Update {count}</button>
    </Modal>}
  </>;
}

describe('WB-001 / REQ-009 dialog focus ownership', () => {
  it('keeps optional Drawer width controlled and viewport-clamped without changing other drawers', () => {
    const container = render(<><Drawer title="Default drawer" open onClose={() => undefined}>Default</Drawer>
      <Drawer title="Capture drawer" open width={720} onClose={() => undefined}>Capture</Drawer></>);
    expect((container.querySelector('[aria-label="Default drawer"]') as HTMLElement).style.width).toBe('');
    expect((container.querySelector('[aria-label="Capture drawer"]') as HTMLElement).style.width).toBe('min(720px, 96vw)');
  });
  it('focuses the explicitly requested search input and restores the trigger on close', () => {
    const container = render(<SearchDialog />);
    const trigger = container.querySelector('button')!;
    act(() => { trigger.focus(); trigger.click(); });
    expect(document.activeElement).toBe(container.querySelector('input'));
    act(() => (container.querySelector('[aria-label="关闭"]') as HTMLButtonElement).click());
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focused controls when the parent rerenders with a new close callback', () => {
    const container = render(<SearchDialog />);
    act(() => container.querySelector('button')!.click());
    const update = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Update 0')!;
    act(() => { update.focus(); update.click(); });
    expect(update.textContent).toBe('Update 1');
    expect(document.activeElement).toBe(update);
  });

  it('keeps the safe first-control default when no initial target is requested', () => {
    const container = render(<Modal title="Delete?" onClose={() => undefined}>
      <button>Confirm deletion</button>
    </Modal>);
    expect(document.activeElement).toBe(container.querySelector('button'));
    expect(document.activeElement?.textContent).not.toBe('Confirm deletion');
  });

  it('cycles Tab and Shift+Tab within the dialog', () => {
    const container = render(<SearchDialog />);
    act(() => container.querySelector('button')!.click());
    const input = container.querySelector('input')!;
    const close = container.querySelector('[aria-label="关闭"]')!;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
    act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe('Update 0');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
  });

  it('lets the global overlay stack close only once for Escape', () => {
    installKeyboardShortcuts();
    const close = vi.fn();
    render(<Modal title="Top dialog" onClose={close}><button>Action</button></Modal>);
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps nested dialog Tab navigation in the top overlay and returns to its opener', () => {
    function Nested(): React.JSX.Element {
      const [nested, setNested] = useState(false);
      return <Modal title="Parent" onClose={() => undefined}>
        <button onClick={() => setNested(true)}>Open child</button>
        {nested && <Modal title="Child" onClose={() => setNested(false)}><button>Child action</button></Modal>}
      </Modal>;
    }
    const container = render(<Nested />);
    const opener = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Open child')!;
    act(() => { opener.focus(); opener.click(); });
    const child = container.querySelector('[aria-label="Child"]')!;
    const close = child.querySelector('button')!;
    expect(document.activeElement).toBe(close);
    act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe('Child action');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
    act(() => close.click());
    expect(document.activeElement).toBe(opener);
    expect(container.querySelector('[aria-label="Child"]')).toBeNull();
  });
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
