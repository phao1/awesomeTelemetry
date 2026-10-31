import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { LinkedExecutionPage, NativeIdentitySet } from '../src/core/trace-types.js';
import { normalizeClaudeSample } from '../src/adapters/claude-code.js';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import { storeTraceRecord } from '../local-sessions/scanner-utils.js';
import { createAgentObservabilityServer } from './server.js';
import { extractNetworkIdentities } from './proxy/identity-extractor.js';
import { writeCaptureTransport } from './proxy/capture-storage.js';
import { initSchema } from './storage/schema.js';
import { cachedStmt } from './storage/stmt-cache.js';
import { decideTraceAssociation, listTraceIdentities, writeNativeIdentities } from './storage/trace-links.js';

type Db = InstanceType<typeof Database>;
const time = '2026-10-16T00:00:00.000Z';
const resources: Array<{ db: Db; server: Server; directory: string }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    try {
      await new Promise<void>((resolve, reject) => resource.server.close(error => error === undefined ? resolve() : reject(error)));
    } finally { resource.db.close(); rmSync(resource.directory, { recursive: true, force: true }); }
  }
});

interface HttpResult { status: number; headers: IncomingHttpHeaders; text: string }
function call(port: number, path: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Synthetic execution HTTP timeout')));
    req.end();
  });
}

async function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); initSchema(db);
  const directory = mkdtempSync(join(tmpdir(), 'linked-execution-http-'));
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'disabled-native-source'); }
  const server = createAgentObservabilityServer({ db, config, caDirectory: join(directory, 'unused-ca'), userConfigPath: join(directory, 'config.json') });
  resources.push({ db, directory, server });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { db, port, directory };
}

function scan(db: Db, sessionKey = 'scan-a', nativeSession = 'native-a'): void {
  const record = normalizeClaudeSample({ sourceAgent: 'Claude', session: {}, events: [
    { type: 'user', sessionId: nativeSession, timestamp: time, message: { id: 'native-user', content: [{ type: 'text', text: 'run the synthetic task' }] } },
    { type: 'assistant', sessionId: nativeSession, timestamp: time, message: { id: 'native-first-model', content: [{ type: 'text', text: 'inspect a file' }, { type: 'tool_use', id: 'shared-tool-id', name: 'Read', input: { path: 'synthetic.txt' } }] } },
    { type: 'user', sessionId: nativeSession, timestamp: time, message: { content: [{ type: 'tool_result', tool_use_id: 'shared-tool-id', content: 'BODY_ONLY_TOOL_RESULT' }] } },
    { type: 'assistant', sessionId: nativeSession, timestamp: time, message: { id: 'native-final-model', status: 'completed', stop_reason: 'end_turn', content: [{ type: 'text', text: 'completed' }] } },
  ] }, '/synthetic/' + sessionKey);
  storeTraceRecord(db, record, '/synthetic/' + sessionKey, sessionKey);
}

function capture(db: Db, id: number, nativeSession = 'native-a'): void {
  cachedStmt(db, `INSERT INTO proxy_requests (id, request_id, method, url, hostname, started_at, model, request_body, response_body,
    raw_request_body, raw_response_body, system_prompt, system_prompt_len) VALUES (?, ?, 'POST', '/v1/messages', 'synthetic.invalid', ?, 'same-model',
    'BODY_ONLY_REQUEST', 'BODY_ONLY_RESPONSE', 'BODY_ONLY_RAW_REQUEST', 'BODY_ONLY_RAW_RESPONSE', 'BODY_ONLY_SYSTEM', 16)`).run(id, 'request-' + id, time);
  writeNativeIdentities(db, { source: 'proxy', key: String(id) }, extractNetworkIdentities({
    format: 'anthropic_messages', requestHeaders: { 'x-agent-provider': 'claude', 'x-agent-session-id': nativeSession }, requestBody: '{"messages":[]}',
    responseBody: JSON.stringify({ id: 'native-final-model', content: [{ type: 'tool_use', id: 'shared-tool-id', name: 'Read', input: {} }] }),
  }), time);
}

function page(response: HttpResult): LinkedExecutionPage {
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  return JSON.parse(response.text) as LinkedExecutionPage;
}
function apiError(response: HttpResult, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/json');
  expect(JSON.parse(response.text)).toEqual({ error: { code, message: expect.any(String) } });
}

describe('GET session execution: production HTTP and SQLite', () => {
  it('projects session declaration and 100/800/2000ms network offsets separately without source/body reads or mutation', async () => {
    const f = await fixture(); scan(f.db); capture(f.db, 1); capture(f.db, 2);
    writeCaptureTransport(f.db, 1, { version: 1, state: 'completed', error: null,
      statusCode: 200, requestEnded: true, responseEnded: true,
      timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150,
        firstContentMs: 800, completedMs: 2000, firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch',
        contentTimingStatus: 'observed', serverTiming: 'inference;dur=700', serverTimingTruncated: false } });
    const before = f.db.prepare('SELECT total_changes() AS changes').get();
    const response = await call(f.port, '/api/sessions/scan-a/execution');
    const value = page(response);
    expect(value.sessionDurationSource).toBe('derived');
    expect(value.attempts.find(attempt => attempt.request.id === 1)?.transport?.timing).toEqual({
      version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150,
      firstContentMs: 800, completedMs: 2000, firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch',
      contentTimingStatus: 'observed', serverTiming: 'inference;dur=700', serverTimingTruncated: false,
    });
    expect(value.attempts.find(attempt => attempt.request.id === 2)?.transport).toBeNull();
    expect(value.events.find(event => event.id === 'shared-tool-id')?.durationMs).toBe(0);
    expect(response.text).not.toMatch(/"(?:raw|inputSummary|outputSummary|requestBody|responseBody|responseHeaders|systemPrompt)"\s*:/);
    expect(response.text).not.toContain('BODY_ONLY_');
    expect(f.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
  });

  it.each(['measured', 'derived', 'unknown', 'invalid-declaration'])('does not infer per-event timing from session declaration %s', async declared => {
    const f = await fixture(); scan(f.db); capture(f.db, 1);
    f.db.prepare('UPDATE sessions SET duration_source=? WHERE id=?').run(declared, 'scan-a');
    const value = page(await call(f.port, '/api/sessions/scan-a/execution'));
    expect(value.sessionDurationSource).toBe(declared === 'invalid-declaration' ? 'unknown' : declared);
    expect(value.events.every(event => !Object.hasOwn(event, 'durationSource'))).toBe(true);
    expect(value.attempts[0]!.transport).toBeNull();
  });
  it('exposes the actual adapter → storage → HTTP user/model/tool/result/model chain with scoped evidence and no body columns', async () => {
    const f = await fixture(); scan(f.db); capture(f.db, 1);
    const before = f.db.prepare('SELECT total_changes() AS changes').get();
    const response = await call(f.port, '/api/sessions/scan-a/execution');
    const value = page(response);
    expect(value.events.map(event => event.kind)).toEqual(['user_prompt', 'llm', 'tool', 'llm']);
    expect(value.events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(value.events.find(event => event.id === 'shared-tool-id')).toMatchObject({ tool: 'Read', hasInput: true, hasOutput: true, hasRaw: true });
    expect(value.events.at(-1)).toMatchObject({ id: 'native-final-model-1', kind: 'llm', status: 'success', title: 'completed' });
    expect(value.attempts).toHaveLength(1);
    expect(value.attempts[0]!.association).toMatchObject({ sessionKey: 'scan-a', state: 'direct', proxyId: 1 });
    expect(value.attempts[0]!.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'shared-tool-id', namespace: 'protocol:anthropic', kind: 'tool_call', value: 'shared-tool-id', scope: 'native-a' }),
      expect.objectContaining({ eventId: 'native-final-model-1', kind: 'response', value: 'native-final-model', scope: 'native-a' }),
    ]));
    const evidenceIds = new Set(value.identities.map(identity => identity.id));
    expect(value.attempts[0]!.matches.every(match => evidenceIds.has(match.scanIdentityId) && evidenceIds.has(match.proxyIdentityId))).toBe(true);
    expect(value).toMatchObject({ eventOffset: 0, eventLimit: 100, eventTotal: 4, eventsHasMore: false, capturesHasMore: false, nextCaptureCursor: null });
    expect(response.text).not.toContain('BODY_ONLY_');
    expect(response.text).not.toContain('/synthetic/');
    expect(response.text).not.toContain(f.directory);
    expect(response.text).not.toMatch(/"(?:raw|inputSummary|outputSummary|requestBody|responseBody|rawRequestBody|rawResponseBody|systemPrompt)"\s*:/);
    expect(f.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
  });

  it('paginates small native event sets and attempts separately using actual returned cursors', async () => {
    const f = await fixture(); scan(f.db); for (let id = 1; id <= 3; id += 1) capture(f.db, id);
    const first = page(await call(f.port, '/api/sessions/scan-a/execution?eventOffset=0&eventLimit=2&captureLimit=2'));
    expect(first.events.map(event => event.sequence)).toEqual([1, 2]);
    expect(first.attempts.map(attempt => attempt.request.id)).toEqual([3, 2]);
    expect(first).toMatchObject({ eventsHasMore: true, capturesHasMore: true, nextCaptureCursor: 2 });
    const nextOffset = first.eventOffset + first.events.length;
    const second = page(await call(f.port, `/api/sessions/scan-a/execution?eventOffset=${nextOffset}&eventLimit=2&captureLimit=2&captureCursor=${first.nextCaptureCursor}`));
    expect(second.events.map(event => event.sequence)).toEqual([3, 4]);
    expect(second.attempts.map(attempt => attempt.request.id)).toEqual([1]);
    expect(second).toMatchObject({ eventsHasMore: false, capturesHasMore: false, nextCaptureCursor: null });
  });

  it('does not cross concurrent sessions sharing the same native tool/model IDs', async () => {
    const f = await fixture(); scan(f.db); scan(f.db, 'scan-b', 'native-b'); capture(f.db, 1); capture(f.db, 2, 'native-b');
    const [a, b] = await Promise.all([call(f.port, '/api/sessions/scan-a/execution'), call(f.port, '/api/sessions/scan-b/execution')]);
    for (const [response, owner, id, scope] of [[a, 'scan-a', 1, 'native-a'], [b, 'scan-b', 2, 'native-b']] as const) {
      const value = page(response);
      expect(value.sessionKey).toBe(owner);
      expect(value.attempts.map(attempt => attempt.request.id)).toEqual([id]);
      expect(value.attempts[0]!.matches.length).toBeGreaterThan(0);
      expect(value.attempts[0]!.matches.every(match => match.scope === scope)).toBe(true);
      expect(value.events.every(event => event.sessionId === owner)).toBe(true);
    }
  });

  it('keeps accepted session-only membership distinct from actual event evidence', async () => {
    const f = await fixture(); scan(f.db); capture(f.db, 1);
    const manifest = listTraceIdentities(f.db, { source: 'proxy', key: '1' });
    writeNativeIdentities(f.db, { source: 'proxy', key: '1' }, { parserVersion: 1, items: manifest.items.filter(identity => identity.kind === 'session'), completeness: manifest.completeness }, time);
    const value = page(await call(f.port, '/api/sessions/scan-a/execution'));
    expect(value.attempts[0]!.association.state).toBe('direct');
    expect(value.attempts[0]!.matches).toEqual([]);
  });

  it('excludes automatic candidates and exposes only an explicitly accepted owner without changing its decision on GET', async () => {
    const f = await fixture(); scan(f.db); scan(f.db, 'duplicate-source', 'native-a'); capture(f.db, 1);
    expect(page(await call(f.port, '/api/sessions/scan-a/execution')).attempts).toHaveLength(0);
    decideTraceAssociation(f.db, 1, 'scan-a', 'confirmed', 'synthetic explicit choice');
    const before = f.db.prepare('SELECT total_changes() AS changes').get();
    expect(page(await call(f.port, '/api/sessions/scan-a/execution')).attempts[0]!.association.state).toBe('confirmed');
    expect(page(await call(f.port, '/api/sessions/duplicate-source/execution')).attempts).toHaveLength(0);
    expect(f.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
  });

  it('reports off-page native identity collisions instead of guessing a visible event', async () => {
    const f = await fixture(); scan(f.db); capture(f.db, 1);
    const manifest = listTraceIdentities(f.db, { source: 'scan', key: 'scan-a' });
    const shared = manifest.items.find(identity => identity.kind === 'tool_call')!;
    const identities: NativeIdentitySet = { parserVersion: 3, items: [...manifest.items, { ...shared, eventId: 'native-final-model-1', sourcePath: 'synthetic.explicit-collision' }], completeness: manifest.completeness };
    writeNativeIdentities(f.db, { source: 'scan', key: 'scan-a' }, identities, time);
    const value = page(await call(f.port, '/api/sessions/scan-a/execution?eventOffset=2&eventLimit=1'));
    expect(value.events.map(event => event.id)).toEqual(['shared-tool-id']);
    expect(value.attempts[0]!.matches).toEqual([]);
    expect(value.identityCompleteness.reasons).toContain('ambiguous_native_binding');
  });

  it('accepts the exact maximum limits and safe offsets without silently clamping', async () => {
    const f = await fixture(); scan(f.db);
    const value = page(await call(f.port, '/api/sessions/scan-a/execution?eventOffset=9007199254740991&eventLimit=200&captureLimit=50&captureCursor=9007199254740991'));
    expect(value.eventOffset).toBe(Number.MAX_SAFE_INTEGER); expect(value.eventLimit).toBe(200); expect(value.events).toHaveLength(0);
  });

  it.each([
    'unknown=1', 'eventLimit=1&eventLimit=2', 'captureCursor=1&captureCursor=1', 'eventOffset=-1', 'eventLimit=0', 'eventLimit=201',
    'captureLimit=0', 'captureLimit=51', 'captureCursor=0', 'eventOffset=9007199254740992', 'eventLimit=1.0', 'eventLimit=1e2',
    'eventLimit=+1', 'eventLimit=01', 'eventOffset=', 'eventOffset=NaN', 'eventOffset=Infinity', 'eventLimit=100%00',
  ])('rejects malformed/unknown/duplicate query parameters: %s', async query => {
    const f = await fixture(); scan(f.db);
    apiError(await call(f.port, '/api/sessions/scan-a/execution?' + query), 400, 'BAD_REQUEST');
  });

  it('uses the unified missing-session envelope and does not trigger a source scan', async () => {
    const f = await fixture();
    apiError(await call(f.port, '/api/sessions/not-present/execution'), 404, 'SESSION_NOT_FOUND');
    expect(f.db.prepare('SELECT COUNT(*) AS total FROM sessions').get()).toEqual({ total: 0 });
    expect(f.db.prepare('SELECT COUNT(*) AS total FROM scan_state').get()).toEqual({ total: 0 });
  });

  it.each([
    { host: 'untrusted.invalid' }, { origin: 'https://untrusted.invalid' }, { origin: 'null' }, { host: '127.0.0.1.evil.invalid' },
  ] as Array<Record<string, string>>)('applies the production local Host/Origin guard: %j', async headers => {
    const f = await fixture(); scan(f.db);
    const response = await call(f.port, '/api/sessions/scan-a/execution', headers);
    apiError(response, 400, 'BAD_REQUEST');
    expect(response.text).not.toContain('shared-tool-id');
  });

  it('permits an explicit loopback development Origin on another port', async () => {
    const f = await fixture(); scan(f.db);
    expect(page(await call(f.port, '/api/sessions/scan-a/execution', { origin: 'http://127.0.0.1:5173', host: 'localhost:' + f.port })).sessionKey).toBe('scan-a');
  });

  it('maps an unprojectable metadata record to a static unified 503 without exposing its oversized URL', async () => {
    const f = await fixture(); scan(f.db); capture(f.db, 1);
    f.db.prepare('UPDATE proxy_requests SET url=? WHERE id=1').run('/OVERSIZED_ONLY_' + 'x'.repeat(1024 * 1024));
    const response = await call(f.port, '/api/sessions/scan-a/execution');
    apiError(response, 503, 'EXECUTION_METADATA_LIMIT');
    expect(response.text).not.toContain('OVERSIZED_ONLY_');
    expect(response.text.length).toBeLessThan(512);
  });
});
