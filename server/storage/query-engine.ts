import type { Database } from 'better-sqlite3';

import type {
  CaptureMethod,
  DataSource,
  EventMode,
  ProxyRequest,
  ProviderKey,
  ProxyRequestListItem,
  RequestContextFormat,
  SessionDetailResponse,
  SessionIndexEntry,
  SessionRange,
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

/** SQL LIKE 转义：% _ \ 均为字面量（ESCAPE '\'）。 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 时间范围 → 起始 ISO 时刻；all/缺省返回 undefined（不过滤）。 */
function rangeSince(range: SessionRange | undefined, now = Date.now()): string | undefined {
  if (range === undefined || range === 'all') {
    return undefined;
  }
  const DAY_MS = 86_400_000;
  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return new Date(start.getTime()).toISOString();
  }
  return new Date(now - (range === '7d' ? 7 : 30) * DAY_MS).toISOString();
}

const SESSION_DETAIL_SQL = `SELECT ${SESSION_DETAIL_COLS} FROM sessions WHERE id = ?`;
// D14：joined 投影 —— session_annotations 也有 updated_at，SELECT 里的无前缀
// `updated_at` 会歧义；对主表列加 `sessions.` 前缀消歧（显式列清单，无 SELECT *）。
// columns.ts 的 SESSION_LIST_COLS 保持契约原样，不做前缀化。
const SESSION_LIST_JOIN_COLS = SESSION_LIST_COLS.split(', ')
  .map((col) => (col.startsWith('CASE') ? col : `sessions.${col}`))
  .join(', ');
// add-trajectory-inspector D14：keys 批量路径同样返回 tags；一次 LEFT JOIN，
// 绝无逐行查询。session_annotations 无 `id` 列，投影无歧义。
const SESSION_BY_ID_SQL =
  `SELECT ${SESSION_LIST_JOIN_COLS}, sa.tags_json AS tags_json ` +
  'FROM sessions LEFT JOIN session_annotations AS sa ON sa.session_id = sessions.id ' +
  'WHERE sessions.id = ?';
const EVENT_COUNT_SQL = `SELECT COUNT(*) AS c FROM events WHERE session_id = ?`;
const EVENT_RAW_SQL = `SELECT raw FROM event_raw WHERE session_id = ? AND event_id = ?`;
const SYSTEM_PROMPT_SQL =
  `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? ` +
  `AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1`;

interface SessionsWhereFlags {
  /** provider IN 的占位符个数；0 表示不过滤。 */
  provider: number;
  q: boolean;
  range: boolean;
  /** status IN 的占位符个数；0 表示不过滤。 */
  status: number;
  /** tags IN 的占位符个数；0 表示不过滤。 */
  tags: number;
  cursor: boolean;
}

function sessionsWhere(flags: SessionsWhereFlags): string {
  // 标签过滤引用 joined 行的 tags_json —— 调用方必须保证 SQL 已带该 LEFT JOIN。
  const parts = ['sessions.data_source = ?'];
  if (flags.provider > 0) {
    parts.push(`sessions.provider IN (${Array.from({ length: flags.provider }, () => '?').join(', ')})`);
  }
  if (flags.q) {
    parts.push("(sessions.title LIKE ? ESCAPE '\\' OR sessions.id LIKE ? ESCAPE '\\')");
  }
  if (flags.range) {
    // Activity window: long-running sessions that receive new events today
    // must remain visible under the frontend's default Today filter.
    parts.push('sessions.updated_at >= ?');
  }
  if (flags.status > 0) {
    parts.push(`sessions.status IN (${Array.from({ length: flags.status }, () => '?').join(', ')})`);
  }
  if (flags.tags > 0) {
    // D14：JSON 数组包含谓词，OR 语义，与 provider/status 的 IN 一致；
    // 评估一次，绝无逐行查询。
    parts.push(
      `EXISTS (SELECT 1 FROM json_each(sa.tags_json) AS je ` +
        `WHERE je.value IN (${Array.from({ length: flags.tags }, () => '?').join(', ')}))`,
    );
  }
  if (flags.cursor) {
    parts.push('sessions.started_at < ?');
  }
  return parts.join(' AND ');
}

function sessionListSql(flags: SessionsWhereFlags): string {
  return `SELECT ${SESSION_LIST_JOIN_COLS}, sa.tags_json AS tags_json FROM sessions ` +
    'LEFT JOIN session_annotations AS sa ON sa.session_id = sessions.id ' +
    `WHERE ${sessionsWhere(flags)} ORDER BY sessions.started_at DESC LIMIT ?`;
}

function sessionCountSql(flags: SessionsWhereFlags): string {
  // 标签过滤需要 joined 行；session_annotations.session_id 是主键，每会话至多
  // 一行，COUNT(*) 仍与会话数一致。
  return `SELECT COUNT(*) AS c FROM sessions ` +
    'LEFT JOIN session_annotations AS sa ON sa.session_id = sessions.id ' +
    `WHERE ${sessionsWhere(flags)}`;
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
  'parser_route', 'capture_group_id', 'request_format',
  'raw_request_body', 'raw_response_body',
].join(', ');

const PROXY_BY_ID_SQL = `SELECT ${PROXY_FULL_COLS} FROM proxy_requests WHERE id = ?`;

// design D4：前驱候选只取配对所需元数据 + 已脱敏 request_body，绝不选 raw 列（NFR-P5 / 禁令 2）。
const PROXY_PREDECESSOR_COLS = [
  'id', 'request_id', 'started_at', 'hostname', 'model', 'capture_method',
  'parser_route', 'request_format', 'parsed_session_id', 'capture_group_id',
  'input_tokens', 'request_body',
].join(', ');

// contracts/database.md §5.3：exact-session 前驱（design D4 step 1）。
export const EXACT_SESSION_PREDECESSOR_SQL =
  `SELECT ${PROXY_PREDECESSOR_COLS} FROM proxy_requests ` +
  'WHERE parsed_session_id IS NOT NULL AND parsed_session_id = ? ' +
  'AND request_format = ? AND id < ? ORDER BY id DESC LIMIT 1';

// contracts/database.md §5.3：capture-group 前驱（design D4 step 2，`IS` 为 null-safe 相等）。
export const CAPTURE_GROUP_PREDECESSOR_SQL =
  `SELECT ${PROXY_PREDECESSOR_COLS} FROM proxy_requests ` +
  'WHERE capture_group_id = ? AND request_format = ? AND model IS ? ' +
  'AND id < ? ORDER BY id DESC LIMIT 1';

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
    // D14：无注解行 → tags_json 为 NULL → 空数组。
    tags: parseTagsJson(row.tags_json),
  };
}

function parseTagsJson(tagsJson: unknown): string[] {
  if (typeof tagsJson !== 'string' || tagsJson === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
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
    // fix-adapter-turn-semantics 5.5：turnKey 原样回读，null 是一等值。
    turnKey: row.turn_key as string | null,
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
    captureGroupId: row.capture_group_id as string | null,
    requestFormat: row.request_format as RequestContextFormat,
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
    captureGroupId: row.capture_group_id as string | null,
    requestFormat: row.request_format as RequestContextFormat,
    rawRequestBody: row.raw_request_body as string | null,
    rawResponseBody: row.raw_response_body as string | null,
  };
}

/**
 * 前驱候选行（design D4 / 存储 delta spec “Two-row body access boundary”）：
 * 仅含配对所需元数据与已脱敏 request_body，供 context-diff 服务精确读取
 * “一个目标 + 至多一个 base”两个 body。
 */
export interface ProxyPredecessor {
  id: number;
  requestId: string;
  startedAt: string;
  hostname: string;
  model: string | null;
  captureMethod: CaptureMethod;
  parserRoute: string | null;
  requestFormat: RequestContextFormat;
  parsedSessionId: string | null;
  captureGroupId: string | null;
  inputTokens: number | null;
  requestBody: string | null;
}

function mapProxyPredecessor(row: Record<string, unknown>): ProxyPredecessor {
  return {
    id: row.id as number,
    requestId: row.request_id as string,
    startedAt: row.started_at as string,
    hostname: row.hostname as string,
    model: row.model as string | null,
    captureMethod: row.capture_method as CaptureMethod,
    parserRoute: row.parser_route as string | null,
    requestFormat: row.request_format as RequestContextFormat,
    parsedSessionId: row.parsed_session_id as string | null,
    captureGroupId: row.capture_group_id as string | null,
    inputTokens: row.input_tokens as number | null,
    requestBody: row.request_body as string | null,
  };
}

export interface ListSessionsOptions {
  dataSource: DataSource;
  /** provider 多选（IN 过滤）。 */
  provider?: ProviderKey[];
  limit?: number;
  cursor?: string;
  keys?: string[];
  /** 标题 / session ID 大小写不敏感子串（服务端过滤）。 */
  q?: string;
  /** 时间范围（today | 7d | 30d | all；缺省不过滤）。 */
  range?: SessionRange;
  /** 状态多选过滤。 */
  status?: TraceStatus[];
  /** 标签多选过滤（D14）：OR 语义，JSON 数组包含谓词，一次 join 评估。 */
  tags?: string[];
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
    const groups = opts.groups ?? [];
    const requested = new Set(opts.keys);
    const fetchKeys = new Set(opts.keys);
    // SSE 对合并主键做局部 patch 时必须补齐整组，否则会把合并总量临时
    // 覆盖成主会话自身。只请求成员 key 时则保持精确成员，不重新折叠。
    const primaryGroups = groups.filter((group) => requested.has(group.primaryKey));
    for (const group of primaryGroups) {
      fetchKeys.add(group.primaryKey);
      for (const key of group.mergedKeys) {
        fetchKeys.add(key);
      }
    }
    const items: SessionIndexEntry[] = [];
    const stmt = cachedStmt(db, SESSION_BY_ID_SQL);
    for (const key of fetchKeys) {
      const row = stmt.get(key) as Record<string, unknown> | undefined;
      if (row !== undefined) {
        items.push(mapSessionIndex(row));
      }
    }
    const merged = mergeSessionIndex(items, primaryGroups);
    return { items: merged, nextCursor: null, hasMore: false, total: merged.length };
  }

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const providers = opts.provider !== undefined && opts.provider.length > 0 ? opts.provider : undefined;
  const hasProvider = providers !== undefined;
  const hasCursor = opts.cursor !== undefined;
  const q = opts.q !== undefined && opts.q !== '' ? opts.q : undefined;
  const hasQ = q !== undefined;
  const since = rangeSince(opts.range);
  const hasRange = since !== undefined;
  const statuses = opts.status !== undefined && opts.status.length > 0 ? opts.status : undefined;
  const tags = opts.tags !== undefined && opts.tags.length > 0 ? opts.tags : undefined;
  const flags: SessionsWhereFlags = {
    provider: providers?.length ?? 0,
    q: hasQ,
    range: hasRange,
    status: statuses?.length ?? 0,
    tags: tags?.length ?? 0,
    cursor: hasCursor,
  };
  const pattern = hasQ ? `%${escapeLike(q)}%` : undefined;
  const baseParams: unknown[] = [opts.dataSource];
  if (hasProvider) {
    baseParams.push(...providers);
  }
  if (pattern !== undefined) {
    baseParams.push(pattern, pattern);
  }
  if (hasRange) {
    baseParams.push(since);
  }
  if (statuses !== undefined) {
    baseParams.push(...statuses);
  }
  if (tags !== undefined) {
    baseParams.push(...tags);
  }
  const params = [...baseParams, ...(hasCursor ? [opts.cursor] : []), limit + 1];

  const rows = cachedStmt(db, sessionListSql(flags)).all(...params) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = mergeSessionIndex(page.map(mapSessionIndex), opts.groups ?? []);
  const last = items.at(-1);
  const countRow = cachedStmt(db, sessionCountSql({ ...flags, cursor: false })).get(
    ...baseParams,
  ) as { c: number };
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

/**
 * design D4 step 1：同 parsed_session_id + request_format 的最近更早行（id < beforeId）。
 * 显式列、缓存语句、不选 raw 列。
 */
export function findExactSessionPredecessor(
  db: Database,
  parsedSessionId: string,
  requestFormat: RequestContextFormat,
  beforeId: number,
): ProxyPredecessor | null {
  const row = cachedStmt(db, EXACT_SESSION_PREDECESSOR_SQL).get(
    parsedSessionId,
    requestFormat,
    beforeId,
  ) as Record<string, unknown> | undefined;
  return row === undefined ? null : mapProxyPredecessor(row);
}

/**
 * design D4 step 2：同 capture_group_id + request_format + null-safe model 相等的
 * 最近更早行（id < beforeId）。冲突判定（双方非空且不同的 parsed_session_id）
 * 由 context-diff 服务在拿到候选行后执行。
 */
export function findCaptureGroupPredecessor(
  db: Database,
  captureGroupId: string,
  requestFormat: RequestContextFormat,
  model: string | null,
  beforeId: number,
): ProxyPredecessor | null {
  const row = cachedStmt(db, CAPTURE_GROUP_PREDECESSOR_SQL).get(
    captureGroupId,
    requestFormat,
    model,
    beforeId,
  ) as Record<string, unknown> | undefined;
  return row === undefined ? null : mapProxyPredecessor(row);
}
