import type { Database } from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { normalizeTraeSample, type TraeTurn } from '../src/adapters/trae.js';
import { openReadonly } from '../server/storage/db.js';
import { commitScanState, shouldRescan, sqliteFingerprint } from '../server/watch/scan-gate.js';
import { decryptTraeDb } from './trae-bridge.js';
import {
  buildTraePromptContextDraft,
  extractTraeUserEnvelope,
  type TraePromptContextDraft,
} from './trae-prompt-context.js';
import { deriveSessionKey } from './session-key.js';
import { deletePromptContext, upsertPromptContext } from '../server/storage/prompt-context.js';
import {
  buildIndexEntry,
  enumerateSourceFiles,
  storeAuthoritativeSourceRecords,
  type FileScanResult,
  type ProviderScanner,
  type ScannerContext,
} from './scanner-utils.js';

interface TraeDbRow {
  id: string;
  session_id: string;
  status: string | null;
  type: string | null;
  start_time: number | null;
  end_time: number | null;
  content_source: string | null;
  token_usage: number | null;
  item_token_usage: number | null;
  content: string | null;
  /** 可选增强列（存在时才查询）。 */
  compress_token_usage?: number | null;
  message_id?: string | null;
}

/** #7：chat_session 提供的会话元数据（title / agent_type / agent_name）。 */
interface TraeSessionMeta {
  id: string;
  title: string | null;
  agent_type: string | null;
  agent_name: string | null;
  start_time: number | null;
  end_time: number | null;
}

export interface TraeDbSession {
  session: {
    id: string;
    title?: string;
    startTime?: number;
    endTime?: number;
    agentType?: string;
    agentName?: string;
  };
  turns: TraeTurn[];
  promptContext?: TraePromptContextDraft;
}

interface TraeTurnPromptMeta {
  context: string | null;
  updatedAt: number | null;
  agentType: string | null;
  agentName: string | null;
}

/** #7：history_v2 的 llm_default 消息（reasoning_content / content 回退）。 */
interface TraeLlmMessage {
  content: string | null;
  reasoningContent: string | null;
}

interface ParsedTraeMessage extends TraeLlmMessage {
  role: string | null;
  toolName: string | null;
  toolParams: string | null;
}

function tableExists(db: Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

function columnNames(db: Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function pickColumn(columns: Set<string>, candidates: readonly string[]): string | null {
  return candidates.find((column) => columns.has(column)) ?? null;
}

function selectAs(
  columns: Set<string>,
  candidates: readonly string[],
  alias: keyof TraeDbRow,
): string {
  const column = pickColumn(columns, candidates);
  return column === null ? `NULL AS ${alias}` : `${column} AS ${alias}`;
}

function contentText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (item !== null && typeof item === 'object') {
      const block = item as { text?: unknown; content?: unknown };
      if (typeof block.text === 'string') {
        parts.push(block.text);
      } else if (typeof block.content === 'string') {
        parts.push(block.content);
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function parseToolCall(value: unknown): { name: string | null; params: string | null } {
  if (value === null || typeof value !== 'object') {
    return { name: null, params: null };
  }
  const call = value as {
    name?: unknown;
    arguments?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  const name = call.function?.name ?? call.name;
  const params = call.function?.arguments ?? call.arguments;
  return {
    name: typeof name === 'string' ? name : null,
    params:
      typeof params === 'string'
        ? params
        : params !== undefined
          ? JSON.stringify(params)
          : null,
  };
}

/** Trae wraps the real prompt in IDE-injected reminders; keep only user intent. */
function extractTaggedUserInput(content: string): string | undefined {
  // Injected instructions may mention the literal placeholder `<user_input>`
  // both before and after the real prompt. Anchor on the real closing tag and
  // pair it with the nearest preceding opening tag.
  const openings = [...content.matchAll(/<user_input(?:\s[^>]*)?>/gi)];
  const closings = [...content.matchAll(/<\/user_input>/gi)];
  const closing = closings.at(-1);
  const opening = closing?.index === undefined
    ? openings.at(-1)
    : openings.filter((candidate) => candidate.index! < closing.index!).at(-1);
  if (opening?.index === undefined) return undefined;
  const start = opening.index + opening[0].length;
  const end = closing?.index !== undefined && closing.index >= start ? closing.index : content.length;
  return content.slice(start, end).trim();
}

/**
 * Current Trae stores `messages` as `{ raw_messages: [...] }`; older fixtures
 * store the message array directly, and the oldest schema has a plain `content`
 * string. Normalize all three without returning the JSON envelope as UI text.
 */
function parseTraeMessagePayload(raw: string | null): ParsedTraeMessage {
  if (raw === null || raw === '') {
    return { content: null, reasoningContent: null, role: null, toolName: null, toolParams: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { content: raw, reasoningContent: null, role: null, toolName: null, toolParams: null };
  }

  if (typeof parsed === 'string') {
    return { content: parsed, reasoningContent: null, role: null, toolName: null, toolParams: null };
  }
  const envelope = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { raw_messages?: unknown }
    : null;
  const messages = Array.isArray(envelope?.raw_messages)
    ? envelope.raw_messages
    : Array.isArray(parsed)
      ? parsed
      : parsed !== null && typeof parsed === 'object'
        ? [parsed]
        : [];

  const content: string[] = [];
  const reasoning: string[] = [];
  let role: string | null = null;
  let toolName: string | null = null;
  let toolParams: string | null = null;
  for (const value of messages) {
    if (value === null || typeof value !== 'object') {
      continue;
    }
    const message = value as {
      role?: unknown;
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown;
    };
    if (role === null && typeof message.role === 'string') {
      role = message.role;
    }
    const text = contentText(message.content);
    if (text !== null && text !== '') {
      content.push(text);
    }
    if (typeof message.reasoning_content === 'string' && message.reasoning_content !== '') {
      reasoning.push(message.reasoning_content);
    }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length > 0 && toolName === null) {
      const tool = parseToolCall(calls[0]);
      toolName = tool.name;
      toolParams = tool.params;
    }
  }
  const joinedContent = content.length > 0 ? content.join('\n') : null;
  const taggedUserInput =
    role?.toLowerCase() === 'user' && joinedContent !== null
      ? extractTaggedUserInput(joinedContent)
      : undefined;
  return {
    content: taggedUserInput === undefined ? joinedContent : taggedUserInput || null,
    reasoningContent: reasoning.length > 0 ? reasoning.join('\n') : null,
    role,
    toolName,
    toolParams,
  };
}

function canonicalTurnType(rawType: string | null, role: string | null): string {
  const type = rawType?.toLowerCase() ?? '';
  const normalizedRole = role?.toLowerCase() ?? '';
  if (type === 'user_input' || normalizedRole === 'user') {
    return 'user';
  }
  if (type === 'llm_default' || normalizedRole === 'assistant') {
    return 'llm';
  }
  if (['read', 'ls', 'glob', 'grep', 'search'].includes(type)) {
    return 'read_file';
  }
  if (['write', 'edit', 'searchreplace', 'search_replace'].includes(type)) {
    return 'write_file';
  }
  if (['bash', 'terminal', 'runcommand', 'run_command'].includes(type)) {
    return 'bash';
  }
  return rawType ?? (normalizedRole === 'tool' ? 'tool' : 'message');
}

/**
 * REQ-010: current Trae writes a chat_message.message_id into
 * server_history_info.session_id. Resolve it in one query; never prepare SQL
 * inside the row loop. Older schemas that already contain real session ids
 * simply miss this map and retain their original value.
 */
function readMessageSessionMap(db: Database): Map<string, string> {
  if (!tableExists(db, 'chat_message')) {
    return new Map();
  }
  const cols = columnNames(db, 'chat_message');
  if (!cols.has('message_id') || !cols.has('session_id')) {
    return new Map();
  }
  const rows = db
    .prepare('SELECT message_id, session_id FROM chat_message')
    .all() as Array<{ message_id: string; session_id: string }>;
  return new Map(rows.map((row) => [row.message_id, row.session_id]));
}

/**
 * aggregate-native-sessions D2：一次性读取全部原生会话元数据。Trae 当前把 agent
 * 元数据放在 chat_turn，而 title/时间仍在 chat_session；这里各执行一条查询并在
 * 内存合并，禁止按 session 循环 prepare。
 */
function readSessionMetas(db: Database): Map<string, TraeSessionMeta> {
  const metas = new Map<string, TraeSessionMeta>();
  if (tableExists(db, 'chat_session')) {
    const cols = columnNames(db, 'chat_session');
    const idCol = pickColumn(cols, ['session_id', 'id']);
    if (idCol !== null) {
      const titleCol = pickColumn(cols, ['title', 'session_title']);
      const agentTypeCol = pickColumn(cols, ['agent_type']);
      const agentNameCol = pickColumn(cols, ['agent_name']);
      const startCol = pickColumn(cols, ['created_at', 'start_time']);
      const endCol = pickColumn(cols, ['updated_at', 'end_time', 'created_at']);
      const rows = db
        .prepare(
          `SELECT ${idCol} AS id, ` +
          `${titleCol === null ? 'NULL' : titleCol} AS title, ` +
          `${agentTypeCol === null ? 'NULL' : agentTypeCol} AS agent_type, ` +
          `${agentNameCol === null ? 'NULL' : agentNameCol} AS agent_name, ` +
          `${startCol === null ? 'NULL' : startCol} AS start_time, ` +
          `${endCol === null ? 'NULL' : endCol} AS end_time ` +
          `FROM chat_session${startCol === null ? '' : ` ORDER BY ${startCol}`}`,
        )
        .all() as TraeSessionMeta[];
      for (const row of rows) {
        metas.set(row.id, row);
      }
    }
  }

  if (tableExists(db, 'chat_turn')) {
    const cols = columnNames(db, 'chat_turn');
    const sessionCol = pickColumn(cols, ['session_id']);
    const agentTypeCol = pickColumn(cols, ['agent_type']);
    const agentNameCol = pickColumn(cols, ['agent_name']);
    const orderCol = pickColumn(cols, ['created_at', 'id']);
    if (sessionCol !== null && (agentTypeCol !== null || agentNameCol !== null)) {
      const rows = db
        .prepare(
          `SELECT ${sessionCol} AS session_id, ` +
          `${agentTypeCol === null ? 'NULL' : agentTypeCol} AS agent_type, ` +
          `${agentNameCol === null ? 'NULL' : agentNameCol} AS agent_name ` +
          `FROM chat_turn${orderCol === null ? '' : ` ORDER BY ${orderCol}`}`,
        )
        .all() as Array<{
          session_id: string;
          agent_type: string | null;
          agent_name: string | null;
        }>;
      for (const row of rows) {
        const meta = metas.get(row.session_id);
        if (meta === undefined) {
          continue;
        }
        meta.agent_type ??= row.agent_type;
        meta.agent_name ??= row.agent_name;
      }
    }
  }
  return metas;
}

/** 一次查询读取每个原生 session 最新的 chat_turn.context，禁止按会话循环查询。 */
function readLatestTurnPromptMetas(db: Database): Map<string, TraeTurnPromptMeta> {
  const out = new Map<string, TraeTurnPromptMeta>();
  if (!tableExists(db, 'chat_turn')) {
    return out;
  }
  const cols = columnNames(db, 'chat_turn');
  const sessionCol = pickColumn(cols, ['session_id']);
  const contextCol = pickColumn(cols, ['context']);
  if (sessionCol === null || contextCol === null) {
    return out;
  }
  const updatedCol = pickColumn(cols, ['updated_at', 'created_at']);
  const agentTypeCol = pickColumn(cols, ['agent_type']);
  const agentNameCol = pickColumn(cols, ['agent_name']);
  const rows = db
    .prepare(
      `SELECT ${sessionCol} AS session_id, ${contextCol} AS context, ` +
      `${updatedCol === null ? 'NULL' : updatedCol} AS updated_at, ` +
      `${agentTypeCol === null ? 'NULL' : agentTypeCol} AS agent_type, ` +
      `${agentNameCol === null ? 'NULL' : agentNameCol} AS agent_name ` +
      `FROM chat_turn${updatedCol === null ? '' : ` ORDER BY ${updatedCol}`}`,
    )
    .all() as Array<{
      session_id: string;
      context: string | null;
      updated_at: number | null;
      agent_type: string | null;
      agent_name: string | null;
    }>;
  for (const row of rows) {
    out.set(row.session_id, {
      context: row.context,
      updatedAt: row.updated_at,
      agentType: row.agent_type,
      agentName: row.agent_name,
    });
  }
  return out;
}

function traeTimestampIso(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return new Date(0).toISOString();
  }
  return new Date(value * 1000).toISOString();
}

/**
 * 读取解密后的 Trae SQLite，并以 chat_session.session_id 为边界返回 N 个会话。
 * server_history_info 的 session 引用若实际是 message_id，先经 chat_message 映射，
 * 再进行分组，任何会话都不会消费另一个会话的正文或 token 行。
 */
export function readTraeDb(dbPath: string): TraeDbSession[] {
  const db: Database = openReadonly(dbPath);
  try {
    const shiCols = columnNames(db, 'server_history_info');
    const idCol = pickColumn(shiCols, ['id', 'history_id', 'client_history_id']);
    const sessionCol = pickColumn(shiCols, ['session_id', 'conversation_id']);
    if (idCol === null || sessionCol === null) {
      throw new Error('Unsupported Trae server_history_info schema: missing id/session columns');
    }
    const rowCols = [
      `${idCol} AS id`,
      `${sessionCol} AS session_id`,
      selectAs(shiCols, ['status'], 'status'),
      selectAs(shiCols, ['type', 'source', 'content_source'], 'type'),
      selectAs(shiCols, ['start_time', 'created_at'], 'start_time'),
      selectAs(shiCols, ['end_time', 'updated_at', 'created_at'], 'end_time'),
      selectAs(shiCols, ['content_source', 'source'], 'content_source'),
      selectAs(shiCols, ['token_usage'], 'token_usage'),
      selectAs(shiCols, ['item_token_usage'], 'item_token_usage'),
      selectAs(shiCols, ['content', 'messages'], 'content'),
    ];
    const hasCompress = shiCols.has('compress_token_usage');
    if (hasCompress) {
      rowCols.push('compress_token_usage AS compress_token_usage');
    }
    const hasMessageId = shiCols.has('message_id');
    if (hasMessageId) {
      rowCols.push('message_id AS message_id');
    }
    const orderCol = pickColumn(shiCols, ['start_time', 'created_at', 'id', 'history_id']) ?? idCol;
    const rows = db
      .prepare(`SELECT ${rowCols.join(', ')} FROM server_history_info ORDER BY ${orderCol}`)
      .all() as TraeDbRow[];
    const messageSessionMap = readMessageSessionMap(db);
    const resolveSessionId = (value: string): string => messageSessionMap.get(value) ?? value;
    const sessionMetas = readSessionMetas(db);
    const turnPromptMetas = readLatestTurnPromptMetas(db);
    // B8.4（calibrate-tokens §10）：按 session_id 分组，修复多 session 文件的错位。
    const llmMessagesBySession = readHistoryLlmMessages(db);
    const toolCalls = hasMessageId ? readToolCalls(db) : new Map<string, TraeTurn>();

    const consumedBySession = new Map<string, number>();
    const turnsBySession = new Map<string, TraeTurn[]>();
    const promptMessagesBySession = new Map<string, { raw: string; capturedAt: number | null }>();
    for (const row of rows) {
      const payload = parseTraeMessagePayload(row.content);
      const resolvedSessionId = resolveSessionId(row.session_id);
      if (extractTraeUserEnvelope(row.content) !== null) {
        promptMessagesBySession.set(resolvedSessionId, {
          raw: row.content ?? '',
          capturedAt: row.start_time ?? row.end_time,
        });
      }
      // 每行只消费自己 session_id 的 llm 消息；跨 session 不挪用正文。
      const list = llmMessagesBySession.get(resolvedSessionId) ?? null;
      const index = consumedBySession.get(resolvedSessionId) ?? 0;
      const llmFallback =
        row.content_source === 'llm_default' && list !== null ? list[index] ?? null : null;
      if (llmFallback !== null) {
        consumedBySession.set(resolvedSessionId, index + 1);
      }
      const tool = row.message_id !== undefined && row.message_id !== null
        ? toolCalls.get(row.message_id) ?? null
        : null;
      const fallbackContent =
        llmFallback?.content != null && llmFallback.content !== ''
          ? llmFallback.content
          : undefined;
      const type = canonicalTurnType(row.type, payload.role);
      const sourceToolName =
        payload.role === 'tool' && row.content_source !== null
          ? row.content_source
          : undefined;
      const turn: TraeTurn = {
        id: row.id,
        sessionId: resolvedSessionId,
        status: row.status ?? undefined,
        type,
        startTime: row.start_time ?? undefined,
        endTime: row.end_time ?? undefined,
        contentSource: row.content_source ?? undefined,
        tokenUsage:
          row.token_usage ??
          (hasCompress ? row.compress_token_usage ?? undefined : undefined),
        itemTokenUsage: row.item_token_usage ?? undefined,
        content: payload.content ?? fallbackContent,
        reasoningContent:
          payload.reasoningContent ??
          (row.content_source === 'llm_default' ? llmFallback?.reasoningContent ?? undefined : undefined),
        toolName: tool?.toolName ?? payload.toolName ?? sourceToolName,
        toolParams: tool?.toolParams ?? payload.toolParams ?? undefined,
        toolResult: tool?.toolResult ?? (payload.role === 'tool' ? payload.content ?? undefined : undefined),
      };
      const turns = turnsBySession.get(resolvedSessionId) ?? [];
      turns.push(turn);
      turnsBySession.set(resolvedSessionId, turns);
      const existingMeta = sessionMetas.get(resolvedSessionId);
      if (existingMeta === undefined) {
        sessionMetas.set(resolvedSessionId, {
          id: resolvedSessionId,
          title: null,
          agent_type: null,
          agent_name: null,
          start_time: row.start_time,
          end_time: row.end_time,
        });
      } else {
        existingMeta.start_time ??= row.start_time;
        existingMeta.end_time ??= row.end_time;
      }
    }

    return [...sessionMetas.values()].map((meta): TraeDbSession => {
      const promptMessage = promptMessagesBySession.get(meta.id);
      const turnPrompt = turnPromptMetas.get(meta.id);
      const promptContext = promptMessage === undefined
        ? null
        : buildTraePromptContextDraft({
            userMessageRaw: promptMessage.raw,
            turnContext: turnPrompt?.context ?? null,
            capturedAt: traeTimestampIso(promptMessage.capturedAt ?? turnPrompt?.updatedAt),
            agentType: turnPrompt?.agentType ?? meta.agent_type ?? undefined,
            agentName: turnPrompt?.agentName ?? meta.agent_name ?? undefined,
          });
      return {
        session: {
          id: meta.id,
          title: meta.title ?? undefined,
          startTime: meta.start_time ?? undefined,
          endTime: meta.end_time ?? undefined,
          agentType: meta.agent_type ?? undefined,
          agentName: meta.agent_name ?? undefined,
        },
        turns: turnsBySession.get(meta.id) ?? [],
        ...(promptContext === null ? {} : { promptContext }),
      };
    });
  } finally {
    db.close();
  }
}

/**
 * #7/B8.4（calibrate-tokens §10）：history_v2.messages JSON 中的
 * reasoning_content / content（llm_default 行），按 session_id 分组返回。
 *
 * 之前的实现只按 rows[0] 的 session_id 过滤后全局顺序消费 —— 若一个 DB 文件里
 * 存在多个 session_id，llmIndex++ 会把 A 会话的消息配到 B 会话的 llm 行上，
 * 正文与行错位。现在每行只消费自己 session_id 的消息，口径一致。
 */
function readHistoryLlmMessages(db: Database): Map<string, TraeLlmMessage[]> {
  if (!tableExists(db, 'history_v2')) {
    return new Map();
  }
  const cols = columnNames(db, 'history_v2');
  if (!cols.has('messages')) {
    return new Map();
  }
  const select = ['messages'].filter((col) => cols.has(col));
  const contentCol = cols.has('content_source') ? 'content_source' : null;
  const sessionCol = cols.has('session_id') ? 'session_id' : null;
  const orderCol = cols.has('created_at') ? 'created_at' : null;
  const order = orderCol !== null ? ` ORDER BY ${orderCol}` : '';
  const rows = db
    .prepare(
      `SELECT ${select.join(', ')}${contentCol !== null ? `, ${contentCol}` : ''}` +
        `${sessionCol !== null ? `, ${sessionCol}` : ''} FROM history_v2${order}`,
    )
    .all() as Array<{ messages: string; content_source: string | null; session_id: string | null }>;
  const out = new Map<string, TraeLlmMessage[]>();
  for (const row of rows) {
    if (contentCol !== null && row.content_source !== 'llm_default') {
      continue;
    }
    const message = parseTraeMessagePayload(row.messages);
    if (message.content !== null || message.reasoningContent !== null) {
      const key = sessionCol !== null && row.session_id !== null ? row.session_id : '';
      const list = out.get(key) ?? [];
      list.push({ content: message.content, reasoningContent: message.reasoningContent });
      out.set(key, list);
    }
  }
  return out;
}

/** #7：chat_message_task 工具调用（名称/参数/结果），按 message_id 关联。 */
function readToolCalls(db: Database): Map<string, TraeTurn> {
  const map = new Map<string, TraeTurn>();
  if (!tableExists(db, 'chat_message_task')) {
    return map;
  }
  const cols = columnNames(db, 'chat_message_task');
  const nameCol = ['tool_name', 'name', 'tool'].find((col) => cols.has(col));
  const paramsCol = ['tool_params', 'parameters', 'tool_input', 'params'].find((col) => cols.has(col));
  const resultCol = ['tool_result', 'result', 'tool_output'].find((col) => cols.has(col));
  if (!cols.has('message_id') || nameCol === undefined) {
    return map;
  }
  const select = ['message_id', nameCol, ...(paramsCol !== undefined ? [paramsCol] : []),
    ...(resultCol !== undefined ? [resultCol] : [])];
  const rows = db
    .prepare(`SELECT ${select.join(', ')} FROM chat_message_task`)
    .all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    map.set(String(row.message_id), {
      id: String(row.message_id),
      type: 'tool',
      toolName: row[nameCol] != null ? String(row[nameCol]) : undefined,
      toolParams: paramsCol !== undefined && row[paramsCol] != null ? JSON.stringify(row[paramsCol]) : undefined,
      toolResult: resultCol !== undefined && row[resultCol] != null ? String(row[resultCol]) : undefined,
    });
  }
  return map;
}

async function scanTraeFile(
  config: ProviderConfig,
  filePath: string,
  ctx: ScannerContext,
): Promise<FileScanResult> {
  if (ctx.traeKeyPath === null || ctx.traeKeyPath === undefined || ctx.traeKeyPath === '') {
    return { key: null, skipped: false, eventCount: 0, blocked: 'TRAE_KEY_MISSING' };
  }
  const gate = shouldRescan(ctx.db, filePath, sqliteFingerprint);
  if (!gate.changed && !ctx.force) {
    return { key: null, skipped: true, eventCount: 0 };
  }
  const decrypted = await decryptTraeDb(filePath, {
    keyPath: ctx.traeKeyPath,
    ...ctx.traeBridge,
  });
  if (!decrypted.ok) {
    return { key: null, skipped: false, eventCount: 0, blocked: decrypted.code };
  }
  const samples = readTraeDb(decrypted.decryptedPath);
  const records = samples.map((sample) => normalizeTraeSample(
    { sourceAgent: 'Trae', session: sample.session, events: sample.turns },
    filePath,
  ));
  const { keys, eventCount } = storeAuthoritativeSourceRecords(
    ctx.db,
    config,
    filePath,
    records,
    ctx.notify,
  );
  for (const sample of samples) {
    const key = deriveSessionKey(config.key, filePath, sample.session.id);
    if (sample.promptContext === undefined) {
      deletePromptContext(ctx.db, key);
      continue;
    }
    upsertPromptContext(ctx.db, {
      sessionId: key,
      provider: 'trae',
      ...sample.promptContext,
    });
    ctx.notify?.(key);
  }
  commitScanState(ctx.db, {
    sourcePath: filePath,
    provider: config.key,
    sessionId: keys[0] ?? null,
    fp: gate.fp,
    byteOffset: gate.fp.size,
    eventCount,
  });
  return { key: keys[0] ?? null, skipped: false, eventCount };
}

export const traeScanner: ProviderScanner = {
  key: 'trae',
  sourceKind: 'sqlcipher',
  // SQLCipher 的启动索引阶段仍保持一个 pending 文件占位；后台解密后 scanTraeFile
  // 会用原生 session_id 派生 N 个 key，并由权威源快照清理这个占位。
  buildIndexEntries(config, filePath) {
    return [buildIndexEntry(config, filePath)];
  },
  async scanProvider(config, ctx) {
    const files = enumerateSourceFiles(config.path, 'sqlcipher');
    if (ctx.traeKeyPath === null || ctx.traeKeyPath === undefined || ctx.traeKeyPath === '') {
      return {
        provider: 'trae',
        files: files.length,
        scanned: 0,
        skipped: 0,
        eventCount: 0,
        blocked: 'TRAE_KEY_MISSING',
      };
    }
    const results: FileScanResult[] = [];
    for (const filePath of files) {
      results.push(await scanTraeFile(config, filePath, ctx));
    }
    const blocked = results.find((r) => r.blocked !== undefined)?.blocked;
    return {
      provider: 'trae',
      files: files.length,
      scanned: results.filter((r) => !r.skipped && r.blocked === undefined).length,
      skipped: results.filter((r) => r.skipped).length,
      eventCount: results.reduce((sum, r) => sum + r.eventCount, 0),
      blocked,
    };
  },
  async scanFile(config, filePath, ctx) {
    return scanTraeFile(config, filePath, ctx);
  },
};
