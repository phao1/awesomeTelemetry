import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { LocalSessionConfig } from '../src/core/trace-types.js';
import { initSchema } from './storage/schema.js';
import { createAgentObservabilityServer } from './server.js';

type Db = InstanceType<typeof Database>;

const TEST_CONFIG: LocalSessionConfig = {
  prewarmRecent: 0,
  traeKeyPath: null,
  providers: {
    claude: { key: 'claude', enabled: true, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude' },
    codex: { key: 'codex', enabled: true, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Codex' },
    opencode: { key: 'opencode', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'OpenCode' },
    codearts: { key: 'codearts', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeArts' },
    codeagent: { key: 'codeagent', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'CodeAgent' },
    codeagent2: { key: 'codeagent2', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeAgent2' },
    trae: { key: 'trae', enabled: false, path: '/none', sourceKind: 'sqlcipher', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'Trae' },
    qoder: { key: 'qoder', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Qoder' },
    workbuddy: { key: 'workbuddy', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'WorkBuddy' },
  },
};

const booted: Array<{ close: () => Promise<void>; userDir: string }> = [];

afterEach(async () => {
  while (booted.length > 0) {
    const b = booted.pop();
    if (b !== undefined) {
      await b.close();
      rmSync(b.userDir, { recursive: true, force: true });
    }
  }
});

function messages(n: number, contentLen: number, prefix: string): Array<{ role: string; content: string }> {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${prefix}${i}`.padEnd(contentLen, 'x'),
  }));
}

function seedDiffProxy(db: Db, requestId: string, startedAt: string, body: string): void {
  db.prepare(
    `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at,
       capture_group_id, request_format, model, parsed_session_id, request_body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    requestId, 'POST', 'https://api.anthropic.com', 'api.anthropic.com', startedAt,
    'perf-group', 'anthropic_messages', 'claude-3-5-sonnet', 'perf-session', body,
  );
}

function body(messagesArr: Array<{ role: string; content: string }>): string {
  return JSON.stringify({ model: 'claude-3-5-sonnet', system: 'be helpful', messages: messagesArr });
}

async function boot(seed: (db: Db) => void): Promise<{ port: number }> {
  const db = new Database(':memory:');
  initSchema(db);
  seed(db);
  const userDir = mkdtempSync(join(tmpdir(), 'server-perf-'));
  const server = createAgentObservabilityServer({
    db,
    config: TEST_CONFIG,
    detailCache: new (await import('./storage/detail-cache.js')).DetailCache(),
    userConfigPath: join(userDir, 'agent-observe.json'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  booted.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())), userDir });
  return { port };
}

function httpGet(port: number, path: string): Promise<{ status: number; body: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, body: raw.toString('utf8'), bytes: raw.length });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function lastTargetId(port: number): Promise<number> {
  const res = await httpGet(port, '/api/proxy/requests?limit=5');
  const body = JSON.parse(res.body) as { items: Array<{ id: number }> };
  return Math.max(...body.items.map((i) => i.id));
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/** 记录 work 执行期间 1ms 定时器最大漂移，近似事件循环阻塞。 */
async function maxEventLoopDelay(work: () => Promise<void>): Promise<number> {
  let max = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    if (gap > max) max = gap;
    last = now;
  }, 1);
  last = Date.now();
  await work();
  clearInterval(timer);
  return max;
}

describe('§6.6 context-diff 性能预算（NFR-P1/P2/P3）', () => {
  it('边界 fixture（item/body/entry）响应 <1 MiB 且完整标记不完整', async () => {
    // base 100 条 + target 100 匹配 + 1100 新增（触发 1000 条 entry 上限）。
    const { port } = await boot((db) => {
      const matchBase = messages(100, 200, 'b');
      seedDiffProxy(db, 'base', '2026-08-01T00:00:00.000Z', body(matchBase));
      seedDiffProxy(
        db,
        'target',
        '2026-08-01T00:00:01.000Z',
        body([...matchBase, ...messages(1100, 200, 't')]),
      );
    });
    const targetId = await lastTargetId(port);
    const r = await httpGet(port, `/api/proxy/requests/${targetId}/context-diff`);
    expect(r.status).toBe(200);
    expect(r.bytes).toBeLessThan(1024 * 1024); // <1 MiB
    const parsed = JSON.parse(r.body) as {
      noChange: boolean;
      completeness: { complete: boolean; omittedCount: number; reasons: string[] };
    };
    expect(parsed.noChange).toBe(false);
    expect(parsed.completeness.complete).toBe(false);
    expect(parsed.completeness.reasons).toContain('entry_limit');
    expect(parsed.completeness.omittedCount).toBeGreaterThan(0);
  });

  it('服务耗时 p95 <100 ms（40 次 HTTP 请求）', async () => {
    const { port } = await boot((db) => {
      seedDiffProxy(db, 'base', '2026-08-01T00:00:00.000Z', body(messages(100, 400, 'b')));
      seedDiffProxy(db, 'target', '2026-08-01T00:00:01.000Z', body([...messages(100, 400, 'b'), ...messages(30, 400, 't')]));
    });
    const targetId = await lastTargetId(port);
    const durations: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const r = await httpGet(port, `/api/proxy/requests/${targetId}/context-diff`);
      expect(r.status).toBe(200);
      const parsed = JSON.parse(r.body) as { durationMs: number };
      durations.push(parsed.durationMs);
    }
    durations.sort((a, b) => a - b);
    expect(percentile(durations, 95)).toBeLessThan(100);
  });

  it('事件循环 p99 <50 ms（40 次 diff 的 1ms 定时器最大漂移）', async () => {
    const { port } = await boot((db) => {
      seedDiffProxy(db, 'base', '2026-08-01T00:00:00.000Z', body(messages(100, 400, 'b')));
      seedDiffProxy(db, 'target', '2026-08-01T00:00:01.000Z', body([...messages(100, 400, 'b'), ...messages(30, 400, 't')]));
    });
    const targetId = await lastTargetId(port);
    const deltas: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const delta = await maxEventLoopDelay(async () => {
        const r = await httpGet(port, `/api/proxy/requests/${targetId}/context-diff`);
        expect(r.status).toBe(200);
      });
      deltas.push(delta);
    }
    deltas.sort((a, b) => a - b);
    expect(percentile(deltas, 99)).toBeLessThan(50);
  });
});
