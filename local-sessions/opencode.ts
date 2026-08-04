import type { OpenCodePart } from '../src/adapters/opencode.js';
import { opencodeAdapter } from '../src/adapters/opencode.js';
import { toIsoFromMs } from '../src/adapters/helpers.js';
import { openReadonly } from '../server/storage/db.js';
import type { Database } from 'better-sqlite3';
import {
  makeSqliteScanner,
  type SqliteSessionMeta,
} from './scanner-utils.js';

interface OpenCodeDbMessageRow {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time?: string | { created?: number; completed?: number };
  model: string | null;
  tokens?: string | Record<string, unknown> | null;
  error: string | null;
  parentID: string | null;
  info: string | null;
}

interface OpenCodeDbPartRow {
  messageID: string;
  type: string;
  text: string | null;
  tool: string | null;
  state: string | Record<string, unknown> | null;
}

/** 真实 OpenCode DB（v2+）与 fixture 旧 schema 的差异点。 */
interface OpenCodeDbDialect {
  /** session 表时间列：epoch 用 time_created/time_updated，旧版用 JSON time 列。 */
  sessionTime: 'epoch' | 'legacy';
  /** message/part 是否只有 JSON data 列（真实 schema）。 */
  dataCols: boolean;
}

function detectOpenCodeDialect(db: Database): OpenCodeDbDialect {
  const sessionCols = db.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>;
  const messageCols = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>;
  const partCols = db.prepare('PRAGMA table_info(part)').all() as Array<{ name: string }>;
  const has = (cols: Array<{ name: string }>, name: string): boolean =>
    cols.some((c) => c.name === name);
  return {
    sessionTime: has(sessionCols, 'time_created') ? 'epoch' : 'legacy',
    dataCols: has(messageCols, 'data') && has(partCols, 'data'),
  };
}

function parseJson<T>(value: string | T | null | undefined): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export interface OpenCodeSessionSample {
  session: { id?: string; title?: string; directory?: string; time?: { created?: number; updated?: number } };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    sessionID: string;
    time?: { created?: number; completed?: number };
    model?: string | null;
    tokens?: Record<string, unknown> | null;
    error?: string | null;
    content?: OpenCodePart[];
  }>;
}

/**
 * REQ-010（T-03）：读取 OpenCode 系 SQLite（message 表 join part 表），
 * 按 session 行展开为 N 个会话样本；session 表缺失的 sessionID 从 message 行兜底。
 */
export function readOpenCodeDb(dbPath: string): OpenCodeSessionSample[] {
  const db = openReadonly(dbPath);
  try {
    const dialect = detectOpenCodeDialect(db);
    const sessionRows = (
      dialect.sessionTime === 'epoch'
        ? db.prepare(
            'SELECT id, title, version, directory, time_created, time_updated FROM session ORDER BY rowid',
          )
        : db.prepare('SELECT id, title, version, time, directory FROM session ORDER BY rowid')
    ).all() as Array<Record<string, unknown>>;
    const rawMessages = (
      dialect.dataCols
        ? db.prepare('SELECT id, session_id, data FROM message ORDER BY rowid')
        : db.prepare(
            'SELECT id, sessionID, role, time, model, tokens, error, parentID, info FROM message ORDER BY rowid',
          )
    ).all() as Array<Record<string, unknown>>;
    const rawParts = (
      dialect.dataCols
        ? db.prepare('SELECT message_id, data FROM part ORDER BY rowid')
        : db.prepare('SELECT messageID, type, text, tool, state FROM part ORDER BY rowid')
    ).all() as Array<Record<string, unknown>>;

    const partsByMessage = new Map<string, OpenCodePart[]>();
    for (const part of rawParts) {
      const messageID = String(part.message_id ?? part.messageID);
      const list = partsByMessage.get(messageID) ?? [];
      if (dialect.dataCols) {
        const data = parseJson<Record<string, unknown>>(part.data as string | null) ?? {};
        list.push({
          type: typeof data.type === 'string' ? data.type : 'text',
          text: typeof data.text === 'string' ? data.text : undefined,
          tool: typeof data.tool === 'string' ? data.tool : undefined,
          state: data.state as OpenCodePart['state'] | undefined,
        });
      } else {
        const typed = part as unknown as OpenCodeDbPartRow;
        list.push({
          type: typed.type,
          text: typed.text ?? undefined,
          tool: typed.tool ?? undefined,
          state: parseJson<OpenCodePart['state']>(typed.state) ?? undefined,
        });
      }
      partsByMessage.set(messageID, list);
    }

    const rawToMessage = (m: Record<string, unknown>): OpenCodeDbMessageRow => {
      if (dialect.dataCols) {
        const data = parseJson<Record<string, unknown>>(m.data as string | null) ?? {};
        const model =
          typeof data.modelID === 'string'
            ? data.modelID
            : typeof data.model === 'string'
              ? data.model
              : typeof data.model === 'object' && data.model !== null
                ? String((data.model as Record<string, unknown>).modelID ?? '')
                : null;
        return {
          id: String(m.id),
          sessionID: String(m.session_id),
          role: data.role === 'user' ? 'user' : 'assistant',
          time: data.time as { created?: number; completed?: number } | undefined,
          model,
          tokens: data.tokens as Record<string, unknown> | null,
          error: typeof data.error === 'string' ? data.error : null,
          parentID: typeof data.parentID === 'string' ? data.parentID : null,
          info: null,
        };
      }
      const typed = m as unknown as OpenCodeDbMessageRow;
      return {
        id: typed.id,
        role: typed.role,
        sessionID: typed.sessionID,
        time: parseJson<{ created?: number; completed?: number }>(typed.time) ?? undefined,
        model: typed.model,
        tokens: typeof typed.tokens === 'string' ? parseJson<Record<string, unknown>>(typed.tokens) : typed.tokens,
        error: typed.error,
        parentID: typed.parentID,
        info: typed.info,
      };
    };

    const messageRows = rawMessages.map(rawToMessage);
    const sessions = new Map<string, Record<string, unknown>>();
    for (const row of sessionRows) {
      sessions.set(String(row.id), row);
    }
    const messagesBySession = new Map<string, OpenCodeSessionSample['messages']>();
    for (const message of messageRows) {
      if (!sessions.has(message.sessionID)) {
        sessions.set(message.sessionID, { id: message.sessionID });
      }
      const list = messagesBySession.get(message.sessionID) ?? [];
      list.push({
        id: message.id,
        role: message.role,
        sessionID: message.sessionID,
        time:
          typeof message.time === 'string'
            ? (parseJson<{ created?: number; completed?: number }>(message.time) ?? undefined)
            : message.time,
        model: message.model,
        tokens:
          typeof message.tokens === 'string'
            ? (parseJson<Record<string, unknown>>(message.tokens) ?? null)
            : message.tokens,
        error: message.error,
        content: partsByMessage.get(message.id) ?? [],
      });
      messagesBySession.set(message.sessionID, list);
    }

    const samples: OpenCodeSessionSample[] = [];
    for (const [sessionId, session] of sessions) {
      const sessionMessages = messagesBySession.get(sessionId) ?? [];
      const sessionTime =
        dialect.sessionTime === 'epoch'
          ? {
              created: Number(session.time_created) || undefined,
              updated: Number(session.time_updated) || undefined,
            }
          : (parseJson<{ created?: number; updated?: number }>(session.time as string | null) ?? undefined);
      samples.push({
        session: {
          id: typeof session.id === 'string' ? session.id : undefined,
          title: typeof session.title === 'string' ? session.title : undefined,
          directory: typeof session.directory === 'string' ? session.directory : undefined,
          time: sessionTime,
        },
        messages: sessionMessages.map((m) => ({
          id: m.id,
          role: m.role,
          sessionID: m.sessionID,
          time: parseJson<{ created?: number; completed?: number }>(m.time) ?? undefined,
          model: m.model,
          tokens: parseJson<Record<string, unknown>>(m.tokens),
          error: m.error,
          content: partsByMessage.get(m.id) ?? [],
        })),
      });
    }
    return samples;
  } finally {
    db.close();
  }
}

/**
 * T-03 索引阶段轻量 SQL：只取 session id / title / 时间戳，
 * 不读 message / part 正文（预算：单库 < 50ms）。
 */
export function readOpenCodeSessionIndex(dbPath: string): SqliteSessionMeta[] {
  const db = openReadonly(dbPath);
  try {
    const dialect = detectOpenCodeDialect(db);
    const rows = (
      dialect.sessionTime === 'epoch'
        ? db.prepare('SELECT id, title, time_created, time_updated FROM session ORDER BY rowid')
        : db.prepare('SELECT id, title, time FROM session ORDER BY rowid')
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const title = typeof row.title === 'string' ? row.title : '';
      const time =
        dialect.sessionTime === 'epoch'
          ? { created: Number(row.time_created) || 0, updated: Number(row.time_updated) || 0 }
          : (parseJson<{ created?: number; updated?: number }>(row.time as string | null) ?? {});
      const created = time.created ?? 0;
      const updated =
        dialect.sessionTime === 'epoch' ? (Number(row.time_updated) || created) : (time.updated ?? created);
      return {
        id: String(row.id),
        title,
        startedAt: toIsoFromMs(created),
        updatedAt: toIsoFromMs(updated),
      };
    });
  } finally {
    db.close();
  }
}

export const opencodeScanner = makeSqliteScanner(
  'opencode',
  (dbPath, filePath) =>
    readOpenCodeDb(dbPath).map((sample) =>
      opencodeAdapter.normalize(
        { sourceAgent: 'OpenCode', session: sample.session, events: sample.messages },
        filePath,
      ),
    ),
  readOpenCodeSessionIndex,
);
