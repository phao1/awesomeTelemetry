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
import { loadLocalSessionConfig, type LoadConfigOptions } from '../local-sessions/config.js';
import { queueSessionChange } from './realtime/coalescer.js';
import { eventBus } from './realtime/event-bus.js';
import { initialScanAndStore } from './watch/scan-scheduler.js';
import type { Database } from 'better-sqlite3';

const DEFAULT_HOST = '127.0.0.1'; // G3.1：默认 host 必须用 127.0.0.1，不能用 localhost
const DEFAULT_PORT = 4173;
const DEFAULT_PROXY_PORT = 7779;
const DEFAULT_PROXY_RETENTION_DAYS = 30;

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
  return join(configRoot, 'agent-observe-data', 'observe.sqlite');
}

/** REQ-001 Scenario：--prewarm-recent > 100 时的 stderr 告警文案。 */
export function prewarmWarning(prewarmRecent: number): string | null {
  if (prewarmRecent <= 100) {
    return null;
  }
  return (
    `警告: --prewarm-recent ${prewarmRecent} 会显著拖慢启动后前几分钟的响应` +
    `（参考 v4 实测劣化 200–1240 倍）`
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

  --host <host>                绑定地址（默认 127.0.0.1，G3.1）
  --port <port>                HTTP 端口（默认 4173）
  --no-open                    不自动打开浏览器
  --config-root <path>         config 目录（默认 process.cwd()）
  --db-path <path>             SQLite 路径（默认 <config-root>/agent-observe-data/observe.sqlite）
  --proxy-port <port>          MITM 端口（默认 7779）
  --enable-proxy               启动即开 MITM
  --prewarm-recent <n>         预热最近 N 个会话（默认 0 = 完全按需）
  --proxy-retention-days <n>   proxy_requests 保留天数（默认 30，0 = 不清理）
  --no-gzip                    关闭响应压缩（仅调试用）
  --help                      显示帮助`);
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
    throw new Error(`关键索引缺失且补建失败: ${missingIndexes.join(', ')}`);
  }
  // 3. checkpointWal
  checkpointWal(db);
  // 4. proxy 保留清理
  const deleted = enforceProxyRetention(db, options.proxyRetentionDays);
  if (deleted > 0) {
    console.log(`proxy 保留清理: 删除 ${deleted} 条过期记录`);
  }
  // 5. 启动摘要
  const sessionCount = (cachedStmt(db, 'SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const dbSizeBytes = existsSync(options.dbPath) ? statSync(options.dbPath).size : 0;
  const walSizeBytes = existsSync(`${options.dbPath}-wal`) ? statSync(`${options.dbPath}-wal`).size : 0;
  console.log(
    `启动自检完成: schemaVersion=${SCHEMA_VERSION} sessions=${sessionCount} ` +
      `db=${(dbSizeBytes / 1024 / 1024).toFixed(2)}MB wal=${(walSizeBytes / 1024 / 1024).toFixed(2)}MB`,
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
  const enriched = { ...config, prewarmRecent: options.prewarmRecent };

  const warning = prewarmWarning(options.prewarmRecent);
  if (warning !== null) {
    console.error(warning);
  }

  runStartupSelfCheck(db, options);

  // REQ-013/REQ-002：索引阶段同步完成，预热不 await；listen 不被预热阻塞
  initialScanAndStore({
    db,
    config: enriched,
    notify: queueSessionChange,
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
  console.log(`Agent Observability is running at ${url}`);
  if (options.enableProxy) {
    console.log(`--enable-proxy 已设置；MITM 接线见 server/proxy/mitm-proxy.ts（P-3）`);
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
