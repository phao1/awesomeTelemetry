import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const api = await import(new URL('./validate.mjs', import.meta.url).href);
const mutation = await import(new URL('./mutate.mjs', import.meta.url).href);
const languages = ['javascript', 'python', 'go'];
const available = Object.fromEntries(await Promise.all(['node', 'python'].map(async name => [name, await api.availability(name)])));
const questions = languages.flatMap(language => Array.from({ length: 4 }, (_, i) => ({
  id: `fixture-${language}-${i}`, language, difficulty: 'hard', mutationKillRatio: 0,
})));

describe('strict bank selection and hard stratification', () => {
  it('keeps the original default and resolves a requested bank independently of argument order', () => {
    expect(api.options([])).toEqual({ bank: api.BANK, docker: false });
    expect(api.options(['--bank', 'rsi-bank-hard', '--docker'])).toEqual({ bank: resolve('rsi-bank-hard'), docker: true });
    expect(api.options(['--docker', '--bank', 'rsi-bank-hard'])).toEqual(api.options(['--bank', 'rsi-bank-hard', '--docker']));
  });
  it.each([['--bank'], ['--bank', '--docker'], ['--bogus'], ['--docker', '--docker'], ['--bank', 'x', '--bank', 'y'], ['x']])('rejects malformed options %j', (...argv) => {
    expect(() => api.options(argv)).toThrow('Usage');
  });
  it('has exact disjoint coverage and one smoke question per language', () => {
    const sets = api.partition(questions, 'hard-test-seed');
    expect(Object.values(sets).map(ids => (ids as string[]).length)).toEqual([3, 6, 3, 3]);
    const main = [...sets.train, ...sets.sealed, ...sets.final];
    expect(main.slice().sort()).toEqual(questions.map(q => q.id).sort());
    expect(new Set(main).size).toBe(12);
    for (const name of ['train', 'sealed', 'final', 'smoke']) {
      expect(new Set(sets[name].map((id: string) => questions.find(q => q.id === id)!.language)).size).toBe(3);
    }
    expect(sets.smoke.every((id: string) => sets.train.includes(id))).toBe(true);
    expect(api.partition([...questions].reverse(), 'hard-test-seed')).toEqual(sets);
    expect(api.partition(questions, 'different-seed')).not.toEqual(sets);
  });
  it('does not relax the standard bank strata or accept an unbalanced hard corpus', async () => {
    const original = JSON.parse(await readFile(resolve('rsi-bank/manifest.json'), 'utf8'));
    expect(api.bankProfile(original.questions)).toBe('standard');
    expect(api.partition(original.questions, original.seed)).toEqual(original.sets);
    expect(() => api.partition(original.questions.slice(1), original.seed)).toThrow('Invalid stratum');
    const invalid = structuredClone(questions);
    invalid[0]!.language = 'python';
    expect(() => api.partition(invalid, 'seed')).toThrow('Invalid hard stratum');
    expect(() => api.partition(questions.map((q, i) => i === 0 ? { ...q, difficulty: 'easy' } : q), 'seed')).toThrow('Invalid stratum');
  });
  it('writes custom-bank mutation evidence alongside that bank and preserves the default destination', () => {
    expect(mutation.mutationDocument(api.BANK)).toBe(resolve('docs/rsi/bank.md'));
    expect(mutation.mutationDocument(resolve('rsi-bank-hard'))).toBe(resolve('rsi-bank-hard/DESIGN.md'));
    expect(mutation.mutationDocument('/tmp/custom-bank')).toBe('/tmp/custom-bank/DESIGN.md');
  });
  it('keeps task material outside application compilation and test discovery', async () => {
    for (const file of ['tsconfig.app.json', 'tsconfig.node.json']) {
      const config = JSON.parse(await readFile(resolve(file), 'utf8'));
      expect(config.include.every((path: string) => !path.startsWith('rsi-bank') && path !== '**/*')).toBe(true);
    }
    const config = await readFile(resolve('vitest.config.ts'), 'utf8');
    expect(config).toContain("include: ['{server,local-sessions,scripts}/**/*.test.{ts,tsx}']");
    expect(config).toContain("include: ['src/**/*.test.{ts,tsx}']");
    expect(await readFile(resolve('eslint.config.js'), 'utf8')).toContain("'rsi-bank-hard'");
  });
});

describe('authored hard snapshots', () => {
  it('accepts the twelve-task inventory and exact seeded partition', async () => {
    const { manifest, questions: authored } = await api.readBank(resolve('rsi-bank-hard'));
    expect(authored).toHaveLength(12);
    expect(api.partition(manifest.questions, manifest.seed)).toEqual(manifest.sets);
    expect(manifest.questions.every((q: { difficulty: string }) => q.difficulty === 'hard')).toBe(true);
    for (const language of languages) {
      expect(manifest.questions.filter((q: { language: string }) => q.language === language)).toHaveLength(4);
    }
  });
  for (const toolchain of ['node', 'python']) {
    it.skipIf(!available[toolchain])(`${toolchain} visible tests pass in original and reference workspaces`, async () => {
      const { questions: authored } = await api.readBank(resolve('rsi-bank-hard'));
      const question = authored.find((q: { meta: { toolchain: string } }) => q.meta.toolchain === toolchain);
      for (const fixed of [false, true]) {
        const space = await api.workspace(question, fixed);
        try {
          const result = await api.runVisibleTests(question, space);
          expect(result.passed, result.output).toBe(true);
          expect(result.cases.length).toBeGreaterThan(0);
        } finally { await space.cleanup(); }
      }
    });
  }
});

// Isolated corruption checks exercise hard-only gates without editing either bank.
describe('hard-only authoring gates', () => {
  it.each(['threshold', 'referenceSize', 'hiddenCount', 'deadline', 'commonFingerprint'])('rejects %s corruption', async mode => {
    const { cp, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const temporary = await mkdtemp(resolve(tmpdir(), 'hard-bank-gates-'));
    const copy = resolve(temporary, 'bank');
    try {
      await cp(resolve('rsi-bank-hard'), copy, { recursive: true });
      const manifestPath = resolve(copy, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const directory = resolve(copy, 'tasks', manifest.questions[0].id);
      const metaPath = resolve(directory, 'meta.json');
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (mode === 'threshold') {
        manifest.mutationKillMin = 0.6;
        await writeFile(manifestPath, JSON.stringify(manifest));
      } else if (mode === 'referenceSize') {
        await writeFile(resolve(directory, 'reference.patch'), 'diff --git a/database.mjs b/database.mjs\n');
      } else if (mode === 'commonFingerprint') {
        meta.filePaths = ['README.md'];
        await writeFile(metaPath, JSON.stringify(meta));
      } else {
        if (mode === 'hiddenCount') {
          meta.testNames = meta.testNames.slice(0, 9);
          meta.expectedTests = 9;
        } else meta.timeoutSeconds = 61;
        await writeFile(metaPath, JSON.stringify(meta));
      }
      await expect(api.readBank(copy)).rejects.toThrow(mode === 'threshold' ? 'Hard mutation threshold' : mode === 'referenceSize' ? 'Reference must modify only source' : mode === 'commonFingerprint' ? 'Common fingerprint path' : 'Hard test budget');
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});

it('retains hard fingerprints without flagging ordinary optimizer changes', async () => {
  const { buildFingerprintDictionary, scanDiff } = await import('../../src/core/rsi-l1-rules.js');
  const { scanTargetPatch } = await import('../../server/rsi/patch-scan.js');
  const { questions: authored } = await api.readBank(resolve('rsi-bank-hard'));
  const dictionary = buildFingerprintDictionary(authored.map((q: { meta: unknown }) => q.meta));
  const diff = (text: string) => `diff --git a/prompts/reviewer.md b/prompts/reviewer.md\n--- a/prompts/reviewer.md\n+++ b/prompts/reviewer.md\n@@ -1 +1 @@\n-old\n+${text}\n`;
  for (const text of ['Read the relevant modules, run the available tests, and verify the behavior.',
    'README.md index.js main.go go.mod package.json database.mjs ledger.py pool.mjs',
    'Use a balanced tree, retain stable ordering, and validate transaction dependencies.']) {
    expect(scanDiff(diff(text), dictionary)).toEqual([]);
  }
  for (const question of authored) {
    for (const value of [question.id, ...question.meta.testNames, ...question.meta.rareStrings, ...question.meta.filePaths, ...question.meta.expectedValues]) {
      expect(scanDiff(diff(value), dictionary).some(finding => finding.category === 'task_fingerprint')).toBe(true);
    }
    const patch = await readFile(resolve(question.directory, 'reference.patch'), 'utf8');
    expect(scanTargetPatch(patch)).toEqual([]);
  }
});

it('is compatible with the unchanged runtime bank layout after qualification', async () => {
  const { readBank: runtimeReadBank } = await import('../../server/rsi/bank.js');
  const { cp, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const temporary = await mkdtemp(resolve(tmpdir(), 'hard-bank-runtime-'));
  try {
    await cp(resolve('rsi-bank-hard'), temporary, { recursive: true });
    const path = resolve(temporary, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    // Qualification values exist only in this layout fixture. Unmeasured Go
    // ratios in the actual authored bank remain zero until container mutation.
    for (const question of manifest.questions) question.mutationKillRatio = manifest.mutationKillMin;
    await writeFile(path, JSON.stringify(manifest));
    const bank = await runtimeReadBank(temporary);
    expect(bank.questions.size).toBe(12);
    expect(bank.manifest.sets.train).toHaveLength(6);
    expect(bank.datasetHash).toMatch(/^[a-f0-9]{64}$/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});


it('enforces the four distinct task classes without a common source skeleton', async () => {
  const { questions: authored, manifest } = await api.readBank(resolve('rsi-bank-hard'));
  const classes = {
    A: ['palimpsest', 'fieldscript', 'waypoint'],
    B: ['kiln', 'depot', 'folio'],
    C: ['orderbook', 'contour', 'strata'],
    D: ['reservoir', 'rendezvous', 'postbox'],
  };
  for (const ids of Object.values(classes)) {
    expect(new Set(ids.map(id => authored.find((q: { id: string }) => q.id === `hard-${id}`).language)).size).toBe(3);
  }
  const typeOf = (id: string): string | undefined => Object.entries(classes)
    .find(([, ids]) => ids.includes(id.slice(5)))?.[0];
  expect(new Set(manifest.sets.train.map(typeOf)).size).toBe(4);
  expect(new Set(manifest.sets.sealed.map(typeOf)).size).toBe(3);
  expect(new Set(manifest.sets.final.map(typeOf)).size).toBe(3);
  const inventories: string[] = [];
  for (const q of authored) {
    const root = resolve(q.directory, 'repo');
    const paths: string[] = await api.filesUnder(root);
    inventories.push(paths.filter(path => !['README.md', 'go.mod'].includes(path)).join(','));
    expect(q.meta.expectedTests).toBeGreaterThanOrEqual(40);
    expect(q.meta.timeoutSeconds).toBeLessThanOrEqual(60);
    if (q.language === 'go') {
      expect(q.meta.testTargets).toEqual(['./checks']);
      const test = await readFile(resolve(q.directory, 'hidden_tests/checks/acceptance_test.go'), 'utf8');
      expect(test).toContain('package checks');
      expect(test).toContain('. "workspace"');
    }
    const patch = await readFile(resolve(q.directory, 'reference.patch'), 'utf8');
    const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
    const files = [...patch.matchAll(/^diff --git /gm)].length;
    if (classes.A.includes(q.id.slice(5))) {
      const docs = paths.filter(path => path.startsWith('docs/') && path.endsWith('.md'));
      expect(docs.length).toBeGreaterThan(0);
      for (const path of docs) {
        const lines = (await readFile(resolve(root, path), 'utf8')).trimEnd().split('\n').length;
        expect(lines).toBeGreaterThanOrEqual(150);
        expect(lines).toBeLessThanOrEqual(400);
      }
      expect(files).toBeGreaterThanOrEqual(3);
      expect(additions).toBeGreaterThanOrEqual(150);
    }
    if (classes.B.includes(q.id.slice(5))) {
      expect(paths.length).toBeGreaterThanOrEqual(15);
      expect(paths.length).toBeLessThanOrEqual(40);
      const contents = await Promise.all(paths.map(path => readFile(resolve(root, path), 'utf8')));
      const lines = contents.reduce((sum, text) => sum + text.trimEnd().split('\n').length, 0);
      expect(lines).toBeGreaterThanOrEqual(1500);
      expect(lines).toBeLessThanOrEqual(3000);
      expect(files).toBe(q.id === 'hard-depot' ? 7 : 4);
    }
  }
  expect(new Set(inventories).size).toBe(12);
});


for (const toolchain of ['node', 'python']) {
  it.skipIf(!available[toolchain])(`${toolchain} timeout qualification parses without executing and rejects invalid syntax`, async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const work = await mkdtemp(resolve(tmpdir(), 'hard-mutant-parse-'));
    const path = resolve(work, toolchain === 'node' ? 'program.mjs' : 'program.py');
    const question = { meta: { toolchain } };
    try {
      await writeFile(path, toolchain === 'node' ? 'while (true) {}' : 'while True: pass');
      expect(await mutation.builds(question, { work, goCache: work }, path, false)).toBe(true);
      await writeFile(path, toolchain === 'node' ? 'const =' : 'def :');
      expect(await mutation.builds(question, { work, goCache: work }, path, false)).toBe(false);
    } finally { await rm(work, { recursive: true, force: true }); }
  });
}
