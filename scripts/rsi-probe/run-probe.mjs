import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { judge } from './evaluate.mjs';
import { sessionTokens } from './session-tokens.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(root, 'out');
const context = 'colima-rsi';
const prefix = `rsi-${randomUUID().slice(0, 8)}`;
const network = 'rsi-probe-net';
const pinned = '4d30794bcf4dccdcadbcb1f62bb35b4943a96426';
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null,
  model: null, concurrency: null, sourceCommit: null, hostSentinelVerified: false, builds: [], runs: [], resources: [],
  memoryPeakBytes: { containers: 0, vm: 0 }, errors: [], cleanupErrors: [], verdict: 'infra_error' };
const containers = new Set();
let ownNetwork = false;
let temp;
let timer;
let sampling = Promise.resolve();
let gateway;
let sampleBusy = false;
const secrets = [process.env.RSI_UPSTREAM_API_KEY].filter(Boolean);
function redact(value) {
  let text = String(value);
  for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
  return text;
}

// Async CLI only, no shell interpolation. All invocations have deadlines and bounded output.
export function command(executable, args, { timeout = 120_000, input, env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, outputFile, errorFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflow = false;
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const copyError = errorFile ? pipeline(child.stderr, createWriteStream(errorFile, { mode: 0o600 })) : Promise.resolve();
    const copy = outputFile ? pipeline(child.stdout, createWriteStream(outputFile, { mode: 0o600 })) : Promise.resolve();
    if (!outputFile) child.stdout.on('data', b => { stdout += b; if (stdout.length > 16 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-8192); });
    child.on('error', error => { clearTimeout(deadline); reject(new Error(`${executable}: ${error.code}`)); });
    child.stdin.on('error', () => { /* close outcome below owns broken pipe reporting */ });
    child.stdin.end(input);
    child.on('close', async (code, signal) => {
      clearTimeout(deadline);
      try { await Promise.all([copy, copyError]); } catch { reject(new Error(`${executable}: output file write failed`)); return; }
      resolve({ code, signal, timedOut, overflow, stdout, stderr });
    });
  });
}
async function docker(args, options) { return command('docker', ['--context', context, ...args], options); }
async function must(args, options) {
  const result = await docker(args, options);
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed (${result.timedOut ? 'timeout' : result.code}): ${redact(result.stderr)}`);
  return result.stdout.trim();
}
async function jsonl(file) {
  const rows = [];
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}
function size(value) {
  const match = /^([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)$/.exec(value.trim());
  if (!match) throw new Error('Unrecognized docker memory unit');
  return Number(match[1]) * ({ B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, kB: 1000, MB: 1e6, GB: 1e9 })[match[2]];
}
async function sample() {
  const names = [...containers];
  const rows = { at: new Date().toISOString(), containers: [], vmUsedBytes: null, error: null };
  try {
    if (names.length) {
      const stats = await must(['stats', '--no-stream', '--format', '{{json .}}', ...names], { timeout: 10_000 });
      for (const line of stats.split('\n').filter(Boolean)) {
        const row = JSON.parse(line);
        rows.containers.push({ name: row.Name, memoryBytes: size(row.MemUsage.split('/')[0]) });
      }
    }
    const vm = await command('colima', ['ssh', '--profile', 'rsi', '--', 'cat', '/proc/meminfo'], { timeout: 10_000 });
    if (vm.code !== 0) throw new Error('colima memory sample failed');
    const total = Number(/^MemTotal:\s+(\d+)/m.exec(vm.stdout)?.[1]);
    const available = Number(/^MemAvailable:\s+(\d+)/m.exec(vm.stdout)?.[1]);
    if (!Number.isFinite(total - available)) throw new Error('Invalid /proc/meminfo');
    rows.vmUsedBytes = (total - available) * 1024;
    report.memoryPeakBytes.vm = Math.max(report.memoryPeakBytes.vm, rows.vmUsedBytes);
    report.memoryPeakBytes.containers = Math.max(report.memoryPeakBytes.containers,
      rows.containers.reduce((n, c) => n + c.memoryBytes, 0));
  } catch (error) { rows.error = redact(error.message); }
  report.resources.push(rows);
}
async function create(name, args, options) {
  containers.add(name); // cleanup even if create succeeds but subsequent transport fails
  await must(['create', '--name', name, '--label', 'rsi-probe=true', ...args], options);
}
async function destroy(name) {
  await must(['rm', '-f', name]);
  containers.delete(name);
}
async function copyTo(name, source, destination) { await must(['cp', source, `${name}:${destination}`]); }
async function exec(name, args, options) { return must(['exec', name, ...args], options); }
// docker cp keeps ownership the unprivileged container user cannot change under --cap-drop ALL,
// so the container's own user makes the working copy.
async function copyOwned(name, source, destination) {
  const incoming = `/tmp/${randomBytes(12).toString('hex')}`;
  await exec(name, ['mkdir', '-p', incoming]);
  await copyTo(name, `${source}/.`, incoming);
  await exec(name, ['cp', '-R', `${incoming}/.`, destination]);
}
async function build(tag, dockerfile, buildContext) {
  const start = performance.now();
  console.error(`Building ${tag}; detailed output in out/${tag}.build.log`);
  const result = await docker(['build', '--platform', 'linux/arm64', '--progress', 'plain', '-t', tag, '-f', dockerfile, buildContext],
    { timeout: 45 * 60_000, outputFile: path.join(out, `${tag}.build.log`), errorFile: path.join(out, `${tag}.build.stderr.log`) });
  const record = { image: tag, durationMs: performance.now() - start, sizeBytes: null, exitCode: result.code };
  report.builds.push(record);
  if (result.code !== 0) throw new Error(`${tag} build failed; inspect build logs (stderr tail retained)`);
  record.sizeBytes = Number(await must(['image', 'inspect', '--format', '{{.Size}}', tag]));
}
async function evaluate(diff, directory, attempt) {
  const name = `${prefix}-eval-${attempt}-${randomUUID().slice(0, 6)}`;
  const workspace = `/tmp/${randomBytes(12).toString('hex')}`;
  const sealed = `/tmp/${randomBytes(12).toString('hex')}`;
  await create(name, ['--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '512m', '--cpus', '1', '--pids-limit', '128', 'rsi-evaluator:p0']);
  await must(['start', name]);
  await exec(name, ['mkdir', '-p', workspace, sealed]);
  await copyOwned(name, path.join(root, 'task/repo'), workspace);
  // Reject all patch paths except clamp.mjs, all mode changes, and symlink/binary patches.
  const patch = await readFile(diff, 'utf8');
  // docker cp keeps the host owner and mode, which the container user may not be able to read.
  await must(['exec', '-i', name, 'sh', '-c', 'cat > "$1"', 'write-patch', `${sealed}/change.patch`], { input: patch });
  if (!patch.trim() || patch.split('\n').filter(s => s.startsWith('diff --git ')).join('\n') !== 'diff --git a/clamp.mjs b/clamp.mjs'
      || /^(?:old mode|new mode|new file mode|deleted file mode|rename from|rename to|copy from|copy to|GIT binary patch|Binary files)/m.test(patch)
      || !patch.split('\n').filter(s => /^(?:---|\+\+\+) /.test(s)).every(s => /^(?:--- a|\+\+\+ b)\/clamp\.mjs$/.test(s))) {
    await destroy(name);
    return { verdict: 'fail', reason: 'empty_or_disallowed_patch', observedTests: 0, expectedTests: 5 };
  }
  const applied = await docker(['exec', '-w', workspace, name, 'git', 'apply', '--check', `${sealed}/change.patch`]);
  if (applied.code !== 0) {
    await destroy(name);
    // Exit 1 is a patch that does not apply; anything else means the evaluator itself failed.
    return { verdict: applied.code === 1 ? 'fail' : 'infra_error', reason: 'patch_rejected', detail: redact(applied.stderr).slice(-300), observedTests: 0, expectedTests: 5 };
  }
  await must(['exec', '-w', workspace, name, 'git', 'apply', `${sealed}/change.patch`]);
  // Sealed files and config are injected after applying candidate diff.
  await copyTo(name, path.join(root, 'task/hidden_tests'), `${workspace}/hidden_tests`);
  await copyTo(name, path.join(root, 'evaluate.mjs'), `${sealed}/evaluate.mjs`);
  const result = await docker(['exec', '-w', workspace, name, 'node', '--test',
    `--test-reporter=${sealed}/evaluate.mjs`, `${workspace}/hidden_tests/clamp.test.mjs`], { timeout: 30_000 });
  const eventsFile = path.join(directory, `test-events-${attempt}.jsonl`);
  await writeFile(eventsFile, result.stdout);
  let verdict;
  try { verdict = judge(await jsonl(eventsFile), result.code); }
  catch { verdict = { verdict: 'infra_error', reason: 'invalid_test_report', observedTests: 0, expectedTests: 5 }; }
  if (result.timedOut) verdict = { ...verdict, verdict: 'fail', reason: 'test_timeout' };
  await destroy(name);
  return verdict;
}
async function runOne(index, token) {
  const runId = `run-${index + 1}`;
  const directory = path.join(out, runId);
  await mkdir(directory, { recursive: true });
  const name = `${prefix}-target-${index}`;
  const work = `/tmp/${randomBytes(12).toString('hex')}`;
  const result = { runId, durationMs: null, targetExitCode: null, timedOut: false, oomKilled: null,
    isolation: [], containerEvidence: null, evaluation: null, sessionTokens: null, reconciliation: null, error: null };
  report.runs.push(result);
  const start = performance.now();
  try {
    await create(name, ['--network', network, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '1100m', '--cpus', '1.5', '--pids-limit', '256',
      '-e', `RSI_RUN_TOKEN=${token}`, '-e', 'OPENCODE_DB=/data/session.db', 'rsi-target:p0']);
    await must(['start', name]);
    const networks = Object.keys(JSON.parse(await must(['inspect', '--format', '{{json .NetworkSettings.Networks}}', name])));
    const mounts = JSON.parse(await must(['inspect', '--format', '{{json .Mounts}}', name]));
    result.containerEvidence = { networks, mountCount: mounts.length };
    if (networks.length !== 1 || networks[0] !== network || mounts.length !== 0) throw new Error('Target container network/mount attestation failed');
    await exec(name, ['mkdir', '-p', work]);
    await copyOwned(name, path.join(root, 'task/repo'), work);
    await exec(name, ['git', 'config', '--global', '--add', 'safe.directory', work]);
    const config = { model: 'probe/fixed', update: 'disable', share: 'disabled', snapshots: false,
      lsp: false, formatter: false, plugins: [],
      providers: { probe: { package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: 'http://rsi-proxy:8080/v1', apiKey: token },
        models: { fixed: { name: 'fixed', limit: { context: 100000, output: 1024 },
          capabilities: { tools: true, input: ['text'], output: ['text'] } } } } } };
    await must(['exec', '-i', name, 'node', '-e', "let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>require('fs').writeFileSync('/home/node/.config/opencode/opencode.json',s,{mode:0o600}))"],
      { input: JSON.stringify(config) });
    await copyTo(name, path.join(root, 'isolation-check.sh'), '/tmp/isolation-check.sh');
    const isolation = await docker(['exec', '-e', `RSI_HOST_PORT=${process.env.RSI_HOST_PORT}`,
      '-e', `RSI_HOST_CANARY=${process.env.RSI_HOST_CANARY}`, '-e', `RSI_GATEWAY=${gateway}`, name, 'bash', '/tmp/isolation-check.sh'], { timeout: 90_000 });
    await writeFile(path.join(directory, 'isolation.jsonl'), isolation.stdout);
    result.isolation = await jsonl(path.join(directory, 'isolation.jsonl'));
    if (isolation.code !== 0 || result.isolation.length < 10 || !result.isolation.every(c => c.pass)) {
      throw new Error('Isolation check failed; model run aborted');
    }
    await must(['exec', '-w', work, name, 'sh', '-c', 'git init -q && git config user.email probe@localhost && git config user.name Probe && git add clamp.mjs && git commit -qm baseline']);
    const prompt = await readFile(path.join(root, 'task/statement.md'), 'utf8');
    const run = await docker(['exec', '-w', work, name, 'timeout', '--signal=TERM', '--kill-after=5s', '290', 'opencode', 'run', '--standalone', '--auto', '--format', 'json', '--model', 'probe/fixed', prompt],
      { timeout: 310_000 });
    result.targetExitCode = run.code;
    result.timedOut = run.timedOut || run.code === 124;
    await writeFile(path.join(directory, 'opencode.jsonl'), redact(run.stdout), { mode: 0o600 });
    await writeFile(path.join(directory, 'opencode.stderr.log'), redact(run.stderr), { mode: 0o600 });
    const diff = path.join(directory, 'workspace.patch');
    await docker(['exec', '-w', work, name, 'git', 'diff', '--binary', 'HEAD', '--'], { outputFile: diff }).then(r => {
      if (r.code !== 0) throw new Error('Cannot export workspace diff');
    });
    // stop before copying the entire directory: retain DB + WAL + SHM consistently.
    await must(['stop', '--time', '5', name]);
    result.oomKilled = JSON.parse(await must(['inspect', '--format', '{{json .State.OOMKilled}}', name]));
    if (run.code === 137 && !result.oomKilled) result.timedOut = true;
    await must(['cp', `${name}:/data`, path.join(directory, 'data')]);
    await destroy(name);
    result.sessionTokens = sessionTokens(path.join(directory, 'data/session.db'));
    if (result.timedOut) result.evaluation = { verdict: 'fail', reason: 'agent_timeout' };
    else if (run.code !== 0) result.evaluation = { verdict: 'infra_error', reason: 'agent_nonzero_exit' };
    else {
      result.evaluation = await evaluate(diff, directory, 1);
      if (result.evaluation.verdict === 'infra_error') result.evaluation = { ...await evaluate(diff, directory, 2), retried: true };
    }
  } catch (error) {
    result.error = redact(error.message);
    result.evaluation ??= { verdict: result.timedOut ? 'fail' : 'infra_error', reason: result.timedOut ? 'agent_timeout' : 'execution_error' };
  } finally { result.durationMs = performance.now() - start; }
}

async function main() {
  await mkdir(out, { recursive: true, mode: 0o700 });
  let proxy;
  try {
    const args = process.argv.slice(2);
    const options = { concurrency: '1', model: 'mock' };
    for (let i = 0; i < args.length; i += 2) {
      if (!['--concurrency', '--model'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: --concurrency 1|2 --model mock|real');
      options[args[i].slice(2)] = args[i + 1];
    }
    if (!['1', '2'].includes(options.concurrency) || !['mock', 'real'].includes(options.model)) throw new Error('Invalid concurrency/model');
    report.concurrency = Number(options.concurrency);
    report.model = options.model;
    if (options.model === 'real') {
      const missing = ['RSI_UPSTREAM_BASE_URL', 'RSI_UPSTREAM_API_KEY', 'RSI_UPSTREAM_MODEL'].filter(k => !process.env[k]);
      if (missing.length) throw new Error(`Missing environment: ${missing.join(', ')}`);
      const url = new URL(process.env.RSI_UPSTREAM_BASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new Error('Real upstream requires HTTPS without URL credentials/query');
    }
    if (!/^\d+$/.test(process.env.RSI_HOST_PORT ?? '') || Number(process.env.RSI_HOST_PORT) < 1024 || Number(process.env.RSI_HOST_PORT) > 65535 || !process.env.RSI_HOST_CANARY?.startsWith('/')) {
      throw new Error('Set RSI_HOST_PORT and RSI_HOST_CANARY; run host sentinel first (see runbook)');
    }
    const sentinel = await fetch(`http://127.0.0.1:${process.env.RSI_HOST_PORT}`, { signal: AbortSignal.timeout(3000) });
    if (!sentinel.ok || (await sentinel.text()).trim() !== 'rsi-host-sentinel') throw new Error('Host sentinel unavailable or incorrect marker');
    report.hostSentinelVerified = true;
    await must(['info', '--format', '{{.OSType}}']);
    // Never adopt/delete an existing network or run concurrently with another probe process.
    if ((await docker(['network', 'inspect', network])).code === 0) throw new Error('rsi-probe-net already exists; inspect/clean previous probe first');
    const src = process.env.OPENCODE_SRC ?? '/Users/penghao/Documents/code/CodingAgent/opencode/opencode';
    const commit = await command('git', ['-C', src, 'rev-parse', 'HEAD']);
    if (commit.code !== 0 || commit.stdout.trim() !== pinned) throw new Error('OPENCODE_SRC must be pinned commit 4d30794bcf');
    report.sourceCommit = commit.stdout.trim();
    temp = await mkdtemp(path.join(tmpdir(), 'rsi-probe-'));
    const archive = path.join(temp, 'source.tar');
    const archived = await command('git', ['-C', src, 'archive', '--format=tar', pinned], { outputFile: archive });
    if (archived.code !== 0) throw new Error('git archive failed');
    const buildContext = path.join(temp, 'source');
    await mkdir(buildContext);
    const extracted = await command('tar', ['-xf', archive, '-C', buildContext]);
    if (extracted.code !== 0) throw new Error('Cannot extract source archive');
    await sample();
    timer = setInterval(() => {
      if (sampleBusy) return;
      sampleBusy = true;
      sampling = sample().finally(() => { sampleBusy = false; });
    }, 2000);
    await build('rsi-target:p0', path.join(root, 'images/target.Dockerfile'), buildContext);
    const emptyContext = path.join(temp, 'empty');
    await mkdir(emptyContext);
    await build('rsi-evaluator:p0', path.join(root, 'images/evaluator.Dockerfile'), emptyContext);
    // Proxy context contains only proxy sources; out/ and task/ never enter image context.
    const proxyContext = path.join(temp, 'proxy-context');
    await mkdir(proxyContext);
    await cp(path.join(root, 'proxy'), path.join(proxyContext, 'proxy'), { recursive: true });
    await build('rsi-proxy:p0', path.join(root, 'images/proxy.Dockerfile'), proxyContext);
    await must(['network', 'create', '--internal', '--label', 'rsi-probe=true', network]);
    ownNetwork = true;
    gateway = await must(['network', 'inspect', '--format', '{{(index .IPAM.Config 0).Gateway}}', network]);
    const tokens = Array.from({ length: report.concurrency }, () => randomBytes(32).toString('hex'));
    secrets.push(...tokens);
    proxy = `${prefix}-proxy`;
    const proxyEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...(options.model === 'real' ? { RSI_UPSTREAM_BASE_URL: process.env.RSI_UPSTREAM_BASE_URL, RSI_UPSTREAM_API_KEY: process.env.RSI_UPSTREAM_API_KEY, RSI_UPSTREAM_MODEL: process.env.RSI_UPSTREAM_MODEL } : {}), RSI_MODEL: options.model, RSI_RUNS: JSON.stringify(tokens.map((token, i) => ({ token, runId: `run-${i + 1}`, budget: 100000 }))) };
    await create(proxy, ['--network', network, '--network-alias', 'rsi-proxy',
      '--memory', '256m', '--cpus', '0.5', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '-e', 'RSI_MODEL', '-e', 'RSI_RUNS', ...(options.model === 'real' ? ['-e', 'RSI_UPSTREAM_BASE_URL', '-e', 'RSI_UPSTREAM_API_KEY', '-e', 'RSI_UPSTREAM_MODEL'] : []),
      'rsi-proxy:p0'], { env: proxyEnv });
    await must(['network', 'connect', 'bridge', proxy]);
    await must(['start', proxy]);
    // Readiness inside proxy, no host published ports.
    await exec(proxy, ['node', '-e', `let n=0; const t=setInterval(async()=>{try{const r=await fetch('http://127.0.0.1:8080/health');if(r.ok){clearInterval(t);process.exit(0)}}catch{}if(++n===30)process.exit(1)},300)`]);
    await sample();
    await Promise.all(tokens.map((token, i) => runOne(i, token)));
    clearInterval(timer);
    await sampling;
    await sample();
    await must(['cp', `${proxy}:/out/usage.jsonl`, path.join(out, 'usage.jsonl')]);
    const entries = await jsonl(path.join(out, 'usage.jsonl'));
    for (const run of report.runs) {
      const calls = entries.filter(e => e.runId === run.runId);
      const total = calls.reduce((n, e) => n + (e.usage?.total ?? 0), 0);
      const complete = calls.length > 0 && calls.every(e => e.complete && e.usage && !e.error);
      run.reconciliation = { proxyTotal: total, sessionTotal: run.sessionTokens?.total ?? null,
        delta: run.sessionTokens ? total - run.sessionTokens.total : null,
        complete, match: complete && total === run.sessionTokens?.total, requests: calls.length };
    }
    report.verdict = report.runs.every(r => r.evaluation?.verdict === 'pass' && r.reconciliation?.match && !r.oomKilled)
      && report.resources.some(s => s.vmUsedBytes !== null) ? 'pass'
      : report.runs.some(r => r.evaluation?.verdict === 'fail') ? 'fail' : 'infra_error';
  } catch (error) { report.errors.push(redact(error.message)); }
  finally {
    clearInterval(timer);
    await sampling;
    for (const name of containers) {
      try { await destroy(name); } catch (error) { report.cleanupErrors.push(redact(error.message)); }
    }
    if (ownNetwork) {
      try { await must(['network', 'rm', network]); } catch (error) { report.cleanupErrors.push(redact(error.message)); }
    }
    if (temp) await rm(temp, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    if (report.cleanupErrors.length) report.verdict = 'infra_error';
    await writeFile(path.join(out, 'probe-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ verdict: report.verdict, report: path.join(out, 'probe-report.json'), errors: report.errors }));
    process.exitCode = report.verdict === 'pass' ? 0 : 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
