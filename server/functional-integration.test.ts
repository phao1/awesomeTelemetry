import Database from 'better-sqlite3';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import { storeTraceRecord } from '../local-sessions/scanner-utils.js';
import { normalizeCodexSample } from '../src/adapters/codex.js';
import type { NativeToolObservationPage } from '../src/core/native-tool-observations.js';
import type { ExperimentSnapshot, ExperimentInput } from './experiments/registry.js';
import { readTraceExportCoverage } from '../src/core/trace-export.js';
import type { OtlpTraceExport } from '../src/core/trace-export.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';
import { deleteSession } from './storage/writers.js';
import { extractNetworkIdentities } from './proxy/identity-extractor.js';
import { writeNativeIdentities } from './storage/trace-links.js';

const resources: Array<{ db: Database.Database; server: Server; directory: string }> = [];
afterEach(async () => { for (const f of resources.splice(0)) { try { if (f.server.listening) await new Promise<void>((resolve, reject) => f.server.close(error => error ? reject(error) : resolve())); }
  finally { f.db.close(); await rm(f.directory, { recursive: true, force: true }); } } });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'functional-http-')), statements: string[] = [];
  const db = new Database(':memory:', { verbose: sql => statements.push(String(sql)) }); db.pragma('foreign_keys=ON'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'no-sources'); });
  const server = createAgentObservabilityServer({ db, config, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json') }); resources.push({ db, server, directory });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { db, directory, statements, port: (server.address() as AddressInfo).port };
}
async function call(port: number, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const encoded = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { ...(encoded === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) }), ...options.headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    }); req.once('error', reject); req.setTimeout(5000, () => req.destroy(Error('Synthetic HTTP acceptance timeout'))); req.end(encoded);
  });
}
const query = '?namespace=protocol%3Aopenai&value=native-call&scope=native-s';
function seed(db: Database.Database, key = 's', nativeId = 'native-s') {
  const record = normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: [
    { type: 'session_meta', timestamp: '2026-10-19T00:00:00Z', payload: { id: nativeId, cwd: '/PRIVATE_SOURCE_PATH' } },
    { type: 'response_item', timestamp: '2026-10-19T00:00:00Z', payload: { type: 'function_call', id: 'input', call_id: 'native-call', name: 'read_file', arguments: 'SYNTHETIC_SECRET_INPUT' } },
    { type: 'response_item', timestamp: '2026-10-19T00:00:01Z', payload: { type: 'function_call_output', id: 'output', call_id: 'native-call', output: 'SYNTHETIC_SECRET_OUTPUT' } },
  ] }, 'fixture://' + key); storeTraceRecord(db, record, 'fixture://' + key, key);
}
const input = (): ExperimentInput => ({ name: 'Synthetic manual trial', task: 'same declared task', inputVersion: 'v1', modelParameters: null, toolSet: null, mode: 'controlled', runs: [{ sessionKey: 's', label: 'mixed', note: 'Manual declaration' }, { sessionKey: 'other', label: 'unrated', note: null }] });
describe('functional production route integration', () => {
  it('serves persisted Frida preview pages and exact selected detail, including equal-time cursor ties', async () => {
    const f = await fixture();
    const body = JSON.stringify({ text: 'SYNTHETIC_ONLY'.repeat(80), literal: '<script>retained text</script>' });
    const insert = f.db.prepare('INSERT INTO frida_captures (pid,captured_at,capture_type,json_data,model,session_id,capture_session_id,message_count,tokens_json) VALUES (?,?,?,?,?,?,?,?,?)');
    insert.run(123, '2026-10-20T00:00:00.000Z', 'chat', body, null, null, 'synthetic-run', null, null);
    insert.run(123, '2026-10-20T00:00:00.000Z', 'chat', body, 'synthetic-model', 'synthetic-native', 'synthetic-run', null, null);
    const before = f.db.prepare('SELECT total_changes() AS n').get();
    const result = await call(f.port, '/api/frida/captures?limit=1'); expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    const first = JSON.parse(result.text) as { items: Array<{ id: number; jsonData: string }>; nextCursor: string; hasMore: boolean };
    expect(first.items).toHaveLength(1); expect(first.items[0]!.id).toBe(2); expect(first.items[0]!.jsonData).toBe(body.slice(0, 500)); expect(first.hasMore).toBe(true);
    const next = await call(f.port, '/api/frida/captures?limit=1&cursor=' + encodeURIComponent(first.nextCursor));
    expect(JSON.parse(next.text)).toMatchObject({ items: [{ id: 1 }], nextCursor: null, hasMore: false });
    const detail = await call(f.port, '/api/frida/captures/2'); expect(detail.status).toBe(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(detail.text)).toEqual({ id: 2, pid: 123, capturedAt: '2026-10-20T00:00:00.000Z', captureType: 'chat', jsonData: body, model: 'synthetic-model', sessionId: 'synthetic-native', captureSessionId: 'synthetic-run', messageCount: null, tokens: null });
    expect((await call(f.port, '/api/frida/captures/999')).status).toBe(404);
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('protects Frida metadata/detail/control paths before any target launch or mutation', async () => {
    const f = await fixture();
    for (const [path, method] of [['/api/frida/status', 'GET'], ['/api/frida/captures', 'GET'], ['/api/frida/captures/1', 'GET'], ['/api/frida/start', 'POST'], ['/api/frida/stop', 'POST']]) {
      for (const headers of [{ host: 'foreign.invalid' }, { origin: 'https://foreign.invalid' }] as Array<Record<string, string>>) {
        const result = await call(f.port, path!, { method, headers, ...(method === 'POST' ? { body: { pid: 123 } } : {}) });
        expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
      }
    }
    const status = await call(f.port, '/api/frida/status'); expect(JSON.parse(status.text)).toEqual({ running: false, starting: false, pid: null });
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM frida_captures').get()).toEqual({ n: 0 });
  });
  it.each([0, -1, 1.5, 9007199254740992, '123'])('rejects invalid Frida PID %s without launching a process', async pid => {
    const f = await fixture(); const result = await call(f.port, '/api/frida/start', { method: 'POST', body: { pid } });
    expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
    expect(JSON.parse((await call(f.port, '/api/frida/status')).text)).toEqual({ running: false, starting: false, pid: null });
  });
  it('serves exact native tool metadata pages without reading bodies or changing source rows', async () => {
    const f = await fixture(); seed(f.db); seed(f.db, 'other', 'other-native');
    const before = f.db.prepare('SELECT total_changes() AS n').get();
    const result = await call(f.port, '/api/sessions/s/tool-observations' + query + '&limit=1');
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(result.text) as NativeToolObservationPage).toMatchObject({ state: 'retained_reference', events: [{ id: 'input' }], eventTotal: 2, nextCursor: 1, hasMore: true });
    const next = await call(f.port, '/api/sessions/s/tool-observations' + query + '&limit=1&cursor=1');
    expect(JSON.parse(next.text) as NativeToolObservationPage).toMatchObject({ events: [{ id: 'output' }], nextCursor: null, hasMore: false });
    expect(result.text + next.text).not.toMatch(/SYNTHETIC_SECRET|PRIVATE_SOURCE_PATH|inputSummary|outputSummary|"raw"/);
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    const body = await call(f.port, '/api/sessions/s/events/output?include=raw'); expect(body.status).toBe(200); expect(body.text).toContain('SYNTHETIC_SECRET_OUTPUT');
  });
  it.each(['', '?namespace=x', query + '&limit=0', query + '&limit=101', query + '&cursor=-1', query + '&cursor=1.5', query + '&cursor=9007199254740992', query + '&scope=a', query + '&extra=1', '?namespace=x&value=%00&scope=s'])('rejects malformed native query %s with ApiError', async suffix => {
    const f = await fixture(); seed(f.db); const result = await call(f.port, '/api/sessions/s/tool-observations' + suffix);
    expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
  });
  it('guards every new native/read/write route before dispatch and preserves missing-session404', async () => {
    const f = await fixture(); seed(f.db);
    for (const [path, method] of [['/api/sessions/s/tool-observations' + query, 'GET'], ['/api/sessions/s/trace-export', 'GET'], ['/api/sessions/s/linked-trace-export', 'GET'], ['/api/experiment-records', 'GET'], ['/api/experiment-records', 'POST'], ['/api/experiment-records/missing', 'PUT'], ['/api/experiment-records/missing', 'DELETE']]) {
      for (const headers of [{ host: 'foreign.invalid' }, { origin: 'https://foreign.invalid' }] as Array<Record<string, string>>) {
        const result = await call(f.port, path!, { method, headers }); expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
      }
    }
    for (const suffix of ['/tool-observations' + query, '/trace-export', '/linked-trace-export']) {
      const missing = await call(f.port, '/api/sessions/missing' + suffix); expect(missing.status).toBe(404); expect(JSON.parse(missing.text).error.code).toBe('SESSION_NOT_FOUND');
    }
    await expect(readFile(join(f.directory, 'experiment-records.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('exports a standard local OTLP page with coverage, stable grouping IDs and no retained body text', async () => {
    const f = await fixture(); seed(f.db); const before = f.db.prepare('SELECT total_changes() AS n').get();
    const result = await call(f.port, '/api/sessions/s/trace-export?offset=0&limit=1', { headers: { origin: 'http://127.0.0.1:' + f.port } });
    expect(result.status).toBe(200); expect(result.headers['content-disposition']).toContain('.otlp.json'); expect(result.headers['cache-control']).toBe('no-store');
    const data = JSON.parse(result.text) as OtlpTraceExport; expect(readTraceExportCoverage(data, 's', 0, 1)).toMatchObject({ returned: 1, eventTotal: 2, hasMore: true, nextOffset: 1, partial: true });
    expect(result.text).not.toMatch(/SYNTHETIC_SECRET|PRIVATE_SOURCE_PATH|native-call|inputSummary|outputSummary/);
    const again = await call(f.port, '/api/sessions/s/trace-export?offset=0&limit=1');
    expect(JSON.parse(again.text).resourceSpans[0].scopeSpans[0].spans[0].spanId).toBe(data.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.spanId);
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('exports separate native and accepted proxy observations from one session while preserving originals', async () => {
    const f = await fixture(); seed(f.db); seed(f.db, 'other', 'other-native');
    const insert = f.db.prepare('INSERT INTO proxy_requests (id,request_id,method,url,hostname,model,started_at,completed_at,request_body,response_body) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const [id, scope] of [[1, 'native-s'], [2, 'other-native']] as const) {
      insert.run(id, 'synthetic-export-' + id, 'POST', '/v1/chat/completions', 'synthetic.invalid', 'same-model', '2026-10-19T00:00:00Z', '2026-10-19T00:00:01Z', 'PRIVATE_REQUEST_BODY', 'PRIVATE_RESPONSE_BODY');
      writeNativeIdentities(f.db, { source: 'proxy', key: String(id) }, extractNetworkIdentities({ format: 'openai_chat',
        requestHeaders: { 'x-agent-provider': 'codex', 'x-agent-session-id': scope }, requestBody: '{"messages":[]}',
        responseBody: JSON.stringify({ id: 'native-response-' + id, choices: [{ message: { tool_calls: [{ id: 'native-call', type: 'function', function: { name: 'read_file', arguments: '{}' } }] } }] }),
      }), '2026-10-19T00:00:01Z');
    }
    const before = f.db.prepare('SELECT total_changes() AS n').get();
    const result = await call(f.port, '/api/sessions/s/linked-trace-export?eventOffset=0&eventLimit=1&captureLimit=1');
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['content-disposition']).toContain('.json');
    const data = JSON.parse(result.text); expect(data.resourceSpans).toHaveLength(1); expect(data.resourceSpans[0].scopeSpans).toHaveLength(2);
    const [scanScope, proxyScope] = data.resourceSpans[0].scopeSpans;
    expect(scanScope.spans).toHaveLength(1); expect(proxyScope.spans).toHaveLength(1);
    expect(proxyScope.spans[0].traceId).not.toBe(scanScope.spans[0].traceId);
    expect(JSON.stringify(proxyScope.spans)).toContain('synthetic-export-1'); expect(result.text).not.toContain('synthetic-export-2');
    expect(result.text).toContain('native-call'); expect(result.text).not.toMatch(/PRIVATE_REQUEST_BODY|PRIVATE_RESPONSE_BODY|SYNTHETIC_SECRET|PRIVATE_SOURCE_PATH/);
    expect(proxyScope.spans[0]).not.toHaveProperty('parentSpanId'); expect(proxyScope.spans[0]).not.toHaveProperty('links');
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(f.db.prepare('SELECT request_body FROM proxy_requests WHERE id=1').get()).toEqual({ request_body: 'PRIVATE_REQUEST_BODY' });
  });
  it('persists confirmed manual CRUD with one batch native lookup and CAS while preserving old unavailable refs', async () => {
    const f = await fixture(); seed(f.db); seed(f.db, 'other', 'other-native');
    const first = await call(f.port, '/api/experiment-records'); expect(JSON.parse(first.text)).toEqual({ version: 1, revision: 0, records: [] });
    f.statements.length = 0;
    const created = await call(f.port, '/api/experiment-records', { method: 'POST', body: { confirmed: true, expectedRevision: 0, record: input() } });
    expect(created.status).toBe(201); const snapshot = JSON.parse(created.text) as ExperimentSnapshot; expect(snapshot.revision).toBe(1); expect(snapshot.records[0]!.runs).toEqual(input().runs);
    const lookups = f.statements.filter(sql => /^SELECT id FROM sessions WHERE data_source='scan'/i.test(sql)); expect(lookups).toHaveLength(1); expect(lookups[0]).toContain('json_each');
    const conflict = await call(f.port, '/api/experiment-records', { method: 'POST', body: { confirmed: true, expectedRevision: 0, record: input() } }); expect(conflict.status).toBe(409); expect(JSON.parse(conflict.text).error.details.reason).toBe('CONFLICT');
    deleteSession(f.db, 'other');
    const updated = await call(f.port, '/api/experiment-records/' + snapshot.records[0]!.id, { method: 'PUT', body: { confirmed: true, expectedRevision: 1, record: { ...input(), name: 'Manual revision' } } });
    expect(updated.status).toBe(200); expect((JSON.parse(updated.text) as ExperimentSnapshot).records[0]!.runs).toEqual(input().runs);
    expect(JSON.parse(await readFile(join(f.directory, 'experiment-records.json'), 'utf8')).revision).toBe(2);
    const removed = await call(f.port, '/api/experiment-records/' + snapshot.records[0]!.id, { method: 'DELETE', body: { confirmed: true, expectedRevision: 2 } });
    expect(removed.status).toBe(200); expect(JSON.parse(removed.text)).toEqual({ version: 1, revision: 3, records: [] });
    expect(f.db.prepare('SELECT id FROM sessions WHERE id=?').get('s')).toEqual({ id: 's' });
  });
  it('rejects unconfirmed writes and unavailable new run references without creating a record', async () => {
    const f = await fixture(); seed(f.db);
    const refused = await call(f.port, '/api/experiment-records', { method: 'POST', body: { confirmed: false, expectedRevision: 0, record: input() } }); expect(refused.status).toBe(400);
    const missing = await call(f.port, '/api/experiment-records', { method: 'POST', body: { confirmed: true, expectedRevision: 0, record: input() } });
    expect(missing.status).toBe(400); expect(JSON.parse(missing.text).error.details.reason).toBe('SESSION_UNAVAILABLE');
    const result = await call(f.port, '/api/experiment-records'); expect(JSON.parse(result.text).records).toEqual([]);
  });
});
