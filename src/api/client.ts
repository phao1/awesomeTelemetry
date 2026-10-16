import type {
  AgentOverviewRow,
  MissionResponse,
  ProxyRequest,
  ProxyRuntimeStatus,
  MonitorConnectionProfile,
  MonitorConnectionSettings,
  MonitorConnectionPlan,
  MonitorConnectionDiagnostics,
  ProxyRequestListItem,
  ProxyCaptureBodies,
  ProxyProtocolAnalysis,
  ProxyTraceLinkPage,
  SessionCaptureLinkPage,
  TraceAssociation,
  TraceAssociationDecision,
  TraceIdentityPage,
  CaptureStorageStatus,
  CaptureMetadataCapacity,
  OriginalDeletionJob,
  RequestContextDiffResponse,
  SessionDetailResponse,
  SessionIndexEntry,
  SessionMergeGroupInfo,
  SessionRange,
  SessionPromptContext,
  SpeedMetrics,
  TraceEvent,
  TraceEventRaw,
  TraceStatus,
} from '../core/trace-types.js';

const BASE = '/api';

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** contracts/api.md §2.1：Agent Overview 响应。 */
export interface AgentOverviewResponse {
  rows: AgentOverviewRow[];
  stamp: string;
  cached: boolean;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch (err) {
      console.error('[api] 响应体不是合法 JSON:', err);
    }
  }
  if (!res.ok) {
    const envelope = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      envelope?.error?.code ?? 'INTERNAL_ERROR',
      envelope?.error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

/** CA 证书是 PEM 文本，非 JSON（api.md §4：application/x-pem-file）。 */
export async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/x-pem-file' } });
  const text = await res.text();
  if (!res.ok) {
    const envelope = ((): { error?: { code?: string; message?: string } } | null => {
      try {
        return JSON.parse(text) as { error?: { code?: string; message?: string } };
      } catch {
        return null;
      }
    })();
    throw new ApiError(
      envelope?.error?.code ?? 'INTERNAL_ERROR',
      envelope?.error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return text;
}

function qs(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  const raw = search.toString();
  return raw === '' ? '' : `?${raw}`;
}

export interface SessionListResponse {
  items: SessionIndexEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export const api = {
  listSessions(params: {
    dataSource?: 'scan' | 'proxy';
    provider?: string[];
    status?: TraceStatus[];
    q?: string;
    range?: SessionRange;
    limit?: number;
    cursor?: string;
    keys?: string[];
    /** false → merged=0，按 key 返回未合并的原始成员。 */
    merged?: boolean;
  } = {}): Promise<SessionListResponse> {
    return fetchJson<SessionListResponse>(
      `/sessions${qs({
        dataSource: params.dataSource ?? 'scan',
        provider: params.provider,
        status: params.status,
        q: params.q,
        range: params.range,
        limit: params.limit ?? 50,
        cursor: params.cursor,
        keys: params.keys?.join(','),
        merged: params.merged === undefined ? undefined : params.merged ? '1' : '0',
      })}`,
    );
  },
  sessionDetail(
    key: string,
    mode: 'slim' | 'full' = 'slim',
    offset?: number,
    limit?: number,
  ): Promise<SessionDetailResponse> {
    return fetchJson<SessionDetailResponse>(
      `/sessions/${encodeURIComponent(key)}${qs({ mode, offset, limit })}`,
    );
  },
  sessionGroups(): Promise<{ groups: SessionMergeGroupInfo[] }> {
    return fetchJson<{ groups: SessionMergeGroupInfo[] }>('/session-groups');
  },
  promptContext(key: string): Promise<SessionPromptContext> {
    return fetchJson<SessionPromptContext>(
      `/sessions/${encodeURIComponent(key)}/prompt-context`,
    );
  },
  eventDetail(key: string, eventId: string, includeRaw = false): Promise<TraceEvent | TraceEventRaw> {
    return fetchJson<TraceEvent | TraceEventRaw>(
      `/sessions/${encodeURIComponent(key)}/events/${encodeURIComponent(eventId)}${qs({ include: includeRaw ? 'raw' : undefined })}`,
    );
  },
  agentOverview(dataSource: 'scan' | 'proxy' = 'scan'): Promise<AgentOverviewResponse> {
    return fetchJson<AgentOverviewResponse>(`/agent-overview${qs({ dataSource })}`);
  },
  /** api.md §2.4：Mission 聚合，1 请求返回全部 A/B/C 三区 widget（G11.9）。 */
  mission(params: {
    range?: '7d' | '30d' | 'all';
    dataSource?: 'scan' | 'proxy';
    tz?: number;
  } = {}): Promise<MissionResponse> {
    return fetchJson<MissionResponse>(
      `/mission${qs({
        range: params.range ?? '7d',
        dataSource: params.dataSource ?? 'scan',
        tz: params.tz,
      })}`,
    );
  },
  proxyRequests(params: { limit?: number; cursor?: string } = {}): Promise<{
    items: ProxyRequestListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return fetchJson(`/proxy/requests${qs({ limit: params.limit ?? 50, cursor: params.cursor })}`);
  },
  proxyStatus(): Promise<ProxyRuntimeStatus> {
    return fetchJson('/proxy/status');
  },
  monitorProfiles(): Promise<{ items: MonitorConnectionProfile[] }> {
    return fetchJson('/proxy/profiles');
  },
  monitorCreateProfile(settings: MonitorConnectionSettings): Promise<MonitorConnectionProfile> {
    return fetchJson('/proxy/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
  },
  monitorUpdateProfile(id: string, settings: MonitorConnectionSettings, expectedRevision: number): Promise<MonitorConnectionProfile> {
    return fetchJson(`/proxy/profiles/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings, expectedRevision }) });
  },
  monitorDeleteProfile(id: string, expectedRevision: number): Promise<{ deleted: true }> {
    return fetchJson(`/proxy/profiles/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision }) });
  },
  monitorConnectionPlan(id: string): Promise<MonitorConnectionPlan> {
    return fetchJson(`/proxy/profiles/${encodeURIComponent(id)}/plan`);
  },
  monitorConnectionDiagnostics(id: string, signal?: AbortSignal): Promise<MonitorConnectionDiagnostics> {
    return fetchJson(`/proxy/profiles/${encodeURIComponent(id)}/diagnostics`, { signal });
  },
  monitorStartProfile(id: string, expectedRevision: number): Promise<MonitorConnectionPlan> {
    return fetchJson(`/proxy/profiles/${encodeURIComponent(id)}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision }) });
  },
  proxyStart(port?: number): Promise<ProxyRuntimeStatus> {
    return fetchJson('/proxy/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port }),
    });
  },
  proxyStop(): Promise<ProxyRuntimeStatus> {
    return fetchJson('/proxy/stop', { method: 'POST' });
  },
  proxyRequest(id: number): Promise<ProxyRequest> {
    return fetchJson(`/proxy/requests/${id}`);
  },
  proxyCapture(id: number, signal?: AbortSignal): Promise<ProxyCaptureBodies> {
    return fetchJson(`/proxy/requests/${id}/capture`, { signal });
  },
  proxyAnalysis(id: number, signal?: AbortSignal): Promise<ProxyProtocolAnalysis> {
    return fetchJson(`/proxy/requests/${id}/analysis`, { signal });
  },
  proxyIdentities(id: number, cursor?: string): Promise<TraceIdentityPage> {
    return fetchJson(`/proxy/requests/${id}/identities${qs({ cursor })}`);
  },
  sessionIdentities(key: string, cursor?: string): Promise<TraceIdentityPage> {
    return fetchJson(`/sessions/${encodeURIComponent(key)}/identities${qs({ cursor })}`);
  },
  sessionCaptureLinks(key: string, cursor?: number): Promise<SessionCaptureLinkPage> {
    return fetchJson(`/sessions/${encodeURIComponent(key)}/capture-links${qs({ cursor })}`);
  },
  proxyTraceLinks(id: number, cursor?: string): Promise<ProxyTraceLinkPage> {
    return fetchJson(`/proxy/requests/${id}/trace-links${qs({ cursor })}`);
  },
  decideTraceLink(id: number, key: string, state: TraceAssociationDecision['state'], note: string | null = null): Promise<TraceAssociation> {
    return fetchJson(`/proxy/requests/${id}/trace-links/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, note }),
    });
  },
  traceLinkDecisions(id: number, key: string, cursor?: number): Promise<{ items: TraceAssociationDecision[]; nextCursor: number | null; hasMore: boolean }> {
    return fetchJson(`/proxy/requests/${id}/trace-links/${encodeURIComponent(key)}/decisions${qs({ cursor })}`);
  },
  proxyStorage(signal?: AbortSignal): Promise<CaptureStorageStatus> {
    return fetchJson('/proxy/storage', { signal });
  },
  proxyCapacity(signal?: AbortSignal): Promise<CaptureMetadataCapacity> {
    return fetchJson('/proxy/capacity', { signal });
  },
  originalDeletion(id: number, signal?: AbortSignal): Promise<OriginalDeletionJob | null> {
    return fetchJson(`/proxy/requests/${id}/original-deletion`, { signal });
  },
  deleteOriginals(id: number, expectedRequestId: string, signal?: AbortSignal): Promise<OriginalDeletionJob> {
    return fetchJson(`/proxy/requests/${id}/original-deletion`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRequestId, confirm: true }), signal,
    });
  },
  /**
   * design D10 / §6.3：bounded evidence-grade request-context diff。
   * 惰性——仅在 Context Diff 显式激活时调用。`base` 省略等同 `previous`；
   * 结构化 API 错误码（400/404/409/422/500）由 fetchJson 抛出的 ApiError.code 保留。
   */
  contextDiff(targetId: number, base?: 'previous' | number): Promise<RequestContextDiffResponse> {
    return fetchJson(
      `/proxy/requests/${targetId}/context-diff${qs({ base })}`,
    );
  },
  clearProxyRequests(): Promise<unknown> {
    return fetchJson('/proxy/requests', { method: 'DELETE' });
  },
  caCert(): Promise<string> {
    return fetchText('/ca-cert');
  },
  fridaStatus(): Promise<{ running: boolean; starting: boolean; pid: number | null }> {
    return fetchJson('/frida/status');
  },
  fridaStart(pid?: number): Promise<{ running: boolean; starting: boolean; pid: number | null }> {
    return fetchJson('/frida/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid }),
    });
  },
  fridaStop(): Promise<unknown> {
    return fetchJson('/frida/stop', { method: 'POST' });
  },
  fridaCaptures(): Promise<{
    items: Array<{ id: number; capturedAt: string; captureType: string; model: string | null }>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return fetchJson('/frida/captures');
  },
  health(): Promise<{
    ok: boolean;
    schemaVersion: number;
    uptimeMs: number;
    dbSizeBytes: number;
    walSizeBytes: number;
    sessionCount: number;
    eventCount: number;
  }> {
    return fetchJson('/health');
  },
  configProviders(): Promise<unknown> {
    return fetchJson('/config/providers');
  },
  saveConfigProviders(body: unknown): Promise<unknown> {
    return fetchJson('/config/providers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  deleteSession(key: string): Promise<{ deleted: boolean; key: string }> {
    return fetchJson(`/sessions/${encodeURIComponent(key)}`, { method: 'DELETE' });
  },
  rescanSession(key: string): Promise<{ key: string; eventCount: number; durationMs: number }> {
    return fetchJson(`/sessions/${encodeURIComponent(key)}/rescan`, { method: 'POST' });
  },
  scan(provider?: string, force = false): Promise<unknown> {
    return fetchJson('/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, force }),
    });
  },
  compare(leftKey: string, rightKey: string): Promise<{
    left: SessionDetailResponse;
    right: SessionDetailResponse;
    speed: { left: SpeedMetrics; right: SpeedMetrics };
  }> {
    return fetchJson('/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leftKey, rightKey }),
    });
  },
};
