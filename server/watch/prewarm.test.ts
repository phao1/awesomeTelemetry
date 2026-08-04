import { describe, expect, it } from 'vitest';

import { backgroundPrewarm } from './prewarm.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('REQ-014 预热让路', () => {
  it('REQ-014 前台空闲时顺序预热全部会话，每个会话之间让出事件循环', async () => {
    const order: string[] = [];
    const warmed = await backgroundPrewarm({
      sessions: ['a', 'b', 'c'],
      isForegroundBusy: () => false,
      loadSession: async (key) => {
        order.push(key);
        await sleep(1);
      },
    });

    expect(warmed).toBe(3);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('REQ-014 前台忙时循环等待 250ms，直到空闲才继续', async () => {
    let busyCalls = 0;
    const order: string[] = [];
    const warmed = await backgroundPrewarm({
      sessions: ['a', 'b'],
      isForegroundBusy: () => {
        busyCalls += 1;
        return busyCalls <= 3; // 前三次调用（a 前）返回忙
      },
      loadSession: async (key) => {
        order.push(key);
      },
    });

    expect(warmed).toBe(2);
    expect(order).toEqual(['a', 'b']);
    // a 之前至少轮询了 3 次（忙 2 次 + 空闲 1 次），实际等待 ≥ 500ms
    expect(busyCalls).toBeGreaterThanOrEqual(3);
  });

  it('REQ-014 空列表直接返回 0', async () => {
    const warmed = await backgroundPrewarm({
      sessions: [],
      isForegroundBusy: () => false,
      loadSession: async () => {},
    });
    expect(warmed).toBe(0);
  });
});
