import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import type { ClaudeHookConfigureResult, ClaudeHookDetail, ClaudeHookPage } from '../../src/core/claude-hooks.js';
import { createAgentObservabilityServer } from '../server.js';
import { openWritable } from '../storage/db.js';
import { eventBus } from '../realtime/event-bus.js';

const BASE = '/api/hooks/claude', owners: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of owners.splice(0).reverse()) await close(); });
const payload = (extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: 'synthetic-native', tool_name: 'Read', tool_use_id: 'tool-same', tool_input: { path: '/DO_NOT_FOLLOW' }, tool_response: 'PRIVATE_HOOK_RESULT', duration_ms: 12.5, ...extra });
async function fixture(quotaBytes?: number) {
  const directory = await mkdtemp(join(tmpdir(), 'claude-http-')); let db = openWritable(join(directory, 'state.sqlite'));
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'absent'); });
  const create = () => createAgentObservabilityServer({ db, config, captureDirectory: join(directory, 'bodies'), captureStorage: quotaBytes === undefined ? undefined : { quotaBytes }, userConfigPath: join(directory, 'config.json'), caDirectory: join(directory, 'ca') });
  let server = create(), port = 0;
  const listen = async () => { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); }); port = (server.address() as AddressInfo).port; };
  const close = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  owners.push(async () => { try { await close(); } finally { db.close(); await rm(directory, { recursive: true, force: true }); } });
  await listen();
  const call = async (path: string, options: { body?: unknown; raw?: Buffer | string; method?: string; headers?: Record<string,string> } = {}) => new Promise<{ status: number; text: string; headers: Record<string, unknown>; json: <T>() => T }>((resolve, reject) => {
    const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const req = request({ host: '127.0.0.1', port, path: BASE + path, method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...options.headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode ?? 0, text, headers: res.headers, json: <T,>() => JSON.parse(text) as T }); });
    }); req.once('error', reject); req.end(body);
  });
  const enable = async (revision = 0) => { const response = await call('/configure', { body: { expectedRevision: revision, enabled: true, confirmRaw: true } }); expect(response.status).toBe(200); const result = response.json<ClaudeHookConfigureResult>(); return result.settings!.hooks.PostToolUse![0]!.hooks[0]!; };
  return { get db() { return db; }, get port() { return port; }, directory, call, enable, stop: close,
    restart: async () => { await close(); db.close(); db = openWritable(join(directory, 'state.sqlite')); server = create(); await listen(); } };
}
describe('CH-001..006 production local HTTP receiver', () => {
  it('never acknowledges a quota failure or failed metadata commit as saved, and refuses the ten-thousand-row bound without another original', async () => {
    const limited = await fixture(1), token = await limited.enable();
    expect((await limited.call('/events', { body: payload(), headers: { authorization: token.headers.Authorization } })).json()).toMatchObject({ error: { code: 'HOOK_LIMIT' } });
    expect((await limited.call('/status')).json()).toMatchObject({ receivedCount: 0 });
    const f = await fixture(), config = await f.enable(), headers = { authorization: config.headers.Authorization };
    f.db.exec("CREATE TRIGGER reject_hook BEFORE INSERT ON claude_hook_events BEGIN SELECT RAISE(ABORT,'PRIVATE_DB_FAILURE'); END;");
    const failed = await f.call('/events', { body: payload(), headers }); expect(failed.status).toBe(503); expect(failed.text).not.toContain('PRIVATE_DB_FAILURE');
    expect((await f.call('/status')).json()).toMatchObject({ receivedCount: 0 });
    expect((await readdir(join(f.directory, 'bodies'))).filter(name => name.endsWith('.body'))).toHaveLength(1);
    f.db.exec('DROP TRIGGER reject_hook'); expect((await f.call('/events', { body: payload(), headers })).status).toBe(204);
    f.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<9999)
      INSERT INTO claude_hook_events(received_at,event_name,native_session_id,agent_id,agent_type,tool_use_id,tool_name,native_duration_ms,payload_bytes,payload_ref)
      SELECT received_at,event_name,native_session_id,agent_id,agent_type,tool_use_id,tool_name,native_duration_ms,payload_bytes,payload_ref FROM claude_hook_events,n WHERE id=1`);
    const files = await readdir(join(f.directory, 'bodies'));
    expect((await f.call('/events', { body: payload(), headers })).json()).toMatchObject({ error: { code: 'HOOK_LIMIT' } });
    expect(await readdir(join(f.directory, 'bodies'))).toEqual(files); expect((await f.call('/status')).json()).toMatchObject({ receivedCount: 10000 });
  });
  it('terminates a stalled body read after two seconds and owns pending reads through server shutdown', async () => {
    const f = await fixture(), config = await f.enable();
    const start = () => {
      let received = false;
      const done = new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: f.port, path: BASE + '/events', method: 'POST', headers: { authorization: config.headers.Authorization, 'content-type': 'application/json' } }, res => { received = true; res.resume(); res.once('end', () => resolve(res.statusCode!)); res.once('error', reject); });
        req.once('error', error => { if (!received) reject(error); }); req.on('close', () => {}); req.write('{');
      });
      return done;
    };
    expect(await start()).toBe(503);
    const waiting = start(); await new Promise(resolve => setTimeout(resolve, 30)); await f.stop(); expect(await waiting).toBe(503);
    expect(f.db.prepare('SELECT COUNT(id) AS n FROM claude_hook_events').get()).toEqual({ n: 0 });
  });
  it('defaults disabled, guards Host/Origin/control fields and authenticates before admitting original data', async () => {
    const f = await fixture();
    expect((await f.call('/status')).json()).toEqual({ enabled: false, revision: 0, receivedCount: 0, lastReceivedAt: null });
    expect((await f.call('/events', { body: payload() })).json()).toMatchObject({ error: { code: 'HOOK_DISABLED' } });
    expect((await f.call('/status', { headers: { host: 'untrusted.invalid' } })).status).toBe(400);
    expect((await f.call('/status', { headers: { origin: 'https://untrusted.invalid' } })).status).toBe(400);
    expect((await f.call('/configure', { body: { expectedRevision: 0, enabled: true } })).status).toBe(400);
    expect((await f.call('/configure', { body: { expectedRevision: 0, enabled: true, confirmRaw: true, token: 'do-not-accept' } })).status).toBe(400);
    const config = await f.enable(); expect(config.url).toBe(`http://127.0.0.1:${f.port}${BASE}/events`);
    expect((await f.call('/events', { body: payload() })).status).toBe(401);
    expect((await f.call('/events', { body: payload(), headers: { authorization: config.headers.Authorization, 'content-type': 'text/plain' } })).status).toBe(400);
    const status = await f.call('/status'); expect(status.headers['cache-control']).toBe('no-store'); expect(status.text).not.toMatch(/Bearer|tokenHash|\.json/);
    expect(f.db.prepare('SELECT COUNT(id) AS n FROM claude_hook_events').get()).toEqual({ n: 0 });
  });
  it('acks only a saved original with empty204, preserves whitespace/unknown fields/duplicates and lazily verifies exact payload bytes', async () => {
    const f = await fixture(), config = await f.enable(), headers = { authorization: config.headers.Authorization };
    const original = '\n ' + JSON.stringify(payload({ agent_type: '', unknown: { nested: '中文 <script>UNCHANGED</script>' } }), null, 2) + '\t';
    for (let n = 0; n < 2; n++) { const response = await f.call('/events', { raw: original, headers }); expect(response.status).toBe(204); expect(response.text).toBe(''); }
    const page = (await f.call('/events?limit=1')).json<ClaudeHookPage>();
    expect(page).toMatchObject({ status: { receivedCount: 2 }, items: [{ id: 2, nativeDurationMs: 12.5, agentType: '', nativeSessionState: 'unresolved' }], nextCursor: 2, hasMore: true });
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE_HOOK_RESULT|rawJson|tool_input|sha256|Bearer/);
    const detail = (await f.call('/events/2')).json<ClaudeHookDetail>(); expect(detail.rawJson).toBe(original); expect(detail.payloadBytes).toBe(Buffer.byteLength(original));
    const row = f.db.prepare('SELECT payload_ref FROM claude_hook_events WHERE id=2').get() as { payload_ref: string }, ref = JSON.parse(row.payload_ref) as { id: string; sha256: string };
    expect(detail.sha256).toBe(ref.sha256); expect(await readFile(join(f.directory, 'bodies', ref.id + '.body'), 'utf8')).toBe(original);
    expect(f.db.prepare('SELECT COUNT(id) AS n FROM trace_identity_sources').get()).toEqual({ n: 0 });
    expect((await f.call('/events?cursor=2&limit=1')).json<ClaudeHookPage>()).toMatchObject({ items: [{ id: 1 }], hasMore: false, nextCursor: null });
    await writeFile(join(f.directory, 'bodies', ref.id + '.body'), 'corrupt');
    expect((await f.call('/events/2')).json()).toEqual({ error: { code: 'HOOK_UNAVAILABLE', message: 'HOOK_UNAVAILABLE' } });
    expect((await f.call('/events')).status).toBe(200); expect((await f.call('/events/999')).status).toBe(404);
  });
  it('keeps root, child and session tool scopes distinct and validates canonical filters', async () => {
    const f = await fixture(), { headers } = await f.enable();
    for (const extra of [{}, { agent_id: 'child' }, { session_id: 'other' }]) expect((await f.call('/events', { body: payload(extra), headers: { authorization: headers.Authorization } })).status).toBe(204);
    const root = (await f.call('/events?sessionId=synthetic-native&toolUseId=tool-same&agentId=')).json<ClaudeHookPage>(); expect(root.items.map(item => item.id)).toEqual([1]);
    const child = (await f.call('/events?sessionId=synthetic-native&toolUseId=tool-same&agentId=child')).json<ClaudeHookPage>(); expect(child.items.map(item => item.id)).toEqual([2]);
    for (const query of ['toolUseId=tool-same','sessionId=s&toolUseId=t','agentId=child','sessionId=%00native','limit=51','limit=0','limit=01','cursor=-1','cursor=9007199254740992','limit=1&limit=2','unexpected=1']) expect((await f.call('/events?' + query)).status, query).toBe(400);
  });
  it('rejects invalid UTF8, malformed native fields and over-limit originals; accepts an exact256KiB original', async () => {
    const f = await fixture(), config = await f.enable(), headers = { authorization: config.headers.Authorization };
    for (const value of [payload({ session_id: '' }), payload({ session_id: 'native\0suffix' }), payload({ hook_event_name: 'Undeclared' }), payload({ tool_name: null }), payload({ duration_ms: -1 }), payload({ tool_use_id: 5 }), payload({ hook_event_name: 'SubagentStart', agent_id: null })]) expect((await f.call('/events', { body: value, headers })).status).toBe(400);
    expect((await f.call('/events', { raw: Buffer.from([0xff, 0x7b]), headers })).status).toBe(400);
    expect((await f.call('/events', { raw: 'x'.repeat(262145), headers })).status).toBe(413);
    const base = JSON.stringify(payload({ padding: '' })), exact = base.replace('"padding":""', '"padding":"' + 'x'.repeat(262144 - Buffer.byteLength(base)) + '"');
    expect(Buffer.byteLength(exact)).toBe(262144); expect((await f.call('/events', { raw: exact, headers })).status).toBe(204);
    expect((await f.call('/events/1')).json<ClaudeHookDetail>().rawJson).toBe(exact);
  });
  it('retains the applied token and committed observations across a real server+database reopen, then rotates and disables', async () => {
    const f = await fixture(), config = await f.enable(), headers = { authorization: config.headers.Authorization };
    expect((await f.call('/events', { body: payload(), headers })).status).toBe(204);
    await f.restart(); expect((await f.call('/events', { body: payload(), headers })).status).toBe(204);
    expect((await f.call('/events/1')).json<ClaudeHookDetail>().rawJson).toBe(JSON.stringify(payload()));
    const next = await f.enable(1); expect(next.url).toContain(`:${f.port}/`);
    expect((await f.call('/events', { body: payload(), headers })).status).toBe(401);
    expect((await f.call('/configure', { body: { expectedRevision: 1, enabled: false } })).status).toBe(409);
    const disabled = await f.call('/configure', { body: { expectedRevision: 2, enabled: false } }); expect(disabled.json()).toMatchObject({ status: { enabled: false, receivedCount: 2 }, settings: null });
    expect((await f.call('/events', { body: payload(), headers: { authorization: next.headers.Authorization } })).status).toBe(409);
    await f.restart(); expect((await f.call('/status')).json()).toMatchObject({ enabled: false, revision: 3, receivedCount: 2 });
  });
  it('coalesces saved hints and caps metadata pages without losing escaped native identifiers at a cursor boundary', async () => {
    const f = await fixture(), config = await f.enable(), hints: number[] = [], unsubscribe = eventBus.on('hook_events_changed', value => hints.push(value.latestId));
    try {
      await Promise.all(Array.from({ length: 4 }, () => f.call('/events', { body: payload(), headers: { authorization: config.headers.Authorization } })));
      await new Promise(resolve => setTimeout(resolve, 230)); expect(hints).toEqual([4]);
      const raw = payload({ session_id: '\u0001'.repeat(512), agent_id: '\u0002'.repeat(512), agent_type: '\u0003'.repeat(512), tool_use_id: '\u0004'.repeat(512), tool_name: '\u0005'.repeat(128) });
      expect((await f.call('/events', { body: raw, headers: { authorization: config.headers.Authorization } })).status).toBe(204);
      f.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<49)
        INSERT INTO claude_hook_events(received_at,event_name,native_session_id,agent_id,agent_type,tool_use_id,tool_name,native_duration_ms,payload_bytes,payload_ref)
        SELECT received_at,event_name,native_session_id,agent_id,agent_type,tool_use_id,tool_name,native_duration_ms,payload_bytes,payload_ref FROM claude_hook_events,n WHERE id=5`);
      const ids: number[] = []; let cursor: number | null = null;
      do { const response = await f.call('/events?limit=50' + (cursor === null ? '' : '&cursor=' + cursor)); expect(Buffer.byteLength(response.text)).toBeLessThanOrEqual(65536); const page = response.json<ClaudeHookPage>(); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor; } while (cursor !== null);
      expect(ids).toEqual(Array.from({ length: 54 }, (_, index) => 54-index));
    } finally { unsubscribe(); }
  });
  it('owns slow ingress: four requests maximum, disable persists first, waits admitted writes, then rejects the old token', async () => {
    const f = await fixture(), config = await f.enable(), headers = { authorization: config.headers.Authorization };
    const start = () => {
      let finish: (status: number) => void = () => undefined;
      const complete = new Promise<number>(resolve => { finish = resolve; });
      const req = request({ host: '127.0.0.1', port: f.port, path: BASE + '/events', method: 'POST', headers: { ...headers, 'content-type': 'application/json' } }, res => { res.resume(); res.once('end', () => finish(res.statusCode!)); });
      req.on('error', () => finish(0)); req.flushHeaders(); req.write('{');
      return { req, complete };
    };
    const slow = Array.from({ length: 4 }, start);
    try {
      // All four reads are demonstrably admitted when a fifth is refused.
      await new Promise(resolve => setTimeout(resolve, 60));
      expect((await f.call('/events', { body: payload(), headers })).json()).toMatchObject({ error: { code: 'HOOK_LIMIT' } });
      let settled = false; const disabling = f.call('/configure', { body: { expectedRevision: 1, enabled: false } }).then(value => { settled = true; return value; });
      for (let n = 0; n < 50; n++) { if (!(await f.call('/status')).json<{ enabled: boolean }>().enabled) break; await new Promise(resolve => setTimeout(resolve, 5)); }
      expect((await f.call('/status')).json()).toMatchObject({ enabled: false }); expect(settled).toBe(false);
      for (const item of slow) item.req.end(JSON.stringify(payload()).slice(1));
      expect(await Promise.all(slow.map(item => item.complete))).toEqual([204,204,204,204]);
      expect((await disabling).json()).toMatchObject({ status: { enabled: false, receivedCount: 4 } });
      expect((await f.call('/events', { body: payload(), headers })).status).toBe(409);
    } finally { slow.forEach(item => item.req.destroy()); }
  });
});
