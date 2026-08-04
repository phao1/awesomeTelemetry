import { useVirtualList } from '../../hooks/useVirtualList.js';

export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
}

/**
 * REQ-005：VirtualList —— 复用既有 useVirtualList 的通用窗口化列表。
 * rowHeight 必须与 CSS 行高 token 一致（G-DS-1：--row-sm/--row-lg 是 itemHeight 输入）。
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  getKey,
  className,
}: VirtualListProps<T>): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(items.length, rowHeight);
  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={onScroll}
      style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
    >
      <div style={{ height: range.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${range.offsetY}px)` }}>
          {items.slice(range.startIndex, range.endIndex).map((item, index) => (
            <div key={getKey(item, range.startIndex + index)} style={{ height: rowHeight }}>
              {renderRow(item, range.startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
