#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readdir, realpath, writeFile, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { Worker } from 'node:worker_threads';
import { excludedPackagePath, requiredBuildFiles, rsiPackageAssets } from './rsi-package-assets.mjs';

// This harness exercises POSIX signals on macOS/Linux. Windows unit branches
// do not constitute a native Windows install/shutdown certification.
if (process.platform === 'win32') throw new Error('Run Windows install/browser/shutdown validation on a real Windows host with a native harness; this smoke harness currently verifies macOS/Linux.');

const binary = process.argv[2] === '--binary';
const artifact = process.argv[binary ? 3 : 2];
if (!artifact) throw new Error('Usage: npm run pack:smoke -- <tarball | --binary directory> [--offline] [--npm-cache path] [--node-headers path] [--no-http] [--open-browser]');
const offline = process.argv.includes('--offline');
const noHttp = process.argv.includes('--no-http');
function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name} path`);
  return resolve(value);
}
const root = await realpath(await mkdtemp(join(tmpdir(), 'awesome-telemetry-packed-')));
const consumer = join(root, 'consumer'), home = join(root, 'home');
await mkdir(consumer); await mkdir(home);
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
// Deliberately omit NODE_PATH, NODE_OPTIONS, source-provider paths and credentials.
const env = Object.fromEntries(['PATH', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const cache = option('--npm-cache') ?? (offline ? (process.env.npm_config_cache ?? join(homedir(), '.npm')) : join(root, 'npm-cache'));
Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), XDG_CONFIG_HOME: join(home, '.config'), npm_config_cache: cache, npm_config_audit: 'false', npm_config_fund: 'false' });
const nodeHeaders = option('--node-headers');
if (nodeHeaders) Object.assign(env, { npm_config_build_from_source: 'true', npm_config_nodedir: nodeHeaders });
const npm = 'npm';
async function run(file, args, options = {}) {
  const child = spawn(file, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
  try { const [code] = await once(child, 'close'); if (code !== 0) throw new Error(`${file} failed (${code}): ${stderr} ${stdout}`); return { stdout, stderr }; }
  finally { clearTimeout(timer); }
}
function checkPackagePaths(paths) {
  const files = new Set(paths);
  for (const path of [...requiredBuildFiles, ...rsiPackageAssets]) assert.ok(files.has(path), `missing package file: ${path}`);
  for (const path of files) assert.ok(!excludedPackagePath(path), `unexpected package file: ${path}`);
}
const pkg = binary ? join(root, 'binary') : join(consumer, 'node_modules', 'awesome-telemetry');
if (binary) {
  await cp(resolve(artifact), pkg, { recursive: true });
  const files = await readdir(pkg, { recursive: true });
  checkPackagePaths(files.filter(path => !/^node_modules(?:\/|$)/.test(path)));
  for (const path of files) {
    if (path.startsWith('node_modules/')) assert.ok(!excludedPackagePath(path.replace(/\bnode_modules\//g, '')), `unexpected bundled dependency file: ${path}`);
  }
  assert.ok(!(await readdir(join(pkg, 'node_modules'))).includes('vitest'));
} else {
  const listed = (await run('tar', ['-tzf', resolve(artifact)])).stdout.trim().split('\n');
  assert.ok(listed.every(path => path.startsWith('package/')));
  checkPackagePaths(listed.map(path => path.slice('package/'.length)));
  await run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', ...(offline ? ['--offline'] : []), resolve(artifact)]);
}
const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'awesome-telemetry');
assert.equal(manifest.private, true);
const cli = join(pkg, 'bin', 'agent-observe.js');
const runCli = (name, args) => binary
  ? run(process.execPath, [resolve(pkg, manifest.bin[name]), ...args])
  : run(npm, ['exec', '--offline', '--', name, ...args]);
assert.match((await runCli('awesome-telemetry', ['web', '--help'])).stdout, /awesome-telemetry web/);
assert.match((await runCli('rsi', ['--help'])).stdout, /task create/);
assert.match((await runCli('telemetry-task-health', ['--help'])).stdout, /telemetry-task-health/);
for (const args of [['web', '--host=bad;host'], ['web', '--port='], ['unknown']]) {
  let failed = false; try { await run(process.execPath, [cli, ...args]); } catch { failed = true; } assert.ok(failed, `invalid arguments accepted: ${args}`);
}
const report = { root, node: process.version, platform: process.platform, architecture: process.arch, registryPublished: false, install: binary ? 'isolated binary with bundled runtime dependencies' : 'clean npm consumer with independent dependencies', checks: [] };

async function createBank(directory) {
  const questions = [], sets = { smoke: [], train: [], sealed: [], final: [] };
  for (const phase of ['train', 'sealed', 'final']) {
    for (const [language, toolchain, report, target] of [
      ['javascript', 'node', 'node-test-events', 'report.test.mjs'],
      ['python', 'python', 'unittest-json', 'test_report.py'],
      ['go', 'go', 'go-test-json', '.'],
    ]) {
      const id = `${phase}-${language}`, task = join(directory, 'tasks', id);
      questions.push({ id, language, difficulty: 'easy', mutationKillRatio: 1 });
      sets[phase].push(id);
      await mkdir(join(task, 'repo'), { recursive: true });
      await mkdir(join(task, 'hidden_tests'));
      await writeFile(join(task, 'repo', 'README.md'), '# Synthetic fixture\n');
      await writeFile(join(task, 'hidden_tests', 'fixture.txt'), 'synthetic-only');
      await writeFile(join(task, 'reference.patch'), '');
      await writeFile(join(task, 'statement.md'), 'Restore the counter behavior.');
      await writeFile(join(task, 'meta.json'), JSON.stringify({
        questionId: id, repository: 'synthetic-fixture-repository', version: 1, language, difficulty: 'easy', toolchain,
        testNames: [], filePaths: [], rareStrings: [], expectedValues: [], testTargets: [target], report, expectedTests: 1, timeoutSeconds: 10,
      }));
    }
  }
  sets.smoke = sets.train.slice(0, 1);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, seed: 'package-smoke', mutationKillMin: 1, sets, questions }));
}

const bank = join(root, 'external standard bank'), hardBank = join(root, 'external hard bank');
await createBank(bank);
await cp(bank, hardBank, { recursive: true });
const profile = join(pkg, 'rsi-agents', 'mini-agent', 'profile.json');
assert.deepEqual(JSON.parse((await runCli('rsi', ['agent', 'validate', profile])).stdout), { valid: true, id: 'mini-agent' });
const repository = join(root, 'example agent');
await cp(join(pkg, 'rsi-agents', 'mini-agent', 'demo-source'), repository, { recursive: true });
await run('git', ['-C', repository, 'init', '-q']);
await run('git', ['-C', repository, 'add', '.']);
await run('git', ['-C', repository, '-c', 'user.name=package smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'baseline']);
const baseline = (await run('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim();
const taskRoot = join(root, 'external task data'), taskId = 'installed-smoke';
const task = ['--task', taskId, '--root', taskRoot];
const created = JSON.parse((await runCli('rsi', ['task', 'create', ...task, '--repository', repository, '--baseline', baseline, '--bank', bank])).stdout);
assert.equal(created.status, 'queued');
const dryRun = JSON.parse((await runCli('rsi', ['worker', ...task])).stdout);
assert.equal(dryRun.execute, false);
assert.equal(dryRun.taskId, taskId);
assert.equal(JSON.parse((await runCli('rsi', ['ledger', 'verify', ...task])).stdout).valid, true);
const runtime = JSON.parse(await readFile(join(taskRoot, 'awesome-telemetry-data', 'rsi', taskId, 'private', 'runtime.json'), 'utf8'));
assert.equal(runtime.imagesRoot, join(pkg, 'scripts', 'rsi-images'));
assert.equal(runtime.reportersRoot, join(pkg, 'server', 'rsi', 'reporters'));
report.checks.push({ name: 'rsi-cli', externalBank: 'pass', dryRun: 'pass', ledger: 'pass' });

// The packaged RSI CLI has initialized the shared schema. Seed a separate
// synthetic database so the real Task Health worker can run without a listener.
const healthDb = join(root, 'task-health.sqlite');
await cp(join(taskRoot, 'awesome-telemetry-data', 'rsi', 'index.db'), healthDb);
await run(process.execPath, ['--input-type=module', '-e', `
import { createRequire } from 'node:module';
const Database = createRequire(process.argv[1])('better-sqlite3');
const db = new Database(process.argv[2]);
const at = '2026-10-30T00:00:00.000Z';
db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('package-health','codex','Codex','Smoke',?,?,?,1)").run(at, at, process.argv[2] + '.missing-jsonl');
db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,actor) VALUES('package-health','event',0,'user_prompt','understand','Smoke',?,'user')").run(at);
db.close();
`, join(pkg, 'package.json'), healthDb]);
const healthBefore = await readFile(healthDb);
const health = JSON.parse((await runCli('telemetry-task-health', ['collected:package-health', '--db', healthDb])).stdout);
assert.equal(health.taskId, 'collected:package-health');
assert.equal(health.mode, 'standard');
assert.deepEqual(await readFile(healthDb), healthBefore);
report.checks.push({ name: 'task-health-cli-worker', result: 'pass' });

const reporterFixture = join(root, 'reporter.test.mjs');
await writeFile(reporterFixture, "import { test } from 'node:test'; test('packaged reporter smoke', () => {});\n");
const reporter = await run(process.execPath, ['--test', '--test-reporter', join(pkg, 'server', 'rsi', 'reporters', 'node.mjs'), reporterFixture]);
assert.deepEqual(JSON.parse(reporter.stdout), { reporter: 'rsi-node-v1', tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0, infrastructure: false });
const importModule = "import { pathToFileURL } from 'node:url'; const load = path => import(pathToFileURL(path).href);";
await run(process.execPath, ['--input-type=module', '-e', `${importModule}
const { createProxyHandler } = await load(process.argv[2]);
const { createCodexHealthProxy } = await load(process.argv[3]);
const { createClaudeMonitorProxy } = await load(process.argv[4]);
if (typeof createProxyHandler !== 'function') throw new Error('Cannot load model proxy');
for (const server of [
  createCodexHealthProxy({ PROXY_TOKEN: 'smoke-token', CODEX_BIN: process.execPath }),
  createClaudeMonitorProxy({ PROXY_TOKEN: 'smoke-token', ANTHROPIC_API_KEY: 'not-a-real-key' }),
]) {
  const request = { method: 'POST', url: '/v1/chat/completions', headers: {} };
  let status;
  await server.listeners('request')[0](request, { writeHead(code) { status = code; }, end() {} });
  if (status !== 401) throw new Error('Monitor proxy accepted an unauthenticated request');
}`, 'packed-proxy-smoke', join(pkg, 'scripts', 'rsi-images', 'model-proxy.mjs'), join(pkg, 'scripts', 'codex-health-proxy.mjs'), join(pkg, 'scripts', 'claude-monitor-proxy.mjs')]);
report.checks.push({ name: 'rsi-reporter-and-proxies', nodeReporter: 'pass', modelProxyImports: 'pass', monitorAuth: 'pass' });

async function launch(name, args, extraEnv = {}, viaNpm = false) {
  const config = join(root, name); await mkdir(config);
  const child = spawn(viaNpm ? npm : process.execPath, viaNpm ? ['exec', '--offline', '--', 'awesome-telemetry', ...args, '--port=0', '--config-root', config] : [cli, ...args, '--port=0', '--config-root', config], { cwd: consumer, env: { ...env, ...extraEnv }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const closed = once(child, 'close');
  let stopped = false, ready = false;
  async function stop() {
    if (stopped) return; stopped = true;
    if (child.exitCode === null && child.signalCode === null) {
      if (viaNpm) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      } else child.kill('SIGTERM');
    }
    const timer = setTimeout(() => { try { if (viaNpm && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already stopped */ } }, 10_000);
    try { const [code] = await closed; if (ready) { assert.match(stdout, /capture writes flushed and database closed/); if (!viaNpm) assert.equal(code, 0); } }
    finally { clearTimeout(timer); }
  }
  try {
    const deadline = Date.now() + 30_000;
    while (!stdout.includes('AwesomeTelemetry is running at ')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Server did not become ready: ${stdout} ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    ready = true;
    const url = /AwesomeTelemetry is running at (http:\/\/[^ ]+)/.exec(stdout)[1];
    assert.notEqual(new URL(url).port, '0'); assert.equal(new URL(url).hostname, '127.0.0.1');
    const index = await fetch(url); assert.equal(index.status, 200); const html = await index.text();
    assert.ok(!html.includes('dist/ is missing'));
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]); assert.ok(assets.length > 0);
    for (const asset of assets) { const response = await fetch(new URL(asset, url)); assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0); }
    for (const path of ['api/health', 'api/sessions', 'api/agent-overview', 'api/providers/status', 'api/team-runs', 'api/trace-imports']) { const response = await fetch(new URL(path, url)); assert.equal(response.status, 200, path); await response.json(); }
    const page = await fetch(new URL('api/rsi/session', url));
    assert.equal(page.status, 200);
    const optionsResponse = await fetch(new URL('api/rsi/options', url), { headers: { authorization: `Bearer ${(await page.json()).token}` } });
    assert.equal(optionsResponse.status, 200);
    const options = await optionsResponse.json();
    assert.deepEqual(options.agents.map(profile => profile.id).sort(), ['mini-agent', 'opencode', 'opencode-deepseek']);
    assert.deepEqual(options.optimizers.map(profile => profile.id).sort(), ['claude-code', 'codex', 'opencode-deepseek', 'scripted']);
    assert.ok([...options.agents, ...options.optimizers].every(profile => profile.path.startsWith(join(pkg, 'rsi-agents') + '/')));
    assert.equal(options.bank?.path ?? null, extraEnv.RSI_BANK_ROOT ?? null);
    assert.equal(options.hardBank?.path ?? null, extraEnv.RSI_HARD_BANK_ROOT ?? null);
    for (const path of ['/', '/teams', '/monitor', '/sessions']) { const response = await fetch(new URL(path, url)); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/); }
    const denied = await fetch(new URL('api/trace-imports', url), { headers: { origin: 'http://untrusted.example' } }); assert.equal(denied.status, 400);
    const post = await fetch(url, { method: 'POST' }); assert.equal(post.status, 404);
    const head = await fetch(new URL(assets[0], url), { method: 'HEAD' }); assert.equal((await head.text()).length, 0);
    await new Promise((resolve, reject) => {
      const req = request(new URL(url), { path: '/%2e%2e/package.json' }, res => { res.resume(); res.once('end', () => res.statusCode === 403 ? resolve() : reject(new Error('Static traversal accepted'))); }); req.once('error', reject); req.end();
    });
    const fixture = JSON.stringify({ session: { session_id: 'package-smoke', ide_type: 'codex', model_name: 'synthetic', title: 'Package smoke' }, turns: [{ turn_id: '1', turn_number: 1, messages: '[]' }] });
    const imported = await fetch(new URL('api/trace-imports', url), { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-trace-filename': 'synthetic.json' }, body: fixture });
    assert.equal(imported.status, 200);
    const [item] = (await imported.json()).items;
    assert.equal(item.state, 'imported');
    if (name === 'ssh') assert.match(stdout, /SSH session: browser opening disabled/);
    // A second process may not acquire the existing server port.
    let collided = false;
    try { await run(process.execPath, [cli, 'web', '--no-open', '--port', new URL(url).port, '--config-root', join(root, 'collision')]); }
    catch (error) { collided = /--port/.test(String(error)); }
    assert.ok(collided);
    await new Promise(resolve => setTimeout(resolve, name === 'local-open' ? (process.argv.includes('--hold-browser') ? 45000 : 1500) : 100));
    assert.ok(!stderr.includes('Could not open the default browser'), stderr);
    report.checks.push({ name, url, assetCount: assets.length, httpAndApi: 'pass', traceWorkerImport: 'pass', rsiOptions: 'pass', browser: name === 'local-open' ? 'native opener completed; inspect browser separately' : 'suppressed by CLI/environment', shutdown: 'pass' });
  } finally { await stop(); }
}
async function launchSupervisor() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(pkg, 'bin', 'rsi.js'), 'serve', '--root', join(root, 'supervisor'), '--port', String(port)], {
    cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', ready = false;
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const closed = once(child, 'close');
  try {
    const deadline = Date.now() + 35_000;
    while (!stdout.includes(`RSI Web is ready at ${origin}/#/rsi`)) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) throw new Error(`RSI supervisor did not become ready: ${stdout} ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    ready = true;
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
    assert.doesNotMatch(stdout, /RSI worker starting|monitor proxy/i);
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 40_000);
    try {
      const [code] = await closed;
      if (ready) {
        assert.equal(code, 0, stderr);
        assert.match(stdout, /capture writes flushed and database closed/);
      }
    } finally { clearTimeout(timer); }
  }
  report.checks.push({ name: 'rsi-serve', ready: 'pass', shutdown: 'pass' });
}
if (noHttp) {
  report.checks.push({ name: 'web-and-rsi-serve', result: 'omitted HTTP, browser, and live supervisor checks (--no-http)' });
} else {
  await launch('no-open', ['web', '--no-open'], { RSI_BANK_ROOT: bank, RSI_HARD_BANK_ROOT: hardBank });
  await launch('ssh', ['web'], { SSH_CONNECTION: '192.0.2.1 1234 192.0.2.2 22' }, !binary);
  if (process.argv.includes('--open-browser')) await launch('local-open', ['web']);
  await launchSupervisor();
}
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
