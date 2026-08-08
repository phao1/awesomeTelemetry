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
  findCaptureGroupPredecessor,
  findExactSessionPredecessor,
  getEventDetail,
  getProxyRequestById,
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

function insertProxyRow(
  db: Db,
  over: {
    requestId: string;
    startedAt: string;
    captureGroupId?: string | null;
    requestFormat?: string;
    model?: string | null;
    parsedSessionId?: string | null;
    requestBody?: string | null;
    inputTokens?: number | null;
    parserRoute?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at,
       capture_group_id, request_format, model, parsed_session_id, request_body, input_tokens, parser_route)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    over.requestId,
    'POST',
    'https://api.example.com',
    'api.example.com',
    over.startedAt,
    over.captureGroupId ?? null,
    over.requestFormat ?? 'unknown',
    over.model ?? null,
    over.parsedSessionId ?? null,
    over.requestBody ?? null,
    over.inputTokens ?? null,
    over.parserRoute ?? null,
  );
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
      // 2026-08-08 起 BASE_SESSION.updatedAt 的固定日期（08-01）落在 7d 窗口外，
      // 使该组合过滤断言随日期漂移而失败——改为相对 now，断言本身不变。
      updatedAt: new Date(now - 3600_000).toISOString(),
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

describe('v6 capture_group_id / request_format 元数据映射（§2.4/§2.5）', () => {
  it('列表项含 captureGroupId/requestFormat，历史行 null/unknown，排除项保持', () => {
    const db = newDb();
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, request_headers, request_body,
         response_body, raw_request_body, raw_response_body, system_prompt, system_prompt_len, started_at,
         capture_group_id, request_format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'req-new', 'POST', 'https://api.example.com', 'api.example.com',
      '{"a":"b"}', 'req body', 'resp body', 'raw req', 'raw resp', 'sys prompt', 10,
      '2026-08-01T00:00:00.000Z', 'group-1', 'anthropic_messages',
    );
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at)
       VALUES ('req-hist', 'POST', 'https://h', 'h', '2026-08-01T00:00:01.000Z')`,
    ).run();

    const r = listProxyRequests(db, {});
    expect(r.items).toHaveLength(2);

    const byId = new Map(r.items.map((i) => [i.requestId, i]));
    expect(byId.get('req-new')?.captureGroupId).toBe('group-1');
    expect(byId.get('req-new')?.requestFormat).toBe('anthropic_messages');
    expect(byId.get('req-hist')?.captureGroupId).toBeNull();
    expect(byId.get('req-hist')?.requestFormat).toBe('unknown');

    // 列表仍排除 4 个 body 列 + systemPrompt + requestHeaders
    const item = r.items[0] as Record<string, unknown>;
    for (const col of [
      'requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody',
      'systemPrompt', 'requestHeaders',
    ]) {
      expect(item).not.toHaveProperty(col);
    }
    db.close();
  });

  it('完整行映射：getProxyRequestById 返回 captureGroupId/requestFormat', () => {
    const db = newDb();
    insertProxyRow(db, {
      requestId: 'req-full',
      startedAt: '2026-08-01T00:00:00.000Z',
      captureGroupId: 'group-9',
      requestFormat: 'openai_responses',
      model: 'gpt-4o',
      parsedSessionId: 'sess-9',
      requestBody: '{"input":[]}',
    });

    const row = db
      .prepare('SELECT id FROM proxy_requests WHERE request_id = ?')
      .get('req-full') as { id: number };
    const full = getProxyRequestById(db, row.id);
    expect(full).not.toBeNull();
    expect(full?.captureGroupId).toBe('group-9');
    expect(full?.requestFormat).toBe('openai_responses');
    expect(full?.requestBody).toBe('{"input":[]}');
    db.close();
  });
});

describe('design D4 前驱查询（§2.6/§2.7）', () => {
  it('exact-session：同 session + 同 format 的最近更早行，过滤 NULL session 与异构', () => {
    const db = newDb();
    insertProxyRow(db, {
      requestId: 'r0', startedAt: '2026-08-01T00:00:00.000Z',
      parsedSessionId: null, requestFormat: 'anthropic_messages',
    });
    insertProxyRow(db, {
      requestId: 'r1', startedAt: '2026-08-01T00:00:01.000Z',
      parsedSessionId: 's1', requestFormat: 'anthropic_messages', requestBody: '{"a":1}',
    });
    insertProxyRow(db, {
      requestId: 'r2', startedAt: '2026-08-01T00:00:02.000Z',
      parsedSessionId: 's1', requestFormat: 'openai_chat',
    });
    insertProxyRow(db, {
      requestId: 'r3', startedAt: '2026-08-01T00:00:03.000Z',
      parsedSessionId: 's1', requestFormat: 'anthropic_messages', requestBody: '{"b":2}',
    });
    insertProxyRow(db, {
      requestId: 'r4', startedAt: '2026-08-01T00:00:04.000Z',
      parsedSessionId: 's2', requestFormat: 'anthropic_messages',
    });
    insertProxyRow(db, {
      requestId: 'r5', startedAt: '2026-08-01T00:00:05.000Z',
      parsedSessionId: 's1', requestFormat: 'anthropic_messages',
    });
    const target = db
      .prepare('SELECT id FROM proxy_requests WHERE request_id = ?')
      .get('r5') as { id: number };

    const exact = findExactSessionPredecessor(db, 's1', 'anthropic_messages', target.id);
    expect(exact?.requestId).toBe('r3');
    expect(exact?.requestBody).toBe('{"b":2}');
    // 异构 format 各自命中最近更早行
    const chat = findExactSessionPredecessor(db, 's1', 'openai_chat', target.id);
    expect(chat?.requestId).toBe('r2');
    // 其他 session
    const other = findExactSessionPredecessor(db, 's2', 'anthropic_messages', target.id);
    expect(other?.requestId).toBe('r4');
    // NULL parsed_session_id 的行永远不会成为 exact-session 候选
    const nullSession = findExactSessionPredecessor(db, 's1', 'anthropic_messages', target.id);
    expect(nullSession?.requestId).not.toBe('r0');
    // 前驱行只含显式列，绝不带 raw 字段
    expect(exact).not.toHaveProperty('rawRequestBody');
    expect(exact).not.toHaveProperty('rawResponseBody');
    db.close();
  });

  it('capture-group：同组 + 同 format + 同 model 的最近更早行', () => {
    const db = newDb();
    insertProxyRow(db, {
      requestId: 'g1', startedAt: '2026-08-01T00:00:00.000Z',
      captureGroupId: 'cg1', requestFormat: 'anthropic_messages', model: null,
    });
    insertProxyRow(db, {
      requestId: 'g2', startedAt: '2026-08-01T00:00:01.000Z',
      captureGroupId: 'cg1', requestFormat: 'anthropic_messages', model: 'claude-3',
    });
    insertProxyRow(db, {
      requestId: 'g3', startedAt: '2026-08-01T00:00:02.000Z',
      captureGroupId: 'cg1', requestFormat: 'openai_chat', model: 'claude-3',
    });
    insertProxyRow(db, {
      requestId: 'g4', startedAt: '2026-08-01T00:00:03.000Z',
      captureGroupId: 'cg1', requestFormat: 'anthropic_messages', model: 'claude-3',
      requestBody: '{"m":1}',
    });
    insertProxyRow(db, {
      requestId: 'g5', startedAt: '2026-08-01T00:00:04.000Z',
      captureGroupId: 'cg1', requestFormat: 'anthropic_messages', model: 'claude-3',
    });
    const target = db
      .prepare('SELECT id FROM proxy_requests WHERE request_id = ?')
      .get('g5') as { id: number };

    const pred = findCaptureGroupPredecessor(db, 'cg1', 'anthropic_messages', 'claude-3', target.id);
    expect(pred?.requestId).toBe('g4');
    expect(pred?.requestBody).toBe('{"m":1}');
    // 异构 format
    const chat = findCaptureGroupPredecessor(db, 'cg1', 'openai_chat', 'claude-3', target.id);
    expect(chat?.requestId).toBe('g3');
    // model 不匹配 → 无候选
    const mismatch = findCaptureGroupPredecessor(db, 'cg1', 'anthropic_messages', 'other-model', target.id);
    expect(mismatch).toBeNull();
    // 其他组 → 无候选
    const otherGroup = findCaptureGroupPredecessor(db, 'cg2', 'anthropic_messages', 'claude-3', target.id);
    expect(otherGroup).toBeNull();
    db.close();
  });

  it('null-safe model 相等：NULL 只匹配 NULL，非 NULL 只匹配同值', () => {
    const db = newDb();
    insertProxyRow(db, {
      requestId: 'n1', startedAt: '2026-08-01T00:00:00.000Z',
      captureGroupId: 'cg', requestFormat: 'anthropic_messages', model: null,
    });
    insertProxyRow(db, {
      requestId: 'n2', startedAt: '2026-08-01T00:00:01.000Z',
      captureGroupId: 'cg', requestFormat: 'anthropic_messages', model: 'gpt-4o',
    });
    insertProxyRow(db, {
      requestId: 'n3', startedAt: '2026-08-01T00:00:02.000Z',
      captureGroupId: 'cg', requestFormat: 'anthropic_messages', model: null,
    });
    insertProxyRow(db, {
      requestId: 'n4', startedAt: '2026-08-01T00:00:03.000Z',
      captureGroupId: 'cg', requestFormat: 'anthropic_messages', model: 'gpt-4o',
    });
    const target = db
      .prepare('SELECT id FROM proxy_requests WHERE request_id = ?')
      .get('n4') as { id: number };

    const nullPred = findCaptureGroupPredecessor(db, 'cg', 'anthropic_messages', null, target.id);
    expect(nullPred?.requestId).toBe('n3');
    const namedPred = findCaptureGroupPredecessor(db, 'cg', 'anthropic_messages', 'gpt-4o', target.id);
    expect(namedPred?.requestId).toBe('n2');
    db.close();
  });

  it('已知 session 冲突数据：候选照常返回，冲突可由 parsedSessionId 检测（服务层拒绝）', () => {
    const db = newDb();
    insertProxyRow(db, {
      requestId: 'c1', startedAt: '2026-08-01T00:00:00.000Z',
      captureGroupId: 'cg', requestFormat: 'anthropic_messages', model: 'm', parsedSessionId: 'sA',
    });
    insertProxyRow(db, {
      requestId: 'c2', startedAt: '2026-08-01T00:00:01.000Z',
      captureGroupId: 'cg', requestFormat: 'anthropic_messages', model: 'm', parsedSessionId: 'sB',
    });
    const target = db
      .prepare('SELECT id FROM proxy_requests WHERE request_id = ?')
      .get('c2') as { id: number };

    // 目标 sB，候选 c1 的 session 是 sA：存储层返回候选，调用方（T05 服务）
    // 以“双方非空且不同”拒绝自动配对（design D4 step 3）。
    const pred = findCaptureGroupPredecessor(db, 'cg', 'anthropic_messages', 'm', target.id);
    expect(pred?.requestId).toBe('c1');
    expect(pred?.parsedSessionId).toBe('sA');
    expect(pred?.parsedSessionId).not.toBe('sB');
    db.close();
  });

  it('10,000 行 capture group：返回最近更早行，无前驱返回 null', () => {
    const db = newDb();
    const insert = db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at,
         capture_group_id, request_format, model, parsed_session_id, request_body)
       VALUES (?, 'POST', 'https://h', 'h', ?, 'cg-big', 'anthropic_messages', NULL, NULL, ?)`,
    );
    const tx = db.transaction(() => {
      for (let i = 1; i <= 10_000; i += 1) {
        insert.run(
          `bulk-${i}`,
          new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
          `{"body":${i}}`,
        );
      }
      // 一条异构 format 行夹在末尾（id 10001），不应干扰 anthropic_messages 的最近更早
      insert.run(
        'bulk-other',
        new Date(Date.UTC(2026, 7, 1, 0, 1, 0)).toISOString(),
        '{}',
      );
    });
    tx();

    // 异构行 request_format 为 openai_chat，单独更新以证明跨 format 过滤
    db.prepare(
      `UPDATE proxy_requests SET request_format = 'openai_chat' WHERE request_id = 'bulk-other'`,
    ).run();

    const target = db
      .prepare('SELECT id FROM proxy_requests WHERE request_id = ?')
      .get('bulk-other') as { id: number };
    expect(target.id).toBe(10_001);

    const pred = findCaptureGroupPredecessor(db, 'cg-big', 'anthropic_messages', null, target.id);
    expect(pred?.id).toBe(10_000);
    expect(pred?.requestId).toBe('bulk-10000');
    expect(pred?.requestBody).toBe('{"body":10000}');

    // 无更早行
    const first = findCaptureGroupPredecessor(db, 'cg-big', 'anthropic_messages', null, 1);
    expect(first).toBeNull();

    // 10k 行场景下 exact-session 无候选（全部 parsed_session_id 为 NULL）
    const exact = findExactSessionPredecessor(db, 's1', 'anthropic_messages', target.id);
    expect(exact).toBeNull();
    db.close();
  });
});
