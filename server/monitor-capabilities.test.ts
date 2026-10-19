import Database from 'better-sqlite3';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import { PROVIDER_KEYS, type MonitorCapabilityReport } from '../src/core/trace-types.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capabilities-http-'));
  const db = new Database(':memory:'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'no-sources'); });
  const server = createAgentObservabilityServer({ db, config, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, headers: Record<string, string> = {}): Promise<{ status: number; cache: string | undefined; encoding: string | undefined; text: string }> => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, cache: res.headers['cache-control'], encoding: res.headers['content-encoding'],
        text: (res.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString('utf8') }); });
    }); req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Synthetic capabilities read timeout'))); req.end();
  });
  return { db, directory, call, async close() { try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    finally { db.close(); await rm(directory, { recursive: true, force: true }); } } };
}

describe('capability manifest production HTTP', () => {
  it('returns bounded no-store implementation evidence without CA/profile/DB mutation or Agent readiness claims', async () => {
    const f = await fixture();
    try {
      const files = await readdir(f.directory); const changes = f.db.prepare('SELECT total_changes() AS n').get();
      const result = await f.call('/api/proxy/capabilities'); expect(result.status).toBe(200); expect(result.cache).toBe('no-store');
      const data = JSON.parse(result.text) as MonitorCapabilityReport;
      expect(data.manifestVersion).toBe(1); expect(new Date(data.generatedAt).toISOString()).toBe(data.generatedAt);
      expect(data.agents.map(item => item.provider)).toEqual(PROVIDER_KEYS); expect(data.agents).toHaveLength(9);
      expect(data.agents.filter(item => item.processRecipe !== null).map(item => item.processRecipe)).toEqual(['claude', 'codex', 'opencode']);
      expect(data.agents.every(item => item.installedVersion === null && item.runtimeVerification === 'unverified')).toBe(true);
      expect(data.transports).toHaveLength(9); expect(data.transports.find(item => item.id === 'agent_websocket')).toEqual({ id: 'agent_websocket', level: 'controlled_test', testedPlatforms: ['darwin'] });
      expect(data.listener).toBe('shared_not_process_filtered'); expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(64 * 1024);
      expect(result.text).not.toContain(f.directory); expect(await readdir(f.directory)).toEqual(files); expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
      const status = await f.call('/api/proxy/status'); expect(JSON.parse(status.text).running).toBe(false);
      const zipped = await f.call('/api/proxy/capabilities', { 'accept-encoding': 'gzip' }); expect(zipped.encoding).toBe('gzip'); expect(JSON.parse(zipped.text).agents).toEqual(data.agents);
    } finally { await f.close(); }
  });
  it.each(['?unexpected=1', '?probe=1', '?mode=metadata', '?provider=codex&provider=claude'])('rejects all query parameters %s', async query => {
    const f = await fixture(); try { const result = await f.call('/api/proxy/capabilities' + query); expect(result.status).toBe(400); expect(JSON.parse(result.text)).toEqual({ error: { code: 'BAD_REQUEST', message: expect.any(String) } }); }
    finally { await f.close(); }
  });
  it('uses the local Host and Origin boundary', async () => {
    const f = await fixture(); try {
      for (const headers of [{ host: 'untrusted.invalid' }, { origin: 'https://untrusted.invalid' }] as Array<Record<string, string>>) {
        const result = await f.call('/api/proxy/capabilities', headers); expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
      }
    } finally { await f.close(); }
  });
});
