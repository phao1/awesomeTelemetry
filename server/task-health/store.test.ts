import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeTaskHealth } from '../../src/core/task-health/report.js';
import type { HealthInput, HealthReport } from '../../src/core/task-health/types.js';
import { atomicHealthWrite, createHealthReportStore } from './store.js';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'health-store-')); vi.stubGlobal('fetch', vi.fn()); });
afterEach(async () => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); });
async function report(): Promise<HealthReport> { const i = JSON.parse(await readFile('src/core/__fixtures__/task-health/g1-serial.input.json', 'utf8')) as HealthInput; return analyzeTaskHealth(i, undefined, { id: randomUUID(), generatedAt: '2026-10-30T00:00:00.000Z' }); }
const taskDir = (r: HealthReport) => join(dir, 'task-health-reports', createHash('sha256').update(r.taskId).digest('hex'));
it('atomically saves report and metadata-only index and reuses exact versions/scope/thresholds', async () => {
  const store = createHealthReportStore(dir), r = await report(); await store.save(r);
  expect(JSON.parse(await readFile(join(taskDir(r), 'index.json'), 'utf8'))).toEqual({ items: [{ id: r.id, generatedAt: r.generatedAt, mode: 'standard', revision: r.revision, expired: false, reportId: null }] });
  expect(await store.get(r.id)).toEqual(r); expect(await store.bytes(r.id)).toBe(JSON.stringify(r));
  expect(await store.reusable(r.taskId, r.revision, r.scope, r.thresholds)).toEqual(r);
  expect(await store.reusable(r.taskId, r.revision, { ...r.scope, member: 'main' }, r.thresholds)).toBeNull();
  expect(await store.save({ ...r, id: randomUUID() })).toEqual(r); expect(await readdir(taskDir(r))).toHaveLength(2);
});
it('aborted atomic writes leave no partial final or temp and preserve existing files', async () => {
  const path = join(dir, 'report.json'); await atomicHealthWrite(path, 'old');
  const signal = new AbortController(); signal.abort(); await expect(atomicHealthWrite(path, 'new', signal.signal)).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe('old'); expect(await readdir(dir)).toEqual(['report.json']);
});
it('interruption during a write removes the temporary file', async () => {
  const controller = new AbortController(), path = join(dir, 'interrupted.json');
  const pending = atomicHealthWrite(path, 'x'.repeat(8 * 1024 * 1024), controller.signal);
  setImmediate(() => controller.abort()); await expect(pending).rejects.toThrow(); expect(await readdir(dir)).toEqual([]);
});
it('enforces 50 reports without eviction, but allows reuse at capacity', async () => {
  const store = createHealthReportStore(dir), base = await report();
  for (let i = 0; i < 50; i++) await store.save({ ...base, id: randomUUID(), revision: String(i) });
  await expect(store.save({ ...base, revision: 'new' })).rejects.toMatchObject({ code: 'HEALTH_REPORT_LIMIT', status: 409 });
  const prior = await store.reusable(base.taskId, '49', base.scope, base.thresholds); expect(prior).not.toBeNull();
  expect((await store.list(base.taskId, '49')).items).toHaveLength(50); expect((await readdir(taskDir(base))).filter(n => n.endsWith('.json'))).toHaveLength(51);
});
it('explicit history reconciles orphan reports, excludes interrupted temps and marks old revisions expired', async () => {
  const store = createHealthReportStore(dir), r = await report(); await mkdir(taskDir(r), { recursive: true });
  await writeFile(join(taskDir(r), r.id + '.json'), JSON.stringify(r)); await writeFile(join(taskDir(r), 'interrupted.tmp'), '{');
  const list = await store.list(r.taskId, null); expect(list.items[0]).toMatchObject({ id: r.id, expired: true }); expect(JSON.parse(await readFile(join(taskDir(r), 'index.json'), 'utf8')).items).toHaveLength(1);
  expect(await store.get(r.id)).toEqual(r);
});
it('a failed index replacement retains the saved report for explicit recovery', async () => {
  const store = createHealthReportStore(dir), r = await report(); await mkdir(join(taskDir(r), 'index.json'), { recursive: true });
  await expect(store.save(r)).rejects.toMatchObject({ code: 'HEALTH_STORAGE_FAILED' }); expect(await store.get(r.id)).toEqual(r);
  await rm(join(taskDir(r), 'index.json'), { recursive: true }); expect((await store.list(r.taskId, r.revision)).items[0]?.id).toBe(r.id);
});
it('serializes concurrent saves so quota/index cannot be lost', async () => {
  const store = createHealthReportStore(dir), r = await report();
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.save({ ...r, id: randomUUID(), revision: String(i) })));
  expect((await store.list(r.taskId, r.revision)).items).toHaveLength(8);
});
it('rejects path traversal, oversized files and malformed orphan reports', async () => {
  const store = createHealthReportStore(dir), r = await report(); await expect(store.get('../index')).rejects.toMatchObject({ status: 404 });
  await mkdir(taskDir(r), { recursive: true }); await writeFile(join(taskDir(r), r.id + '.json'), '{}'); await expect(store.list(r.taskId, null)).rejects.toMatchObject({ code: 'HEALTH_STORAGE_FAILED' });
  await expect(store.save({ ...r, limitations: ['x'.repeat(1024 * 1024)] })).rejects.toMatchObject({ code: 'HEALTH_SIZE_LIMIT' });
});
