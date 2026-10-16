import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { initSchema } from '../storage/schema.js';
import { runContextDiff } from './context-diff-service.js';
import { CaptureBodyStore } from './body-store.js';
import { writeCaptureBodies } from './capture-storage.js';
import { decideTraceAssociation } from '../storage/trace-links.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { OriginalDeletionQueue } from './original-deletions.js';

type Db = InstanceType<typeof Database>;

const DB_INSTANCES: Db[] = [];
const SOURCE_DIRECTORIES: string[] = [];

function newDb(verbose?: (sql: string) => void): Db {
  const db = new Database(':memory:', { verbose: verbose === undefined ? undefined : message => verbose(String(message)) });
  initSchema(db);
  DB_INSTANCES.push(db);
  return db;
}

afterEach(async () => {
  while (DB_INSTANCES.length > 0) {
    const db = DB_INSTANCES.pop()!;
    db.close();
  }
  for (const directory of SOURCE_DIRECTORIES.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('original-backed context diff', () => {
  it('rejects an in-flight diff when its already-read base is explicitly deleted before the response', async () => {
    const db = newDb(), directory = await mkdtemp(join(tmpdir(), 'context-deletion-race-')); SOURCE_DIRECTORIES.push(directory);
    const store = await CaptureBodyStore.create(directory), ids: number[] = [];
    for (const [index, body] of [ANTHROPIC_BASE, ANTHROPIC_TARGET].entries()) {
      const id = insertProxy(db, { requestId: 'race-' + index, startedAt: '2026-10-16T00:00:00Z', requestFormat: 'anthropic_messages', requestBody: body });
      const a = store.begin(), b = store.begin(); a.append(Buffer.from(body)); b.append(Buffer.from('{}'));
      const [request, response] = await Promise.all([a.finish(), b.finish()]);
      writeCaptureBodies(db, id, { request, response, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} }); ids.push(id);
    }
    let calls = 0, signal!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { signal = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const work = runContextDiff(db, { targetId: ids[1]!, base: ids[0]! }, async () => { if (++calls === 2) { signal(); await gate; } return store; });
    try {
      await entered; await new OriginalDeletionQueue(db, store).request(ids[0]!, 'race-0'); release();
      const result = await work; expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.error.code).toBe('CONTEXT_DIFF_UNSUPPORTED'); expect(result.error.details).toEqual({ role: 'base', reason: 'original_deleted' }); }
    } finally { release(); await work; }
  });
  it('compares decoded gzip context while retaining encoded original digest and byte provenance', async () => {
    const db = newDb(); const directory = await mkdtemp(join(tmpdir(), 'context-gzip-')); SOURCE_DIRECTORIES.push(directory);
    const store = await CaptureBodyStore.create(directory); const ids: number[] = [], refs = [];
    for (const [index, body] of [bodyWith([{ role: 'user', content: '中文' }]), bodyWith([{ role: 'user', content: '中文' }, { role: 'assistant', content: 'done' }])].entries()) {
      const id = insertProxy(db, { requestId: 'gzip-' + index, startedAt: '2026-10-15T00:00:00Z', requestFormat: 'anthropic_messages', requestBody: 'not a trusted preview' });
      const writer = store.begin(); writer.append(gzipSync(Buffer.from(body))); const ref = await writer.finish(); refs.push(ref); ids.push(id);
      writeCaptureBodies(db, id, { request: ref, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {}, processing: { version: 1, status: 'ok', error: null, contentDecoding: { request: 'gzip', response: 'identity' } } });
    }
    const result = await runContextDiff(db, { targetId: ids[1]!, base: ids[0]! }, async () => store);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.growth.messageDelta).toBe(1);
    expect(result.value.base.bodySha256).toBe(refs[0]!.sha256); expect(result.value.target.bodyBytes).toBe(refs[1]!.bytes);
  });
  it('compares complete originals larger than SQLite previews and hashes those originals', async () => {
    const db = newDb();
    const directory = await mkdtemp(join(tmpdir(), 'context-original-'));
    SOURCE_DIRECTORIES.push(directory);
    const store = await CaptureBodyStore.create(directory);
    const bodies = [
      bodyWith([{ role: 'user', content: '中文😀'.repeat(12_000) }]),
      bodyWith([{ role: 'user', content: '中文😀'.repeat(12_000) }, { role: 'assistant', content: 'finished' }]),
    ];
    const ids: number[] = [];
    const refs = [];
    for (const [index, body] of bodies.entries()) {
      const id = insertProxy(db, { requestId: 'original-' + index, startedAt: '2026-10-15T00:00:00Z', requestFormat: 'anthropic_messages', requestBody: body.slice(0, 100), captureGroupId: 'original-group' });
      const writer = store.begin();
      writer.append(Buffer.from(body));
      const ref = await writer.finish();
      writeCaptureBodies(db, id, { request: ref, response: null, requestPreviewTruncated: true, responsePreviewTruncated: false, responseHeaders: {} });
      ids.push(id);
      refs.push(ref);
    }
    const result = await runContextDiff(db, { targetId: ids[1]!, base: ids[0]! }, async () => store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.noChange).toBe(false);
    expect(result.value.base.bodySha256).toBe(refs[0]!.sha256);
    expect(result.value.target.bodyBytes).toBe(Buffer.byteLength(bodies[1]!));
    expect(result.value.growth.messageDelta).toBe(1);
  });

  it('does not silently substitute a valid preview for an incomplete original', async () => {
    const db = newDb();
    const directory = await mkdtemp(join(tmpdir(), 'context-incomplete-'));
    SOURCE_DIRECTORIES.push(directory);
    const store = await CaptureBodyStore.create(directory);
    const base = insertProxy(db, { requestId: 'b', startedAt: '2026-10-15T00:00:00Z', requestFormat: 'anthropic_messages', requestBody: ANTHROPIC_BASE });
    const target = insertProxy(db, { requestId: 't', startedAt: '2026-10-15T00:00:01Z', requestFormat: 'anthropic_messages', requestBody: ANTHROPIC_TARGET });
    const writer = store.begin();
    writer.append(Buffer.from(ANTHROPIC_TARGET));
    writeCaptureBodies(db, target, { request: await writer.finish(true), response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
    const result = await runContextDiff(db, { targetId: target, base }, async () => store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNSUPPORTED');
    expect(result.error.details).toEqual({ role: 'target', reason: 'capture_incomplete' });
  });
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

function linkRequests(db: Db, ids: number[], key = 'linked-s1'): void {
  cachedStmt(db, "INSERT OR IGNORE INTO sessions (id, provider, source_agent, source_path, started_at, updated_at) VALUES (?, 'claude', 'Claude', '/synthetic', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')").run(key);
  for (const id of ids) decideTraceAssociation(db, id, key, 'confirmed', 'synthetic explicit membership');
}

describe('association-aware previous capture', () => {
  it('keeps concurrent owners separate and orders late inserts by observed time, not SQLite id', async () => {
    const db = newDb();
    const seed = (name: string, time: string) => insertProxy(db, { requestId: name, startedAt: '2026-08-01T00:00:' + time + 'Z', captureGroupId: 'shared-run', requestFormat: 'anthropic_messages', model: 'same-model', requestBody: bodyWith([{ role: 'user', content: name }], { system: name + ' own prompt' }) });
    const first = seed('a-first', '01'); const other = seed('b-concurrent', '02'); const target = seed('a-target', '03');
    const future = seed('a-future', '04'); const late = seed('a-late', '02.500');
    linkRequests(db, [first, target, future, late], 'session-a'); linkRequests(db, [other], 'session-b');
    const unrelatedPrompt = 'unrelated longest prompt'.repeat(1000);
    cachedStmt(db, 'UPDATE proxy_requests SET request_body=?, system_prompt=?, system_prompt_len=? WHERE id=?').run(
      bodyWith([{ role: 'user', content: 'b-concurrent' }], { system: unrelatedPrompt }), unrelatedPrompt, unrelatedPrompt.length, other,
    );
    const result = await runContextDiff(db, { targetId: target, base: 'previous' });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.base.id).toBe(late); expect(result.value.target.id).toBe(target);
    expect(result.value.pairing.confidence).toBe('linked_session');
    expect(result.value.pairing.reason).toContain('session-a');
    expect(result.value.pairing.warnings.join(' ')).toContain('native model call');
    expect(JSON.stringify(result.value.categories)).not.toContain('b-concurrent');
    expect(JSON.stringify(result.value.categories)).toContain('a-late own prompt');
    expect(db.prepare('SELECT system_prompt FROM sessions WHERE id=?').get('session-a')).toEqual({ system_prompt: null });
  });

  it('does not use revoked or multiply owned bases and rejects a multiply owned target', async () => {
    const db = newDb();
    const seed = (id: number) => insertProxy(db, { requestId: 'r' + id, startedAt: '2026-08-01T00:00:0' + id + 'Z', requestFormat: 'anthropic_messages', requestBody: ANTHROPIC_BASE });
    const first = seed(1); const ambiguous = seed(2); const target = seed(3);
    linkRequests(db, [first, ambiguous, target], 'session-a'); linkRequests(db, [ambiguous], 'session-b');
    const result = await runContextDiff(db, { targetId: target, base: 'previous' });
    expect(result.ok).toBe(true); if (result.ok) expect(result.value.base.id).toBe(first);
    decideTraceAssociation(db, first, 'session-a', 'revoked');
    const revoked = await runContextDiff(db, { targetId: target, base: 'previous' });
    expect(revoked.ok).toBe(false); if (!revoked.ok) expect(revoked.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
    linkRequests(db, [target], 'session-b');
    const multiple = await runContextDiff(db, { targetId: target, base: 'previous' });
    expect(multiple.ok).toBe(false); if (!multiple.ok) expect(multiple.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
  });

  it('permits same-session model changes with warnings and keeps explicit cross-session comparison manual', async () => {
    const db = newDb();
    const first = insertProxy(db, { requestId: 'first', startedAt: '2026-08-01T00:00:01Z', requestFormat: 'anthropic_messages', model: 'first-model', requestBody: ANTHROPIC_BASE });
    const target = insertProxy(db, { requestId: 'target', startedAt: '2026-08-01T00:00:02Z', requestFormat: 'anthropic_messages', model: 'new-model', requestBody: ANTHROPIC_TARGET });
    linkRequests(db, [first, target], 'session-a');
    const automatic = await runContextDiff(db, { targetId: target, base: 'previous' });
    expect(automatic.ok).toBe(true); if (automatic.ok) expect(automatic.value.pairing.warnings).toContain('models differ');
    decideTraceAssociation(db, target, 'session-a', 'revoked'); linkRequests(db, [target], 'session-b');
    const before = db.prepare('SELECT total_changes() AS count').get();
    const manual = await runContextDiff(db, { targetId: target, base: first });
    expect(manual.ok).toBe(true); if (manual.ok) {
      expect(manual.value.pairing.confidence).toBe('manual');
      expect(manual.value.pairing.warnings).toContain('linked session memberships differ');
    }
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    cachedStmt(db, "UPDATE trace_associations SET state='candidate' WHERE proxy_id=?").run(target);
    const candidate = await runContextDiff(db, { targetId: target, base: 'previous' });
    expect(candidate.ok).toBe(false); if (!candidate.ok) expect(candidate.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
  });
});

describe('context-diff-service: legacy parsed identity is not membership', () => {
  it('rejects a same parsed-session predecessor without namespaced association evidence', async () => {
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
    expect(result.error.details).toEqual({ reason: 'pairing_unavailable' });
  });
});

describe('context-diff-service: capture group is not membership', () => {
  it('refuses automatic capture-group pairing while preserving explicit manual comparison', async () => {
    const db = newDb();
    const bid = insertProxy(db, {
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTEXT_DIFF_UNAVAILABLE');
    const manual = await runContextDiff(db, { targetId: tid, base: bid });
    expect(manual.ok).toBe(true); if (manual.ok) expect(manual.value.pairing.confidence).toBe('manual');
    expect(db.prepare('SELECT id FROM trace_associations').all()).toEqual([]);
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
    const executed: string[] = [];
    const db = newDb(sql => executed.push(sql));

    const bid = insertProxy(db, {
      requestId: 'b1', startedAt: '2026-08-01T00:00:01Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_BASE,
    });
    const tid = insertProxy(db, {
      requestId: 't1', startedAt: '2026-08-01T00:00:02Z', captureGroupId: 'g1',
      requestFormat: 'anthropic_messages', model: 'claude-3-5-sonnet',
      parsedSessionId: null, requestBody: ANTHROPIC_TARGET,
    });

    linkRequests(db, [bid, tid]);
    executed.length = 0;
    const result = await runContextDiff(db, { targetId: tid, base: 'previous' });
    expect(result.ok).toBe(true);

    const proxySelects = executed.filter((s) => s.includes('FROM proxy_requests'));
    // Exactly two body-bearing reads: target + one metadata-selected linked base.
    const bodyReads = proxySelects.filter((s) => s.includes('request_body')).length;
    expect(bodyReads).toBe(2);
    // Raw columns are never selected.
    const rawHits = proxySelects.filter(
      (s) => s.includes('raw_request_body') || s.includes('raw_response_body'),
    ).length;
    expect(rawHits).toBe(0);
  });
});
