import { eventBus } from './event-bus.js';

const SESSION_WINDOW_MS = 200;
const CHUNK_WINDOW_MS = 100;
const TEAM_WINDOW_MS = 200;

const pendingProxySources = new Set<string>();
let proxySourceTimer: NodeJS.Timeout | null = null;
export function clearPendingProxySourceChanges(): void {
  if (proxySourceTimer !== null) clearTimeout(proxySourceTimer);
  proxySourceTimer = null; pendingProxySources.clear();
}
/** Dirty hint only: no payload parsing, DB write or completion assertion. */
export function queueProxySourceChange(requestId: string): void {
  if (pendingProxySources.size < 64) pendingProxySources.add(requestId);
  if (proxySourceTimer === null) {
    proxySourceTimer = setTimeout(() => {
      const requestIds = [...pendingProxySources].sort();
      clearPendingProxySourceChanges();
      eventBus.emit('proxy_sources_changed', { requestIds });
    }, 1000);
    proxySourceTimer.unref();
  }
}

/** contracts/data-model.md §10 / design D14：每个 id 列表的上限。 */
export const TEAM_CHANGE_CAP = 200;

const pendingSessionKeys = new Set<string>();
let sessionTimer: NodeJS.Timeout | null = null;

const pendingTraceSessions = new Set<string>();
const pendingTraceProxies = new Set<number>();
let traceTimer: NodeJS.Timeout | null = null;
let traceTruncated = false;
export function clearPendingTraceLinkChanges(): void {
  if (traceTimer !== null) clearTimeout(traceTimer);
  traceTimer = null; traceTruncated = false;
  pendingTraceSessions.clear(); pendingTraceProxies.clear();
}
export function queueTraceLinkChange(sessionKey: string, proxyId?: number): void {
  if (pendingTraceSessions.size < 200 || pendingTraceSessions.has(sessionKey)) pendingTraceSessions.add(sessionKey);
  else traceTruncated = true;
  if (proxyId !== undefined) {
    if (pendingTraceProxies.size < 200 || pendingTraceProxies.has(proxyId)) pendingTraceProxies.add(proxyId);
    else traceTruncated = true;
  }
  if (traceTimer === null) {
    traceTimer = setTimeout(() => {
      const payload = { sessionKeys: [...pendingTraceSessions].sort(), proxyIds: [...pendingTraceProxies].sort((a, b) => a - b), truncated: traceTruncated };
      clearPendingTraceLinkChanges();
      eventBus.emit('trace_links_changed', payload);
    }, SESSION_WINDOW_MS);
    traceTimer.unref();
  }
}

const STREAM_WINDOW_CAP = 64;
// JSON escaping costs at most six bytes per code unit; leave frame headroom.
const STREAM_WINDOW_CHARS = 32768;
const chunkBuffers = new Map<string, string>();
const chunkTimers = new Map<string, NodeJS.Timeout>();

// team_runs_changed 合并状态（§6.11 / design D14）
const pendingTeamRunIds = new Set<string>();
const pendingTeamAgentIds = new Set<string>();
const pendingTeamTaskIds = new Set<string>();
let teamTruncated = false;
/** 已观测到的最大 stamp（按字符串序；ISO 8601 UTC 与字典序一致）。 */
let teamStamp = '';
let teamTimer: NodeJS.Timeout | null = null;

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

/** REQ-004: false is explicit live-preview pressure, not original-file loss. */
export function queueProxyStreamChunk(requestId: string, chunk: string): boolean {
  if (chunk === '') return true;
  const buffer = chunkBuffers.get(requestId) ?? '';
  if ((!chunkBuffers.has(requestId) && chunkBuffers.size >= STREAM_WINDOW_CAP) ||
    buffer.length + chunk.length > STREAM_WINDOW_CHARS) return false;
  chunkBuffers.set(requestId, buffer + chunk);
  if (!chunkTimers.has(requestId)) {
    const timer = setTimeout(() => flushProxyStreamChunk(requestId), CHUNK_WINDOW_MS);
    timer.unref();
    chunkTimers.set(requestId, timer);
  }
  return true;
}

/** Terminal-only flush preserves accepted text before proxy_stream_ended. */
export function flushProxyStreamChunk(requestId: string): void {
  const timer = chunkTimers.get(requestId);
  if (timer !== undefined) clearTimeout(timer);
  chunkTimers.delete(requestId);
  const chunk = chunkBuffers.get(requestId);
  chunkBuffers.delete(requestId);
  if (chunk !== undefined && chunk !== '') eventBus.emit('proxy_stream_chunk', { requestId, chunk });
}

function flushTeamChanges(): void {
  teamTimer = null;
  if (
    pendingTeamRunIds.size === 0 &&
    pendingTeamAgentIds.size === 0 &&
    pendingTeamTaskIds.size === 0
  ) {
    return;
  }
  // design D14 / §6.11：超过 cap 时保留 runIds、置 truncated=true，
  // 客户端改做一次 snapshot refresh。agentIds/taskIds 截断到 cap。
  const runIds = [...pendingTeamRunIds].sort();
  const agentIds = [...pendingTeamAgentIds].sort().slice(0, TEAM_CHANGE_CAP);
  const taskIds = [...pendingTeamTaskIds].sort().slice(0, TEAM_CHANGE_CAP);
  const truncated =
    teamTruncated ||
    pendingTeamAgentIds.size > TEAM_CHANGE_CAP ||
    pendingTeamTaskIds.size > TEAM_CHANGE_CAP;
  const stamp = teamStamp || new Date().toISOString();
  pendingTeamRunIds.clear();
  pendingTeamAgentIds.clear();
  pendingTeamTaskIds.clear();
  teamTruncated = false;
  teamStamp = '';
  eventBus.emit('team_runs_changed', { runIds, agentIds, taskIds, truncated, stamp });
}

/**
 * §6.11 / design D14：team run 变更合并到现有 200ms 窗口。run/agent/task ids
 * 各自累积到 cap（契约默认 200）；超过 cap 时保留 runIds、置 truncated=true，
 * 客户端改做一次 snapshot refresh。stamp 取窗口内最大值（ISO 8601 UTC 字符串序）。
 * 无 activity ids 广播（账本按 run/time stamp 失效页面）。
 */
export function queueTeamRunChange(change: {
  runId: string;
  agentIds?: readonly string[];
  taskIds?: readonly string[];
  stamp?: string;
}): void {
  pendingTeamRunIds.add(change.runId);
  if (change.agentIds !== undefined) {
    for (const id of change.agentIds) {
      pendingTeamAgentIds.add(id);
    }
    if (change.agentIds.length > TEAM_CHANGE_CAP) {
      teamTruncated = true;
    }
  }
  if (change.taskIds !== undefined) {
    for (const id of change.taskIds) {
      pendingTeamTaskIds.add(id);
    }
    if (change.taskIds.length > TEAM_CHANGE_CAP) {
      teamTruncated = true;
    }
  }
  if (change.stamp !== undefined && change.stamp > teamStamp) {
    teamStamp = change.stamp;
  }
  if (teamTimer === null) {
    teamTimer = setTimeout(flushTeamChanges, TEAM_WINDOW_MS);
    teamTimer.unref(); // G11.8
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

/** 测试/关闭用：立即冲刷 team 变更并清空 pending。 */
export function flushTeamChangesNow(): void {
  if (teamTimer !== null) {
    clearTimeout(teamTimer);
    teamTimer = null;
  }
  flushTeamChanges();
}

export function pendingSessionChangeCount(): number {
  return pendingSessionKeys.size;
}

export function pendingTeamChangeCount(): number {
  return pendingTeamRunIds.size;
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

/** 测试/关闭用：清空 team 合并 pending 与定时器。 */
export function clearPendingTeamChanges(): void {
  if (teamTimer !== null) {
    clearTimeout(teamTimer);
    teamTimer = null;
  }
  pendingTeamRunIds.clear();
  pendingTeamAgentIds.clear();
  pendingTeamTaskIds.clear();
  teamTruncated = false;
  teamStamp = '';
}
