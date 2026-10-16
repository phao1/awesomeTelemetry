// Diagnostic dev entry: bundle actual TS sources; copied production workers run without a TS loader.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === '--out' && args[1] !== '')) throw new Error('Usage: node perf-diag/09-capture-ab.mjs [--out <new-report.json>]');
const output = args.length === 0 ? join(root, 'reports', 'capture-ab-' + new Date().toISOString().replaceAll(':', '-') + '-' + process.pid + '.json') : resolve(args[1]);
await access(join(root, 'server-dist', 'capture-worker.js')).catch(() => { throw new Error('Build the production worker first: npm run build'); });
const directory = await mkdtemp(join(tmpdir(), 'capture-ab-build-'));
try {
  await build({ configFile: false, root, logLevel: 'error', build: { ssr: join(root, 'server/proxy/capture-ab.ts'), outDir: directory, emptyOutDir: false, target: 'node20', rollupOptions: { external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'], output: { entryFileNames: 'capture-ab.mjs' } } } });
  await cp(join(root, 'server-dist', 'capture-worker.js'), join(directory, 'capture-worker.js'));
  await cp(join(root, 'server-dist', 'assets'), join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const { runCaptureAb } = await import(pathToFileURL(join(directory, 'capture-ab.mjs')).href);
  const fingerprintPaths = ['capture-ab.mjs', 'capture-worker.js', ...(await readdir(join(directory, 'assets'))).filter(name => name.endsWith('.js')).sort().map(name => 'assets/' + name)];
  const artifacts = {};
  for (const path of fingerprintPaths) artifacts[path] = createHash('sha256').update(await readFile(join(directory, path))).digest('hex');
  const { stdout: head } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root });
  const profiles = [];
  for (const [name, options] of [['http', {}], ['https-connect', { transport: 'https' }], ['http-near-2mib', { frameBytes: 225000 }]]) {
    const report = await runCaptureAb({ ...options, keepOnFailure: true }); profiles.push({ name, report });
    console.log(JSON.stringify({ profile: name, samples: report.samples.length, extraFirstBodyByteP95Ms: report.warm.pairedAdditional.firstBodyByte.p95,
      extraE2eP95Ms: report.warm.pairedAdditional.e2e.p95, eventLoop: report.eventLoop, captures: report.integrity.captures,
      originals: report.integrity.originalsVerified, budget: report.budget }));
  }
  const result = { version: 1, observedAt: new Date().toISOString(), sourceHead: head.trim(), sourceIncludesWorkingTree: true, artifacts, profiles,
    passed: profiles.every(value => value.report.budget.passed), limits: { warmPairedAdditionalP95Ms: 20, eventLoopP99Ms: 50, minSamples: 100, concurrency: 4 },
    verificationScope: 'Controlled loopback forwarding core + originals/worker/metadata/SSE. Not30-minute soak, full Web/scanner workload, real Agent, OS/global trust or all transports.' };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log('A/B report:', output);
  if (!result.passed) process.exitCode = 1;
} finally { await rm(directory, { recursive: true, force: true }); }
