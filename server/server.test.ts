import { gunzipSync } from 'node:zlib';
import http, { type IncomingHttpHeaders } from 'node:http';
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
