import { getTask, getTaskTimeline, listTasks, recordMembers, taskRecords, TaskReadError, validateTaskRange } from './storage/task-workbench.js';
import type { TaskListQuery, TaskRecordQuery } from '../src/core/task-types.js';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { CaptureCapacityError, readCaptureCapacity } from './proxy/capture-capacity.js';
import { parseBodyByteRange } from './proxy/body-range.js';
import { CaptureReparser, CaptureReparseError } from './proxy/capture-reparse.js';
import { CodexInspector, CodexSourceAccessError, codexInteger, type CodexSelector } from './codex/service.js';
import { CodexInspectionError } from './codex/archive.js';
import { liveCodexInventory } from './codex/source.js';
import { TraceImportError } from './trace-import/format.js';
import { TraceLogImporter, importId, importSequence, importPaging, requireImport } from './trace-import/service.js';
import { listImports, listImportTurns } from './storage/trace-import.js';
import { ClaudeHookControl } from './hooks/claude-control.js';
import { ClaudeHookReceiver } from './hooks/claude-receiver.js';
import { registerClaudeHookRoutes } from './http/claude-hook-routes.js';
import { createArchitectureDiagnosisCollector, type ArchitectureCaptureSource } from './architecture-diagnosis/collector.js';
import { registerArchitectureDiagnosisRoutes } from './http/architecture-diagnosis-routes.js';
import { registerAgentFoldingRoutes } from './http/agent-folding-routes.js';
import { nativeFoldingProject } from './agent-folding/native.js';
import { analyzeArchitectureDiagnosis } from '../src/core/architecture-diagnosis-analysis.js';

import type { Database } from 'better-sqlite3';

import type {
  LocalSessionConfig,
  ProviderKey,
  SessionAnnotations,
  SessionAnnotationsUpdate,
  SessionDetailResponse,
  TraceEvent,
  TraceRecord,
  CaptureStorageConfig,
  MonitorConnectionProfile,
  ProxyProtocolAnalysis,
  CaptureEvidenceExport,
  CaptureComparisonResponse,
  CaptureComparisonSide,
} from '../src/core/trace-types.js';
import {
  PROVIDER_KEYS,
  SESSION_RANGES,
  TRACE_STATUSES,
} from '../src/core/trace-types.js';
import type { SessionRange, TraceStatus } from '../src/core/trace-types.js';
import { computeSpeedMetrics } from '../src/core/speed-metrics.js';
import {
  mergeLocalSessionConfig,
  saveUserConfig,
} from '../local-sessions/config.js';
import { getProxyRequestById, getProxyRequestListItemById } from './storage/query-engine.js';
import { buildTraceReportHtml } from '../src/core/report-html.js';
import { buildCompareReportHtml } from '../src/core/compare-report.js';
import { DetailCache } from './storage/detail-cache.js';
import {
  getAgentOverview,
} from './storage/overview.js';
import {
  getEventDetail,
  getSessionDetail,
  listProxyRequests,
  listSessions,
} from './storage/query-engine.js';
import { getMission } from './storage/mission.js';
import { getPromptContext } from './storage/prompt-context.js';
import {
  AnnotationBoundError,
  AnnotationSessionNotFoundError,
  ANNOTATION_MAX_TAGS,
  ANNOTATION_TAG_PATTERN,
  listTagVocabulary,
  readAnnotations,
  writeAnnotations,
} from './storage/annotations.js';
import {
  buildSubagentMergeGroups,
  getMergeGroup,
  loadSessionGroups,
  mergeSessionDetail,
  primaryKeyFor,
  type SessionMergeGroup,
} from './storage/session-merge.js';
import { deleteSession } from './storage/writers.js';
import { SCHEMA_VERSION } from './storage/schema.js';
import { cachedStmt } from './storage/stmt-cache.js';
import { OriginalDeletionQueue, OriginalDeletionError, getOriginalDeletionForProxy, PENDING_ORIGINAL_DELETION_SQL } from './proxy/original-deletions.js';
import { addSseClient } from './realtime/sse.js';
import { queueSessionChange, queueTraceLinkChange, queueTeamRunChange } from './realtime/coalescer.js';
import { eventBus } from './realtime/event-bus.js';
import { markForegroundRequest } from './realtime/frontline.js';
import { scanAndStoreDetail, scanLocalSessions, SessionParseError } from './watch/scan-scheduler.js';
import { scanTeamSources } from '../local-sessions/team-scanner.js';
import { expandLocalSessionPath } from '../local-sessions/config.js';
import { startFileWatcher } from './watch/file-watcher.js';
import { Router } from './http/router.js';
import { sendJson, sendCompressedOrPlain } from './http/send-json.js';
import { sendApiError, type ErrorCode } from './http/error-envelope.js';
import { serveStatic } from './http/static.js';
import { resolveRules } from './desensitization/rules.js';
import { shouldKeepRawBodies } from './desensitization/engine.js';
import {
  FridaRuntime,
  FridaTargetError,
  ProxyRuntime,
  ProxyStateError,
} from './proxy/controller.js';
import { runContextDiff, type ContextDiffErrorCode } from './proxy/context-diff-service.js';
import { CaptureBodyStore } from './proxy/body-store.js';
import { CaptureJournal } from './proxy/capture-journal.js';
import { buildConnectionPlan, ConnectionProfileError, ConnectionProfileStore, validateExpectedRevision } from './proxy/connection-profiles.js';
import { inspectConnection } from './proxy/connection-diagnostics.js';
import { CaptureSelfTester, CaptureSelfTestError } from './proxy/capture-self-test.js';
import { readCaptureBodies } from './proxy/capture-storage.js';
import { readAnalysisBody } from './proxy/analysis-source.js';
import { analyzeProtocol } from './proxy/protocol-analysis.js';
import { assembleCaptureEvidenceExport, stringifyCaptureEvidenceExport, CaptureExportLimitError } from './proxy/capture-export.js';
import { getLinkedExecution, LinkedExecutionLimitError } from './storage/linked-execution.js';
import { getNativeSessionParents } from './storage/native-session-parents.js';
import { getNativeSessionFamily } from './storage/session-family.js';
import { getNativeToolObservations } from './storage/native-tool-observations.js';
import { handleTraceExport } from './http/trace-export-route.js';
import { handleLinkedTraceExport } from './http/linked-trace-export-route.js';
import { ExperimentRegistry } from './experiments/registry.js';
import { registerExperimentRoutes } from './http/experiment-routes.js';
import { registerBenchmarkRoutes } from './http/benchmark-routes.js';
import { registerTeamExperimentRoutes } from './http/team-experiment-routes.js';
import { registerFridaCaptureRoutes } from './http/frida-capture-routes.js';
import { registerCaptureBundleRoutes } from './http/capture-bundle-routes.js';
import { CaptureBundleExporter } from './proxy/capture-bundle.js';
import { getMonitorCapabilities } from './proxy/monitor-capabilities.js';
import { parseProxyRequest } from './proxy/parser-router.js';
import { decideTraceAssociation, listProxyTraceLinks, listSessionCaptureLinks, listTraceDecisions, listTraceIdentities, TraceLinkError } from './storage/trace-links.js';
import { ensureInterceptCa } from './proxy/ca-manager.js';
import {
  createTeamSink,
  deleteTeamRun,
  getTeamActivityDetail,
  getTeamCompareInputs,
  getTeamPatch,
  getTeamRunIdsBySessionKey,
  getTeamRunSnapshot,
  listTeamActivities,
  listTeamRuns,
  type ListTeamActivitiesOptions,
  type ListTeamRunsOptions,
} from './storage/team-storage.js';
import { compareTeams } from '../src/core/team-compare.js';
import type {
  CompletenessLevel,
  ComparisonMatch,
  TeamActivityKind,
  TeamComparisonBasis,
  TeamRunSnapshot,
  TeamRunStatus,
  TeamTopologyKind,
} from '../src/core/trace-types.js';
import { TEAM_TOPOLOGY_KINDS } from '../src/core/trace-types.js';

const DEV_ONLY_ROUTES = [
  '/api/cdp/start',
  '/api/cdp/stop',
  '/api/cdp/status',
  '/api/cdp/targets',
  '/api/cdp/captures',
  '/api/cdp/captures/:id',
] as const;

export interface AgentObservabilityServerOptions {
  /** Explicit installed CLI entry for embedders; default is relative to this module. */
  launcherCliPath?: string;
  /** CLI opts out by default; embedders retain the existing watcher default. */
  enableMonitoring?: boolean;
  db: Database;
  config: LocalSessionConfig;
  dbPath?: string;
  /** 前端构建产物目录。缺省为 cwd/dist（T-01：静态兜底）。 */
  distDir?: string;
  detailCache?: DetailCache;
  projectConfigPath?: string;
  userConfigPath?: string;
  rulesPath?: string;
  captureDirectory?: string;
  captureStorage?: Partial<CaptureStorageConfig>;
  /** Current explicit metadata policy for uncommitted journal recovery; default0. */
  proxyRetentionDays?: number;
  caDirectory?: string;
}

interface DesensitizationOverride {
  enabled: string[];
  disabled: string[];
  keepRawBodies: boolean;
}

const EMPTY_OVERRIDE: DesensitizationOverride = {
  enabled: [],
  disabled: [],
  keepRawBodies: false,
};

export interface HealthResponse {
  ok: true;
  monitoringEnabled: boolean;
  schemaVersion: number;
  uptimeMs: number;
  dbSizeBytes: number;
  walSizeBytes: number;
  /** 全库会话 / 事件总数。状态栏是系统级读数，不能拿当前筛选结果冒充。 */
  sessionCount: number;
  eventCount: number;
  devOnly: readonly string[];
}

function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = req.url ?? '/';
  const question = url.indexOf('?');
  return new URLSearchParams(question >= 0 ? url.slice(question + 1) : '');
}

function intParam(value: string | null, fallback: number, max: number): number {
  if (value === null || value === '') {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) {
    return fallback;
  }
  return Math.min(Math.max(n, 1), max);
}

function readBody(req: IncomingMessage, maxBytes = Number.MAX_SAFE_INTEGER): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    req.on('data', (chunk: Buffer) => {
      if (oversized) return;
      size += chunk.byteLength;
      if (size > maxBytes) {
        oversized = true;
        chunks.length = 0;
        reject(new HttpError(400, 'BAD_REQUEST', 'Request body exceeds the configured route limit'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!oversized) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes?: number,
): Promise<Record<string, unknown>> {
  const text = await readBody(req, maxBytes);
  if (text === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
  }
}

class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** design D10 / §6.2：context-diff 服务错误码 -> 统一 HTTP 状态。 */
const CONTEXT_DIFF_STATUS: Record<ContextDiffErrorCode, number> = {
  BAD_REQUEST: 400,
  PROXY_REQUEST_NOT_FOUND: 404,
  CONTEXT_DIFF_UNAVAILABLE: 409,
  CONTEXT_DIFF_UNSUPPORTED: 422,
  INTERNAL_ERROR: 500,
};

export function createAgentObservabilityServer(
  opts: AgentObservabilityServerOptions,
): Server {
  const { db, config } = opts;
  const dbPath = opts.dbPath ?? '';
  const distDir = opts.distDir ?? join(process.cwd(), 'dist');
  const caDirectory = opts.caDirectory ?? join(dirname(opts.userConfigPath ?? (dbPath || join(process.cwd(), '.agent-observe', 'state.sqlite'))), 'proxy-ca');
  const connectionProfiles = new ConnectionProfileStore(join(dirname(opts.userConfigPath ?? (dbPath || join(process.cwd(), '.agent-observe', 'state.sqlite'))), 'monitor-profiles.json'));
  let bodyStorePromise: Promise<CaptureBodyStore> | null = null;
  let fileStorePromise: Promise<CaptureBodyStore> | null = null;
  const captureDirectory = opts.captureDirectory ?? join(dirname(opts.userConfigPath ?? (dbPath || join(process.cwd(), '.agent-observe', 'state.sqlite'))), 'capture-bodies');
  let startupRecovery: Promise<void> | null = null;
  // Reading or explicitly deleting committed evidence must remain possible when
  // admitting unrelated recovery metadata is blocked by database pressure.
  const getFileStore = (): Promise<CaptureBodyStore> => {
    fileStorePromise ??= CaptureBodyStore.create(captureDirectory, opts.captureStorage).then(async store => {
      await new OriginalDeletionQueue(db, store).resumePending(); return store;
    }).catch((error: unknown) => { fileStorePromise = null; throw error; });
    return fileStorePromise;
  };
  const captureReparser = new CaptureReparser(db, getFileStore);
  const codexInspector = new CodexInspector(db, getFileStore);
  const traceImporter = new TraceLogImporter(db, getFileStore);
  const hookReceiver = new ClaudeHookReceiver(db,
    new ClaudeHookControl(join(dirname(opts.userConfigPath ?? (dbPath || join(process.cwd(), '.agent-observe', 'state.sqlite'))), 'claude-hook-receiver.json')),
    getFileStore, latestId => eventBus.emit('hook_events_changed', { latestId }));
  const getBodyStore = (): Promise<CaptureBodyStore> => {
    if (bodyStorePromise === null) {
      bodyStorePromise = getFileStore().then(async store => {
        try {
          const recovered = await (await CaptureJournal.open(db, store)).recover(db, opts.proxyRetentionDays ?? 0);
          // One metadata-only status correction for the batch, including clients
          // whose initial status snapshot arrived before recovery completed.
          if (recovered > 0) eventBus.emit('proxy_status', proxyRuntime.status());
        }
        catch (error) { if (error instanceof CaptureCapacityError) throw error; throw new Error('CAPTURE_RECOVERY_FAILED', { cause: error }); }
        return store;
      }).catch((error: unknown) => {
        bodyStorePromise = null;
        throw error;
      });
    }
    return bodyStorePromise;
  };
  const rulesPath =
    opts.rulesPath ??
    (opts.userConfigPath !== undefined
      ? join(dirname(opts.userConfigPath), 'desensitization-rules.json')
      : 'desensitization-rules.json');
  // #17（REQ-003）：合并组配置（config/session-groups.json），缺省不合并。
  const manualGroups =
    opts.projectConfigPath !== undefined
      ? loadSessionGroups(dirname(opts.projectConfigPath))
      : [];
  // F1-4（add-mission-control §7.7）：自动 subagent 归属补充手工配置，
  // 按 MAX(updated_at) stamp 缓存。
  let autoGroupsCache: { stamp: string; groups: SessionMergeGroup[] } | null = null;
  const sessionGroups = (): SessionMergeGroup[] => {
    const stampRow = cachedStmt(db, 'SELECT MAX(updated_at) AS stamp FROM sessions').get() as {
      stamp: string | null;
    };
    const stamp = stampRow.stamp ?? '1970-01-01T00:00:00.000Z';
    if (autoGroupsCache === null || autoGroupsCache.stamp !== stamp) {
      const rows = cachedStmt(
        db,
        `SELECT id, provider, source_agent, title, started_at, updated_at, is_subagent
         FROM sessions WHERE data_source = 'scan'`,
      ).all() as Array<{
        id: string;
        provider: string;
        source_agent: string;
        title: string;
        started_at: string;
        updated_at: string;
        is_subagent: number;
      }>;
      autoGroupsCache = {
        stamp,
        groups: buildSubagentMergeGroups(
          rows.map((row) => ({
            id: row.id,
            provider: row.provider,
            title: row.title,
            sourceAgent: row.source_agent,
            startedAt: row.started_at,
            updatedAt: row.updated_at,
            isSubagent: row.is_subagent === 1,
          })),
        ),
      };
    }
    return [...manualGroups, ...autoGroupsCache.groups];
  };
  const detailCache = opts.detailCache ?? new DetailCache();
  /** REQ-009/REQ-016：组内成员变更时失效成员与 primary 的详情缓存，再上报 primary。 */
  const notifyMerged = (key: string): void => {
    const primaryKey = primaryKeyFor(key, sessionGroups());
    for (const cacheKey of new Set([key, primaryKey])) {
      detailCache.invalidate(`${cacheKey}:slim`);
      detailCache.invalidate(`${cacheKey}:full`);
    }
    queueSessionChange(primaryKey);
  };
  const startedAt = Date.now();
  let closing = false;
  let monitoringEnabled = opts.enableMonitoring !== false;
  let monitoringState: 'idle' | 'running' | 'starting' | 'stopping' = monitoringEnabled ? 'running' : 'idle';
  const activeHandlers = new Set<Promise<void>>();
  const scanTasks = new Set<Promise<unknown>>();
  const ownSseClients = new Set<() => void>();
  let scanInProgress = false;
  const pendingAutomaticScans = new Set<ProviderKey>();
  const teamSink = createTeamSink(db);

  const scanProviders = async (
    provider: ProviderKey | undefined,
    force: boolean,
  ) => {
    const results = await scanLocalSessions({
      db,
      config,
      force,
      providers: provider === undefined ? undefined : [provider],
      notify: notifyMerged,
      emit: (event) => { eventBus.emit(event.type, event); },
      trackTask: task => {
        scanTasks.add(task);
        void task.then(() => scanTasks.delete(task), () => scanTasks.delete(task));
      },
    });
    // Refresh the same bounded team metadata after session discovery, so newly
    // spawned Codex threads and their later activities reach the team UI.
    const codex = config.providers.codex;
    if ((provider === undefined || provider === 'codex') && codex.enabled && existsSync(expandLocalSessionPath(codex.path))) {
      const teamResults = await scanTeamSources([{ provider: 'codex', root: codex.path }], {
        db, force, sink: teamSink,
        notify: runIds => {
          for (const runId of runIds) queueTeamRunChange({ runId, stamp: new Date().toISOString() });
        },
      });
      for (const result of teamResults) {
        if (result.error) console.error(`[team scan] ${result.provider}: ${result.error}`);
      }
    }
    return results;
  };

  const runAutomaticScan = async (provider: ProviderKey): Promise<void> => {
    if (closing || monitoringState !== 'running') return;
    if (scanInProgress) {
      pendingAutomaticScans.add(provider);
      return;
    }
    scanInProgress = true;
    eventBus.emit('scan_started', { provider });
    try {
      const results = await scanProviders(provider, false);
      eventBus.emit('scan_completed', {
        provider,
        count: results.reduce((sum, result) => sum + result.eventCount, 0),
      });
    } finally {
      scanInProgress = false;
      const next = pendingAutomaticScans.values().next().value;
      if (!closing && next !== undefined) {
        pendingAutomaticScans.delete(next);
        void runAutomaticScan(next);
      }
    }
  };
  // T-12（D4）：proxy/frida 运行时状态机，异步启动由 SSE 通知
  const proxyRuntime = new ProxyRuntime(db, (payload) => {
    eventBus.emit('proxy_status', payload);
  }, { bodyStore: async () => {
    await ensureInterceptCa(caDirectory);
    return getBodyStore();
  }, caDirectory, notifySession: queueTraceLinkChange });
  const fridaRuntime = new FridaRuntime((payload) => {
    eventBus.emit('frida_status', payload);
  }, { db, notify: payload => eventBus.emit('frida_capture', payload),
    onError: () => console.error('Frida capture failed; no saved-capture success was reported') });
  const captureSelfTester = new CaptureSelfTester(db, proxyRuntime, getFileStore);

  /** REQ-015：惰性详情加载（compare/report 与 GET 详情同口径）。 */
  const ensureDetail = async (
    key: string,
    mode: 'slim' | 'full',
  ): Promise<SessionDetailResponse | null> => {
    const meta = cachedStmt(
      db,
      'SELECT detail_loaded, provider, source_path FROM sessions WHERE id = ?',
    ).get(key) as
      | { detail_loaded: number; provider: ProviderKey; source_path: string }
      | undefined;
    if (meta === undefined) {
      return null;
    }
    if (meta.detail_loaded === 0 && meta.provider !== 'trae') {
      // 源文件可能已被删除（用户清理了 agent 的历史目录），而库里的行还在。
      // DB 是持久层，重扫只是刷新：此时不该 500，能拿多少给多少。
      if (meta.source_path !== '' && !existsSync(meta.source_path)) {
        const stored = getSessionDetail(db, key, { mode });
        if (stored !== null && stored.events.length > 0) {
          return stored;
        }
        // 源文件没了、库里也没有事件 —— 这是一条死行，回收掉并按「不存在」处理。
        deleteSession(db, key);
        return null;
      }
      await scanAndStoreDetail(db, key, { config, notify: notifyMerged });
    }
    let detail = getSessionDetail(db, key, { mode });
    const groups = sessionGroups();
    if (detail !== null && groups.length > 0) {
      const merged = await mergeSessionDetail(
        key,
        async (memberKey) => getSessionDetail(db, memberKey, { mode }),
        groups,
      );
      if (merged !== null) {
        detail = merged;
      }
    }
    return detail;
  };

  const router = new Router();
  const stopBenchmarks = registerBenchmarkRoutes(router, join(dirname(dbPath || opts.userConfigPath || join(process.cwd(), '.agent-observe', 'state.sqlite')), 'benchmark-demos'));
  const stopTeamExperiments = registerTeamExperimentRoutes(router, join(dirname(dbPath || opts.userConfigPath || join(process.cwd(), '.agent-observe', 'state.sqlite')), 'team-experiment-demos'));
  registerClaudeHookRoutes(router, hookReceiver);
  registerFridaCaptureRoutes(router, db);
  const experimentRegistry = new ExperimentRegistry(dirname(opts.userConfigPath ?? (dbPath || join(process.cwd(), '.agent-observe', 'state.sqlite'))));
  registerExperimentRoutes(router, experimentRegistry, keys => {
    const rows = cachedStmt(db, "SELECT id FROM sessions WHERE data_source='scan' AND id IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(keys)) as Array<{ id: string }>;
    return rows.map(row => row.id);
  });

  router.register('GET', '/api/monitoring', (req, res) => {
    res.setHeader('cache-control', 'no-store');
    sendJson(res, 200, { enabled: monitoringEnabled, state: monitoringState }, req);
  });
  router.register('PUT', '/api/monitoring', async (req, res) => {
    const body = await readJsonBody(req);
    if (closing) throw new HttpError(409, 'INTERNAL_ERROR', 'Server is closing');
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'BAD_REQUEST', 'enabled must be boolean');
    if (monitoringState === 'starting' || monitoringState === 'stopping') throw new HttpError(409, 'INTERNAL_ERROR', 'Monitoring transition in progress');
    if (body.enabled !== monitoringEnabled) {
      if (body.enabled) {
        monitoringState = 'starting';
        try { fileWatcher = createWatcher(); monitoringEnabled = true; monitoringState = 'running'; }
        catch (error) { monitoringState = 'idle'; throw error; }
      } else {
        monitoringState = 'stopping'; pendingAutomaticScans.clear();
        try {
          await fileWatcher?.close(); fileWatcher = null;
          while (scanInProgress) await new Promise(resolve => setTimeout(resolve, 5));
          await Promise.allSettled(scanTasks);
          monitoringEnabled = false; monitoringState = 'idle';
        } catch (error) { monitoringState = 'running'; throw error; }
      }
    }
    res.setHeader('cache-control', 'no-store');
    sendJson(res, 200, { enabled: monitoringEnabled, state: monitoringState }, req);
  });

  const taskNumber = (value: string | null): number | undefined => {
    if (value === null) return undefined;
    if (!/^\d+$/.test(value)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid task pagination');
    return Number(value);
  };
  router.register('GET', '/api/tasks', (req, res) => {
    const query = parseQuery(req), origin = query.get('origin') ?? 'collected';
    if (origin !== 'collected' && origin !== 'imported') throw new HttpError(400, 'BAD_REQUEST', 'Invalid task origin');
    const provider = query.get('provider'), range = query.get('range') ?? 'all';
    if (provider !== null && !(PROVIDER_KEYS as readonly string[]).includes(provider) || !['today', '7d', '30d', 'all'].includes(range)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid task filters');
    const options: TaskListQuery = { origin, q: query.get('q') ?? undefined, provider: provider as ProviderKey | undefined ?? undefined,
      range: range as TaskListQuery['range'], offset: taskNumber(query.get('offset')), limit: taskNumber(query.get('limit')) };
    res.setHeader('cache-control', 'no-store'); sendJson(res, 200, listTasks(db, options), req);
  });
  router.register('GET', '/api/tasks/:id', (req, res, params) => {
    res.setHeader('cache-control', 'no-store'); sendJson(res, 200, getTask(db, params.id!), req);
  });
  router.register('GET', '/api/tasks/:id/timeline', (req, res, params) => {
    const query = parseQuery(req);
    res.setHeader('cache-control', 'no-store');
    sendJson(res, 200, getTaskTimeline(db, getTask(db, params.id!), query.get('member') ?? 'main', query.get('window') ?? ''), req);
  });
  const nativeTaskReads = new Map<string, Promise<void>>();
  router.register('GET', '/api/tasks/:id/records', async (req, res, params) => {
    const query = parseQuery(req), status = query.get('status');
    if (status !== null && !(TRACE_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid record status');
    if (query.has('structure') && !['true','false'].includes(query.get('structure')!)) throw new HttpError(400,'BAD_REQUEST','Invalid structure option');
    const options: TaskRecordQuery = { member: query.get('member') ?? 'main', q: query.get('q') ?? undefined, status: status as TraceStatus | undefined ?? undefined,
      offset: taskNumber(query.get('offset')), limit: taskNumber(query.get('limit')), window: query.get('window') ?? undefined, anchor: query.get('anchor') ?? undefined,
      from: query.get('from') ?? undefined, to: query.get('to') ?? undefined, structure: query.get('structure') === 'true' };
    validateTaskRange(options);
    const context = getTask(db, params.id!);
    const members = recordMembers(context, options.member), warnings: string[] = [];
    let cancelled = false; const cancel = (): void => { cancelled = true; }; res.once('close', cancel);
    try {
      // A page continuation uses its existing immutable sequence window.
      if (!options.window && context.task.origin === 'collected') {
        let index = 0;
        const load = async (): Promise<void> => {
          while (!cancelled && !closing && index < members.length) {
            const member = members[index++]!;
            if (member.sessionKey === null) continue;
            const key = member.sessionKey;
            let pending = nativeTaskReads.get(key);
            if (!pending) {
              pending = (async () => {
                const meta = cachedStmt(db, 'SELECT provider,source_path FROM sessions WHERE id=?').get(key) as { provider: string; source_path: string } | undefined;
                if (!meta || meta.provider === 'trae' || !existsSync(meta.source_path)) { warnings.push('native_source_unavailable'); return; }
                await scanAndStoreDetail(db, key, { config, notify: notifyMerged });
              })();
              nativeTaskReads.set(key, pending);
            }
            try { await pending; } catch { warnings.push('native_parse_failed'); }
            finally { if (nativeTaskReads.get(key) === pending) nativeTaskReads.delete(key); }
          }
        };
        await Promise.all([load(), load()]);
      }
      if (cancelled) return;
      const page = taskRecords(db, options.window ? context : getTask(db, context.task.id), options);
      page.warnings = [...new Set([...page.warnings, ...warnings])];
      res.setHeader('cache-control', 'no-store'); sendJson(res, 200, page, req);
    } finally { res.removeListener('close', cancel); }
  });

  router.register('POST', '/api/trace-imports', async (req, res) => {
    const controller = new AbortController(), cancel = (): void => controller.abort();
    res.once('close', cancel);
    try {
      if (req.headers['content-type'] !== 'application/octet-stream') throw new TraceImportError('TRACE_IMPORT_INVALID');
      if (Number(req.headers['content-length'] ?? 0) > 128 * 1024 * 1024) throw new TraceImportError('TRACE_IMPORT_LIMIT');
      let filename: string;
      try { if (typeof req.headers['x-trace-filename'] !== 'string') throw new Error(); filename = decodeURIComponent(req.headers['x-trace-filename']); }
      catch { throw new TraceImportError('TRACE_IMPORT_INVALID'); }
      const result = await proxyRuntime.withStoppedMonitor(() => traceImporter.import(req, filename, controller.signal));
      sendJson(res, 200, result, req);
    } finally { res.removeListener('close', cancel); if (!req.complete && !req.destroyed) req.resume(); }
  });
  router.register('GET', '/api/trace-imports', (req, res) => {
    const page = importPaging(new URL(req.url ?? '/', 'http://127.0.0.1'), 1024);
    sendJson(res, 200, listImports(db, page.offset, page.limit), req);
  });
  router.register('GET', '/api/trace-imports/:id/turns', (req, res, params) => {
    const id = importId(params.id); requireImport(db, id);
    const page = importPaging(new URL(req.url ?? '/', 'http://127.0.0.1'), 2000);
    sendJson(res, 200, listImportTurns(db, id, page.offset, page.limit), req);
  });
  router.register('GET', '/api/trace-imports/:id/turns/:sequence', async (req, res, params) => {
    const controller = new AbortController(), cancel = (): void => controller.abort(); res.once('close', cancel);
    try { sendJson(res, 200, await traceImporter.detail(importId(params.id), importSequence(params.sequence), controller.signal), req); }
    finally { res.removeListener('close', cancel); }
  });
  router.register('GET', '/api/trace-imports/:id/source', async (_req, res, params) => {
    const id = importId(params.id), ref = requireImport(db, id).session.source;
    const stream = (await getFileStore()).openRead(ref.id);
    try { await once(stream, 'open'); } catch { stream.destroy(); throw new TraceImportError('TRACE_IMPORT_FAILED'); }
    stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy());
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="tracelog-${id.slice(0, 12)}.json"`,
      'content-length': ref.bytes, etag: '"' + ref.sha256 + '"', 'x-trace-sha256': ref.sha256, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    stream.pipe(res);
  });

  router.register('GET', '/api/health', (_req, res) => {
    const dbSizeBytes = dbPath !== '' && existsSync(dbPath) ? statSync(dbPath).size : 0;
    const walSizeBytes =
      dbPath !== '' && existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0;
    const counts = db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM sessions) AS sessions, ' +
          '(SELECT COUNT(*) FROM events) AS events',
      )
      .get() as { sessions: number; events: number };
    const body: HealthResponse = {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      monitoringEnabled,
      uptimeMs: Date.now() - startedAt,
      dbSizeBytes,
      walSizeBytes,
      sessionCount: counts.sessions,
      eventCount: counts.events,
      devOnly: DEV_ONLY_ROUTES,
    };
    sendJson(res, 200, body, _req);
  });

  router.register('GET', '/api/sessions', (req, res) => {
    const query = parseQuery(req);
    const dataSource = query.get('dataSource') ?? 'scan';
    if (dataSource !== 'scan' && dataSource !== 'proxy') {
      throw new HttpError(400, 'INVALID_ENUM', `dataSource must be "scan" or "proxy", got ${dataSource}`);
    }
    const list = (raw: string | null, allowed: readonly string[], label: string): string[] | undefined => {
      if (raw === null || raw === '') {
        return undefined;
      }
      const values = raw.split(',');
      for (const value of values) {
        if (!allowed.includes(value)) {
          throw new HttpError(400, 'INVALID_ENUM', `Unknown ${label}: ${value}`);
        }
      }
      return values;
    };
    const providers = list(query.get('provider'), PROVIDER_KEYS, 'provider');
    const statuses = list(query.get('status'), TRACE_STATUSES, 'status');
    const rangeRaw = query.get('range');
    const range =
      rangeRaw === null || rangeRaw === ''
        ? undefined
        : (rangeRaw as SessionRange);
    if (range !== undefined && !(SESSION_RANGES as readonly string[]).includes(range)) {
      throw new HttpError(400, 'INVALID_ENUM', `range must be today|7d|30d|all, got ${rangeRaw}`);
    }
    const keysRaw = query.get('keys');
    let keys: string[] | undefined;
    if (keysRaw !== null && keysRaw !== '') {
      keys = keysRaw.split(',');
      if (keys.length > 200) {
        throw new HttpError(400, 'BAD_REQUEST', 'keys limit is 200');
      }
    }
    const mergedRaw = query.get('merged');
    if (mergedRaw !== null && mergedRaw !== '1' && mergedRaw !== '0') {
      throw new HttpError(400, 'INVALID_ENUM', `merged must be 1|0, got ${mergedRaw}`);
    }
    // api.md §1.1 / design D14：tags 多选过滤，OR 语义（与 provider/status 同款
    // IN 匹配）。逗号分隔、上限 32；超过上限或值不满足 ANNOTATION_TAG_PATTERN
    // → 400 BAD_REQUEST。过滤在 listSessions 的一次 join 里完成，绝无逐行查询。
    const tagsRaw = query.get('tags');
    let tags: string[] | undefined;
    if (tagsRaw !== null && tagsRaw !== '') {
      tags = tagsRaw.split(',');
      if (tags.length > ANNOTATION_MAX_TAGS) {
        throw new HttpError(400, 'BAD_REQUEST', `tags limit is ${ANNOTATION_MAX_TAGS}`);
      }
      for (const value of tags) {
        if (!ANNOTATION_TAG_PATTERN.test(value)) {
          // 图案已限 1-64 字符：预览必然有界，避免错误信息回显超长值。
          const preview = value.length > 64 ? `${value.slice(0, 64)}...` : value;
          throw new HttpError(400, 'BAD_REQUEST', `invalid tag value: ${preview}`);
        }
      }
    }
    const result = listSessions(db, {
      dataSource,
      provider: providers as ProviderKey[] | undefined,
      status: statuses as TraceStatus[] | undefined,
      q: query.get('q')?.trim() || undefined,
      range,
      limit: intParam(query.get('limit'), 50, 500),
      cursor: query.get('cursor') ?? undefined,
      keys,
      tags,
      groups: mergedRaw === '0' ? [] : sessionGroups(),
    });
    sendJson(res, 200, result, req);
  });

  router.register('GET', '/api/sessions/:key', async (req, res, params) => {
    const key = params.key!;
    const query = parseQuery(req);
    const mode = query.get('mode') ?? 'slim';
    if (mode !== 'slim' && mode !== 'full') {
      throw new HttpError(400, 'INVALID_ENUM', `mode must be "slim" or "full", got ${mode}`);
    }
    const offset = intParam(query.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(query.get('limit'), 2000, 5000);
    // The session cache stores the canonical first page. Other page shapes must
    // not reuse or replace it; existing SSE invalidation remains session-scoped.
    const cacheable = offset === 0 && limit === 2000;
    const cacheKey = `${key}:${mode}`;
    const cached = cacheable ? detailCache.get(cacheKey) : undefined;
    if (cached !== undefined) {
      sendJson(res, 200, cached, req);
      return;
    }

    const meta = cachedStmt(
      db,
      'SELECT detail_loaded, source_path FROM sessions WHERE id = ?',
    ).get(key) as { detail_loaded: number; source_path: string } | undefined;
    if (meta === undefined) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    // 源文件已被删除（用户清理了 agent 历史目录）时不要再去解析它：
    // DB 才是持久层，重扫只是刷新。此前这里直接 500（SESSION_PARSE_FAILED），
    // 哪怕库里已经存着几百条事件。
    const sourceGone = meta.source_path !== '' && !existsSync(meta.source_path);

    let detail = getSessionDetail(db, key, { mode, offset, limit });
    if (detail === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    const groups = sessionGroups();
    if (groups.length > 0) {
      const merged = await mergeSessionDetail(
        key,
        async (memberKey) => getSessionDetail(db, memberKey, { mode, offset: 0, limit: 5000 }),
        groups,
        { offset, limit },
      );
      if (merged !== null) {
        detail = merged;
      }
    }

    if (meta.detail_loaded === 0) {
      const provider = detail.session.provider;
      if (provider === 'trae') {
        // Trae 解密只允许在后台轮询路径。无论密钥是否已配置，请求都立即返回
        // pending 占位，后台展开为原生 session cards 后通过 SSE 通知。
        sendJson(res, 200, { ...detail, pending: true }, req);
        return;
      }
    }
    // 只跳过「注定失败的那次解析」，其余流程（含 Trae pending 契约）照常。
    if (meta.detail_loaded === 0 && !sourceGone) {
      await scanAndStoreDetail(db, key, {
        config,
        notify: notifyMerged,
      });
      detail = getSessionDetail(db, key, { mode, offset, limit });
      const groups = sessionGroups();
      if (groups.length > 0) {
        const merged = await mergeSessionDetail(
          key,
          async (memberKey) => getSessionDetail(db, memberKey, { mode, offset: 0, limit: 5000 }),
          groups,
          { offset, limit },
        );
        if (merged !== null) {
          detail = merged;
        }
      }
      if (detail === null) {
        throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
      }
    }
    if (cacheable) detailCache.set(cacheKey, detail);
    sendJson(res, 200, detail, req);
  });

  router.register('GET', '/api/sessions/:key/prompt-context', (req, res, params) => {
    const key = params.key!;
    const exists = cachedStmt(db, 'SELECT id FROM sessions WHERE id = ?').get(key);
    if (exists === undefined) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    const context = getPromptContext(db, key);
    if (context === null) {
      throw new HttpError(
        404,
        'PROMPT_CONTEXT_NOT_FOUND',
        `No Prompt Context captured for session ${key}`,
        { key },
      );
    }
    sendJson(res, 200, context, req);
  });

  // api.md §1.7（add-trajectory-inspector D13）：注解路由对。与 prompt-context /
  // events/:eventId 同一约定：注册在 `:key` 泛化路由之后；Router 按精确段数
  // 匹配（4 段 vs `:key` 的 3 段不会互吞），保持此顺序防御未来被 `:key` 吞掉。
  // GET 未注解会话 → 200 空形状（tags: [] / note: null / updatedAt: null），
  // 不创建行，也**不是** 404；未知会话键 → 404 SESSION_NOT_FOUND。
  router.register('GET', '/api/sessions/:key/annotations', (req, res, params) => {
    const key = params.key!;
    const exists = cachedStmt(db, 'SELECT id FROM sessions WHERE id = ?').get(key);
    if (exists === undefined) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    sendJson(res, 200, readAnnotations(db, key), req);
  });

  // agent-collaboration-replay §2.1：按 session key 反查关联的 team run id 列表。
  // 查 team_run_sessions junction（idx_team_run_sessions_session 索引）→ JOIN
  // team_runs 取 id，按 started_at DESC 排序。session 不存在 → 404
  // SESSION_NOT_FOUND；存在但无关联 team run → 200 + runIds: []（前端据此隐藏章节）。
  // 与 annotations 同一约定：注册在 `:key` 泛化路由之后，Router 按精确段数匹配。
  router.register('GET', '/api/sessions/:key/team-run', (req, res, params) => {
    const key = params.key!;
    const exists = cachedStmt(db, 'SELECT id FROM sessions WHERE id = ?').get(key);
    if (exists === undefined) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    const runIds = getTeamRunIdsBySessionKey(db, key);
    sendJson(res, 200, { runIds }, req);
  });

  // PUT 部分更新：缺省键不动、tags:[] 清空、note:null 清空；每次成功写刷新
  // updatedAt。畸形 body / 边界违反（AnnotationBoundError）→ 400 BAD_REQUEST；
  // 未知会话键（AnnotationSessionNotFoundError）→ 404 SESSION_NOT_FOUND。
  // 错误信息只含干净的业务文本，绝无堆栈或 SQL。
  router.register('PUT', '/api/sessions/:key/annotations', async (req, res, params) => {
    const key = params.key!;
    const text = await readBody(req);
    let parsed: unknown = {};
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new HttpError(400, 'BAD_REQUEST', 'annotations body must be an object');
    }
    const body = parsed as Record<string, unknown>;
    const update: SessionAnnotationsUpdate = {};
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
        throw new HttpError(400, 'BAD_REQUEST', 'tags must be an array of strings');
      }
      update.tags = body.tags as string[];
    }
    if (body.note !== undefined) {
      if (typeof body.note !== 'string' && body.note !== null) {
        throw new HttpError(400, 'BAD_REQUEST', 'note must be a string or null');
      }
      update.note = body.note;
    }
    let result: SessionAnnotations;
    try {
      result = writeAnnotations(db, key, update);
    } catch (err) {
      if (err instanceof AnnotationBoundError) {
        // D13：违反边界 → 400，绝不静默截断，什么也不落库。
        throw new HttpError(400, 'BAD_REQUEST', err.message);
      }
      if (err instanceof AnnotationSessionNotFoundError) {
        throw new HttpError(404, 'SESSION_NOT_FOUND', err.message, { key });
      }
      throw err;
    }
    sendJson(res, 200, result, req);
  });

  // api.md §1.7：标签词表（D14 候选列表）。注册于 sessions 簇内、任何泛化
  // `:key` 模式之前；Router 按精确段数匹配，`/api/annotations/tags`（3 段，
  // 第 2 段字面量 annotations）今天不会被任何 `:key` 路由捕获，保持此位置
  // 以防御未来泛化模式的吞并风险（与 context-diff 注册顺序同一约定）。
  router.register('GET', '/api/annotations/tags', (_req, res) => {
    sendJson(res, 200, { tags: listTagVocabulary(db) }, _req);
  });

  router.register('GET', '/api/sessions/:key/events/:eventId', (req, res, params) => {
    const query = parseQuery(req);
    const includeRaw = query.get('include') === 'raw';
    let event = getEventDetail(db, params.key!, params.eventId!, includeRaw);
    // The primary session's timeline includes member events. Resolve their
    // bodies within that same group while keeping member-only views scoped.
    if (event === null) {
      const group = getMergeGroup(params.key!, sessionGroups());
      if (group !== null && group.primaryKey === params.key) {
        for (const memberKey of group.mergedKeys) {
          event = getEventDetail(db, memberKey, params.eventId!, includeRaw);
          if (event !== null) break;
        }
      }
    }
    if (event === null) {
      throw new HttpError(
        404,
        'EVENT_NOT_FOUND',
        `No event ${params.eventId} in session ${params.key}`,
        { key: params.key, eventId: params.eventId },
      );
    }
    sendJson(res, 200, event, req);
  });

  router.register('DELETE', '/api/sessions/:key', (req, res, params) => {
    const key = params.key!;
    const meta = cachedStmt(db, 'SELECT id FROM sessions WHERE id = ?').get(key);
    if (meta === undefined) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    deleteSession(db, key);
    detailCache.invalidate(`${key}:slim`);
    detailCache.invalidate(`${key}:full`);
    notifyMerged(key);
    sendJson(res, 200, { deleted: true, key }, req);
  });

  router.register('GET', '/api/agent-overview', (req, res) => {
    const query = parseQuery(req);
    const dataSource = query.get('dataSource') ?? 'scan';
    if (dataSource !== 'scan' && dataSource !== 'proxy') {
      throw new HttpError(400, 'INVALID_ENUM', `dataSource must be "scan" or "proxy", got ${dataSource}`);
    }
    sendJson(res, 200, getAgentOverview(db, dataSource), req);
  });

  // api.md §2.4：Mission 聚合，1 请求返回全部 A/B/C 三区 widget（G11.9）。
  const providerStatus = (): Array<{
    key: ProviderKey;
    enabled: boolean;
    sessionCount: number;
    lastScanAt: string | null;
    ready: boolean;
    blockedBy: string | null;
  }> => {
    const rows = cachedStmt(
      db,
      'SELECT provider, COUNT(*) AS session_count FROM sessions GROUP BY provider',
    ).all() as Array<{ provider: string; session_count: number }>;
    const sessionCounts = new Map(rows.map((r) => [r.provider, r.session_count]));
    const lastScans = cachedStmt(
      db,
      'SELECT provider, MAX(last_scan_at) AS last_scan_at FROM scan_state GROUP BY provider',
    ).all() as Array<{ provider: string; last_scan_at: string }>;
    const lastScanMap = new Map(lastScans.map((r) => [r.provider, r.last_scan_at]));
    return PROVIDER_KEYS.map((key) => {
      const cfg = config.providers[key]!;
      const ready = key === 'trae' ? (config.traeKeyPath !== null && config.traeKeyPath !== '') : cfg.enabled;
      const blockedBy =
        !ready
          ? key === 'trae'
            ? 'TRAE_KEY_MISSING'
            : 'PROVIDER_DISABLED'
          : null;
      return {
        key,
        enabled: cfg.enabled,
        sessionCount: sessionCounts.get(key) ?? 0,
        lastScanAt: lastScanMap.get(key) ?? null,
        ready,
        blockedBy,
      };
    });
  };

  router.register('GET', '/api/mission', async (req, res) => {
    const query = parseQuery(req);
    const range = query.get('range') ?? '7d';
    if (range !== '7d' && range !== '30d' && range !== 'all') {
      throw new HttpError(400, 'INVALID_ENUM', `range must be "7d", "30d" or "all", got ${range}`);
    }
    const dataSource = query.get('dataSource') ?? 'scan';
    if (dataSource !== 'scan' && dataSource !== 'proxy') {
      throw new HttpError(400, 'INVALID_ENUM', `dataSource must be "scan" or "proxy", got ${dataSource}`);
    }
    const tzRaw = query.get('tz') ?? '0';
    const tz = Number(tzRaw);
    if (!Number.isFinite(tz)) {
      throw new HttpError(400, 'BAD_REQUEST', `tz must be a number, got ${tzRaw}`);
    }
    const result = await getMission(db, {
      range: range as '7d' | '30d' | 'all',
      dataSource: dataSource as 'scan' | 'proxy',
      tz,
      ctx: {
        providers: providerStatus(),
        proxy: proxyRuntime.status(),
        frida: fridaRuntime.status(),
        dbPath,
        startedAt,
      },
    });
    sendJson(res, 200, result, req);
  });

  router.register('GET', '/api/providers/status', (_req, res) => {
    sendJson(res, 200, { providers: providerStatus() }, _req);
  });

  router.register('GET', '/api/proxy/requests', (req, res) => {
    const query = parseQuery(req);
    const captureMethod = query.get('captureMethod');
    sendJson(
      res,
      200,
      listProxyRequests(db, {
        limit: intParam(query.get('limit'), 50, 500),
        cursor: query.get('cursor') ?? undefined,
        hostname: query.get('hostname') ?? undefined,
        captureMethod:
          captureMethod === 'mitm' || captureMethod === 'cdp' || captureMethod === 'frida'
            ? captureMethod
            : undefined,
      }),
      req,
    );
  });

  // design D10 / §6.1：context-diff 必须在泛化 `:id` 路由之前注册；
  // Router 按精确段数匹配，但保持此顺序以避免任何未来被 `:id` 吞掉的风险。
  router.register('GET', '/api/proxy/requests/:id/context-diff', async (req, res, params) => {
    const targetId = Number(params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      throw new HttpError(400, 'BAD_REQUEST', 'invalid target request id', { role: 'target' });
    }
    const query = parseQuery(req);
    const baseRaw = query.get('base');
    // design D10：省略 base 等同于 base=previous；数字值必须是正整数。
    let base: 'previous' | number;
    if (baseRaw === undefined || baseRaw === null || baseRaw === '' || baseRaw === 'previous') {
      base = 'previous';
    } else {
      const parsed = Number(baseRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new HttpError(400, 'BAD_REQUEST', 'base must be "previous" or a positive integer', { role: 'base' });
      }
      base = parsed;
    }
    const result = await runContextDiff(db, { targetId, base }, getFileStore);
    if (!result.ok) {
      // design D10 统一错误映射：400/404/409/422/500；details 不含 body/header/stack。
      const { code, message, details } = result.error;
      const status = CONTEXT_DIFF_STATUS[code];
      sendApiError(res, status, code, message, details, req);
      return;
    }
    sendJson(res, 200, result.value, req);
  });

  router.register('GET', '/api/proxy/storage', async (req, res) => {
    sendJson(res, 200, (await getFileStore()).status(), req);
  });

  router.register('GET', '/api/proxy/capacity', async (req, res) => {
    sendJson(res, 200, await readCaptureCapacity(db), req);
  });

  router.register('GET', '/api/ca-cert', async (_req, res) => {
    const pem = await ensureInterceptCa(caDirectory);
    res.writeHead(200, {
      'content-type': 'application/x-pem-file',
      'content-disposition': 'attachment; filename="agent-observe-proxy-ca-cert.pem"',
      'content-length': Buffer.byteLength(pem),
    });
    res.end(pem);
  });

  const captureRequestId = (value: string | undefined): number => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'BAD_REQUEST', 'id must be a positive safe integer');
    const row = cachedStmt(db, 'SELECT id FROM proxy_requests WHERE id = ?').get(id);
    if (row === undefined) throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Proxy request not found');
    return id;
  };

  const tracePage = (req: IncomingMessage): { limit: number; cursor?: string } => {
    const query = parseQuery(req);
    return { limit: query.has('limit') ? Number(query.get('limit')) : 50, cursor: query.get('cursor') ?? undefined };
  };
  const numericTracePage = (req: IncomingMessage): { limit: number; cursor?: number } => {
    const options = tracePage(req);
    if (options.cursor !== undefined && !/^(?:0|[1-9]\d*)$/.test(options.cursor)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid numeric trace cursor');
    return { limit: options.limit, cursor: options.cursor === undefined ? undefined : Number(options.cursor) };
  };
  router.register('GET', '/api/sessions/:key/identities', (req, res, params) => {
    sendJson(res, 200, listTraceIdentities(db, { source: 'scan', key: params.key ?? '' }, tracePage(req)), req);
  });
  router.register('GET', '/api/proxy/requests/:id/identities', (req, res, params) => {
    const id = captureRequestId(params.id);
    sendJson(res, 200, listTraceIdentities(db, { source: 'proxy', key: String(id) }, tracePage(req)), req);
  });
  router.register('GET', '/api/sessions/:key/capture-links', (req, res, params) => {
    sendJson(res, 200, listSessionCaptureLinks(db, params.key ?? '', numericTracePage(req)), req);
  });
  router.register('GET', '/api/proxy/requests/:id/trace-links', (req, res, params) => {
    sendJson(res, 200, listProxyTraceLinks(db, captureRequestId(params.id), tracePage(req)), req);
  });
  router.register('PUT', '/api/proxy/requests/:id/trace-links/:key', async (req, res, params) => {
    const id = captureRequestId(params.id);
    const body = await readJsonBody(req, 16 * 1024);
    if (Object.keys(body).some(key => key !== 'state' && key !== 'note') || !['confirmed', 'rejected', 'revoked'].includes(String(body.state)) ||
      (body.note !== null && typeof body.note !== 'string')) throw new HttpError(400, 'BAD_REQUEST', 'Expected a user association state and nullable note');
    const state = body.state as 'confirmed' | 'rejected' | 'revoked';
    const result = decideTraceAssociation(db, id, params.key ?? '', state, body.note as string | null);
    queueTraceLinkChange(result.sessionKey, result.proxyId);
    sendJson(res, 200, result, req);
  });
  router.register('GET', '/api/proxy/requests/:id/trace-links/:key/decisions', (req, res, params) => {
    sendJson(res, 200, listTraceDecisions(db, captureRequestId(params.id), params.key ?? '', numericTracePage(req)), req);
  });

  router.register('GET', '/api/proxy/requests/:id/capture', (req, res, params) => {
    sendJson(res, 200, readCaptureBodies(db, captureRequestId(params.id)), req);
  });

  const codexRead = async (req: IncomingMessage, res: ServerResponse, selector: CodexSelector, sequence?: string): Promise<void> => {
    const controller = new AbortController();
    const abort = (): void => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      const query = parseQuery(req);
      const result = await codexInspector.read(selector, sequence === undefined
        ? { offset: codexInteger(query.get('offset'), 0, 4096), limit: codexInteger(query.get('limit'), 20, 20) }
        : { selected: codexInteger(sequence, 0, 4095) }, controller.signal);
      // An await must not resurrect a body whose durable deletion intent exists.
      const row = cachedStmt(db, 'SELECT id FROM proxy_requests WHERE request_id=?').get(result.requestId) as { id: number } | undefined;
      if (row !== undefined && getOriginalDeletionForProxy(db, row.id) !== null) throw new CodexSourceAccessError('CAPTURE_ORIGINALS_DELETED');
      if (!controller.signal.aborted) {
        if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
        res.setHeader('cache-control', 'no-store'); sendJson(res, 200, result, req);
      }
    } catch (error) {
      if (error instanceof CodexSourceAccessError) throw new HttpError(error.code === 'BAD_REQUEST' ? 400 : error.code === 'CAPTURE_ORIGINALS_DELETED' ? 409 : 404, error.code, error.code);
      if (error instanceof CodexInspectionError) throw new HttpError(error.code === 'CODEX_SOURCE_CHANGED' ? 409 : error.code === 'CODEX_SOURCE_UNAVAILABLE' ? 422 : 503, error.code, error.code);
      throw error;
    } finally { res.removeListener('close', abort); }
  };
  router.register('GET', '/api/proxy/live', (req, res) => { res.setHeader('cache-control', 'no-store'); sendJson(res, 200, liveCodexInventory(db), req); });
  router.register('GET', '/api/proxy/requests/:id/codex-calls', (req, res, params) => codexRead(req, res, { id: captureRequestId(params.id) }));
  router.register('GET', '/api/proxy/requests/:id/codex-calls/:sequence', (req, res, params) => codexRead(req, res, { id: captureRequestId(params.id) }, params.sequence));
  router.register('GET', '/api/proxy/live/:requestId/codex-calls', (req, res, params) => codexRead(req, res, { requestId: params.requestId ?? '' }));
  router.register('GET', '/api/proxy/live/:requestId/codex-calls/:sequence', (req, res, params) => codexRead(req, res, { requestId: params.requestId ?? '' }, params.sequence));

  router.register('GET', '/api/proxy/requests/:id/original-deletion', (req, res, params) => {
    sendJson(res, 200, getOriginalDeletionForProxy(db, captureRequestId(params.id)), req);
  });
  router.register('POST', '/api/proxy/requests/:id/original-deletion', async (req, res, params) => {
    const id = captureRequestId(params.id), body = await readJsonBody(req, 8 * 1024);
    if (Object.keys(body).some(key => key !== 'expectedRequestId' && key !== 'confirm') || body.confirm !== true ||
      typeof body.expectedRequestId !== 'string' || body.expectedRequestId.length === 0 || body.expectedRequestId.length > 1024) {
      throw new HttpError(400, 'BAD_REQUEST', 'Explicit confirmation and exact expectedRequestId are required');
    }
    const expected = body.expectedRequestId;
    const result = await proxyRuntime.withStoppedMonitor(async () => {
      try {
        const queue = new OriginalDeletionQueue(db, await getFileStore()), job = await queue.request(id, expected);
        // Invalidate body-derived conclusions as soon as deletion intent is durable.
        eventBus.emit('trace_links_changed', { sessionKeys: [], proxyIds: [id], truncated: false });
        return await queue.run(job.id);
      } catch (error) {
        if (error instanceof OriginalDeletionError && error.code === 'CAPTURE_DELETE_LIMIT') throw new HttpError(503, 'CAPTURE_DELETE_LIMIT', 'Retained deletion-job capacity reached; no new intent was recorded');
        if (error instanceof OriginalDeletionError && ['CAPTURE_DELETE_CONFLICT','CAPTURE_DELETE_SHARED_ORIGINAL','CAPTURE_DELETE_STORE_MISMATCH','CAPTURE_DELETE_INVALID_REF','CAPTURE_DELETE_BUSY'].includes(error.code)) {
          throw new HttpError(409, 'CAPTURE_DELETE_CONFLICT', 'Body deletion conflicts with retained evidence', { reason: error.code });
        }
        throw new HttpError(503, 'CAPTURE_DELETE_FAILED', 'Body deletion could not finish; inspect deletion status before retrying');
      }
    });
    sendJson(res, 200, result, req);
  });

  const readCaptureAnalysisSource = async (id: number, signal?: AbortSignal): Promise<ArchitectureCaptureSource> => {
    signal?.throwIfAborted();
    if (getOriginalDeletionForProxy(db, id) !== null) throw new HttpError(409, 'CAPTURE_ORIGINALS_DELETED', 'Original bodies were explicitly deleted; retained metadata is not body evidence');
    const request = getProxyRequestById(db, id)!;
    const capture = readCaptureBodies(db, id);
    const fingerprintFor = (bodies: typeof capture): string | null => {
      const metadata = cachedStmt(db, `SELECT request_id,method,request_format,request_headers,is_streaming,ttnet_encrypted
        FROM proxy_requests WHERE id=?`).get(id);
      return metadata === undefined ? null : createHash('sha256').update(JSON.stringify({ metadata,
        request: bodies.request, response: bodies.response, responseHeaders: bodies.responseHeaders, transport: bodies.transport,
      })).digest('hex');
    };
    const fingerprint = fingerprintFor(capture)!;
    const guard = (): void => {
      signal?.throwIfAborted();
      if (getOriginalDeletionForProxy(db, id) !== null) throw new HttpError(409, 'CAPTURE_ORIGINALS_DELETED', 'Original bodies were explicitly deleted during analysis');
      if (fingerprintFor(readCaptureBodies(db, id)) !== fingerprint) {
        throw new HttpError(409, 'CODEX_SOURCE_CHANGED', 'Capture source changed during analysis; retry against current evidence');
      }
    };
    if (request.method === 'WS' || capture.transport?.websocket !== undefined) {
      const analysis = await analyzeProtocol({ format: 'unknown', requestBody: '', responseBody: null, streaming: false, transport: capture.transport });
      analysis.state = 'unknown'; analysis.completeness = { complete: false, omittedCount: 1, reasons: ['websocket_connection_not_model_call'] };
      guard();
      return { analysis, requestBody: null, fingerprint, requestComplete: false };
    }
    const reasons: string[] = [];
    let requestComplete = false;
    const readDirection = async (direction: 'request' | 'response'): Promise<string | null> => {
      const ref = capture[direction];
      if (ref === null) {
        reasons.push(direction + ':legacy_preview');
        return direction === 'request' ? request.requestBody : request.responseBody;
      }
      const encoding = direction === 'request' ? request.requestHeaders['content-encoding'] : capture.responseHeaders['content-encoding'];
      const source = await readAnalysisBody(await getFileStore(), ref, 2 * 1024 * 1024, {
        allowIncomplete: true, contentEncoding: Array.isArray(encoding) ? encoding.join(',') : encoding,
      });
      guard();
      if (ref.status !== 'complete') reasons.push(direction + ':' + ref.status);
      if (!source.ok) { reasons.push(direction + ':' + source.reason); return null; }
      if (direction === 'request') requestComplete = ref.status === 'complete';
      return source.body;
    };
    const [requestBody, responseBody] = await Promise.all([readDirection('request'), readDirection('response')]);
    const format = request.requestFormat === 'unknown' && requestBody !== null && !request.ttnetEncrypted
      ? parseProxyRequest({ hostname: request.hostname, url: request.url, requestBody }).requestFormat ?? 'unknown'
      : request.requestFormat;
    const analysis = await analyzeProtocol({ format, requestBody: requestBody ?? '', responseBody, streaming: request.isStreaming, transport: capture.transport });
    guard();
    if (reasons.length > 0) {
      analysis.completeness.complete = false;
      analysis.completeness.reasons.push(...reasons);
      if (capture.response !== null && capture.response.status !== 'complete' && analysis.state === 'completed') {
        analysis.state = 'incomplete';
      }
    }
    return { analysis, requestBody, fingerprint, requestComplete };
  };
  const readCaptureAnalysis = async (id: number): Promise<ProxyProtocolAnalysis> => (await readCaptureAnalysisSource(id)).analysis;
  const architectureCollector = createArchitectureDiagnosisCollector({
    db, loadCapture: readCaptureAnalysisSource, loadCodex: (id, signal) => codexInspector.readDiagnosis({ id }, signal),
  });
  const stopArchitectureDiagnosis = registerArchitectureDiagnosisRoutes(router, architectureCollector);
  const stopAgentFolding = registerAgentFoldingRoutes(router, join(dirname(dbPath || opts.userConfigPath || join(process.cwd(), '.agent-observe', 'state.sqlite')), 'agent-folding-runs'), {
    loadNative: async (id, member, signal) => {
      const input = await architectureCollector.collect(id, member, signal);
      signal.throwIfAborted();
      const context = getTask(db, input.taskId);
      return nativeFoldingProject({ ...context, members: recordMembers(context, member) }, input, analyzeArchitectureDiagnosis(input));
    },
  });

  router.register('GET', '/api/proxy/requests/:id/analysis', async (req, res, params) => {
    sendJson(res, 200, await readCaptureAnalysis(captureRequestId(params.id)), req);
  });

  const validateReparseRequest = (req: IncomingMessage, value: string | undefined): number => {
    if (parseQuery(req).size !== 0 || typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new HttpError(400, 'BAD_REQUEST', 'Reparse requires one positive capture ID and no query parameters');
    }
    return captureRequestId(value);
  };
  const reparseError = (error: unknown): never => {
    if (error instanceof HttpError) throw error;
    if (error instanceof CaptureReparseError) {
      const errors = {
        BAD_REQUEST: 400, PROXY_REQUEST_NOT_FOUND: 404, CAPTURE_ORIGINALS_DELETED: 409,
        CAPTURE_REPARSE_CONFLICT: 409, CAPTURE_REPARSE_UNSUPPORTED: 422,
        CAPTURE_REPARSE_BUSY: 503, CAPTURE_REPARSE_FAILED: 503, CAPTURE_REPARSE_LIMIT: 503,
      } as const;
      const code = error.code as keyof typeof errors;
      if (Object.hasOwn(errors, code)) throw new HttpError(errors[code], code, 'Local capture reparse is unavailable; inspect its status before retrying', error.reason === null ? undefined : { reason: error.reason });
    }
    throw new HttpError(503, 'CAPTURE_REPARSE_FAILED', 'Local capture reparse failed; no upstream request was replayed');
  };
  const sendReparse = (req: IncomingMessage, res: ServerResponse, value: unknown, maxBytes: number): void => {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.byteLength > maxBytes) throw new HttpError(503, 'CAPTURE_REPARSE_LIMIT', 'Capture reparse response exceeds its bounded projection');
    sendCompressedOrPlain(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, bytes, req);
  };
  router.register('GET', '/api/proxy/requests/:id/reparse', (req, res, params) => {
    const id = validateReparseRequest(req, params.id);
    try { sendReparse(req, res, captureReparser.status(id), 16 * 1024); }
    catch (error) { reparseError(error); }
  });
  router.register('POST', '/api/proxy/requests/:id/reparse', async (req, res, params) => {
    const id = validateReparseRequest(req, params.id), body = await readJsonBody(req, 8 * 1024);
    if (Object.keys(body).some(key => key !== 'expectedRequestId') || typeof body.expectedRequestId !== 'string' || body.expectedRequestId.length === 0 || body.expectedRequestId.length > 1024) {
      throw new HttpError(400, 'BAD_REQUEST', 'Exact expectedRequestId is required for local reparse');
    }
    try {
      const result = await captureReparser.reparse(id, body.expectedRequestId);
      // The service result crossed one last await boundary. No await after
      // this metadata guard: a confirmed intent cannot leak old body analysis.
      const current = (() => {
        try { return captureReparser.status(id); }
        catch (error) {
          if (error instanceof CaptureReparseError && error.code === 'PROXY_REQUEST_NOT_FOUND') throw new HttpError(409, 'CAPTURE_REPARSE_CONFLICT', 'Capture source disappeared before the reparse response');
          throw error;
        }
      })();
      if (current.unavailableReason === 'originals_deleted') throw new HttpError(409, 'CAPTURE_ORIGINALS_DELETED', 'Original bodies were explicitly deleted during reparse');
      if (current.state !== 'current' || current.requestId !== body.expectedRequestId || current.snapshot?.sourceFingerprint !== result.status.snapshot?.sourceFingerprint) {
        throw new HttpError(409, 'CAPTURE_REPARSE_CONFLICT', 'Capture source changed before the reparse response');
      }
      sendReparse(req, res, result, 1024 * 1024);
    }
    catch (error) { reparseError(error); }
  });

  router.register('GET', '/api/proxy/requests/:id/comparison', async (req, res, params) => {
    const query = parseQuery(req);
    const validId = (value: string | null | undefined): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
    const base = query.get('base');
    if (!validId(params.id) || !validId(base) || query.getAll('base').length !== 1 || query.getAll('mode').length > 1 ||
      [...query.keys()].some(key => key !== 'base' && key !== 'mode') || (query.has('mode') && query.get('mode') !== 'metadata') || Number(base) === Number(params.id)) {
      throw new HttpError(400, 'BAD_REQUEST', 'Comparison requires two distinct positive capture IDs and a valid mode');
    }
    const targetId = captureRequestId(params.id); const baseId = captureRequestId(base);
    const metadataOnly = query.get('mode') === 'metadata';
    const optionalAnalysis = async (id: number): Promise<ProxyProtocolAnalysis | null> => {
      if (metadataOnly) return null;
      try { return await readCaptureAnalysis(id); }
      catch { return null; } // Report unavailable below; never expose internal source errors.
    };
    const [baseAnalysis, targetAnalysis] = await Promise.all([optionalAnalysis(baseId), optionalAnalysis(targetId)]);
    // No await after both fresh deletion checks: body-derived summaries cannot
    // return from an older asynchronous original read after confirmed intent.
    const snapshot = db.transaction((): CaptureComparisonResponse => {
      const side = (id: number, parsed: ProxyProtocolAnalysis | null): CaptureComparisonSide => {
        const request = getProxyRequestListItemById(db, id);
        if (request === null) throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Proxy request not found');
        const originalDeletion = getOriginalDeletionForProxy(db, id);
        const capture = readCaptureBodies(db, id);
        const { responseHeaders: _headers, ...evidence } = capture; void _headers;
        const analysis = originalDeletion !== null || metadataOnly || parsed === null ? null : {
          parserVersion: parsed.parserVersion, requestFormat: parsed.requestFormat, model: parsed.model, state: parsed.state,
          stopReason: parsed.stopReason, usage: structuredClone(parsed.usage), completeness: structuredClone(parsed.completeness),
          errorCount: parsed.errors.length, errorCodes: parsed.errors.slice(0, 32).map(error => error.code), errorCodesTruncated: parsed.errors.length > 32,
        };
        return { request, evidence, originalDeletion, analysis, analysisUnavailableReason: originalDeletion !== null ? 'original_deleted' :
          metadataOnly ? 'metadata_only' : analysis === null ? 'analysis_unavailable' : null };
      };
      return { base: side(baseId, baseAnalysis), target: side(targetId, targetAnalysis), generatedAt: new Date().toISOString() };
    })();
    const bytes = Buffer.from(JSON.stringify(snapshot));
    if (bytes.length > 1024 * 1024) throw new HttpError(503, 'CAPTURE_COMPARISON_LIMIT', 'Capture comparison exceeds its bounded projection');
    sendCompressedOrPlain(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, bytes, req);
  });

  router.register('GET', '/api/sessions/:key/family', (req, res, params) => {
    const query = parseQuery(req);
    if ([...query.keys()].some(key => key !== 'limit' && key !== 'cursor') || query.getAll('limit').length > 1 || query.getAll('cursor').length > 1 ||
      (query.has('limit') && !/^[1-9]\d*$/.test(query.get('limit')!))) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid session family query');
    }
    try {
      const page = getNativeSessionFamily(db, params.key ?? '', { limit: Number(query.get('limit') ?? 20), cursor: query.get('cursor') ?? undefined });
      res.setHeader('cache-control', 'no-store');
      sendJson(res, 200, page, req);
    } catch (error) {
      if (error instanceof LinkedExecutionLimitError) throw new HttpError(503, 'EXECUTION_METADATA_LIMIT', 'Session family metadata cannot fit its bounded page');
      throw error;
    }
  });

  router.register('GET', '/api/sessions/:key/parents', (req, res, params) => {
    const query = parseQuery(req);
    if ([...query.keys()].some(key => key !== 'limit' && key !== 'cursor') || query.getAll('limit').length > 1 || query.getAll('cursor').length > 1 ||
      (query.has('limit') && !/^[1-9]\d*$/.test(query.get('limit')!)) || (query.has('cursor') && !/^[a-f0-9]{64}$/.test(query.get('cursor')!))) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid native parent reference page');
    }
    try {
      sendJson(res, 200, getNativeSessionParents(db, params.key ?? '', { limit: Number(query.get('limit') ?? 20), cursor: query.get('cursor') ?? undefined }), req);
    } catch (error) {
      if (error instanceof LinkedExecutionLimitError) throw new HttpError(503, 'EXECUTION_METADATA_LIMIT', 'Native parent metadata cannot fit its bounded page');
      throw error;
    }
  });

  const captureExportSnapshot = (id: number, exportedAt: string, analysis: ProxyProtocolAnalysis | null = null,
    reason: CaptureEvidenceExport['analysisUnavailableReason'] = 'metadata_only'): CaptureEvidenceExport | null => db.transaction(() => {
      const item = getProxyRequestListItemById(db, id);
      if (item === null) return null;
      const { hasSystemPrompt: _hasSystemPrompt, ...requestMetadata } = item;
      void _hasSystemPrompt;
      const headers = cachedStmt(db, 'SELECT request_headers FROM proxy_requests WHERE id=?').get(id) as { request_headers: string };
      const request = { ...requestMetadata, requestHeaders: JSON.parse(headers.request_headers) as CaptureEvidenceExport['request']['requestHeaders'] };
      return assembleCaptureEvidenceExport({ request, capture: readCaptureBodies(db, id),
        originalDeletion: getOriginalDeletionForProxy(db, id), analysis, analysisUnavailableReason: reason,
        identities: listTraceIdentities(db, { source: 'proxy', key: String(id) }, { limit: 100 }),
        traceLinks: listProxyTraceLinks(db, id, { limit: 100 }), schemaVersion: SCHEMA_VERSION, exportedAt });
    })();
  const captureBundler = new CaptureBundleExporter({ snapshot: captureExportSnapshot, getStore: getFileStore,
    current: (id, requestId, refs, originals) => {
      if (getProxyRequestListItemById(db, id)?.requestId !== requestId) return false;
      if (!originals) return true;
      if (getOriginalDeletionForProxy(db, id) !== null) return false;
      const current = readCaptureBodies(db, id);
      return JSON.stringify([current.request, current.response]) === JSON.stringify([refs.request, refs.response]);
    } });
  registerCaptureBundleRoutes(router, captureBundler);

  router.register('GET', '/api/proxy/requests/:id/export', async (req, res, params) => {
    const id = captureRequestId(params.id);
    const query = parseQuery(req);
    if ([...query.keys()].some(key => key !== 'mode') || query.getAll('mode').length > 1 || (query.has('mode') && query.get('mode') !== 'metadata')) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid capture export mode');
    }
    const metadataOnly = query.get('mode') === 'metadata';
    let analysis: ProxyProtocolAnalysis | null = null;
    let reason: CaptureEvidenceExport['analysisUnavailableReason'] = metadataOnly ? 'metadata_only' : null;
    try { if (!metadataOnly) analysis = await readCaptureAnalysis(id); }
    catch { reason = 'analysis_unavailable'; }
    // Fresh synchronous snapshot after async analysis; no deleted projection revival.
    const snapshot = captureExportSnapshot(id, new Date().toISOString(), analysis, reason);
    if (snapshot === null) throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Proxy request not found');
    let encoded: string;
    try { encoded = stringifyCaptureEvidenceExport(snapshot); }
    catch (error) {
      if (error instanceof CaptureExportLimitError) throw new HttpError(503, 'CAPTURE_EXPORT_LIMIT', 'Capture evidence export exceeds its bounded package size');
      throw error;
    }
    sendCompressedOrPlain(res, 200, { 'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="capture-${id}.json"`, 'cache-control': 'no-store' }, Buffer.from(encoded), req);
  });

  router.register('GET', '/api/sessions/:key/trace-export', (req, res, params) => {
    handleTraceExport(req, res, db, params.key ?? '');
  });

  router.register('GET', '/api/sessions/:key/linked-trace-export', (req, res, params) => {
    handleLinkedTraceExport(req, res, db, params.key ?? '');
  });

  router.register('GET', '/api/sessions/:key/tool-observations', (req, res, params) => {
    const query = parseQuery(req);
    const allowed = new Set(['namespace', 'value', 'scope', 'limit', 'cursor']);
    for (const key of query.keys()) {
      if (!allowed.has(key) || query.getAll(key).length !== 1) throw new HttpError(400, 'BAD_REQUEST', 'Invalid native tool observation query');
    }
    for (const key of ['limit', 'cursor']) if (query.has(key) && (!/^(0|[1-9]\d*)$/.test(query.get(key)!) || !Number.isSafeInteger(Number(query.get(key))))) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid native tool observation pagination');
    }
    let page;
    try { page = getNativeToolObservations(db, params.key ?? '', {
      namespace: query.get('namespace') ?? '', value: query.get('value') ?? '', scope: query.get('scope') ?? '',
      limit: query.has('limit') ? Number(query.get('limit')) : undefined,
      cursor: query.has('cursor') ? Number(query.get('cursor')) : undefined,
    }); } catch (error) {
      if (error instanceof LinkedExecutionLimitError) throw new HttpError(503, 'EXECUTION_METADATA_LIMIT', 'Native tool metadata cannot fit its bounded page');
      throw error;
    }
    res.setHeader('cache-control', 'no-store'); sendJson(res, 200, page, req);
  });

  router.register('GET', '/api/sessions/:key/execution', (req, res, params) => {
    const query = parseQuery(req);
    const defaults = { eventOffset: 0, eventLimit: 100, captureLimit: 20 };
    const allowed = new Set(['eventOffset', 'eventLimit', 'captureCursor', 'captureLimit']);
    for (const key of query.keys()) {
      const value = query.get(key)!;
      if (!allowed.has(key) || query.getAll(key).length !== 1 || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid execution page query');
      }
    }
    let page;
    try { page = getLinkedExecution(db, params.key ?? '', {
      eventOffset: Number(query.get('eventOffset') ?? defaults.eventOffset),
      eventLimit: Number(query.get('eventLimit') ?? defaults.eventLimit),
      captureCursor: query.has('captureCursor') ? Number(query.get('captureCursor')) : undefined,
      captureLimit: Number(query.get('captureLimit') ?? defaults.captureLimit),
    }); } catch (error) {
      if (error instanceof LinkedExecutionLimitError) throw new HttpError(503, 'EXECUTION_METADATA_LIMIT', 'Execution metadata cannot fit its bounded page');
      throw error;
    }
    sendJson(res, 200, page, req);
  });

  router.register('GET', '/api/proxy/requests/:id/body/:direction', async (req, res, params) => {
    const id = captureRequestId(params.id);
    const direction = params.direction;
    if (direction !== 'request' && direction !== 'response') throw new HttpError(400, 'BAD_REQUEST', 'direction must be request or response');
    if (getOriginalDeletionForProxy(db, id) !== null) throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Original bodies were explicitly deleted');
    const ref = readCaptureBodies(db, id)[direction];
    if (ref === null) throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Original body is unavailable');
    const etag = '"' + ref.sha256 + '"';
    const range = parseBodyByteRange(req.headers['if-range'] === undefined || req.headers['if-range'] === etag ? req.headers.range : undefined, ref.bytes);
    if (range === 'invalid') throw new HttpError(400, 'BAD_REQUEST', 'Expected one valid byte range');
    if (range === 'unsatisfiable') {
      res.setHeader('content-range', `bytes */${ref.bytes}`);
      throw new HttpError(416, 'RANGE_NOT_SATISFIABLE', 'Requested byte range does not overlap retained original bytes');
    }
    const stream = (await getFileStore()).openRead(ref.id, range ?? undefined);
    try {
      await once(stream, 'open');
    } catch {
      stream.destroy();
      throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Original body file is unavailable');
    }
    if (getOriginalDeletionForProxy(db, id) !== null) { stream.destroy(); throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', 'Original bodies were explicitly deleted'); }
    stream.on('error', (error) => res.destroy(error));
    res.once('close', () => stream.destroy());
    res.writeHead(range === null ? 200 : 206, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${ref.id}.body"`,
      'content-length': range === null ? ref.bytes : range.end - range.start + 1,
      'accept-ranges': 'bytes',
      etag,
      ...(range === null ? {} : { 'content-range': `bytes ${range.start}-${range.end}/${ref.bytes}` }),
      'x-capture-status': ref.status,
      'x-capture-sha256': ref.sha256,
    });
    stream.pipe(res);
  });

  router.register('GET', '/api/proxy/requests/:id', (req, res, params) => {
    const id = Number(params.id);
    const request = Number.isInteger(id) ? getProxyRequestById(db, id) : null;
    if (request === null) {
      throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', `No proxy request with id ${params.id}`);
    }
    sendJson(res, 200, getOriginalDeletionForProxy(db, id) === null ? request : {
      ...request, requestBody: null, responseBody: null, rawRequestBody: null, rawResponseBody: null, systemPrompt: null,
    }, req);
  });

  const connectionPlan = async (req: IncomingMessage, profile: MonitorConnectionProfile) => {
    const pem = await ensureInterceptCa(caDirectory);
    const host = req.socket.localAddress === '::1' ? '[::1]' : '127.0.0.1';
    return buildConnectionPlan(profile, {
      controlUrl: `http://${host}:${req.socket.localPort}`, nodePath: process.execPath,
      cliPath: opts.launcherCliPath ?? fileURLToPath(new URL('../bin/agent-observe.js', import.meta.url)),
      caSha256: createHash('sha256').update(pem, 'utf8').digest('hex'), status: proxyRuntime.status(),
    });
  };
  router.register('GET', '/api/proxy/profiles', async (req, res) => {
    sendJson(res, 200, { items: await connectionProfiles.list() }, req);
  });
  router.register('POST', '/api/proxy/profiles', async (req, res) => {
    sendJson(res, 201, await connectionProfiles.create(await readJsonBody(req, 32 * 1024)), req);
  });
  router.register('PUT', '/api/proxy/profiles/:id', async (req, res, params) => {
    const body = await readJsonBody(req, 32 * 1024);
    sendJson(res, 200, await connectionProfiles.update(params.id ?? '', body.settings, body.expectedRevision), req);
  });
  router.register('DELETE', '/api/proxy/profiles/:id', async (req, res, params) => {
    const body = await readJsonBody(req, 32 * 1024);
    await connectionProfiles.remove(params.id ?? '', body.expectedRevision);
    sendJson(res, 200, { deleted: true }, req);
  });
  router.register('GET', '/api/proxy/profiles/:id/plan', async (req, res, params) => {
    sendJson(res, 200, await connectionPlan(req, await connectionProfiles.get(params.id ?? '')), req);
  });
  router.register('GET', '/api/proxy/profiles/:id/diagnostics', async (req, res, params) => {
    const profile = await connectionProfiles.get(params.id ?? '');
    sendJson(res, 200, await inspectConnection(profile, caDirectory, () => proxyRuntime.status()), req);
  });
  router.register('POST', '/api/proxy/profiles/:id/self-test', async (req, res, params) => {
    const body = await readJsonBody(req, 32 * 1024);
    if (parseQuery(req).size !== 0 || Object.keys(body).length !== 1 || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) throw new HttpError(400, 'BAD_REQUEST', 'Only a positive integer expectedRevision is accepted; no destination or process parameters');
    const profile = await connectionProfiles.get(params.id ?? '');
    if (validateExpectedRevision(body.expectedRevision) !== profile.revision) throw new ConnectionProfileError('MONITOR_PROFILE_CONFLICT', 'Connection profile changed; reload before testing', 409);
    if (closing) throw new HttpError(503, 'SERVER_SHUTTING_DOWN', 'Server is draining');
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      const report = await captureSelfTester.run(profile, controller.signal);
      res.setHeader('cache-control', 'no-store'); sendJson(res, 200, report, req);
    } finally { res.removeListener('close', abort); }
  });
  router.register('POST', '/api/proxy/profiles/:id/start', async (req, res, params) => {
    const body = await readJsonBody(req, 32 * 1024);
    const profile = await connectionProfiles.get(params.id ?? '');
    if (validateExpectedRevision(body.expectedRevision) !== profile.revision) throw new ConnectionProfileError('MONITOR_PROFILE_CONFLICT', 'Connection profile changed; reload before launching', 409);
    const current = proxyRuntime.status();
    if (current.diagnostics?.cleanupPending || ((current.running || current.starting) && current.port !== profile.proxyPort)) throw new ProxyStateError('PROXY_ALREADY_RUNNING', 'A different or closing proxy owns the listener; stop it explicitly before switching ports');
    if (!current.running && !current.starting) proxyRuntime.start({ port: profile.proxyPort });
    await proxyRuntime.waitUntilReady();
    sendJson(res, 200, await connectionPlan(req, profile), req);
  });

  router.register('GET', '/api/proxy/capabilities', (req, res) => {
    if (parseQuery(req).size !== 0) throw new HttpError(400, 'BAD_REQUEST', 'Capability manifest does not accept query parameters');
    const bytes = Buffer.from(JSON.stringify(getMonitorCapabilities()));
    sendCompressedOrPlain(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, bytes, req);
  });

  router.register('GET', '/api/proxy/status', (_req, res) => {
    sendJson(res, 200, proxyRuntime.status(), _req);
  });

  router.register('POST', '/api/proxy/start', async (req, res) => {
    const body = await readJsonBody(req);
    const rawPort = body.port;
    let port: number | undefined;
    if (rawPort !== undefined) {
      if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
        throw new HttpError(400, 'BAD_REQUEST', 'port must be an integer between 1 and 65535');
      }
      port = rawPort;
    }
    // D4：handler 立即返回 starting 态，不阻塞事件循环
    sendJson(res, 200, proxyRuntime.start({ port }), req);
  });

  router.register('POST', '/api/proxy/stop', async (_req, res) => {
    sendJson(res, 200, await proxyRuntime.stop(), _req);
  });

  router.register('GET', '/api/frida/status', (_req, res) => {
    sendJson(res, 200, fridaRuntime.status(), _req);
  });

  router.register('POST', '/api/frida/start', async (req, res) => {
    const body = await readJsonBody(req);
    const rawPid = body.pid;
    let pid: number | undefined;
    if (rawPid !== undefined) {
      if (typeof rawPid !== 'number' || !Number.isSafeInteger(rawPid) || rawPid <= 0) {
        throw new HttpError(400, 'BAD_REQUEST', 'pid must be a positive integer');
      }
      pid = rawPid;
    }
    sendJson(res, 200, await fridaRuntime.start({ pid }), req);
  });

  router.register('POST', '/api/frida/stop', async (_req, res) => {
    sendJson(res, 200, await fridaRuntime.stop(), _req);
  });

  router.register('GET', '/api/config/providers', (_req, res) => {
    sendJson(res, 200, config, _req);
  });
  // api.md §6：合并组配置（手工 session-groups.json + 自动 subagent 组）。
  // 成员 keys 可直接用于 GET /api/sessions?keys= 批量拉取索引行。
  router.register('GET', '/api/session-groups', (_req, res) => {
    sendJson(res, 200, { groups: sessionGroups() }, _req);
  });

  router.register('GET', '/api/desensitization/rules', (_req, res) => {
    const override = loadRulesOverride(rulesPath);
    sendJson(
      res,
      200,
      { rules: resolveRules(override), keepRawBodies: shouldKeepRawBodies(override) },
      _req,
    );
  });

  router.register('PUT', '/api/desensitization/rules', async (req, res) => {
    const body = await readJsonBody(req);
    const enabled = Array.isArray(body.enabled) ? (body.enabled as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const disabled = Array.isArray(body.disabled) ? (body.disabled as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const keepRawBodies = typeof body.keepRawBodies === 'boolean' ? body.keepRawBodies : false;
    const override: DesensitizationOverride = { enabled, disabled, keepRawBodies };
    // REQ-005：PUT 必须原子写
    mkdirSync(dirname(rulesPath), { recursive: true });
    const tmp = `${rulesPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(override, null, 2), 'utf8');
    renameSync(tmp, rulesPath);
    sendJson(
      res,
      200,
      { rules: resolveRules(override), keepRawBodies: shouldKeepRawBodies(override) },
      req,
    );
  });

  router.register('PUT', '/api/config/providers', async (req, res) => {
    const body = await readJsonBody(req);
    if (typeof body.providers !== 'object' || body.providers === null) {
      throw new HttpError(400, 'BAD_REQUEST', 'body must contain a providers object');
    }
    const project = loadProjectConfig(opts.projectConfigPath);
    const merged = mergeLocalSessionConfig(
      config,
      project,
      body as unknown as LocalSessionConfig,
    );
    saveUserConfig(merged, opts.userConfigPath);
    sendJson(res, 200, merged, req);
  });

  router.register('POST', '/api/scan', async (req, res) => {
    if (scanInProgress) {
      throw new HttpError(429, 'SCAN_IN_PROGRESS', 'A scan is already in progress');
    }
    const body = await readJsonBody(req);
    const provider = body.provider as string | undefined;
    if (provider !== undefined && !(PROVIDER_KEYS as readonly string[]).includes(provider)) {
      throw new HttpError(400, 'INVALID_ENUM', `Unknown provider: ${provider}`);
    }
    scanInProgress = true;
    try {
      eventBus.emit('scan_started', { provider: provider as ProviderKey | undefined ?? 'all' });
      const results = await scanProviders(provider as ProviderKey | undefined, body.force === true);
      eventBus.emit('scan_completed', {
        provider: provider as ProviderKey | undefined ?? 'all',
        count: results.reduce((sum, result) => sum + result.eventCount, 0),
      });
      sendJson(res, 200, { providers: results }, req);
    } finally {
      scanInProgress = false;
      const next = pendingAutomaticScans.values().next().value;
      if (!closing && next !== undefined) {
        pendingAutomaticScans.delete(next);
        void runAutomaticScan(next);
      }
    }
  });

  router.register('POST', '/api/compare', async (req, res) => {
    const body = await readJsonBody(req);
    const leftKey = body.leftKey;
    const rightKey = body.rightKey;
    if (typeof leftKey !== 'string' || typeof rightKey !== 'string') {
      throw new HttpError(400, 'BAD_REQUEST', 'leftKey and rightKey are required');
    }
    const left = await ensureDetail(leftKey, 'slim');
    if (left === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${leftKey}`, { key: leftKey });
    }
    const right = await ensureDetail(rightKey, 'slim');
    if (right === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${rightKey}`, { key: rightKey });
    }
    const toRecord = (detail: SessionDetailResponse): TraceRecord => ({
      session: detail.session,
      events: detail.events as TraceEvent[],
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
      // v7 未持久化 provenance；B 阶段由 API 提供真实值
      turnKeySource: 'unavailable',
    });
    sendJson(
      res,
      200,
      {
        left,
        right,
        speed: {
          left: computeSpeedMetrics(toRecord(left)),
          right: computeSpeedMetrics(toRecord(right)),
        },
      },
      req,
    );
  });

  // ── Team runs（add-agent-team-observability §6.1–6.10 / api.md §7） ──────
  // 所有 team 路由：gzip 感知、ApiError 信封、markForegroundRequest（入口已统一）。
  // 禁止 spawnSync / readFileSync 大文件 / 逐实体循环（design D13 / 禁令 4/6）。

  const TEAM_RUN_STATUSES: readonly TeamRunStatus[] = [
    'planned', 'running', 'blocked', 'success', 'error', 'cancelled', 'unknown',
  ];
  const TEAM_ACTIVITY_KINDS: readonly TeamActivityKind[] = [
    'agent_lifecycle', 'task_created', 'task_dependency', 'task_assignment',
    'task_status', 'round', 'message_sent', 'message_received', 'tool_call',
    'tool_result', 'artifact', 'verification', 'handoff', 'error', 'recovery',
    'integration', 'unknown',
  ];
  const COMPLETION_LEVELS: readonly CompletenessLevel[] = [
    'complete', 'partial', 'unavailable', 'conflicted',
  ];

  /** 把逗号分隔的多选参数拆成数组，非法值 → INVALID_ENUM。 */
  const multiSelect = (
    raw: string | null,
    allowed: readonly string[],
    label: string,
  ): string[] | undefined => {
    if (raw === null || raw === '') {
      return undefined;
    }
    const values = raw.split(',');
    for (const value of values) {
      if (!allowed.includes(value)) {
        throw new HttpError(400, 'INVALID_ENUM', `Unknown ${label}: ${value}`);
      }
    }
    return values;
  };

  /** §6.5–6.6 比较基准评估（design D10）：从两个 snapshot 的 summary 字段推导
   *  goalMatch / modelMatch / completenessDelta 等。project/revision/environment/
   *  template 在当前 snapshot 中不可观测 → null（禁止捏造，design D4）。 */
  const evaluateTeamBasis = (
    left: TeamRunSnapshot,
    right: TeamRunSnapshot,
    userDeclared: boolean,
  ): TeamComparisonBasis => {
    const reasons: string[] = [];
    const leftGoal = left.summary.goalFingerprint;
    const rightGoal = right.summary.goalFingerprint;
    const goalMatch =
      leftGoal === null || rightGoal === null
        ? null
        : leftGoal === rightGoal;
    if (goalMatch === false) {
      reasons.push('goal fingerprint differs');
    }

    // modelMatch：两侧 agent model 集合是否相同（null model 视为 unknown）。
    const leftModels = new Set(
      left.agents.map((a) => a.model).filter((m): m is string => m !== null),
    );
    const rightModels = new Set(
      right.agents.map((a) => a.model).filter((m): m is string => m !== null),
    );
    const modelMatch =
      leftModels.size === 0 || rightModels.size === 0
        ? null
        : leftModels.size === rightModels.size &&
          [...leftModels].every((m) => rightModels.has(m));
    if (modelMatch === false) {
      reasons.push('agent model set differs');
    }

    // completenessDelta：任一维度 completeness 不同。
    const dims = Object.keys(left.summary.completeness) as Array<
      keyof typeof left.summary.completeness
    >;
    const completenessDelta = dims.some(
      (d) => left.summary.completeness[d] !== right.summary.completeness[d],
    );
    if (completenessDelta) {
      reasons.push('completeness differs on at least one evidence dimension');
    }

    // project / revision / environment / template 在当前 snapshot 中不可观测。
    const projectMatch = null;
    const revisionMatch = null;
    const environmentMatch = null;
    const templateMatch = null;

    // 匹配规则（design D10）：
    // matched：goal/criteria 与起始状态全同，所有 material 字段已知。
    // partially_matched：goal 匹配但起始/model/environment 字段有差异或未知。
    // unmatched：goal/project/criteria/起始状态实质不同。
    // unknown：证据太不完整无法判定。
    let match: ComparisonMatch;
    if (
      goalMatch === null ||
      modelMatch === null ||
      left.summary.completeness.topology === 'unavailable' ||
      right.summary.completeness.topology === 'unavailable'
    ) {
      match = 'unknown';
      reasons.push('evidence too incomplete to decide match');
    } else if (goalMatch === false) {
      match = 'unmatched';
    } else if (
      modelMatch === true &&
      !completenessDelta &&
      projectMatch === null &&
      revisionMatch === null &&
      environmentMatch === null &&
      templateMatch === null
    ) {
      // goal 匹配且无已知字段冲突；未知字段保持 null 而非 false。
      match = userDeclared ? 'matched' : 'partially_matched';
      if (!userDeclared) {
        reasons.push('goal matches but project/revision/environment/template are unknown');
      }
    } else {
      match = 'partially_matched';
    }

    return {
      match,
      goalMatch,
      criteriaMatch: null,
      projectMatch,
      revisionMatch,
      environmentMatch,
      modelMatch,
      templateMatch,
      completenessDelta,
      userDeclared,
      reasons,
    };
  };

  /** §6.9 POST /api/team-compare：比较服务入口。 */
  router.register('POST', '/api/team-compare', async (req, res) => {
    const body = await readJsonBody(req);
    const leftRunId = body.leftRunId;
    const rightRunId = body.rightRunId;
    if (typeof leftRunId !== 'string' || typeof rightRunId !== 'string') {
      throw new HttpError(400, 'TEAM_COMPARE_INVALID', 'leftRunId and rightRunId are required');
    }
    if (leftRunId === rightRunId) {
      throw new HttpError(400, 'TEAM_COMPARE_INVALID', 'leftRunId and rightRunId must differ');
    }
    const manualBasisRaw = body.manualBasis;
    if (
      manualBasisRaw !== undefined &&
      typeof manualBasisRaw !== 'boolean'
    ) {
      throw new HttpError(400, 'TEAM_COMPARE_INVALID', 'manualBasis must be a boolean');
    }
    const manualBasis = manualBasisRaw === true;

    const inputs = getTeamCompareInputs(db, leftRunId, rightRunId);
    if (inputs.left === null) {
      throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${leftRunId}`, {
        runId: leftRunId,
      });
    }
    if (inputs.right === null) {
      throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${rightRunId}`, {
        runId: rightRunId,
      });
    }

    const basis = evaluateTeamBasis(inputs.left, inputs.right, manualBasis);
    const comparison = compareTeams({
      leftRunId,
      rightRunId,
      left: inputs.left.metrics,
      right: inputs.right.metrics,
      basis,
      generatedAt: new Date().toISOString(),
    });
    sendJson(res, 200, comparison, req);
  });

  /** §6.1 GET /api/team-runs：keyset 分页 slim 列表。 */
  router.register('GET', '/api/team-runs', (req, res) => {
    const query = parseQuery(req);
    const providers = multiSelect(query.get('provider'), PROVIDER_KEYS, 'provider');
    const statuses = multiSelect(query.get('status'), TEAM_RUN_STATUSES, 'status');
    const topologies = multiSelect(query.get('topology'), TEAM_TOPOLOGY_KINDS, 'topology');
    const completeness = multiSelect(query.get('completeness'), COMPLETION_LEVELS, 'completeness');
    const rangeRaw = query.get('range');
    const range =
      rangeRaw === null || rangeRaw === ''
        ? undefined
        : (rangeRaw as 'today' | '7d' | '30d' | 'all');
    if (
      range !== undefined &&
      !(['today', '7d', '30d', 'all'] as readonly string[]).includes(range)
    ) {
      throw new HttpError(400, 'INVALID_ENUM', `range must be today|7d|30d|all, got ${rangeRaw}`);
    }
    const opts: ListTeamRunsOptions = {
      provider: providers as ProviderKey[] | undefined,
      status: statuses as TeamRunStatus[] | undefined,
      topology: topologies as TeamTopologyKind[] | undefined,
      q: query.get('q')?.trim() || undefined,
      range,
      completeness: completeness as CompletenessLevel[] | undefined,
      limit: intParam(query.get('limit'), 50, 500),
      cursor: query.get('cursor') ?? undefined,
    };
    sendJson(res, 200, listTeamRuns(db, opts), req);
  });

  /** §6.2 GET /api/team-runs/:runId：有界快照 + stamp 缓存。 */
  router.register('GET', '/api/team-runs/:runId', (req, res, params) => {
    const runId = params.runId!;
    const snapshot = getTeamRunSnapshot(db, runId);
    if (snapshot === null) {
      throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${runId}`, { runId });
    }
    // stamp 缓存：用 summary.stamp 作为缓存键；首次请求 cached=false。
    // 这里不持久化缓存（进程内 stamp 已由 storage 层管理），仅返回 stamp 供客户端。
    sendJson(
      res,
      200,
      { snapshot, stamp: snapshot.summary.stamp, cached: false },
      req,
    );
  });

  /** §6.3 GET /api/team-runs/:runId/activities：keyset 分页 slim 账本。 */
  router.register('GET', '/api/team-runs/:runId/activities', (req, res, params) => {
    const runId = params.runId!;
    const query = parseQuery(req);
    // 先确认 run 存在（404 TEAM_RUN_NOT_FOUND）。
    const snapshot = getTeamRunSnapshot(db, runId);
    if (snapshot === null) {
      throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${runId}`, { runId });
    }
    const kinds = multiSelect(query.get('kind'), TEAM_ACTIVITY_KINDS, 'kind');
    const statuses = multiSelect(query.get('status'), TRACE_STATUSES, 'status');
    const fromRaw = query.get('from');
    const toRaw = query.get('to');
    const opts: ListTeamActivitiesOptions = {
      agent: query.get('agent') ?? undefined,
      task: query.get('task') ?? undefined,
      kind: kinds as TeamActivityKind[] | undefined,
      status: statuses as TraceStatus[] | undefined,
      from: fromRaw ?? undefined,
      to: toRaw ?? undefined,
      limit: intParam(query.get('limit'), 200, 500),
      cursor: query.get('cursor') ?? undefined,
    };
    sendJson(res, 200, listTeamActivities(db, runId, opts), req);
  });

  /** §6.3 GET /api/team-runs/:runId/activities/:activityId：单条详情，include 分层。 */
  router.register(
    'GET',
    '/api/team-runs/:runId/activities/:activityId',
    (req, res, params) => {
      const runId = params.runId!;
      const activityId = params.activityId!;
      const query = parseQuery(req);
      const includeRaw = query.get('include');
      if (includeRaw !== null && includeRaw !== 'body' && includeRaw !== 'raw') {
        throw new HttpError(400, 'BAD_REQUEST', `include must be body|raw, got ${includeRaw}`);
      }
      const include = includeRaw === 'body' || includeRaw === 'raw' ? includeRaw : undefined;
      const result = getTeamActivityDetail(db, runId, activityId, include);
      if (result === null) {
        // run 或 activity 不存在。区分 404：先查 run。
        const snapshot = getTeamRunSnapshot(db, runId);
        if (snapshot === null) {
          throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${runId}`, { runId });
        }
        throw new HttpError(404, 'TEAM_ACTIVITY_NOT_FOUND', `No activity with id ${activityId}`, {
          activityId,
        });
      }
      // include 请求但 body/raw 行缺失 → TEAM_BODY_UNAVAILABLE。
      if (include === 'body' && result.body === null) {
        throw new HttpError(409, 'TEAM_BODY_UNAVAILABLE', `Body not available for activity ${activityId}`, {
          activityId,
        });
      }
      if (include === 'raw' && result.raw === null) {
        throw new HttpError(409, 'TEAM_BODY_UNAVAILABLE', `Raw not available for activity ${activityId}`, {
          activityId,
        });
      }
      sendJson(res, 200, result, req);
    },
  );

  /** §6.4 GET /api/team-runs/:runId/patch：有界 SSE 补丁。 */
  router.register('GET', '/api/team-runs/:runId/patch', (req, res, params) => {
    const runId = params.runId!;
    const query = parseQuery(req);
    const stamp = query.get('stamp');
    if (stamp === null || stamp === '') {
      throw new HttpError(400, 'BAD_REQUEST', 'stamp is required for an incremental patch');
    }
    const patch = getTeamPatch(db, runId, stamp);
    if (patch === null) {
      throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${runId}`, { runId });
    }
    sendJson(res, 200, patch, req);
  });

  /** §6.10 DELETE /api/team-runs/:runId：显式删除派生 team run，不删 sessions/源文件。 */
  router.register('DELETE', '/api/team-runs/:runId', (req, res, params) => {
    const runId = params.runId!;
    const deleted = deleteTeamRun(db, runId);
    if (!deleted) {
      throw new HttpError(404, 'TEAM_RUN_NOT_FOUND', `No team run with id ${runId}`, { runId });
    }
    sendJson(res, 200, { deleted: true, runId }, req);
  });

  router.register('GET', '/api/sessions/:key/report', async (req, res, params) => {
    const key = params.key!;
    const detail = await ensureDetail(key, 'full');
    if (detail === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    const record: TraceRecord = {
      session: detail.session,
      events: detail.events as TraceEvent[],
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
      // v7 未持久化 provenance；B 阶段由 API 提供真实值
      turnKeySource: 'unavailable',
    };
    const report = buildTraceReportHtml(record);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(report.html);
  });

  router.register('GET', '/api/sessions/:key/report-data.js', async (req, res, params) => {
    const key = params.key!;
    const detail = await ensureDetail(key, 'full');
    if (detail === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }
    const record: TraceRecord = {
      session: detail.session,
      events: detail.events as TraceEvent[],
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
      // v7 未持久化 provenance；B 阶段由 API 提供真实值
      turnKeySource: 'unavailable',
    };
    const report = buildTraceReportHtml(record);
    if (report.externalDataJs === undefined) {
      throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This session report has no external data file');
    }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(report.externalDataJs);
  });

  router.register('GET', '/api/compare/report', async (req, res) => {
    const query = parseQuery(req);
    const leftKey = query.get('left');
    const rightKey = query.get('right');
    if (leftKey === null || rightKey === null) {
      throw new HttpError(400, 'BAD_REQUEST', 'left and right are required');
    }
    const left = await ensureDetail(leftKey, 'full');
    const right = await ensureDetail(rightKey, 'full');
    if (left === null || right === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Compare session not found');
    }
    const toRecord = (detail: SessionDetailResponse): TraceRecord => ({
      session: detail.session,
      events: detail.events as TraceEvent[],
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
      // v7 未持久化 provenance；B 阶段由 API 提供真实值
      turnKeySource: 'unavailable',
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const locale = query.get('locale') === 'en' ? 'en' : 'zh';
    res.end(buildCompareReportHtml(toRecord(left), toRecord(right), locale));
  });

  router.register('GET', '/api/events', (req, res) => {
    const query = parseQuery(req);
    const requestId = query.get('requestId') ?? undefined;
    const lastEventId = req.headers['last-event-id'];
    const hasControl = (value: string): boolean => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if ([...query.keys()].some(key => key !== 'requestId') || query.getAll('requestId').length > 1 ||
      (requestId !== undefined && (requestId.length === 0 || requestId.length > 1024 || hasControl(requestId))) ||
      (lastEventId !== undefined && (typeof lastEventId !== 'string' || lastEventId.length > 128 || hasControl(lastEventId)))) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid live subscription or resume cursor');
    }
    // 头信息由 addSseClient 统一写入（REQ-005）
    const cleanup = addSseClient(res, { requestId, lastEventId });
    ownSseClients.add(cleanup);
    req.on('close', () => { cleanup(); ownSseClients.delete(cleanup); });
  });

  const server = createServer((req, res) => {
    // Even rejected work follows the shared foreground/error-envelope chain.
    markForegroundRequest();
    if (closing) {
      sendApiError(res, 503, 'SERVER_SHUTTING_DOWN', 'Server is draining', undefined, req);
      return;
    }
    // REQ-007 / api.md §0.6：每个 /api/* 请求进入时标记前台请求
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] ?? '/';
    let match: ReturnType<Router['match']>;
    try {
      match = router.match(method, pathname);
    } catch (error) {
      sendApiError(res, error instanceof URIError ? 400 : 500, error instanceof URIError ? 'BAD_REQUEST' : 'INTERNAL_ERROR', error instanceof URIError ? 'Malformed URL path encoding' : 'Route matching failed', undefined, req);
      return;
    }
    if (match === null) {
      if (!pathname.startsWith('/api')) {
        // T-01：所有 /api/* 路由之后挂静态兜底；/api/* 仍走统一 404 信封
        if (serveStatic(req, res, distDir)) {
          return;
        }
      }
      sendApiError(
        res,
        404,
        'ROUTE_NOT_FOUND',
        `No route registered for ${method} ${pathname}`,
        undefined,
        req,
      );
      return;
    }
    const handler = (async () => {
      try {
        if (pathname.startsWith('/api/agent-folding/') || pathname.startsWith('/api/team-experiments/') || pathname.startsWith('/api/benchmarks/') || pathname.startsWith('/api/tasks') || pathname === '/api/monitoring' || pathname === '/api/events' || pathname.startsWith('/api/hooks/') || pathname.startsWith('/api/proxy/') || pathname.startsWith('/api/frida/') || pathname === '/api/trace-imports' || pathname.startsWith('/api/trace-imports/') || pathname === '/api/experiment-records' || pathname.startsWith('/api/experiment-records/') || pathname === '/api/ca-cert' || /^\/api\/sessions\/[^/]+\/(?:identities|capture-links|execution|parents|family|tool-observations|trace-export|linked-trace-export)$/.test(pathname)) {
          if (pathname.startsWith('/api/tasks') || pathname === '/api/monitoring') res.setHeader('cache-control', 'no-store');
          if (pathname.startsWith('/api/hooks/')) res.setHeader('cache-control', 'no-store');
          if (pathname.startsWith('/api/frida/')) res.setHeader('cache-control', 'no-store');
          if (pathname.startsWith('/api/trace-imports')) res.setHeader('cache-control', 'no-store');
          const localHost = (host: string): boolean => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
          const remote = req.socket.remoteAddress ?? '';
          if (!(remote === '::1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.'))) {
            throw new HttpError(400, 'BAD_REQUEST', 'Capture access requires a local connection');
          }
          let trusted = false;
          try {
            trusted = localHost(new URL(`http://${req.headers.host ?? ''}`).hostname);
            if (req.headers.origin !== undefined) trusted &&= localHost(new URL(req.headers.origin).hostname);
          } catch {
            trusted = false;
          }
          if (!trusted) throw new HttpError(400, 'BAD_REQUEST', 'Untrusted capture Host or Origin');
        }
        if (pathname === '/api/proxy/requests' || pathname.startsWith('/api/proxy/requests/')) {
          try { await startupRecovery; } catch (error) {
            if (!(error instanceof CaptureCapacityError)) throw new HttpError(503, 'INTERNAL_ERROR', 'CAPTURE_RECOVERY_FAILED; original evidence was retained');
            // Pressure defers unindexed journals; committed rows remain readable/
            // explicitly cleanable. Starting retries recovery after pressure relief.
          }
        }
        await match.handler(req, res, match.params);
      } catch (err) {
        if (err instanceof TaskReadError) {
          sendApiError(res, err.code === 'BAD_REQUEST' ? 400 : 404, err.code, err.message, undefined, req); return;
        }
        if (err instanceof TraceImportError) {
          const status = err.code === 'TRACE_IMPORT_INVALID' ? 400 : err.code === 'TRACE_IMPORT_LIMIT' ? 413 : err.code === 'TRACE_IMPORT_BUSY' ? 409 : err.code === 'TRACE_IMPORT_NOT_FOUND' ? 404 : 503;
          sendApiError(res, status, err.code, err.code, undefined, req); return;
        }
        if (err instanceof CaptureSelfTestError) {
          sendApiError(res, err.code === 'MONITOR_SELF_TEST_BUSY' || err.code === 'MONITOR_SELF_TEST_NOT_READY' ? 409 : 503, err.code, err.message, undefined, req);
          return;
        }
        if (err instanceof ConnectionProfileError) {
          sendApiError(res, err.status, err.code, err.message, undefined, req);
          return;
        }
        if (err instanceof TraceLinkError) {
          sendApiError(res, err.code === 'BAD_REQUEST' ? 400 : 404, err.code, err.message, undefined, req);
          return;
        }
        if (err instanceof HttpError) {
          sendApiError(res, err.status, err.code, err.message, err.details, req);
          return;
        }
        // T-11（REQ-022）：详情解析失败用专属错误码，MUST NOT 返回 200 + 空（G5.6）
        if (err instanceof SessionParseError) {
          sendApiError(res, 500, 'SESSION_PARSE_FAILED', err.message, undefined, req);
          return;
        }
        // T-12（api.md §4/§5）：proxy/frida 状态冲突与目标未找到用专属错误码
        if (err instanceof ProxyStateError) {
          sendApiError(res, err.code === 'PROXY_STOP_FAILED' ? 503 : 409, err.code, err.message, undefined, req);
          return;
        }
        if (err instanceof FridaTargetError) {
          sendApiError(res, 409, 'FRIDA_TARGET_NOT_FOUND', err.message, undefined, req);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          message,
          undefined,
          req,
        );
      }
    })();
    activeHandlers.add(handler);
    void handler.finally(() => activeHandlers.delete(handler));
  });
  server.once('listening', () => {
    startupRecovery = (async () => {
      if (cachedStmt(db, PENDING_ORIGINAL_DELETION_SQL).get() !== undefined) { await getBodyStore(); return; }
      try { await access(join(captureDirectory, '.capture-journal')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      await getBodyStore();
    })();
    void startupRecovery.catch(() => console.error('Capture recovery failed; original evidence retained'));
  });
  const createWatcher = () => startFileWatcher(
    Object.values(config.providers).filter((provider): provider is NonNullable<typeof provider> => provider !== undefined),
    runAutomaticScan,
  );
  let fileWatcher = monitoringEnabled ? createWatcher() : null;
  // Keep the plain Node Server/return value, but make its close callback the
  // ownership boundary: callers may close SQLite only after it succeeds.
  const closeHttp = server.close.bind(server);
  let shutdown: Promise<void> | null = null;
  let httpClosed: Promise<void> | null = null;
  server.close = (callback) => {
    if (shutdown === null) {
      closing = true;
      stopBenchmarks();
      stopTeamExperiments();
      stopArchitectureDiagnosis();
      stopAgentFolding();
      pendingAutomaticScans.clear();
      for (const cleanup of ownSseClients) cleanup();
      ownSseClients.clear();
      if (httpClosed === null) {
        httpClosed = new Promise<void>((resolve, reject) => closeHttp(error => {
          if (error !== undefined && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve();
        }));
        void httpClosed.catch(() => {});
      }
      shutdown = (async () => {
        await hookReceiver.close();
        await captureBundler.close();
        await captureSelfTester.close();
        await captureReparser.close();
        await codexInspector.close();
        await traceImporter.close();
        const proxy = proxyRuntime.status();
        const proxyStopped = proxy.running || proxy.starting || proxy.diagnostics?.cleanupPending ? proxyRuntime.stop() : Promise.resolve();
        await Promise.all([proxyStopped, fridaRuntime.stop(), (async () => {
          await fileWatcher?.close();
          // A handler may still be reading its request before starting a scan.
          // Observe all registered scan tasks only after those handlers settle.
          await Promise.all(activeHandlers);
          await startupRecovery?.catch(() => {});
          while (scanInProgress) await new Promise(resolve => setTimeout(resolve, 5));
          await Promise.allSettled(scanTasks);
          await httpClosed;
        })()]);
      })().catch(error => { shutdown = null; throw error; });
    }
    void shutdown.then(() => callback?.(), error => {
      if (callback !== undefined) callback(error instanceof Error ? error : new Error('Server cleanup failed'));
      else console.error('Server cleanup failed; SQLite must remain open');
    });
    return server;
  };
  return server;
}

function loadProjectConfig(projectConfigPath?: string): LocalSessionConfig | null {
  if (projectConfigPath === undefined) {
    return null;
  }
  if (!existsSync(projectConfigPath)) {
    return null;
  }
  return JSON.parse(readFileSync(projectConfigPath, 'utf8')) as LocalSessionConfig;
}

function loadRulesOverride(rulesPath: string): DesensitizationOverride {
  if (!existsSync(rulesPath)) {
    return EMPTY_OVERRIDE;
  }
  try {
    const parsed = JSON.parse(readFileSync(rulesPath, 'utf8')) as Partial<DesensitizationOverride>;
    return {
      enabled: Array.isArray(parsed.enabled) ? parsed.enabled : [],
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
      keepRawBodies: parsed.keepRawBodies === true,
    };
  } catch {
    return EMPTY_OVERRIDE;
  }
}
