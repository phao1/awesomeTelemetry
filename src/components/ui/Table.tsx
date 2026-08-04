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
}: TableProps<T>): React.JSX.Element {
  const classes = ['ui-table', `ui-table-${density}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <table className={classes}>
      <thead>
        <tr>
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
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
