// Diagnostic-only counterfactual: no production bypass flag or source-file edits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

assert.equal(process.argv.length, 2, 'Usage: node perf-diag/10-capture-capacity-ab.mjs');
const root = fileURLToPath(new URL('../', import.meta.url)), directory = await mkdtemp(join(tmpdir(), 'capture-capacity-ab-'));
const digest = data => createHash('sha256').update(data).digest('hex');
const output = join(root, 'reports', 'capture-capacity-ab-' + new Date().toISOString().replaceAll(':', '-') + '-' + process.pid + '.json');
try {
  const variants = new Map();
  for (const variant of ['reference_without_checks', 'production']) {
    const outDir = join(directory, variant); let changed = 0;
    const plugins = variant === 'production' ? [] : [{ name: 'diagnostic-capacity-counterfactual', transform(source, id) {
      if (!id.endsWith('/server/proxy/capture-journal.ts')) return null;
      const replacements = [
        ['return capacity ? await withCaptureCapacity(db, execute) : execute();', 'return execute();'],
        ['if (!this.sizes.has(name)) await withCaptureCapacity(this.db, () => {});', '/* diagnostic-only first-admission check omitted */'],
      ];
      for (const [before, after] of replacements) {
        assert.equal(source.split(before).length, 2, 'Counterfactual anchor changed; refuse guessed transform');
        source = source.replace(before, after); changed += 1;
      }
      return { code: source, map: null };
    } }];
    await build({ configFile: false, root, plugins, logLevel: 'error', build: { ssr: join(root, 'server/proxy/capture-ab.ts'), outDir, emptyOutDir: false, target: 'node20', rollupOptions: { external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'], output: { entryFileNames: 'capture-ab.mjs' } } } });
    assert.equal(changed, variant === 'production' ? 0 : 2);
    await cp(join(root, 'server-dist/capture-worker.js'), join(outDir, 'capture-worker.js'));
    await cp(join(root, 'server-dist/assets'), join(outDir, 'assets'), { recursive: true });
    await symlink(join(root, 'node_modules'), join(outDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const files = ['capture-ab.mjs', 'capture-worker.js', ...(await readdir(join(outDir, 'assets'))).filter(name => name.endsWith('.js')).sort().map(name => 'assets/' + name)];
    const artifacts = {};
    for (const file of files) artifacts[file] = digest(await readFile(join(outDir, file)));
    variants.set(variant, { run: (await import(pathToFileURL(join(outDir, 'capture-ab.mjs')).href)).runCaptureAb, artifacts, changed });
  }
  const runs = [];
  for (const variant of ['reference_without_checks', 'production', 'production', 'reference_without_checks']) {
    const report = await variants.get(variant).run({ transport: 'https', keepOnFailure: true });
    const metrics = { firstByteP95: report.warm.pairedAdditional.firstBodyByte.p95, e2eP95: report.warm.pairedAdditional.e2e.p95, loopP99: report.eventLoop.p99Ms };
    runs.push({ variant, metrics, report }); console.log(JSON.stringify({ variant, ...metrics, budget: report.budget }));
  }
  const means = Object.fromEntries([...variants.keys()].map(variant => [variant, Object.fromEntries(['firstByteP95', 'e2eP95', 'loopP99'].map(key => [key, runs.filter(run => run.variant === variant).reduce((sum, run) => sum + run.metrics[key], 0) / 2]))]));
  const ratios = Object.fromEntries(Object.keys(means.production).map(key => [key, means.production[key] / means.reference_without_checks[key]]));
  const hardPassed = runs.every(run => run.report.budget.passed), relativePassed = Object.values(ratios).every(value => Number.isFinite(value) && value <= 1.2);
  const result = { version: 1, observedAt: new Date().toISOString(), sequence: 'reference/production/production/reference',
    sourceIncludesWorkingTree: true, journalSourceSha256: digest(await readFile(join(root, 'server/proxy/capture-journal.ts'))),
    variants: Object.fromEntries([...variants].map(([name, value]) => [name, { artifacts: value.artifacts, changedCallSites: value.changed }])), runs, means, ratios, hardPassed, relativePassed,
    measurement: 'Means of two run-level p95/p99 values, NOT pooled percentiles. Each run100 direct/proxy pairs at concurrency4. Same production worker; only counterfactual journal admission checks omitted in temporary reference bundle.',
    scope: 'Synthetic trusted HTTPS forwarding/core only. Not whole old build, production permission to bypass, high-watermark/deletion load, actual Agent, full-app or30-minute proof. Keep both original production A/B runs too.' };
  await mkdir(join(root, 'reports'), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ means, ratios, hardPassed, relativePassed, output }));
  if (!hardPassed || !relativePassed) process.exitCode = 1;
} finally { await rm(directory, { recursive: true, force: true }); }
