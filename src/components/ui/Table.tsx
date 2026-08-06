import { ta } from '../../i18n.js';
import type { ReactNode } from 'react';

import { IconChevronDown, IconChevronRight } from '../icons/index.js';

export interface TableColumn<T> {
  key: string;
  label: ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: T[];
  density?: 'compact' | 'default';
  rowKey: (row: T) => string;
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  onSort?: (key: string) => void;
  className?: string;
  /** REQ-018：行展开（复用共享 store，G11.9 禁逐行 fetch）。 */
  expandedKey?: string | null;
  onToggleExpand?: (key: string) => void;
  renderExpand?: (row: T) => ReactNode;
}

/** REQ-005：Table。compact 密度、sticky 表头、可排序。 */
export function Table<T>({
  columns,
  rows,
  density = 'compact',
  rowKey,
  sort,
  onSort,
  className,
  expandedKey,
  onToggleExpand,
  renderExpand,
}: TableProps<T>): React.JSX.Element {
  const classes = ['ui-table', `ui-table-${density}`, className ?? ''].filter(Boolean).join(' ');
  const expandable = renderExpand !== undefined && onToggleExpand !== undefined;
  return (
    <table className={classes}>
      <thead>
        <tr>
          {expandable && <th style={{ width: 'var(--space-4)' }} aria-label={ta('a11y.expandRow')} />}
          {columns.map((column) => {
            const active = sort?.key === column.key;
            const label = (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                }}
              >
                {column.label}
                {column.sortable && (active ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />)}
              </span>
            );
            return (
              <th
                key={column.key}
                style={{
                  textAlign: column.align ?? 'left',
                  width: column.width,
                }}
              >
                {column.sortable && onSort !== undefined ? (
                  <button
                    type="button"
                    className="ui-table-sort"
                    onClick={() => onSort(column.key)}
                    aria-sort={
                      active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {label}
                  </button>
                ) : (
                  label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      {rows.map((row) => (
        <tbody key={rowKey(row)}>
          <tr>
            {expandable && (
              <td style={{ textAlign: 'left' }}>
                <button
                  type="button"
                  className="ui-table-sort"
                  aria-label={ta('a11y.expandRow')}
                  aria-expanded={expandedKey === rowKey(row)}
                  onClick={() => onToggleExpand!(rowKey(row))}
                >
                  {expandedKey === rowKey(row) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                </button>
              </td>
            )}
            {columns.map((column) => (
              <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                {column.render(row)}
              </td>
            ))}
          </tr>
          {expandable && expandedKey === rowKey(row) && renderExpand!(row)}
        </tbody>
      ))}
    </table>
  );
}
