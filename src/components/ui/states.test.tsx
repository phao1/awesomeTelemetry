import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toast } from './States.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('REQ-007 Toast', () => {
  it('4s 自动消失', () => {
    vi.useFakeTimers();
    let dismissed = false;
    const container = render(
      <Toast
        title="已保存"
        onDismiss={() => {
          dismissed = true;
        }}
      />,
    );
    expect(container.querySelector('.ui-toast')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(dismissed).toBe(true);
  });
});
