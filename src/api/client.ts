import type {
  AgentOverviewRow,
  ProxyRequestListItem,
  SessionDetailResponse,
  SessionIndexEntry,
  SpeedMetrics,
  TraceEvent,
  TraceEventRaw,
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

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
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
    provider?: string;
    limit?: number;
    cursor?: string;
    keys?: string[];
  } = {}): Promise<SessionListResponse> {
    return fetchJson<SessionListResponse>(
      `/sessions${qs({
        dataSource: params.dataSource ?? 'scan',
        provider: params.provider,
        limit: params.limit ?? 50,
        cursor: params.cursor,
        keys: params.keys?.join(','),
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
  eventDetail(key: string, eventId: string, includeRaw = false): Promise<TraceEvent | TraceEventRaw> {
    return fetchJson<TraceEvent | TraceEventRaw>(
      `/sessions/${encodeURIComponent(key)}/events/${encodeURIComponent(eventId)}${qs({ include: includeRaw ? 'raw' : undefined })}`,
    );
  },
  agentOverview(dataSource: 'scan' | 'proxy' = 'scan'): Promise<AgentOverviewResponse> {
    return fetchJson<AgentOverviewResponse>(`/agent-overview${qs({ dataSource })}`);
  },
  proxyRequests(params: { limit?: number; cursor?: string } = {}): Promise<{
    items: ProxyRequestListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return fetchJson(`/proxy/requests${qs({ limit: params.limit ?? 50, cursor: params.cursor })}`);
  },
  proxyStatus(): Promise<{ running: boolean; port: number | null; requestCount: number; startedAt: string | null }> {
    return fetchJson('/proxy/status');
  },
  fridaStatus(): Promise<{ running: boolean; pid: number | null }> {
    return fetchJson('/frida/status');
  },
  fridaCaptures(): Promise<{
    items: Array<{ id: number; capturedAt: string; captureType: string; model: string | null }>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return fetchJson('/frida/captures');
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
