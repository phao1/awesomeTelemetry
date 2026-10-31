#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request } from 'node:http';
import { Worker } from 'node:worker_threads';

// This harness exercises POSIX signals on macOS/Linux. Windows unit branches
// do not constitute a native Windows install/shutdown certification.
if (process.platform === 'win32') throw new Error('Run Windows install/browser/shutdown validation on a real Windows host with a native harness; this smoke harness currently verifies macOS/Linux.');

const tarball = process.argv[2];
if (!tarball) throw new Error('Usage: npm run pack:smoke -- /absolute/path/awesome-telemetry-0.1.0.tgz [--open-browser]');
const root = await mkdtemp(join(tmpdir(), 'awesome-telemetry-packed-'));
const consumer = join(root, 'consumer'), home = join(root, 'home');
await mkdir(consumer); await mkdir(home);
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
// Deliberately omit NODE_PATH, NODE_OPTIONS, source-provider paths and credentials.
const env = Object.fromEntries(['PATH', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), XDG_CONFIG_HOME: join(home, '.config'), npm_config_cache: join(root, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false' });
const npm = 'npm';
async function run(file, args, options = {}) {
  const child = spawn(file, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
  try { const [code] = await once(child, 'close'); if (code !== 0) throw new Error(`${file} failed (${code}): ${stderr} ${stdout}`); return { stdout, stderr }; }
  finally { clearTimeout(timer); }
}
await run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', resolve(tarball)]);
const pkg = join(consumer, 'node_modules', 'awesome-telemetry');
const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'awesome-telemetry');
const cli = join(pkg, 'bin', 'agent-observe.js');
assert.match((await run(npm, ['exec', '--offline', '--', 'awesome-telemetry', 'web', '--help'])).stdout, /awesome-telemetry web/);
for (const args of [['web', '--host=bad;host'], ['web', '--port='], ['unknown']]) {
  let failed = false; try { await run(process.execPath, [cli, ...args]); } catch { failed = true; } assert.ok(failed, `invalid arguments accepted: ${args}`);
}
const report = { root, node: process.version, platform: process.platform, architecture: process.arch, registryPublished: false, install: 'clean consumer with independent dependencies', checks: [] };
async function launch(name, args, extraEnv = {}, viaNpm = false) {
  const config = join(root, name); await mkdir(config);
  const child = spawn(viaNpm ? npm : process.execPath, viaNpm ? ['exec', '--offline', '--', 'awesome-telemetry', ...args, '--port=0', '--config-root', config] : [cli, ...args, '--port=0', '--config-root', config], { cwd: consumer, env: { ...env, ...extraEnv }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const closed = once(child, 'close');
  let stopped = false;
  async function stop() {
    if (stopped) return; stopped = true;
    if (process.platform !== 'win32' && viaNpm) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM');
    const timer = setTimeout(() => { try { if (viaNpm && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already stopped */ } }, 10_000);
    try { const [code] = await closed; assert.match(stdout, /capture writes flushed and database closed/); if (!viaNpm) assert.equal(code, 0); }
    finally { clearTimeout(timer); }
  }
  try {
    const deadline = Date.now() + 30_000;
    while (!stdout.includes('AwesomeTelemetry is running at ')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Server did not become ready: ${stdout} ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const url = /AwesomeTelemetry is running at (http:\/\/[^ ]+)/.exec(stdout)[1];
    assert.notEqual(new URL(url).port, '0'); assert.equal(new URL(url).hostname, '127.0.0.1');
    const index = await fetch(url); assert.equal(index.status, 200); const html = await index.text();
    assert.ok(!html.includes('dist/ is missing'));
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]); assert.ok(assets.length > 0);
    for (const asset of assets) { const response = await fetch(new URL(asset, url)); assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0); }
    for (const path of ['api/health', 'api/sessions', 'api/agent-overview', 'api/providers/status', 'api/team-runs', 'api/trace-imports']) { const response = await fetch(new URL(path, url)); assert.equal(response.status, 200, path); await response.json(); }
    for (const path of ['/', '/teams', '/monitor', '/sessions']) { const response = await fetch(new URL(path, url)); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/); }
    const denied = await fetch(new URL('api/trace-imports', url), { headers: { origin: 'http://untrusted.example' } }); assert.equal(denied.status, 400);
    const post = await fetch(url, { method: 'POST' }); assert.equal(post.status, 404);
    const head = await fetch(new URL(assets[0], url), { method: 'HEAD' }); assert.equal((await head.text()).length, 0);
    await new Promise((resolve, reject) => {
      const req = request(new URL(url), { path: '/%2e%2e/package.json' }, res => { res.resume(); res.once('end', () => res.statusCode === 403 ? resolve() : reject(new Error('Static traversal accepted'))); }); req.once('error', reject); req.end();
    });
    const fixture = JSON.stringify({ session: { session_id: 'package-smoke', ide_type: 'codex', model_name: 'synthetic', title: 'Package smoke' }, turns: [{ turn_id: '1', turn_number: 1, messages: '[]' }] });
    const imported = await fetch(new URL('api/trace-imports', url), { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-trace-filename': 'synthetic.json' }, body: fixture }); assert.equal(imported.status, 200); assert.equal((await imported.json()).items[0].state, 'imported');
    if (name === 'ssh') assert.match(stdout, /SSH session: browser opening disabled/);
    // A second process may not acquire the existing server port.
    let collided = false;
    try { await run(process.execPath, [cli, 'web', '--no-open', '--port', new URL(url).port, '--config-root', join(root, 'collision')]); }
    catch (error) { collided = /--port/.test(String(error)); }
    assert.ok(collided);
    await new Promise(resolve => setTimeout(resolve, name === 'local-open' ? (process.argv.includes('--hold-browser') ? 45000 : 1500) : 100));
    assert.ok(!stderr.includes('Could not open the default browser'), stderr);
    report.checks.push({ name, url, assetCount: assets.length, httpAndApi: 'pass', traceWorkerImport: 'pass', browser: name === 'local-open' ? 'native opener completed; inspect browser separately' : 'suppressed by CLI/environment', shutdown: 'pass' });
  } finally { await stop(); }
}
await launch('no-open', ['web', '--no-open']);
await launch('ssh', ['web'], { SSH_CONNECTION: '192.0.2.1 1234 192.0.2.2 22' }, true);
if (process.argv.includes('--open-browser')) await launch('local-open', ['web']);
// Execute packaged workers, including their shared chunks, outside the checkout.
const worker = new Worker(join(pkg, 'server-dist', 'capture-worker.js'), { execArgv: [], env });
try {
  worker.postMessage({ id: 1, input: { hostname: 'api.openai.com', url: '/v1/chat/completions', requestHeaders: {}, responseHeaders: {}, requestBody: '{"model":"synthetic","messages":[]}', responseBody: '{"choices":[]}', isStreaming: false, previewTruncated: false } });
  const [message] = await once(worker, 'message'); assert.ok(message.result?.workerThreadId > 0); report.checks.push({ name: 'capture-worker', result: 'pass' });
} finally { await worker.terminate(); }
const directory = join(root, 'codex-worker'); await mkdir(directory);
function archive(records) {
  return Buffer.concat([Buffer.from('AWSP1\n'), ...records.flatMap(([sequence, payload]) => {
    const bytes = Buffer.from(JSON.stringify(payload)), header = Buffer.alloc(18); header[0] = 1;
    header.writeUInt32BE(sequence, 2); header.writeDoubleBE(sequence * 10, 6); header.writeUInt32BE(bytes.length, 14); return [header, bytes];
  })]);
}
async function body(bytes) {
  const ref = { id: randomUUID(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: 'complete', error: null };
  await writeFile(join(directory, ref.id + '.body'), bytes); return ref;
}
const source = { requestId: 'package-synthetic', startedAt: '2026-10-19T00:00:00.000Z', active: false, headers: {}, directory,
  request: await body(archive([[1, { type: 'response.create', model: 'synthetic', input: [] }]])),
  response: await body(archive([[2, { type: 'response.created', response: { id: 'synthetic', status: 'in_progress' } }], [3, { type: 'response.completed', response: { id: 'synthetic', status: 'completed', output: [] } }]])) };
const codex = new Worker(join(pkg, 'server-dist', 'codex-worker.js'), { execArgv: [], env, workerData: { source, window: { offset: 0, limit: 20 } } });
try { const [message] = await once(codex, 'message'); assert.equal(message.result?.page.items.length, 1); report.checks.push({ name: 'codex-worker', result: 'pass' }); }
finally { await codex.terminate(); }
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
