import { ta } from '../../i18n.js';
import { useEffect, type ReactNode } from 'react';

import { IconClose } from '../icons/index.js';
import { Button } from './Button.js';

export interface SkeletonProps {
  variant?: 'text' | 'row' | 'block';
  count?: number;
}

/** REQ-006：loading 态骨架。行骨架高度 = 真实行高（--row-lg，CLS=0）。 */
export function Skeleton({ variant = 'text', count = 1 }: SkeletonProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ta('a11y.loading')}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`ui-skeleton ui-skeleton-${variant}`} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** REQ-006：empty 态 —— 图标 + 一句原因 + 可执行的下一步。 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="ui-empty">
      <span style={{ color: 'var(--fg-muted)' }}>{icon}</span>
      <div className="ui-empty-title">{title}</div>
      {description !== undefined && <div className="ui-empty-description">{description}</div>}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  code: string;
  message: string;
  onRetry?: () => void;
}

/** REQ-006：error 态 —— 错误码 + 文案 + 重试按钮；MUST NOT 静默吞错。 */
export function ErrorState({ code, message, onRetry }: ErrorStateProps): React.JSX.Element {
  return (
    <div className="ui-error" role="alert">
      <span className="ui-error-code">{code}</span>
      <div className="ui-error-message">{message}</div>
      {onRetry !== undefined && (
        <Button variant="default" size="sm" onClick={onRetry}>
          retry
        </Button>
      )}
    </div>
  );
}

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastProps {
  tone?: ToastTone;
  title: string;
  message?: string;
  onDismiss: () => void;
  /** REQ-007：自动消失 4s */
  autoDismissMs?: number;
}

/** REQ-007：Toast。4s 自动消失，可堆叠（容器 .ui-toast-stack）。 */
export function Toast({
  tone = 'info',
  title,
  message,
  onDismiss,
  autoDismissMs = 4000,
}: ToastProps): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  return (
    <div className={`ui-toast ui-toast-${tone}`} role="status" aria-live="polite">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 'var(--weight-medium)' }}>{title}</div>
        {message !== undefined && <div style={{ color: 'var(--fg-muted)' }}>{message}</div>}
      </div>
      <button type="button" className="ui-icon-btn ui-btn-sm" aria-label={ta('a11y.dismiss')} onClick={onDismiss}>
        <IconClose size={12} />
      </button>
    </div>
  );
}
