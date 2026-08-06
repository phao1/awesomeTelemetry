import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      root.unmount();
    },
    html: () => container.innerHTML,
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function Throws(): React.JSX.Element {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('子组件抛错时降级显示标签与错误信息，不向全局冒泡', () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    const { html, unmount } = mount(
      <ErrorBoundary label="关键指标">
        <Throws />
      </ErrorBoundary>,
    );
    expect(html()).toContain('关键指标');
    expect(html()).toContain('boom');
    unmount();
    console.error = original;
    expect(errors.length).toBeGreaterThan(0); // componentDidCatch 记录了错误
  });

  it('正常子组件直接渲染', () => {
    const { html, unmount } = mount(
      <ErrorBoundary label="图表">
        <span>ok</span>
      </ErrorBoundary>,
    );
    expect(html()).toContain('ok');
    expect(html()).not.toContain('ui-error-boundary');
    unmount();
  });
});
