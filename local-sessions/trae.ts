import type { Database } from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { normalizeTraeSample, type TraeTurn } from '../src/adapters/trae.js';
import { openReadonly } from '../server/storage/db.js';
import { commitScanState, shouldRescan, sqliteFingerprint } from '../server/watch/scan-gate.js';
import { decryptTraeDb } from './trae-bridge.js';
import {
  buildIndexEntry,
  enumerateSourceFiles,
  storeTraceRecord,
  type FileScanResult,
  type ProviderScanner,
  type ScannerContext,
} from './scanner-utils.js';
import { deriveSessionKey } from './session-key.js';

interface TraeDbRow {
  id: string;
  session_id: string;
  status: string | null;
  type: string;
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
  title: string | null;
  agent_type: string | null;
  agent_name: string | null;
}

/** #7：history_v2 的 llm_default 消息（reasoning_content / content 回退）。 */
interface TraeLlmMessage {
  content: string | null;
  reasoningContent: string | null;
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

/**
 * #7（审查 P1）：读取解密后的 Trae SQLite。主表 server_history_info 必读；
 * chat_session / history_v2 / chat_message_task 为增强表，表或列不存在时优雅降级，
 * 不改变「1 文件 = 1 会话」的索引/详情口径（T-03）。
 */
export function readTraeDb(dbPath: string): {
  session: { id: string; title?: string; agentType?: string; agentName?: string };
  turns: TraeTurn[];
} {
  const db: Database = openReadonly(dbPath);
  try {
    const shiCols = columnNames(db, 'server_history_info');
    const rowCols = [
      'id', 'session_id', 'status', 'type', 'start_time', 'end_time',
      'content_source', 'token_usage', 'item_token_usage', 'content',
    ].filter((col) => shiCols.has(col));
    const hasCompress = shiCols.has('compress_token_usage');
    if (hasCompress) {
      rowCols.push('compress_token_usage');
    }
    const hasMessageId = shiCols.has('message_id');
    if (hasMessageId) {
      rowCols.push('message_id');
    }
    const rows = db
      .prepare(`SELECT ${rowCols.join(', ')} FROM server_history_info ORDER BY start_time`)
      .all() as TraeDbRow[];
    const sessionId = rows[0]?.session_id ?? 'trae';

    const sessionMeta = readSessionMeta(db, sessionId);
    const llmMessages = readHistoryLlmMessages(db, sessionId);
    const toolCalls = hasMessageId ? readToolCalls(db) : new Map<string, TraeTurn>();

    let llmIndex = 0;
    const turns = rows.map((row): TraeTurn => {
      const llmFallback =
        row.content_source === 'llm_default' ? llmMessages[llmIndex++] ?? null : null;
      const tool = row.message_id !== undefined && row.message_id !== null
        ? toolCalls.get(row.message_id) ?? null
        : null;
      const fallbackContent =
        llmFallback?.content != null && llmFallback.content !== ''
          ? llmFallback.content
          : undefined;
      return {
        id: row.id,
        sessionId: row.session_id,
        status: row.status ?? undefined,
        type: row.type,
        startTime: row.start_time ?? undefined,
        endTime: row.end_time ?? undefined,
        contentSource: row.content_source ?? undefined,
        tokenUsage:
          row.token_usage ??
          (hasCompress ? row.compress_token_usage ?? undefined : undefined),
        itemTokenUsage: row.item_token_usage ?? undefined,
        content: row.content ?? fallbackContent,
        reasoningContent:
          row.content_source === 'llm_default' ? llmFallback?.reasoningContent ?? undefined : undefined,
        toolName: tool?.toolName,
        toolParams: tool?.toolParams,
        toolResult: tool?.toolResult,
      };
    });
    return {
      session: {
        id: sessionId,
        title: sessionMeta.title ?? undefined,
        agentType: sessionMeta.agent_type ?? undefined,
        agentName: sessionMeta.agent_name ?? undefined,
      },
      turns,
    };
  } finally {
    db.close();
  }
}

/** #7：chat_session 元数据（title/agent_type/agent_name），表或列缺失时返回空。 */
function readSessionMeta(db: Database, sessionId: string): TraeSessionMeta {
  if (!tableExists(db, 'chat_session')) {
    return { title: null, agent_type: null, agent_name: null };
  }
  const cols = columnNames(db, 'chat_session');
  const pick = ['session_id', 'title', 'agent_type', 'agent_name'].filter((col) => cols.has(col));
  if (pick.length <= 1) {
    return { title: null, agent_type: null, agent_name: null };
  }
  const idCol = cols.has('session_id') ? 'session_id' : cols.has('id') ? 'id' : null;
  if (idCol === null) {
    return { title: null, agent_type: null, agent_name: null };
  }
  const row = db
    .prepare(`SELECT ${pick.join(', ')} FROM chat_session WHERE ${idCol} = ? LIMIT 1`)
    .get(sessionId) as TraeSessionMeta | undefined;
  return row ?? { title: null, agent_type: null, agent_name: null };
}

/** #7：history_v2.messages JSON 中的 reasoning_content / content（llm_default 行）。 */
function readHistoryLlmMessages(db: Database, sessionId: string): TraeLlmMessage[] {
  if (!tableExists(db, 'history_v2')) {
    return [];
  }
  const cols = columnNames(db, 'history_v2');
  if (!cols.has('messages')) {
    return [];
  }
  const select = ['messages'].filter((col) => cols.has(col));
  const contentCol = cols.has('content_source') ? 'content_source' : null;
  const sessionCol = cols.has('session_id') ? 'session_id' : null;
  const orderCol = cols.has('created_at') ? 'created_at' : null;
  const where = sessionCol !== null ? ` WHERE ${sessionCol} = ?` : '';
  const order = orderCol !== null ? ` ORDER BY ${orderCol}` : '';
  const rows = db
    .prepare(
      `SELECT ${select.join(', ')}${contentCol !== null ? `, ${contentCol}` : ''} ` +
        `FROM history_v2${where}${order}`,
    )
    .all(sessionId) as Array<{ messages: string; content_source: string | null }>;
  const out: TraeLlmMessage[] = [];
  for (const row of rows) {
    if (contentCol !== null && row.content_source !== 'llm_default') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.messages);
    } catch {
      continue;
    }
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      const m = message as { content?: unknown; reasoning_content?: unknown };
      if (m === null || typeof m !== 'object') {
        continue;
      }
      const content = typeof m.content === 'string' ? m.content : null;
      const reasoning = typeof m.reasoning_content === 'string' ? m.reasoning_content : null;
      if (content !== null || reasoning !== null) {
        out.push({ content, reasoningContent: reasoning });
      }
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
  const sample = readTraeDb(decrypted.decryptedPath);
  const record = normalizeTraeSample(
    { sourceAgent: 'Trae', session: sample.session, events: sample.turns },
    filePath,
  );
  // T-02：Trae 解密发生在详情阶段，索引阶段拿不到行内 id，
  // 统一按文件路径派生，避免索引/详情 key 不一致产生重复行。
  const key = deriveSessionKey(config.key, filePath);
  storeTraceRecord(ctx.db, record, filePath, key, ctx.notify);
  commitScanState(ctx.db, {
    sourcePath: filePath,
    provider: config.key,
    sessionId: key,
    fp: gate.fp,
    byteOffset: gate.fp.size,
    eventCount: record.events.length,
  });
  return { key, skipped: false, eventCount: record.events.length };
}

export const traeScanner: ProviderScanner = {
  key: 'trae',
  sourceKind: 'sqlcipher',
  // T-03 说明：Trae SQLCipher 需解密后才能读 session 行，索引阶段不得解密（REQ-013），
  // 因此索引粒度保持「1 文件 = 1 条目」，key 与详情阶段同为 deriveSessionKey(config.key, filePath)。
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
