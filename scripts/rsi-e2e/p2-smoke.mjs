// Real Docker + scripted model. Run outside the Codex sandbox; never uses host credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

export function argumentsFor(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--repository', '--root', '--docker-context', '--report'].includes(key) || !args[i + 1]) throw new Error('Usage: p2-smoke.mjs --repository <OpenCode source> [--root <new-dir>] [--docker-context <name>] [--report <json>]');
    values[key.slice(2)] = args[++i];
  }
  if (!values.repository) throw new Error('--repository is required');
  return values;
}
export function command(executable, argv, { input, timeoutMs = 120000, env, ipc = false } = {}) {
  const child = spawn(executable, argv, { shell: false, env: env ?? { PATH: process.env.PATH, DOCKER_CONFIG: process.env.DOCKER_CONFIG }, stdio: ['pipe', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
  const promise = new Promise((resolvePromise, reject) => {
    let output = '', error = '', size = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${executable} deadline exceeded`)); }, timeoutMs);
    const add = (stream, stderr) => stream.on('data', b => { size += b.length; if (size > 16 * 1024 * 1024) child.kill('SIGKILL'); else if (stderr) error += b; else output += b; });
    add(child.stdout, false); add(child.stderr, true);
    child.on('error', () => { clearTimeout(timer); reject(new Error(`Cannot start ${executable}`)); });
    child.on('close', code => { clearTimeout(timer); resolvePromise({ code, output, error }); });
    child.stdin.on('error', e => { if (e.code !== 'EPIPE') reject(e); }); child.stdin.end(input);
  });
  return { child, promise };
}
export async function must(executable, argv, options) {
  const r = await command(executable, argv, options).promise;
  if (r.code !== 0) throw new Error(`${executable} ${argv[0]} failed (${r.code}): ${r.error.slice(-1000)}`);
  return r.output;
}
export async function ledger(file) {
  const snapshots = { runs: new Map(), evaluations: new Map(), iterations: new Map(), decisions: [], task: null };
  for await (const line of createInterface({ input: createReadStream(file) })) {
    const e = JSON.parse(line);
    if (e.event === 'run_put') { assert(!snapshots.runs.has(e.payload.id), 'run written twice'); snapshots.runs.set(e.payload.id, e.payload); }
    if (e.event === 'task_put') snapshots.task = e.payload;
    if (e.event === 'evaluation_put') snapshots.evaluations.set(e.payload.id, e.payload);
    if (e.event === 'iteration_put') snapshots.iterations.set(e.payload.id, e.payload);
    if (e.event === 'decision_put') snapshots.decisions.push(e.payload);
  }
  return snapshots;
}
async function childWorker(args) {
  const [{ runRsiCli }, flags] = await Promise.all([import(pathToFileURL(resolve('server-dist/rsi.js')).href), Promise.resolve(JSON.parse(args[0]))]);
  const options = flags.clean ? { reviews: { review: async () => ({ monitor: { status: 'clean' }, adversarial: { status: 'clean' } }) } } : {};
  if (flags.barrier) options.afterRun = async () => {
    // This hook runs inside worker --execute. Leave an actual labelled idle
    // container/network so SIGKILL recovery exercises resource cleanup too.
    const network = `rsi-net-barrier-${process.pid}`, container = `rsi-target-barrier-${process.pid}`;
    const docker = argv => must('docker', [...(flags.context ? ['--context', flags.context] : []), ...argv]);
    await docker(['network', 'create', '--internal', '--label', `awesome-telemetry.rsi=${flags.taskId}`, network]);
    await docker(['create', '--name', container, '--label', `awesome-telemetry.rsi=${flags.taskId}`, '--network', network,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '1', '--pids-limit', '32', 'rsi-evaluator-node:p2']);
    await docker(['start', container]);
    process.send?.({ barrier: true, container, network }); await new Promise(() => {});
  };
  await runRsiCli(['worker', '--task', flags.taskId, '--root', flags.root, '--execute', ...(flags.context ? ['--docker-context', flags.context] : [])], v => console.log(JSON.stringify(v)), options);
}
export async function main(args) {
  if (args[0] === '--child') { await childWorker(args.slice(1)); return; }
  const values = argumentsFor(args), root = values.root ? resolve(values.root) : await mkdtemp(join(tmpdir(), 'rsi-p2-e2e-'));
  await mkdir(root, { recursive: true });
  const reportFile = values.report ? resolve(values.report) : join(root, 'p2-report.json');
  const report = { version: 1, startedAt: new Date().toISOString(), finishedAt: null, verdict: 'infra_error', root, checks: {}, errors: [] };
  const context = values['docker-context'], docker = argv => must('docker', [...(context ? ['--context', context] : []), ...argv]);
  try {
    try { await docker(['info', '--format', '{{.OSType}}']); } catch { throw new Error('Docker unavailable: a running Docker Linux engine is required; this test is not skipped.'); }
    await readFile(resolve('server-dist/rsi.js')); // npm run build:rsi first
    const repository = join(root, 'source.git');
    const git = (argv, options = {}) => must('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=RSI', '-c', 'user.email=rsi@localhost', ...argv], options);
    await git(['clone', '--bare', '--no-hardlinks', '--', resolve(values.repository), repository]);
    const baseline = '4d30794bcf4dccdcadbcb1f62bb35b4943a96426';
    await git(['--git-dir', repository, 'cat-file', '-e', `${baseline}^{commit}`]);
    const env = { PATH: process.env.PATH, GIT_INDEX_FILE: join(root, 'candidate.index'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    await git(['--git-dir', repository, 'read-tree', baseline], { env });
    const blob = (await git(['--git-dir', repository, 'hash-object', '-w', '--stdin'], { input: 'Use a consistent general repair procedure.\n' })).trim();
    await git(['--git-dir', repository, 'update-index', '--add', '--cacheinfo', `100644,${blob},tuning-note.md`], { env });
    const tree = (await git(['--git-dir', repository, 'write-tree'], { env })).trim();
    const candidate = (await git(['--git-dir', repository, 'commit-tree', tree, '-p', baseline], { input: 'RSI scripted model fixture\n' })).trim();
    const fixture = resolve('server/rsi/__fixtures__/bank'), manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
    const baselineTable = {}, candidateTable = {};
    for (const q of manifest.questions) {
      const tool = q.language === 'javascript' ? 'node' : q.language;
      const content = tool === 'node' ? 'export const answer = () => 3;\n' : tool === 'python' ? 'def answer():\n    return 3\n' : 'package answer\nfunc Answer() int { return 3 }\n';
      const ext = tool === 'node' ? 'mjs' : tool === 'python' ? 'py' : 'go';
      const passCommand = `printf %s '${content}' > answer.${ext}`;
      baselineTable[q.id] = { outcome: q.id === 'train_python' ? 'flaky' : 'fail', passCommand, repetitions: [false, true, false] };
      candidateTable[q.id] = { outcome: 'pass', passCommand };
    }
    const settings = { concurrency: 1, agentTimeoutMs: 120000, reconciliationMaxRatio: 0.05, keepRecentImages: 2,
      imagesRoot: resolve('scripts/rsi-images'), reportersRoot: resolve('server/rsi/reporters'),
      proxy: { mode: 'mock', maxTokens: 4096, inputTokensPerByte: 0.35, mockTable: baselineTable }, candidateMockTable: candidateTable };
    const config = { noiseRepeats: 3, infraErrorMaxRatio: 0.1, stableWindow: 3, stableFailRepeats: 2, sealedQueryBudget: 10, tokenGrowthMaxRatio: 0.3,
      maxIterations: 20, maxTaskTokens: 1000000, runTokenBudget: 100000, targetPassedCount: 3,
      l1: { maxDiffLines: 2000, maxDiffBytes: 262144, opaqueMinLength: 512, minFingerprintLength: 8, commonFingerprintRatio: 0.5 } };
    const save = async (name, value) => { const file = join(root, `${name}.json`); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file; };
    const settingsFile = await save('settings', settings), configFile = await save('config', config), taskId = 'p2-smoke';
    const cli = async argv => JSON.parse((await must(process.execPath, ['bin/rsi.js', ...argv, '--task', taskId, '--root', root])).trim());
    await cli(['task', 'create', '--repository', repository, '--baseline', baseline, '--bank', fixture, '--agent', resolve('rsi-agents/opencode/profile.json'), '--settings', settingsFile, '--config', configFile]);
    const taskRoot = join(root, 'awesome-telemetry-data/rsi', taskId), ledgerFile = join(taskRoot, 'ledger.jsonl');
    const dry = await cli(['worker']); assert.equal(dry.execute, false); report.checks.dryRun = true;
    const startWorker = flags => command(process.execPath, ['scripts/rsi-e2e/p2-smoke.mjs', '--child', JSON.stringify({ taskId, root, context, ...flags })], { timeoutMs: 3600000, ipc: true });
    const first = startWorker({ barrier: true });
    const [barrier] = await Promise.race([once(first.child, 'message'), first.promise.then(r => { throw new Error(`Worker exited before crash barrier (${r.code}): ${r.error.slice(-1000)}`); })]);
    first.child.kill('SIGKILL'); await first.promise;
    const before = await ledger(ledgerFile); assert.equal(before.runs.size, 1); assert([...before.evaluations.values()].some(e => e.state === 'running'));
    report.checks.killedRunningWorker = true;
    assert.equal((await docker(['inspect', '--format', '{{.State.Running}}', barrier.container])).trim(), 'true');
    // Resume with production-default concurrency 2. The barrier ensured no ledger
    // append was in progress at SIGKILL; the first retained slot must not rerun.
    settings.concurrency = 2;
    const runtime = JSON.parse(await readFile(join(taskRoot, 'private/runtime.json'), 'utf8'));
    await writeFile(join(taskRoot, 'private/runtime.json'), JSON.stringify({ ...runtime, concurrency: 2 }), { mode: 0o600 });
    const resumed = await startWorker({}).promise; assert.equal(resumed.code, 0, resumed.error);
    let state = await ledger(ledgerFile); assert(state.task.delta > 0); assert.equal(state.task.state, 'running');
    assert.equal(state.runs.size, 18); for (const [id, run] of before.runs) assert.deepEqual(state.runs.get(id), run);
    assert.equal((await docker(['ps', '-a', '--filter', `label=awesome-telemetry.rsi=${taskId}`, '--format', '{{.ID}}'])).trim(), '');
    assert.equal((await docker(['network', 'ls', '--filter', `label=awesome-telemetry.rsi=${taskId}`, '--format', '{{.ID}}'])).trim(), '');
    report.checks.orphanCleanup = true;
    report.checks.calibrationAndRecovery = { delta: state.task.delta, retainedRuns: before.runs.size, baselineRuns: state.runs.size };
    const prd = await save('prd', { observation: 'General repair misses', hypothesis: 'Use a consistent repair procedure', changes: ['tuning-note.md'], expectedImpact: 'More solved questions' });
    await cli(['iteration', 'submit', '--commit', candidate, '--prd', prd, '--request', 'submit-one']);
    const training = await startWorker({}).promise; assert.equal(training.code, 0, training.error);
    state = await ledger(ledgerFile); const i = [...state.iterations.values()][0]; assert.equal(i.state, 'held');
    assert.deepEqual(i.holdReasons, ['missing_monitor', 'missing_adversarial']); assert.equal(state.task.sealedQueriesUsed, 0);
    report.checks.reviewHeld = true;
    const retry = await save('retry', { action: 'retry_review', reason: 'Scripted trusted reviews available' });
    await cli(['task', 'command', '--iteration', i.id, '--command', retry, '--request', 'retry-review']);
    const reviewed = await startWorker({ clean: true }).promise; assert.equal(reviewed.code, 0, reviewed.error);
    state = await ledger(ledgerFile); assert.equal(state.iterations.get(i.id).state, 'promoted'); assert.equal(state.task.state, 'completed'); assert.equal(state.task.sealedQueriesUsed, 1);
    assert((await cli(['ledger', 'verify'])).valid); report.checks.sealedAndPromotion = true;
    const counts = { runs: state.runs.size, tokenUsage: state.task.tokenUsage };
    const repeated = await startWorker({ clean: true }).promise; assert.equal(repeated.code, 0, repeated.error);
    state = await ledger(ledgerFile); assert.equal(state.runs.size, counts.runs); assert.equal(state.task.tokenUsage, counts.tokenUsage);
    report.checks.idempotentRestart = counts;
    const leftovers = await docker(['ps', '-a', '--filter', `label=awesome-telemetry.rsi=${taskId}`, '--format', '{{.ID}}']); assert.equal(leftovers.trim(), '');
    report.checks.cleanup = true; report.verdict = 'pass';
  } catch (error) { report.errors.push(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ verdict: report.verdict, report: reportFile, errors: report.errors }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
