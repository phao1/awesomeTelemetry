import type { Database } from 'better-sqlite3';

import type {
  CaptureMethod,
  DataSource,
  EventMode,
  ProxyRequest,
  ProviderKey,
  ProxyRequestListItem,
  SessionDetailResponse,
  SessionIndexEntry,
  TraceEvent,
  TraceEventRaw,
  TraceEventSlim,
  TraceKind,
  TracePhase,
  TraceSession,
  TraceStatus,
} from '../../src/core/trace-types.js';
import {
  EVENT_FULL_COLS,
  EVENT_SLIM_COLS,
  PROXY_LIST_COLS,
  SESSION_DETAIL_COLS,
  SESSION_LIST_COLS,
} from './columns.js';
import { mergeSessionIndex, type SessionMergeGroup } from './session-merge.js';
import { cachedStmt } from './stmt-cache.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const EVENT_DEFAULT_LIMIT = 2000;
const EVENT_MAX_LIMIT = 5000;
const EVENT_PAGINATION_THRESHOLD = 2000;

const SESSION_DETAIL_SQL = `SELECT ${SESSION_DETAIL_COLS} FROM sessions WHERE id = ?`;
const SESSION_BY_ID_SQL = `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE id = ?`;
const EVENT_COUNT_SQL = `SELECT COUNT(*) AS c FROM events WHERE session_id = ?`;
const EVENT_RAW_SQL = `SELECT raw FROM event_raw WHERE session_id = ? AND event_id = ?`;
const SYSTEM_PROMPT_SQL =
  `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? ` +
  `AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1`;

function sessionsWhere(provider: boolean, cursor: boolean): string {
  const parts = ['data_source = ?'];
  if (provider) {
    parts.push('provider = ?');
  }
  if (cursor) {
    parts.push('started_at < ?');
  }
  return parts.join(' AND ');
}

function sessionListSql(provider: boolean, cursor: boolean): string {
  return `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE ${sessionsWhere(provider, cursor)} ` +
    `ORDER BY started_at DESC LIMIT ?`;
}

function sessionCountSql(provider: boolean): string {
  return `SELECT COUNT(*) AS c FROM sessions WHERE ${provider ? 'data_source = ? AND provider = ?' : 'data_source = ?'}`;
}

function eventsSql(full: boolean): string {
  return `SELECT ${full ? EVENT_FULL_COLS : EVENT_SLIM_COLS} FROM events ` +
    `WHERE session_id = ? ORDER BY sequence LIMIT ? OFFSET ?`;
}

const EVENT_FULL_BY_ID_SQL =
  `SELECT ${EVENT_FULL_COLS} FROM events WHERE session_id = ? AND id = ?`;

const PROXY_FULL_COLS = [
  'id', 'request_id', 'method', 'url', 'hostname', 'request_headers', 'request_body',
  'response_status', 'response_body', 'content_type', 'is_streaming', 'started_at',
  'completed_at', 'duration_ms', 'capture_method', 'ttnet_encrypted', 'system_prompt',
  'system_prompt_len', 'model', 'input_tokens', 'output_tokens', 'parsed_session_id',
  'parser_route', 'raw_request_body', 'raw_response_body',
].join(', ');

const PROXY_BY_ID_SQL = `SELECT ${PROXY_FULL_COLS} FROM proxy_requests WHERE id = ?`;

function proxyWhere(hostname: boolean, captureMethod: boolean, cursor: boolean): string {
  const parts: string[] = [];
  if (hostname) {
    parts.push('hostname = ?');
  }
  if (captureMethod) {
    parts.push('capture_method = ?');
  }
  if (cursor) {
    parts.push('started_at < ?');
  }
  return parts.length > 0 ? parts.join(' AND ') : '1 = 1';
}

function proxyListSql(hostname: boolean, captureMethod: boolean, cursor: boolean): string {
  // §5.2 常量不含 system_prompt_len，但 ProxyRequestListItem 需要该冗余长度元数据。
  return `SELECT ${PROXY_LIST_COLS}, system_prompt_len FROM proxy_requests WHERE ` +
    `${proxyWhere(hostname, captureMethod, cursor)} ORDER BY started_at DESC LIMIT ?`;
}

function mapSessionIndex(row: Record<string, unknown>): SessionIndexEntry {
  return {
    id: row.id as string,
    provider: row.provider as ProviderKey,
    sourceAgent: row.source_agent as string,
    title: row.title as string,
    startedAt: row.started_at as string,
    updatedAt: row.updated_at as string,
    status: row.status as TraceStatus,
    cwd: row.cwd as string | null,
    eventCount: row.event_count as number,
    messageCount: row.message_count as number,
    tokenTotal: row.token_total as number,
    costUsd: row.cost_usd as number,
    dataSource: row.data_source as DataSource,
    sourcePath: row.source_path as string,
    detailLoaded: Boolean(row.detail_loaded),
    mergeGroupId: null,
    hasSystemPrompt: Boolean(row.has_system_prompt),
  };
}

function mapSession(row: Record<string, unknown>): TraceSession {
  return {
    id: row.id as string,
    provider: row.provider as ProviderKey,
    sourceAgent: row.source_agent as string,
    title: row.title as string,
    startedAt: row.started_at as string,
    updatedAt: row.updated_at as string,
    status: row.status as TraceStatus,
    cwd: row.cwd as string | null,
    messageCount: row.message_count as number,
    eventCount: row.event_count as number,
    tokenUsage: {
      input: row.token_input as number,
      output: row.token_output as number,
      reasoning: row.token_reasoning as number,
      cacheRead: row.token_cache_read as number,
      cacheWrite: row.token_cache_write as number,
      // netInput 不入库，按 §3 口径由 input/cacheRead 现算（下限 0）。
      netInput: Math.max(0, (row.token_input as number) - (row.token_cache_read as number)),
      total: row.token_total as number,
    },
    costUsd: row.cost_usd as number,
    systemPrompt: row.system_prompt as string | null,
    dataSource: row.data_source as DataSource,
    sourcePath: row.source_path as string,
    totalDurationMs: row.total_duration_ms as number,
    isSubagent: Boolean(row.is_subagent),
    primaryModel: row.primary_model as string | null | undefined,
    costSource: row.cost_source as TraceSession['costSource'],
    durationSource: row.duration_source as TraceSession['durationSource'],
  };
}

function mapEvent(
  row: Record<string, unknown>,
  full: boolean,
): TraceEventSlim | TraceEvent {
  const slim: TraceEventSlim = {
    id: row.id as string,
    sessionId: row.session_id as string,
    sequence: row.sequence as number,
    kind: row.kind as TraceKind,
    phase: row.phase as TracePhase,
    title: row.title as string,
    startedAt: row.started_at as string,
    durationMs: row.duration_ms as number,
    status: row.status as TraceStatus,
    actor: row.actor as string,
    tool: row.tool as string | null,
    tokens: row.tokens_json === null ? null : (JSON.parse(row.tokens_json as string) as TraceEvent['tokens']),
    error: row.error as string | null,
    hasInput: Boolean(row.has_input),
    hasOutput: Boolean(row.has_output),
    // §5.2：slim 档统一置 hasRaw = true，由下钻接口返回 null 表示实际不存在。
    hasRaw: true,
    model: row.model === undefined ? undefined : (row.model as string | null),
  };
  if (!full) {
    return slim;
  }
  return {
    ...slim,
    inputSummary: row.input_summary as string | null,
    outputSummary: row.output_summary as string | null,
  };
}

function mapProxyListItem(row: Record<string, unknown>): ProxyRequestListItem {
  return {
    id: row.id as number,
    requestId: row.request_id as string,
    method: row.method as string,
    url: row.url as string,
    hostname: row.hostname as string,
    responseStatus: row.response_status as number | null,
    contentType: row.content_type as string | null,
    isStreaming: Boolean(row.is_streaming),
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string | null,
    durationMs: row.duration_ms as number | null,
    captureMethod: row.capture_method as CaptureMethod,
    ttnetEncrypted: Boolean(row.ttnet_encrypted),
    model: row.model as string | null,
    inputTokens: row.input_tokens as number | null,
    outputTokens: row.output_tokens as number | null,
    parsedSessionId: row.parsed_session_id as string | null,
    parserRoute: row.parser_route as string | null,
    systemPromptLen: row.system_prompt_len as number,
    hasSystemPrompt: Boolean(row.has_system_prompt),
  };
}

function mapProxyRequest(row: Record<string, unknown>): ProxyRequest {
  return {
    id: row.id as number,
    requestId: row.request_id as string,
    method: row.method as string,
    url: row.url as string,
    hostname: row.hostname as string,
    requestHeaders:
      typeof row.request_headers === 'string' && row.request_headers !== ''
        ? (JSON.parse(row.request_headers) as Record<string, string>)
        : {},
    requestBody: row.request_body as string | null,
    responseStatus: row.response_status as number | null,
    responseBody: row.response_body as string | null,
    contentType: row.content_type as string | null,
    isStreaming: Boolean(row.is_streaming),
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string | null,
    durationMs: row.duration_ms as number | null,
    captureMethod: row.capture_method as CaptureMethod,
    ttnetEncrypted: Boolean(row.ttnet_encrypted),
    systemPrompt: row.system_prompt as string | null,
    systemPromptLen: row.system_prompt_len as number,
    model: row.model as string | null,
    inputTokens: row.input_tokens as number | null,
    outputTokens: row.output_tokens as number | null,
    parsedSessionId: row.parsed_session_id as string | null,
    parserRoute: row.parser_route as string | null,
    rawRequestBody: row.raw_request_body as string | null,
    rawResponseBody: row.raw_response_body as string | null,
  };
}

export interface ListSessionsOptions {
  dataSource: DataSource;
  provider?: ProviderKey;
  limit?: number;
  cursor?: string;
  keys?: string[];
  /** #17：会话合并组配置（可选；缺省不合并）。 */
  groups?: SessionMergeGroup[];
}

export interface SessionListResult {
  items: SessionIndexEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

/** REQ-006：keyset 分页（cursor = 上页末条 startedAt），返回项不含 systemPrompt 正文。 */
export function listSessions(db: Database, opts: ListSessionsOptions): SessionListResult {
  if (opts.keys !== undefined && opts.keys.length > 0) {
    const items: SessionIndexEntry[] = [];
    const stmt = cachedStmt(db, SESSION_BY_ID_SQL);
    for (const key of opts.keys) {
      const row = stmt.get(key) as Record<string, unknown> | undefined;
      if (row !== undefined) {
        items.push(mapSessionIndex(row));
      }
    }
    const merged = mergeSessionIndex(items, opts.groups ?? []);
    return { items: merged, nextCursor: null, hasMore: false, total: merged.length };
  }

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const hasProvider = opts.provider !== undefined;
  const hasCursor = opts.cursor !== undefined;
  const params: unknown[] = [opts.dataSource];
  if (hasProvider) {
    params.push(opts.provider);
  }
  if (hasCursor) {
    params.push(opts.cursor);
  }
  params.push(limit + 1);

  const rows = cachedStmt(db, sessionListSql(hasProvider, hasCursor)).all(...params) as Array<
    Record<string, unknown>
  >;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = mergeSessionIndex(page.map(mapSessionIndex), opts.groups ?? []);
  const last = items.at(-1);
  const countParams: unknown[] = [opts.dataSource];
  if (hasProvider) {
    countParams.push(opts.provider);
  }
  const countRow = cachedStmt(db, sessionCountSql(hasProvider)).get(...countParams) as { c: number };
  return {
    items,
    nextCursor: hasMore && last !== undefined ? last.startedAt : null,
    hasMore,
    total: countRow.c,
  };
}

export interface GetSessionDetailOptions {
  mode?: EventMode;
  offset?: number;
  limit?: number;
}

/**
 * REQ-006/007：默认 slim；event 数 > 2000 时按 offset/limit 分页。
 * key 不存在返回 null（HTTP 层映射为 404 SESSION_NOT_FOUND）。
 */
export function getSessionDetail(
  db: Database,
  key: string,
  opts: GetSessionDetailOptions = {},
): SessionDetailResponse | null {
  const sessionRow = cachedStmt(db, SESSION_DETAIL_SQL).get(key) as
    | Record<string, unknown>
    | undefined;
  if (sessionRow === undefined) {
    return null;
  }

  const full = opts.mode === 'full';
  const eventTotal = (cachedStmt(db, EVENT_COUNT_SQL).get(key) as { c: number }).c;

  if (eventTotal <= EVENT_PAGINATION_THRESHOLD) {
    const rows = cachedStmt(db, eventsSql(full)).all(key, -1, 0) as Array<
      Record<string, unknown>
    >;
    return {
      session: mapSession(sessionRow),
      events: rows.map((r) => mapEvent(r, full)),
      mode: full ? 'full' : 'slim',
      eventTotal,
      eventOffset: 0,
      eventLimit: eventTotal,
      hasMore: false,
      pending: false,
    };
  }

  const limit = Math.min(Math.max(opts.limit ?? EVENT_DEFAULT_LIMIT, 1), EVENT_MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = cachedStmt(db, eventsSql(full)).all(key, limit, offset) as Array<
    Record<string, unknown>
  >;
  return {
    session: mapSession(sessionRow),
    events: rows.map((r) => mapEvent(r, full)),
    mode: full ? 'full' : 'slim',
    eventTotal,
    eventOffset: offset,
    eventLimit: limit,
    hasMore: offset + rows.length < eventTotal,
    pending: false,
  };
}

/** REQ-008：单 event 下钻；includeRaw 为真时从 event_raw 补 raw。 */
export function getEventDetail(
  db: Database,
  sessionId: string,
  eventId: string,
  includeRaw = false,
): TraceEvent | TraceEventRaw | null {
  const row = cachedStmt(db, EVENT_FULL_BY_ID_SQL).get(sessionId, eventId) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) {
    return null;
  }
  const event = mapEvent(row, true) as TraceEvent;
  if (!includeRaw) {
    return event;
  }
  const rawRow = cachedStmt(db, EVENT_RAW_SQL).get(sessionId, eventId) as
    | { raw: string | null }
    | undefined;
  return { ...event, raw: rawRow?.raw ?? null } as TraceEventRaw;
}

/** REQ-014：窗口内最长 system_prompt（冗余长度列排序，不走 ORDER BY LENGTH）。 */
export function getSystemPromptForSession(
  db: Database,
  startedAt: string,
  endedAt: string,
): string | null {
  const row = cachedStmt(db, SYSTEM_PROMPT_SQL).get(startedAt, endedAt) as
    | { system_prompt: string }
    | undefined;
  return row?.system_prompt ?? null;
}

export interface ListProxyRequestsOptions {
  limit?: number;
  cursor?: string;
  hostname?: string;
  captureMethod?: CaptureMethod;
}

export interface ProxyListResult {
  items: ProxyRequestListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** REQ-015：列表排除 4 个 body 列 + systemPrompt + requestHeaders。 */
export function listProxyRequests(
  db: Database,
  opts: ListProxyRequestsOptions,
): ProxyListResult {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const hasHostname = opts.hostname !== undefined;
  const hasCaptureMethod = opts.captureMethod !== undefined;
  const hasCursor = opts.cursor !== undefined;
  const params: unknown[] = [];
  if (hasHostname) {
    params.push(opts.hostname);
  }
  if (hasCaptureMethod) {
    params.push(opts.captureMethod);
  }
  if (hasCursor) {
    params.push(opts.cursor);
  }
  params.push(limit + 1);

  const rows = cachedStmt(
    db,
    proxyListSql(hasHostname, hasCaptureMethod, hasCursor),
  ).all(...params) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(mapProxyListItem);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last !== undefined ? last.startedAt : null,
    hasMore,
  };
}

/** api.md §4：完整 proxy 请求（含 body），供 /api/proxy/requests/:id。 */
export function getProxyRequestById(db: Database, id: number): ProxyRequest | null {
  const row = cachedStmt(db, PROXY_BY_ID_SQL).get(id) as Record<string, unknown> | undefined;
  return row === undefined ? null : mapProxyRequest(row);
}
