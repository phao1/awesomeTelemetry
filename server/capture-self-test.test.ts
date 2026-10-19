import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import type { MonitorCaptureSelfTest, MonitorConnectionProfile } from '../src/core/trace-types.js';
import { createAgentObservabilityServer } from './server.js';
import { openWritable } from './storage/db.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'self-test-http-'));
  const db = openWritable(join(directory, 'state.sqlite'));
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'no-sources'); });
  const server = createAgentObservabilityServer({ db, config, caDirectory: join(directory, 'ca'), captureDirectory: join(directory, 'originals'), userConfigPath: join(directory, 'config.json'), launcherCliPath: join(process.cwd(), 'bin/agent-observe.js') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; cache: string | undefined; data: Record<string, unknown> }> => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, agent: false, headers: { 'content-type': 'application/json', ...headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'], data: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> }));
    }); req.once('error', reject); req.setTimeout(12_000, () => req.destroy(new Error('Synthetic HTTP deadline'))); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const finder = createServer(); await new Promise<void>(resolve => finder.listen(0, '127.0.0.1', resolve)); const proxyPort = (finder.address() as AddressInfo).port;
  await new Promise<void>(resolve => finder.close(() => resolve()));
  const created = await call('/api/proxy/profiles', 'POST', { label: 'Synthetic self-test', agent: 'claude', projectDirectory: directory, executable: null, proxyPort, noProxy: null });
  const profile = created.data as unknown as MonitorConnectionProfile;
  return { call, db, profile, path: `/api/proxy/profiles/${profile.id}/self-test`, async close() {
    try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    finally { db.close(); await rm(directory, { recursive: true, force: true }); }
  } };
}

describe('production self-test HTTP boundary', () => {
  it('requires saved revision and explicit running listener, then returns a real retained capture result', async () => {
    const f = await fixture(); try {
      const idle = await f.call(f.path, 'POST', { expectedRevision: 1 }); expect(idle.status).toBe(409); expect(idle.data.error).toMatchObject({ code: 'MONITOR_SELF_TEST_NOT_READY' });
      expect((await f.call('/api/proxy/status')).data.running).toBe(false);
      const conflict = await f.call(f.path, 'POST', { expectedRevision: 2 }); expect(conflict.status).toBe(409); expect(conflict.data.error).toMatchObject({ code: 'MONITOR_PROFILE_CONFLICT' });
      const started = await f.call(`/api/proxy/profiles/${f.profile.id}/start`, 'POST', { expectedRevision: 1 }); expect(started.status, JSON.stringify(started.data)).toBe(200);
      const result = await f.call(f.path, 'POST', { expectedRevision: 1 }); expect(result.status).toBe(200); expect(result.cache).toBe('no-store');
      const report = result.data as unknown as MonitorCaptureSelfTest; expect(report.passed).toBe(true); expect(report.agentVerified).toBe(false); expect(report.tlsVerified).toBe(false);
      const row = await f.call(`/api/proxy/requests/${report.proxyId}`); expect(row.data.model).toBe('agent-observe-self-test');
      expect((await f.call('/api/proxy/status')).data.running).toBe(true);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
    } finally { await f.close(); }
  });

  it('rejects destinations, queries, malformed revisions and untrusted Host/Origin without executing a test', async () => {
    const f = await fixture(); try {
      for (const body of [{}, { expectedRevision: 0 }, { expectedRevision: '1' }, { expectedRevision: 1, url: 'https://external.invalid' }]) {
        const result = await f.call(f.path, 'POST', body); expect(result.status).toBe(400); expect(result.data.error).toMatchObject({ code: 'BAD_REQUEST' });
      }
      const query = await f.call(f.path + '?url=http://127.0.0.1', 'POST', { expectedRevision: 1 }); expect(query.status).toBe(400);
      for (const headers of [{ host: 'external.invalid' }, { origin: 'https://external.invalid' }] as Array<Record<string, string>>) {
        const result = await f.call(f.path, 'POST', { expectedRevision: 1 }, headers); expect(result.status).toBe(400); expect(result.data.error).toMatchObject({ code: 'BAD_REQUEST' });
      }
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
    } finally { await f.close(); }
  });
});
