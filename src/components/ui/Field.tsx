import { useId, isValidElement, cloneElement, type ReactNode } from 'react';

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}

/** REQ-005：Field —— 统一表单行（label / hint / error）。 */
export function Field({ label, hint, error, children, htmlFor }: FieldProps): React.JSX.Element {
  const generated=useId(), id=htmlFor??generated;
  const hasError=error!==undefined&&error!==null&&error!=='';
  const described=[hasError?`${id}-error`:'',hint?`${id}-hint`:''].filter(Boolean).join(' ')||undefined;
  const control=isValidElement<{id?:string;'aria-describedby'?:string;'aria-invalid'?:boolean}>(children)?cloneElement(children,{id:children.props.id??id,'aria-describedby':[children.props['aria-describedby'],described].filter(Boolean).join(' ')||undefined,'aria-invalid':hasError||undefined}):children;
  return (
    <div className="ui-field">
      {label !== undefined && (
        <label className="ui-field-label" htmlFor={id}>
          {label}
        </label>
      )}
      {control}
      {error !== undefined && error !== null && error !== '' && (
        <span id={`${id}-error`} className="ui-field-error" role="alert">
          {error}
        </span>
      )}
      {hint !== undefined && hint !== '' && <span id={`${id}-hint`} className="ui-field-hint">{hint}</span>}
    </div>
  );
}
