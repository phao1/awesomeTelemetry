import type { ServerResponse } from 'node:http';

import type { BusEvents } from '../../src/core/trace-types.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { eventBus, type BusEventName } from './event-bus.js';
import { clearPendingSessionChanges } from './coalescer.js';

const HEARTBEAT_MS = 30_000;
const EVENT_NAMES = [
  'session_created',
  'sessions_changed',
  'session_deleted',
  'scan_started',
  'scan_completed',
  'proxy_request',
  'proxy_stream_chunk',
  'frida_capture',
  'frida_status',
] as const satisfies readonly BusEventName[];

const cleanups = new Set<() => void>();

/**
 * REQ-005/006：SSE 广播器。订阅 BusEvents 全部事件并转发；
 * 返回 cleanup，客户端断开时解除全部订阅。
 */
export function addSseClient(res: ServerResponse): () => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const connected: { serverTime: string; schemaVersion: number } = {
    serverTime: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
  res.write(`event: connected\ndata: ${JSON.stringify(connected)}\n\n`);

  const unsubscribes: Array<() => void> = [];
  for (const name of EVENT_NAMES) {
    unsubscribes.push(
      eventBus.on(name, (payload: BusEvents[typeof name]) => {
        res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
      }),
    );
  }
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const cleanup = (): void => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
    clearInterval(heartbeat);
    cleanups.delete(cleanup);
    try {
      res.end();
    } catch {
      // 连接已关闭
    }
  };
  cleanups.add(cleanup);
  return cleanup;
}

/** REQ-008：关闭广播器——取消全部订阅、清空合并器 pending、关闭所有客户端。 */
export function closeSseBroadcaster(): void {
  for (const cleanup of [...cleanups]) {
    cleanup();
  }
  cleanups.clear();
  clearPendingSessionChanges();
}
