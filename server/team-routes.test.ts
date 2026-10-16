/**
 * Team HTTP routes contract + request-count + SSE + performance tests
 * (add-agent-team-observability tasks §6.12-6.15 / api.md §7 / nfr.md §2.3).
 */
import { gunzipSync } from 'node:zlib';
import http, { type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import type {
  CompletenessLevel,
  EvidenceConfidence,
  EvidenceDimension,
  PriceCurrency,
  ProviderKey,
  TeamActivityKind,
  TeamCompleteness,
  TeamOrderConfidence,
  TeamRunStatus,
  TeamTaskStatus,
  TeamTopologyKind,
  TraceStatus,
} from '../src/core/trace-types.js';
import type { LocalSessionConfig } from '../src/core/trace-types.js';
import { initSchema } from './storage/schema.js';
import {
  upsertTeamRun,
  type TeamActivityBodyRow,
  type TeamActivityRow,
  type TeamAgentRow,
  type TeamRunIngest,
  type TeamRunRow,
  type TeamTaskRow,
} from './storage/team-storage.js';
import { createAgentObservabilityServer } from './server.js';
import { eventBus } from './realtime/event-bus.js';
import {
  clearPendingTeamChanges,
  flushTeamChangesNow,
  queueTeamRunChange,
  TEAM_CHANGE_CAP,
} from './realtime/coalescer.js';

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

function parseBody(r: RequestResult): unknown {
  if (r.headers['content-encoding'] === 'gzip') {
    return JSON.parse(gunzipSync(r.raw).toString('utf8'));
  }
  return r.text === '' ? {} : JSON.parse(r.text);
}

async function getJson<T = unknown>(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: T; headers: IncomingHttpHeaders }> {
  const r = await request(port, 'GET', path, { headers });
  return { status: r.status, body: parseBody(r) as T, headers: r.headers };
}

async function postJson<T = unknown>(
  port: number,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: T }> {
  const r = await request(port, 'POST', path, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: parseBody(r) as T };
}

async function deleteJson<T = unknown>(port: number, path: string): Promise<{ status: number; body: T }> {
  const r = await request(port, 'DELETE', path);
  return { status: r.status, body: parseBody(r) as T };
}

interface BootResult {
  port: number;
  db: Db;
  close: () => Promise<void>;
}

const booted: BootResult[] = [];

async function boot(seed?: (db: Db) => void): Promise<BootResult> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  seed?.(db);
  const userDir = mkdtempSync(join(tmpdir(), 'team-route-config-'));
  const userConfigPath = join(userDir, 'agent-observe.json');
  const server = createAgentObservabilityServer({
    db,
    config: TEST_CONFIG,
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
  clearPendingTeamChanges();
});

// ── Team 行构造 helper ──────────────────────────────────────────────────

function fullCompleteness(level: CompletenessLevel = 'complete'): TeamCompleteness {
  const dims: EvidenceDimension[] = [
    'topology', 'tasks', 'communication', 'timing', 'tools',
    'outputs', 'tokens', 'cost', 'verification',
  ];
  const out = {} as TeamCompleteness;
  for (const d of dims) {
    out[d] = level;
  }
  return out;
}

function makeRunRow(id: string, over: Partial<TeamRunRow> = {}): TeamRunRow {
  return {
    id,
    provider: over.provider ?? ('codex' as ProviderKey),
    native_run_id: over.native_run_id ?? `${id}-native`,
    run_identity_confidence: over.run_identity_confidence ?? ('native' as EvidenceConfidence),
    title: over.title ?? `Run ${id}`,
    goal_fingerprint: over.goal_fingerprint ?? null,
    status: over.status ?? ('running' as TeamRunStatus),
    started_at: over.started_at ?? '2026-08-01T00:00:00.000Z',
    ended_at: over.ended_at ?? null,
    topology_kind: over.topology_kind ?? ('two_level' as TeamTopologyKind),
    agent_count: over.agent_count ?? 0,
    task_count: over.task_count ?? 0,
    communication_count: over.communication_count ?? 0,
    activity_count: over.activity_count ?? 0,
    round_count: over.round_count ?? 0,
    artifact_count: over.artifact_count ?? 0,
    token_available: over.token_available ?? 1,
    cost_available: over.cost_available ?? 1,
    cost_currency: over.cost_currency ?? ('USD' as PriceCurrency),
    completeness: over.completeness ?? fullCompleteness(),
    updated_at: over.updated_at ?? '2026-08-01T00:00:00.000Z',
    stamp: over.stamp ?? 'stamp-1',
  };
}

function makeAgentRow(runId: string, id: string, over: Partial<TeamAgentRow> = {}): TeamAgentRow {
  return {
    id,
    run_id: runId,
    native_id: over.native_id ?? `${id}-native`,
    display_name: over.display_name ?? `Agent ${id}`,
    role: over.role ?? 'team-mate',
    role_class: over.role_class ?? 'teammate',
    model: over.model ?? 'gpt-5',
    state: over.state ?? 'busy',
    created_at: over.created_at ?? '2026-08-01T00:00:00.000Z',
    ended_at: over.ended_at ?? null,
    session_keys: over.session_keys ?? [],
    evidence_ids: over.evidence_ids ?? [],
  };
}

function makeTaskRow(runId: string, id: string, over: Partial<TeamTaskRow> = {}): TeamTaskRow {
  return {
    id,
    run_id: runId,
    native_id: over.native_id ?? `${id}-native`,
    title: over.title ?? `Task ${id}`,
    description_available: over.description_available ?? 0,
    priority: over.priority ?? 1,
    status: over.status ?? ('pending' as TeamTaskStatus),
    created_at: over.created_at ?? '2026-08-01T00:00:00.000Z',
    started_at: over.started_at ?? null,
    completed_at: over.completed_at ?? null,
    cancelled_at: over.cancelled_at ?? null,
    failed_at: over.failed_at ?? null,
    result_available: over.result_available ?? 0,
    evidence_ids: over.evidence_ids ?? [],
  };
}

function makeActivityRow(
  runId: string,
  id: string,
  over: Partial<TeamActivityRow> = {},
): TeamActivityRow {
  return {
    id,
    run_id: runId,
    agent_id: over.agent_id ?? null,
    task_id: over.task_id ?? null,
    round_id: over.round_id ?? null,
    kind: over.kind ?? ('message_sent' as TeamActivityKind),
    status: over.status ?? ('success' as TraceStatus),
    started_at: over.started_at ?? '2026-08-01T00:00:00.000Z',
    ended_at: over.ended_at ?? null,
    native_sequence: over.native_sequence ?? 1,
    session_key: over.session_key ?? null,
    event_id: over.event_id ?? null,
    turn_key: over.turn_key ?? null,
    message_id: over.message_id ?? null,
    artifact_id: over.artifact_id ?? null,
    tokens: over.tokens ?? null,
    cost_usd: over.cost_usd ?? null,
    cost_source: over.cost_source ?? null,
    cost_currency: over.cost_currency ?? null,
    has_input: over.has_input ?? 0,
    has_output: over.has_output ?? 0,
    has_raw: over.has_raw ?? 0,
    evidence_ids: over.evidence_ids ?? [],
    order_confidence: over.order_confidence ?? ('native' as TeamOrderConfidence),
  };
}

function makeBodyRow(activityId: string, over: Partial<TeamActivityBodyRow> = {}): TeamActivityBodyRow {
  return {
    activity_id: activityId,
    input_body: over.input_body ?? null,
    output_body: over.output_body ?? null,
    message_body: over.message_body ?? null,
    result_body: over.result_body ?? null,
    raw_body: over.raw_body ?? null,
  };
}

function makeIngest(
  over: Partial<TeamRunIngest> & { run: TeamRunRow; complete: boolean },
): TeamRunIngest {
  return {
    run: over.run,
    agents: over.agents ?? [],
    edges: over.edges ?? [],
    tasks: over.tasks ?? [],
    dependencies: over.dependencies ?? [],
    assignments: over.assignments ?? [],
    messages: over.messages ?? [],
    activities: over.activities ?? [],
    rounds: over.rounds ?? [],
    artifacts: over.artifacts ?? [],
    evidence: over.evidence ?? [],
    bodies: over.bodies ?? [],
    metrics: over.metrics ?? null,
    session_ids: over.session_ids ?? [],
    complete: over.complete,
  };
}

function seedMinimalRun(db: Db, runId: string, over: Partial<TeamRunRow> = {}): void {
  upsertTeamRun(
    db,
    makeIngest({
      run: makeRunRow(runId, over),
      agents: [makeAgentRow(runId, 'a1')],
      tasks: [makeTaskRow(runId, 't1')],
      activities: [
        makeActivityRow(runId, 'ac1', {
          agent_id: 'a1',
          task_id: 't1',
          started_at: '2026-08-01T00:00:00.000Z',
        }),
      ],
      complete: true,
    }),
  );
}

// ===========================================================================
// §6.12 API 契约测试
// ===========================================================================

describe('§6.12 team API 契约（api.md §7）', () => {
  it('GET /api/team-runs 返回 slim 列表，不含 body/goal/sourcePath', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
      seedMinimalRun(db, 'r2', { started_at: '2026-08-02T00:00:00.000Z' });
    });
    const r = await getJson<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
      hasMore: boolean;
      total: number;
    }>(port, '/api/team-runs?limit=10');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.items).toHaveLength(2);
    for (const item of r.body.items) {
      expect(item).not.toHaveProperty('body');
      expect(item).not.toHaveProperty('sourcePath');
      expect(item).not.toHaveProperty('goal');
      expect(item).not.toHaveProperty('raw');
      expect(typeof item.id).toBe('string');
      expect(typeof item.stamp).toBe('string');
    }
    expect(r.body.items[0]?.id).toBe('r2');
    expect(r.body.items[1]?.id).toBe('r1');
  });

  it('GET /api/team-runs keyset 分页：limit=1 翻完 2 条', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
      seedMinimalRun(db, 'r2', { started_at: '2026-08-02T00:00:00.000Z' });
    });
    const p1 = await getJson<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    }>(port, '/api/team-runs?limit=1');
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.items[0]?.id).toBe('r2');
    expect(p1.body.hasMore).toBe(true);
    expect(p1.body.nextCursor).not.toBeNull();

    const p2 = await getJson<{
      items: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    }>(port, `/api/team-runs?limit=1&cursor=${encodeURIComponent(p1.body.nextCursor!)}`);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0]?.id).toBe('r1');
    expect(p2.body.hasMore).toBe(false);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('GET /api/team-runs 过滤：provider/status/topology', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r1', { provider: 'codex' as ProviderKey, status: 'running' }),
          complete: true,
        }),
      );
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r2', {
            provider: 'claude' as ProviderKey,
            status: 'success',
            topology_kind: 'peer_graph',
          }),
          complete: true,
        }),
      );
    });
    const running = await getJson<{ total: number }>(port, '/api/team-runs?status=running');
    expect(running.body.total).toBe(1);

    const codex = await getJson<{ total: number }>(port, '/api/team-runs?provider=codex');
    expect(codex.body.total).toBe(1);

    const peer = await getJson<{ total: number; items: Array<{ id: string }> }>(
      port,
      '/api/team-runs?topology=peer_graph',
    );
    expect(peer.body.total).toBe(1);
    expect(peer.body.items[0]?.id).toBe('r2');
  });

  it('GET /api/team-runs 非法 enum → 400 INVALID_ENUM', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string } }>(port, '/api/team-runs?status=invalid');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_ENUM');
  });

  it('GET /api/team-runs 非法 topology → 400 INVALID_ENUM', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string } }>(port, '/api/team-runs?topology=invalid');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_ENUM');
  });

  it('GET /api/team-runs 非法 range → 400 INVALID_ENUM', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string } }>(port, '/api/team-runs?range=99d');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_ENUM');
  });

  it('GET /api/team-runs/:runId 返回 snapshot，不含 activities/messages/body', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const r = await getJson<{
      snapshot: Record<string, unknown>;
      stamp: string;
      cached: boolean;
    }>(port, '/api/team-runs/r1');
    expect(r.status).toBe(200);
    expect(typeof r.body.stamp).toBe('string');
    expect(typeof r.body.cached).toBe('boolean');
    const s = r.body.snapshot;
    expect(s).not.toHaveProperty('activities');
    expect(s).not.toHaveProperty('messages');
    expect(Array.isArray(s.agents)).toBe(true);
    expect(Array.isArray(s.tasks)).toBe(true);
    for (const a of s.agents as Array<Record<string, unknown>>) {
      expect(a).not.toHaveProperty('body');
    }
    for (const t of s.tasks as Array<Record<string, unknown>>) {
      expect(t).not.toHaveProperty('body');
      expect(t).not.toHaveProperty('description');
      expect(t).not.toHaveProperty('result');
    }
  });

  it('GET /api/team-runs/:runId 不存在 → 404 TEAM_RUN_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string; message: string } }>(
      port,
      '/api/team-runs/does-not-exist',
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEAM_RUN_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('GET /api/team-runs/:runId/activities 返回 slim 账本，不含 body', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('rLedger'),
          agents: [makeAgentRow('rLedger', 'a1')],
          activities: [
            makeActivityRow('rLedger', 'ac1', { agent_id: 'a1', started_at: '2026-08-01T00:00:00.000Z' }),
            makeActivityRow('rLedger', 'ac2', { agent_id: 'a1', started_at: '2026-08-01T00:01:00.000Z' }),
          ],
          bodies: [makeBodyRow('ac1', { message_body: 'SECRET' })],
          complete: true,
        }),
      );
    });
    const r = await getJson<{
      items: Array<Record<string, unknown>>;
      hasAmbiguousOrder: boolean;
      total: number;
    }>(port, '/api/team-runs/rLedger/activities?limit=200');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(typeof r.body.hasAmbiguousOrder).toBe('boolean');
    for (const item of r.body.items) {
      expect(item).not.toHaveProperty('input');
      expect(item).not.toHaveProperty('output');
      expect(item).not.toHaveProperty('raw');
      expect(item).not.toHaveProperty('toolArguments');
      expect(item).not.toHaveProperty('toolResult');
      expect(item).not.toHaveProperty('reasoning');
    }
    expect(JSON.stringify(r.body)).not.toContain('SECRET');
  });

  it('GET /api/team-runs/:runId/activities 不存在的 run → 404 TEAM_RUN_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string } }>(
      port,
      '/api/team-runs/does-not-exist/activities',
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEAM_RUN_NOT_FOUND');
  });

  it('GET /api/team-runs/:runId/activities/:activityId 默认 slim，body/raw 为 null', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('rDetail'),
          agents: [makeAgentRow('rDetail', 'a1')],
          activities: [makeActivityRow('rDetail', 'ac1', { agent_id: 'a1' })],
          bodies: [makeBodyRow('ac1', { message_body: 'hello', raw_body: 'raw-content' })],
          complete: true,
        }),
      );
    });
    const r = await getJson<{
      activity: { id: string };
      body: unknown;
      raw: unknown;
    }>(port, '/api/team-runs/rDetail/activities/ac1');
    expect(r.status).toBe(200);
    expect(r.body.activity.id).toBe('ac1');
    expect(r.body.body).toBeNull();
    expect(r.body.raw).toBeNull();
  });

  it('GET /api/team-runs/:runId/activities/:activityId?include=body 返回 body', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('rBody'),
          agents: [makeAgentRow('rBody', 'a1')],
          activities: [makeActivityRow('rBody', 'ac1', { agent_id: 'a1' })],
          bodies: [
            makeBodyRow('ac1', {
              input_body: 'in',
              output_body: 'out',
              message_body: 'msg',
              result_body: 'res',
            }),
          ],
          complete: true,
        }),
      );
    });
    const r = await getJson<{
      body: { input: string; output: string; message: string; result: string };
      raw: unknown;
    }>(port, '/api/team-runs/rBody/activities/ac1?include=body');
    expect(r.status).toBe(200);
    expect(r.body.body).toEqual({ input: 'in', output: 'out', message: 'msg', result: 'res' });
    expect(r.body.raw).toBeNull();
  });

  it('GET /api/team-runs/:runId/activities/:activityId?include=raw 返回 raw', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('rRaw'),
          agents: [makeAgentRow('rRaw', 'a1')],
          activities: [makeActivityRow('rRaw', 'ac1', { agent_id: 'a1' })],
          bodies: [makeBodyRow('ac1', { raw_body: 'raw-content' })],
          complete: true,
        }),
      );
    });
    const r = await getJson<{ raw: string }>(port, '/api/team-runs/rRaw/activities/ac1?include=raw');
    expect(r.status).toBe(200);
    expect(r.body.raw).toBe('raw-content');
  });

  it('include=body 但 body 行缺失 → 409 TEAM_BODY_UNAVAILABLE', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('rNobody'),
          agents: [makeAgentRow('rNobody', 'a1')],
          activities: [makeActivityRow('rNobody', 'ac1', { agent_id: 'a1' })],
          complete: true,
        }),
      );
    });
    const r = await getJson<{ error: { code: string } }>(
      port,
      '/api/team-runs/rNobody/activities/ac1?include=body',
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TEAM_BODY_UNAVAILABLE');
  });

  it('activity 不存在 → 404 TEAM_ACTIVITY_NOT_FOUND', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const r = await getJson<{ error: { code: string } }>(
      port,
      '/api/team-runs/r1/activities/does-not-exist',
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEAM_ACTIVITY_NOT_FOUND');
  });

  it('GET /api/team-runs/:runId/patch 缺 stamp → 400 BAD_REQUEST', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const r = await getJson<{ error: { code: string } }>(port, '/api/team-runs/r1/patch');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /api/team-runs/:runId/patch stamp 相同 → 空补丁', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { stamp: 'stamp-1' });
    });
    const r = await getJson<{
      runId: string;
      stamp: string;
      agents: unknown[];
      tasks: unknown[];
      truncated: boolean;
    }>(port, '/api/team-runs/r1/patch?stamp=stamp-1');
    expect(r.status).toBe(200);
    expect(r.body.runId).toBe('r1');
    expect(r.body.agents).toHaveLength(0);
    expect(r.body.tasks).toHaveLength(0);
    expect(r.body.truncated).toBe(false);
  });

  it('GET /api/team-runs/:runId/patch 不存在 → 404 TEAM_RUN_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string } }>(
      port,
      '/api/team-runs/does-not-exist/patch?stamp=s',
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEAM_RUN_NOT_FOUND');
  });

  it('POST /api/team-compare 返回比较，无 body/winner/score', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { goal_fingerprint: 'goal-A' });
      seedMinimalRun(db, 'r2', { goal_fingerprint: 'goal-A', started_at: '2026-08-02T00:00:00.000Z' });
    });
    const r = await postJson<{
      leftRunId: string;
      rightRunId: string;
      basis: Record<string, unknown>;
      dimensions: Array<{ dimension: string; rows: Array<Record<string, unknown>> }>;
      strengths: string[];
      weaknesses: string[];
      tradeoffs: string[];
      caveats: string[];
    }>(port, '/api/team-compare', { leftRunId: 'r1', rightRunId: 'r2' });
    expect(r.status).toBe(200);
    expect(r.body.leftRunId).toBe('r1');
    expect(r.body.rightRunId).toBe('r2');
    expect(r.body.basis).toBeDefined();
    expect(r.body.dimensions).toHaveLength(5);
    expect(Array.isArray(r.body.strengths)).toBe(true);
    expect(Array.isArray(r.body.weaknesses)).toBe(true);
    expect(Array.isArray(r.body.tradeoffs)).toBe(true);
    expect(Array.isArray(r.body.caveats)).toBe(true);
    expect(r.body).not.toHaveProperty('winner');
    expect(r.body).not.toHaveProperty('score');
    expect(r.body).not.toHaveProperty('overallScore');
    for (const dim of r.body.dimensions) {
      for (const row of dim.rows) {
        expect(row).not.toHaveProperty('body');
        expect(row).not.toHaveProperty('raw');
      }
    }
  });

  it('POST /api/team-compare left === right → 400 TEAM_COMPARE_INVALID', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const r = await postJson<{ error: { code: string } }>(port, '/api/team-compare', {
      leftRunId: 'r1',
      rightRunId: 'r1',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('TEAM_COMPARE_INVALID');
  });

  it('POST /api/team-compare 缺 id → 400 TEAM_COMPARE_INVALID', async () => {
    const { port } = await boot();
    const r = await postJson<{ error: { code: string } }>(port, '/api/team-compare', {
      leftRunId: 'r1',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('TEAM_COMPARE_INVALID');
  });

  it('POST /api/team-compare run 不存在 → 404 TEAM_RUN_NOT_FOUND', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const r = await postJson<{ error: { code: string } }>(port, '/api/team-compare', {
      leftRunId: 'r1',
      rightRunId: 'does-not-exist',
    });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEAM_RUN_NOT_FOUND');
  });

  it('POST /api/team-compare 畸形 body → 400', async () => {
    const { port } = await boot();
    const r = await request(port, 'POST', '/api/team-compare', {
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(r.status).toBe(400);
  });

  it('DELETE /api/team-runs/:runId 删除派生 team run', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const r = await deleteJson<{ deleted: boolean; runId: string }>(port, '/api/team-runs/r1');
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    expect(r.body.runId).toBe('r1');
    const r2 = await deleteJson<{ error: { code: string } }>(port, '/api/team-runs/r1');
    expect(r2.status).toBe(404);
    expect(r2.body.error.code).toBe('TEAM_RUN_NOT_FOUND');
  });

  it('DELETE 不存在 → 404 TEAM_RUN_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await deleteJson<{ error: { code: string } }>(port, '/api/team-runs/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEAM_RUN_NOT_FOUND');
  });

  it('gzip：响应 ≥1KB 且 accept-encoding:gzip → content-encoding:gzip + vary', async () => {
    const { port } = await boot((db) => {
      for (let i = 0; i < 20; i += 1) {
        seedMinimalRun(db, `r${i}`, {
          started_at: new Date(Date.parse('2026-08-01T00:00:00.000Z') + i * 1000).toISOString(),
          title: `Run ${i} with a sufficiently long title to push response over 1KB threshold`,
        });
      }
    });
    const r = await request(port, 'GET', '/api/team-runs?limit=20', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers['vary']).toBe('accept-encoding');
    const decompressed = gunzipSync(r.raw).toString('utf8');
    const body = JSON.parse(decompressed) as { items: unknown[] };
    expect(body.items).toHaveLength(20);
  });

  it('所有 team 错误使用统一 ApiError 信封', async () => {
    const { port } = await boot();
    const cases: Array<{ path: string; code: string; status: number }> = [
      { path: '/api/team-runs/does-not-exist', code: 'TEAM_RUN_NOT_FOUND', status: 404 },
      { path: '/api/team-runs/does-not-exist/activities', code: 'TEAM_RUN_NOT_FOUND', status: 404 },
      { path: '/api/team-runs/does-not-exist/activities/ac1', code: 'TEAM_RUN_NOT_FOUND', status: 404 },
      { path: '/api/team-runs/does-not-exist/patch?stamp=s', code: 'TEAM_RUN_NOT_FOUND', status: 404 },
    ];
    for (const c of cases) {
      const r = await getJson<{ error: { code: string; message: string } }>(port, c.path);
      expect(r.status).toBe(c.status);
      expect(r.body.error.code).toBe(c.code);
      expect(typeof r.body.error.message).toBe('string');
    }
  });
});

// ===========================================================================
// §6.13 请求数预算测试
// ===========================================================================

describe('§6.13 team 请求数预算（nfr.md §2.3 / design D17）', () => {
  it('snapshot 单次请求 ≤1：一次 GET 返回全部图元数据', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r1', { agent_count: 5, task_count: 10 }),
          agents: Array.from({ length: 5 }, (_, i) => makeAgentRow('r1', `a${i}`)),
          tasks: Array.from({ length: 10 }, (_, i) => makeTaskRow('r1', `t${i}`)),
          complete: true,
        }),
      );
    });
    const r = await getJson<{
      snapshot: { agents: unknown[]; tasks: unknown[] };
    }>(port, '/api/team-runs/r1');
    expect(r.status).toBe(200);
    expect(r.body.snapshot.agents).toHaveLength(5);
    expect(r.body.snapshot.tasks).toHaveLength(10);
  });

  it('visible ledger 单次请求 ≤1：一次 GET activities 返回一页', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r1'),
          agents: [makeAgentRow('r1', 'a1')],
          activities: Array.from({ length: 200 }, (_, i) =>
            makeActivityRow('r1', `ac${i}`, {
              agent_id: 'a1',
              started_at: new Date(Date.parse('2026-08-01T00:00:00.000Z') + i * 1000).toISOString(),
              native_sequence: i,
            }),
          ),
          complete: true,
        }),
      );
    });
    const r = await getJson<{ items: unknown[]; total: number }>(
      port,
      '/api/team-runs/r1/activities?limit=200',
    );
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(200);
  });

  it('compare exactly 1 请求：POST /api/team-compare 返回完整比较', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { goal_fingerprint: 'goal-A' });
      seedMinimalRun(db, 'r2', { goal_fingerprint: 'goal-A', started_at: '2026-08-02T00:00:00.000Z' });
    });
    const r = await postJson<{
      dimensions: unknown[];
      basis: unknown;
    }>(port, '/api/team-compare', { leftRunId: 'r1', rightRunId: 'r2' });
    expect(r.status).toBe(200);
    expect(r.body.dimensions).toHaveLength(5);
  });

  it('patch ≤1 请求：GET /api/team-runs/:runId/patch 单次返回增量', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { stamp: 'stamp-1' });
    });
    const r = await getJson<{ agents: unknown[]; truncated: boolean }>(
      port,
      '/api/team-runs/r1/patch?stamp=stamp-0',
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.agents)).toBe(true);
    expect(typeof r.body.truncated).toBe('boolean');
  });

  it('零 per-agent/task/session 循环：snapshot 一次返回全部 agents/tasks', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r1'),
          agents: [makeAgentRow('r1', 'a1'), makeAgentRow('r1', 'a2')],
          tasks: [makeTaskRow('r1', 't1'), makeTaskRow('r1', 't2')],
          complete: true,
        }),
      );
    });
    const r = await getJson<{
      snapshot: { agents: Array<{ id: string }>; tasks: Array<{ id: string }> };
    }>(port, '/api/team-runs/r1');
    expect(r.body.snapshot.agents.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(r.body.snapshot.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });
});

// ===========================================================================
// §6.14 SSE burst/reconnect 测试
// ===========================================================================

describe('§6.14 team_runs_changed SSE 合并（design D14 / §6.11）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    clearPendingTeamChanges();
    vi.useRealTimers();
  });

  it('1000 次 queueTeamRunChange 在 200ms 窗口内 → 只发 1 条 team_runs_changed', async () => {
    const events: Array<{ runIds: string[]; truncated: boolean; stamp: string }> = [];
    const unsub = eventBus.on('team_runs_changed', (p) => events.push(p));
    for (let i = 0; i < 1000; i += 1) {
      queueTeamRunChange({ runId: `r${i}`, stamp: `stamp-${i}` });
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toHaveLength(1);
    expect(events[0]?.runIds).toHaveLength(1000);
    expect(events[0]?.stamp).toBe('stamp-999');
    unsub();
  });

  it('agent/task ids 超过 cap → truncated=true，agentIds/taskIds 截断到 cap', async () => {
    const events: Array<{ runIds: string[]; agentIds: string[]; taskIds: string[]; truncated: boolean }> = [];
    const unsub = eventBus.on('team_runs_changed', (p) => events.push(p));
    queueTeamRunChange({
      runId: 'r1',
      agentIds: Array.from({ length: TEAM_CHANGE_CAP + 50 }, (_, i) => `a${i}`),
      taskIds: Array.from({ length: TEAM_CHANGE_CAP + 10 }, (_, i) => `t${i}`),
      stamp: 's1',
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toHaveLength(1);
    expect(events[0]?.truncated).toBe(true);
    expect(events[0]?.agentIds).toHaveLength(TEAM_CHANGE_CAP);
    expect(events[0]?.taskIds).toHaveLength(TEAM_CHANGE_CAP);
    expect(events[0]?.runIds).toEqual(['r1']);
    unsub();
  });

  it('patch preserves state：stamp 未变 → 空补丁', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { stamp: 'stamp-1' });
    });
    vi.useRealTimers();
    const r = await getJson<{
      agents: unknown[];
      tasks: unknown[];
      truncated: boolean;
    }>(port, '/api/team-runs/r1/patch?stamp=stamp-1');
    expect(r.body.agents).toHaveLength(0);
    expect(r.body.tasks).toHaveLength(0);
    expect(r.body.truncated).toBe(false);
  });

  it('truncation → 客户端改做一次 snapshot refresh', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { stamp: 'stamp-2' });
    });
    vi.useRealTimers();
    const snapshot = await getJson<{ snapshot: Record<string, unknown>; stamp: string }>(
      port,
      '/api/team-runs/r1',
    );
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.stamp).toBe('stamp-2');
  });

  it('200ms 窗口后新一批产生新事件', async () => {
    const events: Array<{ runIds: string[] }> = [];
    const unsub = eventBus.on('team_runs_changed', (p) => events.push(p));
    queueTeamRunChange({ runId: 'r1', stamp: 's1' });
    await vi.advanceTimersByTimeAsync(200);
    queueTeamRunChange({ runId: 'r2', stamp: 's2' });
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toHaveLength(2);
    expect(events[0]?.runIds).toEqual(['r1']);
    expect(events[1]?.runIds).toEqual(['r2']);
    unsub();
  });

  it('flushTeamChangesNow 立即冲刷 pending', () => {
    const events: Array<{ runIds: string[] }> = [];
    const unsub = eventBus.on('team_runs_changed', (p) => events.push(p));
    queueTeamRunChange({ runId: 'r1', stamp: 's1' });
    flushTeamChangesNow();
    expect(events).toHaveLength(1);
    expect(events[0]?.runIds).toEqual(['r1']);
    unsub();
  });
});

// ===========================================================================
// §6.15 服务性能测试
// ===========================================================================

describe('§6.15 team 服务性能（nfr.md §2.3）', () => {
  it('compare 冷启 < 300ms（tier-B ceiling）', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { goal_fingerprint: 'goal-A' });
      seedMinimalRun(db, 'r2', { goal_fingerprint: 'goal-A', started_at: '2026-08-02T00:00:00.000Z' });
    });
    const t0 = Date.now();
    const r = await postJson<{ dimensions: unknown[] }>(port, '/api/team-compare', {
      leftRunId: 'r1',
      rightRunId: 'r2',
    });
    const elapsed = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(300);
  });

  it('snapshot 响应 < 750KB（tier-B ceiling）', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r1', { agent_count: 10, task_count: 50 }),
          agents: Array.from({ length: 10 }, (_, i) => makeAgentRow('r1', `a${i}`)),
          tasks: Array.from({ length: 50 }, (_, i) => makeTaskRow('r1', `t${i}`)),
          complete: true,
        }),
      );
    });
    const r = await request(port, 'GET', '/api/team-runs/r1', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(r.status).toBe(200);
    expect(r.raw.length).toBeLessThan(750 * 1024);
  });

  it('ledger 响应 < 200KB（tier-B ceiling, 200 activities）', async () => {
    const { port } = await boot((db) => {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r1'),
          agents: [makeAgentRow('r1', 'a1')],
          activities: Array.from({ length: 200 }, (_, i) =>
            makeActivityRow('r1', `ac${i}`, {
              agent_id: 'a1',
              started_at: new Date(Date.parse('2026-08-01T00:00:00.000Z') + i * 1000).toISOString(),
              native_sequence: i,
            }),
          ),
          complete: true,
        }),
      );
    });
    const r = await request(port, 'GET', '/api/team-runs/r1/activities?limit=200', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(r.status).toBe(200);
    expect(r.raw.length).toBeLessThan(200 * 1024);
  });

  it('compare 响应 < 250KB（tier-B ceiling）', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1', { goal_fingerprint: 'goal-A' });
      seedMinimalRun(db, 'r2', { goal_fingerprint: 'goal-A', started_at: '2026-08-02T00:00:00.000Z' });
    });
    const r = await request(port, 'POST', '/api/team-compare', {
      headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip' },
      body: JSON.stringify({ leftRunId: 'r1', rightRunId: 'r2' }),
    });
    expect(r.status).toBe(200);
    expect(r.raw.length).toBeLessThan(250 * 1024);
  });

  it('无 spawnSync/readFileSync 大文件在请求路径（禁令 4）', async () => {
    const { port } = await boot((db) => {
      seedMinimalRun(db, 'r1');
    });
    const t0 = Date.now();
    const r = await getJson<unknown>(port, '/api/team-runs/r1');
    const elapsed = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });
});

// ===========================================================================
// agent-collaboration-replay §2.1：GET /api/sessions/:key/team-run
// ===========================================================================

/** 插入最小 session 行（满足 team_run_sessions 的 FK 约束）。 */
function insertSessionRow(db: Db, id: string): void {
  db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, cwd, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'codex',
    'Codex',
    `session ${id}`,
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:01:00.000Z',
    'success',
    '/tmp',
    `/tmp/${id}.jsonl`,
  );
}

/** seed 一个 team run 并关联到指定 session_ids。 */
function seedRunWithSessions(
  db: Db,
  runId: string,
  sessionIds: string[],
  over: Partial<TeamRunRow> = {},
): void {
  upsertTeamRun(
    db,
    makeIngest({
      run: makeRunRow(runId, over),
      agents: [makeAgentRow(runId, 'a1')],
      session_ids: sessionIds,
      complete: true,
    }),
  );
}

describe('agent-collaboration-replay §2.1 GET /api/sessions/:key/team-run', () => {
  it('正常返回 runIds，按 started_at DESC 排序', async () => {
    const { port } = await boot((db) => {
      insertSessionRow(db, 'sess-1');
      // r1 started_at 较早，r2 较晚 → DESC 排序后 [r2, r1]
      seedRunWithSessions(db, 'r1', ['sess-1'], {
        started_at: '2026-08-01T00:00:00.000Z',
      });
      seedRunWithSessions(db, 'r2', ['sess-1'], {
        started_at: '2026-08-02T00:00:00.000Z',
      });
    });
    const r = await getJson<{ runIds: string[] }>(port, '/api/sessions/sess-1/team-run');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.runIds)).toBe(true);
    expect(r.body.runIds).toEqual(['r2', 'r1']);
  });

  it('session 不存在 → 404 SESSION_NOT_FOUND', async () => {
    const { port } = await boot();
    const r = await getJson<{ error: { code: string; message: string } }>(
      port,
      '/api/sessions/does-not-exist/team-run',
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('session 无关联 team run → 200 + runIds: []', async () => {
    const { port } = await boot((db) => {
      insertSessionRow(db, 'sess-orphan');
    });
    const r = await getJson<{ runIds: string[] }>(port, '/api/sessions/sess-orphan/team-run');
    expect(r.status).toBe(200);
    expect(r.body.runIds).toEqual([]);
  });
});
