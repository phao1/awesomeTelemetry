import { useUiLocale } from './Locale.js';
import type { TableHTMLAttributes } from 'react';
import { Card } from './Display.js';
/** Compound table for evidence matrices whose columns are built by their caller. */
export function MarkupTable({ children, className = '', ...props }: TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  const zh=useUiLocale()==='zh';
  return <Card><div className="ui-table-wrap" tabIndex={0} role="region" aria-label={props['aria-label'] ?? (zh?'表格':'Table')}><table {...props} className={`ui-table num ${className}`}>{children}</table></div></Card>;
}
