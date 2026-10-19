import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from './event-bus.js';
import {
  clearPendingSessionChanges,
  queueProxyStreamChunk,
  queueSessionChange,
  queueTraceLinkChange,
  clearPendingTraceLinkChanges,
  flushProxyStreamChunk,
  queueProxySourceChange,
  clearPendingProxySourceChanges,
} from './coalescer.js';

describe('LIVE-CODEX-001 opaque source hints', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { clearPendingProxySourceChanges(); vi.useRealTimers(); });
  it('coalesces repeated IDs independently of preview text and caps the window at64', async () => {
    const received = vi.fn(), unsubscribe = eventBus.on('proxy_sources_changed', received);
    for (let i = 0; i < 1000; i += 1) queueProxySourceChange('ws-' + (i % 80));
    await vi.advanceTimersByTimeAsync(999); expect(received).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0]).toEqual({ requestIds: Array.from({ length: 64 }, (_, i) => 'ws-' + i).sort() });
    queueProxySourceChange('ws-later'); clearPendingProxySourceChanges();
    await vi.advanceTimersByTimeAsync(1000); expect(received).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0); unsubscribe();
  });
});

describe('REQ-009 relation invalidation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { clearPendingTraceLinkChanges(); vi.useRealTimers(); });
  it('coalesces repeated association keys and bounds both arrays', async () => {
    const events: Array<{ sessionKeys: string[]; proxyIds: number[]; truncated: boolean }> = [];
    const unsubscribe = eventBus.on('trace_links_changed', payload => events.push(payload));
    for (let index = 0; index < 524; index += 1) queueTraceLinkChange('session-' + index, index + 1);
    await vi.advanceTimersByTimeAsync(199);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ truncated: true });
    expect(events[0]?.sessionKeys).toHaveLength(200);
    expect(events[0]?.proxyIds).toHaveLength(200);
    unsubscribe();
  });
  it('clears pending association notifications on shutdown', async () => {
    const received = vi.fn();
    const unsubscribe = eventBus.on('trace_links_changed', received);
    queueTraceLinkChange('session', 1); clearPendingTraceLinkChanges();
    await vi.advanceTimersByTimeAsync(200);
    expect(received).not.toHaveBeenCalled();
    unsubscribe();
  });
});

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

  it('bounds pending request windows and releases admission after the window', async () => {
    const chunks: Array<{ requestId: string; chunk: string }> = [];
    const unsub = eventBus.on('proxy_stream_chunk', p => chunks.push(p));
    try {
      for (let i = 0; i < 64; i += 1) expect(queueProxyStreamChunk(`r${i}`, 'x')).toBe(true);
      expect(queueProxyStreamChunk('overflow', 'not retained')).toBe(false);
      expect(queueProxyStreamChunk('r0', 'y')).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(chunks).toHaveLength(64);
      expect(chunks[0]).toEqual({ requestId: 'r0', chunk: 'xy' });
      expect(queueProxyStreamChunk('overflow', 'now admitted')).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(chunks.at(-1)).toEqual({ requestId: 'overflow', chunk: 'now admitted' });
    } finally { unsub(); }
  });

  it('rejects oversized windows without losing accepted text or exceeding the frame budget', async () => {
    const chunks: Array<{ requestId: string; chunk: string }> = [];
    const unsub = eventBus.on('proxy_stream_chunk', p => chunks.push(p));
    try {
      expect(queueProxyStreamChunk('r1', '\u0000'.repeat(32768))).toBe(true);
      expect(queueProxyStreamChunk('r1', 'extra')).toBe(false);
      expect(queueProxyStreamChunk('r2', 'x'.repeat(32769))).toBe(false);
      expect(queueProxyStreamChunk('r3', '')).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.chunk).toBe('\u0000'.repeat(32768));
      expect(Buffer.byteLength(JSON.stringify(chunks[0]))).toBeLessThan(256 * 1024);
    } finally { unsub(); }
  });

  it('terminal flush emits accepted text once and cancels its pending window', async () => {
    const received = vi.fn();
    const unsub = eventBus.on('proxy_stream_chunk', payload => received(payload));
    try {
      queueProxyStreamChunk('r1', 'final fragment');
      flushProxyStreamChunk('r1'); flushProxyStreamChunk('r1');
      expect(received).toHaveBeenCalledExactlyOnceWith({ requestId: 'r1', chunk: 'final fragment' });
      await vi.advanceTimersByTimeAsync(100);
      expect(received).toHaveBeenCalledTimes(1);
    } finally { unsub(); }
  });
});
