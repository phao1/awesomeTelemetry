import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from './event-bus.js';
import {
  clearPendingSessionChanges,
  queueProxyStreamChunk,
  queueSessionChange,
} from './coalescer.js';

describe('REQ-003 会话变更合并', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    clearPendingSessionChanges();
    vi.useRealTimers();
  });

  it('524 次 queueSessionChange 在 200ms 窗口内 → 只发 1 条（≤10）', async () => {
    const events: Array<{ keys: string[]; count: number }> = [];
    const unsub = eventBus.on('sessions_changed', (p) => events.push(p));
    for (let i = 0; i < 524; i += 1) {
      queueSessionChange(`k${i}`);
    }
    await vi.advanceTimersByTimeAsync(200);

    expect(events.length).toBeLessThanOrEqual(10);
    expect(events).toHaveLength(1);
    expect(events[0]?.count).toBe(524);
    expect(events[0]?.keys).toHaveLength(524);
    expect(new Set(events[0]?.keys).size).toBe(524);
    unsub();
  });

  it('200ms 窗口内新 key 累积到同一条', async () => {
    const events: Array<{ keys: string[]; count: number }> = [];
    const unsub = eventBus.on('sessions_changed', (p) => events.push(p));
    queueSessionChange('k1');
    queueSessionChange('k2');
    await vi.advanceTimersByTimeAsync(100);
    queueSessionChange('k3');
    await vi.advanceTimersByTimeAsync(100);

    expect(events).toHaveLength(1);
    expect(events[0]?.keys.sort()).toEqual(['k1', 'k2', 'k3']);
    unsub();
  });

  it('窗口结束后新一批产生新事件', async () => {
    const events: Array<{ keys: string[]; count: number }> = [];
    const unsub = eventBus.on('sessions_changed', (p) => events.push(p));
    queueSessionChange('k1');
    await vi.advanceTimersByTimeAsync(200);
    queueSessionChange('k2');
    await vi.advanceTimersByTimeAsync(200);

    expect(events).toHaveLength(2);
    expect(events[0]?.keys).toEqual(['k1']);
    expect(events[1]?.keys).toEqual(['k2']);
    unsub();
  });
});

describe('REQ-004 流式 chunk 服务端节流', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    clearPendingSessionChanges();
    vi.useRealTimers();
  });

  it('同一 requestId 按 100ms 窗口拼接后发一条', async () => {
    const chunks: Array<{ requestId: string; chunk: string }> = [];
    const unsub = eventBus.on('proxy_stream_chunk', (p) => chunks.push(p));
    queueProxyStreamChunk('r1', 'a');
    queueProxyStreamChunk('r1', 'b');
    queueProxyStreamChunk('r1', 'c');
    queueProxyStreamChunk('r2', 'x');
    await vi.advanceTimersByTimeAsync(100);

    expect(chunks).toHaveLength(2);
    expect(chunks.find((c) => c.requestId === 'r1')?.chunk).toBe('abc');
    expect(chunks.find((c) => c.requestId === 'r2')?.chunk).toBe('x');
    unsub();
  });

  it('100ms 窗口之后的新 chunk 产生新事件', async () => {
    const chunks: Array<{ requestId: string; chunk: string }> = [];
    const unsub = eventBus.on('proxy_stream_chunk', (p) => chunks.push(p));
    queueProxyStreamChunk('r1', 'a');
    await vi.advanceTimersByTimeAsync(100);
    queueProxyStreamChunk('r1', 'b');
    await vi.advanceTimersByTimeAsync(100);
    expect(chunks.map((c) => c.chunk)).toEqual(['a', 'b']);
    unsub();
  });
});
