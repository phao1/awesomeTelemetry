import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBank, validateQuestion } from './bank.js';
const fixture = resolve('server/rsi/__fixtures__/bank'), directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function copy(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'bank-')); directories.push(root); await cp(fixture, root, { recursive: true }); return root; }
describe('RSI-011 bank boundary', () => {
  it('validates the three-language miniature bank and hashes all private contents', async () => {
    const bank = await readBank(fixture); expect(bank.questions.size).toBe(9); expect(bank.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await readBank(fixture)).datasetHash).toBe(bank.datasetHash);
    const root = await copy(); await writeFile(join(root, 'tasks/train_node/reference.patch'), 'changed');
    expect((await readBank(root)).datasetHash).not.toBe(bank.datasetHash);
  });
  it('rejects overlapping splits', async () => {
    const root = await copy(), file = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.sets.sealed[0] = manifest.sets.train[0]; await writeFile(file, JSON.stringify(manifest));
    await expect(readBank(root)).rejects.toThrow('overlap');
  });
  it('rejects leaked private question metadata', async () => {
    const root = await copy(); await writeFile(join(root, 'tasks/train_node/statement.md'), 'Please solve train_node');
    await expect(readBank(root)).rejects.toThrow('leaks');
  });
  it('rejects unknown fields, mismatched toolchains and argv options', async () => {
    const bank = await readBank(fixture), q = bank.questions.get('train_node')!;
    expect(() => validateQuestion({ ...q, unexpected: true })).toThrow();
    expect(() => validateQuestion({ ...q, report: 'go-test-json' })).toThrow();
    expect(() => validateQuestion({ ...q, testTargets: ['--eval=evil'] })).toThrow();
    expect(() => validateQuestion({ ...q, testTargets: ['../outside'] })).toThrow();
  });
});
