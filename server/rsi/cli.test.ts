import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freezeOptimizerProfile } from './optimizer-profile.js';
import { freezeAgentProfile } from './agent-profile.js';
import { runRsiCli, defaultWorkerSettings } from './cli.js';
import { RsiStore } from './queue.js';
import { openWritable } from '../storage/db.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { readBank } from './bank.js';
import { verifyLedger } from './ledger.js';
import type { HealthModelClient } from '../task-health/model-client.js';
import type { RsiMonitorCalibration } from '../../src/core/rsi-types.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('trusted local CLI', () => {
  it('prints a worker plan without Docker and omits bearer digest from status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-')); dirs.push(root);
    const data = join(root, 'awesome-telemetry-data/rsi'), taskRoot = join(data, 'task'); await mkdir(join(taskRoot, 'private'), { recursive: true });
    const db = openWritable(join(data, 'index.db')), store = new RsiStore(db, taskRoot, 'task'), at = new Date().toISOString();
    try { await store.put({ event: 'task_put', payload: { id: 'task', repository: 'local', baselineCommit: 'a'.repeat(40), datasetHash: 'b'.repeat(64), mainMetric: 'passed_count', config: defaultRsiConfig(), state: 'created', pauseReason: null, delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0, monitorCalibration: null, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: at, updatedAt: at } }, 'human'); }
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
  it.each([
    [['--task', 'one'], '--task and --execute together'],
    [['--execute'], '--task and --execute together'],
    [['--task', '../other', '--execute'], 'Invalid task ID'],
    [['--port', '0'], 'port from 1 to 65535'],
    [['--port', '65536'], 'port from 1 to 65535'],
    [['--docker-context', 'colima-rsi'], 'Worker and monitor options require'],
    [['--task', 'one', '--execute', '--monitor', 'external', '--monitor-port', '9000'], '--monitor-port is for an owned bridge'],
    [['--task', 'one', '--execute', '--monitor-base-url', 'https://custom.invalid/v1'], '--monitor-base-url requires --monitor external'],
    [['--root', '/a', '--root', '/b'], 'Invalid rsi serve arguments'],
  ] as const)('rejects invalid serve arguments %j before service startup', async (args, message) => {
    await expect(runRsiCli(['serve', ...args])).rejects.toThrow(message);
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

async function calibrationTask(): Promise<{ root: string; taskRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'rsi-calibrate-cli-')); dirs.push(root);
  const data = join(root, 'awesome-telemetry-data/rsi'), taskRoot = join(data, 'task');
  await mkdir(join(taskRoot, 'private'), { recursive: true });
  await cp('server/rsi/__fixtures__/bank', join(taskRoot, 'private/bank'), { recursive: true });
  const bank = await readBank(join(taskRoot, 'private/bank'));
  const db = openWritable(join(data, 'index.db')), store = new RsiStore(db, taskRoot, 'task'), at = new Date().toISOString();
  try {
    await store.put({ event: 'task_put', payload: { id: 'task', repository: 'local', baselineCommit: 'a'.repeat(40), datasetHash: bank.datasetHash,
      mainMetric: 'passed_count', config: defaultRsiConfig(), state: 'created', pauseReason: null, delta: null,
      baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0,
      monitorCalibration: null, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: at, updatedAt: at } }, 'human');
  } finally { db.close(); }
  const settings=defaultWorkerSettings();settings.optimizer=await freezeOptimizerProfile('rsi-agents/optimizers/opencode-deepseek/profile.json',join(taskRoot,'private/optimizer'));
  await writeFile(join(taskRoot, 'private/runtime.json'), JSON.stringify(settings));
  return { root, taskRoot };
}
const cleanModel = (): HealthModelClient => ({ create: vi.fn(async () => ({ text: '{"conclusions":[]}', inputTokens: 10, outputTokens: 5 })) });

describe('RSI-015 calibration CLI without ports, Docker or real models', () => {
  it('defaults to five samples per stratum and writes an insufficient report and usage to the ledger', async () => {
    const { root, taskRoot } = await calibrationTask(), client = cleanModel(), rows: unknown[] = [];
    await runRsiCli(['calibrate', '--task', 'task', '--root', root], value => rows.push(value), { modelClient: client });
    const report = rows[0] as RsiMonitorCalibration;
    expect(report.status).toBe('insufficient'); expect(report.message).toBe('样本不足，不能说明监控达标');
    expect(report.categories).toHaveLength(7); expect(report.categories.every(c => c.samples === 5 && c.valid === 5)).toBe(true);
    expect(client.create).toHaveBeenCalledTimes(35);
    expect(report.deterministic).toHaveLength(6);
    expect(report.deterministic.filter(c => c.category !== 'benign').every(c => c.samples === 30 && c.detected === 30)).toBe(true);
    const db = openWritable(join(root, 'awesome-telemetry-data/rsi/index.db'));
    try { const task = new RsiStore(db, taskRoot, 'task').task(); expect(task.monitorCalibration).toEqual(report); expect(task.tokenUsage).toBe(525); }
    finally { db.close(); }
    expect((await verifyLedger(join(taskRoot, 'ledger.jsonl'), { taskId: 'task' })).valid).toBe(true);
  }, 30000);
  it('accepts sample all and persists a sufficient failed calibration', async () => {
    const { root } = await calibrationTask(), client = cleanModel(), rows: unknown[] = [];
    await runRsiCli(['calibrate', '--task', 'task', '--root', root, '--sample', 'all'], value => rows.push(value), { modelClient: client });
    const report = rows[0] as RsiMonitorCalibration;
    expect(report.status).toBe('failed'); expect(report.categories.every(c => c.samples === 30 && c.valid === 30)).toBe(true);
    expect(client.create).toHaveBeenCalledTimes(210);
  }, 30000);
  it('rejects identical families before any model request or worker execution', async () => {
    const { root } = await calibrationTask(), client = cleanModel();
    for (const command of ['calibrate', 'worker']) await expect(runRsiCli([command, '--task', 'task', '--root', root, '--monitor-family', 'deepseek'], () => {}, { modelClient: client })).rejects.toThrow('families must differ');
    expect(client.create).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '1.5', 'ALL', 'invalid'])('rejects invalid sample %s without calling the model', async sample => {
    const { root } = await calibrationTask(), client = cleanModel();
    await expect(runRsiCli(['calibrate', '--task', 'task', '--root', root, '--sample', sample], () => {}, { modelClient: client })).rejects.toThrow('Invalid calibration sample');
    expect(client.create).not.toHaveBeenCalled();
  });
});
