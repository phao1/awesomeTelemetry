import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY, useTheme } from '../theme.js';
import { ThemeToggle } from './ThemeToggle.js';

const containers: HTMLDivElement[] = [];
let matchMediaListeners: Array<(event: { matches: boolean }) => void> = [];
let darkMatches = true;
let lightMatches = false;

/** jsdom 无 matchMedia：补最小桩（不 mock 被测逻辑，只提供 DOM 能力）。 */
function stubMatchMedia(): void {
  matchMediaListeners = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? darkMatches : lightMatches,
      media: query,
      addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      },
      removeEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
        matchMediaListeners = matchMediaListeners.filter((fn) => fn !== cb);
      },
    }),
  });
}

function mountHarness(): { button: HTMLButtonElement; getEffective: () => string | null } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  function Harness(): React.JSX.Element {
    const theme = useTheme();
    return (
      <div>
        <span data-testid="effective">{theme.effective}</span>
        <ThemeToggle theme={theme.theme} effective={theme.effective} onCycle={theme.cycle} />
      </div>
    );
  }
  act(() => {
    root.render(<Harness />);
  });
  return {
    button: container.querySelector('button') as HTMLButtonElement,
    getEffective: () =>
      container.querySelector('[data-testid="effective"]')?.textContent ?? null,
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    container?.remove();
  }
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

beforeEach(() => {
  darkMatches = true;
  lightMatches = false;
  stubMatchMedia();
});

describe('REQ-003 主题三态切换', () => {
  it('循环 system → dark → light → system，改 data-theme 且持久化 localStorage', () => {
    const { button, getEffective } = mountHarness();
    expect(getEffective()).toBe('dark'); // system + 系统偏好 dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => button.click()); // system → dark
    expect(getEffective()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => button.click()); // dark → light
    expect(getEffective()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => button.click()); // light → system
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark'); // 跟随系统
  });

  it('system 模式下 matchMedia change 实时跟随，不触发重载', () => {
    mountHarness();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    act(() => {
      darkMatches = false;
      lightMatches = true;
      for (const cb of [...matchMediaListeners]) {
        cb({ matches: true });
      }
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('显式选择 dark/light 后不跟随系统变化', () => {
    const { button } = mountHarness();
    act(() => button.click()); // system → dark
    act(() => button.click()); // dark → light
    act(() => {
      darkMatches = true;
      lightMatches = false;
      for (const cb of [...matchMediaListeners]) {
        cb({ matches: false });
      }
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
