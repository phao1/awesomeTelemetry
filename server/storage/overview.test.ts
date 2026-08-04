import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { AgentOverviewRow, ProviderKey } from '../../src/core/trace-types.js';
import { getAgentOverview } from './overview.js';
import { initSchema } from './schema.js';

type Db = InstanceType<typeof Database>;

interface CountableStatement {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown;
  iterate: (...args: unknown[]) => unknown;
}

function withSqlCounter(db: Db): { count: () => number; reset: () => void } {
  let executions = 0;
  const original = db.prepare.bind(db);
  const patched = ((sql: string) => {
    const stmt = original(sql) as CountableStatement;
    for (const method of ['run', 'get', 'all', 'iterate'] as const) {
      const originalMethod = stmt[method].bind(stmt);
      stmt[method] = ((...args: unknown[]) => {
        executions += 1;
        return originalMethod(...args);
      }) as never;
    }
    return stmt;
  }) as unknown as typeof db.prepare;
  (db as unknown as { prepare: typeof db.prepare }).prepare = patched;
  return {
    count: () => executions,
    reset: () => {
      executions = 0;
    },
  };
}

function insertSession(
  db: Db,
  id: string,
  over: {
    provider?: ProviderKey;
    sourceAgent?: string;
    updatedAt?: string;
    eventCount?: number;
    tokenInput?: number;
    tokenOutput?: number;
    tokenTotal?: number;
    costUsd?: number;
    totalDurationMs?: number;
    dataSource?: 'scan' | 'proxy';
  } = {},
): void {
  db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, cwd, message_count, event_count, token_input, token_output, token_reasoning, token_cache_read, token_cache_write, token_total, cost_usd, system_prompt, source_path, data_source, total_duration_ms, is_subagent, detail_loaded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    over.provider ?? 'codex',
    over.sourceAgent ?? 'Codex',
    '',
    '2026-08-01T00:00:00.000Z',
    over.updatedAt ?? '2026-08-01T00:01:00.000Z',
    'success',
    null,
    0,
    over.eventCount ?? 0,
    over.tokenInput ?? 0,
    over.tokenOutput ?? 0,
    0,
    0,
    0,
    over.tokenTotal ?? 0,
    over.costUsd ?? 0,
    null,
    '/tmp/x.jsonl',
    over.dataSource ?? 'scan',
    over.totalDurationMs ?? 0,
    0,
    0,
  );
}

function insertEvent(
  db: Db,
  over: {
    sessionId: string;
    id: string;
    sequence: number;
    phase?: string;
    status?: string;
    tool?: string | null;
    durationMs?: number;
  },
): void {
  db.prepare(
    `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms, status, actor, tool, input_summary, output_summary, tokens_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    over.sessionId,
    over.id,
    over.sequence,
    'llm',
    over.phase ?? 'implement',
    '',
    '2026-08-01T00:00:00.000Z',
    over.durationMs ?? 10,
    over.status ?? 'success',
    'assistant',
    over.tool ?? null,
    null,
    null,
    null,
    null,
  );
}

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function rowMap(rows: AgentOverviewRow[]): Map<string, AgentOverviewRow> {
  return new Map(rows.map((r) => [`${r.provider}/${r.sourceAgent}`, r]));
}

describe('REQ-009 Agent Overview 服务端聚合', () => {
  it('REQ-009 冷路径只发两条 SQL 且 cached=false', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, { sessionId: 's1', id: 'e1', sequence: 1 });

    const counter = withSqlCounter(db);
    const r = getAgentOverview(db, 'scan');

    expect(counter.count()).toBe(2);
    expect(r.cached).toBe(false);
    expect(typeof r.stamp).toBe('string');
    expect(r.rows).toHaveLength(1);
    db.close();
  });

  it('REQ-009 stamp 未变时命中缓存，只发 1 条 SQL', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, { sessionId: 's1', id: 'e1', sequence: 1 });

    const counter = withSqlCounter(db);
    const first = getAgentOverview(db, 'scan');
    counter.reset();

    const second = getAgentOverview(db, 'scan');
    expect(counter.count()).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.rows).toEqual(first.rows);
    expect(second.stamp).toBe(first.stamp);
    db.close();
  });

  it('REQ-009 stamp 变化后重新聚合', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, { sessionId: 's1', id: 'e1', sequence: 1 });

    const counter = withSqlCounter(db);
    const first = getAgentOverview(db, 'scan');
    expect(first.cached).toBe(false);
    insertSession(db, 's2', { updatedAt: '2026-08-02T00:00:00.000Z' });
    counter.reset();

    const second = getAgentOverview(db, 'scan');
    expect(counter.count()).toBe(2); // 本次聚合只发两条 SQL
    expect(second.cached).toBe(false);
    expect(second.rows[0]?.sessionCount).toBe(2);
    db.close();
  });

  it('REQ-009 会话级与事件级聚合数值正确合并', () => {
    const db = newDb();
    insertSession(db, 's1', {
      provider: 'codex', sourceAgent: 'Codex', eventCount: 3, tokenInput: 10,
      tokenOutput: 20, tokenTotal: 30, costUsd: 0.05, totalDurationMs: 3000,
    });
    insertEvent(db, {
      sessionId: 's1', id: 'e1', sequence: 1, phase: 'implement', status: 'error',
      tool: 'Bash', durationMs: 100,
    });
    insertEvent(db, { sessionId: 's1', id: 'e2', sequence: 2, phase: 'verify' });
    insertEvent(db, { sessionId: 's1', id: 'e3', sequence: 3, phase: 'implement' });

    insertSession(db, 's2', {
      provider: 'claude', sourceAgent: 'Claude', eventCount: 2, tokenInput: 5,
      tokenOutput: 5, tokenTotal: 10, costUsd: 0.01, totalDurationMs: 1000,
    });
    insertEvent(db, { sessionId: 's2', id: 'e4', sequence: 1, phase: 'debug' });
    insertEvent(db, { sessionId: 's2', id: 'e5', sequence: 2, phase: 'implement' });

    const r = getAgentOverview(db, 'scan');
    const rows = rowMap(r.rows);

    const codex = rows.get('codex/Codex');
    expect(codex?.sessionCount).toBe(1);
    expect(codex?.eventCount).toBe(3);
    expect(codex?.tokenInput).toBe(10);
    expect(codex?.tokenOutput).toBe(20);
    expect(codex?.tokenTotal).toBe(30);
    expect(codex?.costUsd).toBeCloseTo(0.05);
    expect(codex?.avgWallClockMs).toBeCloseTo(3000);
    expect(codex?.avgToolDurationMs).toBeCloseTo(100);
    expect(codex?.errorRate).toBeCloseTo(1 / 3);
    expect(codex?.verificationCoverage).toBe(1); // 单会话 0|1
    expect(codex?.debugEntryRate).toBe(0);

    const claude = rows.get('claude/Claude');
    expect(claude?.sessionCount).toBe(1);
    expect(claude?.eventCount).toBe(2);
    expect(claude?.errorRate).toBe(0);
    expect(claude?.verificationCoverage).toBe(0);
    expect(claude?.debugEntryRate).toBe(1); // 单会话 0|1
    db.close();
  });
});
