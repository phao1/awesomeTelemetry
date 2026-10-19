import { useEffect, useRef, type RefObject } from 'react';

const activeTraps: HTMLElement[] = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * REQ-009：浮层焦点陷阱。打开时聚焦指定目标（默认首个安全控件），
 * Tab/Shift+Tab 在容器内循环；Esc 交还调用方关闭。
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape: () => void,
  restoreFocusRef?: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);
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
    const list = focusables();
    const requested = initialFocusRef?.current;
    const initial = requested != null && list.includes(requested) ? requested : list[0];
    activeTraps.push(container);
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || activeTraps.at(-1) !== container) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        escapeRef.current();
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
      const index = activeTraps.lastIndexOf(container);
      if (index >= 0) activeTraps.splice(index, 1);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, open, restoreFocusRef, initialFocusRef]);
}
