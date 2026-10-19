import Database from 'better-sqlite3';
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import type { TraceLogImportResult, TraceLogPage, TraceLogTurn, TraceLogTurnDetail } from '../src/core/trace-types.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'trace-import-http-')), db = new Database(':memory:'); db.pragma('foreign_keys=ON'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'none'); });
  const server = createAgentObservabilityServer({ db, config, captureDirectory: join(directory, 'bodies'), userConfigPath: join(directory, 'config.json'), caDirectory: join(directory, 'ca') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as AddressInfo).port;
  const call = async (path: string, bytes?: Buffer, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: bytes === undefined ? 'GET' : 'POST', headers: {
      ...(bytes === undefined ? {} : { 'content-type': 'application/octet-stream', 'x-trace-filename': 'trace.json', 'content-length': String(bytes.length) }), ...headers,
    } }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { const raw = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes: res.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw }); });
    }); req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Synthetic HTTP timeout'))); req.end(bytes);
  });
  return { db, server, call, async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); await rm(directory, { recursive: true, force: true }); } };
}
const source = Buffer.from(JSON.stringify({ session: { session_id: 'native-http', ide_type: 'codex', title: 'Synthetic HTTP import' }, turns: [
  { turn_id: 'http-turn', turn_number: 1, system_prompt: 'SYNTHETIC_UNREDACTED_SYSTEM', messages: '[{"role":"user","content":"你好"}]', output_text: 'SYNTHETIC_ANSWER', total_tokens: 31 },
] }, null, 2));
describe('production local TraceLog HTTP routes', () => {
  it('uploads/imports once, pages metadata without body IO, reads selected originals and streams byte-exact download without model calls', async () => {
    const f = await fixture();
    try {
      const uploaded = await f.call('/api/trace-imports', source, { 'accept-encoding': 'gzip' }); expect(uploaded.status).toBe(200); expect(uploaded.headers['cache-control']).toBe('no-store');
      const result = JSON.parse(uploaded.bytes.toString()) as TraceLogImportResult, session = result.items[0]!.session;
      expect(result.items[0]!.state).toBe('imported'); expect(JSON.stringify(result)).not.toContain('SYNTHETIC_UNREDACTED_SYSTEM');
      const page = await f.call('/api/trace-imports'); expect(page.status).toBe(200); expect(page.bytes.toString()).not.toContain('SYNTHETIC_ANSWER'); expect(page.bytes.toString()).not.toContain('bodies');
      const turns = await f.call(`/api/trace-imports/${session.id}/turns`); expect(turns.status).toBe(200);
      expect((JSON.parse(turns.bytes.toString()) as TraceLogPage<TraceLogTurn>).items[0]).toMatchObject({ sequence: 0, turnId: 'http-turn', reported: { total_tokens: 31 } });
      expect(turns.bytes.toString()).not.toMatch(/SYNTHETIC_UNREDACTED|SYNTHETIC_ANSWER|messages|system_prompt/);
      const detail = await f.call(`/api/trace-imports/${session.id}/turns/0`); expect(detail.status).toBe(200);
      expect((JSON.parse(detail.bytes.toString()) as TraceLogTurnDetail).raw).toMatchObject({ system_prompt: 'SYNTHETIC_UNREDACTED_SYSTEM', output_text: 'SYNTHETIC_ANSWER' });
      const download = await f.call(`/api/trace-imports/${session.id}/source`); expect(download.status).toBe(200); expect(download.bytes).toEqual(source); expect(download.headers['x-trace-sha256']).toBe(session.id);
      expect(download.headers['content-disposition']).toContain('.json'); expect(download.headers['x-content-type-options']).toBe('nosniff');
      const duplicate = await f.call('/api/trace-imports', source); expect((JSON.parse(duplicate.bytes.toString()) as TraceLogImportResult).items[0]!.state).toBe('duplicate');
      expect(f.db.prepare('SELECT COUNT(1) AS n FROM proxy_requests').get()).toEqual({ n: 0 }); expect(f.db.prepare('SELECT COUNT(1) AS n FROM sessions').get()).toEqual({ n: 0 });
    } finally { await f.close(); }
  });
  it.each<Record<string, string>>([{ host: 'evil.example' }, { origin: 'https://evil.example' }])('guards every import API against nonlocal Host/Origin %j', async headers => {
    const f = await fixture();
    try {
      for (const path of ['/api/trace-imports', '/api/trace-imports/' + 'a'.repeat(64) + '/source']) {
        const result = await f.call(path, undefined, headers); expect(result.status).toBe(400); expect(JSON.parse(result.bytes.toString())).toMatchObject({ error: { code: 'BAD_REQUEST' } });
      }
      expect((await f.call('/api/trace-imports', source, headers)).status).toBe(400); expect(f.db.prepare('SELECT COUNT(1) AS n FROM trace_log_imports').get()).toEqual({ n: 0 });
    } finally { await f.close(); }
  });
  it('returns unified static errors for malformed/unsupported input, pagination/identity and missing records', async () => {
    const f = await fixture();
    try {
      for (const [bytes, header] of [[Buffer.from('{}'), {}], [source, { 'x-trace-filename': '../secret.json' }], [source, { 'content-type': 'application/json' }], [source, { 'x-trace-filename': '%' }]] as const) {
        const response = await f.call('/api/trace-imports', bytes, header); expect(response.status).toBe(400); expect(JSON.parse(response.bytes.toString())).toEqual({ error: { code: 'TRACE_IMPORT_INVALID', message: 'TRACE_IMPORT_INVALID' } });
      }
      for (const path of ['/api/trace-imports?limit=21', '/api/trace-imports?offset=-1', '/api/trace-imports/not-id/turns']) expect((await f.call(path)).status).toBe(400);
      const missing = await f.call(`/api/trace-imports/${'f'.repeat(64)}/turns`); expect(missing.status).toBe(404); expect(JSON.parse(missing.bytes.toString())).toMatchObject({ error: { code: 'TRACE_IMPORT_NOT_FOUND' } });
    } finally { await f.close(); }
  });
  it('blocks import while a real proxy listener is running, without stopping or adding traffic', async () => {
    const f = await fixture(), available = createServer(); await new Promise<void>(resolve => available.listen(0, '127.0.0.1', resolve)); const port = (available.address() as AddressInfo).port; await new Promise<void>(resolve => available.close(() => resolve()));
    try {
      expect((await f.call('/api/proxy/start', Buffer.from(JSON.stringify({ port })), { 'content-type': 'application/json' })).status).toBe(200);
      for (let i = 0; i < 50; i += 1) { const status = JSON.parse((await f.call('/api/proxy/status')).bytes.toString()) as { running: boolean }; if (status.running) break; await new Promise(resolve => setTimeout(resolve, 20)); }
      const response = await f.call('/api/trace-imports', source); expect(response.status).toBe(409); expect(JSON.parse(response.bytes.toString())).toMatchObject({ error: { code: 'PROXY_MAINTENANCE' } });
      expect(f.db.prepare('SELECT COUNT(1) AS n FROM trace_log_imports').get()).toEqual({ n: 0 });
      expect(JSON.parse((await f.call('/api/proxy/status')).bytes.toString())).toMatchObject({ running: true });
    } finally { await f.close(); }
  });
});
