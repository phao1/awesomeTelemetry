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
  content: string | null;
}

/** REQ-010：读取解密后的 Trae SQLite（server_history_info 表）。 */
export function readTraeDb(dbPath: string): { session: { id: string }; turns: TraeTurn[] } {
  const db: Database = openReadonly(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT id, session_id, status, type, start_time, end_time, content_source, token_usage, content
         FROM server_history_info ORDER BY start_time`,
      )
      .all() as TraeDbRow[];
    const sessionId = rows[0]?.session_id ?? 'trae';
    return {
      session: { id: sessionId },
      turns: rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        status: row.status ?? undefined,
        type: row.type,
        startTime: row.start_time ?? undefined,
        endTime: row.end_time ?? undefined,
        contentSource: row.content_source ?? undefined,
        tokenUsage: row.token_usage ?? undefined,
        content: row.content ?? undefined,
      })),
    };
  } finally {
    db.close();
  }
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
