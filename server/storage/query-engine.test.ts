import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type {
  DataSource,
  ProviderKey,
  TraceEventRaw,
  TraceStatus,
} from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import {
  getEventDetail,
  getSessionDetail,
  getSystemPromptForSession,
  listProxyRequests,
  listSessions,
} from './query-engine.js';

type Db = InstanceType<typeof Database>;

const BASE_SESSION = {
  provider: 'codex' as ProviderKey,
  sourceAgent: 'Codex',
  title: 't',
  startedAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:01:00.000Z',
  status: 'success' as TraceStatus,
  cwd: null as string | null,
  messageCount: 1,
  eventCount: 0,
  tokenInput: 0,
  tokenOutput: 0,
  tokenReasoning: 0,
  tokenCacheRead: 0,
  tokenCacheWrite: 0,
  tokenTotal: 0,
  costUsd: 0,
  systemPrompt: null as string | null,
  sourcePath: '/tmp/x.jsonl',
  dataSource: 'scan' as DataSource,
  totalDurationMs: 0,
  isSubagent: 0,
  detailLoaded: 0,
};

const SESSION_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at', 'status',
  'cwd', 'message_count', 'event_count', 'token_input', 'token_output',
  'token_reasoning', 'token_cache_read', 'token_cache_write', 'token_total',
  'cost_usd', 'system_prompt', 'source_path', 'data_source', 'total_duration_ms',
  'is_subagent', 'detail_loaded',
];

function insertSession(
  db: Db,
  id: string,
  over: Partial<typeof BASE_SESSION> = {},
): void {
  const s = { ...BASE_SESSION, ...over, id };
  const placeholders = SESSION_COLS.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO sessions (${SESSION_COLS.join(', ')}) VALUES (${placeholders})`,
  ).run(
    s.id, s.provider, s.sourceAgent, s.title, s.startedAt, s.updatedAt, s.status,
    s.cwd, s.messageCount, s.eventCount, s.tokenInput, s.tokenOutput,
    s.tokenReasoning, s.tokenCacheRead, s.tokenCacheWrite, s.tokenTotal,
    s.costUsd, s.systemPrompt, s.sourcePath, s.dataSource, s.totalDurationMs,
    s.isSubagent, s.detailLoaded,
  );
}

function insertEvent(
  db: Db,
  over: {
    sessionId: string;
    id: string;
    sequence: number;
    kind?: string;
    phase?: string;
    title?: string;
    startedAt?: string;
    durationMs?: number;
    status?: string;
    actor?: string;
    tool?: string | null;
    inputSummary?: string | null;
    outputSummary?: string | null;
    tokensJson?: string | null;
    error?: string | null;
  },
): void {
  const e = {
    kind: 'llm',
    phase: 'implement',
    title: `ev-${over.sequence}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 10,
    status: 'success',
    actor: 'assistant',
    tool: null,
    inputSummary: null,
    outputSummary: null,
    tokensJson: null,
    error: null,
    ...over,
  };
  db.prepare(
    `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms, status, actor, tool, input_summary, output_summary, tokens_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.sessionId, e.id, e.sequence, e.kind, e.phase, e.title, e.startedAt,
    e.durationMs, e.status, e.actor, e.tool, e.inputSummary, e.outputSummary,
    e.tokensJson, e.error,
  );
}

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

describe('REQ-006 会话列表查询', () => {
  it('REQ-006 列表项不含 systemPrompt，hasSystemPrompt 为布尔', () => {
    const db = newDb();
    insertSession(db, 's1', { systemPrompt: 'prompt body', sourcePath: '/tmp/a.jsonl' });
    insertSession(db, 's2', { systemPrompt: null, sourcePath: '/tmp/b.jsonl' });

    const r = listSessions(db, { dataSource: 'scan', limit: 50 });

    expect(r.items).toHaveLength(2);
    for (const item of r.items) {
      expect(item).not.toHaveProperty('systemPrompt');
      expect(typeof item.hasSystemPrompt).toBe('boolean');
    }
    const byId = new Map(r.items.map((i) => [i.id, i]));
    expect(byId.get('s1')?.hasSystemPrompt).toBe(true);
    expect(byId.get('s2')?.hasSystemPrompt).toBe(false);
    expect(byId.get('s1')?.mergeGroupId).toBeNull();
    db.close();
  });

  it('REQ-006 按 started_at DESC 排序并 keyset 分页', () => {
    const db = newDb();
    for (let i = 1; i <= 5; i += 1) {
      insertSession(db, `s${i}`, {
        startedAt: `2026-08-0${i}T00:00:00.000Z`,
        updatedAt: `2026-08-0${i}T00:00:00.000Z`,
      });
    }

    const page1 = listSessions(db, { dataSource: 'scan', limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(['s5', 's4']);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe('2026-08-04T00:00:00.000Z');
    expect(page1.total).toBe(5);

    const page2 = listSessions(db, { dataSource: 'scan', limit: 2, cursor: page1.nextCursor ?? undefined });
    expect(page2.items.map((i) => i.id)).toEqual(['s3', 's2']);
    expect(page2.hasMore).toBe(true);
    expect(page2.nextCursor).toBe('2026-08-02T00:00:00.000Z');

    const page3 = listSessions(db, { dataSource: 'scan', limit: 2, cursor: page2.nextCursor ?? undefined });
    expect(page3.items.map((i) => i.id)).toEqual(['s1']);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
    db.close();
  });

  it('REQ-006 provider 与 dataSource 过滤', () => {
    const db = newDb();
    insertSession(db, 's1', { provider: 'codex', dataSource: 'scan' });
    insertSession(db, 's2', { provider: 'claude', dataSource: 'scan' });
    insertSession(db, 's3', { provider: 'codex', dataSource: 'proxy' });

    const codex = listSessions(db, { dataSource: 'scan', provider: ['codex'] });
    expect(codex.items.map((i) => i.id)).toEqual(['s1']);
    expect(codex.total).toBe(1);

    const proxy = listSessions(db, { dataSource: 'proxy' });
    expect(proxy.items.map((i) => i.id)).toEqual(['s3']);
    db.close();
  });

  it('REQ-006 keys 模式返回匹配项，hasMore 恒 false', () => {
    const db = newDb();
    for (let i = 1; i <= 4; i += 1) insertSession(db, `s${i}`);

    const r = listSessions(db, { dataSource: 'scan', keys: ['s1', 's3', 'missing'] });
    expect(r.items.map((i) => i.id)).toEqual(['s1', 's3']);
    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBeNull();
    expect(r.total).toBe(2);
    db.close();
  });

  it('q 过滤：标题 / ID 大小写不敏感子串，LIKE 元字符转义', () => {
    const db = newDb();
    insertSession(db, 'codearts-87fa32238de9b5', { title: '财务看板下钻优化及FIRE计算' });
    insertSession(db, 's2', { title: 'Fix SQLite index expansion' });
    insertSession(db, 's3', { title: '100%_coverage review' });
    insertSession(db, 's4', { title: 'auth_token rotation' });

    const byTitle = listSessions(db, { dataSource: 'scan', q: 'fire' });
    expect(byTitle.items.map((i) => i.id)).toEqual(['codearts-87fa32238de9b5']);

    const byId = listSessions(db, { dataSource: 'scan', q: 'codearts-87fa' });
    expect(byId.items.map((i) => i.id)).toEqual(['codearts-87fa32238de9b5']);

    const idFragment = listSessions(db, { dataSource: 'scan', q: '87fa3223' });
    expect(idFragment.items.map((i) => i.id)).toEqual(['codearts-87fa32238de9b5']);

    // % 与 _ 按字面量匹配，不当作通配符
    const literalPct = listSessions(db, { dataSource: 'scan', q: '100%' });
    expect(literalPct.items.map((i) => i.id)).toEqual(['s3']);
    const literalUnder = listSessions(db, { dataSource: 'scan', q: 'auth_token' });
    expect(literalUnder.items.map((i) => i.id)).toEqual(['s4']);
    // '%coverage'（% 后直接跟 c）不是字面子串，验证 % 不当作通配符
    const wildcardPct = listSessions(db, { dataSource: 'scan', q: '%coverage' });
    expect(wildcardPct.items).toHaveLength(0);

    // total 与过滤一致
    expect(byId.total).toBe(1);
    expect(literalPct.total).toBe(1);
    db.close();
  });

  it('range 过滤：按 updated_at 活跃时间，长期会话今天更新仍可见', () => {
    const db = newDb();
    const now = Date.now();
    insertSession(db, 'long-running-active-today', {
      startedAt: new Date(now - 40 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 3600_000).toISOString(),
    });
    insertSession(db, 'five-days', {
      startedAt: new Date(now - 20 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 5 * 86_400_000).toISOString(),
    });
    insertSession(db, 'twenty-days', {
      startedAt: new Date(now - 40 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 20 * 86_400_000).toISOString(),
    });
    insertSession(db, 'forty-days', {
      startedAt: new Date(now - 50 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 40 * 86_400_000).toISOString(),
    });

    const today = listSessions(db, { dataSource: 'scan', range: 'today' });
    expect(today.items.map((i) => i.id)).toEqual(['long-running-active-today']);
    expect(today.total).toBe(1);

    const d7 = listSessions(db, { dataSource: 'scan', range: '7d' });
    expect(d7.items.map((i) => i.id)).toEqual(['five-days', 'long-running-active-today']);
    expect(d7.total).toBe(2);

    const d30 = listSessions(db, { dataSource: 'scan', range: '30d' });
    expect(d30.items.map((i) => i.id)).toEqual([
      'five-days',
      'long-running-active-today',
      'twenty-days',
    ]);

    const all = listSessions(db, { dataSource: 'scan', range: 'all' });
    expect(all.items).toHaveLength(4);

    const unspecified = listSessions(db, { dataSource: 'scan' });
    expect(unspecified.items).toHaveLength(4);
    db.close();
  });

  it('status 多选 + 组合过滤（provider/range/q/分页 total 一致）', () => {
    const db = newDb();
    const now = Date.now();
    insertSession(db, 's-ok-codex', {
      provider: 'codex',
      status: 'success',
      title: 'fix build',
      startedAt: new Date(now - 3600_000).toISOString(),
    });
    insertSession(db, 's-err-codex', {
      provider: 'codex',
      status: 'error',
      title: 'fix build 2',
      startedAt: new Date(now - 3600_000).toISOString(),
    });
    insertSession(db, 's-ok-claude', {
      provider: 'claude',
      status: 'success',
      title: 'fix build 3',
      startedAt: new Date(now - 3600_000).toISOString(),
    });
    insertSession(db, 's-old-err', {
      provider: 'codex',
      status: 'error',
      title: 'fix build old',
      startedAt: new Date(now - 10 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 10 * 86_400_000).toISOString(),
    });

    const statuses = listSessions(db, { dataSource: 'scan', status: ['success', 'error'] });
    expect(statuses.items).toHaveLength(4);

    const combo = listSessions(db, {
      dataSource: 'scan',
      provider: ['codex'],
      status: ['error'],
      q: 'fix build',
      range: '7d',
    });
    expect(combo.items.map((i) => i.id)).toEqual(['s-err-codex']);
    expect(combo.total).toBe(1);

    const page1 = listSessions(db, { dataSource: 'scan', provider: ['codex'], limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(3);
    const page2 = listSessions(db, {
      dataSource: 'scan',
      provider: ['codex'],
      limit: 1,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
    db.close();
  });
});

describe('REQ-006/007 会话详情', () => {
  it('REQ-006 默认 slim：event 不含 inputSummary/outputSummary/raw', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, {
      sessionId: 's1', id: 'e1', sequence: 1, inputSummary: 'in', outputSummary: 'out',
    });

    const r = getSessionDetail(db, 's1');
    expect(r).not.toBeNull();
    expect(r?.mode).toBe('slim');
    expect(r?.events).toHaveLength(1);
    const ev = r?.events[0] as unknown as Record<string, unknown>;
    expect(ev).not.toHaveProperty('inputSummary');
    expect(ev).not.toHaveProperty('outputSummary');
    expect(ev).not.toHaveProperty('raw');
    expect(ev.hasInput).toBe(true);
    expect(ev.hasOutput).toBe(true);
    expect(ev.hasRaw).toBe(true);
    db.close();
  });

  it('REQ-006 full 模式包含正文', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, {
      sessionId: 's1', id: 'e1', sequence: 1, inputSummary: 'in', outputSummary: 'out',
    });

    const r = getSessionDetail(db, 's1', { mode: 'full' });
    const ev = r?.events[0] as Record<string, unknown> | undefined;
    expect(ev?.inputSummary).toBe('in');
    expect(ev?.outputSummary).toBe('out');
    expect(ev).not.toHaveProperty('raw');
    db.close();
  });

  it('REQ-006 会话不存在返回 null', () => {
    const db = newDb();
    expect(getSessionDetail(db, 'nope')).toBeNull();
    db.close();
  });

  it('REQ-007 event 数 > 2000 时启用分页', () => {
    const db = newDb();
    insertSession(db, 's1', { eventCount: 2500 });
    for (let i = 1; i <= 2500; i += 1) {
      insertEvent(db, { sessionId: 's1', id: `e${i}`, sequence: i });
    }

    const page1 = getSessionDetail(db, 's1');
    expect(page1?.eventTotal).toBe(2500);
    expect(page1?.eventOffset).toBe(0);
    expect(page1?.eventLimit).toBe(2000);
    expect(page1?.events).toHaveLength(2000);
    expect(page1?.hasMore).toBe(true);

    const page2 = getSessionDetail(db, 's1', { offset: 2000, limit: 500 });
    expect(page2?.events).toHaveLength(500);
    expect(page2?.eventOffset).toBe(2000);
    expect(page2?.eventLimit).toBe(500);
    expect(page2?.hasMore).toBe(false);
    expect(page2?.events[0]?.sequence).toBe(2001);
    expect(page2?.events.at(-1)?.sequence).toBe(2500);
    db.close();
  });

  it('REQ-006 session 完整字段映射（tokenUsage 明细）', () => {
    const db = newDb();
    insertSession(db, 's1', {
      tokenInput: 10, tokenOutput: 20, tokenReasoning: 5, tokenCacheRead: 3,
      tokenCacheWrite: 2, tokenTotal: 38, systemPrompt: 'sys', totalDurationMs: 900,
    });

    const r = getSessionDetail(db, 's1');
    expect(r?.session.tokenUsage).toEqual({
      input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, netInput: 7, total: 38,
    });
    expect(r?.session.systemPrompt).toBe('sys');
    expect(r?.session.totalDurationMs).toBe(900);
    expect(r?.pending).toBe(false);
    db.close();
  });

  it('add-mission-control：primaryModel / costSource / durationSource / event.model 回读', () => {
    const db = newDb();
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status,
         message_count, event_count, token_total, cost_usd, data_source, source_path,
         total_duration_ms, is_subagent, detail_loaded, primary_model, cost_source, duration_source)
       VALUES ('s1', 'claude', 'Claude', 't', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z',
         'success', 1, 1, 100, 0.01, 'scan', '/tmp/x.jsonl', 1000, 0, 1,
         'claude-opus-4-8', 'estimated', 'derived')`,
    ).run();
    db.prepare(
      `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms,
         status, actor, tool, model, input_len, output_len)
       VALUES ('s1', 'e1', 1, 'llm', 'implement', 't', '2026-08-01T00:00:00.000Z', 100,
         'success', 'assistant', NULL, 'claude-opus-4-8', 12, 8)`,
    ).run();

    const r = getSessionDetail(db, 's1');
    expect(r?.session.primaryModel).toBe('claude-opus-4-8');
    expect(r?.session.costSource).toBe('estimated');
    expect(r?.session.durationSource).toBe('derived');
    expect(r?.events[0]?.model).toBe('claude-opus-4-8');
    db.close();
  });
});

describe('REQ-008 单 event 下钻', () => {
  it('REQ-008 返回单条完整 event', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, {
      sessionId: 's1', id: 'e1', sequence: 1, inputSummary: 'in', outputSummary: 'out',
    });

    const ev = getEventDetail(db, 's1', 'e1');
    expect(ev?.id).toBe('e1');
    expect(ev?.inputSummary).toBe('in');
    expect(ev).not.toHaveProperty('raw');
    db.close();
  });

  it('REQ-008 includeRaw 从 event_raw 补 raw', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, { sessionId: 's1', id: 'e1', sequence: 1 });
    db.prepare(
      'INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?)',
    ).run('s1', 'e1', 'raw body');

    const ev = getEventDetail(db, 's1', 'e1', true) as (TraceEventRaw | null);
    expect(ev?.raw).toBe('raw body');

    const missing = getEventDetail(db, 's1', 'nope', true);
    expect(missing).toBeNull();
    db.close();
  });
});

describe('REQ-014 系统提示词关联', () => {
  it('REQ-014 返回窗口内 system_prompt_len 最大的行', () => {
    const db = newDb();
    const insert = db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at, system_prompt, system_prompt_len)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('r1', 'GET', 'u', 'h', '2026-08-01T00:00:00.000Z', 'short', 10);
    insert.run('r2', 'GET', 'u', 'h', '2026-08-01T00:01:00.000Z', 'longest prompt', 100);
    insert.run('r3', 'GET', 'u', 'h', '2026-08-01T00:02:00.000Z', 'medium', 50);
    insert.run('r4', 'GET', 'u', 'h', '2026-08-02T00:00:00.000Z', 'outside', 999);

    const got = getSystemPromptForSession(
      db,
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T01:00:00.000Z',
    );
    expect(got).toBe('longest prompt');

    const none = getSystemPromptForSession(db, '2020-01-01T00:00:00.000Z', '2020-01-01T01:00:00.000Z');
    expect(none).toBeNull();
    db.close();
  });
});

describe('REQ-015 proxy 列表', () => {
  it('REQ-015 排除 4 个 body 列 + systemPrompt + requestHeaders', () => {
    const db = newDb();
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, request_headers, request_body, response_body, raw_request_body, raw_response_body, system_prompt, system_prompt_len, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'req-1', 'POST', 'https://api.example.com', 'api.example.com',
      '{"a":"b"}', 'req body', 'resp body', 'raw req', 'raw resp', 'sys prompt', 10,
      '2026-08-01T00:00:00.000Z',
    );

    const r = listProxyRequests(db, {});
    expect(r.items).toHaveLength(1);
    const item = r.items[0] as Record<string, unknown>;
    for (const col of [
      'requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody',
      'systemPrompt', 'requestHeaders',
    ]) {
      expect(item).not.toHaveProperty(col);
    }
    expect(item.hasSystemPrompt).toBe(true);
    expect(item.requestId).toBe('req-1');
    expect(item.hostname).toBe('api.example.com');
    db.close();
  });

  it('REQ-015 hostname 过滤 + cursor 分页', () => {
    const db = newDb();
    const insert = db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('r1', 'GET', 'u', 'a.example.com', '2026-08-01T00:00:00.000Z');
    insert.run('r2', 'GET', 'u', 'b.example.com', '2026-08-01T00:01:00.000Z');
    insert.run('r3', 'GET', 'u', 'b.example.com', '2026-08-01T00:02:00.000Z');

    const page1 = listProxyRequests(db, { hostname: 'b.example.com', limit: 1 });
    expect(page1.items.map((i) => i.requestId)).toEqual(['r3']);
    expect(page1.hasMore).toBe(true);

    const page2 = listProxyRequests(db, {
      hostname: 'b.example.com', limit: 1, cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items.map((i) => i.requestId)).toEqual(['r2']);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
    db.close();
  });
});
