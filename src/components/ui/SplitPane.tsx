import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface SplitPaneProps {
  direction?: 'horizontal' | 'vertical';
  /** 主窗格初始尺寸（px） */
  initialSize: number;
  min?: number;
  max?: number;
  /** localStorage 持久化键；省略则不持久化 */
  storageKey?: string;
  first: ReactNode;
  second: ReactNode;
  firstClassName?: string;
  secondClassName?: string;
}

function loadSize(storageKey: string | undefined, fallback: number): number {
  if (storageKey === undefined) {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch (err) {
    console.error('[split-pane] 读取持久化尺寸失败:', err);
    return fallback;
  }
}

/**
 * REQ-005：SplitPane —— 左右/上下拖拽 + 宽度持久化（手写，不引库）。
 * 拖拽期间只更新状态；结束写入 localStorage。
 */
export function SplitPane({
  direction = 'horizontal',
  initialSize,
  min = 260,
  max = 900,
  storageKey,
  first,
  second,
  firstClassName,
  secondClassName,
}: SplitPaneProps): React.JSX.Element {
  const [size, setSize] = useState(() => loadSize(storageKey, initialSize));
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ pointer: number; size: number } | null>(null);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (event: PointerEvent): void => {
      const start = startRef.current;
      const container = containerRef.current;
      if (start === null || container === null) {
        return;
      }
      const delta = direction === 'horizontal' ? event.clientX - start.pointer : event.clientY - start.pointer;
      const bound = direction === 'horizontal' ? container.clientWidth : container.clientHeight;
      const next = Math.min(max, Math.max(min, start.size + delta));
      // 不超过容器一半，避免把另一侧挤没
      const clamped = Math.min(next, Math.max(min, bound * 0.8));
      sizeRef.current = clamped;
      setSize(clamped);
    };
    const onUp = (): void => {
      setDragging(false);
      startRef.current = null;
      if (storageKey !== undefined) {
        try {
          localStorage.setItem(storageKey, String(sizeRef.current));
        } catch (err) {
          console.error('[split-pane] 持久化尺寸失败:', err);
        }
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [dragging, direction, min, max, storageKey]);

  const sizeRef = useRef(size);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      startRef.current = {
        pointer: direction === 'horizontal' ? event.clientX : event.clientY,
        size: sizeRef.current,
      };
      setDragging(true);
    },
    [direction],
  );

  const handleSize = direction === 'horizontal' ? { width: 'var(--space-1)' } : { height: 'var(--space-1)' };
  return (
    <div
      ref={containerRef}
      className={`ui-split ui-split-${direction}`}
      style={{ height: '100%' }}
    >
      <div className={`ui-split-pane ${firstClassName ?? ''}`} style={{ flexBasis: size, flexShrink: 0, width: direction === 'horizontal' ? size : undefined, height: direction === 'vertical' ? size : undefined }}>
        {first}
      </div>
      <div
        className={`ui-split-handle ${dragging ? 'ui-split-handle-active' : ''}`}
        role="separator"
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        style={handleSize}
      />
      <div className={`ui-split-pane ${secondClassName ?? ''}`} style={{ flex: 1 }}>
        {second}
      </div>
    </div>
  );
}
