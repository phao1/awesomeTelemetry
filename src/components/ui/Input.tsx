import { useState, type InputHTMLAttributes, type RefObject, type SelectHTMLAttributes } from 'react';

import { IconClose, IconSearch } from '../icons/index.js';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md';
  icon?: React.JSX.Element;
}

/** REQ-005：Input。与 Button 等高（--control-height-*）。 */
export function Input({ size = 'md', icon, className, ...rest }: InputProps): React.JSX.Element {
  const classes = [
    'ui-input',
    size === 'sm' ? 'ui-btn-sm' : 'ui-btn-md',
    icon !== undefined ? 'ui-input-with-icon' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  if (icon === undefined) {
    return <input className={classes} {...rest} />;
  }
  return (
    <span className="ui-input-wrap">
      <span className="ui-input-icon">{icon}</span>
      <input className={classes} {...rest} />
    </span>
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md';
  options: Array<{ value: string; label: string }>;
}

/** REQ-005：Select。 */
export function Select({ size = 'md', options, className, ...rest }: SelectProps): React.JSX.Element {
  const classes = [
    'ui-select',
    size === 'sm' ? 'ui-btn-sm' : 'ui-btn-md',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <select className={classes} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 本地化占位符 */
  placeholder?: string;
  /** REQ-005：内置 IconSearch + 清除按钮 + `/` 聚焦 */
  clearable?: boolean;
  /** 转发 ref（REQ-008：全局快捷键 `/` 聚焦由 App 的单一监听器完成） */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * REQ-005：SearchInput。按 `/` 聚焦当前搜索框（输入框聚焦时除外，
 * 见 REQ-008 冲突规则）。清除按钮就地清空并保持焦点。
 */
export function SearchInput({
  placeholder,
  clearable = true,
  value,
  defaultValue,
  onChange,
  onKeyDown,
  inputRef,
  ...rest
}: SearchInputProps): React.JSX.Element {
  const [internalValue, setInternalValue] = useState(() => String(defaultValue ?? ''));

  const controlled = value !== undefined;
  const current = controlled ? String(value ?? '') : internalValue;
  const commit = (next: string): void => {
    if (!controlled) {
      setInternalValue(next);
    }
    onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <span className="ui-input-wrap">
      <span className="ui-input-icon">
        <IconSearch size={12} />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="ui-input ui-input-with-icon ui-btn-md"
        placeholder={placeholder}
        value={current}
        onChange={(event) => commit(event.target.value)}
        onKeyDown={onKeyDown}
        {...rest}
      />
      {clearable && current !== '' && (
        <span className="ui-input-clear">
          <button
            type="button"
            className="ui-icon-btn ui-btn-sm"
            aria-label="clear search"
            onClick={() => {
              commit('');
              inputRef?.current?.focus();
            }}
          >
            <IconClose size={12} />
          </button>
        </span>
      )}
    </span>
  );
}
