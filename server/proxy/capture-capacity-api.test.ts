import { createHash, randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createServer, request, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import { createAgentObservabilityServer } from '../server.js';
import { checkpointWal, openReadonly, openWritable } from '../storage/db.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureJournal } from './capture-journal.js';
import { readCaptureBodies, writeCaptureBodies } from './capture-storage.js';
import { writeNativeIdentities } from '../storage/trace-links.js';

function call(port: number, method: string, path: string, body?: unknown, origin?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const content = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ hostname: '127.0.0.1', port, method, path, headers: { ...(content === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(content) }), ...(origin === undefined ? {} : { origin }), ...headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk as Buffer)); res.once('error', reject); res.once('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    }); req.once('error', reject); req.end(content);
  });
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-capacity-api-')), dbPath = join(directory, 'state.sqlite'), captureDirectory = join(directory, 'bodies');
  const db = openWritable(dbPath), config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'no-native-data'); }
  let server: Server | null = null, port = 0;
  const stop = async () => { if (server !== null) { const current = server; server = null; await new Promise<void>((resolve, reject) => current.close(error => error === undefined ? resolve() : reject(error))); } };
  return { directory, dbPath, captureDirectory, db, get port() { return port; },
    async start() { await stop(); server = createAgentObservabilityServer({ db, dbPath, captureDirectory, config, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json') }); await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve)); port = (server.address() as AddressInfo).port; },
    stop, async close() { try { await stop(); } finally { db.close(); await rm(directory, { recursive: true, force: true }); } } };
}
function pin(db: Database, path: string) {
  checkpointWal(db); db.pragma('wal_autocheckpoint=0'); const reader = openReadonly(path);
  reader.exec('BEGIN'); reader.prepare('SELECT value FROM _meta WHERE key=?').get('schema_version');
  const insert = db.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(393216))');
  for (let i = 0; i < 100 && statSync(path + '-wal').size < 12_000_000; i += 1) insert.run('pressure-' + i);
  expect(statSync(path + '-wal').size).toBeGreaterThanOrEqual(12_000_000); return reader;
}
async function freePort(): Promise<number> {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve())); return port;
}
async function startProxy(control: number, port: number) {
  expect((await call(control, 'POST', '/api/proxy/start', { port })).status).toBe(200);
  const deadline = Date.now() + 7000;
  while (!JSON.parse((await call(control, 'GET', '/api/proxy/status')).text).running) {
    if (Date.now() > deadline) throw new Error('Synthetic proxy did not become ready'); await new Promise(resolve => setTimeout(resolve, 5));
  }
}
describe('production capture pressure control', () => {
  it.each([{ label: 'wide-scope', toolCount: 1900, idChars: 900, scopeChars: 1024 }, { label: 'identity-count-ceiling', toolCount: 2046, idChars: 800, scopeChars: 900 }])('keeps a large actually admitted $label capture within WAL/DB/loop budgets near the admission watermark', async ({ toolCount, idChars, scopeChars }) => {
    const f = await fixture(), scope = 'synthetic-session-'.padEnd(scopeChars, 's'), now = new Date().toISOString();
    let calls = 0, reader: ReturnType<typeof openReadonly> | null = null;
    const origin = createServer((req, res) => { calls += 1; req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"synthetic-response","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}'); }); });
    const loop = monitorEventLoopDelay({ resolution: 2 });
    try {
      const insertSession = f.db.prepare('INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path) VALUES(?,?,?,?,?,?,?)');
      for (let index = 0; index < 32; index += 1) {
        const key = 'synthetic-scan-' + index; insertSession.run(key, 'codex', 'codex', 'Synthetic capacity fixture', now, now, 'synthetic:' + key);
        writeNativeIdentities(f.db, { source: 'scan', key }, { parserVersion: 1, items: [{ namespace: 'agent:codex', kind: 'session', value: scope, scope: null, eventId: null, sourcePath: 'synthetic.session' }], completeness: { complete: true, omittedCount: 0, reasons: [] } }, now);
      }
      await f.start(); const proxyPort = await freePort(); await startProxy(f.port, proxyPort);
      await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${(origin.address() as AddressInfo).port}/v1/chat/completions`;
      const capacity = JSON.parse((await call(f.port, 'GET', '/api/proxy/capacity')).text);
      checkpointWal(f.db); f.db.pragma('wal_autocheckpoint=0'); reader = openReadonly(f.dbPath); reader.exec('BEGIN'); reader.prepare('SELECT value FROM _meta WHERE key=?').get('schema_version');
      const fill = f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(262144))');
      for (let index = 0; index < 100 && statSync(f.dbPath + '-wal').size < capacity.walAdmissionBytes - 400_000; index += 1) fill.run('near-limit-' + index);
      const beforeWal = (await stat(f.dbPath + '-wal')).size; expect(beforeWal).toBeLessThan(capacity.walAdmissionBytes); expect(beforeWal).toBeGreaterThan(capacity.walAdmissionBytes - 500_000);
      const payload = { model: 'synthetic-large', messages: [{ role: 'system', content: 'synthetic-prompt-'.repeat(4096) },
        ...Array.from({ length: toolCount }, (_, index) => ({ role: 'tool', tool_call_id: ('tool-' + index).padEnd(idChars, 'x'), content: 'observed synthetic result' }))] };
      const bytes = Buffer.from(JSON.stringify(payload)); expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
      loop.enable(); await new Promise(resolve => setTimeout(resolve, 20));
      const forwarded = await call(proxyPort, 'POST', url, payload, undefined, { 'x-agent-provider': 'codex', 'x-agent-session-id': scope });
      expect(forwarded.status).toBe(200); expect((await call(f.port, 'POST', '/api/proxy/stop')).status).toBe(200);
      await new Promise(resolve => setTimeout(resolve, 20)); loop.disable();
      const row = f.db.prepare('SELECT id FROM proxy_requests ORDER BY id LIMIT 1').get() as { id: number } | undefined; expect(row).toBeDefined();
      const retained = readCaptureBodies(f.db, row!.id), walBytes = (await stat(f.dbPath + '-wal')).size, dbBytes = (await stat(f.dbPath)).size;
      const tools = f.db.prepare("SELECT COUNT(*) AS n FROM trace_identities WHERE source_id=? AND kind='tool_call'").get('proxy:' + row!.id) as { n: number };
      const identities = f.db.prepare('SELECT COUNT(*) AS n FROM trace_identities WHERE source_id=?').get('proxy:' + row!.id) as { n: number };
      const completeness = f.db.prepare('SELECT complete,omitted_count,reasons_json FROM trace_identity_sources WHERE id=?').get('proxy:' + row!.id);
      const candidates = f.db.prepare('SELECT COUNT(*) AS n FROM trace_associations WHERE proxy_id=?').get(row!.id) as { n: number };
      const report = { observedAt: new Date().toISOString(), fixture: { requestBytes: bytes.length, tools: toolCount, scopeChars: scope.length, candidateOwners: 32 },
        beforeWal, walBytes, dbBytes, walDelta: walBytes - beforeWal, processing: retained.processing, identityTools: tools.n, identities: identities.n, completeness, candidates: candidates.n,
        loop: { samples: Number(loop.count), p99Ms: loop.percentile(99) / 1e6, maxMs: loop.max / 1e6 }, originCalls: calls,
        scope: 'Actual local production HTTP proxy/worker/index,32 synthetic native owners, pinned WAL near admission. Not all possible payloads, physical ENOSPC, real Agent or soak.' };
      await mkdir(join(process.cwd(), 'reports'), { recursive: true }); await writeFile(join(process.cwd(), 'reports', 'capture-capacity-worst-' + Date.now() + '-' + process.pid + '.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
      expect(retained.processing?.status).toBe('ok'); expect(tools.n).toBe(toolCount); expect(candidates.n).toBe(32);
      expect(identities.n).toBe(toolCount + 2); expect(completeness).toEqual({ complete: 1, omitted_count: 0, reasons_json: '[]' });
      expect(f.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE data_source='scan'").get()).toEqual({ n: 32 });
      const original = await readFile(join(f.captureDirectory, retained.request!.id + '.body')); expect(original).toEqual(bytes);
      expect(createHash('sha256').update(original).digest('hex')).toBe(retained.request!.sha256); expect(calls).toBe(1);
      expect(report.loop.samples).toBeGreaterThan(0); expect(report.loop.p99Ms).toBeLessThan(50);
      expect(walBytes).toBeLessThan(20_000_000); expect(dbBytes + walBytes).toBeLessThan(200_000_000);
    } finally { loop.disable(); if (reader !== null) { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); } await new Promise<void>(resolve => origin.close(() => resolve())); await f.close(); }
  }, 15_000);
  it('serves an explicit read-only capacity projection without starting recovery/CA/body store and applies Origin policy', async () => {
    const f = await fixture();
    try {
      await f.start(); const before = f.db.prepare('SELECT total_changes() AS n').get(), value = await call(f.port, 'GET', '/api/proxy/capacity');
      expect(value.status).toBe(200); expect(JSON.parse(value.text)).toMatchObject({ state: 'ready', reason: null, combinedAdmissionBytes: 180_000_000 });
      expect(value.text).not.toContain(f.directory); expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      await expect(stat(f.captureDirectory)).rejects.toMatchObject({ code: 'ENOENT' }); await expect(stat(join(f.directory, 'ca'))).rejects.toMatchObject({ code: 'ENOENT' });
      const denied = await call(f.port, 'GET', '/api/proxy/capacity', undefined, 'https://untrusted.invalid');
      expect(denied.status).toBe(400); expect(JSON.parse(denied.text).error.code).toBe('BAD_REQUEST');
    } finally { await f.close(); }
  });
  it('keeps committed evidence readable and explicitly cleanable while startup recovery is pressure-blocked', async () => {
    const f = await fixture(), store = await CaptureBodyStore.create(f.captureDirectory), journal = await CaptureJournal.open(f.db, store);
    const a = store.begin(), b = store.begin(); a.append(Buffer.from('synthetic committed request')); b.append(Buffer.from('synthetic response'));
    const [requestRef, responseRef] = await Promise.all([a.finish(), b.finish()]);
    const id = Number(f.db.prepare("INSERT INTO proxy_requests(request_id,method,url,hostname,started_at,request_headers) VALUES('committed','POST','/v1/messages','synthetic',?,'{}')").run(new Date().toISOString()).lastInsertRowid);
    writeCaptureBodies(f.db, id, { request: requestRef, response: responseRef, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
    const pending = journal.begin({ requestId: 'pending-pressure', method: 'POST', url: '/v1/messages', hostname: 'synthetic', requestHeaders: {}, startedAt: new Date().toISOString(), captureGroupId: null,
      requestBodyId: randomUUID(), responseBodyId: randomUUID(), requestEnded: false, responseEnded: false, responseStatus: null, responseHeaders: {}, completedAt: null, durationMs: null, transport: null, requestRef: null, responseRef: null });
    await pending.ready; await writeFile(join(f.captureDirectory, pending.entry.requestBodyId + '.part'), 'pending-prefix'); const reader = pin(f.db, f.dbPath);
    try {
      await f.start(); expect(JSON.parse((await call(f.port, 'GET', '/api/proxy/capacity')).text)).toMatchObject({ state: 'limited', reason: 'wal_limit' });
      expect((await call(f.port, 'GET', '/api/health')).status).toBe(200);
      expect((await call(f.port, 'GET', '/api/proxy/requests')).status).toBe(200);
      expect((await call(f.port, 'GET', `/api/proxy/requests/${id}/body/request`)).text).toBe('synthetic committed request');
      const deleted = await call(f.port, 'POST', `/api/proxy/requests/${id}/original-deletion`, { expectedRequestId: 'committed', confirm: true });
      expect(deleted.status).toBe(200); expect(JSON.parse(deleted.text).state).toBe('complete');
      expect(await readdir(journal.directory)).toEqual([pending.entry.captureId + '.json']);
      expect(f.db.prepare('SELECT request_id FROM proxy_requests ORDER BY id').all()).toEqual([{ request_id: 'committed' }]);
      expect(await readFile(join(f.captureDirectory, pending.entry.requestBodyId + '.body'), 'utf8')).toBe('pending-prefix');
      expect((await stat(f.dbPath + '-wal')).size).toBeLessThan(20_000_000);
      reader.exec('ROLLBACK'); await f.start();
      expect((await call(f.port, 'GET', '/api/proxy/requests')).status).toBe(200);
      expect(f.db.prepare('SELECT request_id FROM proxy_requests ORDER BY id').all()).toEqual([{ request_id: 'committed' }, { request_id: 'pending-pressure' }]);
      expect(await readdir(journal.directory)).toEqual([]);
    } finally { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); await f.close(); }
  });
  it('continues actual forwarding at high WAL without a saved record or untracked original, then resumes after relief', async () => {
    const f = await fixture(); let calls = 0; const origin = createServer((req, res) => { calls += 1; req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"synthetic","content":[],"usage":{"input_tokens":1,"output_tokens":0}}'); }); });
    let reader: ReturnType<typeof openReadonly> | null = null;
    try {
      await f.start(); const proxyPort = await freePort(); await startProxy(f.port, proxyPort);
      await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${(origin.address() as AddressInfo).port}/v1/messages`;
      reader = pin(f.db, f.dbPath);
      const response = await call(proxyPort, 'POST', url, { model: 'synthetic', messages: [] }); expect(response.status).toBe(200); expect(response.text).toContain('"id":"synthetic"');
      expect((await call(f.port, 'POST', '/api/proxy/stop')).status).toBe(200);
      const status = JSON.parse((await call(f.port, 'GET', '/api/proxy/status')).text);
      expect(status.diagnostics.persistedRequests).toBe(0); expect(status.diagnostics.captureErrors).toBeGreaterThan(0); expect(status.diagnostics.lastError).toBe('CAPTURE_METADATA_LIMIT');
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      expect((await readdir(f.captureDirectory)).filter(name => name.endsWith('.body') || name.endsWith('.part'))).toEqual([]);
      expect(calls).toBe(1); reader.exec('ROLLBACK'); reader.close(); reader = null;
      await startProxy(f.port, proxyPort); expect((await call(proxyPort, 'POST', url, { model: 'synthetic', messages: [] })).status).toBe(200);
      expect((await call(f.port, 'POST', '/api/proxy/stop')).status).toBe(200);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 }); expect(calls).toBe(2);
      expect(JSON.parse((await call(f.port, 'GET', '/api/proxy/capacity')).text).state).toBe('ready');
    } finally { if (reader !== null) { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); } await new Promise<void>(resolve => origin.close(() => resolve())); await f.close(); }
  }, 15_000);

  it('keeps a real failed production capture journal/originals on native SQLITE_FULL and recovers without origin replay', async () => {
    const f = await fixture(); let calls = 0; const origin = createServer((req, res) => { calls += 1; req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"synthetic","content":[],"usage":{"input_tokens":1,"output_tokens":0}}'); }); });
    try {
      await f.start(); const proxyPort = await freePort(); await startProxy(f.port, proxyPort);
      await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${(origin.address() as AddressInfo).port}/v1/messages`;
      checkpointWal(f.db); const maximum = f.db.pragma('max_page_count', { simple: true }) as number, pages = f.db.pragma('page_count', { simple: true }) as number;
      const payload = { model: 'synthetic', system: 'synthetic-full-evidence-'.repeat(6000), messages: [] };
      f.db.pragma(`max_page_count=${pages}`);
      try {
        const forwarded = await call(proxyPort, 'POST', url, payload); expect(forwarded.status).toBe(200); expect(forwarded.text).toContain('"id":"synthetic"');
        expect((await call(f.port, 'POST', '/api/proxy/stop')).status).toBe(200);
        const status = JSON.parse((await call(f.port, 'GET', '/api/proxy/status')).text);
        expect(status.diagnostics.persistedRequests).toBe(0); expect(status.diagnostics.lastError).toBe('CAPTURE_METADATA_SQLITE_FULL');
        expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
        const journals = await readdir(join(f.captureDirectory, '.capture-journal')); expect(journals).toHaveLength(1);
        const entry = JSON.parse(await readFile(join(f.captureDirectory, '.capture-journal', journals[0]!), 'utf8'));
        expect(await readFile(join(f.captureDirectory, entry.requestBodyId + '.body'), 'utf8')).toBe(JSON.stringify(payload));
        expect((await stat(join(f.captureDirectory, entry.responseBodyId + '.body'))).size).toBeGreaterThan(0); expect(calls).toBe(1);
      } finally { f.db.pragma(`max_page_count=${maximum}`); }
      await f.start(); expect((await call(f.port, 'GET', '/api/proxy/requests')).status).toBe(200);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
      expect(await readdir(join(f.captureDirectory, '.capture-journal'))).toEqual([]); expect(calls).toBe(1);
    } finally { await new Promise<void>(resolve => origin.close(() => resolve())); await f.close(); }
  }, 15_000);
});
