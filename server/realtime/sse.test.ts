import type { ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from './event-bus.js';
import { addSseClient, closeSseBroadcaster } from './sse.js';

class FakeRes {
  statusCode = 0;
  headers: Record<string, string | number> = {};
  chunks: string[] = [];
  ended = false;

  writeHead(status: number, headers: Record<string, string | number>): void {
    this.statusCode = status;
    this.headers = headers;
  }

  write(chunk: string | Buffer): boolean {
    this.chunks.push(String(chunk));
    return true;
  }

  end(): void {
    this.ended = true;
  }
}

function fakeRes(): ServerResponse {
  return new FakeRes() as unknown as ServerResponse;
}

describe('REQ-005/006 SSE 广播器', () => {
  afterEach(() => {
    closeSseBroadcaster();
    eventBus.removeAllListeners();
    vi.useRealTimers();
  });

  it('写入 200 + text/event-stream + connected 事件', () => {
    const res = fakeRes();
    addSseClient(res);
    const fake = res as unknown as FakeRes;
    expect(fake.statusCode).toBe(200);
    expect(fake.headers['content-type']).toBe('text/event-stream');
    expect(fake.headers['cache-control']).toBe('no-cache');
    expect(fake.chunks.join('')).toContain('event: connected');
    expect(fake.chunks.join('')).toContain('"schemaVersion":1');
  });

  it('转发全部 BusEvents 事件给客户端', () => {
    const res = fakeRes();
    addSseClient(res);
    eventBus.emit('sessions_changed', { keys: ['k1', 'k2'], count: 2 });
    eventBus.emit('scan_completed', { provider: 'all', count: 5 });
    const text = (res as unknown as FakeRes).chunks.join('');
    expect(text).toContain('event: sessions_changed');
    expect(text).toContain('"keys":["k1","k2"]');
    expect(text).toContain('event: scan_completed');
  });

  it('每 30s 心跳 ping，连接断开后订阅全部解除', async () => {
    vi.useFakeTimers();
    const res = fakeRes();
    const cleanup = addSseClient(res);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((res as unknown as FakeRes).chunks.join('')).toContain(': ping');

    cleanup();
    expect((res as unknown as FakeRes).ended).toBe(true);
    expect(eventBus.totalListenerCount()).toBe(0);
  });

  it('closeSseBroadcaster 关闭所有客户端并清空订阅', () => {
    const res1 = fakeRes();
    const res2 = fakeRes();
    addSseClient(res1);
    addSseClient(res2);
    closeSseBroadcaster();
    expect((res1 as unknown as FakeRes).ended).toBe(true);
    expect((res2 as unknown as FakeRes).ended).toBe(true);
    expect(eventBus.totalListenerCount()).toBe(0);
  });
});
