import type { ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { createServer, request } from 'node:http';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from './event-bus.js';
import { addSseClient, closeSseBroadcaster, sseResourceStatus } from './sse.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { queueTraceLinkChange } from './coalescer.js';

class FakeRes extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string | number> = {};
  chunks: string[] = [];
  ended = false;
  writableLength = 0;
  destroyed = false;
  writable = true;

  writeHead(status: number, headers: Record<string, string | number>): void {
    this.statusCode = status;
    this.headers = headers;
  }

  write(chunk: string | Buffer): boolean {
    this.chunks.push(String(chunk));
    return this.writable;
  }

  end(chunk?: string | Buffer): void {
    if (chunk !== undefined) this.chunks.push(String(chunk));
    this.ended = true;
  }
  destroy(): void { this.destroyed = true; this.emit('close'); }
}

function fakeRes(): ServerResponse {
  return new FakeRes() as unknown as ServerResponse;
}

describe('REQ-005/006 SSE 广播器', () => {
  it('bounds a real HTTP writable backlog while a healthy HTTP subscriber continues receiving', async () => {
    const baseline = sseResourceStatus().slowSseDisconnects;
    const server = createServer((req, res) => { if (req.url === '/blocked') res.cork(); addSseClient(res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let healthyFrames = 0;
    const blocked = request({ host: '127.0.0.1', port, path: '/blocked' }); blocked.on('error', () => {}); blocked.end();
    const healthy = request({ host: '127.0.0.1', port, path: '/healthy' }, res => { res.setEncoding('utf8'); res.on('data', chunk => { healthyFrames += String(chunk).split('event: proxy_stream_chunk').length - 1; }); res.on('error', () => {}); });
    healthy.on('error', () => {}); healthy.end();
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 2000;
      while (!predicate()) { if (Date.now() > deadline) throw new Error('HTTP subscriber condition timed out'); await yieldImmediate(); }
    };
    try {
      await waitFor(() => sseResourceStatus().sseClients === 2);
      for (let index = 0; index < 40; index += 1) {
        eventBus.emit('proxy_stream_chunk', { requestId: 'synthetic', chunk: 'x'.repeat(32 * 1024) }); await yieldImmediate();
      }
      await waitFor(() => healthyFrames === 40);
      expect(sseResourceStatus()).toEqual({ sseClients: 1, slowSseDisconnects: baseline + 1 });
      expect(eventBus.listenerCount('proxy_stream_chunk')).toBe(1);
    } finally {
      blocked.destroy(); healthy.destroy(); closeSseBroadcaster(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  afterEach(() => {
    closeSseBroadcaster();
    eventBus.removeAllListeners();
    vi.useRealTimers();
  });

  it('disconnects only a blocked client after the drain deadline and releases owned listeners/timers once', async () => {
    vi.useFakeTimers();
    const slow = new FakeRes(), fast = new FakeRes(); slow.writable = false;
    const before = sseResourceStatus().slowSseDisconnects;
    const cleanup = addSseClient(slow as unknown as ServerResponse); addSseClient(fast as unknown as ServerResponse);
    await vi.advanceTimersByTimeAsync(4999); expect(slow.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(slow.destroyed).toBe(true); expect(fast.destroyed).toBe(false);
    expect(sseResourceStatus()).toEqual({ sseClients: 1, slowSseDisconnects: before + 1 });
    cleanup(); cleanup(); expect(slow.listenerCount('drain')).toBe(0);
    eventBus.emit('scan_completed', { provider: 'all', count: 7 });
    expect(fast.chunks.join('')).toContain('"count":7');
    expect(slow.chunks.join('')).not.toContain('"count":7');
  });
  it('drain cancels the deadline; a later close performs cleanup without counting a slow client', async () => {
    vi.useFakeTimers();
    const res = new FakeRes(); res.writable = false;
    const before = sseResourceStatus().slowSseDisconnects;
    addSseClient(res as unknown as ServerResponse);
    res.writable = true; res.emit('drain');
    await vi.advanceTimersByTimeAsync(6000); expect(res.destroyed).toBe(false);
    res.emit('close');
    expect(sseResourceStatus()).toEqual({ sseClients: 0, slowSseDisconnects: before });
    expect(eventBus.totalListenerCount()).toBe(0);
  });
  it('bounds writable queues and oversized frames without ending another subscriber', () => {
    const slow = new FakeRes(), fast = new FakeRes();
    addSseClient(slow as unknown as ServerResponse); addSseClient(fast as unknown as ServerResponse);
    slow.writableLength = 1024 * 1024;
    eventBus.emit('scan_completed', { provider: 'all', count: 9 });
    expect(slow.destroyed).toBe(true); expect(fast.destroyed).toBe(false);
    expect(fast.chunks.join('')).toContain('"count":9');
    eventBus.emit('proxy_stream_chunk', { requestId: 'synthetic', chunk: 'x'.repeat(256 * 1024) });
    expect(fast.destroyed).toBe(true); expect(eventBus.totalListenerCount()).toBe(0);
  });
  it('rejects excess subscriptions before 200/registration, using the unified 503 envelope', () => {
    const clients = Array.from({ length: 64 }, () => new FakeRes());
    for (const res of clients) addSseClient(res as unknown as ServerResponse);
    const extra = new FakeRes(); addSseClient(extra as unknown as ServerResponse);
    expect(extra.statusCode).toBe(503);
    expect(JSON.parse(extra.chunks.join(''))).toEqual({ error: { code: 'SSE_LIMIT_REACHED', message: 'Live subscriber capacity reached; retry later' } });
    expect(sseResourceStatus().sseClients).toBe(64);
    closeSseBroadcaster(); expect(sseResourceStatus().sseClients).toBe(0);
  });

  it('写入 200 + text/event-stream + connected 事件', () => {
    const res = fakeRes();
    addSseClient(res);
    const fake = res as unknown as FakeRes;
    expect(fake.statusCode).toBe(200);
    expect(fake.headers['content-type']).toBe('text/event-stream');
    expect(fake.headers['cache-control']).toBe('no-cache');
    expect(fake.chunks.join('')).toContain('event: connected');
    // 跟随 SCHEMA_VERSION 常量，避免每次 schema 升版都要改断言字面量
    expect(fake.chunks.join('')).toContain(`"schemaVersion":${SCHEMA_VERSION}`);
  });

  it('forwards one bounded relation-only invalidation after the real coalescing window', async () => {
    vi.useFakeTimers();
    const res = fakeRes(); addSseClient(res);
    for (let index = 0; index < 50; index += 1) queueTraceLinkChange('native-session', index + 1);
    await vi.advanceTimersByTimeAsync(199);
    expect((res as unknown as FakeRes).chunks.join('')).not.toContain('trace_links_changed');
    await vi.advanceTimersByTimeAsync(1);
    const text = (res as unknown as FakeRes).chunks.join('');
    expect(text.match(/event: trace_links_changed/g)).toHaveLength(1);
    expect(text).toContain('"sessionKeys":["native-session"]');
    expect(text).toContain('"truncated":false');
    expect(text).not.toContain('event: sessions_changed');
    expect(text).not.toContain('requestBody');
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
