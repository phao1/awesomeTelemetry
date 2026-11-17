import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Dynamic URL keeps these JavaScript CLI modules independent of the application TS build.
const api = await import(new URL('./validate.mjs', import.meta.url).href);
const available = Object.fromEntries(await Promise.all(['node', 'python', 'go'].map(async name => [name, await api.availability(name)])));
let temporary: string;
let bank: string;
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'rsi-bank-tests-'));
  bank = join(temporary, 'bank');
  await cp(api.BANK, bank, { recursive: true });
});
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

describe('RSI-011 manifest and authoring checks', () => {
  it('accepts all thirty authored snapshots and reproduces seeded partitions', async () => {
    const { manifest, questions } = await api.readBank(bank);
    expect(questions).toHaveLength(30);
    expect(api.partition(manifest.questions, manifest.seed)).toEqual(manifest.sets);
    expect(manifest.sets.smoke.every((id: string) => manifest.sets.train.includes(id))).toBe(true);
  });
  it.each(['overlap', 'seed', 'count', 'unknownField', 'ratio'])('rejects %s corruption', async mode => {
    const path = join(bank, 'manifest.json');
    const original = await readFile(path, 'utf8');
    const manifest = JSON.parse(original);
    if (mode === 'overlap') manifest.sets.final[0] = manifest.sets.train[0];
    if (mode === 'seed') manifest.seed += '-changed';
    if (mode === 'count') manifest.questions.pop();
    if (mode === 'unknownField') manifest.privateHint = 'not in the contract';
    if (mode === 'ratio') manifest.questions[0].mutationKillRatio = 2;
    try { await writeFile(path, JSON.stringify(manifest)); await expect(api.readBank(bank)).rejects.toThrow(); }
    finally { await writeFile(path, original); }
  });
  it('rejects a leaked question identity in an issue', async () => {
    const { questions } = await api.readBank(bank);
    const path = join(questions[0].directory, 'statement.md');
    const original = await readFile(path, 'utf8');
    try { await writeFile(path, original + questions[0].id); await expect(api.readBank(bank)).rejects.toThrow('Statement leakage'); }
    finally { await writeFile(path, original); }
  });
  it.each(['testNames', 'rareStrings', 'filePaths', 'expectedValues', 'expectedTests', 'testTargets'])('rejects dishonest %s', async field => {
    const { questions } = await api.readBank(bank);
    const path = join(questions[0].directory, 'meta.json');
    const original = await readFile(path, 'utf8');
    const meta = JSON.parse(original);
    if (field === 'expectedTests') meta.expectedTests++;
    else meta[field] = ['invented-private-fingerprint'];
    try { await writeFile(path, JSON.stringify(meta)); await expect(api.readBank(bank)).rejects.toThrow(); }
    finally { await writeFile(path, original); }
  });
  it.each(['../outside', '/root/file', 'a/../../escape', 'a\\b', 'a//b', 'a/./b', 'x\n'])('rejects unsafe path %s', path => { expect(api.safePath(path)).toBe(false); });
});

describe('actual standard-library runners', () => {
  for (const toolchain of ['node', 'python', 'go']) {
    describe(toolchain, () => {
      let goSeed: { path: string; cleanup(): Promise<void> } | undefined;
      if (toolchain === 'go' && available.go) {
        beforeAll(async () => { goSeed = await api.prepareGoCache(); }, api.GO_CACHE_BUILD_TIMEOUT_MS + 10_000);
        afterAll(async () => { await goSeed?.cleanup(); });
      }
      it.skipIf(!available[toolchain])(`${toolchain}: original fails, patched snapshot passes with exact case identities`, async () => {
        const { questions } = await api.readBank(bank);
        const question = questions.find((q: { meta: { toolchain: string } }) => q.meta.toolchain === toolchain);
        const original = await api.workspace(question, false, goSeed);
        try {
          const reference = await api.workspace(question, true, goSeed);
          try {
            if (toolchain === 'go') {
              const marker = 'workspace-only';
              await writeFile(join(original.goCache, marker), 'isolation check');
              await expect(readFile(join(reference.goCache, marker))).rejects.toMatchObject({ code: 'ENOENT' });
              await expect(readFile(join(goSeed!.path, marker))).rejects.toMatchObject({ code: 'ENOENT' });
            }
            const failed = await api.runTests(question, original);
            const passed = await api.runTests(question, reference);
            expect(failed.complete).toBe(true);
            expect(failed.passed).toBe(false);
            expect(failed.cases.some((c: { passed: boolean }) => !c.passed)).toBe(true);
            expect(passed.started).toBe(true);
            expect(passed.complete).toBe(true);
            expect(passed.passed).toBe(true);
            expect(passed.cases).toHaveLength(question.meta.expectedTests);
          } finally { await reference.cleanup(); }
        } finally { await original.cleanup(); }
      });
    });
  }
  it('collects asynchronous process failure without treating it as a test report', async () => {
    const result = await api.command(process.execPath, ['-e', 'process.exit(2)']);
    expect(result.code).toBe(2);
    expect(api.parseReport(result.output, 'node')).toEqual([]);
  });
  it('bounds a hung subprocess', async () => {
    const result = await api.command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 });
    expect(result.timedOut).toBe(true);
  });
  it('does not accept prose or skipped report events as successful cases', () => {
    expect(api.parseReport('all tests passed\n{"rsiCase":true,"passed":"yes"}', 'node')).toEqual([]);
    expect(api.parseReport('{"Test":"TestCase","Action":"skip"}', 'go')).toEqual([{ name: 'TestCase', passed: false }]);
  });
});
