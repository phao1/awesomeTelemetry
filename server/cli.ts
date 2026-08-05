import { exec } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createAgentObservabilityServer } from './server.js';
import { openWritable } from './storage/db.js';
import { checkpointWal } from './storage/db.js';
import { INDEX_SQL, SCHEMA_VERSION, initSchema } from './storage/schema.js';
import { cachedStmt } from './storage/stmt-cache.js';
import { enforceProxyRetention } from './storage/retention.js';
import {
  loadLocalSessionConfig,
  loadModelPricingOverrides,
  type LoadConfigOptions,
} from '../local-sessions/config.js';
import { setModelPriceOverrides } from '../src/core/pricing.js';
import { cleanupDuplicateSessionRows } from '../local-sessions/scanner-utils.js';
import { queueSessionChange } from './realtime/coalescer.js';
import { loadSessionGroups, primaryKeyFor } from './storage/session-merge.js';
import { eventBus } from './realtime/event-bus.js';
import { initialScanAndStore } from './watch/scan-scheduler.js';
import type { Database } from 'better-sqlite3';

const DEFAULT_HOST = '127.0.0.1'; // G3.1：默认 host 必须用 127.0.0.1，不能用 localhost
const DEFAULT_PORT = 4173;
const DEFAULT_PROXY_PORT = 7779;
const DEFAULT_PROXY_RETENTION_DAYS = 30;

/** B6（§8）兼容回退：旧数据目录名，仅在新目录不存在且旧目录存在时启用。 */
const LEGACY_DATA_DIR = 'agent-observe-data';
const DATA_DIR = 'awesome-telemetry-data';

/** REQ-001：CLI 参数（完整表）。 */
export interface CliOptions {
  host: string;
  port: number;
  open: boolean;
  configRoot: string;
  dbPath: string;
  proxyPort: number;
  enableProxy: boolean;
  prewarmRecent: number;
  proxyRetentionDays: number;
  noGzip: boolean;
}

export function defaultDbPath(configRoot: string): string {
  const legacy = join(configRoot, LEGACY_DATA_DIR, 'observe.sqlite');
  // 新目录不存在且老目录存在 → 继续用老目录并打提示，不自动搬运、不静默新建空库。
  if (!existsSync(join(configRoot, DATA_DIR)) && existsSync(join(configRoot, LEGACY_DATA_DIR))) {
    console.warn(
      `[brand] 数据目录已改名 ${DATA_DIR}；检测到旧目录 ${LEGACY_DATA_DIR}，` +
        `继续使用旧目录（不自动搬运）。新安装将使用 ${DATA_DIR}。`,
    );
    return legacy;
  }
  return join(configRoot, DATA_DIR, 'observe.sqlite');
}

/** REQ-001 Scenario：--prewarm-recent > 100 时的 stderr 告警文案。 */
export function prewarmWarning(prewarmRecent: number): string | null {
  if (prewarmRecent <= 100) {
    return null;
  }
  return (
    `WARNING: --prewarm-recent ${prewarmRecent} significantly slows responses for the first minutes after startup` +
    ` (v4 measurements showed 200-1240x degradation)`
  );
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let open = true;
  let configRoot = process.cwd();
  let dbPath = '';
  let proxyPort = DEFAULT_PROXY_PORT;
  let enableProxy = false;
  let prewarmRecent = 0; // G11.17：默认 0，完全按需
  let proxyRetentionDays = DEFAULT_PROXY_RETENTION_DAYS;
  let noGzip = false;

  const takeValue = (flag: string, index: number): { value: string; next: number } => {
    const inline = argv[index]?.startsWith(`${flag}=`);
    if (inline === true) {
      return { value: argv[index]!.slice(flag.length + 1), next: index };
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires a value`);
    }
    return { value, next: index + 1 };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const flag = arg.split('=')[0] ?? arg;
    if (flag === '--host') {
      ({ value: host, next: i } = takeValue('--host', i));
    } else if (flag === '--port') {
      const taken = takeValue('--port', i);
      port = parsePort(taken.value);
      i = taken.next;
    } else if (flag === '--no-open') {
      open = false;
    } else if (flag === '--config-root') {
      ({ value: configRoot, next: i } = takeValue('--config-root', i));
    } else if (flag === '--db-path') {
      ({ value: dbPath, next: i } = takeValue('--db-path', i));
    } else if (flag === '--proxy-port') {
      const taken = takeValue('--proxy-port', i);
      proxyPort = parsePort(taken.value);
      i = taken.next;
    } else if (flag === '--enable-proxy') {
      enableProxy = true;
    } else if (flag === '--prewarm-recent') {
      const taken = takeValue('--prewarm-recent', i);
      prewarmRecent = parseNonNegativeInt(taken.value, '--prewarm-recent');
      i = taken.next;
    } else if (flag === '--proxy-retention-days') {
      const taken = takeValue('--proxy-retention-days', i);
      proxyRetentionDays = parseNonNegativeInt(taken.value, '--proxy-retention-days');
      i = taken.next;
    } else if (flag === '--no-gzip') {
      noGzip = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return {
    host,
    port,
    open,
    configRoot,
    dbPath: dbPath === '' ? defaultDbPath(configRoot) : dbPath,
    proxyPort,
    enableProxy,
    prewarmRecent,
    proxyRetentionDays,
    noGzip,
  };
}

function parsePort(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return value;
}

function parseNonNegativeInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer, got ${raw}`);
  }
  return value;
}

function printHelp(): void {
  console.log(`agent-observe [options]

  --host <host>                bind address (default 127.0.0.1)
  --port <port>                HTTP port (default 4173)
  --no-open                    do not auto-open the browser
  --config-root <path>         config directory (default process.cwd())
  --db-path <path>             SQLite path (default <config-root>/agent-observe-data/observe.sqlite)
  --proxy-port <port>          MITM port (default 7779)
  --enable-proxy               start MITM proxy on launch
  --prewarm-recent <n>         prewarm the most recent N sessions (default 0 = fully on demand)
  --proxy-retention-days <n>   proxy_requests retention days (default 30, 0 = never purge)
  --no-gzip                    disable response compression (debug only)
  --help                       show this help`);
}

/** REQ-004：启动自检 5 步。 */
export function runStartupSelfCheck(
  db: Database,
  options: CliOptions,
): { sessionCount: number; dbSizeBytes: number; walSizeBytes: number } {
  // 1. initSchema（幂等；版本高于代码常量时 openWritable 已中止）
  initSchema(db);
  // 2. 校验关键索引存在，缺失则补建（CREATE IF NOT EXISTS 幂等）
  db.exec(INDEX_SQL);
  const missingIndexes = [
    'idx_events_session_seq',
    'idx_events_session_phase',
    'idx_sessions_ds_started',
    'idx_proxy_started_len',
    'idx_scan_state_provider',
  ].filter((name) => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    return row === undefined;
  });
  if (missingIndexes.length > 0) {
    throw new Error(`Key indexes missing and rebuild failed: ${missingIndexes.join(', ')}`);
  }
  // 3. checkpointWal
  checkpointWal(db);
  // 3.5. T-02：清理旧版「索引/详情 key 不一致」产生的孤儿重复行
  const orphans = cleanupDuplicateSessionRows(db);
  if (orphans > 0) {
    console.log(`Duplicate row cleanup: removed ${orphans} detail_loaded=0 orphan rows`);
  }
  // 4. proxy 保留清理
  const deleted = enforceProxyRetention(db, options.proxyRetentionDays);
  if (deleted > 0) {
    console.log(`Proxy retention cleanup: removed ${deleted} expired records`);
  }
  // 5. 启动摘要
  const sessionCount = (cachedStmt(db, 'SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const dbSizeBytes = existsSync(options.dbPath) ? statSync(options.dbPath).size : 0;
  const walSizeBytes = existsSync(`${options.dbPath}-wal`) ? statSync(`${options.dbPath}-wal`).size : 0;
  console.log(
    `Startup self-check passed: schemaVersion=${SCHEMA_VERSION} sessions=${sessionCount} ` +
      `db=${(dbSizeBytes / 1024 / 1024).toFixed(2)}MB wal=${(walSizeBytes / 1024 / 1024).toFixed(2)}MB ` +
      `http://${options.host}:${options.port}/`,
  );
  return { sessionCount, dbSizeBytes, walSizeBytes };
}

function configLoadOptions(configRoot: string): LoadConfigOptions {
  return {
    projectConfigPath: join(configRoot, 'config', 'local-sessions.local.json'),
    userConfigPath: join(
      process.platform === 'win32'
        ? (process.env.APPDATA ?? homedir())
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')),
      'agent-observe',
      'agent-observe.json',
    ),
  };
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const options = parseCliArgs(argv);
  const db = openWritable(options.dbPath);
  const config = loadLocalSessionConfig(configLoadOptions(options.configRoot));
  // G2.3：定价覆盖层（config/model-pricing.json + 用户级）在扫描前生效，
  // adapter 的 computeCostUsd 才能命中扩展价格。
  setModelPriceOverrides(loadModelPricingOverrides(options.configRoot));
  const enriched = { ...config, prewarmRecent: options.prewarmRecent };

  const warning = prewarmWarning(options.prewarmRecent);
  if (warning !== null) {
    console.error(warning);
  }

  runStartupSelfCheck(db, options);

  // #17（REQ-009）：组内成员变更时上报 primaryKey。
  const sessionGroups = loadSessionGroups(join(options.configRoot, 'config'));
  const notifyMerged = (key: string): void => {
    queueSessionChange(primaryKeyFor(key, sessionGroups));
  };

  // REQ-013/REQ-002：索引阶段同步完成，预热不 await；listen 不被预热阻塞
  initialScanAndStore({
    db,
    config: enriched,
    notify: notifyMerged,
    emit: (event) => {
      eventBus.emit(event.type, event);
    },
    isForegroundBusy: () => false,
  });

  const server: Server = createAgentObservabilityServer({
    db,
    config: enriched,
    dbPath: options.dbPath,
    userConfigPath: configLoadOptions(options.configRoot).userConfigPath,
  });
  await listen(server, options.port, options.host);

  const url = `http://${options.host}:${options.port}/`;
  console.log(`AwesomeTelemetry is running at ${url}`);
  if (options.enableProxy) {
    console.log(`--enable-proxy set; MITM wiring in server/proxy/mitm-proxy.ts (P-3)`);
  }

  if (options.open) {
    await openBrowser(url);
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

const execAsync = promisify(exec);

async function openBrowser(url: string): Promise<void> {
  const command = openCommand(url);
  try {
    await execAsync(command);
  } catch (err) {
    console.warn(
      `Failed to open browser: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function openCommand(url: string): string {
  switch (process.platform) {
    case 'darwin':
      return `open ${url}`;
    case 'win32':
      return `cmd /c start "" ${url}`;
    default:
      return `xdg-open ${url}`;
  }
}
