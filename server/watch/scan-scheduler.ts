import type { Database } from 'better-sqlite3';

import type {
  BusEvents,
  LocalSessionConfig,
  ProviderConfig,
  ProviderKey,
  SessionIndexEntry,
} from '../../src/core/trace-types.js';
import { PROVIDER_KEYS } from '../../src/core/trace-types.js';
import { claudeScanner } from '../../local-sessions/claude.js';
import { codeagentScanner } from '../../local-sessions/codeagent.js';
import { codeagent2Scanner } from '../../local-sessions/codeagent2.js';
import { codeartsScanner } from '../../local-sessions/codearts.js';
import { codexScanner } from '../../local-sessions/codex.js';
import { opencodeScanner } from '../../local-sessions/opencode.js';
import { qoderScanner } from '../../local-sessions/qoder.js';
import { traeScanner } from '../../local-sessions/trae.js';
import { workbuddyScanner } from '../../local-sessions/workbuddy.js';
import {
  enumerateSourceFiles,
  upsertIndexEntries,
  type ProviderScanResult,
  type ProviderScanner,
  type ScannerContext,
} from '../../local-sessions/scanner-utils.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { backgroundPrewarm } from './prewarm.js';

const scanners: Record<ProviderKey, ProviderScanner> = {
  claude: claudeScanner,
  codex: codexScanner,
  opencode: opencodeScanner,
  codearts: codeartsScanner,
  codeagent: codeagentScanner,
  codeagent2: codeagent2Scanner,
  trae: traeScanner,
  qoder: qoderScanner,
  workbuddy: workbuddyScanner,
};

export interface ScanSchedulerDeps {
  db: Database;
  config: LocalSessionConfig;
  force?: boolean;
  timeoutMs?: number;
  providers?: ProviderKey[];
  notify?: (key: string) => void;
  emit?: (event: SchedulerEvent) => void;
  isForegroundBusy?: () => boolean;
  /** 测试注入点：替换单个 provider 的扫描实现（不是 mock 被测逻辑，是调度器的依赖注入）。 */
  scannerOverride?: Partial<Record<ProviderKey, ProviderScanner>>;
}

export type SchedulerEvent = {
  [K in keyof BusEvents]: { type: K } & BusEvents[K];
}[keyof BusEvents];

function enabledProviders(deps: ScanSchedulerDeps): ProviderConfig[] {
  return PROVIDER_KEYS.filter(
    (key) =>
      deps.config.providers[key]!.enabled &&
      (deps.providers === undefined || deps.providers.includes(key)),
  ).map((key) => deps.config.providers[key]!);
}

function withTimeout<T>(promise: Promise<T>, ms: number, provider: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${provider} scan timed out (>${ms}ms), skipped`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** REQ-011：provider 并行扫描，单个超时被跳过并记录，不阻塞其他。 */
export async function scanLocalSessions(
  deps: ScanSchedulerDeps,
): Promise<ProviderScanResult[]> {
  const providers = enabledProviders(deps);
  const ctx: ScannerContext = {
    db: deps.db,
    force: deps.force,
    notify: deps.notify,
    traeKeyPath: deps.config.traeKeyPath,
  };
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const results = await Promise.all(
    providers.map(async (config) => {
      const scanner = deps.scannerOverride?.[config.key] ?? scanners[config.key];
      try {
        return await withTimeout(
          scanner.scanProvider(config, ctx),
          timeoutMs,
          config.key,
        );
      } catch (err) {
        return {
          provider: config.key,
          files: 0,
          scanned: 0,
          skipped: 0,
          eventCount: 0,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ProviderScanResult;
      }
    }),
  );
  return results;
}

const SELECT_SESSION_SOURCE_SQL =
  'SELECT provider, source_path FROM sessions WHERE id = ?';

/**
 * T-11（REQ-022 / design D3）：详情解析失败的类型化错误。
 * HTTP 层将其映射为 500 + `SESSION_PARSE_FAILED`，MUST NOT 返回 200 + 空数组（G5.6）。
 */
export class SessionParseError extends Error {
  readonly code = 'SESSION_PARSE_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SessionParseError';
  }
}

/** REQ-015：惰性详情加载。sessions.detail_loaded = 0 时由 HTTP 层调用。 */
export async function scanAndStoreDetail(
  db: Database,
  key: string,
  opts: { config: LocalSessionConfig; force?: boolean; notify?: (k: string) => void },
): Promise<{ key: string; eventCount: number; skipped: boolean } | null> {
  const row = cachedStmt(db, SELECT_SESSION_SOURCE_SQL).get(key) as
    | { provider: ProviderKey; source_path: string }
    | undefined;
  if (row === undefined) {
    return null;
  }
  const config = opts.config.providers[row.provider];
  const scanner = scanners[row.provider];
  const ctx: ScannerContext = {
    db,
    force: opts.force,
    notify: opts.notify,
    traeKeyPath: opts.config.traeKeyPath,
  };
  try {
    // T-11：SQLite 多会话 provider 按「db 路径 + 行内 session id」定位单个会话；
    // JSONL 类（单文件一会话）走原 scanFile。解析失败统一抛 SessionParseError。
    const result =
      scanner.scanSessionDetail !== undefined
        ? await scanner.scanSessionDetail(config, row.source_path, key, ctx)
        : await scanner.scanFile(config, row.source_path, ctx);
    return { key, eventCount: result.eventCount, skipped: result.skipped };
  } catch (err) {
    if (err instanceof SessionParseError) {
      throw err;
    }
    throw new SessionParseError(
      `Session ${key} detail parse failed (${row.provider} @ ${row.source_path}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * REQ-013：两阶段启动。
 * 1. 索引阶段（同步）：只枚举 + 轻量元数据 + upsert 索引，不读详情。
 * 2. 预热阶段（默认关闭）：prewarmRecent > 0 时 void backgroundPrewarm，不 await。
 */
export function initialScanAndStore(
  deps: ScanSchedulerDeps,
): { indexCount: number } {
  const providers = enabledProviders(deps);
  const entries: SessionIndexEntry[] = [];
  for (const config of providers) {
    const scanner = scanners[config.key];
    const files = enumerateSourceFiles(config.path, config.sourceKind);
    for (const filePath of files) {
      // T-03：SQLite 类按 session 行展开，JSONL 类每文件 1 条
      entries.push(...scanner.buildIndexEntries(config, filePath));
    }
  }
  upsertIndexEntries(deps.db, entries);
  deps.emit?.({ type: 'scan_completed', provider: 'all', count: entries.length });

  if (deps.config.prewarmRecent > 0) {
    const recent = entries.slice(0, deps.config.prewarmRecent);
    void backgroundPrewarm({
      sessions: recent,
      isForegroundBusy: deps.isForegroundBusy ?? (() => false),
      loadSession: async (entry) => {
        await scanAndStoreDetail(deps.db, entry.id, {
          config: deps.config,
          notify: deps.notify,
        });
      },
    });
  }
  return { indexCount: entries.length };
}
