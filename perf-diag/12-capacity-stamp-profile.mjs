// Isolate the actual guard's SQLite/JS CPU cost; not a network latency claim.
import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { build } from 'vite';

assert.equal(process.argv.length, 2, 'Usage: node perf-diag/12-capacity-stamp-profile.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'capacity-stamp-profile-'));
const output = join(root, 'reports', 'capacity-stamp-profile-' + new Date().toISOString().replaceAll(':', '-') + '-' + process.pid + '.json');
const session = new Session(); let db = null;
try {
  await build({ configFile: false, root, logLevel: 'error', build: { ssr: join(root, 'server/proxy/capture-capacity.ts'), outDir: directory, emptyOutDir: false, target: 'node20', rollupOptions: { external: ['better-sqlite3'], output: { entryFileNames: 'capacity.mjs' } } } });
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const { withCaptureCapacity } = await import(pathToFileURL(join(directory, 'capacity.mjs')).href);
  db = new Database(':memory:'); db.pragma('busy_timeout=137');
  let calls = 0; const action = () => { calls += 1; };
  for (let i = 0; i < 500; i += 1) await withCaptureCapacity(db, action);
  calls = 0;
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, value) => error === null ? resolve(value) : reject(error)));
  session.connect(); await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 100 }); await post('Profiler.start');
  const iterations = 20000, started = performance.now();
  for (let i = 0; i < iterations; i += 1) { await withCaptureCapacity(db, action); if (i % 200 === 199) await yieldTurn(); }
  const elapsedMs = performance.now() - started, { profile } = await post('Profiler.stop');
  assert.equal(calls, iterations); assert.equal(db.pragma('busy_timeout', { simple: true }), 137);
  const topSelfSamples = [...profile.nodes].filter(node => node.hitCount > 0).sort((a, b) => b.hitCount - a.hitCount).slice(0, 35).map(node => ({
    functionName: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber + 1, samples: node.hitCount,
  }));
  const result = { version: 1, observedAt: new Date().toISOString(), capacitySourceSha256: createHash('sha256').update(await readFile(join(root, 'server/proxy/capture-capacity.ts'))).digest('hex'),
    iterations, elapsedMs, microsecondsPerAction: elapsedMs * 1000 / iterations, actionCalls: calls, topSelfSamples, profile,
    scope: 'Actual production capacity guard on fresh in-memory SQLite, builtin100us inspector CPU sampling. Memory removes filesystem latency to isolate SQLite/JS. Includes harness yield/profiler overhead; not HTTP forwarding/event-loop/physical-file/full-app/real Agent/soak proof.' };
  await mkdir(join(root, 'reports'), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, iterations, elapsedMs, microsecondsPerAction: result.microsecondsPerAction, topSelfSamples }));
} finally { session.disconnect(); db?.close(); await rm(directory, { recursive: true, force: true }); }
