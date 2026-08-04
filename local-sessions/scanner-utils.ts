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
const SELECT_DUPLICATE_ORPHANS_SQL =
  `SELECT a.id FROM sessions a ` +
  `WHERE a.detail_loaded = 0 AND EXISTS (` +
  `  SELECT 1 FROM sessions b ` +
  `  WHERE b.source_path = a.source_path AND b.provider = a.provider AND b.detail_loaded = 1)`;

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
}

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
 * T-02 自愈清理：删除「同 source_path 同 provider 且已有 detail_loaded=1 行」的
 * detail_loaded=0 孤儿行（旧版索引/详情 key 不一致产生的重复行）。
 * 正常未打开的会话（无 loaded 兄弟行）不受影响。
 */
export function cleanupDuplicateSessionRows(db: Database): number {
  const orphans = cachedStmt(db, SELECT_DUPLICATE_ORPHANS_SQL).all() as Array<{
    id: string;
  }>;
  if (orphans.length === 0) {
    return 0;
  }
  const run = db.transaction(() => {
    for (const orphan of orphans) {
      cachedStmt(db, 'DELETE FROM event_raw WHERE session_id = ?').run(orphan.id);
      cachedStmt(db, 'DELETE FROM events WHERE session_id = ?').run(orphan.id);
      cachedStmt(db, 'DELETE FROM metrics WHERE session_id = ?').run(orphan.id);
      cachedStmt(db, 'DELETE FROM scan_state WHERE session_id = ?').run(orphan.id);
      cachedStmt(db, 'DELETE FROM sessions WHERE id = ?').run(orphan.id);
    }
  });
  run();
  return orphans.length;
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
  toRecord: (dbPath: string, filePath: string) => TraceRecord,
): Promise<FileScanResult> {
  const gate = shouldRescan(ctx.db, filePath, sqliteFingerprint);
  if (!gate.changed && !ctx.force) {
    return { key: null, skipped: true, eventCount: 0 };
  }
  const record = toRecord(filePath, filePath);
  // T-02：SQLite 类详情阶段按「db 路径 + 行内 session id」派生，
  // 与 T-03 索引阶段的展开条目同口径
  const key = deriveSessionKey(config.key, filePath, record.session.id);
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

export function makeJsonlScanner(
  key: ProviderKey,
  toRecord: (rows: unknown[], filePath: string) => TraceRecord,
): ProviderScanner {
  return {
    key,
    sourceKind: 'jsonl',
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
  toRecord: (dbPath: string, filePath: string) => TraceRecord,
): ProviderScanner {
  return {
    key,
    sourceKind: 'sqlite',
    async scanProvider(config, ctx) {
      const files = enumerateSourceFiles(config.path, 'sqlite');
      const results: FileScanResult[] = [];
      for (const filePath of files) {
        results.push(await scanSqliteFile(config, filePath, ctx, toRecord));
      }
      return aggregateResult(config, files, results);
    },
    async scanFile(config, filePath, ctx) {
      return scanSqliteFile(config, filePath, ctx, toRecord);
    },
  };
}

/** REQ-013 索引阶段的索引条目（只读目录 + stat，不读详情）。 */
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

export function upsertIndexEntries(db: Database, entries: SessionIndexEntry[]): void {
  const tx = db.transaction(() => {
    for (const entry of entries) {
      upsertSessionFromIndex(db, entry);
    }
  });
  tx();
}
