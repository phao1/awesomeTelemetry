import { ta } from '../../i18n.js';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { pushOverlay } from '../../keyboard.js';

export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** REQ-005：Tooltip。纯 CSS 定位 + 400ms 延迟（不引库）。 */
export function Tooltip({
  label,
  placement = 'bottom',
  children,
}: {
  label: string;
  placement?: Placement;
  children: ReactNode;
}): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(`tooltip-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const show = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setVisible(true), 400);
  };
  const hide = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setVisible(false);
  };

  return (
    <span
      className="ui-overlay-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <span
        className={`ui-tooltip ui-tooltip-${placement} ${visible ? 'ui-tooltip-visible' : ''}`}
        role="tooltip"
        id={idRef.current}
      >
        {label}
      </span>
    </span>
  );
}

function useOutsideClose(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent): void => {
      const el = anchorRef.current;
      if (el !== null && !el.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, open, onClose]);
}

export interface PopoverProps {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  placement?: Placement;
  style?: CSSProperties;
}

/**
 * REQ-005：Popover。Esc 关闭、点外关闭、焦点回归触发元素（REQ-009）。
 */
export function Popover({
  trigger,
  open,
  onOpenChange,
  children,
  style,
}: PopoverProps): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  useOutsideClose(anchorRef, open, () => onOpenChange(false));
  useEffect(() => (open ? pushOverlay(() => onOpenChange(false)) : undefined), [open, onOpenChange]);
  // REQ-009：关闭后焦点回归触发元素
  useEffect(() => {
    if (open) {
      lastTriggerRef.current =
        anchorRef.current?.querySelector<HTMLElement>('button, input, a[href]') ?? null;
    } else if (lastTriggerRef.current !== null) {
      lastTriggerRef.current.focus();
    }
  }, [open]);

  return (
    <div className="ui-overlay-anchor" ref={anchorRef}>
      {trigger({
        onClick: () => onOpenChange(!open),
        'aria-expanded': open,
      })}
      {open && (
        <div className="ui-popover" style={style} role="dialog" aria-label={ta('a11y.popover')}>
          {children}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  id: string;
  label: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  items: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** REQ-005：DropdownMenu。role="menu"，选中即关闭；Esc/点外关闭。 */
export function DropdownMenu({
  trigger,
  items,
  open,
  onOpenChange,
}: DropdownMenuProps): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  useOutsideClose(anchorRef, open, () => onOpenChange(false));
  useEffect(() => (open ? pushOverlay(() => onOpenChange(false)) : undefined), [open, onOpenChange]);
  useEffect(() => {
    if (open) {
      lastTriggerRef.current =
        anchorRef.current?.querySelector<HTMLElement>('button, input, a[href]') ?? null;
    } else if (lastTriggerRef.current !== null) {
      lastTriggerRef.current.focus();
    }
  }, [open]);

  return (
    <div className="ui-overlay-anchor" ref={anchorRef}>
      {trigger({
        onClick: () => onOpenChange(!open),
        'aria-expanded': open,
      })}
      {open && (
        <ul className="ui-menu" role="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="ui-menu-item"
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.();
                  onOpenChange(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
