// Real Docker + dependency-free second Agent. Claude runs this outside the sandbox.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, ledger, must } from './p2-smoke.mjs';

export function argumentsFor(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--root', '--docker-context', '--report'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: mini-agent-smoke.mjs [--root <new-dir>] [--docker-context <name>] [--report <json>]');
    values[args[i].slice(2)] = args[++i];
  }
  return values;
}
export async function main(args) {
  const values = argumentsFor(args), root = values.root ? resolve(values.root) : await mkdtemp(join(tmpdir(), 'rsi-mini-e2e-'));
  await mkdir(root, { recursive: true });
  const context = values['docker-context'];
  const docker = argv => must('docker', [...(context ? ['--context', context] : []), ...argv]);
  const reportFile = values.report ? resolve(values.report) : join(root, 'mini-report.json');
  const report = { version: 1, startedAt: new Date().toISOString(), finishedAt: null, verdict: 'infra_error', root, checks: {}, errors: [] };
  try {
    assert.equal((await docker(['info', '--format', '{{.OSType}}'])).trim(), 'linux', 'Linux Docker engine required');
    await readFile(resolve('server-dist/rsi.js'));
    const repository = join(root, 'mini-source'); await cp(resolve('rsi-agents/mini-agent/source'), repository, { recursive: true });
    const git = argv => must('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=RSI', '-c', 'user.email=rsi@localhost', '-C', repository, ...argv]);
    await git(['init', '-q']); await git(['add', '-A']); await git(['commit', '-qm', 'Mini Agent baseline']);
    const baseline = (await git(['rev-parse', 'HEAD'])).trim();
    await writeFile(join(repository, 'repair-guidance.md'), 'Inspect the failing behavior, make a focused repair, and verify it.\n');
    await git(['add', '-A']); await git(['commit', '-qm', 'Consistent repair guidance']);
    const candidate = (await git(['rev-parse', 'HEAD'])).trim();
    const bank = resolve('rsi-bank'), manifest = JSON.parse(await readFile(join(bank, 'manifest.json'), 'utf8'));
    const mockTable = {}, candidateMockTable = {};
    for (const q of manifest.questions) {
      const patch = (await readFile(join(bank, 'tasks', q.id, 'reference.patch'))).toString('base64');
      const passCommand = `printf %s '${patch}' | base64 -d | git apply -`;
      mockTable[q.id] = { outcome: 'fail', passCommand };
      candidateMockTable[q.id] = { outcome: 'pass', passCommand };
    }
    const save = async (name, value) => { const file = join(root, `${name}.json`); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file; };
    const settings = await save('settings', { concurrency: 2, agentTimeoutMs: 120000, reconciliationMaxRatio: 0.05, keepRecentImages: 2,
      imagesRoot: resolve('scripts/rsi-images'), reportersRoot: resolve('server/rsi/reporters'),
      proxy: { mode: 'mock', maxTokens: 4096, inputTokensPerByte: 0.35, mockTable }, candidateMockTable });
    const taskId = 'mini-agent-smoke';
    const cli = async argv => JSON.parse((await must(process.execPath, ['bin/rsi.js', ...argv, '--task', taskId, '--root', root])).trim());
    await cli(['task', 'create', '--repository', repository, '--baseline', baseline, '--bank', bank,
      '--agent', resolve('rsi-agents/mini-agent/profile.json'), '--subset', 'small', '--settings', settings]);
    const taskRoot = join(root, 'awesome-telemetry-data/rsi', taskId), ledgerFile = join(taskRoot, 'ledger.jsonl');
    const runWorker = async () => {
      const r = await command(process.execPath, ['scripts/rsi-e2e/p2-smoke.mjs', '--child', JSON.stringify({ taskId, root, context })], { timeoutMs: 3600000 }).promise;
      assert.equal(r.code, 0, r.error);
    };
    assert.equal((await cli(['worker'])).execute, false);
    await runWorker();
    let state = await ledger(ledgerFile); assert.equal(state.task.state, 'running'); assert.equal(state.task.delta, 0);
    const frozen = JSON.parse(await readFile(join(taskRoot, 'private/bank/manifest.json'), 'utf8'));
    assert(frozen.questions.length < manifest.questions.length);
    assert.deepEqual(frozen.sets.smoke, manifest.sets.smoke);
    assert.equal(state.runs.size, frozen.sets.train.length * 3 + frozen.sets.sealed.length * 3);
    report.checks.baseline = { runs: state.runs.size, trainQuestions: frozen.sets.train.length, sealedQuestions: frozen.sets.sealed.length };
    const prd = await save('prd', { observation: 'Repair attempts miss tasks', hypothesis: 'Consistent repair guidance improves solutions', changes: ['repair-guidance.md'], expectedImpact: 'More solved questions' });
    await cli(['iteration', 'submit', '--commit', candidate, '--prd', prd, '--request', 'candidate-one']);
    await runWorker(); state = await ledger(ledgerFile);
    const iteration = [...state.iterations.values()][0]; assert.equal(iteration.state, 'held');
    assert.deepEqual(iteration.holdReasons, ['missing_monitor', 'missing_adversarial']);
    assert.equal(iteration.trainScore, frozen.sets.train.length); assert.equal(state.task.sealedQueriesUsed, 0);
    const evaluations = [...state.evaluations.values()].filter(e => e.iterationId === iteration.id);
    assert.deepEqual(evaluations.map(e => e.phase), ['smoke', 'train']); assert(evaluations.every(e => e.state === 'completed'));
    for (const run of state.runs.values()) {
      assert(run.proxyTokens > 0); assert.equal(run.sessionPath.endsWith('/session'), true);
      const output = join(taskRoot, run.artifactPath);
      const target = JSON.parse(await readFile(join(output, 'target.json'), 'utf8')); assert.equal(target.sessionTokens, null);
      const last = JSON.parse(await readFile(join(output, 'proxy/last-request.json'), 'utf8'));
      assert(last.messages.some(m => m.role === 'tool')); assert.equal(last.truncated, false);
      const responses = await readFile(join(output, 'proxy/responses.jsonl'), 'utf8'); assert(responses.includes('call_fix'));
      assert((await readFile(join(output, 'proxy/usage.jsonl'), 'utf8')).includes('settled'));
    }
    report.checks.genericTraceAndProxyTokens = true;
    assert((await cli(['ledger', 'verify'])).valid); report.checks.heldAfterSmokeAndTrain = true;
    assert.equal((await docker(['ps', '-a', '--filter', `label=awesome-telemetry.rsi=${taskId}`, '--format', '{{.ID}}'])).trim(), '');
    assert.equal((await docker(['network', 'ls', '--filter', `label=awesome-telemetry.rsi=${taskId}`, '--format', '{{.ID}}'])).trim(), '');
    report.checks.cleanup = true; report.verdict = 'pass';
  } catch (error) { report.errors.push(error.message); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ verdict: report.verdict, report: reportFile, errors: report.errors }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
