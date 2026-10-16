import type { ServerResponse } from 'node:http';

import type { BusEvents } from '../../src/core/trace-types.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { eventBus, type BusEventName } from './event-bus.js';
import { clearPendingSessionChanges, clearPendingTeamChanges, clearPendingTraceLinkChanges } from './coalescer.js';
import { sendApiError } from '../http/error-envelope.js';

const HEARTBEAT_MS = 30_000;
const EVENT_NAMES = [
  'session_created',
  'sessions_changed',
  'session_deleted',
  'scan_started',
  'scan_completed',
  'proxy_request',
  'trace_links_changed',
  'proxy_stream_chunk',
  'proxy_status',
  'frida_capture',
  'frida_status',
  'team_runs_changed',
] as const satisfies readonly BusEventName[];

const cleanups = new Set<() => void>();
let slowSseDisconnects = 0;
export function sseResourceStatus(): { sseClients: number; slowSseDisconnects: number } { return { sseClients: cleanups.size, slowSseDisconnects }; }

/**
 * REQ-005/006：SSE 广播器。订阅 BusEvents 全部事件并转发；
 * 返回 cleanup，客户端断开时解除全部订阅。
 */
export function addSseClient(res: ServerResponse): () => void {
  if (cleanups.size >= 64) { sendApiError(res, 503, 'SSE_LIMIT_REACHED', 'Live subscriber capacity reached; retry later'); return () => {}; }
  const unsubscribes: Array<() => void> = [];
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const drained = (): void => { clearTimeout(drainTimer); drainTimer = undefined; };
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    clearInterval(heartbeat); heartbeat = undefined; drained(); cleanups.delete(cleanup);
    res.off('close', cleanup); res.off('error', cleanup); res.off('drain', drained);
    try { res.end(); } catch { /* connection already closed */ }
  };
  const disconnectSlow = (): void => {
    if (closed) return;
    slowSseDisconnects += 1; cleanup(); res.destroy();
  };
  const write = (frame: string): void => {
    if (closed) return;
    const bytes = Buffer.byteLength(frame);
    if (bytes > 256 * 1024 || res.writableLength + bytes > 1024 * 1024) { disconnectSlow(); return; }
    try {
      if (!res.write(frame) && drainTimer === undefined) {
        drainTimer = setTimeout(disconnectSlow, 5000); drainTimer.unref();
      }
    } catch { disconnectSlow(); }
  };
  cleanups.add(cleanup);
  res.once('close', cleanup); res.once('error', cleanup); res.on('drain', drained);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const connected: { serverTime: string; schemaVersion: number } = {
    serverTime: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
  write(`event: connected\ndata: ${JSON.stringify(connected)}\n\n`);

  if (closed) return cleanup;
  for (const name of EVENT_NAMES) {
    unsubscribes.push(
      eventBus.on(name, (payload: BusEvents[typeof name]) => {
        write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
      }),
    );
  }
  heartbeat = setInterval(() => {
    write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return cleanup;
}

/** REQ-008：关闭广播器——取消全部订阅、清空合并器 pending、关闭所有客户端。 */
export function closeSseBroadcaster(): void {
  for (const cleanup of [...cleanups]) {
    cleanup();
  }
  cleanups.clear();
  clearPendingSessionChanges();
  clearPendingTeamChanges();
  clearPendingTraceLinkChanges();
}
