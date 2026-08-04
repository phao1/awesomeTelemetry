import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';

import type { Database } from 'better-sqlite3';

import type {
  LocalSessionConfig,
  ProviderKey,
  SessionDetailResponse,
  TraceEvent,
  TraceRecord,
} from '../src/core/trace-types.js';
import { PROVIDER_KEYS } from '../src/core/trace-types.js';
import { computeSpeedMetrics } from '../src/core/speed-metrics.js';
import {
  mergeLocalSessionConfig,
  saveUserConfig,
} from '../local-sessions/config.js';
import { getProxyRequestById } from './storage/query-engine.js';
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
import { deleteSession } from './storage/writers.js';
import { SCHEMA_VERSION } from './storage/schema.js';
import { cachedStmt } from './storage/stmt-cache.js';
import { addSseClient } from './realtime/sse.js';
import { queueSessionChange } from './realtime/coalescer.js';
import { eventBus } from './realtime/event-bus.js';
import { markForegroundRequest } from './realtime/frontline.js';
import { scanAndStoreDetail, scanLocalSessions } from './watch/scan-scheduler.js';
import { Router } from './http/router.js';
import { sendJson } from './http/send-json.js';
import { sendApiError, type ErrorCode } from './http/error-envelope.js';

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
  detailCache?: DetailCache;
  projectConfigPath?: string;
  userConfigPath?: string;
}

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
    throw new HttpError(400, 'BAD_REQUEST', '请求体不是合法 JSON');
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
  const detailCache = opts.detailCache ?? new DetailCache();
  const startedAt = Date.now();
  let scanInProgress = false;

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
      throw new HttpError(400, 'INVALID_ENUM', `dataSource 必须是 scan 或 proxy，收到 ${dataSource}`);
    }
    const providerRaw = query.get('provider');
    if (providerRaw !== null && !(PROVIDER_KEYS as readonly string[]).includes(providerRaw)) {
      throw new HttpError(400, 'INVALID_ENUM', `未知 provider: ${providerRaw}`);
    }
    const keysRaw = query.get('keys');
    let keys: string[] | undefined;
    if (keysRaw !== null && keysRaw !== '') {
      keys = keysRaw.split(',');
      if (keys.length > 200) {
        throw new HttpError(400, 'BAD_REQUEST', 'keys 上限 200 个');
      }
    }
    const result = listSessions(db, {
      dataSource,
      provider: providerRaw === null ? undefined : (providerRaw as ProviderKey),
      limit: intParam(query.get('limit'), 50, 500),
      cursor: query.get('cursor') ?? undefined,
      keys,
    });
    sendJson(res, 200, result, req);
  });

  router.register('GET', '/api/sessions/:key', async (req, res, params) => {
    const key = params.key!;
    const query = parseQuery(req);
    const mode = query.get('mode') ?? 'slim';
    if (mode !== 'slim' && mode !== 'full') {
      throw new HttpError(400, 'INVALID_ENUM', `mode 必须是 slim 或 full，收到 ${mode}`);
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

    let detail = getSessionDetail(db, key, {
      mode,
      offset: intParam(query.get('offset'), 0, Number.MAX_SAFE_INTEGER),
      limit: intParam(query.get('limit'), 2000, 5000),
    });
    if (detail === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
    }

    if (meta.detail_loaded === 0) {
      const provider = detail.session.provider;
      if (provider === 'trae' && (config.traeKeyPath === null || config.traeKeyPath === '')) {
        // REQ-012：Trae 解密未完成 → 返回已有索引数据 + pending，不阻塞
        sendJson(res, 200, { ...detail, pending: true }, req);
        return;
      }
      await scanAndStoreDetail(db, key, {
        config,
        notify: queueSessionChange,
      });
      detail = getSessionDetail(db, key, {
        mode,
        offset: intParam(query.get('offset'), 0, Number.MAX_SAFE_INTEGER),
        limit: intParam(query.get('limit'), 2000, 5000),
      });
      if (detail === null) {
        throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${key}`, { key });
      }
    }
    detailCache.set(cacheKey, detail);
    sendJson(res, 200, detail, req);
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
    queueSessionChange(key);
    sendJson(res, 200, { deleted: true, key }, req);
  });

  router.register('GET', '/api/agent-overview', (req, res) => {
    const query = parseQuery(req);
    const dataSource = query.get('dataSource') ?? 'scan';
    if (dataSource !== 'scan' && dataSource !== 'proxy') {
      throw new HttpError(400, 'INVALID_ENUM', `dataSource 必须是 scan 或 proxy，收到 ${dataSource}`);
    }
    sendJson(res, 200, getAgentOverview(db, dataSource), req);
  });

  router.register('GET', '/api/providers/status', (_req, res) => {
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

    const providers = PROVIDER_KEYS.map((key) => {
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
    sendJson(res, 200, { providers }, _req);
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
    const count = cachedStmt(db, 'SELECT COUNT(*) AS c FROM proxy_requests').get() as { c: number };
    sendJson(res, 200, { running: false, port: null, requestCount: count.c, startedAt: null }, _req);
  });

  router.register('GET', '/api/frida/status', (_req, res) => {
    sendJson(res, 200, { running: false, pid: null }, _req);
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

  router.register('PUT', '/api/config/providers', async (req, res) => {
    const body = await readJsonBody(req);
    if (typeof body.providers !== 'object' || body.providers === null) {
      throw new HttpError(400, 'BAD_REQUEST', 'body 必须含 providers 对象');
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
      throw new HttpError(429, 'SCAN_IN_PROGRESS', '已有扫描在执行');
    }
    const body = await readJsonBody(req);
    const provider = body.provider as string | undefined;
    if (provider !== undefined && !(PROVIDER_KEYS as readonly string[]).includes(provider)) {
      throw new HttpError(400, 'INVALID_ENUM', `未知 provider: ${provider}`);
    }
    scanInProgress = true;
    try {
      const results = await scanLocalSessions({
        db,
        config,
        force: body.force === true,
        providers: provider === undefined ? undefined : [provider as ProviderKey],
        notify: queueSessionChange,
        emit: (event) => {
          eventBus.emit(event.type, event);
        },
      });
      sendJson(res, 200, { providers: results }, req);
    } finally {
      scanInProgress = false;
    }
  });

  router.register('POST', '/api/compare', async (req, res) => {
    const body = await readJsonBody(req);
    const leftKey = body.leftKey;
    const rightKey = body.rightKey;
    if (typeof leftKey !== 'string' || typeof rightKey !== 'string') {
      throw new HttpError(400, 'BAD_REQUEST', 'leftKey 与 rightKey 必填');
    }
    const left = getSessionDetail(db, leftKey, { mode: 'slim' });
    if (left === null) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with key ${leftKey}`, { key: leftKey });
    }
    const right = getSessionDetail(db, rightKey, { mode: 'slim' });
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

  router.register('GET', '/api/events', (req, res) => {
    // 头信息由 addSseClient 统一写入（REQ-005）
    const cleanup = addSseClient(res);
    req.on('close', cleanup);
  });

  return createServer((req, res) => {
    // REQ-007 / api.md §0.6：每个 /api/* 请求进入时标记前台请求
    markForegroundRequest();
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] ?? '/';
    const match = router.match(method, pathname);
    if (match === null) {
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
