import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ExperimentRegistry, validateExperimentInput } from './registry.js';
import type { ExperimentInput } from './registry.js';
const dirs: string[] = [];
const input = (): ExperimentInput => ({ name: 'Manual trial', task: null, inputVersion: null, modelParameters: null, toolSet: null, mode: 'natural', runs: [] });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'experiment-test-')); dirs.push(dir); return { dir, store: new ExperimentRegistry(dir) }; }
const scanKeys = (keys: string[]) => keys;
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe('manual experiment registry', () => {
  it('persists create/update/delete across instances with monotonic revision and UTC timestamps', async () => {
    const { dir, store } = await fixture(); expect(await store.list()).toEqual({ version: 1, revision: 0, records: [] });
    const created = await store.mutate('create', null, 0, input(), scanKeys); const r = created.records[0]!;
    expect(created.revision).toBe(1); expect(new Date(r.createdAt).toISOString()).toBe(r.createdAt);
    const updated = await new ExperimentRegistry(dir).mutate('update', r.id, 1, { ...input(), name: 'Revised' }, scanKeys);
    expect(updated.records[0]).toMatchObject({ id: r.id, name: 'Revised', createdAt: r.createdAt });
    expect(await store.mutate('delete', r.id, 2, null, scanKeys)).toEqual({ version: 1, revision: 3, records: [] });
    expect(await readdir(dir)).toEqual(['experiment-records.json']);
  });
  it('allows only one concurrent CAS winner across store instances and rejects replayed create', async () => {
    const { dir, store } = await fixture();
    const results = await Promise.allSettled([store.mutate('create', null, 0, input(), scanKeys), new ExperimentRegistry(dir).mutate('create', null, 0, input(), scanKeys)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.list()).records).toHaveLength(1);
    await expect(store.mutate('create', null, 0, input(), scanKeys)).rejects.toMatchObject({ reason: 'CONFLICT' });
  });
  it('preserves deleted-session references and checks only newly added keys in one batch', async () => {
    const { store } = await fixture();
    const created = await store.mutate('create', null, 0, { ...input(), runs: [{ sessionKey: 'deleted', label: 'pass', note: 'Manual only' }] }, scanKeys);
    const calls: string[][] = [];
    const check = (keys: string[]) => { calls.push(keys); return []; };
    const edited = await store.mutate('update', created.records[0]!.id, 1, { ...input(), runs: created.records[0]!.runs }, check);
    expect(calls).toEqual([]); expect(edited.records[0]!.runs[0]!.label).toBe('pass');
    await expect(store.mutate('update', created.records[0]!.id, 2, { ...input(), runs: [...created.records[0]!.runs, { sessionKey: 'missing', label: 'unrated', note: null }] }, check)).rejects.toMatchObject({ reason: 'SESSION_UNAVAILABLE' });
    expect(calls).toEqual([['missing']]); expect((await store.list()).revision).toBe(2);
  });
  it.each([
    { ...input(), extra: true }, { ...input(), name: '' }, { ...input(), name: 'x'.repeat(121) },
    { ...input(), inputVersion: 'x'.repeat(257) }, { ...input(), task: undefined }, { ...input(), task: '\0' },
    { ...input(), mode: 'verified' }, { ...input(), runs: [{ sessionKey: 'x', label: 'success', note: null }] },
    { ...input(), runs: Array.from({ length: 17 }, (_, i) => ({ sessionKey: String(i), label: 'unrated', note: null })) },
    { ...input(), runs: [1, 2].map(() => ({ sessionKey: 'same', label: 'unrated', note: null })) },
  ])('rejects malformed or unbounded inputs %#', value => { expect(() => validateExperimentInput(value)).toThrow(); });
  it('bounds UTF8 bytes independently of character limits without truncation', () => {
    expect(() => validateExperimentInput({ ...input(), task: '中'.repeat(2000), modelParameters: '中'.repeat(2000), toolSet: '中'.repeat(2000) })).toThrow();
  });
  it.each(['{broken', JSON.stringify({ version: 2, revision: 0, records: [] }), ' '.repeat(1024 * 1024 + 1)])('preserves corrupt, future and oversized files %#', async contents => {
    const { store } = await fixture(); await writeFile(store.path, contents);
    await expect(store.list()).rejects.toMatchObject({ reason: 'UNAVAILABLE' });
    await expect(store.mutate('create', null, 0, input(), scanKeys)).rejects.toMatchObject({ reason: 'UNAVAILABLE' });
    expect(await readFile(store.path, 'utf8')).toBe(contents);
  });
  it('rejects symlink targets without changing the target', async () => {
    const { store, dir } = await fixture(); const target = join(dir, 'original.json'); await writeFile(target, 'original'); await symlink(target, store.path);
    await expect(store.mutate('create', null, 0, input(), scanKeys)).rejects.toMatchObject({ reason: 'UNAVAILABLE' }); expect(await readFile(target, 'utf8')).toBe('original');
  });
  it('preserves a pre-existing crash lock and reports busy', async () => {
    const { store } = await fixture(); await writeFile(store.path + '.lock', 'owner');
    await expect(store.mutate('create', null, 0, input(), scanKeys)).rejects.toMatchObject({ reason: 'BUSY' }); expect(await readFile(store.path + '.lock', 'utf8')).toBe('owner');
  });
  it('rejects revision overflow without overwriting the saved document', async () => {
    const { store } = await fixture(); const bytes = JSON.stringify({ version: 1, revision: Number.MAX_SAFE_INTEGER, records: [] }); await writeFile(store.path, bytes);
    await expect(store.mutate('create', null, Number.MAX_SAFE_INTEGER, input(), scanKeys)).rejects.toMatchObject({ reason: 'LIMIT' }); expect(await readFile(store.path, 'utf8')).toBe(bytes);
  });
  it('enforces 100 records and keeps unrelated app-owned files unchanged', async () => {
    const { store, dir } = await fixture(); await writeFile(join(dir, 'agent-config.json'), 'untouched');
    const one = await store.mutate('create', null, 0, input(), scanKeys);
    const records = Array.from({ length: 100 }, (_, i) => ({ ...one.records[0], id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}` }));
    await writeFile(store.path, JSON.stringify({ ...one, records }));
    await expect(store.mutate('create', null, 1, input(), scanKeys)).rejects.toMatchObject({ reason: 'LIMIT' }); expect(await readFile(join(dir, 'agent-config.json'), 'utf8')).toBe('untouched');
  });
  it('rejects a whole-document write over 1MiB and preserves the previous bytes', async () => {
    const { store } = await fixture();
    const large: ExperimentInput = { ...input(), task: 'x'.repeat(2000), modelParameters: 'x'.repeat(2000), toolSet: 'x'.repeat(2000), runs: Array.from({ length: 5 }, (_, i) => ({ sessionKey: String(i), label: 'unrated', note: 'x'.repeat(1900) })) };
    const first = await store.mutate('create', null, 0, large, scanKeys);
    const records = []; let previous = JSON.stringify(first);
    for (let i = 0; i < 100; i++) {
      records.push({ ...first.records[0]!, id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}` });
      const candidate = JSON.stringify({ ...first, records });
      if (Buffer.byteLength(candidate) > 1024 * 1024) break;
      previous = candidate;
    }
    await writeFile(store.path, previous);
    await expect(store.mutate('create', null, 1, large, scanKeys)).rejects.toMatchObject({ reason: 'LIMIT' });
    expect(await readFile(store.path, 'utf8')).toBe(previous);
  });

});
