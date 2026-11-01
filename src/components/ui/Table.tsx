import { useUiTranslate } from './Locale.js';
import { isValidElement, type ReactNode } from 'react';
import { type Locale } from '../../i18n.js';
import { Tooltip } from './Overlay.js';
import { Checkbox } from './Controls.js';
import { Select } from './Select.js';
import { IconButton } from './Button.js';
import { EmptyState } from './States.js';
import { IconChevronDown, IconChevronRight, IconChevronLeft, IconList } from '../icons/index.js';

export interface TableColumn<T> {
  key: string;
  label: ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
}
/** Zero-based page; rows are the caller-owned current page, never fetched by Table. */
export interface TablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  label?: string;
}
export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: T[];
  density?: 'compact' | 'default';
  rowKey: (row: T) => string;
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  onSort?: (key: string) => void;
  className?: string;
  expandedKey?: string | null;
  expandedKeys?: string[];
  onToggleExpand?: (key: string) => void;
  /** Compatibility: returns complete tr elements with their own cells/colSpan. */
  renderExpand?: (row: T) => ReactNode;
  /** Preferred content-only API; Table supplies the indented full-width child row. */
  renderSubrow?: (row: T) => ReactNode;
  expandLabel?: (row: T) => string;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  onRowClick?: (row: T) => void;
  rowTone?: (row: T) => 'danger' | 'attention' | undefined;
  rowActions?: (row: T) => ReactNode;
  bulkActions?: ReactNode;
  pagination?: ReactNode | TablePagination;
  stickyFirst?: boolean;
  loading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  locale?: Locale;
  label?: string;
  /** Bounded vertical viewport keeps table headers sticky within the card. */
  maxHeight?: string;
}
function isPagination(value: TableProps<unknown>['pagination']): value is TablePagination {
  return !!value && typeof value === 'object' && !isValidElement(value) && 'page' in value;
}
function Pagination({ value, locale, disabled }: { value: TablePagination; locale: Locale; disabled: boolean }): React.JSX.Element {
  const { page, pageSize, total } = value, zh = locale === 'zh';
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  const sizes = [...new Set([...(value.pageSizes ?? [10, 25, 50, 100]), pageSize])].sort((a, b) => a - b);
  return <>
    <span>{value.label ?? (zh ? `共 ${total.toLocaleString()} 项` : `${total.toLocaleString()} items`)}</span>
    <div className="ui-pagination-controls num">
      <span>{total ? page * pageSize + 1 : 0}–{Math.min(total, (page + 1) * pageSize)} / {total.toLocaleString()}</span>
      {value.onPageSizeChange && <Select aria-label={zh ? '每页条数' : 'Rows per page'} value={String(pageSize)} disabled={disabled} options={sizes.map(n => ({ value: String(n), label: `${n} / ${zh ? '页' : 'page'}` }))} onChange={e => { value.onPageSizeChange?.(Number(e.target.value)); value.onPageChange(0); }} />}
      <IconButton label={zh ? '上一页' : 'Previous page'} icon={<IconChevronLeft />} disabled={disabled || page <= 0} onClick={() => value.onPageChange(page - 1)} />
      <IconButton label={zh ? '下一页' : 'Next page'} icon={<IconChevronRight />} disabled={disabled || page >= last} onClick={() => value.onPageChange(page + 1)} />
    </div>
  </>;
}
export function Table<T>({ columns, rows, density = 'default', rowKey, sort, onSort, className, expandedKey, expandedKeys, onToggleExpand, renderExpand, renderSubrow, expandLabel, selectedKeys = [], onSelectionChange, onRowClick, rowTone, rowActions, bulkActions, pagination, stickyFirst = false, loading = false, skeletonRows = 6, emptyState, locale = 'zh', label, maxHeight = '65vh' }: TableProps<T>): React.JSX.Element {
  const ta=useUiTranslate(locale);
  const expandable = (renderExpand !== undefined || renderSubrow !== undefined) && (onToggleExpand !== undefined || expandedKey !== undefined || expandedKeys !== undefined);
  const expandControl = expandable && onToggleExpand !== undefined;
  const columnCount = columns.length + Number(!!onSelectionChange) + Number(expandControl) + Number(!!rowActions);
  const pageKeys = rows.map(rowKey), all = pageKeys.length > 0 && pageKeys.every(key => selectedKeys.includes(key));
  const firstOffset = `calc(var(--table-control-width) * ${Number(!!onSelectionChange) + Number(expandControl)})`;
  const utilityStyle = (index: number) => stickyFirst ? { left: `calc(var(--table-control-width) * ${index})` } : undefined;
  const stickyClass = (extra = '') => `${extra} ${stickyFirst ? 'ui-sticky-cell' : ''}`;
  return <div className="ui-data-table">
    {selectedKeys.length > 0 && onSelectionChange && <div className="ui-bulk-actions" role="region" aria-label={locale === 'zh' ? '批量操作' : 'Bulk actions'}><span>{locale === 'zh' ? `已选 ${selectedKeys.length} 项` : `${selectedKeys.length} selected`}</span><div>{bulkActions}<button type="button" className="ui-btn ui-btn-ghost" disabled={loading} onClick={() => onSelectionChange([])}>{locale === 'zh' ? '清除' : 'Clear'}</button></div></div>}
    <div className="ui-table-wrap" style={{maxHeight}} tabIndex={0} role="region" aria-label={label ?? (locale === 'zh' ? '表格，可横向滚动' : 'Table, scroll horizontally')}>
      <table className={`ui-table ui-table-${density} ${className ?? ''}`} aria-busy={loading || undefined} aria-label={label}>
        <thead><tr>
          {onSelectionChange && <th className={stickyClass('ui-table-control')} style={utilityStyle(0)}><Checkbox aria-label={locale === 'zh' ? '全选本页' : 'Select current page'} checked={all} disabled={loading || !rows.length} indeterminate={!all && pageKeys.some(key => selectedKeys.includes(key))} onChange={e => onSelectionChange(e.target.checked ? [...new Set([...selectedKeys, ...pageKeys])] : selectedKeys.filter(key => !pageKeys.includes(key)))} /></th>}
          {expandControl && <th className={stickyClass('ui-table-control')} style={utilityStyle(Number(!!onSelectionChange))} aria-label={ta('a11y.expandRow')} />}
          {columns.map((column, index) => <th key={column.key} className={index === 0 && stickyFirst ? 'ui-sticky-cell' : undefined} aria-sort={column.sortable ? sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none' : undefined} style={{ textAlign: column.align ?? 'left', width: column.width, left: index === 0 && stickyFirst ? firstOffset : undefined }}>
            {column.sortable && onSort ? <button type="button" className="ui-table-sort" disabled={loading} onClick={() => onSort(column.key)}>{column.label}{sort?.key === column.key ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</button> : column.label}
          </th>)}
          {rowActions && <th aria-label={locale === 'zh' ? '操作' : 'Actions'} />}
        </tr></thead>
        {loading ? <tbody><tr className="ui-table-loading"><td colSpan={columnCount}><div role="status" aria-label={locale === 'zh' ? '正在加载表格' : 'Loading table'}>{Array.from({ length: Math.max(1, skeletonRows) }, (_, i) => <div className="ui-table-skeleton-row" key={i} aria-hidden="true">{columns.map(c => <span className="ui-skeleton ui-skeleton-text" key={c.key} />)}</div>)}</div></td></tr></tbody> : !rows.length ? <tbody><tr><td colSpan={columnCount}>{emptyState ?? <EmptyState icon={<IconList />} title={locale === 'zh' ? '暂无数据' : 'No data'} />}</td></tr></tbody> : rows.map(row => {
          const key = rowKey(row), expanded = expandedKeys?.includes(key) ?? expandedKey === key;
          return <tbody key={key}><tr data-table-row="true" aria-selected={onSelectionChange ? selectedKeys.includes(key) : undefined} data-tone={rowTone?.(row)} tabIndex={onRowClick ? 0 : undefined} className={onRowClick ? 'ui-row-clickable' : undefined} onClick={event => { if (!(event.target as HTMLElement).closest('button,input,a,select,textarea,[role=combobox],[contenteditable=true]')) onRowClick?.(row); }} onKeyDown={event => {
            if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); onRowClick?.(row); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = [...event.currentTarget.closest('table')!.querySelectorAll<HTMLTableRowElement>('tr[data-table-row][tabindex]')]; items[items.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus(); }
          }}>
            {onSelectionChange && <td className={stickyClass('ui-table-control')} style={utilityStyle(0)}><Checkbox aria-label={`${locale === 'zh' ? '选择' : 'Select'} ${key}`} checked={selectedKeys.includes(key)} onChange={e => onSelectionChange(e.target.checked ? [...new Set([...selectedKeys, key])] : selectedKeys.filter(k => k !== key))} /></td>}
            {expandControl && <td className={stickyClass('ui-table-control')} style={utilityStyle(Number(!!onSelectionChange))}><button type="button" className="ui-icon-btn ui-btn-ghost ui-btn-sm" aria-label={expandLabel?.(row) ?? ta('a11y.expandRow')} aria-expanded={expanded} onClick={event => { event.stopPropagation(); onToggleExpand?.(key); }}>{expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</button></td>}
            {columns.map((column, index) => { const content = column.render(row); return <td key={column.key} data-column={column.key} className={index === 0 && stickyFirst ? 'ui-sticky-cell' : undefined} style={{ textAlign: column.align ?? 'left', left: index === 0 && stickyFirst ? firstOffset : undefined }}>{typeof content === 'string' || typeof content === 'number' ? <Tooltip label={String(content)}><span className="ui-cell-text">{content}</span></Tooltip> : content}</td>; })}
            {rowActions && <td onClick={e => e.stopPropagation()}><div className="ui-row-actions">{rowActions(row)}</div></td>}
          </tr>{expandable && expanded && (renderSubrow ? <tr className="ui-subrow"><td colSpan={columnCount}><span aria-hidden="true">↳ </span>{renderSubrow(row)}</td></tr> : renderExpand?.(row))}</tbody>;
        })}
      </table>
    </div>
    {pagination && <div className="ui-pagination">{isPagination(pagination) ? <Pagination value={pagination} locale={locale} disabled={loading} /> : pagination}</div>}
  </div>;
}
export { Table as DataTable };
