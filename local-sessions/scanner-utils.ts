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
import { sessionKey } from './session-key.js';
import { expandLocalSessionPath } from './config.js';
import type { TraeBridgeOptions } from './trae-bridge.js';

const UPSERT_EVENT_RAW_SQL =
  `INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?) ` +
  `ON CONFLICT(session_id, event_id) DO UPDATE SET raw = excluded.raw`;

const SET_DETAIL_LOADED_SQL = 'UPDATE sessions SET detail_loaded = 1 WHERE id = ?';

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
  notify?: (key: string) => void,
): string {
  const key = sessionKey(record.session.provider, record.session.id, sourcePath);
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
  const key = storeTraceRecord(ctx.db, record, filePath, ctx.notify);
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
  const key = storeTraceRecord(ctx.db, record, filePath, ctx.notify);
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
    id: sessionKey(config.key, basename(filePath), filePath),
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
