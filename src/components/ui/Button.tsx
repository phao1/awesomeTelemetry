import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'default' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  icon?: React.JSX.Element;
  loading?: boolean;
}

/** REQ-005：Button。default 变体用于常规操作，ghost 用于密排行内。 */
export function Button({
  variant = 'default',
  size = 'md',
  icon,
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps): React.JSX.Element {
  const classes = ['ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** REQ-005：必填 —— 读屏器标签，同时作为 tooltip 文案。 */
  label: string;
  icon: React.JSX.Element;
  size?: 'sm' | 'md';
  variant?: 'default' | 'ghost';
}

/** REQ-005：IconButton。命中区 ≥ 24×24（--space-6），MUST 有 tooltip（title）。 */
export function IconButton({
  label,
  icon,
  size = 'md',
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps): React.JSX.Element {
  const classes = [
    'ui-icon-btn',
    `ui-btn-${variant}`,
    size === 'sm' ? 'ui-btn-sm' : 'ui-btn-md',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}
