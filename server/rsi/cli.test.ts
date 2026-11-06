import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freezeAgentProfile } from './agent-profile.js';
import { runRsiCli, defaultWorkerSettings } from './cli.js';
import { RsiStore } from './queue.js';
import { openWritable } from '../storage/db.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('trusted local CLI', () => {
  it('prints a worker plan without Docker and omits bearer digest from status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-')); dirs.push(root);
    const data = join(root, 'awesome-telemetry-data/rsi'), taskRoot = join(data, 'task'); await mkdir(join(taskRoot, 'private'), { recursive: true });
    const db = openWritable(join(data, 'index.db')), store = new RsiStore(db, taskRoot, 'task'), at = new Date().toISOString();
    try { await store.put({ event: 'task_put', payload: { id: 'task', repository: 'local', baselineCommit: 'a'.repeat(40), datasetHash: 'b'.repeat(64), mainMetric: 'passed_count', config: defaultRsiConfig(), state: 'created', pauseReason: null, delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: at, updatedAt: at } }, 'human'); }
    finally { db.close(); }
    const settings = defaultWorkerSettings(); settings.agent = await freezeAgentProfile('rsi-agents/opencode/profile.json', join(taskRoot, 'private/agent'));
    await writeFile(join(taskRoot, 'private/runtime.json'), JSON.stringify(settings));
    const rows: unknown[] = [];
    await runRsiCli(['worker', '--task', 'task', '--root', root], value => rows.push(value));
    expect(rows[0]).toMatchObject({ execute: false, taskId: 'task', concurrency: 2 });
    await runRsiCli(['task', 'status', '--task', 'task', '--root', root], value => rows.push(value));
    expect(JSON.stringify(rows[1])).not.toContain('taskTokenHash');
  });
  it('rejects accidental execution flags on other commands and ignored options', async () => {
    await expect(runRsiCli(['task', 'status', '--execute', '--task', 'task'])).rejects.toThrow('Invalid --execute');
    await expect(runRsiCli(['worker', '--settings', 'ignored', '--task', 'task'])).rejects.toThrow('Invalid RSI arguments');
    await expect(runRsiCli(['worker', '--task', '../unsafe'])).rejects.toThrow('Invalid task ID');
  });
});

it('validates an Agent without a task or Docker', async () => {
  const rows: unknown[] = [];
  await runRsiCli(['agent', 'validate', 'rsi-agents/mini-agent/profile.json'], v => rows.push(v));
  expect(rows).toEqual([{ valid: true, id: 'mini-agent' }]);
  await expect(runRsiCli(['agent', 'validate'])).rejects.toThrow('Usage');
});

it('doctor reports Linux/architecture/connectivity/disk and upstream presence without values', async () => {
  const { rsiDoctor } = await import('./cli.js');
  const calls: string[][] = [];
  const client = { run: async (argv: string[]) => {
    calls.push(argv); return { code: 0, stdout: Buffer.from(argv[0] === 'info' ? JSON.stringify({ OSType: 'linux', Architecture: 'aarch64' }) : 'version'), stderr: Buffer.alloc(0), timedOut: false, cancelled: false, overflow: false };
  } };
  const report = await rsiDoctor(client, tmpdir(), { RSI_UPSTREAM_BASE_URL: 'https://private.invalid', RSI_UPSTREAM_MODEL: 'private-model', RSI_UPSTREAM_API_KEY: 'private-key' });
  expect(report).toMatchObject({ checks: { docker: true, buildx: true, context: true, linux: true, architecture: true, upstream: true }, upstream: { RSI_UPSTREAM_API_KEY: true } });
  expect(JSON.stringify(report)).not.toMatch(/private/); expect(calls).toHaveLength(3);
  const failed = await rsiDoctor({ run: async () => { throw new Error('private-key'); } }, '/nonexistent/doctor-path', {});
  expect(failed).toMatchObject({ ok: false, checks: { docker: false, buildx: false, context: false, linux: false, upstream: false } });
  // A root that does not exist yet is measured through its nearest existing ancestor.
  expect((failed as { disk: { freeBytes: number | null } }).disk.freeBytes).toEqual(expect.any(Number));
  expect(JSON.stringify(failed)).not.toContain('private-key');
});
