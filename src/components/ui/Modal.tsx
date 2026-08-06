import { ta } from '../../i18n.js';
import { useEffect, useRef, type ReactNode } from 'react';

import { IconClose } from '../icons/index.js';
import { useFocusTrap } from './focus-trap.js';
import { pushOverlay } from '../../keyboard.js';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
}

/** REQ-005：Modal。焦点陷阱 + Esc 关闭 + role="dialog" aria-modal（REQ-009）。 */
export function Modal({
  title,
  onClose,
  children,
  size = 'md',
  footer,
}: ModalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, true, onClose);
  useEffect(() => pushOverlay(onClose), [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        className={`modal ui-modal ui-modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{title}</h2>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={ta('a11y.close')}
            onClick={onClose}
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer !== undefined && (
          <div
            className="modal-header"
            style={{ borderBottom: 'none', borderTop: '1px solid var(--border-default)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  open: boolean;
  footer?: ReactNode;
  className?: string;
}

/** REQ-005：Drawer。右侧滑入（transform 过渡，reduced-motion 归零）。 */
export function Drawer({ title, onClose, children, open, footer, className }: DrawerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, open, onClose);
  useEffect(() => (open ? pushOverlay(onClose) : undefined), [open, onClose]);

  if (!open) {
    return <div className="ui-drawer" aria-hidden="true" />;
  }
  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose} />
      <div
        ref={containerRef}
        className={`ui-drawer ui-drawer-open ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="ui-drawer-header">
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{title}</h2>
          <button type="button" className="ui-icon-btn" aria-label={ta('a11y.close')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="ui-drawer-body">{children}</div>
        {footer !== undefined && (
          <div className="ui-drawer-header" style={{ borderTop: '1px solid var(--border-default)' }}>
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
