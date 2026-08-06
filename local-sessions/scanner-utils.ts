import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Database } from 'better-sqlite3';

import type {
  SessionIndexEntry,
  ProviderConfig,
  ProviderKey,
  SourceKind,
  TraceRecord,
} from '../src/core/trace-types.js';
import { cachedStmt } from '../server/storage/stmt-cache.js';
import {
  deleteSession,
  upsertEvents,
  upsertMetrics,
  upsertSessionFromIndex,
  upsertSessionFromTrace,
} from '../server/storage/writers.js';
import { fingerprintFile } from '../server/watch/fingerprint.js';
import { commitScanState, shouldRescan, sqliteFingerprint } from '../server/watch/scan-gate.js';
import { readJsonlFrom } from '../server/watch/jsonl-reader.js';
import { fallbackSessionTitle, readJsonlIndexMeta } from './index-title.js';
import { deriveSessionKey } from './session-key.js';
import { expandLocalSessionPath } from './config.js';
import type { TraeBridgeOptions } from './trae-bridge.js';

const UPSERT_EVENT_RAW_SQL =
  `INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?) ` +
  `ON CONFLICT(session_id, event_id) DO UPDATE SET raw = excluded.raw`;

const SET_DETAIL_LOADED_SQL = 'UPDATE sessions SET detail_loaded = 1 WHERE id = ?';
const SELECT_CLEANUP_CANDIDATES_SQL =
  `SELECT id, provider, source_path, detail_loaded FROM sessions WHERE data_source = 'scan'`;
const SELECT_SOURCE_SESSION_IDS_SQL =
  `SELECT id FROM sessions ` +
  `WHERE data_source = 'scan' AND provider = ? AND source_path = ?`;

/** T-03：可读的 SQLite 多会话 provider（索引按 session 行展开，不再产生文件级 key）。 */
const SQLITE_MULTI_SESSION_PROVIDERS: ReadonlySet<string> = new Set([
  'opencode',
  'codearts',
  'codeagent2',
  'trae',
]);

export interface ScannerContext {
  db: Database;
  force?: boolean;
  notify?: (key: string) => void;
  traeKeyPath?: string | null;
  /** trae-bridge 注入点（pythonBin/scriptPath 等，测试用真实子进程）。 */
  traeBridge?: Partial<TraeBridgeOptions>;
}

export interface FileScanResult {
  key: string | null;
  skipped: boolean;
  eventCount: number;
  blocked?: string;
}

export interface ProviderScanResult {
  provider: string;
  files: number;
  scanned: number;
  skipped: number;
  eventCount: number;
  blocked?: string;
  error?: string;
}

export interface ProviderScanner {
  key: ProviderKey;
  sourceKind: SourceKind;
  scanProvider(config: ProviderConfig, ctx: ScannerContext): Promise<ProviderScanResult>;
  scanFile(config: ProviderConfig, filePath: string, ctx: ScannerContext): Promise<FileScanResult>;
  /**
   * T-11（REQ-022）：惰性详情加载按「db 路径 + 行内 session id」定位**单个**会话
   * 并解析，只写该会话，不整库落库。SQLite 多会话 provider 提供；JSONL 类缺省走 scanFile。
   */
  scanSessionDetail?(
    config: ProviderConfig,
    filePath: string,
    key: string,
    ctx: ScannerContext,
  ): Promise<FileScanResult>;
  /**
   * T-03 索引阶段（REQ-013 第 1 阶段）：
   * - JSONL 类：每文件 1 条（buildIndexEntry）
   * - SQLite 类：按 db 内 session 行展开为 N 条（轻量 SQL，只读 id/title/时间戳）
   * 与详情阶段共用 deriveSessionKey 单一口径（T-02）。
   */
  buildIndexEntries(config: ProviderConfig, filePath: string): SessionIndexEntry[];
}

/** SQLite 类索引阶段的轻量元数据（只取 id/title/时间戳，不读 message/part 正文）。 */
export interface SqliteSessionMeta {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  /** REQ-021（fix-session-detail-display §3.2）：该会话事件数 = 保留 part 数。 */
  eventCount: number;
  /** 该会话 message 行数。 */
  messageCount: number;
}

export type SqliteIndexReader = (dbPath: string) => SqliteSessionMeta[];

/** REQ-010：按 sourceKind 递归枚举源文件（.jsonl / .db，跳过 dotfiles）。 */
export function enumerateSourceFiles(root: string, sourceKind: SourceKind): string[] {
  const dir = expandLocalSessionPath(root);
  if (!existsSync(dir)) {
    return [];
  }
  const ext = sourceKind === 'jsonl' ? '.jsonl' : '.db';
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        out.push(path);
      }
    }
  }
  return out.sort();
}

/**
 * TODO(D-003)：scanner 级 JSONL 尾部增量读需要「增量行合并进已存会话聚合」，
 * 当前实现为安全起见对变更文件全量重读；readJsonlFrom 的增量能力保留给未来接线。
 */
export function storeTraceRecord(
  db: Database,
  record: TraceRecord,
  sourcePath: string,
  key: string,
  notify?: (key: string) => void,
): string {
  upsertSessionFromTrace(db, { ...record.session, id: key });
  upsertEvents(db, key, record.events);
  for (const event of record.events) {
    const raw = (event as { raw?: string | null }).raw;
    if (raw !== undefined && raw !== null) {
      cachedStmt(db, UPSERT_EVENT_RAW_SQL).run(key, event.id, raw);
    }
  }
  if (record.metrics !== undefined) {
    upsertMetrics(db, key, record.metrics);
  }
  cachedStmt(db, SET_DETAIL_LOADED_SQL).run(key);
  notify?.(key);
  return key;
}

/**
 * aggregate-native-sessions D4：完整读取一个多会话数据库后，以本次返回的原生
 * 会话集合为权威快照。先全部写入，再清理由同一 provider/source 产生但已不在
 * 快照中的行；解析/归一化在调用前已全部完成，失败时不会进入清理阶段。
 */
export function storeAuthoritativeSourceRecords(
  db: Database,
  config: ProviderConfig,
  sourcePath: string,
  records: TraceRecord[],
  notify?: (key: string) => void,
): { keys: string[]; eventCount: number } {
  const planned = records.map((record) => ({
    key: deriveSessionKey(config.key, sourcePath, record.session.id),
    record,
  }));
  const currentKeys = new Set(planned.map(({ key }) => key));
  if (currentKeys.size !== planned.length) {
    throw new Error(`Duplicate native session id in ${config.key} source ${sourcePath}`);
  }
  const existing = cachedStmt(db, SELECT_SOURCE_SESSION_IDS_SQL).all(
    config.key,
    sourcePath,
  ) as Array<{ id: string }>;

  let eventCount = 0;
  for (const { key, record } of planned) {
    storeTraceRecord(db, record, sourcePath, key);
    eventCount += record.events.length;
  }
  for (const row of existing) {
    if (!currentKeys.has(row.id)) {
      deleteSession(db, row.id);
      notify?.(row.id);
    }
  }
  for (const { key } of planned) {
    notify?.(key);
  }
  return { keys: [...currentKeys], eventCount };
}

/**
 * T-02/T-03 自愈清理（仅 data_source='scan'）：
 * 1. 旧版 key 不一致残留：删除「同 source_path 同 provider 已有 detail_loaded=1 行」的
 *    detail_loaded=0 孤儿行；
 * 2. JSONL 类：删除 id ≠ deriveSessionKey(provider, source_path) 的行
 *    （旧 adapter-id 派生的不可达残留，源文件仍在时由索引阶段重建）；
 * 3. 可读 SQLite 类：删除 id == deriveSessionKey(provider, source_path) 的
 *    文件级伪会话（T-03 后索引不再产生该 key）。
 * 正常未打开的会话（key 规范且无 loaded 兄弟行）不受影响。
 */
export function cleanupDuplicateSessionRows(db: Database): number {
  const rows = cachedStmt(db, SELECT_CLEANUP_CANDIDATES_SQL).all() as Array<{
    id: string;
    provider: string;
    source_path: string;
    detail_loaded: number;
  }>;
  if (rows.length === 0) {
    return 0;
  }
  const loadedBySource = new Map<string, boolean>();
  for (const row of rows) {
    if (row.detail_loaded === 1) {
      loadedBySource.set(`${row.provider}\u0000${row.source_path}`, true);
    }
  }
  const orphanIds = new Set<string>();
  for (const row of rows) {
    const provider = row.provider as ProviderKey;
    if (SQLITE_MULTI_SESSION_PROVIDERS.has(provider)) {
      if (row.id === deriveSessionKey(provider, row.source_path)) {
        orphanIds.add(row.id);
      }
      continue;
    }
    const canonical = deriveSessionKey(provider, row.source_path);
    if (row.id !== canonical) {
      orphanIds.add(row.id);
    } else if (
      row.detail_loaded === 0 &&
      loadedBySource.has(`${row.provider}\u0000${row.source_path}`)
    ) {
      orphanIds.add(row.id);
    }
  }
  if (orphanIds.size === 0) {
    return 0;
  }
  const run = db.transaction(() => {
    for (const id of orphanIds) {
      cachedStmt(db, 'DELETE FROM event_raw WHERE session_id = ?').run(id);
      cachedStmt(db, 'DELETE FROM events WHERE session_id = ?').run(id);
      cachedStmt(db, 'DELETE FROM metrics WHERE session_id = ?').run(id);
      cachedStmt(db, 'DELETE FROM scan_state WHERE session_id = ?').run(id);
      cachedStmt(db, 'DELETE FROM sessions WHERE id = ?').run(id);
    }
  });
  run();
  return orphanIds.size;
}

function aggregateResult(
  config: ProviderConfig,
  files: string[],
  results: FileScanResult[],
): ProviderScanResult {
  const blocked = results.find((r) => r.blocked !== undefined)?.blocked;
  return {
    provider: config.key,
    files: files.length,
    scanned: results.filter((r) => !r.skipped && r.blocked === undefined).length,
    skipped: results.filter((r) => r.skipped).length,
    eventCount: results.reduce((sum, r) => sum + r.eventCount, 0),
    blocked,
  };
}

export async function scanJsonlFile(
  config: ProviderConfig,
  filePath: string,
  ctx: ScannerContext,
  toRecord: (rows: unknown[], filePath: string) => TraceRecord,
): Promise<FileScanResult> {
  const gate = shouldRescan(ctx.db, filePath, fingerprintFile);
  if (!gate.changed && !ctx.force) {
    return { key: null, skipped: true, eventCount: 0 };
  }
  const read = await readJsonlFrom(filePath, 0);
  const record = toRecord(read.rows, filePath);
  // T-02：key 由文件路径派生（索引阶段 buildIndexEntry 同口径），不取 adapter id
  const key = deriveSessionKey(config.key, filePath);
  storeTraceRecord(ctx.db, record, filePath, key, ctx.notify);
  commitScanState(ctx.db, {
    sourcePath: filePath,
    provider: config.key,
    sessionId: key,
    fp: gate.fp,
    byteOffset: read.endOffset,
    eventCount: record.events.length,
  });
  return { key, skipped: false, eventCount: record.events.length };
}

export async function scanSqliteFile(
  config: ProviderConfig,
  filePath: string,
  ctx: ScannerContext,
  toRecords: (dbPath: string, filePath: string) => TraceRecord[],
): Promise<FileScanResult> {
  const gate = shouldRescan(ctx.db, filePath, sqliteFingerprint);
  if (!gate.changed && !ctx.force) {
    return { key: null, skipped: true, eventCount: 0 };
  }
  // T-03：一个 db 文件可能含 N 个会话，全部写入（详情与索引同 key 口径）
  const records = toRecords(filePath, filePath);
  const { keys, eventCount } = storeAuthoritativeSourceRecords(
    ctx.db,
    config,
    filePath,
    records,
    ctx.notify,
  );
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

/**
 * T-11（REQ-022）：按「db 路径 + 行内 session id」定位**单个**会话并解析事件。
 * 索引与详情共用 deriveSessionKey 单一口径（T-02/REQ-007），key 无法反向推出
 * 行内 id，因此解析后按派生 key 匹配目标会话，只写该会话。
 *
 * TODO(D-006)：惰性详情按会话定位，文件级 shouldRescan 门禁对「文件未变但
 * 本会话尚未加载」不适用（REQ-001 与 REQ-022 的张力，见 DECISIONS-PENDING.md）。
 */
export async function scanSqliteSessionDetail(
  config: ProviderConfig,
  filePath: string,
  key: string,
  ctx: ScannerContext,
  toRecords: (dbPath: string, filePath: string) => TraceRecord[],
): Promise<FileScanResult> {
  const records = toRecords(filePath, filePath);
  const record = records.find(
    (r) => deriveSessionKey(config.key, filePath, r.session.id) === key,
  );
  if (record === undefined) {
    // 目标会话在源库中不存在：必须抛错，MUST NOT 返回 200 + 空数组（G5.6）
    throw new Error(`会话 ${key} 在源库 ${filePath} 中不存在`);
  }
  storeTraceRecord(ctx.db, record, filePath, key, ctx.notify);
  // REQ-003：每次成功详情扫描后必须写 scan_state；写入失败抛错（G11.5）
  const gate = shouldRescan(ctx.db, filePath, sqliteFingerprint);
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

export function makeJsonlScanner(
  key: ProviderKey,
  toRecord: (rows: unknown[], filePath: string) => TraceRecord,
): ProviderScanner {
  return {
    key,
    sourceKind: 'jsonl',
    buildIndexEntries(config, filePath) {
      return [jsonlIndexEntry(config, filePath)];
    },
    async scanProvider(config, ctx) {
      const files = enumerateSourceFiles(config.path, 'jsonl');
      const results: FileScanResult[] = [];
      for (const filePath of files) {
        results.push(await scanJsonlFile(config, filePath, ctx, toRecord));
      }
      return aggregateResult(config, files, results);
    },
    async scanFile(config, filePath, ctx) {
      return scanJsonlFile(config, filePath, ctx, toRecord);
    },
  };
}

export function makeSqliteScanner(
  key: ProviderKey,
  toRecords: (dbPath: string, filePath: string) => TraceRecord[],
  buildIndex?: SqliteIndexReader,
): ProviderScanner {
  return {
    key,
    sourceKind: 'sqlite',
    buildIndexEntries(config, filePath) {
      if (buildIndex === undefined) {
        return [buildIndexEntry(config, filePath)];
      }
      let metas: SqliteSessionMeta[];
      try {
        metas = buildIndex(filePath);
      } catch {
        // 非本 provider 格式 / 损坏 / 被占用的 .db：索引阶段跳过该文件，
        // 避免拖垮整体启动；详情扫描时由 provider 级错误记录暴露。
        return [];
      }
      return metas.map((meta) => sqliteIndexEntry(config, filePath, meta));
    },
    scanSessionDetail(config, filePath, sessionKey, ctx) {
      return scanSqliteSessionDetail(config, filePath, sessionKey, ctx, toRecords);
    },
    async scanProvider(config, ctx) {
      const files = enumerateSourceFiles(config.path, 'sqlite');
      const results: FileScanResult[] = [];
      for (const filePath of files) {
        results.push(await scanSqliteFile(config, filePath, ctx, toRecords));
      }
      return aggregateResult(config, files, results);
    },
    async scanFile(config, filePath, ctx) {
      return scanSqliteFile(config, filePath, ctx, toRecords);
    },
  };
}

/**
 * REQ-013 索引阶段的索引条目（JSONL 类专用：一个文件 = 一个会话）。
 * SQLite 类请走 makeSqliteScanner 的索引读取器（buildSqliteIndexEntry）。
 */
export function buildIndexEntry(
  config: ProviderConfig,
  filePath: string,
): SessionIndexEntry {
  const st = statSync(filePath);
  const iso = new Date(st.mtimeMs).toISOString();
  return {
    id: deriveSessionKey(config.key, filePath),
    provider: config.key,
    sourceAgent: config.label,
    // REQ-021：不得用文件名冒充标题；无正文可读的源（如 Trae 加密库）回落 D5
    title: fallbackSessionTitle(config.key, st.mtimeMs),
    startedAt: iso,
    updatedAt: iso,
    status: 'unknown',
    cwd: null,
    eventCount: 0,
    messageCount: 0,
    tokenTotal: 0,
    costUsd: 0,
    dataSource: 'scan',
    sourcePath: filePath,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  };
}

/**
 * T-10（REQ-021）：JSONL 类索引条目——流式读到首条 user 消息，真实标题 + 事件数，
 * 不再用文件名冒充。索引阶段不读全文（硬上限 1MB）。
 */
export function jsonlIndexEntry(
  config: ProviderConfig,
  filePath: string,
): SessionIndexEntry {
  const st = statSync(filePath);
  const meta = readJsonlIndexMeta(filePath, config.key);
  return {
    id: deriveSessionKey(config.key, filePath),
    provider: config.key,
    sourceAgent: config.label,
    title: meta.title,
    startedAt: meta.startedAt,
    updatedAt: new Date(st.mtimeMs).toISOString(),
    status: 'unknown',
    cwd: null,
    eventCount: meta.eventCount,
    messageCount: meta.eventCount,
    tokenTotal: 0,
    costUsd: 0,
    dataSource: 'scan',
    sourcePath: filePath,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  };
}

/** T-03/T-10：SQLite 类索引条目，key/title 均来自 db 行内元数据，title 不等于文件名。 */
export function sqliteIndexEntry(
  config: ProviderConfig,
  filePath: string,
  meta: SqliteSessionMeta,
): SessionIndexEntry {
  return {
    id: deriveSessionKey(config.key, filePath, meta.id),
    provider: config.key,
    sourceAgent: config.label,
    // REQ-021：title 为空（会话行无 title 且无 user 消息）回落 D5，MUST NOT 用文件名
    title:
      meta.title !== ''
        ? meta.title
        : fallbackSessionTitle(config.key, Date.parse(meta.startedAt)),
    startedAt: meta.startedAt,
    updatedAt: meta.updatedAt,
    status: 'unknown',
    cwd: null,
    eventCount: meta.eventCount,
    messageCount: meta.messageCount,
    tokenTotal: 0,
    costUsd: 0,
    dataSource: 'scan',
    sourcePath: filePath,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  };
}

export function upsertIndexEntries(db: Database, entries: SessionIndexEntry[]): void {
  const tx = db.transaction(() => {
    for (const entry of entries) {
      upsertSessionFromIndex(db, entry);
    }
  });
  tx();
}
