import { gunzipSync } from 'node:zlib';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { LocalSessionConfig, ProviderKey } from '../src/core/trace-types.js';
import { isForegroundBusy } from './realtime/frontline.js';
import { initSchema } from './storage/schema.js';
import {
  upsertEvents,
  upsertSessionFromTrace,
} from './storage/writers.js';
import { createAgentObservabilityServer } from './server.js';

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
    tokenUsage: { input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, total: 38 },
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
      kind: 'llm',
      phase: 'implement',
      title: 'event title',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'success',
      actor: 'assistant',
      tool: null,
      tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
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

async function boot(seed?: (db: Db) => void): Promise<BootResult> {
  const db = new Database(':memory:');
  initSchema(db);
  seed?.(db);
  const userDir = mkdtempSync(join(tmpdir(), 'server-config-'));
  const userConfigPath = join(userDir, 'agent-observe.json');
  const server = createAgentObservabilityServer({
    db,
    config: TEST_CONFIG,
    detailCache: new (await import('./storage/detail-cache.js')).DetailCache(),
    userConfigPath,
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

  it('生产实例不暴露 dev-only 路由', async () => {
    const { port } = await boot();
    const r = await request(port, 'GET', '/api/cdp/status');
    expect(r.status).toBe(404);
    const body = JSON.parse(r.text) as { error: { code: string } };
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
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
