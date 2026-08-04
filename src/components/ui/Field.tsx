import type { ReactNode } from 'react';

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}

/** REQ-005：Field —— 统一表单行（label / hint / error）。 */
export function Field({ label, hint, error, children, htmlFor }: FieldProps): React.JSX.Element {
  return (
    <div className="ui-field">
      {label !== undefined && (
        <label className="ui-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error !== undefined && error !== null && error !== '' && (
        <span className="ui-field-error" role="alert">
          {error}
        </span>
      )}
      {hint !== undefined && hint !== '' && <span className="ui-field-hint">{hint}</span>}
    </div>
  );
}
