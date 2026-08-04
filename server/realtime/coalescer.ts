import { eventBus } from './event-bus.js';

const SESSION_WINDOW_MS = 200;
const CHUNK_WINDOW_MS = 100;

const pendingSessionKeys = new Set<string>();
let sessionTimer: NodeJS.Timeout | null = null;

const chunkBuffers = new Map<string, string[]>();
const chunkTimers = new Map<string, NodeJS.Timeout>();

function flushSessionChanges(): void {
  sessionTimer = null;
  if (pendingSessionKeys.size === 0) {
    return;
  }
  const keys = [...pendingSessionKeys].sort();
  pendingSessionKeys.clear();
  eventBus.emit('sessions_changed', { keys, count: keys.length });
}

/**
 * REQ-003（v5 核心）：key 累积到 pending 集合，200ms 窗口合并后发一条
 * `sessions_changed`。禁止逐 session 发射。
 */
export function queueSessionChange(key: string): void {
  pendingSessionKeys.add(key);
  if (sessionTimer === null) {
    sessionTimer = setTimeout(flushSessionChanges, SESSION_WINDOW_MS);
    sessionTimer.unref(); // G11.8：不阻止 CLI 退出
  }
}

/** REQ-004：同一 requestId 的 chunk 按 100ms 窗口拼接后发一条 proxy_stream_chunk。 */
export function queueProxyStreamChunk(requestId: string, chunk: string): void {
  const buffer = chunkBuffers.get(requestId) ?? [];
  buffer.push(chunk);
  chunkBuffers.set(requestId, buffer);
  if (!chunkTimers.has(requestId)) {
    const timer = setTimeout(() => {
      chunkTimers.delete(requestId);
      const parts = chunkBuffers.get(requestId);
      chunkBuffers.delete(requestId);
      if (parts !== undefined && parts.length > 0) {
        eventBus.emit('proxy_stream_chunk', { requestId, chunk: parts.join('') });
      }
    }, CHUNK_WINDOW_MS);
    timer.unref();
    chunkTimers.set(requestId, timer);
  }
}

/** 测试/关闭用：立即冲刷并清空 pending。 */
export function flushSessionChangesNow(): void {
  if (sessionTimer !== null) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  flushSessionChanges();
}

export function pendingSessionChangeCount(): number {
  return pendingSessionKeys.size;
}

export function clearPendingSessionChanges(): void {
  if (sessionTimer !== null) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  pendingSessionKeys.clear();
  for (const timer of chunkTimers.values()) {
    clearTimeout(timer);
  }
  chunkTimers.clear();
  chunkBuffers.clear();
}
