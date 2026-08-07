import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from '../storage/schema.js';
import { runContextDiff } from './context-diff-service.js';

type Db = InstanceType<typeof Database>;

const DB_INSTANCES: Db[] = [];

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  DB_INSTANCES.push(db);
  return db;
}

afterEach(() => {
  while (DB_INSTANCES.length > 0) {
    const db = DB_INSTANCES.pop()!;
    db.close();
  }
});

interface ProxyOver {
  requestId: string;
  startedAt: string;
  captureGroupId?: string | null;
  requestFormat?: string;
  model?: string | null;
  parsedSessionId?: string | null;
  requestBody?: string | null;
  inputTokens?: number | null;
  parserRoute?: string | null;
}

function insertProxy(db: Db, over: ProxyOver): number {
  const r = db
    .prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at,
         capture_group_id, request_format, model, parsed_session_id, request_body, input_tokens, parser_route)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      over.requestId,
      'POST',
      'https://api.anthropic.com',
      'api.anthropic.com',
      over.startedAt,
      over.captureGroupId ?? null,
      over.requestFormat ?? 'unknown',
      over.model ?? null,
      over.parsedSessionId ?? null,
      over.requestBody ?? null,
      over.inputTokens ?? null,
      over.parserRoute ?? null,
    );
  return Number(r.lastInsertRowid);
}

function bodyWith(messages: unknown[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'claude-3-5-sonnet', system: 'be helpful', messages, ...over });
}

const ANTHROPIC_BASE = bodyWith([{ role: 'user', content: 'hello' }]);
const ANTHROPIC_TARGET = bodyWith([
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'done' },
]);

describe('context-diff-service: exact automatic pairing', () => {
  it('selects the nearest same parsed-session predecessor as exact', async () => {
    const db = newDb();
    insertProxy(db, {
      requestId: 'b1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: 'sess-1', requestBody: ANTHROPIC_BASE, inputTokens: 10,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: 'sess-1', requestBody: ANTHROPIC_TARGET, inputTokens: 20,
    });

    const result = await runContextDiff(db, { targetId: tid, base: 'previous' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pairing.confidence).toBe('exact');
    expect(result.value.pairing.warnings).toHaveLength(0);
    expect(result.value.base.id).toBeLessThan(result.value.target.id);
    expect(result.value.growth.inputTokenDelta).toBe(10);
  });
});

describe('context-diff-service: capture-group fallback', () => {
  it('falls back to capture group when no parsed session exists', async () => {
    const db = newDb();
    insertProxy(db, {
      requestId: 'b1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_BASE,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_TARGET,
    });

    const result = await runContextDiff(db, { targetId: tid, base: 'previous' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pairing.confidence).toBe('capture_group');
  });

  it('does not pair across a model mismatch', async () => {
    const db = newDb();
    insertProxy(db, {
      requestId: 'b1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_BASE,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-7-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_TARGET,
    });

    const result = await runContextDiff(db, { targetId: tid, base: 'previous' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
    expect(result.error.details).toEqual({ reason: 'pairing_unavailable' });
  });

  it('rejects automatic pairing across conflicting known sessions', async () => {
    const db = newDb();
    insertProxy(db, {
      requestId: 'b1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: 'sess-A', requestBody: ANTHROPIC_BASE,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: 'sess-B', requestBody: ANTHROPIC_TARGET,
    });

    const result = await runContextDiff(db, { targetId: tid, base: 'previous' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
  });
});

describe('context-diff-service: manual pairing', () => {
  it('preserves base→target order, labels manual and returns mismatch warnings', async () => {
    const db = newDb();
    const bid = insertProxy(db, {
      requestId: 'base', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'openai_chat', model: 'gpt-4o', parsedSessionId: 's1',
      requestBody: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const tid = insertProxy(db, {
      requestId: 'target', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g2',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet', parsedSessionId: 's2',
      requestBody: ANTHROPIC_TARGET,
    });

    const result = await runContextDiff(db, { targetId: tid, base: bid });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pairing.confidence).toBe('manual');
    expect(result.value.base.id).toBe(bid);
    expect(result.value.target.id).toBe(tid);
    expect(result.value.pairing.warnings.length).toBeGreaterThanOrEqual(3);
    expect(result.value.base.requestFormat).toBe('openai_chat');
    expect(result.value.target.requestFormat).toBe('anthropic_messages');
  });

  it('rejects same base and target with BAD_REQUEST', async () => {
    const db = newDb();
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_TARGET,
    });
    const result = await runContextDiff(db, { targetId: tid, base: tid });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BAD_REQUEST');
  });

  it('returns PROXY_REQUEST_NOT_FOUND for a missing base with role=base', async () => {
    const db = newDb();
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_TARGET,
    });
    const result = await runContextDiff(db, { targetId: tid, base: 9999 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROXY_REQUEST_NOT_FOUND');
    expect(result.error.details).toEqual({ role: 'base' });
  });
});

describe('context-diff-service: validation and unsupported sources', () => {
  it('returns BAD_REQUEST for an invalid target id', async () => {
    const db = newDb();
    const result = await runContextDiff(db, { targetId: -5, base: 'previous' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BAD_REQUEST');
  });

  it('returns PROXY_REQUEST_NOT_FOUND when the target does not exist', async () => {
    const db = newDb();
    const result = await runContextDiff(db, { targetId: 424242, base: 'previous' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROXY_REQUEST_NOT_FOUND');
    expect(result.error.details).toEqual({ role: 'target' });
  });

  it('returns CONTEXT_DIFF_UNSUPPORTED when the manual base body is malformed', async () => {
    const db = newDb();
    const bid = insertProxy(db, {
      requestId: 'bad-base', startedAt: '2026-08-01T00:00:01Z',
      requestFormat: 'anthropic_messages', requestBody: 'not json',
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z',
      requestFormat: 'anthropic_messages', requestBody: ANTHROPIC_TARGET,
    });
    const result = await runContextDiff(db, { targetId: tid, base: bid });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNSUPPORTED');
    expect(result.error.details).toEqual({ role: 'base', reason: 'invalid_json' });
  });

  it('returns CONTEXT_DIFF_UNSUPPORTED for an unknown-format manual source', async () => {
    const db = newDb();
    const bid = insertProxy(db, {
      requestId: 'base', startedAt: '2026-08-01T00:00:01Z',
      requestFormat: 'unknown', requestBody: bodyWith([{ role: 'user', content: 'hi' }]),
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z',
      requestFormat: 'anthropic_messages', requestBody: ANTHROPIC_TARGET,
    });
    const result = await runContextDiff(db, { targetId: tid, base: bid });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNSUPPORTED');
    expect(result.error.details.reason).toBe('unknown_format');
  });

  it('returns CONTEXT_DIFF_UNSUPPORTED for a missing desensitized body', async () => {
    const db = newDb();
    const bid = insertProxy(db, {
      requestId: 'base', startedAt: '2026-08-01T00:00:01Z',
      requestFormat: 'anthropic_messages', requestBody: ANTHROPIC_BASE,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:01Z',
      requestFormat: 'anthropic_messages', requestBody: null,
    });
    const result = await runContextDiff(db, { targetId: tid, base: bid });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNSUPPORTED');
    expect(result.error.details.reason).toBe('desensitized_body_missing');
  });
});

describe('context-diff-service: two-row read and raw-column isolation (task 5.12)', () => {
  it('reads exactly two bodies and never selects raw columns', async () => {
    const db = newDb();
    const prepared: string[] = [];
    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      prepared.push(sql);
      return originalPrepare(sql);
    }) as typeof db.prepare;

    insertProxy(db, {
      requestId: 'b1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_BASE,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_TARGET,
    });

    const result = await runContextDiff(db, { targetId: tid, base: 'previous' });
    expect(result.ok).toBe(true);

    const proxySelects = prepared.filter((s) => s.includes('FROM proxy_requests'));
    // Exactly two body-bearing proxy reads: target read + capture-group predecessor.
    const bodyReads = proxySelects.filter((s) => s.includes('request_body')).length;
    expect(bodyReads).toBe(2);
    // Raw columns are never selected.
    const rawHits = proxySelects.filter(
      (s) => s.includes('raw_request_body') || s.includes('raw_response_body'),
    ).length;
    expect(rawHits).toBe(0);
  });
});
