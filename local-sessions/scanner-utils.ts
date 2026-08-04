import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

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
  upsertEvents,
  upsertMetrics,
  upsertSessionFromIndex,
  upsertSessionFromTrace,
} from '../server/storage/writers.js';
import { fingerprintFile } from '../server/watch/fingerprint.js';
import { commitScanState, shouldRescan, sqliteFingerprint } from '../server/watch/scan-gate.js';
import { readJsonlFrom } from '../server/watch/jsonl-reader.js';
import { deriveSessionKey } from './session-key.js';
import { expandLocalSessionPath } from './config.js';
import type { TraeBridgeOptions } from './trae-bridge.js';

const UPSERT_EVENT_RAW_SQL =
  `INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?) ` +
  `ON CONFLICT(session_id, event_id) DO UPDATE SET raw = excluded.raw`;

const SET_DETAIL_LOADED_SQL = 'UPDATE sessions SET detail_loaded = 1 WHERE id = ?';
const SELECT_CLEANUP_CANDIDATES_SQL =
  `SELECT id, provider, source_path, detail_loaded FROM sessions WHERE data_source = 'scan'`;

/** T-03：可读的 SQLite 多会话 provider（索引按 session 行展开，不再产生文件级 key）。 */
const SQLITE_MULTI_SESSION_PROVIDERS: ReadonlySet<string> = new Set([
  'opencode',
  'codearts',
  'codeagent2',
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
  const keys: string[] = [];
  let eventCount = 0;
  for (const record of records) {
    const key = deriveSessionKey(config.key, filePath, record.session.id);
    keys.push(storeTraceRecord(ctx.db, record, filePath, key, ctx.notify));
    eventCount += record.events.length;
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

export function makeJsonlScanner(
  key: ProviderKey,
  toRecord: (rows: unknown[], filePath: string) => TraceRecord,
): ProviderScanner {
  return {
    key,
    sourceKind: 'jsonl',
    buildIndexEntries(config, filePath) {
      return [buildIndexEntry(config, filePath)];
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
    title: basename(filePath),
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

/** T-03：SQLite 类索引条目，key/title 均来自 db 行内元数据，title 不等于文件名。 */
export function sqliteIndexEntry(
  config: ProviderConfig,
  filePath: string,
  meta: SqliteSessionMeta,
): SessionIndexEntry {
  return {
    id: deriveSessionKey(config.key, filePath, meta.id),
    provider: config.key,
    sourceAgent: config.label,
    title: meta.title,
    startedAt: meta.startedAt,
    updatedAt: meta.updatedAt,
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

export function upsertIndexEntries(db: Database, entries: SessionIndexEntry[]): void {
  const tx = db.transaction(() => {
    for (const entry of entries) {
      upsertSessionFromIndex(db, entry);
    }
  });
  tx();
}
