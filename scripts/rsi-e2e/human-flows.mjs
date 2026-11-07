#!/usr/bin/env node
// Claude runs this OUTSIDE the Codex sandbox. Real server, worker, Docker, sidecar and gates; scripted models, no model key.
// Covers the flows nothing else exercises end to end: a hung optimizer, a busy optimizer, the per-round token limit, raising it from
// the budget command, the page Reject button (a person clicks it, the script waits), and a monitor that failed calibration only alerting.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { fakeMonitorReply, fakeTargetRepairCommand } from './p4-loop.mjs';

const PACKAGE = resolve(import.meta.dirname, '../..'), run = promisify(execFile), delay = ms => new Promise(done => setTimeout(done, ms));
const say = (label, value) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${label}${value === undefined ? '' : ' ' + JSON.stringify(value)}`);
export function flagsFor(args) {
  const out = { '--port': '4192', '--stage': 'all' };
  for (let i = 0; i < args.length; i += 2) {
    if (!['--root', '--docker-context', '--port', '--stage'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: human-flows.mjs --root <new-dir> --docker-context <name> [--port <n>] [--stage all|degraded]');
    out[args[i]] = args[i + 1];
  }
  if (!out['--root'] || !out['--docker-context']) throw new Error('--root and --docker-context are required');
  if (!['all', 'degraded'].includes(out['--stage'])) throw new Error('--stage must be all or degraded');
  return out;
}
export const OPTIMIZER_SCRIPT = String.raw`set -eu
brief=$(curl -fsS -H "Authorization: Bearer $RSI_AGENT_TOKEN" "$RSI_API_BASE/brief")
mode=$(printf '%s' "$brief" | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const t=JSON.parse(s).instructions.map(i=>i.text).filter(x=>x.startsWith("mode:")).at(-1);console.log(t?t.slice(5):"hang")})')
seq=$(printf '%s' "$brief" | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>console.log(JSON.parse(s).lastIterationSeq+1))')
echo "scripted optimizer mode=$mode"
if test "$mode" = hang; then echo "going quiet now"; sleep 100000; fi
if test "$mode" = busy; then echo "spinning now"; while :; do :; done; fi
if test "$mode" = burn; then while :; do curl -sS -o /dev/null -w 'model request %{http_code}\n' -H "Authorization: Bearer $OPENAI_API_KEY" -H 'Content-Type: application/json' -d '{"model":"fixed","messages":[{"role":"user","content":"spend"}]}' "$OPENAI_BASE_URL/chat/completions" || true; sleep 0.2; done; fi
curl -fsS -o /dev/null -H "Authorization: Bearer $OPENAI_API_KEY" -H 'Content-Type: application/json' -d '{"model":"fixed","messages":[{"role":"user","content":"One focused hypothesis"}]}' "$OPENAI_BASE_URL/chat/completions"
printf '\nglobalThis.roundHypothesis = %s;\n' "$seq" >> agent.mjs
git add agent.mjs
git commit -qm "one optimizer hypothesis"
commit=$(git rev-parse HEAD)
body=$(node -e 'console.log(JSON.stringify({requestId:"round-"+process.argv[1],commit:process.argv[2],prd:{observation:"behavior can improve",hypothesis:"one source adjustment",changes:["agent.mjs"],expectedImpact:"more passes"}}))' "$seq" "$commit")
curl -fsS -H "Authorization: Bearer $RSI_AGENT_TOKEN" -H 'Content-Type: application/json' -d "$body" "$RSI_API_BASE/iterations" >/dev/null
echo "submitted $commit"
`;
export async function main(args) {
const flags = flagsFor(args), root = resolve(flags['--root']), context = flags['--docker-context'], base = `http://127.0.0.1:${flags['--port']}`;
await mkdir(root, { recursive: true });
const git = (repo, ...argv) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=RSI', '-c', 'user.email=rsi@localhost', '-C', repo, ...argv]);
const rsi = async (env, ...argv) => (await run(process.execPath, [join(PACKAGE, 'bin/rsi.js'), ...argv], { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 3600000 })).stdout;
const serverLog = openSync(join(root, 'server.log'), 'a', 0o600), server = spawn(process.execPath, [join(PACKAGE, 'bin/agent-observe.js'), '--config-root', root, '--port', flags['--port'], '--no-open'], { stdio: ['ignore', serverLog, serverLog] });
for (let i = 0; ; i++) { try { await fetch(base); break; } catch (error) { if (i > 100) throw error; await delay(200); } }
const token = (await (await fetch(`${base}/api/rsi/session`)).json()).token;
const api = async (method, path, body) => {
  const response = await fetch(`${base}/api/rsi/tasks/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); assert(response.ok, JSON.stringify({ path, status: response.status, value })); return value;
};
let sequence = 0;
const human = (task, command, iterationId = null) => api('POST', `${task}/commands`, { requestId: `flows-${++sequence}`, iterationId, command });
const idea = (task, mode) => human(task, { action: 'instruction', kind: 'idea', text: `mode:${mode}`, effectiveFromSeq: 1 });
async function createTask(task, settings) {
  const repo = join(root, `repo-${task}`); await cp(join(PACKAGE, 'rsi-agents/mini-agent/source'), repo, { recursive: true });
  await git(repo, 'init', '-q'); await git(repo, 'add', '-A'); await git(repo, 'commit', '-qm', 'baseline');
  const baseline = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  const optimizer = join(root, `optimizer-${task}`); await cp(join(PACKAGE, 'rsi-agents/optimizers/scripted'), optimizer, { recursive: true });
  const profile = JSON.parse(await readFile(join(optimizer, 'profile.json'), 'utf8'));
  profile.run.env = { OPENAI_BASE_URL: '{{baseUrl}}', OPENAI_API_KEY: '{{apiKey}}' }; profile.run.files[0].content = OPTIMIZER_SCRIPT;
  await writeFile(join(optimizer, 'profile.json'), JSON.stringify(profile));
  await writeFile(join(root, `config-${task}.json`), JSON.stringify({ noiseRepeats: 2, infraErrorMaxRatio: 0.1, stableWindow: 3, stableFailRepeats: 2, sealedQueryBudget: 10, tokenGrowthMaxRatio: 1000, maxIterations: 10, maxTaskTokens: 10000000, runTokenBudget: 100000, targetPassedCount: 100, l1: { maxDiffLines: 2000, maxDiffBytes: 262144, opaqueMinLength: 512, minFingerprintLength: 8, commonFingerprintRatio: 0.5 } }));
  await rsi({}, 'task', 'create', '--task', task, '--root', root, '--repository', repo, '--baseline', baseline, '--bank', join(PACKAGE, 'server/rsi/__fixtures__/bank'), '--agent', join(PACKAGE, 'rsi-agents/mini-agent/profile.json'), '--optimizer', join(optimizer, 'profile.json'), '--subset', 'small', '--config', join(root, `config-${task}.json`), '--api-base', base);
  const taskRoot = join(root, 'awesome-telemetry-data/rsi', task), runtimeFile = join(taskRoot, 'private/runtime.json');
  const runtime = JSON.parse(await readFile(runtimeFile, 'utf8')), manifest = JSON.parse(await readFile(join(taskRoot, 'private/bank/manifest.json'), 'utf8'));
  const table = { '*': { outcome: 'fail', passCommand: 'true' }, optimizer: { outcome: 'pass', passCommand: 'true' } }, generic = { outcome: 'pass', passCommand: fakeTargetRepairCommand() }, candidate = { '*': generic, optimizer: { outcome: 'pass', passCommand: 'true' } };
  for (const q of manifest.questions) { table[q.id] = { outcome: 'fail', passCommand: 'true', failCommand: 'true' }; candidate[q.id] = generic; }
  Object.assign(runtime, { candidateMockTable: candidate, proxy: { ...runtime.proxy, mode: 'mock', mockTable: table }, agentTimeoutMs: 120000 }, settings);
  await writeFile(runtimeFile, JSON.stringify(runtime), { mode: 0o600 });
}
const startWorker = (task, env = {}) => { const log = openSync(join(root, `worker-${task}.log`), 'a', 0o600); return spawn(process.execPath, [join(PACKAGE, 'bin/rsi.js'), 'worker', '--execute', '--watch', '--task', task, '--root', root, '--docker-context', context], { env: { ...process.env, ...env }, stdio: ['ignore', log, log] }); };
async function until(label, check, limitMs = 1800000) { const deadline = Date.now() + limitMs; for (;;) { const v = await check(); if (v) { say(label, typeof v === 'object' ? v : undefined); return v; } assert(Date.now() < deadline, `Timed out waiting: ${label}`); await delay(1500); } }
const sessions = async task => (await api('GET', `${task}/metrics`)).sessions;
const sessionN = (task, seq) => until(`session ${seq} running`, async () => (await sessions(task)).find(s => s.seq === seq) ?? null);
const ended = (task, seq) => until(`session ${seq} ended`, async () => { const s = (await sessions(task)).find(s => s.seq === seq); return s && s.state !== 'running' ? s : null; });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); say(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail); };

const A = 'flows-human';
let worker;
try {
  if (flags['--stage'] === 'all') {
  await createTask(A, { optimizerIdleTimeoutMs: 30000, optimizerSessionTimeoutMs: 90000, optimizerSessionTokens: 300 });
  worker = startWorker(A);
  say('stage A: hang, burn, busy, then raise the limit and submit');
  await sessionN(A, 1); await idea(A, 'burn');
  const one = await ended(A, 1), oneDetail = await api('GET', `${A}/sessions/${one.id}/report`);
  check('hung optimizer ends early as idle', one.state === 'timeout' && one.endReason === 'idle' && Date.parse(one.endedAt) - Date.parse(one.startedAt) < 85000, { state: one.state, endReason: one.endReason, ms: Date.parse(one.endedAt) - Date.parse(one.startedAt) });
  check('its processes come from the engine and show the sleep', /sleep 100000/.test(oneDetail.report?.processes ?? ''), oneDetail.report?.processes?.slice(0, 300));
  check('its output was saved', /going quiet now/.test(oneDetail.output ?? ''), oneDetail.output);
  await sessionN(A, 2); await idea(A, 'busy');
  const two = await ended(A, 2), twoDetail = await api('GET', `${A}/sessions/${two.id}/report`);
  check('token cap names itself', two.state === 'no_submission' && two.endReason === 'token_limit' && two.tokenLimit === 300 && two.requests > 0, { state: two.state, endReason: two.endReason, requests: two.requests, tokens: two.tokens, limit: two.tokenLimit });
  check('model requests appear in the output', /model request/.test(twoDetail.output ?? ''), twoDetail.output?.slice(0, 120));
  await sessionN(A, 3);
  const three = await ended(A, 3), threeDetail = await api('GET', `${A}/sessions/${three.id}/report`);
  check('a busy process is not treated as hung', three.state === 'timeout' && three.endReason === 'deadline', { state: three.state, endReason: three.endReason, ms: Date.parse(three.endedAt) - Date.parse(three.startedAt) });
  check('the deadline still leaves a process snapshot', /optimizer\.sh|while/.test(threeDetail.report?.processes ?? '') || /sh /.test(threeDetail.report?.processes ?? ''), threeDetail.report?.processes?.slice(0, 300));
  await until('needs help after three rounds', async () => (await api('GET', `${A}`)).task.state === 'needs_help');
  const t = (await api('GET', `${A}`)).task;
  await human(A, { action: 'set_budget', maxTaskTokens: t.config.maxTaskTokens, maxIterations: t.config.maxIterations, sealedQueryBudget: t.config.sealedQueryBudget, optimizerSessionTokens: 5000000, reason: 'Raise the per-round limit' });
  await idea(A, 'submit'); await human(A, { action: 'resume', reason: 'Continue with the raised limit' });
  const four = await ended(A, 4);
  check('the raised limit reaches the next round', four.tokenLimit === 5000000 && four.endReason === 'submitted', { limit: four.tokenLimit, endReason: four.endReason });
  check('task config records the override', (await api('GET', `${A}`)).task.config.optimizerSessionTokens === 5000000);
  const held = await until('iteration 1 held', async () => { const { items } = await api('GET', `${A}/iterations`); const i = items.find(v => v.seq === 1); return i?.state === 'held' ? i : null; });
  check('missing monitor holds rather than promotes', held.holdReasons.includes('missing_monitor'), held.holdReasons);
  say(`WAITING_FOR_PAGE_REJECT ${base}/#/rsi?task=${A}&iter=1`);
  const rejected = await until('iteration rejected from the page', async () => { const { items } = await api('GET', `${A}/iterations`); const i = items.find(v => v.seq === 1); return i?.state === 'rejected' ? i : null; }, 3600000);
  const decisions = (await api('GET', `${A}/decisions`)).items.filter(d => d.iterationId === rejected.id);
  check('page rejection is logged as a human decision with its reason', decisions.some(d => d.actor === 'human' && d.verdict === 'reject' && d.reason.length > 0), decisions.map(d => ({ actor: d.actor, verdict: d.verdict, reason: d.reason })));
  await human(A, { action: 'stop', reason: 'Scenario finished' });
  await until('task stopped', async () => (await api('GET', `${A}`)).task.state === 'stopped');
  worker.kill('SIGINT'); await once(worker, 'exit'); worker = null;

  }
  // Stage B: a monitor that failed calibration only alerts.
  const B = 'flows-degraded', monitorToken = randomBytes(32).toString('hex'); let suspicious = false; const calls = { monitor: 0, process: 0, adversary: 0 };
  const monitor = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()), result = fakeMonitorReply(body); calls[result.kind]++;
    if (result.kind === 'monitor' && suspicious) {
      const line = /globalThis\.roundHypothesis = \d+;/.exec(JSON.stringify(body.messages));
      if (line) result.response.choices[0].message.content = JSON.stringify({ conclusions: [{ category: 'task_specific', evidence: line[0], confidence: 0.9 }] });
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.response));
  });
  monitor.listen(0, '127.0.0.1'); await once(monitor, 'listening');
  const monitorUrl = `http://127.0.0.1:${monitor.address().port}/v1`;
  await createTask(B, { optimizerSessionTimeoutMs: 120000, reviews: { monitorFamily: 'openai', monitorModel: 'flows-fake-monitor', monitorBaseUrl: monitorUrl, auditSampleRate: 0 } });
  say('stage B: calibrating a monitor that sees nothing');
  const calibration = JSON.parse(await rsi({ RSI_MONITOR_API_KEY: monitorToken }, 'calibrate', '--task', B, '--root', root, '--sample', 'all'));
  check('a monitor that misses everything fails calibration', calibration.status === 'failed', { status: calibration.status, message: calibration.message });
  check('the task records the failed calibration', (await api('GET', `${B}`)).task.monitorCalibration?.status === 'failed');
  suspicious = true;
  await idea(B, 'submit').catch(error => say('idea before worker', String(error)));
  worker = startWorker(B, { RSI_MONITOR_API_KEY: monitorToken });
  const settled = await until('iteration 1 past review', async () => { const { items } = await api('GET', `${B}/iterations`); const i = items.find(v => v.seq === 1); return i && ['promoted', 'rejected', 'held'].includes(i.state) ? i : null; });
  const findings = (await api('GET', `${B}/iterations/1/findings`)).items;
  check('the suspicion is kept as an alert', findings.some(f => f.source === 'degraded_monitor' && f.severity === 'info'), findings.map(f => ({ level: f.level, source: f.source, severity: f.severity })));
  check('the suspicion alone does not hold the iteration', !settled.holdReasons.includes('l4_suspicious'), { state: settled.state, holdReasons: settled.holdReasons });
  say('monitor calls', calls);
  await human(B, { action: 'stop', reason: 'Scenario finished' });
  await until('task stopped', async () => (await api('GET', `${B}`)).task.state === 'stopped', 600000);
  worker.kill('SIGINT'); await once(worker, 'exit'); worker = null; monitor.close();
  say('RESULTS', { passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).map(r => r.name) });
  await writeFile(join(root, 'flows-report.json'), JSON.stringify(results, null, 2));
  say('FLOWS DONE');
  server.kill('SIGTERM');
  if (results.some(r => !r.ok)) process.exitCode = 1;
} catch (error) {
  say('FLOWS FAILED', String(error?.stack ?? error)); await writeFile(join(root, 'flows-report.json'), JSON.stringify(results, null, 2));
  worker?.kill('SIGINT'); server.kill('SIGTERM'); process.exitCode = 1;
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
