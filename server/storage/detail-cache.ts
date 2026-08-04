import type { SessionDetailResponse } from '../../src/core/trace-types.js';

/** REQ-006 / API §1.2：详情 LRU 缓存。容量 24 条。 */
export class DetailCache {
  private readonly entries = new Map<string, SessionDetailResponse>();
  private readonly maxEntries: number;

  constructor(maxEntries = 24) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): SessionDetailResponse | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    // 刷新最近使用
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: SessionDetailResponse): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
