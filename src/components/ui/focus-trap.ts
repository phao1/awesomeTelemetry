import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * REQ-009：浮层焦点陷阱。打开时聚焦容器内首个可聚焦元素，
 * Tab/Shift+Tab 在容器内循环；Esc 交还调用方关闭。
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape: () => void,
  restoreFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const previouslyFocused = restoreFocusRef?.current ?? document.activeElement;
    // jsdom 无布局（offsetParent 恒 null），用显式可见性过滤
    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );
    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      event.preventDefault();
      const list = focusables();
      if (list.length === 0) {
        return;
      }
      const current = document.activeElement;
      const index = list.indexOf(current as HTMLElement);
      if (event.shiftKey) {
        const next = index <= 0 ? list.length - 1 : index - 1;
        list[next]?.focus();
      } else {
        const next = index === -1 || index === list.length - 1 ? 0 : index + 1;
        list[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, open, onEscape, restoreFocusRef]);
}
