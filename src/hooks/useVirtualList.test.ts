import { describe, expect, it } from 'vitest';

import { computeVirtualRange } from './useVirtualList.js';

describe('REQ-006 computeVirtualRange', () => {
  it('首屏渲染视口 ± overscan 行', () => {
    const range = computeVirtualRange(0, 600, 9590, 24, 10);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(35); // ceil(600/24)+10
    expect(range.totalHeight).toBe(9590 * 24);
    expect(range.offsetY).toBe(0);
  });

  it('滚动后窗口平移且不越界', () => {
    const range = computeVirtualRange(5000, 600, 100, 24, 10);
    expect(range.startIndex).toBeGreaterThanOrEqual(0);
    expect(range.endIndex).toBeLessThanOrEqual(100);
    expect(range.startIndex).toBe(Math.floor(5000 / 24) - 10);
  });

  it('空列表返回空窗口', () => {
    expect(computeVirtualRange(0, 600, 0, 24)).toEqual({ startIndex: 0, endIndex: 0, totalHeight: 0, offsetY: 0 });
  });
});
