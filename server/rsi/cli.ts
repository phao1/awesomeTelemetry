import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, statfs } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { defaultRsiConfig, validateRsiConfig } from '../../src/core/rsi-validation.js';
import type { RsiCommand, RsiPrd } from '../../src/core/rsi-types.js';
import { openWritable } from '../storage/db.js';
import { getRsiLedgerHead } from '../storage/rsi.js';
import { RsiStore } from './queue.js';
import { verifyLedger } from './ledger.js';
import { recoverLedgerTail } from './recovery.js';
import type { DockerClient } from './docker.js';
import { mustDocker, successful } from './docker.js';
import { readAgentProfile } from './agent-profile.js';
import { CliDockerClient } from './docker.js';
import { runWorker, validateWorkerSettings } from './worker.js';
import type { ReviewProvider } from './review.js';
import type { WorkerSettings } from './worker.js';
import { createTask, humanCommand, agentCommand } from './commands.js';
import { readOptimizerProfile, buildOptimizer, optimizerVolume } from './optimizer-profile.js';
import { startProxy, stopProxy } from './proxy-run.js';

export function defaultWorkerSettings(): WorkerSettings {
  const root = process.cwd();
  return { concurrency: 2, agentTimeoutMs: 300000, reconciliationMaxRatio: 0.05, keepRecentImages: 2,
    imagesRoot: join(root, 'scripts/rsi-images'), reportersRoot: join(root, 'server/rsi/reporters'),
    optimizerSessionTokens: 2000000, optimizerSessionTimeoutMs: 1800000, allowUnmeteredOptimizer: false, apiBase: 'http://127.0.0.1:4173',
    proxy: { mode: 'real', maxTokens: 4096, inputTokensPerByte: 0.35, mockTable: {} }, candidateMockTable: {} };
}
const HELP = `Usage: rsi <command> --task <id> [--root <configRoot>]
  task create --repository <local-repo> --baseline <full-commit> --bank <bank> [--config <json>] [--settings <json>] [--agent <profile.json>] [--optimizer <profile.json>] [--subset small|full] [--api-base <origin>]
  agent validate <profile.json>
  doctor [--root <path>] [--docker-context <name>]
  task status
  task command --command <json-file> [--iteration <id>] --request <id>
  iteration submit --commit <full-commit> --prd <json-file> --request <id>
  optimizer login --profile <id> [--docker-context <name>]
  worker [--execute] [--watch] [--allow-unmetered-optimizer] [--docker-context <name>]
  ledger verify
  ledger recover
Only worker --execute runs task containers; optimizer login explicitly starts a fresh interactive login container. Commands and JSON output are local trusted ingress.
worker drains available work and exits when idle, held or paused. Default reviews are missing.`;
async function json(file: string): Promise<unknown> { const data = await readFile(file); if (data.length > 1024 * 1024) throw new Error('JSON file limit'); return JSON.parse(data.toString()) as unknown; }
export async function rsiDoctor(client: DockerClient, root: string, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const check = async (argv: string[]): Promise<{ ok: boolean; text: string }> => {
    try { const r = await client.run(argv, { timeoutMs: 10000 }); return { ok: successful(r), text: successful(r) ? r.stdout.toString().trim() : '' }; }
    catch { return { ok: false, text: '' }; }
  };
  const [docker, buildx, info] = await Promise.all([check(['--version']), check(['buildx', 'version']), check(['info', '--format', '{{json .}}'])]);
  let engine: { OSType?: string; Architecture?: string } = {};
  try { engine = JSON.parse(info.text); } catch { /* reported as unavailable below */ }
  const os = engine?.OSType === 'linux' ? 'linux' : null;
  const architecture = ['amd64', 'x86_64', 'arm64', 'aarch64'].includes(engine?.Architecture ?? '') ? engine.Architecture : null;
  let freeBytes: number | null = null;
  // A new --root does not exist yet, so measure the nearest existing ancestor.
  for (let path = resolve(root); freeBytes === null; path = dirname(path)) {
    try { const disk = await statfs(path); freeBytes = disk.bavail * disk.bsize; }
    catch { if (path === dirname(path)) break; }
  }
  const upstream = Object.fromEntries(['RSI_UPSTREAM_BASE_URL', 'RSI_UPSTREAM_MODEL', 'RSI_UPSTREAM_API_KEY'].map(key => [key, !!env[key]?.trim()]));
  const checks = { docker: docker.ok, buildx: buildx.ok, context: info.ok, linux: os === 'linux', architecture: architecture !== null,
    disk: freeBytes !== null && freeBytes >= 6 * 1024 ** 3, upstream: Object.values(upstream).every(Boolean) };
  return { ok: Object.values(checks).every(Boolean), checks, engine: { os, architecture }, disk: { freeBytes, minimumBytes: 6 * 1024 ** 3 }, upstream };
}
export async function runRsiCli(args: string[], output: (value: unknown) => void = v => console.log(JSON.stringify(v)), options: { reviews?: ReviewProvider; afterRun?: () => Promise<void> } = {}): Promise<void> {
  if (!args.length || args.includes('--help')) { console.log(HELP); return; }
  if (args[0] === 'optimizer' && args[1] === 'login') { await optimizerLogin(args.slice(2)); return; }
  if (args[0] === 'agent' && args[1] === 'validate') {
    if (args.length !== 3 || args[2]!.startsWith('--')) throw new Error('Usage: rsi agent validate <profile.json>');
    const { profile } = await readAgentProfile(resolve(args[2]!)); output({ valid: true, id: profile.id }); return;
  }
  const command = ['worker', 'doctor'].includes(args[0]!) ? args[0]! : args.slice(0, 2).join(' '), start = ['worker', 'doctor'].includes(command) ? 1 : 2;
  const flags = new Map<string, string>(); let execute = false, watch = false, allowUnmetered = false;
  const allowed = new Set(['--task', '--root', '--repository', '--baseline', '--bank', '--config', '--settings', '--commit', '--prd', '--request', '--command', '--iteration', '--docker-context', '--agent', '--subset', '--optimizer', '--api-base']);
  for (let i = start; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--watch' || key === '--allow-unmetered-optimizer') { if (command !== 'worker') throw new Error('Worker flag only'); if (key === '--watch') watch = true; else allowUnmetered = true; continue; }
    if (key === '--execute') { if (execute || command !== 'worker') throw new Error('Invalid --execute'); execute = true; continue; }
    if (!allowed.has(key) || flags.has(key) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid RSI arguments. Use --help');
    flags.set(key, args[++i]!);
  }
  const permitted: Record<string, string[]> = {
    'task create': ['--repository', '--baseline', '--bank', '--config', '--settings', '--agent', '--subset', '--optimizer', '--api-base', '--request'], 'task status': [],
    'task command': ['--command', '--request', '--iteration'], 'iteration submit': ['--commit', '--prd', '--request'],
    worker: ['--docker-context', '--api-base'], doctor: ['--docker-context'], 'ledger verify': [], 'ledger recover': [],
  };
  if (!permitted[command] || [...flags.keys()].some(k => !['--task', '--root', ...permitted[command]!].includes(k))) throw new Error('Invalid RSI arguments. Use --help');
  const required = (key: string): string => { const v = flags.get(key); if (!v) throw new Error(`Missing ${key}`); return v; };
  if (command === 'doctor') {
    if (flags.has('--task')) throw new Error('doctor does not accept --task');
    output(await rsiDoctor(new CliDockerClient(flags.get('--docker-context') ?? null), resolve(flags.get('--root') ?? process.cwd()))); return;
  }
  const taskId = required('--task'); if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw new Error('Invalid task ID');
  const dataRoot = join(resolve(flags.get('--root') ?? process.cwd()), 'awesome-telemetry-data/rsi'), root = join(dataRoot, taskId);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const db = openWritable(join(dataRoot, 'index.db')), store = new RsiStore(db, root, taskId);
  try {
    if (command === 'ledger recover') { output(await recoverLedgerTail(root, taskId, getRsiLedgerHead(db, taskId) ?? undefined)); await store.refresh(); return; }
    if (command === 'ledger verify') { output(await verifyLedger(store.ledgerPath, { taskId, ...(getRsiLedgerHead(db, taskId) ? { expectedHead: getRsiLedgerHead(db, taskId)! } : {}) })); return; }
    await store.refresh();
    if (command === 'task create') {
      const config = flags.has('--config') ? validateRsiConfig(await json(required('--config'))) : defaultRsiConfig();
      const settings = flags.has('--settings') ? validateWorkerSettings(await json(required('--settings')) as WorkerSettings) : defaultWorkerSettings();
      if (flags.has('--api-base')) settings.apiBase = required('--api-base');
      output(await createTask(store, { requestId: flags.get('--request') ?? 'start', repository: resolve(required('--repository')), baselineCommit: required('--baseline'),
        bank: resolve(required('--bank')), agentProfile: resolve(flags.get('--agent') ?? 'rsi-agents/opencode/profile.json'),
        optimizerProfile: resolve(flags.get('--optimizer') ?? 'rsi-agents/optimizers/opencode-deepseek/profile.json'), subset: (flags.get('--subset') ?? 'full') as 'small' | 'full', config }, settings)); return;
    }
    const task = store.task();
    if (command === 'task status') {
      const { taskTokenHash: _digest, ...view } = task;
      output({ task: view, head: getRsiLedgerHead(db, taskId), iterations: store.list('iteration_put'), evaluations: store.list('evaluation_put'), queue: store.list('queue_put') }); return;
    }
    if (command === 'iteration submit') {
      const item = await agentCommand(store, required('--request'), { action: 'submit', commit: required('--commit'), prd: await json(required('--prd')) as RsiPrd, parentId: null });
      output({ taskId, queueId: item.id, status: 'queued' }); return;
    }
    if (command === 'task command') {
      const cmd = await json(required('--command')) as RsiCommand;
      const iterationId = flags.get('--iteration') ?? null;
      const item = await humanCommand(store, cmd, required('--request'), iterationId); output({ taskId, queueId: item.id, status: 'queued' }); return;
    }
    if (command === 'worker') {
      const settings = validateWorkerSettings(await json(join(root, 'private/runtime.json')) as WorkerSettings);
      if (allowUnmetered) settings.allowUnmeteredOptimizer = true;
      if (flags.has('--api-base')) settings.apiBase = required('--api-base');
      const controller = new AbortController(), abort = (): void => controller.abort();
      process.on('SIGINT', abort); process.on('SIGTERM', abort);
      try { output(await runWorker(store, settings, new CliDockerClient(flags.get('--docker-context') ?? null), execute, { watch, signal: controller.signal, reviews: options.reviews, afterRun: options.afterRun })); }
      finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
      return;
    }
    throw new Error('Unknown RSI command. Use --help');
  } finally { db.close(); }
}

async function optimizerLogin(args: string[]): Promise<void> {
  const flags = new Map<string,string>();
  for(let i=0;i<args.length;i+=2) { if(!['--profile','--docker-context'].includes(args[i]!) || !args[i+1] || flags.has(args[i]!)) throw new Error('Usage: rsi optimizer login --profile <id>'); flags.set(args[i]!,args[i+1]!); }
  const id = flags.get('--profile'); if(!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid optimizer profile ID');
  const directory=resolve('rsi-agents/optimizers',id), {profile}=await readOptimizerProfile(join(directory,'profile.json'));
  if(profile.login.kind!=='volume' || profile.egress.kind!=='vendor-allowlist') throw new Error('Profile does not require interactive login');
  const client=new CliDockerClient(flags.get('--docker-context')??null), image=await buildOptimizer(client,directory,profile);
  await mustDocker(client,['build','-t','rsi-proxy:p2','-f',resolve('scripts/rsi-images/proxy.Dockerfile'),resolve('scripts/rsi-images')]);
  const proxy=await startProxy(client,`login-${id}`,randomUUID().replaceAll('-','').padEnd(64,'0'),'optimizer',0,1,{mode:'mock',maxTokens:1,inputTokensPerByte:0.35,mockTable:{}},undefined,{apiBase:'http://127.0.0.1:4173',domains:profile.egress.domains});
  try {
    const argv=[...(client.context?['--context',client.context]:[]),'run','--rm','-it','--network',proxy.network,'--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=volume,src=${optimizerVolume(id)},dst=${profile.login.path}`,'-e','HTTPS_PROXY=http://rsi-proxy:8080','-e','HTTP_PROXY=http://rsi-proxy:8080',...Object.entries(profile.run.env).filter(([key])=>key==='CLAUDE_CONFIG_DIR'||key==='CODEX_HOME').flatMap(([key,value])=>['-e',`${key}=${value}`]),'--entrypoint',profile.login.command[0]!,image,...profile.login.command.slice(1)];
    console.log(['docker',...argv].map(v=>"'"+v.replaceAll("'", "'\\''")+"'").join(' '));
    await new Promise<void>((resolve,reject)=>{const child=spawn('docker',argv,{stdio:'inherit',shell:false,env:{PATH:process.env.PATH,DOCKER_CONFIG:process.env.DOCKER_CONFIG}});child.once('error',()=>reject(new Error('Cannot start Docker login')));child.once('exit',code=>code===0?resolve():reject(new Error('Optimizer login failed')));});
  } finally { await stopProxy(client,proxy); }
}
