// Isolate write-stamp validation cost, never a production bypass or permission.
import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--samples' && /^\d+$/.test(args[1])), 'Usage: node perf-diag/11-capacity-snapshot-ab.mjs [--samples 100..1000]');
const samples = args.length === 0 ? 100 : Number(args[1]);
assert.ok(Number.isSafeInteger(samples) && samples >= 100 && samples <= 1000, 'Bounded sample count required');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'capacity-snapshot-ab-'));
const digest = data => createHash('sha256').update(data).digest('hex');
const output = join(root, 'reports', 'capacity-snapshot-ab-' + new Date().toISOString().replaceAll(':', '-') + '-' + process.pid + '.json');
const completedRuns = [], checkpoints = [];
let currentRun = null;
const errorRecord = error => error instanceof Error ? { name: error.name, message: error.message, stack: error.stack,
  cause: error.cause instanceof Error ? errorRecord(error.cause) : error.cause ?? null,
  ...(error instanceof AggregateError ? { errors: error.errors.map(errorRecord) } : {}) } : { message: String(error) };
try {
  const variants = new Map();
  for (const variant of ['reference_without_stamps', 'production']) {
    const outDir = join(directory, variant); let changed = 0;
    const plugins = variant === 'production' ? [] : [{ name: 'diagnostic-snapshot-counterfactual', enforce: 'pre', transform(source, id) {
      if (!id.endsWith('/server/proxy/capture-capacity.ts')) return null;
      const before = 'const before = writeStamp(db), status = await readCaptureCapacity(db);\n      if (writeStamp(db) !== before) continue;';
      assert.equal(source.split(before).length, 2, 'Snapshot anchor changed; refuse guessed counterfactual');
      changed += 1;
      return { code: source.replace(before, 'const status = await readCaptureCapacity(db);'), map: null };
    } }];
    await build({ configFile: false, root, plugins, logLevel: 'error', build: { ssr: join(root, 'server/proxy/capture-ab.ts'), outDir, emptyOutDir: false, target: 'node20', rollupOptions: { external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'], output: { entryFileNames: 'capture-ab.mjs' } } } });
    assert.equal(changed, variant === 'production' ? 0 : 1);
    await cp(join(root, 'server-dist/capture-worker.js'), join(outDir, 'capture-worker.js'));
    await cp(join(root, 'server-dist/assets'), join(outDir, 'assets'), { recursive: true });
    await symlink(join(root, 'node_modules'), join(outDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const files = ['capture-ab.mjs', 'capture-worker.js', ...(await readdir(join(outDir, 'assets'))).filter(name => name.endsWith('.js')).sort().map(name => 'assets/' + name)];
    const artifacts = {};
    for (const file of files) artifacts[file] = digest(await readFile(join(outDir, file)));
    variants.set(variant, { run: (await import(pathToFileURL(join(outDir, 'capture-ab.mjs')).href)).runCaptureAb, artifacts, changed });
  }
  const profiles = [];
  for (const [profile, options] of [['http', {}], ['https-connect', { transport: 'https' }], ['http-near-2mib', { frameBytes: 225000 }]]) {
    const runs = [];
    for (const variant of ['reference_without_stamps', 'production', 'production', 'reference_without_stamps']) {
      currentRun = { profile, variant, index: runs.length, samplesPerRun: samples };
      const report = await variants.get(variant).run({ ...options, samples, keepOnFailure: true });
      const metrics = { firstByteP95: report.warm.pairedAdditional.firstBodyByte.p95, e2eP95: report.warm.pairedAdditional.e2e.p95, loopP99: report.eventLoop.p99Ms };
      runs.push({ variant, metrics, report }); completedRuns.push({ ...currentRun, metrics, report });
      const checkpoint = output.slice(0, -5) + '-run-' + completedRuns.length + '.json';
      await mkdir(join(root, 'reports'), { recursive: true });
      await writeFile(checkpoint, JSON.stringify({ ...currentRun, metrics, report, artifacts: variants.get(variant).artifacts }, null, 2) + '\n', { flag: 'wx' }); checkpoints.push(checkpoint);
      console.log(JSON.stringify({ profile, variant, ...metrics, budget: report.budget }));
    }
    const means = Object.fromEntries([...variants.keys()].map(variant => [variant, Object.fromEntries(['firstByteP95', 'e2eP95', 'loopP99'].map(key => [key, runs.filter(run => run.variant === variant).reduce((sum, run) => sum + run.metrics[key], 0) / 2]))]));
    const ratios = Object.fromEntries(Object.keys(means.production).map(key => [key, means.production[key] / means.reference_without_stamps[key]]));
    profiles.push({ profile, runs, means, ratios, hardPassed: runs.every(run => run.report.budget.passed), relativePassed: Object.values(ratios).every(value => Number.isFinite(value) && value > 0 && value <= 1.2) });
  }
  const result = { version: 1, observedAt: new Date().toISOString(), sequence: 'reference/production/production/reference',
    sourceIncludesWorkingTree: true, samplesPerRun: samples, capacitySourceSha256: digest(await readFile(join(root, 'server/proxy/capture-capacity.ts'))),
    variants: Object.fromEntries([...variants].map(([name, value]) => [name, { artifacts: value.artifacts, changedCallSites: value.changed }])), checkpoints, profiles,
    hardPassed: profiles.every(profile => profile.hardPassed), relativePassed: profiles.every(profile => profile.relativePassed),
    measurement: `Means of two run-level p95/p99 values, NOT pooled percentiles or statistical significance. Each run${samples} direct/proxy pairs at concurrency4. Only the diagnostic reference omits snapshot write-stamp reads; all existing admission sizes/limits/worker/forwarding remain.`,
    scope: 'Three loopback profiles, no native concurrent writes, high-watermark/deletion load, whole old product, real Agent, physical ENOSPC, full-app or30-minute proof. Never use reference in production. Retain all historical production runs.' };
  await mkdir(join(root, 'reports'), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ profiles: profiles.map(({ profile, ratios, hardPassed, relativePassed }) => ({ profile, ratios, hardPassed, relativePassed })), output }));
  if (!result.hardPassed || !result.relativePassed) process.exitCode = 1;
} catch (error) {
  const failureOutput = output.slice(0, -5) + '-failure.json';
  await mkdir(join(root, 'reports'), { recursive: true });
  await writeFile(failureOutput, JSON.stringify({ observedAt: new Date().toISOString(), currentRun, completedRuns, checkpoints, failure: errorRecord(error) }, null, 2) + '\n', { flag: 'wx' });
  console.error('Partial diagnostic failure preserved:', failureOutput); throw error;
} finally { await rm(directory, { recursive: true, force: true }); }
