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

it('small selection follows manifest question order, retains smoke and all original invariants', async () => {
  const { selectBankSubset, freezeBank } = await import('./bank.js');
  const bank = await readBank(resolve('rsi-bank'));
  const small = selectBankSubset(bank.manifest, 'small');
  expect(selectBankSubset(bank.manifest, 'full')).toEqual(bank.manifest);
  expect(small.sets.smoke).toEqual(bank.manifest.sets.smoke);
  for (const split of ['train', 'sealed', 'final'] as const) {
    const nonSmoke = bank.manifest.questions.filter(q => bank.manifest.sets[split].includes(q.id) && (split !== 'train' || !bank.manifest.sets.smoke.includes(q.id)));
    const firsts = nonSmoke.filter((q, i) => nonSmoke.findIndex(other => other.language === q.language) === i).map(q => q.id);
    const keep = new Set([...(split === 'train' ? small.sets.smoke : []), ...firsts]);
    expect(small.sets[split]).toEqual(bank.manifest.sets[split].filter(id => keep.has(id)));
  }
  expect(small.questions.length).toBeLessThan(bank.manifest.questions.length);
  expect(selectBankSubset(bank.manifest, 'small')).toEqual(small);
  const root = await mkdtemp(join(tmpdir(), 'small-bank-')); directories.push(root);
  const frozen = await freezeBank(bank, root, 'small');
  expect(frozen.manifest).toEqual(small); expect(frozen.datasetHash).not.toBe(bank.datasetHash);
  expect((await readBank(root)).datasetHash).toBe(frozen.datasetHash);
  expect(frozen.questions.size).toBe(small.questions.length);
  const manifest = structuredClone(small); manifest.sets.final[0] = manifest.sets.train[0]!;
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await expect(readBank(root)).rejects.toThrow();
});

it('small chooses first manifest entries even when split order differs; smoke does not consume the extra train slot', async () => {
  const { selectBankSubset } = await import('./bank.js');
  const manifest = {
    version: 1 as const, seed: 'order', mutationKillMin: 0.7,
    sets: { smoke: ['js_smoke'], train: ['js_later', 'go_first', 'js_smoke', 'py_first', 'js_first'], sealed: ['go_sealed', 'js_sealed', 'py_sealed'], final: ['py_final', 'js_final', 'go_final'] },
    questions: [
      ['js_smoke', 'javascript'], ['js_first', 'javascript'], ['js_later', 'javascript'], ['py_first', 'python'], ['go_first', 'go'],
      ['js_sealed', 'javascript'], ['py_sealed', 'python'], ['go_sealed', 'go'], ['js_final', 'javascript'], ['py_final', 'python'], ['go_final', 'go'],
    ].map(([id, language]) => ({ id: id!, language: language as 'javascript' | 'python' | 'go', difficulty: 'easy' as const, mutationKillRatio: 1 })),
  };
  const before = structuredClone(manifest), small = selectBankSubset(manifest, 'small');
  expect(small.sets).toEqual({ smoke: ['js_smoke'], train: ['go_first', 'js_smoke', 'py_first', 'js_first'], sealed: ['go_sealed', 'js_sealed', 'py_sealed'], final: ['py_final', 'js_final', 'go_final'] });
  expect(small.questions.map(q => q.id)).not.toContain('js_later'); expect(manifest).toEqual(before);
});
