import Database from 'better-sqlite3';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import { validateTeamExperimentReport } from '../../src/core/team-experiment-validation.js';
import { createAgentObservabilityServer } from '../server.js';
import { initSchema } from '../storage/schema.js';

const resources: Array<{ directory: string; db: Database.Database; server: Server }> = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await new Promise<void>((resolve, reject) => r.server.close(error => error ? reject(error) : resolve()));
    r.db.close(); await rm(r.directory, { recursive: true, force: true });
  }
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'team-experiment-route-')), db = new Database(':memory:'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(p => { p.enabled = false; });
  const server = createAgentObservabilityServer({ db, config, enableMonitoring: false, userConfigPath: join(directory, 'config.json'), caDirectory: join(directory, 'ca') });
  resources.push({ directory, db, server });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/team-experiments/demo`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { directory, base, call };
}
const input = { name: 'Paired modes', repetitions: 1, schedule: 'parallel', variants: [{ mode: 'single_loop', prompt: 'Complete the task in one loop.' }, { mode: 'subagents', prompt: 'Delegate independent pieces of the same task.' }] };
it('runs isolated paired fixtures and returns named acceptance while monitoring and capture remain off', async () => {
  const f = await setup(), response = await f.call(input);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const report = validateTeamExperimentReport(await response.json());
  expect(report.synthetic).toBe(true); expect(report.plan.schedule).toBe('parallel'); expect(report.trials).toHaveLength(2);
  expect(report.trials.every(t => t.run.status === 'completed' && t.cases?.every(c => c.status === 'passed'))).toBe(true);
  expect((await readdir(join(f.directory, 'team-experiment-demos'))).length).toBe(1);
  const monitoring = await (await fetch(`${f.base}/api/monitoring`)).json() as { enabled: boolean };
  const proxy = await (await fetch(`${f.base}/api/proxy/status`)).json() as { running: boolean };
  const frida = await (await fetch(`${f.base}/api/frida/status`)).json() as { running: boolean };
  expect(monitoring.enabled).toBe(false); expect(proxy.running).toBe(false); expect(frida.running).toBe(false);
}, 20000);
it('rejects untrusted hosts/origins and arbitrary commands or paths before creating fixture artifacts', async () => {
  const f = await setup();
  expect((await f.call(input, { origin: 'https://untrusted.invalid' })).status).toBe(400);
  // Fetch normalizes Host; use a real wire-level header for the Host guard.
  const hostileHost = await new Promise<number>((resolve, reject) => {
    const req = request(`${f.base}/api/team-experiments/demo`, { method: 'POST', headers: { host: 'untrusted.invalid', 'content-type': 'application/json' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode!)); res.once('error', reject); });
    req.once('error', reject); req.end(JSON.stringify(input));
  });
  expect(hostileHost).toBe(400);
  for (const body of [{ ...input, driver: ['sh'] }, { ...input, repository: '/private' }, { ...input, repetitions: 0 }, { ...input, variants: [{ ...input.variants[0], driver: ['node'] }, input.variants[1]] }, { ...input, name: 'x'.repeat(513 * 1024) }]) {
    const response = await f.call(body); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  }
  expect(await readdir(f.directory)).not.toContain('team-experiment-demos');
});
it('holds a single active HTTP fixture job even though its drivers run concurrently', async () => {
  const f = await setup();
  const responses = await Promise.all([f.call(input), f.call(input)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  await Promise.all(responses.map(r => r.text()));
}, 20000);
it('cancels the owned fixture on client disconnect and preserves a terminal partial report', async () => {
  const f = await setup(), controller = new AbortController();
  const pending = fetch(`${f.base}/api/team-experiments/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, repetitions: 10 }), signal: controller.signal }).then(() => 'response', () => 'aborted');
  let reportPath: string | null = null;
  try {
    const deadline = Date.now() + 10000;
    while (!reportPath && Date.now() < deadline) {
      try {
        const [id] = await readdir(join(f.directory, 'team-experiment-demos'));
        if (id) { const path = join(f.directory, 'team-experiment-demos', id, 'results', 'report.json'); await readFile(path); reportPath = path; }
      } catch { /* Waiting for this request's owned report to exist. */ }
      if (!reportPath) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(reportPath).not.toBeNull();
  } finally { controller.abort(); }
  expect(await pending).toBe('aborted');
  let terminal = false;
  const deadline = Date.now() + 10000;
  while (!terminal && Date.now() < deadline) {
    const report = validateTeamExperimentReport(JSON.parse(await readFile(reportPath!, 'utf8')));
    terminal = report.trials.length === 2 && report.trials.every(t => t.run.status === 'cancelled');
    if (terminal) expect(report.trials.every(t => t.repetition === 1)).toBe(true);
    else await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(terminal).toBe(true);
}, 20000);
