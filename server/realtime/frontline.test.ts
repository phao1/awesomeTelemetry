import { afterEach, describe, expect, it, vi } from 'vitest';

import { isForegroundBusy, markForegroundRequest } from './frontline.js';

describe('REQ-007 前台请求标记', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('标记后 750ms 内 busy，之后空闲', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    expect(isForegroundBusy()).toBe(false);
    markForegroundRequest();
    expect(isForegroundBusy()).toBe(true);
    vi.advanceTimersByTime(750);
    expect(isForegroundBusy()).toBe(false);
  });

  it('不断有请求时持续 busy', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    markForegroundRequest();
    vi.advanceTimersByTime(700);
    markForegroundRequest();
    expect(isForegroundBusy()).toBe(true);
    vi.advanceTimersByTime(700);
    markForegroundRequest();
    expect(isForegroundBusy()).toBe(true);
  });
});
