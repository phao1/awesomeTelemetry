import Database from 'better-sqlite3';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createAgentObservabilityServer } from '../server.js';
import { initSchema } from '../storage/schema.js';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import { validateBenchmarkReport } from '../../src/core/benchmark-validation.js';
import { runSuccess } from '../../src/core/benchmark-analysis.js';

const resources: Array<{ dir: string; db: Database.Database; server: Server }> = [];
afterEach(async () => { for (const r of resources.splice(0)) { await new Promise<void>((resolve, reject) => r.server.close(e => e ? reject(e) : resolve())); r.db.close(); await rm(r.dir, { recursive: true, force: true }); } });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'benchmark-route-')), db = new Database(':memory:'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(p => { p.enabled = false; });
  const server = createAgentObservabilityServer({ db, config, userConfigPath: join(dir, 'config.json'), caDirectory: join(dir, 'ca') });
  resources.push({ dir, db, server });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/benchmarks/demo`;
  const call = (body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { dir, call };
}
const input = { name: 'GUI workflow example', repetitions: 3, variants: [{ product: 'Qoder GUI', model: 'same-model' }, { product: 'CodeArts GUI', model: 'same-model' }] };
it('executes six real isolated local examples and returns a synthetic report without model claims', async () => {
  const f = await setup(), response = await f.call(input);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const report = validateBenchmarkReport(await response.json()); expect(report.synthetic).toBe(true); expect(report.runs).toHaveLength(6);
  expect(report.runs.filter(r => runSuccess(r, 3))).toHaveLength(3);
  expect(report.runs.every(r => r.telemetry?.actualModel === null)).toBe(true);
  expect(report.runs.every(r => r.telemetry?.spans[0]?.kind === 'tool')).toBe(true);
  expect((await readdir(join(f.dir, 'benchmark-demos'))).length).toBe(1);
}, 15000);
it('rejects untrusted origins and executable/path injection before creating a demo', async () => {
  const f = await setup();
  expect((await f.call(input, { origin: 'https://foreign.invalid' })).status).toBe(400);
  for (const body of [{ ...input, driver: ['sh'] }, { ...input, repository: '/secret' }, { ...input, repetitions: 0 }, { ...input, name: 'x'.repeat(5000) }]) {
    const r = await f.call(body); expect(r.status).toBe(400); expect(await r.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  }
  expect(await readdir(f.dir)).not.toContain('benchmark-demos');
});
it('does not run two GUI-example jobs concurrently', async () => {
  const f = await setup();
  const results = await Promise.all([f.call(input), f.call(input)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  await Promise.all(results.map(r => r.text()));
}, 15000);
