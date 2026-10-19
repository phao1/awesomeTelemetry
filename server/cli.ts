import { existsSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runtimeResourcePath } from './runtime-paths.js';
import { handoffBrowser, launchedThroughSsh, validateBindHost, webUrl } from './web-launch.js';

import { createAgentObservabilityServer } from './server.js';
import { runMonitoredLaunch, runMonitorDiagnostics } from './proxy/monitored-launch.js';
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
import { scanTeamSources } from '../local-sessions/team-scanner.js';
import { defaultTeamSources, expandLocalSessionPath } from '../local-sessions/config.js';
import { createTeamSink } from './storage/team-storage.js';
import { queueTeamRunChange } from './realtime/coalescer.js';

import type { Database } from 'better-sqlite3';

const DEFAULT_HOST = '127.0.0.1'; // G3.1：默认 host 必须用 127.0.0.1，不能用 localhost
const DEFAULT_PORT = 4173;
const DEFAULT_PROXY_PORT = 7779;
const DEFAULT_PROXY_RETENTION_DAYS = 0;

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
  captureDirectory?: string;
  captureQuotaBytes?: number;
  captureMaxBodyBytes?: number;
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
  if (argv[0] === 'web') argv = argv.slice(1);
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
  let captureDirectory: string | undefined;
  let captureQuotaBytes = 10_000_000_000;
  let captureMaxBodyBytes = 100 * 1024 * 1024;

  const takeValue = (flag: string, index: number): { value: string; next: number } => {
    const inline = argv[index]?.startsWith(`${flag}=`);
    if (inline === true) {
      return { value: argv[index]!.slice(flag.length + 1), next: index };
    }
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return { value, next: index + 1 };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const flag = arg.split('=')[0] ?? arg;
    if (['--no-open', '--enable-proxy', '--no-gzip'].includes(flag) && arg !== flag) throw new Error(`${flag} does not take a value`);
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
    } else if (flag === '--capture-directory') {
      ({ value: captureDirectory, next: i } = takeValue(flag, i));
    } else if (flag === '--capture-quota-gb' || flag === '--capture-max-body-mib') {
      const taken = takeValue(flag, i);
      const bytes = Number(taken.value) * (flag === '--capture-quota-gb' ? 1_000_000_000 : 1024 * 1024);
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${flag} must produce a positive safe integer byte budget`);
      if (flag === '--capture-quota-gb') captureQuotaBytes = bytes;
      else captureMaxBodyBytes = bytes;
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

  validateBindHost(host);
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
    captureDirectory,
    captureQuotaBytes,
    captureMaxBodyBytes,
  };
}

function parsePort(raw: string): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 0 || value > 65535) {
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
  console.log(`awesome-telemetry web [options] (legacy: agent-observe [options])

  launch --server <loopback-url> --profile <uuid> --revision <n> -- [Agent arguments]
  diagnose --server <loopback-url> --profile <uuid> --revision <n> [--json]
    diagnose is read-only; retrieval success does not certify Agent readiness

  --host <host>                bind address (default 127.0.0.1)
  --port <port>                HTTP port (default 4173)
  --no-open                    do not auto-open the browser (SSH also disables opening)
  --config-root <path>         config directory (default process.cwd())
  --db-path <path>             SQLite path (default <config-root>/awesome-telemetry-data/observe.sqlite)
  --proxy-port <port>          MITM port (default 7779)
  --enable-proxy               start MITM proxy on launch
  --prewarm-recent <n>         prewarm the most recent N sessions (default 0 = fully on demand)
  --proxy-retention-days <n>   explicit metadata retention (default 0 = never purge)
  --capture-directory <path>  original body file directory (default beside user config)
  --capture-quota-gb <n>       original body quota in decimal GB (default 10)
  --capture-max-body-mib <n>   per-direction original body limit in MiB (default 100)
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
      `bind=${options.host}:${options.port}`,
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
  if (argv[0] === 'diagnose') {
    process.exitCode = await runMonitorDiagnostics(argv.slice(1));
    return;
  }
  if (argv[0] === 'launch') {
    process.exitCode = await runMonitoredLaunch(argv.slice(1));
    return;
  }
  const options = parseCliArgs(argv);
  if (!existsSync(runtimeResourcePath('dist/index.html'))) throw new Error('Built Web UI is missing. In a source checkout run npm install then npm run build; for an installed package, reinstall a complete package.');
  await probePort(options.port, options.host);
  const db = openWritable(options.dbPath);
  const config = loadLocalSessionConfig(configLoadOptions(options.configRoot));
  // G2.3：定价覆盖层（config/model-pricing.json + 用户级）在扫描前生效，
  // adapter 的 computeCost 才能命中扩展价格。
  setModelPriceOverrides(loadModelPricingOverrides(options.configRoot));
  const enriched = { ...config, prewarmRecent: options.prewarmRecent };
  const backgroundTasks = new Set<Promise<unknown>>();

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
    trackTask: task => {
      backgroundTasks.add(task);
      void task.then(() => backgroundTasks.delete(task), () => backgroundTasks.delete(task));
    },
  });

  // §4.15 team 源扫描：自动发现 ~/.codeartsdoer/agent-team/ + ~/.codex/sessions/。
  // 与 session scanner 并行的第二条路径；fingerprint/no-change 门禁后解析为
  // NormalizedTeamEvidence，交给 createTeamSink 差分摄入。失败不阻塞启动。
  try {
    const teamSources = defaultTeamSources().filter((source) => {
      const rootExpanded = expandLocalSessionPath(source.root);
      return existsSync(rootExpanded);
    });
    if (teamSources.length > 0) {
      const teamSink = createTeamSink(db);
      const teamResults = await scanTeamSources(teamSources, {
        db,
        sink: teamSink,
        notify: (runIds) => {
          for (const runId of runIds) {
            queueTeamRunChange({ runId, stamp: new Date().toISOString() });
          }
        },
      });
      const totalRuns = teamResults.reduce((sum, r) => sum + r.runs, 0);

      if (totalRuns > 0) {
        console.log(`Team scan: discovered ${totalRuns} team run(s) from ${teamSources.length} source(s)`);
      }
    }
  } catch (err) {
    console.warn(
      `Team scan failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const server: Server = createAgentObservabilityServer({
    db,
    config: enriched,
    distDir: runtimeResourcePath('dist'),
    dbPath: options.dbPath,
    userConfigPath: configLoadOptions(options.configRoot).userConfigPath,
    captureDirectory: options.captureDirectory,
    proxyRetentionDays: options.proxyRetentionDays,
    captureStorage: {
      quotaBytes: options.captureQuotaBytes ?? 10_000_000_000,
      maxBodyBytes: options.captureMaxBodyBytes ?? 100 * 1024 * 1024,
    },
  });
  const disposeShutdown = registerCliShutdown(server, db, backgroundTasks);
  // §7.1（calibrate-tokens-and-compare-report）：友好报错优先；
  // TOCTOU 窗口由 listen 自身的 error 处理兜底。
  try {
    await listen(server, options.port, options.host);
  } catch (error) {
    await new Promise<void>((resolve, reject) => server.close(closeError => closeError === undefined ? resolve() : reject(closeError)));
    await Promise.allSettled(backgroundTasks);
    checkpointWal(db);
    db.close();
    disposeShutdown();
    throw error;
  }

  const boundAddress = server.address();
  if (boundAddress === null || typeof boundAddress === 'string') throw new Error('HTTP listener has no TCP address');
  const url = webUrl(options.host, boundAddress.port);
  console.log(`AwesomeTelemetry is running at ${url} (bind ${options.host}:${boundAddress.port})`);
  const ssh = launchedThroughSsh();
  if (ssh) console.log('SSH session: browser opening disabled. This URL is on the server; use your own local forwarded address/port.');
  if (options.enableProxy) {
    const address = server.address();
    const controlPort = address !== null && typeof address !== 'string' ? address.port : options.port;
    const controlHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host === '::' ? '[::1]' : options.host.includes(':') ? `[${options.host}]` : options.host;
    const response = await fetch(`http://${controlHost}:${controlPort}/api/proxy/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port: options.proxyPort }),
    });
    if (!response.ok) throw new Error(`MITM startup rejected: HTTP ${response.status}`);
    await response.text();
    console.log(`MITM startup requested on 127.0.0.1:${options.proxyPort}; connection status is available in the Web monitor`);
  }

  await handoffBrowser(url, options.open);
}

/** CLI owns SQLite; only the server's successful ownership-release callback
 * permits checkpoint/close. An unsuccessful stop retains handlers for retry.
 */
export function registerCliShutdown(server: Server, db: Database, backgroundTasks: ReadonlySet<Promise<unknown>> = new Set()): () => void {
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
      await Promise.allSettled(backgroundTasks);
      checkpointWal(db);
      db.close();
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      console.log('AwesomeTelemetry stopped; capture writes flushed and database closed');
    })().catch(() => {
      stopping = false;
      process.exitCode = 1;
      console.error('Shutdown incomplete; database kept open. Retry SIGINT/SIGTERM after resolving the failure.');
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return () => { process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown); };
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

/**
 * §7.1：listen 前端口占用预探测。占用时给出可操作报错（端口号 + 换 --port /
 * 停进程建议），而不是抛裸 EADDRINUSE。
 * ⚠️ 探测与真正 listen 之间存在 TOCTOU 窗口 —— 调用方必须保留 listen 的
 * error 处理，探测只是把错误信息变友好，不是替代品。
 */
export function probePort(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        reject(
          new Error(
            `端口 ${port} 已被占用（${err.code}）。请换一个端口：--port <port>，` +
              `或先停掉占用该端口的进程。`,
          ),
        );
      } else {
        reject(new Error(`端口 ${port} 探测失败：${err.message}`));
      }
    });
    probe.listen(port, host, () => {
      probe.close((closeErr) => {
        if (closeErr !== null && closeErr !== undefined) {
          reject(new Error(`端口 ${port} 探测后关闭失败：${closeErr.message}`));
        } else {
          resolve();
        }
      });
    });
  });
}
