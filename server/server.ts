import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { dirname, join } from 'node:path';

import type { Database } from 'better-sqlite3';

import type {
  LocalSessionConfig,
  ProviderKey,
  SessionDetailResponse,
  TraceEvent,
  TraceRecord,
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
import { getProxyRequestById } from './storage/query-engine.js';
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
  buildSubagentMergeGroups,
  loadSessionGroups,
  mergeSessionDetail,
  primaryKeyFor,
  type SessionMergeGroup,
} from './storage/session-merge.js';
import { deleteSession } from './storage/writers.js';
import { SCHEMA_VERSION } from './storage/schema.js';
import { cachedStmt } from './storage/stmt-cache.js';
import { addSseClient } from './realtime/sse.js';
import { queueSessionChange } from './realtime/coalescer.js';
import { eventBus } from './realtime/event-bus.js';
import { markForegroundRequest } from './realtime/frontline.js';
import { scanAndStoreDetail, scanLocalSessions, SessionParseError } from './watch/scan-scheduler.js';
import { startFileWatcher } from './watch/file-watcher.js';
import { Router } from './http/router.js';
import { sendJson } from './http/send-json.js';
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

const DEV_ONLY_ROUTES = [
  '/api/cdp/start',
  '/api/cdp/stop',
  '/api/cdp/status',
  '/api/cdp/targets',
] as const;

export interface AgentObservabilityServerOptions {
  db: Database;
  config: LocalSessionConfig;
  dbPath?: string;
  /** 前端构建产物目录。缺省为 cwd/dist（T-01：静态兜底）。 */
  distDir?: string;
  detailCache?: DetailCache;
  projectConfigPath?: string;
  userConfigPath?: string;
  rulesPath?: string;
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
  schemaVersion: number;
  uptimeMs: number;
  dbSizeBytes: number;
  walSizeBytes: number;
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const text = await readBody(req);
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

export function createAgentObservabilityServer(
  opts: AgentObservabilityServerOptions,
): Server {
  const { db, config } = opts;
  const dbPath = opts.dbPath ?? '';
  const distDir = opts.distDir ?? join(process.cwd(), 'dist');
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
  let scanInProgress = false;
  const pendingAutomaticScans = new Set<ProviderKey>();

  const scanProviders = async (
    provider: ProviderKey | undefined,
    force: boolean,
  ) => scanLocalSessions({
    db,
    config,
    force,
    providers: provider === undefined ? undefined : [provider],
    notify: notifyMerged,
    emit: (event) => { eventBus.emit(event.type, event); },
  });

  const runAutomaticScan = async (provider: ProviderKey): Promise<void> => {
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
      if (next !== undefined) {
        pendingAutomaticScans.delete(next);
        void runAutomaticScan(next);
      }
    }
  };
  // T-12（D4）：proxy/frida 运行时状态机，异步启动由 SSE 通知
  const proxyRuntime = new ProxyRuntime(db, (payload) => {
    eventBus.emit('proxy_status', payload);
  });
  const fridaRuntime = new FridaRuntime((payload) => {
    eventBus.emit('frida_status', payload);
  });

  /** REQ-015：惰性详情加载（compare/report 与 GET 详情同口径）。 */
  const ensureDetail = async (
    key: string,
    mode: 'slim' | 'full',
  ): Promise<SessionDetailResponse | null> => {
    const meta = cachedStmt(db, 'SELECT detail_loaded, provider FROM sessions WHERE id = ?').get(key) as
      | { detail_loaded: number; provider: ProviderKey }
      | undefined;
    if (meta === undefined) {
      return null;
    }
    if (meta.detail_loaded === 0 && meta.provider !== 'trae') {
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

  router.register('GET', '/api/health', (_req, res) => {
    const dbSizeBytes = dbPath !== '' && existsSync(dbPath) ? statSync(dbPath).size : 0;
    const walSizeBytes =
      dbPath !== '' && existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0;
    const body: HealthResponse = {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      uptimeMs: Date.now() - startedAt,
      dbSizeBytes,
      walSizeBytes,
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
    const result = listSessions(db, {
      dataSource,
      provider: providers as ProviderKey[] | undefined,
      status: statuses as TraceStatus[] | undefined,
      q: query.get('q')?.trim() || undefined,
      range,
      limit: intParam(query.get('limit'), 50, 500),
      cursor: query.get('cursor') ?? undefined,
      keys,
      groups: sessionGroups(),
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
    const cacheKey = `${key}:${mode}`;
    const cached = detailCache.get(cacheKey);
    if (cached !== undefined) {
      sendJson(res, 200, cached, req);
      return;
    }

    const meta = cachedStmt(db, 'SELECT detail_loaded FROM sessions WHERE id = ?').get(key) as
      | { detail_loaded: number }
      | undefined;
    if (meta === undefined) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }

    const offset = intParam(query.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(query.get('limit'), 2000, 5000);
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
    detailCache.set(cacheKey, detail);
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

  router.register('GET', '/api/sessions/:key/events/:eventId', (req, res, params) => {
    const query = parseQuery(req);
    const includeRaw = query.get('include') === 'raw';
    const event = getEventDetail(db, params.key!, params.eventId!, includeRaw);
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

  router.register('GET', '/api/proxy/requests/:id', (req, res, params) => {
    const id = Number(params.id);
    const request = Number.isInteger(id) ? getProxyRequestById(db, id) : null;
    if (request === null) {
      throw new HttpError(404, 'PROXY_REQUEST_NOT_FOUND', `No proxy request with id ${params.id}`);
    }
    sendJson(res, 200, request, req);
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

  router.register('POST', '/api/proxy/stop', (_req, res) => {
    sendJson(res, 200, proxyRuntime.stop(), _req);
  });

  router.register('GET', '/api/frida/status', (_req, res) => {
    sendJson(res, 200, fridaRuntime.status(), _req);
  });

  router.register('POST', '/api/frida/start', async (req, res) => {
    const body = await readJsonBody(req);
    const rawPid = body.pid;
    let pid: number | undefined;
    if (rawPid !== undefined) {
      if (typeof rawPid !== 'number' || !Number.isInteger(rawPid) || rawPid <= 0) {
        throw new HttpError(400, 'BAD_REQUEST', 'pid must be a positive integer');
      }
      pid = rawPid;
    }
    sendJson(res, 200, await fridaRuntime.start({ pid }), req);
  });

  router.register('POST', '/api/frida/stop', (_req, res) => {
    sendJson(res, 200, fridaRuntime.stop(), _req);
  });

  router.register('GET', '/api/frida/captures', (_req, res) => {
    const rows = cachedStmt(
      db,
      `SELECT id, pid, captured_at, capture_type, json_data, model, session_id, capture_session_id, message_count, tokens_json
       FROM frida_captures ORDER BY captured_at DESC LIMIT 50`,
    ).all() as Array<Record<string, unknown>>;
    const items = rows.map((row) => ({
      id: row.id,
      pid: row.pid,
      capturedAt: row.captured_at,
      captureType: row.capture_type,
      jsonData: String(row.json_data ?? '').slice(0, 500),
      model: row.model,
      sessionId: row.session_id,
      captureSessionId: row.capture_session_id,
      messageCount: row.message_count,
      tokens: row.tokens_json === null ? null : JSON.parse(row.tokens_json as string),
    }));
    sendJson(res, 200, { items, nextCursor: null, hasMore: false }, _req);
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
      if (next !== undefined) {
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
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const locale = query.get('locale') === 'en' ? 'en' : 'zh';
    res.end(buildCompareReportHtml(toRecord(left), toRecord(right), locale));
  });

  router.register('GET', '/api/events', (req, res) => {
    // 头信息由 addSseClient 统一写入（REQ-005）
    const cleanup = addSseClient(res);
    req.on('close', cleanup);
  });

  const server = createServer((req, res) => {
    // REQ-007 / api.md §0.6：每个 /api/* 请求进入时标记前台请求
    markForegroundRequest();
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] ?? '/';
    const match = router.match(method, pathname);
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
    void (async () => {
      try {
        await match.handler(req, res, match.params);
      } catch (err) {
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
          sendApiError(res, 409, err.code, err.message, undefined, req);
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
  });
  const fileWatcher = startFileWatcher(
    Object.values(config.providers).filter((provider): provider is NonNullable<typeof provider> => provider !== undefined),
    runAutomaticScan,
  );
  server.once('close', () => { void fileWatcher.close(); });
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
