import { gunzipSync } from 'node:zlib';
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { LocalSessionConfig, ProviderKey } from '../src/core/trace-types.js';
import { isForegroundBusy } from './realtime/frontline.js';
import { initSchema } from './storage/schema.js';
import { upsertPromptContext } from './storage/prompt-context.js';
import { writeAnnotations } from './storage/annotations.js';
import {
  upsertEvents,
  upsertSessionFromTrace,
} from './storage/writers.js';
import { createAgentObservabilityServer } from './server.js';
import { deriveSessionKey } from '../local-sessions/session-key.js';

type Db = InstanceType<typeof Database>;

const TEST_CONFIG: LocalSessionConfig = {
  prewarmRecent: 0,
  traeKeyPath: null,
  providers: {
    claude: { key: 'claude', enabled: true, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude Code' },
    codex: { key: 'codex', enabled: true, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Codex' },
    opencode: { key: 'opencode', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'OpenCode' },
    codearts: { key: 'codearts', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeArts' },
    codeagent: { key: 'codeagent', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'CodeAgent' },
    codeagent2: { key: 'codeagent2', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeAgent 2.0' },
    trae: { key: 'trae', enabled: false, path: '/none', sourceKind: 'sqlcipher', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'Trae' },
    qoder: { key: 'qoder', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Qoder' },
    workbuddy: { key: 'workbuddy', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'WorkBuddy' },
  },
};

interface RequestResult {
  status: number;
  headers: IncomingHttpHeaders;
  raw: Buffer;
  text: string;
}

function request(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { accept: 'application/json', ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, text: raw.toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

interface BootResult {
  port: number;
  db: Db;
  close: () => Promise<void>;
  userConfigPath: string;
}

const booted: BootResult[] = [];
const staticDirs: string[] = [];

afterEach(() => {
  while (staticDirs.length > 0) {
    const dir = staticDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function seedSession(db: Db, id: string, provider: ProviderKey, over: Partial<{ systemPrompt: string | null }> = {}): void {
  upsertSessionFromTrace(db, {
    id,
    provider,
    sourceAgent: provider === 'codex' ? 'Codex' : 'Claude',
    title: `session ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 1,
    eventCount: 2,
    tokenUsage: { input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, netInput: 7, total: 38 },
    costUsd: 0.01,
    systemPrompt: over.systemPrompt ?? null,
    dataSource: 'scan',
    sourcePath: '/tmp/nonexistent.jsonl',
    totalDurationMs: 1000,
    isSubagent: false,
  });
  db.prepare('UPDATE sessions SET detail_loaded = 1 WHERE id = ?').run(id);
}

function seedEvent(db: Db, sessionId: string, id: string, sequence: number): void {
  upsertEvents(db, sessionId, [
    {
      id,
      sessionId,
      sequence,
      turnKey: null,
      kind: 'llm',
      phase: 'implement',
      title: 'event title',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'success',
      actor: 'assistant',
      tool: null,
      tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1, total: 2 },
      error: null,
      hasInput: false,
      hasOutput: true,
      hasRaw: false,
      inputSummary: null,
      outputSummary: 'output body',
    },
  ]);
}

function seedProxy(db: Db): void {
  db.prepare(
    `INSERT INTO proxy_requests (request_id, method, url, hostname, request_headers, request_body, response_body, raw_request_body, raw_response_body, system_prompt, system_prompt_len, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'req-1', 'POST', 'https://api.example.com', 'api.example.com',
    JSON.stringify({ authorization: 'Bearer x' }), 'req body', 'resp body', 'raw req', 'raw resp',
    'system prompt', 13, '2026-08-01T00:00:00.000Z',
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 40,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor 超时');
}

interface ProxyOrigin {
  port: number;
  close: () => Promise<void>;
}

/** 本地 origin：模拟 Anthropic / OpenAI 上游 JSON 响应。 */
async function startProxyOrigin(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<ProxyOrigin> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** 经真实 http-mitm-proxy 转发：绝对形式 URL + Host 覆盖（连接仍走 originPort）。 */
function proxyRequest(
  proxyPort: number,
  originPort: number,
  path: string,
  host: string,
  body: string,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'POST',
        path: `http://127.0.0.1:${originPort}${path}`,
        headers: { host, 'content-type': 'application/json', accept: 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, text: raw.toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function boot(
  seed?: (db: Db) => void,
  distDir?: string,
  config: LocalSessionConfig = TEST_CONFIG,
): Promise<BootResult> {
  const db = new Database(':memory:');
  initSchema(db);
  seed?.(db);
  const userDir = mkdtempSync(join(tmpdir(), 'server-config-'));
  const userConfigPath = join(userDir, 'agent-observe.json');
  const server = createAgentObservabilityServer({
    db,
    config,
    detailCache: new (await import('./storage/detail-cache.js')).DetailCache(),
    userConfigPath,
    distDir,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const result: BootResult = {
    port,
    db,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        rmSync(userDir, { recursive: true, force: true });
      }),
    userConfigPath,
  };
  booted.push(result);
  return result;
}

afterEach(async () => {
  while (booted.length > 0) {
    const b = booted.pop();
    if (b !== undefined) {
      await b.close();
    }
  }
});

describe('API 契约（contracts/api.md §8）', () => {
  it('会话列表不泄漏 systemPrompt 正文', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'codex-s1', 'codex', { systemPrompt: 'SECRET PROMPT' });
      seedSession(db, 'claude-s1', 'claude');
    });
    const r = await request(port, 'GET', '/api/sessions?limit=10');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { items: Array<Record<string, unknown>> };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('systemPrompt');
      expect(typeof item.hasSystemPrompt).toBe('boolean');
    }
    expect(body.items.find((i) => i.id === 'codex-s1')?.hasSystemPrompt).toBe(true);
  });

  it('会话列表 q/range/status 过滤；非法值 400 INVALID_ENUM', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'codex-s1', 'codex');
      seedSession(db, 'claude-s1', 'claude');
      db.prepare("UPDATE sessions SET started_at = ?, updated_at = ?, title = ?, status = ? WHERE id = 'codex-s1'").run(
        new Date(Date.now() - 10 * 86_400_000).toISOString(),
        new Date(Date.now() - 3600_000).toISOString(),
        'FIRE 看板下钻',
        'error',
      );
      db.prepare("UPDATE sessions SET started_at = ?, updated_at = ? WHERE id = 'claude-s1'").run(
        new Date(Date.now() - 10 * 86_400_000).toISOString(),
        new Date(Date.now() - 10 * 86_400_000).toISOString(),
      );
    });

    const byQ = JSON.parse(
      (await request(port, 'GET', '/api/sessions?q=fire')).text,
    ) as { items: Array<{ id: string }>; total: number };
    expect(byQ.items.map((i) => i.id)).toEqual(['codex-s1']);
    expect(byQ.total).toBe(1);

    const byRange = JSON.parse(
      (await request(port, 'GET', '/api/sessions?range=7d')).text,
    ) as { items: Array<{ id: string }> };
    expect(byRange.items.map((i) => i.id)).toEqual(['codex-s1']);

    const byStatus = JSON.parse(
      (await request(port, 'GET', '/api/sessions?status=error')).text,
    ) as { items: Array<{ id: string }> };
    expect(byStatus.items.map((i) => i.id)).toEqual(['codex-s1']);

    const combo = JSON.parse(
      (await request(port, 'GET', '/api/sessions?provider=codex,claude&range=7d&status=error&q=fire')).text,
    ) as { items: Array<{ id: string }>; total: number };
    expect(combo.items.map((i) => i.id)).toEqual(['codex-s1']);
    expect(combo.total).toBe(1);

    const badRange = await request(port, 'GET', '/api/sessions?range=1y');
    expect(badRange.status).toBe(400);
    expect(JSON.parse(badRange.text).error.code).toBe('INVALID_ENUM');

    const badStatus = await request(port, 'GET', '/api/sessions?status=bogus');
    expect(badStatus.status).toBe(400);
    expect(JSON.parse(badStatus.text).error.code).toBe('INVALID_ENUM');

    const badProvider = await request(port, 'GET', '/api/sessions?provider=codex,nope');
    expect(badProvider.status).toBe(400);
    expect(JSON.parse(badProvider.text).error.code).toBe('INVALID_ENUM');
  });

  it('详情默认 slim 且不含正文', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'codex-s1', 'codex');
      seedEvent(db, 'codex-s1', 'e1', 1);
    });
    const r = await request(port, 'GET', '/api/sessions/codex-s1');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as {
      mode: string;
      events: Array<Record<string, unknown>>;
      pending: boolean;
    };
    expect(body.mode).toBe('slim');
    expect(body.pending).toBe(false);
    for (const e of body.events) {
      expect(e).not.toHaveProperty('inputSummary');
      expect(e).not.toHaveProperty('outputSummary');
      expect(e).not.toHaveProperty('raw');
    }
  });

  it('Prompt Context 按需返回；普通详情不泄漏；缺失使用统一 404', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'trae-s1', 'trae');
      seedSession(db, 'codex-no-context', 'codex');
      upsertPromptContext(db, {
        sessionId: 'trae-s1', provider: 'trae', source: 'trae_db', completeness: 'dynamic_only',
        capturedAt: '2026-08-06T00:00:00.000Z',
        dynamicSections: [{ id: 'reminder-1', category: 'language', title: 'Language', content: '中文', chars: 2, estimatedTokens: 1, duplicateOf: null }],
        modelConfig: { modelName: 'glm-5.2__dev', configName: 'glm-5.2', promptMaxTokens: 100000, maxOutputTokens: 16000, maxTurns: 70, isPreset: true, locale: 'zh', agentType: 'builder', agentName: 'Builder', enabledFeatures: [] },
        analysis: { totalChars: 2, estimatedTokens: 1, sectionCount: 1, uniqueSectionCount: 1, duplicateSectionCount: 0, duplicateChars: 0, contextWindowPercent: 0.001 },
        fullSystemPrompt: null,
      });
    });

    const ordinary = JSON.parse((await request(port, 'GET', '/api/sessions/trae-s1')).text) as Record<string, unknown>;
    expect(ordinary).not.toHaveProperty('dynamicSections');
    expect(JSON.stringify(ordinary)).not.toContain('glm-5.2__dev');

    const found = await request(port, 'GET', '/api/sessions/trae-s1/prompt-context');
    expect(found.status).toBe(200);
    expect(JSON.parse(found.text)).toMatchObject({
      sessionId: 'trae-s1', source: 'trae_db', completeness: 'dynamic_only',
      modelConfig: { modelName: 'glm-5.2__dev' },
      fullSystemPrompt: null,
    });

    const absent = await request(port, 'GET', '/api/sessions/codex-no-context/prompt-context');
    expect(absent.status).toBe(404);
    expect(JSON.parse(absent.text).error.code).toBe('PROMPT_CONTEXT_NOT_FOUND');
    const missing = await request(port, 'GET', '/api/sessions/nope/prompt-context');
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.text).error.code).toBe('SESSION_NOT_FOUND');
  });

  it('REQ-016/017：轮询扫描发现追加事件，并使已缓存详情失效', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'server-live-scan-'));
    staticDirs.push(dir);
    const sourcePath = join(dir, 'session.jsonl');
    const row = (timestamp: string, role: string, text: string): string =>
      JSON.stringify({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role, content: [{ type: 'input_text', text }] },
      }) + '\n';
    writeFileSync(sourcePath, row('2026-08-06T01:00:00.000Z', 'user', 'first'));
    const config: LocalSessionConfig = {
      ...TEST_CONFIG,
      providers: {
        ...TEST_CONFIG.providers,
        claude: { ...TEST_CONFIG.providers.claude!, enabled: false },
        codex: {
          ...TEST_CONFIG.providers.codex!,
          enabled: true,
          path: dir,
          watchStrategy: 'poll',
          pollIntervalMs: 20,
        },
      },
    };
    const { port } = await boot(undefined, undefined, config);
    const key = deriveSessionKey('codex', sourcePath);

    await waitFor(async () => {
      const r = await request(port, 'GET', `/api/sessions/${key}`);
      return r.status === 200 && (JSON.parse(r.text) as { eventTotal: number }).eventTotal === 1;
    });

    appendFileSync(sourcePath, row('2026-08-06T01:00:01.000Z', 'assistant', 'second'));
    await waitFor(async () => {
      const r = await request(port, 'GET', `/api/sessions/${key}`);
      return r.status === 200 && (JSON.parse(r.text) as { eventTotal: number }).eventTotal === 2;
    });
  });

  it('proxy 列表排除全部 body 列', async () => {
    const { port } = await boot((db) => seedProxy(db));
    const r = await request(port, 'GET', '/api/proxy/requests?limit=5');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { items: Array<Record<string, unknown>> };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      for (const col of ['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody']) {
        expect(item).not.toHaveProperty(col);
      }
    }
  });

  it('所有错误使用统一信封', async () => {
    const { port } = await boot();
    const r = await request(port, 'GET', '/api/sessions/does-not-exist');
    expect(r.status).toBe(404);
    const body = JSON.parse(r.text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SESSION_NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });

  it('T-11：损坏的 SQLite 库详情返回非 2xx + SESSION_PARSE_FAILED，不是 200 + 空', async () => {
    const userDir = mkdtempSync(join(tmpdir(), 'server-corrupt-'));
    staticDirs.push(userDir);
    const corruptDb = join(userDir, 'corrupt.db');
    writeFileSync(corruptDb, 'definitely not a sqlite file, corrupt header bytes');
    const { port } = await boot((db) => {
      seedSession(db, 'opencode-corrupt000001', 'opencode');
      db.prepare('UPDATE sessions SET detail_loaded = 0, source_path = ? WHERE id = ?').run(
        corruptDb,
        'opencode-corrupt000001',
      );
    });
    const r = await request(port, 'GET', '/api/sessions/opencode-corrupt000001');
    expect(r.status).toBe(500);
    const body = JSON.parse(r.text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SESSION_PARSE_FAILED');
    expect(typeof body.error.message).toBe('string');
  });

  it('aggregate-native-sessions：Trae pending 详情不在 HTTP 请求路径触发解密', async () => {
    const sourcePath = '/definitely/not/a/real/trae/database.db';
    const key = deriveSessionKey('trae', sourcePath);
    const config: LocalSessionConfig = {
      ...TEST_CONFIG,
      traeKeyPath: '/configured/trae.key',
    };
    const { port, db } = await boot((seedDb) => {
      seedSession(seedDb, key, 'trae');
      seedDb.prepare(
        'UPDATE sessions SET detail_loaded = 0, source_path = ?, event_count = 0, message_count = 0 WHERE id = ?',
      ).run(sourcePath, key);
    }, undefined, config);

    const result = await request(port, 'GET', `/api/sessions/${key}`);

    expect(result.status).toBe(200);
    expect((JSON.parse(result.text) as { pending: boolean }).pending).toBe(true);
    expect(
      (db.prepare('SELECT detail_loaded FROM sessions WHERE id = ?').get(key) as {
        detail_loaded: number;
      }).detail_loaded,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM scan_state').get() as { c: number }).c,
    ).toBe(0);
  });

  it('T-12：proxy start → running → 重复 start 409 → stop → 重复 stop 409', async () => {
    const { port } = await boot();
    const proxyPort = await freePort();

    const started = await request(port, 'POST', '/api/proxy/start', {
      body: JSON.stringify({ port: proxyPort }),
    });
    expect(started.status).toBe(200);
    const startedBody = JSON.parse(started.text) as { running: boolean; starting: boolean };
    expect(startedBody.running).toBe(false);
    expect(startedBody.starting).toBe(true);

    await waitFor(async () => {
      const r = await request(port, 'GET', '/api/proxy/status');
      return (JSON.parse(r.text) as { running: boolean }).running;
    });
    const running = JSON.parse((await request(port, 'GET', '/api/proxy/status')).text) as {
      running: boolean;
      port: number | null;
    };
    expect(running.running).toBe(true);
    expect(running.port).toBe(proxyPort);

    const dup = await request(port, 'POST', '/api/proxy/start');
    expect(dup.status).toBe(409);
    expect((JSON.parse(dup.text) as { error: { code: string } }).error.code).toBe(
      'PROXY_ALREADY_RUNNING',
    );

    const stopped = await request(port, 'POST', '/api/proxy/stop');
    expect(stopped.status).toBe(200);
    expect((JSON.parse(stopped.text) as { running: boolean }).running).toBe(false);

    const dupStop = await request(port, 'POST', '/api/proxy/stop');
    expect(dupStop.status).toBe(409);
    expect((JSON.parse(dupStop.text) as { error: { code: string } }).error.code).toBe(
      'PROXY_NOT_RUNNING',
    );
  });

  it('T-12：frida 自动发现在非 Windows 平台返回 409 FRIDA_TARGET_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await request(port, 'POST', '/api/frida/start', { body: '{}' });
    expect(r.status).toBe(409);
    expect((JSON.parse(r.text) as { error: { code: string } }).error.code).toBe(
      'FRIDA_TARGET_NOT_FOUND',
    );
    const stopped = await request(port, 'POST', '/api/frida/stop');
    expect(stopped.status).toBe(200);
  });

  it('T08 E2E：真实代理捕获两个 Anthropic 请求 → context-diff HTTP capture_group 配对与差异', async () => {
    const { port, close } = await boot();
    const proxyPort = await freePort();
    const origin = await startProxyOrigin((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          usage: { input_tokens: 9, output_tokens: 4 },
          content: [{ type: 'text', text: 'ok' }],
        }),
      );
    });
    try {
      const started = await request(port, 'POST', '/api/proxy/start', {
        body: JSON.stringify({ port: proxyPort }),
      });
      expect(started.status).toBe(200);
      await waitFor(async () => {
        const r = await request(port, 'GET', '/api/proxy/status');
        return (JSON.parse(r.text) as { running: boolean }).running;
      });

      const model = 'claude-3-5-sonnet-20241022';
      await proxyRequest(
        proxyPort,
        origin.port,
        '/v1/messages',
        'api.anthropic.com',
        JSON.stringify({ model, system: 'be brief', messages: [{ role: 'user', content: 'hello' }], max_tokens: 64 }),
      );
      await proxyRequest(
        proxyPort,
        origin.port,
        '/v1/messages',
        'api.anthropic.com',
        JSON.stringify({
          model,
          system: 'be brief',
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
            { role: 'user', content: 'second question' },
          ],
          max_tokens: 64,
        }),
      );

      await waitFor(async () => {
        const list = JSON.parse((await request(port, 'GET', '/api/proxy/requests?limit=20')).text) as {
          items: Array<{ id: number; captureGroupId: string | null; requestFormat: string }>;
        };
        return list.items.filter((i) => i.captureGroupId !== null && i.requestFormat === 'anthropic_messages').length >= 2;
      });

      const list = JSON.parse((await request(port, 'GET', '/api/proxy/requests?limit=20')).text) as {
        items: Array<{ id: number; captureGroupId: string | null; requestFormat: string; requestId: string }>;
      };
      const anthropic = list.items.filter((i) => i.captureGroupId !== null && i.requestFormat === 'anthropic_messages');
      expect(anthropic).toHaveLength(2);
      expect(anthropic[0]!.captureGroupId).not.toBeNull();
      expect(anthropic[0]!.captureGroupId).toBe(anthropic[1]!.captureGroupId);
      // 列表按 started_at DESC（最新在前）；target 取较晚行（id 较大）
      const [baseId, targetId] = [Math.min(...anthropic.map((i) => i.id)), Math.max(...anthropic.map((i) => i.id))];

      const diff = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff`);
      expect(diff.status).toBe(200);
      const body = JSON.parse(diff.text) as {
        base: { id: number; requestId: string };
        target: { id: number; requestId: string };
        pairing: { confidence: string; reason: string };
        noChange: boolean;
        categories: Array<{ category: string; entries: unknown[] }>;
      };
      expect(body.pairing.confidence).toBe('capture_group');
      expect(body.base.id).toBe(baseId);
      expect(body.target.id).toBe(targetId);
      expect(body.noChange).toBe(false);
      expect(body.base.requestId.length).toBeGreaterThan(0);
      expect(body.target.requestId.length).toBeGreaterThan(0);
      const messages = body.categories.find((c) => c.category === 'messages');
      expect(messages).toBeDefined();
      expect(messages!.entries.length).toBeGreaterThan(0);
    } finally {
      await request(port, 'POST', '/api/proxy/stop').catch(() => undefined);
      await origin.close();
      await close();
    }
  });

  it('T08 E2E：真实代理捕获两个 OpenAI Responses 请求 → context-diff HTTP capture_group 配对', async () => {
    const { port, close } = await boot();
    const proxyPort = await freePort();
    const origin = await startProxyOrigin((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_1', output: [], usage: { input_tokens: 5, output_tokens: 2 } }));
    });
    try {
      await request(port, 'POST', '/api/proxy/start', {
        body: JSON.stringify({ port: proxyPort }),
      });
      await waitFor(async () => {
        const r = await request(port, 'GET', '/api/proxy/status');
        return (JSON.parse(r.text) as { running: boolean }).running;
      });

      const message = (text: string) => ({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      });
      await proxyRequest(
        proxyPort,
        origin.port,
        '/v1/responses',
        'api.openai.com',
        JSON.stringify({ model: 'gpt-4o', instructions: 'be brief', input: [message('hello')] }),
      );
      await proxyRequest(
        proxyPort,
        origin.port,
        '/v1/responses',
        'api.openai.com',
        JSON.stringify({ model: 'gpt-4o', instructions: 'be brief', input: [message('hello'), message('follow-up')] }),
      );

      await waitFor(async () => {
        const list = JSON.parse((await request(port, 'GET', '/api/proxy/requests?limit=20')).text) as {
          items: Array<{ id: number; captureGroupId: string | null; requestFormat: string }>;
        };
        return list.items.filter((i) => i.captureGroupId !== null && i.requestFormat === 'openai_responses').length >= 2;
      });

      const list = JSON.parse((await request(port, 'GET', '/api/proxy/requests?limit=20')).text) as {
        items: Array<{ id: number; captureGroupId: string | null; requestFormat: string }>;
      };
      const responses = list.items.filter((i) => i.captureGroupId !== null && i.requestFormat === 'openai_responses');
      expect(responses).toHaveLength(2);
      // 列表按 started_at DESC（最新在前）；target 取较晚行（id 较大）
      const [baseId, targetId] = [Math.min(...responses.map((i) => i.id)), Math.max(...responses.map((i) => i.id))];

      const diff = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff`);
      expect(diff.status).toBe(200);
      const body = JSON.parse(diff.text) as {
        base: { id: number };
        target: { id: number };
        pairing: { confidence: string };
        noChange: boolean;
      };
      expect(body.pairing.confidence).toBe('capture_group');
      expect(body.base.id).toBe(baseId);
      expect(body.target.id).toBe(targetId);
      expect(body.noChange).toBe(false);
    } finally {
      await request(port, 'POST', '/api/proxy/stop').catch(() => undefined);
      await origin.close();
      await close();
    }
  });

  it('T08 E2E：raw-only sentinel 注入 raw 列/headers → context-diff HTTP 成功与错误响应均不含 sentinel（NFR-S1）', async () => {
    const { port, db, close } = await boot();
    const proxyPort = await freePort();
    const origin = await startProxyOrigin((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 2, output_tokens: 1 } }));
    });
    try {
      await request(port, 'POST', '/api/proxy/start', {
        body: JSON.stringify({ port: proxyPort }),
      });
      await waitFor(async () => {
        const r = await request(port, 'GET', '/api/proxy/status');
        return (JSON.parse(r.text) as { running: boolean }).running;
      });

      const model = 'claude-3-5-sonnet-20241022';
      // 两行可自动配对 + 一行 unknown 格式（走 unsupported 错误路径）
      await proxyRequest(proxyPort, origin.port, '/v1/messages', 'api.anthropic.com', JSON.stringify({ model, messages: [{ role: 'user', content: 'a' }] }));
      await proxyRequest(proxyPort, origin.port, '/v1/messages', 'api.anthropic.com', JSON.stringify({ model, messages: [{ role: 'user', content: 'b' }] }));
      await proxyRequest(proxyPort, origin.port, '/elsewhere', 'example.com', JSON.stringify({ foo: 1 }));

      await waitFor(async () => {
        const list = JSON.parse((await request(port, 'GET', '/api/proxy/requests?limit=20')).text) as {
          items: Array<{ id: number }>;
        };
        return list.items.length >= 3;
      });

      const rows = db
        .prepare('SELECT id, request_format FROM proxy_requests ORDER BY id')
        .all() as Array<{ id: number; request_format: string }>;
      expect(rows).toHaveLength(3);
      const sentinel = 'sk-RAWONLYSENTINEL9876543210';
      const updateRaw = db.prepare(
        'UPDATE proxy_requests SET raw_request_body = ?, raw_response_body = ?, request_headers = ? WHERE id = ?',
      );
      for (const row of rows) {
        updateRaw.run(`raw:${sentinel}`, `resp:${sentinel}`, JSON.stringify({ authorization: `Bearer ${sentinel}` }), row.id);
      }
      const anthropicRows = rows.filter((r) => r.request_format === 'anthropic_messages');
      const base = anthropicRows[0];
      const target = anthropicRows[1];
      const unknown = rows.find((r) => r.request_format === 'unknown');
      expect(base).toBeDefined();
      expect(target).toBeDefined();
      expect(unknown).toBeDefined();

      const diff = await request(port, 'GET', `/api/proxy/requests/${target!.id}/context-diff`);
      expect(diff.status).toBe(200);
      expect(diff.text).not.toContain(sentinel);
      expect((JSON.parse(diff.text) as { base: { id: number } }).base.id).toBe(base!.id);

      // 错误路径：手动 base 为 unknown 格式 → 422 CONTEXT_DIFF_UNSUPPORTED
      const unsupported = await request(port, 'GET', `/api/proxy/requests/${target!.id}/context-diff?base=${unknown!.id}`);
      expect(unsupported.status).toBe(422);
      expect(unsupported.text).not.toContain(sentinel);
    } finally {
      await request(port, 'POST', '/api/proxy/stop').catch(() => undefined);
      await origin.close();
      await close();
    }
  });

  it('R-09：compare 触发惰性详情加载且标题不被注入内容覆盖', async () => {
    const userDir = mkdtempSync(join(tmpdir(), 'server-compare-'));
    staticDirs.push(userDir);
    const sourcePath = join(userDir, 'codex-s1.jsonl');
    writeFileSync(
      sourcePath,
      [
        { timestamp: '2026-08-04T06:00:00.000Z', type: 'session_meta', payload: { session_id: 's1' } },
        { timestamp: '2026-08-04T06:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /tmp' }] } },
        { timestamp: '2026-08-04T06:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '读 NEXT-TASKS.md 并按顺序执行' }] } },
      ].map((row) => JSON.stringify(row)).join('\n') + '\n',
    );
    const key = deriveSessionKey('codex', sourcePath);
    const { port } = await boot((db) => {
      seedSession(db, key, 'codex');
      db.prepare('UPDATE sessions SET detail_loaded = 0, source_path = ?, title = ? WHERE id = ?').run(
        sourcePath,
        'placeholder',
        key,
      );
    });
    const r = await request(port, 'POST', '/api/compare', {
      body: JSON.stringify({ leftKey: key, rightKey: key }),
    });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as {
      left: { events: unknown[]; session: { title: string } };
    };
    expect(body.left.events.length).toBeGreaterThan(0);
    expect(body.left.session.title).toBe('读 NEXT-TASKS.md 并按顺序执行');
  });

  it('R-09：会话报告与对比报告路由返回 text/html', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'codex-r1', 'codex');
      seedEvent(db, 'codex-r1', 'e1', 1);
    });
    const report = await request(port, 'GET', '/api/sessions/codex-r1/report');
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toContain('text/html');
    expect(report.text).toContain('<!doctype html>');
    const compare = await request(
      port,
      'GET',
      '/api/compare/report?left=codex-r1&right=codex-r1',
    );
    expect(compare.status).toBe(200);
    expect(compare.headers['content-type']).toContain('text/html');
  });

  it('agent-overview 单请求返回全部 provider', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'codex-s1', 'codex');
      seedSession(db, 'claude-s1', 'claude');
    });
    const r = await request(port, 'GET', '/api/agent-overview');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { rows: unknown[]; stamp: string };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(typeof body.stamp).toBe('string');
  });

  it('GET /api/session-groups 返回自动 subagent 合并组（成员 keys 可查）', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'parent-1', 'codex');
      seedSession(db, 'sub-1', 'codex');
      // 子会话落在父会话时间窗内且标记 is_subagent
      db.prepare(
        `UPDATE sessions SET is_subagent = 1, started_at = '2026-08-01T00:00:30.000Z', title = 'task (@subagent)' WHERE id = 'sub-1'`,
      ).run();
    });
    const r = await request(port, 'GET', '/api/session-groups');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as {
      groups: Array<{ id: string; primaryKey: string; mergedKeys: string[]; reason: string }>;
    };
    expect(body.groups.length).toBeGreaterThan(0);
    const group = body.groups.find((g) => g.primaryKey === 'parent-1');
    expect(group?.mergedKeys).toContain('sub-1');
    expect(group?.reason).toBe('auto-subagent-time-window');

    const members = await request(port, 'GET', '/api/sessions?keys=sub-1&merged=0');
    expect(members.status).toBe(200);
    const memberBody = JSON.parse(members.text) as { items: Array<{ id: string }> };
    expect(memberBody.items.map((item) => item.id)).toEqual(['sub-1']);

    const merged = await request(port, 'GET', '/api/sessions?keys=parent-1');
    expect(merged.status).toBe(200);
    const mergedBody = JSON.parse(merged.text) as {
      items: Array<{ id: string; mergeGroupId: string | null; eventCount: number }>;
    };
    expect(mergedBody.items).toHaveLength(1);
    expect(mergedBody.items[0]).toMatchObject({
      id: 'parent-1',
      mergeGroupId: 'parent-1:auto-subagents',
      eventCount: 4,
    });
  });

  it('建议 11：成员 key 详情返回成员自身（单独查看），primary 返回合并详情', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'parent-1', 'codex');
      seedSession(db, 'sub-1', 'codex');
      db.prepare(
        `UPDATE sessions SET is_subagent = 1, started_at = '2026-08-01T00:00:30.000Z', title = 'task (@subagent)' WHERE id = 'sub-1'`,
      ).run();
    });
    const member = await request(port, 'GET', '/api/sessions/sub-1');
    expect(member.status).toBe(200);
    const memberBody = JSON.parse(member.text) as { session: { title: string; eventCount: number } };
    expect(memberBody.session.title).toContain('@subagent');
    expect(memberBody.session.eventCount).toBe(2); // 自身 2 条，非合并 4 条

    const primary = await request(port, 'GET', '/api/sessions/parent-1');
    const primaryBody = JSON.parse(primary.text) as { session: { title: string; eventCount: number } };
    expect(primaryBody.session.eventCount).toBe(4); // 合并求和
  });

  it('mission 单请求返回全部区块，每个 widget 有非空 criteria；available=false 时 data 为 null 且 reason 非空', async () => {
    const { port } = await boot((db) => {
      seedSession(db, 'codex-s1', 'codex');
      seedSession(db, 'claude-s1', 'claude');
    });
    const r = await request(port, 'GET', '/api/mission?range=all');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as {
      meta: { widgetCount: number; stamp: string; range: string; durationMs: number };
      usage: Record<string, unknown>;
      quality: Record<string, unknown>;
      health: Record<string, unknown>;
    };
    expect(body.meta.widgetCount).toBeGreaterThan(0);
    expect(typeof body.meta.stamp).toBe('string');
    expect(body.meta.range).toBe('all');
    expect(typeof body.meta.durationMs).toBe('number');
    const widgets = [
      ...Object.values(body.usage),
      ...Object.values(body.quality),
      ...Object.values(body.health),
    ] as Array<{ criteria: string; available: boolean; unavailableReason: string | null; data: unknown }>;
    for (const w of widgets) {
      expect(typeof w.criteria).toBe('string');
      expect(w.criteria.length).toBeGreaterThan(0);
      if (w.available === false) {
        expect(w.data).toBeNull();
        expect(w.unavailableReason).not.toBeNull();
      }
    }
  });

  it('mission 校验 range 与 tz 参数', async () => {
    const { port } = await boot();
    const badRange = await request(port, 'GET', '/api/mission?range=99d');
    expect(badRange.status).toBe(400);
    expect((JSON.parse(badRange.text) as { error: { code: string } }).error.code).toBe('INVALID_ENUM');
    const badTz = await request(port, 'GET', '/api/mission?tz=abc');
    expect(badTz.status).toBe(400);
    expect((JSON.parse(badTz.text) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('生产实例不暴露 dev-only 路由', async () => {
    const { port } = await boot();
    const r = await request(port, 'GET', '/api/cdp/status');
    expect(r.status).toBe(404);
    const body = JSON.parse(r.text) as { error: { code: string } };
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('Session annotations API（api.md §1.7 / design D13-D14）', () => {
  it('未注解会话 GET 返回 200 空形状，且不创建行', async () => {
    const { port, db } = await boot((seedDb) => {
      seedSession(seedDb, 'codex-s1', 'codex');
    });
    const r = await request(port, 'GET', '/api/sessions/codex-s1/annotations');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({
      sessionKey: 'codex-s1',
      tags: [],
      note: null,
      updatedAt: null,
    });
    const rowCount = db
      .prepare('SELECT COUNT(*) AS c FROM session_annotations')
      .get() as { c: number };
    expect(rowCount.c).toBe(0);
  });

  it('PUT 规范化往返：trim/lowercase/去重/升序 + ISO updatedAt；GET 读回一致', async () => {
    const { port } = await boot((seedDb) => seedSession(seedDb, 'codex-s1', 'codex'));
    const put = await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
      body: JSON.stringify({ tags: ['Refactor', 'refactor', '  Résumé  '], note: 'keep an eye' }),
    });
    expect(put.status).toBe(200);
    const saved = JSON.parse(put.text) as {
      sessionKey: string;
      tags: string[];
      note: string | null;
      updatedAt: string | null;
    };
    expect(saved.sessionKey).toBe('codex-s1');
    expect(saved.tags).toEqual(['refactor', 'résumé']);
    expect(saved.note).toBe('keep an eye');
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const readBack = JSON.parse(
      (await request(port, 'GET', '/api/sessions/codex-s1/annotations')).text,
    );
    expect(readBack).toEqual(saved);
  });

  it('部分更新：只写 tags 不动 note；只写 note 不动 tags', async () => {
    const { port } = await boot((seedDb) => seedSession(seedDb, 'codex-s1', 'codex'));
    await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
      body: JSON.stringify({ tags: ['a'], note: 'note-1' }),
    });
    const onlyTags = JSON.parse(
      (
        await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
          body: JSON.stringify({ tags: ['b'] }),
        })
      ).text,
    ) as { tags: string[]; note: string | null };
    expect(onlyTags.tags).toEqual(['b']);
    expect(onlyTags.note).toBe('note-1');

    const onlyNote = JSON.parse(
      (
        await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
          body: JSON.stringify({ note: 'note-2' }),
        })
      ).text,
    ) as { tags: string[]; note: string | null };
    expect(onlyNote.tags).toEqual(['b']);
    expect(onlyNote.note).toBe('note-2');
  });

  it('清空语义：tags:[] 清空标签；note:null 清空备注', async () => {
    const { port } = await boot((seedDb) => seedSession(seedDb, 'codex-s1', 'codex'));
    await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
      body: JSON.stringify({ tags: ['a'], note: 'note-1' }),
    });
    const clearedTags = JSON.parse(
      (
        await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
          body: JSON.stringify({ tags: [] }),
        })
      ).text,
    ) as { tags: string[]; note: string | null };
    expect(clearedTags.tags).toEqual([]);
    expect(clearedTags.note).toBe('note-1');

    const clearedNote = JSON.parse(
      (
        await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
          body: JSON.stringify({ note: null }),
        })
      ).text,
    ) as { tags: string[]; note: string | null };
    expect(clearedNote.tags).toEqual([]);
    expect(clearedNote.note).toBeNull();
  });

  it('边界违反 → 400 BAD_REQUEST，什么也不持久化', async () => {
    const { port, db } = await boot((seedDb) => seedSession(seedDb, 'codex-s1', 'codex'));
    const tooMany = Array.from({ length: 33 }, (_, i) => `tag-${i}`);
    const cases: Array<[string, unknown]> = [
      ['33 tags', { tags: tooMany }],
      ['tag over 64 chars', { tags: ['x'.repeat(65)] }],
      ['tag with invalid chars', { tags: ['bad tag!'] }],
      ['note over 8192 chars', { note: 'n'.repeat(8193) }],
    ];
    for (const [label, body] of cases) {
      const r = await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
        body: JSON.stringify(body),
      });
      expect(r.status, label).toBe(400);
      expect((JSON.parse(r.text) as { error: { code: string } }).error.code, label).toBe(
        'BAD_REQUEST',
      );
      const rowCount = db
        .prepare('SELECT COUNT(*) AS c FROM session_annotations')
        .get() as { c: number };
      expect(rowCount.c, label).toBe(0);
    }
  });

  it('未知会话键：GET 与 PUT 均 404 SESSION_NOT_FOUND', async () => {
    const { port } = await boot();
    const get = await request(port, 'GET', '/api/sessions/nope/annotations');
    expect(get.status).toBe(404);
    expect((JSON.parse(get.text) as { error: { code: string } }).error.code).toBe(
      'SESSION_NOT_FOUND',
    );
    const put = await request(port, 'PUT', '/api/sessions/nope/annotations', {
      body: JSON.stringify({ tags: ['a'] }),
    });
    expect(put.status).toBe(404);
    expect((JSON.parse(put.text) as { error: { code: string } }).error.code).toBe(
      'SESSION_NOT_FOUND',
    );
  });

  it('畸形 body → 400 BAD_REQUEST：非法 JSON、数组 body、tags 非数组、note 非字符串', async () => {
    const { port } = await boot((seedDb) => seedSession(seedDb, 'codex-s1', 'codex'));
    const cases: Array<[string, string]> = [
      ['invalid JSON', '{ not json'],
      ['array body', '[1,2]'],
      ['tags not array', JSON.stringify({ tags: 'a' })],
      ['tags element not string', JSON.stringify({ tags: [1] })],
      ['note not string', JSON.stringify({ note: 7 })],
    ];
    for (const [label, body] of cases) {
      const r = await request(port, 'PUT', '/api/sessions/codex-s1/annotations', { body });
      expect(r.status, label).toBe(400);
      expect((JSON.parse(r.text) as { error: { code: string } }).error.code, label).toBe(
        'BAD_REQUEST',
      );
    }
  });

  it('标签词表：count 降序、标签升序，一条查询返回', async () => {
    const { port } = await boot((seedDb) => {
      seedSession(seedDb, 'codex-s1', 'codex');
      seedSession(seedDb, 'codex-s2', 'codex');
      seedSession(seedDb, 'claude-s1', 'claude');
      writeAnnotations(seedDb, 'codex-s1', { tags: ['perf', 'refactor'] });
      writeAnnotations(seedDb, 'codex-s2', { tags: ['perf', 'arch'] });
      writeAnnotations(seedDb, 'claude-s1', { tags: ['refactor'] });
    });
    const r = await request(port, 'GET', '/api/annotations/tags');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({
      tags: [
        { tag: 'perf', count: 2 },
        { tag: 'refactor', count: 2 },
        { tag: 'arch', count: 1 },
      ],
    });
  });

  it('会话列表 tags 过滤：OR 语义，命中携带任一标签的会话', async () => {
    const { port } = await boot((seedDb) => {
      seedSession(seedDb, 'codex-s1', 'codex');
      seedSession(seedDb, 'codex-s2', 'codex');
      seedSession(seedDb, 'claude-s1', 'claude');
      writeAnnotations(seedDb, 'codex-s1', { tags: ['perf'] });
      writeAnnotations(seedDb, 'codex-s2', { tags: ['refactor'] });
    });
    const both = JSON.parse(
      (await request(port, 'GET', '/api/sessions?tags=perf,refactor')).text,
    ) as { items: Array<{ id: string }>; total: number };
    expect(both.items.map((i) => i.id).sort()).toEqual(['codex-s1', 'codex-s2']);
    expect(both.total).toBe(2);

    const one = JSON.parse(
      (await request(port, 'GET', '/api/sessions?tags=refactor')).text,
    ) as { items: Array<{ id: string }>; total: number };
    expect(one.items.map((i) => i.id)).toEqual(['codex-s2']);
    expect(one.total).toBe(1);

    const none = JSON.parse(
      (await request(port, 'GET', '/api/sessions?tags=missing-tag')).text,
    ) as { items: unknown[]; total: number };
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
  });

  it('tags 过滤边界：33 个标签 400；非法标签值 400；32 个合法标签 200', async () => {
    const { port } = await boot();
    const many = Array.from({ length: 33 }, (_, i) => `tag-${i}`).join(',');
    const tooMany = await request(port, 'GET', `/api/sessions?tags=${many}`);
    expect(tooMany.status).toBe(400);
    expect((JSON.parse(tooMany.text) as { error: { code: string } }).error.code).toBe(
      'BAD_REQUEST',
    );

    const invalid = await request(port, 'GET', '/api/sessions?tags=bad%20tag');
    expect(invalid.status).toBe(400);
    expect((JSON.parse(invalid.text) as { error: { code: string } }).error.code).toBe(
      'BAD_REQUEST',
    );

    const ok = Array.from({ length: 32 }, (_, i) => `tag-${i}`).join(',');
    const fine = await request(port, 'GET', `/api/sessions?tags=${ok}`);
    expect(fine.status).toBe(200);
  });

  it('注解成功响应 ≥1KB 且 accept-encoding:gzip → content-encoding: gzip + vary', async () => {
    const { port } = await boot((seedDb) => seedSession(seedDb, 'codex-s1', 'codex'));
    const r = await request(port, 'PUT', '/api/sessions/codex-s1/annotations', {
      headers: { 'accept-encoding': 'gzip' },
      body: JSON.stringify({ tags: ['perf'], note: 'n'.repeat(3000) }),
    });
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers.vary).toContain('accept-encoding');
    const decoded = gunzipSync(r.raw).toString('utf8');
    const body = JSON.parse(decoded) as { tags: string[]; note: string };
    expect(body.tags).toEqual(['perf']);
    expect(body.note.length).toBe(3000);
  });

  it('回归：会话列表与详情形状除新增 tags 数组外不变（AC-3 / 3.8）', async () => {
    const { port } = await boot((seedDb) => {
      seedSession(seedDb, 'codex-s1', 'codex');
      seedSession(seedDb, 'claude-s1', 'claude');
      seedEvent(seedDb, 'codex-s1', 'e1', 1);
      writeAnnotations(seedDb, 'codex-s1', { tags: ['perf'] });
    });

    const listBody = JSON.parse(
      (await request(port, 'GET', '/api/sessions?limit=10')).text,
    ) as { items: Array<Record<string, unknown>> };
    const item = listBody.items.find((i) => i.id === 'codex-s1');
    expect(item).toBeDefined();
    // contracts/data-model.md §3 SessionIndexEntry 精确键集：除新增 tags 外，
    // 没有任何字段被加入或移除（防止 body 列或无关字段泄漏进列表投影）。
    expect(Object.keys(item!).sort()).toEqual(
      [
        'id', 'provider', 'sourceAgent', 'title', 'startedAt', 'updatedAt',
        'status', 'cwd', 'eventCount', 'messageCount', 'tokenTotal', 'costUsd',
        'dataSource', 'sourcePath', 'detailLoaded', 'mergeGroupId',
        'hasSystemPrompt', 'tags',
      ].sort(),
    );
    expect(item!.tags).toEqual(['perf']);
    expect(listBody.items.find((i) => i.id === 'claude-s1')?.tags).toEqual([]);
    for (const row of listBody.items) {
      expect(row).not.toHaveProperty('systemPrompt');
      expect(row).not.toHaveProperty('inputSummary');
      expect(row).not.toHaveProperty('outputSummary');
      expect(row).not.toHaveProperty('raw');
    }

    // 详情响应 = SessionDetailResponse 精确键集；session 对象无 tags（TraceSession
    // 契约不带该字段，注解独立走 §1.7 路由对）。
    const detail = JSON.parse(
      (await request(port, 'GET', '/api/sessions/codex-s1')).text,
    ) as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(
      ['session', 'events', 'mode', 'eventTotal', 'eventOffset', 'eventLimit', 'hasMore', 'pending'].sort(),
    );
    const session = detail.session as Record<string, unknown>;
    expect(Object.keys(session).sort()).toEqual(
      [
        'id', 'provider', 'sourceAgent', 'title', 'startedAt', 'updatedAt',
        'status', 'cwd', 'messageCount', 'eventCount', 'tokenUsage', 'costUsd',
        'systemPrompt', 'dataSource', 'sourcePath', 'totalDurationMs',
        'isSubagent', 'primaryModel', 'costSource', 'durationSource',
      ].sort(),
    );
    expect(session).not.toHaveProperty('tags');
    expect(session.id).toBe('codex-s1');
  });
});

describe('HTTP 行为（api.md §0.2/§0.3/§0.6）', () => {
  it('响应 ≥ 1KB 且 accept-encoding 含 gzip → content-encoding: gzip + vary', async () => {
    const { port } = await boot((db) => {
      for (let i = 0; i < 40; i += 1) {
        seedSession(db, `codex-${i}`, 'codex', { systemPrompt: 'x'.repeat(200) });
      }
    });
    const r = await request(port, 'GET', '/api/sessions?limit=40', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers.vary).toContain('accept-encoding');
    const decoded = gunzipSync(r.raw).toString('utf8');
    const body = JSON.parse(decoded) as { items: unknown[] };
    expect(body.items.length).toBe(40);
  });

  it('小响应不压缩且带 content-length', async () => {
    const { port } = await boot();
    const r = await request(port, 'GET', '/api/health', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.headers['content-length']).toBeDefined();
    const body = JSON.parse(r.text) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('非法枚举走统一信封 400 INVALID_ENUM', async () => {
    const { port } = await boot();
    const r = await request(port, 'GET', '/api/sessions?dataSource=bad');
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text).error.code).toBe('INVALID_ENUM');
  });

  it('每个 /api/* 请求都调了 markForegroundRequest()', async () => {
    const { port } = await boot();
    await request(port, 'GET', '/api/health');
    expect(isForegroundBusy()).toBe(true);
  });

  it('SSE 端点返回 connected 事件', async () => {
    const { port } = await boot();
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'GET', path: '/api/events' },
        (r) => resolve(r),
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    const first = await new Promise<string>((resolve) => {
      res.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')));
    });
    expect(first).toContain('event: connected');
    res.destroy();
  });

  it('PUT /api/config/providers 原子写用户配置', async () => {
    const { port, userConfigPath } = await boot();
    const { existsSync, readFileSync } = await import('node:fs');
    const r = await request(port, 'PUT', '/api/config/providers', {
      body: JSON.stringify({ providers: { codex: { enabled: false } } }),
    });
    expect(r.status).toBe(200);
    expect(existsSync(userConfigPath)).toBe(true);
    const saved = JSON.parse(readFileSync(userConfigPath, 'utf8')) as {
      providers: { codex: { enabled: boolean } };
    };
    expect(saved.providers.codex.enabled).toBe(false);
  });

  it('GET/PUT /api/desensitization/rules：10 条规则 + 原子写覆盖', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'server-rules-'));
    const rulesPath = join(dir, 'rules.json');
    const db = new Database(':memory:');
    initSchema(db);
    const server = createAgentObservabilityServer({
      db,
      config: TEST_CONFIG,
      rulesPath,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const get = await request(port, 'GET', '/api/desensitization/rules');
    expect(get.status).toBe(200);
    const body = JSON.parse(get.text) as { rules: unknown[]; keepRawBodies: boolean };
    expect(body.rules).toHaveLength(10);
    expect(body.keepRawBodies).toBe(false);

    const put = await request(port, 'PUT', '/api/desensitization/rules', {
      body: JSON.stringify({ disabled: ['email'], keepRawBodies: true }),
    });
    expect(put.status).toBe(200);
    const after = JSON.parse(put.text) as {
      rules: Array<{ id: string; enabled: boolean }>;
      keepRawBodies: boolean;
    };
    expect(after.keepRawBodies).toBe(true);
    expect(after.rules.find((r) => r.id === 'email')?.enabled).toBe(false);

    const { existsSync, readFileSync } = await import('node:fs');
    expect(existsSync(rulesPath)).toBe(true);
    expect(JSON.parse(readFileSync(rulesPath, 'utf8')).keepRawBodies).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('T-01 静态兜底（前端可达）', () => {
  async function distDirWith(assets: Record<string, string>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'server-dist-'));
    staticDirs.push(dir);
    const assetDir = join(dir, 'assets');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf8',
    );
    for (const [name, content] of Object.entries(assets)) {
      writeFileSync(join(assetDir, name), content, 'utf8');
    }
    return dir;
  }

  it('GET / 返回 200 且 content-type 为 text/html', async () => {
    const { port } = await boot(undefined, await distDirWith({}));
    const r = await request(port, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.text).toContain('<div id="root"');
  });

  it('GET /assets/<真实文件名> 返回 200 与正确 content-type', async () => {
    const { port } = await boot(undefined, await distDirWith({ 'app.js': 'console.log("hi");' }));
    const r = await request(port, 'GET', '/assets/app.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/javascript');
    expect(r.text).toContain('console.log');
  });

  it('GET /api/nope 仍返回 404 JSON 信封（不被 SPA fallback 吞掉）', async () => {
    const { port } = await boot(undefined, await distDirWith({}));
    const r = await request(port, 'GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toContain('application/json');
    const body = JSON.parse(r.text) as { error: { code: string } };
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('路径穿越 GET /../../etc/passwd 返回 403', async () => {
    const { port } = await boot(undefined, await distDirWith({}));
    const r = await request(port, 'GET', '/../../etc/passwd');
    expect(r.status).toBe(403);
  });

  it('dist/ 不存在时返回人话提示而不是 500', async () => {
    const missing = join(tmpdir(), 'no-such-dist-12345');
    const { port } = await boot(undefined, missing);
    const r = await request(port, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.text).toContain('npm run build');
  });
});

// ── add-request-context-diff §6：HTTP 契约与隐私 ─────────────────────────────

const RAW_SENTINEL = 'RAW_ONLY_SENTINEL_7f3a';
const AUTH_SENTINEL = 'Bearer PRIVATE_AUTH_9c21';

interface DiffSeed {
  requestId: string;
  startedAt: string;
  format: 'anthropic_messages' | 'unknown';
  body: string | null;
  captureGroupId?: string | null;
  parsedSessionId?: string | null;
  model?: string | null;
  /** 在 raw 列 / headers 里埋 sentinel（NFR-S1）。 */
  privacyLeak?: boolean;
}

function seedDiffProxy(db: Db, s: DiffSeed): number {
  const r = db
    .prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at,
         capture_group_id, request_format, model, parsed_session_id, request_body,
         input_tokens, request_headers, raw_request_body, raw_response_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.requestId,
      'POST',
      'https://api.anthropic.com',
      'api.anthropic.com',
      s.startedAt,
      s.captureGroupId ?? null,
      s.format,
      s.model ?? null,
      s.parsedSessionId ?? null,
      s.body,
      null,
      s.privacyLeak === true ? JSON.stringify({ authorization: AUTH_SENTINEL }) : null,
      s.privacyLeak === true ? RAW_SENTINEL : null,
      s.privacyLeak === true ? RAW_SENTINEL : null,
    );
  return Number(r.lastInsertRowid);
}

function anthropicBody(messages: Array<{ role: string; content: string }>): string {
  return JSON.stringify({ model: 'claude-3-5-sonnet', system: 'be helpful', messages });
}

function messages(n: number, contentLen: number, prefix: string): Array<{ role: string; content: string }> {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${prefix}${i}`.padEnd(contentLen, 'x'),
  }));
}

describe('context-diff API（design D10 / §6.1-§6.5）', () => {
  it('6.1/6.2 自动成功：省略 base 与 base=previous 等价 → 200', async () => {
    const { port, db } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 'r1', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 'm')),
        captureGroupId: 'grp-1', parsedSessionId: 'sess-1', model: 'claude-3-5-sonnet',
      });
      seedDiffProxy(d, {
        requestId: 'r2', startedAt: '2026-08-01T00:00:01.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(2, 8, 'm')),
        captureGroupId: 'grp-1', parsedSessionId: 'sess-1', model: 'claude-3-5-sonnet',
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const targetId = Math.max(...items.map((i) => i.id));

    for (const base of [undefined, 'previous']) {
      const path = `/api/proxy/requests/${targetId}/context-diff${base ? `?base=${base}` : ''}`;
      const r = await request(port, 'GET', path);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.text) as {
        base: { id: number };
        target: { id: number };
        pairing: { confidence: string };
        categories: unknown[];
        completeness: { complete: boolean };
      };
      expect(body.base.id).toBe(targetId - 1);
      expect(body.target.id).toBe(targetId);
      expect(['exact', 'capture_group']).toContain(body.pairing.confidence);
      expect(Array.isArray(body.categories)).toBe(true);
      expect(typeof body.completeness.complete).toBe('boolean');
    }
    void db;
  });

  it('手动 base=<正整数> → 200 confidence manual', async () => {
    const { port } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 'a', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 'a')),
        captureGroupId: 'gA', parsedSessionId: 'sA', model: 'claude-3-5-sonnet',
      });
      seedDiffProxy(d, {
        requestId: 'b', startedAt: '2026-08-01T00:00:01.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 'b')),
        captureGroupId: 'gB', parsedSessionId: 'sB', model: 'claude-3-5-sonnet',
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const [baseId, targetId] = [Math.min(...items.map((i) => i.id)), Math.max(...items.map((i) => i.id))];
    const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff?base=${baseId}`);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as {
      base: { id: number };
      pairing: { confidence: string; warnings: string[] };
    };
    expect(body.base.id).toBe(baseId);
    expect(body.pairing.confidence).toBe('manual');
    expect(Array.isArray(body.pairing.warnings)).toBe(true);
  });

  it('非法 target id → 400 BAD_REQUEST', async () => {
    const { port } = await boot();
    for (const bad of ['abc', '0', '-1']) {
      const r = await request(port, 'GET', `/api/proxy/requests/${bad}/context-diff`);
      expect(r.status).toBe(400);
      expect(JSON.parse(r.text).error.code).toBe('BAD_REQUEST');
    }
  });

  it('base 非正整数/非法 → 400 BAD_REQUEST', async () => {
    const { port, db } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 't', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 't')),
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const targetId = items[0]!.id;
    for (const base of ['abc', '0', '-3']) {
      const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff?base=${base}`);
      expect(r.status).toBe(400);
      expect(JSON.parse(r.text).error.code).toBe('BAD_REQUEST');
    }
    void db;
  });

  it('base 等于 target → 400 BAD_REQUEST', async () => {
    const { port } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 't', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 't')),
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const targetId = items[0]!.id;
    const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff?base=${targetId}`);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text).error.code).toBe('BAD_REQUEST');
  });

  it('target 不存在 → 404 PROXY_REQUEST_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await request(port, 'GET', '/api/proxy/requests/999999/context-diff');
    expect(r.status).toBe(404);
    expect(JSON.parse(r.text).error.code).toBe('PROXY_REQUEST_NOT_FOUND');
  });

  it('手动 base 不存在 → 404 + details.role=base，无正文证据', async () => {
    const { port } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 't', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 't')),
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const targetId = items[0]!.id;
    const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff?base=777777`);
    expect(r.status).toBe(404);
    const body = JSON.parse(r.text) as { error: { code: string; details?: { role: string } } };
    expect(body.error.code).toBe('PROXY_REQUEST_NOT_FOUND');
    expect(body.error.details?.role).toBe('base');
  });

  it('无可信自动前驱 → 409 CONTEXT_DIFF_UNAVAILABLE + reason=pairing_unavailable', async () => {
    const { port } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 't', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'unknown', body: anthropicBody(messages(1, 8, 't')),
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const targetId = items[0]!.id;
    const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff`);
    expect(r.status).toBe(409);
    const body = JSON.parse(r.text) as {
      error: { code: string; details?: { reason: string } };
    };
    expect(body.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
    expect(body.error.details?.reason).toBe('pairing_unavailable');
  });

  it('source 无法安全标准化 → 422 CONTEXT_DIFF_UNSUPPORTED（全部 reason）', async () => {
    const cases: Array<{ name: string; format: 'anthropic_messages' | 'unknown'; body: string | null }> = [
      { name: 'desensitized_body_missing', format: 'anthropic_messages', body: null },
      { name: 'invalid_json', format: 'anthropic_messages', body: '{ not json' },
      { name: 'not_an_object', format: 'anthropic_messages', body: '"a string"' },
      { name: 'source_too_large', format: 'anthropic_messages', body: 'x'.repeat(2 * 1024 * 1024 + 1) },
      { name: 'unknown_format', format: 'unknown', body: anthropicBody(messages(1, 8, 't')) },
      { name: 'classification_mismatch', format: 'anthropic_messages', body: JSON.stringify({ model: 'm' }) },
    ];
    for (const c of cases) {
      const { port } = await boot((d) => {
        seedDiffProxy(d, {
          requestId: 'base', startedAt: '2026-08-01T00:00:00.000Z',
          format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 'b')),
        });
        seedDiffProxy(d, {
          requestId: 'target', startedAt: '2026-08-01T00:00:01.000Z',
          format: c.format, body: c.body,
        });
      });
      const { items } = JSON.parse(
        (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
      ) as { items: Array<{ id: number }> };
      const [baseId, targetId] = [Math.min(...items.map((i) => i.id)), Math.max(...items.map((i) => i.id))];
      const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff?base=${baseId}`);
      expect(r.status).toBe(422);
      const body = JSON.parse(r.text) as {
        error: { code: string; details?: { role: string; reason: string } };
      };
      expect(body.error.code).toBe('CONTEXT_DIFF_UNSUPPORTED');
      expect(body.error.details?.reason).toBe(c.name);
      expect(body.error.details?.role).toBe('target');
    }
  });

  it('内部不可控失败 → 500 INTERNAL_ERROR，且无栈/无正文/无 sentinel', async () => {
    // 触发 enforceResponseBudget 抛错（响应超 1 MiB 且无法缩减到界内）。
    const { port } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 'bigbase', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1000, 1800, 'b')),
        privacyLeak: true,
      });
      seedDiffProxy(d, {
        requestId: 'bigtarget', startedAt: '2026-08-01T00:00:01.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1000, 1800, 't')),
        privacyLeak: true,
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const [baseId, targetId] = [Math.min(...items.map((i) => i.id)), Math.max(...items.map((i) => i.id))];
    const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff?base=${baseId}`);
    expect(r.status).toBe(500);
    const body = JSON.parse(r.text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('Error:');
    expect(body.error.message).not.toContain(RAW_SENTINEL);
    expect(body.error.message).not.toContain(AUTH_SENTINEL);
    expect(r.text).not.toContain(RAW_SENTINEL);
    expect(r.text).not.toContain(AUTH_SENTINEL);
    expect(r.text).not.toContain(' at ');
  });

  it('gzip：成功响应 ≥1KB 且 accept-encoding:gzip → content-encoding:gzip + vary', async () => {
    const { port } = await boot((d) => {
      seedDiffProxy(d, {
        requestId: 'g1', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(50, 600, 'b')),
        captureGroupId: 'gg', parsedSessionId: 'sg', model: 'claude-3-5-sonnet',
      });
      seedDiffProxy(d, {
        requestId: 'g2', startedAt: '2026-08-01T00:00:01.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(60, 600, 't')),
        captureGroupId: 'gg', parsedSessionId: 'sg', model: 'claude-3-5-sonnet',
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=5')).text,
    ) as { items: Array<{ id: number }> };
    const targetId = Math.max(...items.map((i) => i.id));
    const r = await request(port, 'GET', `/api/proxy/requests/${targetId}/context-diff`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(r.status).toBe(200);
    expect(r.raw.length).toBeGreaterThanOrEqual(1024);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers.vary).toContain('accept-encoding');
    const decoded = gunzipSync(r.raw).toString('utf8');
    const body = JSON.parse(decoded) as { pairing: { confidence: string } };
    expect(body.pairing.confidence).toBeTruthy();
  });

  it('6.5 成功与每个错误路径都不泄漏 raw-only sentinel / authorization / 源正文 / 栈', async () => {
    const { port } = await boot((d) => {
      // 有效 pair（成功路径）
      seedDiffProxy(d, {
        requestId: 'p1', startedAt: '2026-08-01T00:00:00.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 'b')),
        captureGroupId: 'pp', parsedSessionId: 'sp', model: 'claude-3-5-sonnet', privacyLeak: true,
      });
      seedDiffProxy(d, {
        requestId: 'p2', startedAt: '2026-08-01T00:00:01.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(2, 8, 't')),
        captureGroupId: 'pp', parsedSessionId: 'sp', model: 'claude-3-5-sonnet', privacyLeak: true,
      });
      // 手动 base 不存在（404）
      seedDiffProxy(d, {
        requestId: 'p3', startedAt: '2026-08-01T00:00:02.000Z',
        format: 'anthropic_messages', body: anthropicBody(messages(1, 8, 't')), privacyLeak: true,
      });
    });
    const { items } = JSON.parse(
      (await request(port, 'GET', '/api/proxy/requests?limit=10')).text,
    ) as { items: Array<{ id: number }> };
    const sorted = items.map((i) => i.id).sort((a, b) => a - b);
    const baseId = sorted[0]!;
    const targetId = sorted[1]!;
    const singleTarget = sorted[2]!;

    const paths = [
      { path: `/api/proxy/requests/${targetId}/context-diff`, expected: 200 },
      { path: `/api/proxy/requests/${targetId}/context-diff?base=${baseId}`, expected: 200 },
      { path: `/api/proxy/requests/${singleTarget}/context-diff?base=999999`, expected: 404 },
      { path: `/api/proxy/requests/${singleTarget}/context-diff?base=abc`, expected: 400 },
      { path: '/api/proxy/requests/999999/context-diff', expected: 404 },
      { path: `/api/proxy/requests/${singleTarget}/context-diff?base=${singleTarget}`, expected: 400 },
    ];
    for (const p of paths) {
      const r = await request(port, 'GET', p.path);
      expect(r.status).toBe(p.expected);
      expect(r.text).not.toContain(RAW_SENTINEL);
      expect(r.text).not.toContain(AUTH_SENTINEL);
      expect(r.text).not.toContain(' at ');
      expect(r.text).not.toContain('Error:');
      expect(r.text).not.toContain('{ not json');
    }
  });
});
