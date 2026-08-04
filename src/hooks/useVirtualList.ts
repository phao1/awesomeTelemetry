import { useEffect, useRef, useState, type RefObject, type UIEvent } from 'react';

export interface VirtualRange {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetY: number;
}

/** REQ-006：窗口化渲染范围（视口 ± overscan 行）。 */
export function computeVirtualRange(
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  rowHeight: number,
  overscan = 10,
): VirtualRange {
  if (itemCount === 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: 0, totalHeight: 0, offsetY: 0 };
  }
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  return {
    startIndex,
    endIndex,
    totalHeight: itemCount * rowHeight,
    offsetY: startIndex * rowHeight,
  };
}

export interface UseVirtualListResult {
  containerRef: RefObject<HTMLDivElement | null>;
  range: VirtualRange;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

/** REQ-006：虚拟滚动 hook。jsdom 无布局时使用默认视口高度 600。 */
export function useVirtualList(
  itemCount: number,
  rowHeight: number,
  overscan = 10,
  fallbackViewportHeight = 600,
): UseVirtualListResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(fallbackViewportHeight);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    const measure = (): void => {
      const height = el.clientHeight;
      if (height > 0) {
        setViewportHeight(height);
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return;
  }, []);

  const range = computeVirtualRange(scrollTop, viewportHeight, itemCount, rowHeight, overscan);
  return {
    containerRef,
    range,
    onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
  };
}
