import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type {
  SessionIndexEntry,
  TraceEvent,
  TraceMetrics,
  TraceSession,
} from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import {
  deleteSession,
  upsertEvents,
  upsertMetrics,
  upsertSessionFromIndex,
  upsertSessionFromTrace,
} from './writers.js';

type Db = InstanceType<typeof Database>;

interface CountableStatement {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown;
  iterate: (...args: unknown[]) => unknown;
}

function withSqlCounter(db: Db): {
  countExecutions: () => number;
  countInserts: () => number;
  countDeletes: () => number;
  reset: () => void;
} {
  let executions = 0;
  let inserts = 0;
  let deletes = 0;

  const original = db.prepare.bind(db);
  const patched = ((sql: string) => {
    const stmt = original(sql) as CountableStatement;
    for (const method of ['run', 'get', 'all', 'iterate'] as const) {
      const originalMethod = stmt[method].bind(stmt);
      stmt[method] = ((...args: unknown[]) => {
        executions += 1;
        const head = sql.trimStart();
        if (head.startsWith('INSERT')) {
          inserts += 1;
        }
        if (head.startsWith('DELETE')) {
          deletes += 1;
        }
        return originalMethod(...args);
      }) as never;
    }
    return stmt;
  }) as unknown as typeof db.prepare;

  (db as unknown as { prepare: typeof db.prepare }).prepare = patched;
  return {
    countExecutions: () => executions,
    countInserts: () => inserts,
    countDeletes: () => deletes,
    reset: () => {
      executions = 0;
      inserts = 0;
      deletes = 0;
    },
  };
}

function makeSession(id: string): TraceSession {
  return {
    id,
    provider: 'codex',
    sourceAgent: 'Codex',
    title: 'test session',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 1,
    eventCount: 0,
    tokenUsage: { input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, total: 38 },
    costUsd: 0.01,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: '/tmp/session.jsonl',
    totalDurationMs: 1000,
    isSubagent: false,
  };
}

function makeIndexEntry(id: string): SessionIndexEntry {
  return {
    id,
    provider: 'codex',
    sourceAgent: 'Codex',
    title: 'index title',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: null,
    eventCount: 0,
    messageCount: 1,
    tokenTotal: 38,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: '/tmp/session.jsonl',
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  };
}

function makeEvent(id: string, sequence: number): TraceEvent {
  return {
    id,
    sessionId: 's1',
    sequence,
    kind: 'llm',
    phase: 'implement',
    title: `event ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
  };
}

function makeMetrics(): TraceMetrics {
  return {
    totalSteps: 3,
    durationByPhase: {
      understand: 0,
      plan: 0,
      implement: 300,
      debug: 0,
      verify: 0,
      report: 0,
    },
    toolCallCount: 2,
    verificationPresent: true,
    calcVersion: 1,
    avgToolDurationMs: 150,
    verificationCoverage: 1,
    errorRate: 0,
    enteredDebug: false,
    tokensPerStep: 20,
    costUsd: 0.01,
  };
}

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

describe('REQ-010 会话写入 upsert', () => {
  it('REQ-010 upsertSessionFromIndex 重复调用只保留一行且更新字段', () => {
    const db = newDb();

    upsertSessionFromIndex(db, makeIndexEntry('s1'));
    upsertSessionFromIndex(db, { ...makeIndexEntry('s1'), title: 'updated' });

    const rows = db
      .prepare('SELECT id, title FROM sessions WHERE id = ?')
      .all('s1') as Array<{ id: string; title: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('updated');
    db.close();
  });

  it('REQ-010 upsertSessionFromTrace 写入完整 token 明细', () => {
    const db = newDb();

    upsertSessionFromTrace(db, makeSession('s1'));

    const row = db
      .prepare(
        'SELECT token_input, token_output, token_reasoning, token_cache_read, token_cache_write, token_total FROM sessions WHERE id = ?',
      )
      .get('s1') as Record<string, number>;
    expect(row.token_input).toBe(10);
    expect(row.token_output).toBe(20);
    expect(row.token_reasoning).toBe(5);
    expect(row.token_cache_read).toBe(3);
    expect(row.token_cache_write).toBe(2);
    expect(row.token_total).toBe(38);
    db.close();
  });
});

describe('REQ-011 事件差分写入', () => {
  it('REQ-011 已有 347 个 event，append 1 个后只产生 1 条 INSERT', () => {
    const db = newDb();
    const counter = withSqlCounter(db);
    upsertSessionFromTrace(db, makeSession('s1'));

    const baseEvents = Array.from({ length: 347 }, (_, i) => makeEvent(`ev-${i + 1}`, i + 1));
    upsertEvents(db, 's1', baseEvents);

    counter.reset();
    upsertEvents(db, 's1', [...baseEvents, makeEvent('ev-348', 348)]);

    const inserts = counter.countInserts();
    const deletes = counter.countDeletes();
    console.log(
      `REQ-011 append: executions=${counter.countExecutions()} inserts=${inserts} deletes=${deletes}`,
    );
    expect(inserts).toBe(1);
    expect(deletes).toBe(0);

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM events WHERE session_id = ?')
      .get('s1') as { c: number };
    expect(count.c).toBe(348);
    db.close();
  });

  it('REQ-011 stale id 被删除，且 event_raw 对应行同步删除', () => {
    const db = newDb();
    const counter = withSqlCounter(db);
    upsertSessionFromTrace(db, makeSession('s1'));
    upsertEvents(db, 's1', [makeEvent('ev-1', 1), makeEvent('ev-2', 2), makeEvent('ev-3', 3)]);
    db.prepare('INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?)').run(
      's1',
      'ev-2',
      'raw data',
    );

    counter.reset();
    upsertEvents(db, 's1', [makeEvent('ev-1', 1), makeEvent('ev-3', 3), makeEvent('ev-4', 4)]);

    expect(counter.countInserts()).toBe(1);
    expect(counter.countDeletes()).toBe(2); // events 一行 + event_raw 一行

    const events = db
      .prepare('SELECT id FROM events WHERE session_id = ? ORDER BY sequence')
      .all('s1') as Array<{ id: string }>;
    expect(events.map((e) => e.id)).toEqual(['ev-1', 'ev-3', 'ev-4']);
    const raw = db
      .prepare('SELECT event_id FROM event_raw WHERE session_id = ?')
      .all('s1') as Array<{ event_id: string }>;
    expect(raw).toHaveLength(0);
    db.close();
  });
});

describe('REQ-012 undefined 写库前转 null', () => {
  it('REQ-012 事件可空字段为 undefined 时落库为 NULL', () => {
    const db = newDb();
    upsertSessionFromTrace(db, makeSession('s1'));

    const event = makeEvent('ev-1', 1);
    upsertEvents(db, 's1', [
      {
        ...event,
        tool: undefined as unknown as string | null,
        error: undefined as unknown as string | null,
        inputSummary: undefined as unknown as string | null,
        outputSummary: undefined as unknown as string | null,
      },
    ]);

    const row = db
      .prepare(
        'SELECT tool, error, input_summary, output_summary, tokens_json FROM events WHERE session_id = ? AND id = ?',
      )
      .get('s1', 'ev-1') as {
      tool: unknown;
      error: unknown;
      input_summary: unknown;
      output_summary: unknown;
      tokens_json: unknown;
    };
    expect(row.tool).toBeNull();
    expect(row.error).toBeNull();
    expect(row.input_summary).toBeNull();
    expect(row.output_summary).toBeNull();
    expect(row.tokens_json).toBe(
      JSON.stringify({ input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2 }),
    );
    db.close();
  });
});

describe('REQ-013 metrics 持久化', () => {
  it('REQ-013 upsertMetrics 写入基础指标、四维指标与 calc_version', () => {
    const db = newDb();
    upsertSessionFromTrace(db, makeSession('s1'));

    upsertMetrics(db, 's1', makeMetrics());

    const row = db
      .prepare(
        'SELECT total_steps, tool_call_count, verification_present, calc_version, avg_tool_duration_ms, verification_coverage, error_rate, entered_debug, tokens_per_step, cost_usd FROM metrics WHERE session_id = ?',
      )
      .get('s1') as Record<string, number>;
    expect(row.total_steps).toBe(3);
    expect(row.tool_call_count).toBe(2);
    expect(row.verification_present).toBe(1);
    expect(row.calc_version).toBe(1);
    expect(row.avg_tool_duration_ms).toBe(150);
    expect(row.verification_coverage).toBe(1);
    expect(row.error_rate).toBe(0);
    expect(row.entered_debug).toBe(0);
    expect(row.tokens_per_step).toBe(20);
    expect(row.cost_usd).toBe(0.01);
    db.close();
  });
});

describe('REQ-016 删除会话', () => {
  it('REQ-016 deleteSession 级联删除 events + event_raw + metrics + sessions + scan_state', () => {
    const db = newDb();
    upsertSessionFromTrace(db, makeSession('s1'));
    upsertEvents(db, 's1', [makeEvent('ev-1', 1), makeEvent('ev-2', 2)]);
    db.prepare('INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?)').run(
      's1',
      'ev-1',
      'raw',
    );
    upsertMetrics(db, 's1', makeMetrics());
    db.prepare(
      'INSERT INTO scan_state (source_path, provider, session_id, file_size, file_mtime_ms, content_hash, byte_offset, last_scan_at, event_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('/tmp/a.jsonl', 'codex', 's1', 100, 1000, 'hash', 100, '2026-08-01T00:00:00.000Z', 2);

    deleteSession(db, 's1');

    const tables = ['events', 'event_raw', 'metrics', 'sessions', 'scan_state'] as const;
    for (const table of tables) {
      const count = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      expect(count.c, `${table} 应为空`).toBe(0);
    }
    db.close();
  });
});
