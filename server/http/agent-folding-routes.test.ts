import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { Router } from './router.js';
import { registerAgentFoldingRoutes } from './agent-folding-routes.js';
import type { AgentFoldingRouteOptions } from './agent-folding-routes.js';
import { TaskReadError } from '../storage/task-workbench.js';
import { loadFoldingExample } from '../agent-folding/catalog.js';
import { DEFAULT_FOLDING_PLAN } from '../agent-folding/catalog.js';
import { validateFoldingProject } from '../../src/core/agent-folding-validation.js';

const resources: Array<{ server: Server; dir: string; close: () => void }> = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.close(); r.server.closeAllConnections(); await new Promise<void>(resolve => r.server.close(() => resolve())); await rm(r.dir, { recursive: true, force: true }); } });
async function setup(options: AgentFoldingRouteOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'folding-route-')), router = new Router(), close = registerAgentFoldingRoutes(router, dir, options);
  const server = createServer((req, res) => { const match = router.match(req.method ?? 'GET', new URL(req.url ?? '/', 'http://127.0.0.1').pathname); if (match) void match.handler(req, res, match.params); else { res.writeHead(404); res.end(); } });
  resources.push({ server, dir, close }); await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent-folding`;
  return { base, dir, post: (path: string, body: unknown) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
}
it('explicitly reads pinned official records and exports inert artifacts without running drivers', async () => {
  const f = await setup(), response = await fetch(`${f.base}/example`); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const project = validateFoldingProject(await response.json()); expect(project.trials.length).toBeGreaterThan(100);
  const artifacts = await f.post('artifacts', { project }); expect(artifacts.status).toBe(200); expect(Array.isArray(await artifacts.json())).toBe(true);
  expect((await f.post('smoke', { provider: 'anthropic', model: 'not-allowed' })).status).toBe(400);
  expect((await f.post('smoke', { repository: '/private' })).status).toBe(400);
});
it('runs only the fixed unscored fixture and rejects invalid request bodies', async () => {
  const f = await setup(), response = await f.post('smoke', {}); expect(response.status).toBe(200);
  const report = validateFoldingProject(await response.json()); expect(report.trials.length).toBe(19 * 2 * (DEFAULT_FOLDING_PLAN.skillAblation ? 3 : 2)); expect(report.trials.every(t => t.grade === null)).toBe(true);
  expect((await f.post('artifacts', { project: {} })).status).toBe(400);
}, 20000);
it('owns one cancellable job, accepts long native identities, validates query and preserves task error statuses', async () => {
  let signal: AbortSignal | null = null, started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const f = await setup({ loadNative: async (_task, _member, current) => { signal = current; started(); return new Promise((_resolve, reject) => current.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } });
  const controller = new AbortController(), pending = fetch(`${f.base}/tasks/${'x'.repeat(500)}?member=${'m'.repeat(500)}`, { signal: controller.signal }).catch(() => null);
  await ready;
  expect((await fetch(`${f.base}/tasks/other`)).status).toBe(409); controller.abort(); await pending;
  const deadline = Date.now() + 1000; while (!(signal as AbortSignal | null)?.aborted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
  expect((await fetch(`${f.base}/tasks/x?member=a&member=b`)).status).toBe(400);
  expect((await fetch(`${f.base}/tasks/x?unknown=a`)).status).toBe(400);
  const missing = await setup({ loadNative: async () => { throw new TaskReadError('SESSION_NOT_FOUND', 'Missing task'); } }); expect((await fetch(`${missing.base}/tasks/missing`)).status).toBe(404);
  const valid = await setup({ loadNative: async () => loadFoldingExample() }); expect((await fetch(`${valid.base}/tasks/a`)).status).toBe(200);
});

it('validates read-only scope and comparison requests before loading and bounds concurrency independently', async () => {
  const project = await loadFoldingExample(); let calls = 0;
  const f = await setup({ loadScope: async () => { calls++; return project; }, loadComparison: async (a, b) => ({ a, b }) });
  for (const scope of [{ bad: true }, { provider: 'opencode' }, { taskIds: [1] }, { taskIds: 'oops' }, { from: 'bad' }, { cwd: 1 }]) expect((await f.post('scope', scope)).status).toBe(400);
  expect(calls).toBe(0); const valid = await f.post('scope', { provider: 'claude' }); expect(valid.status).toBe(200); expect(valid.headers.get('cache-control')).toBe('no-store'); expect(calls).toBe(1);
  for (const body of [{ a: [], b: [] }, { a: ['collected:a'], b: ['collected:a'] }, { a: ['imported:a'], b: ['collected:b'] }]) expect((await f.post('compare', body)).status).toBe(400);
  expect((await f.post('compare', { a: ['collected:a'], b: ['collected:b'] })).status).toBe(200);
});
