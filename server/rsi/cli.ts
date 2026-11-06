import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { defaultRsiConfig, validateRsiConfig, validateRsiTask, validateRsiQueueItem } from '../../src/core/rsi-validation.js';
import type { RsiCommand, RsiPrd } from '../../src/core/rsi-types.js';
import { buildFingerprintDictionary } from '../../src/core/rsi-l1-rules.js';
import { selectParent } from '../../src/core/rsi-gate.js';
import { openWritable } from '../storage/db.js';
import { getRsiLedgerHead } from '../storage/rsi.js';
import { RsiStore, enqueue, now } from './queue.js';
import { readBank } from './bank.js';
import { createMirror, importCommit } from './build.js';
import { privateWrite } from './artifacts.js';
import { verifyLedger } from './ledger.js';
import { recoverLedgerTail } from './recovery.js';
import { CliDockerClient } from './docker.js';
import { runWorker, validateWorkerSettings } from './worker.js';
import type { ReviewProvider } from './review.js';
import type { WorkerSettings } from './worker.js';

export function defaultWorkerSettings(): WorkerSettings {
  const root = process.cwd();
  return { concurrency: 2, agentTimeoutMs: 300000, reconciliationMaxRatio: 0.05, keepRecentImages: 2,
    imagesRoot: join(root, 'scripts/rsi-images'), reportersRoot: join(root, 'server/rsi/reporters'),
    proxy: { mode: 'mock', maxTokens: 4096, inputTokensPerByte: 0.35, mockTable: {} }, candidateMockTable: {} };
}
const HELP = `Usage: rsi <command> --task <id> [--root <configRoot>]
  task create --repository <local-repo> --baseline <full-commit> --bank <bank> [--config <json>] [--settings <json>]
  task status
  task command --command <json-file> [--iteration <id>] --request <id>
  iteration submit --commit <full-commit> --prd <json-file> --request <id>
  worker [--execute] [--docker-context <name>]
  ledger verify
  ledger recover
Only worker --execute starts containers. Commands and JSON output are local trusted ingress.
worker drains available work and exits when idle, held or paused. Default reviews are missing.`;
async function json(file: string): Promise<unknown> { const data = await readFile(file); if (data.length > 1024 * 1024) throw new Error('JSON file limit'); return JSON.parse(data.toString()) as unknown; }
export async function runRsiCli(args: string[], output: (value: unknown) => void = v => console.log(JSON.stringify(v)), options: { reviews?: ReviewProvider; afterRun?: () => Promise<void> } = {}): Promise<void> {
  if (!args.length || args.includes('--help')) { console.log(HELP); return; }
  const command = args[0] === 'worker' ? 'worker' : args.slice(0, 2).join(' '), start = command === 'worker' ? 1 : 2;
  const flags = new Map<string, string>(); let execute = false;
  const allowed = new Set(['--task', '--root', '--repository', '--baseline', '--bank', '--config', '--settings', '--commit', '--prd', '--request', '--command', '--iteration', '--docker-context']);
  for (let i = start; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--execute') { if (execute || command !== 'worker') throw new Error('Invalid --execute'); execute = true; continue; }
    if (!allowed.has(key) || flags.has(key) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid RSI arguments. Use --help');
    flags.set(key, args[++i]!);
  }
  const permitted: Record<string, string[]> = {
    'task create': ['--repository', '--baseline', '--bank', '--config', '--settings'], 'task status': [],
    'task command': ['--command', '--request', '--iteration'], 'iteration submit': ['--commit', '--prd', '--request'],
    worker: ['--docker-context'], 'ledger verify': [], 'ledger recover': [],
  };
  if (!permitted[command] || [...flags.keys()].some(k => !['--task', '--root', ...permitted[command]!].includes(k))) throw new Error('Invalid RSI arguments. Use --help');
  const required = (key: string): string => { const v = flags.get(key); if (!v) throw new Error(`Missing ${key}`); return v; };
  const taskId = required('--task'); if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw new Error('Invalid task ID');
  const dataRoot = join(resolve(flags.get('--root') ?? process.cwd()), 'awesome-telemetry-data/rsi'), root = join(dataRoot, taskId);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const db = openWritable(join(dataRoot, 'index.db')), store = new RsiStore(db, root, taskId);
  try {
    if (command === 'ledger recover') { output(await recoverLedgerTail(root, taskId, getRsiLedgerHead(db, taskId) ?? undefined)); await store.refresh(); return; }
    if (command === 'ledger verify') { output(await verifyLedger(store.ledgerPath, { taskId, ...(getRsiLedgerHead(db, taskId) ? { expectedHead: getRsiLedgerHead(db, taskId)! } : {}) })); return; }
    await store.refresh();
    if (command === 'task create') {
      if (store.list('task_put').length) throw new Error('Task already exists');
      const repository = resolve(required('--repository')), baselineCommit = required('--baseline'), bank = await readBank(required('--bank'));
      const config = flags.has('--config') ? validateRsiConfig(await json(required('--config'))) : defaultRsiConfig();
      const settings = flags.has('--settings') ? validateWorkerSettings(await json(required('--settings')) as WorkerSettings) : defaultWorkerSettings();
      const token = randomBytes(32).toString('hex'), at = now();
      const task = validateRsiTask({ id: taskId, repository, baselineCommit, datasetHash: bank.datasetHash, mainMetric: 'passed_count', config,
        state: 'created', pauseReason: null, delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0,
        tokenUsage: 0, iterationCount: 0, currentParentId: null, taskTokenHash: createHash('sha256').update(token).digest('hex'), createdAt: at, updatedAt: at });
      await mkdir(join(root, 'private'), { recursive: true, mode: 0o700 });
      await createMirror(repository, join(root, 'private/repository.git')); await importCommit(repository, join(root, 'private/repository.git'), baselineCommit);
      await cp(bank.root, join(root, 'private/bank'), { recursive: true });
      await privateWrite(join(root, 'private/fingerprints.json'), JSON.stringify(buildFingerprintDictionary([...bank.questions.values()], config.l1)));
      await privateWrite(join(root, 'private/runtime.json'), JSON.stringify(settings));
      await store.put({ event: 'task_put', payload: task }, 'human');
      const item = await enqueue(store, { action: 'start' }, 'human', 'start');
      output({ taskId, queueId: item.id, status: 'queued', agentToken: token }); return;
    }
    const task = store.task();
    if (command === 'task status') {
      const { taskTokenHash: _digest, ...view } = task;
      output({ task: view, head: getRsiLedgerHead(db, taskId), iterations: store.list('iteration_put'), evaluations: store.list('evaluation_put'), queue: store.list('queue_put') }); return;
    }
    if (command === 'iteration submit') {
      const commit = required('--commit'), prd = await json(required('--prd')) as RsiPrd;
      const duplicate = store.list('queue_put').find(q => q.id === required('--request'));
      if (duplicate) {
        if (duplicate.command.action !== 'submit') throw new Error('RSI idempotency conflict');
        const item = await enqueue(store, { action: 'submit', commit, prd, parentId: duplicate.command.parentId }, 'optimizer', required('--request'));
        output({ taskId, queueId: item.id, status: 'queued' }); return;
      }
      if (task.state !== 'running') throw new Error('Task must be running to submit');
      const parentId = selectParent([{ iterationId: null, seq: 0, state: 'baseline', trainScore: task.baselineTrainScore! },
        ...store.list('iteration_put').filter(i => i.state === 'promoted').map(i => ({ iterationId: i.id, seq: i.seq, state: i.state, trainScore: i.trainScore! }))], task.delta!).iterationId;
      const at = now();
      // Validate ingress before importing a candidate or appending its queue record.
      validateRsiQueueItem({ id: required('--request'), taskId, kind: 'submit', iterationId: null, evaluationId: null, state: 'queued', requestedBy: 'optimizer', reason: null,
        command: { action: 'submit', commit, prd, parentId }, createdAt: at, updatedAt: at });
      await importCommit(task.repository, join(root, 'private/repository.git'), commit);
      const item = await enqueue(store, { action: 'submit', commit, prd, parentId }, 'optimizer', required('--request'));
      output({ taskId, queueId: item.id, status: 'queued' }); return;
    }
    if (command === 'task command') {
      const cmd = await json(required('--command')) as RsiCommand;
      if (['submit', 'evaluate', 'review', 'declare_stuck', 'start', 'adopt', 'rollback', 'instruction'].includes(cmd.action)) throw new Error('Command outside P2 human CLI scope');
      const iterationId = flags.get('--iteration') ?? null;
      const item = await enqueue(store, cmd, 'human', required('--request'), iterationId); output({ taskId, queueId: item.id, status: 'queued' }); return;
    }
    if (command === 'worker') {
      const settings = validateWorkerSettings(await json(join(root, 'private/runtime.json')) as WorkerSettings);
      const controller = new AbortController(), abort = (): void => controller.abort();
      process.on('SIGINT', abort); process.on('SIGTERM', abort);
      try { output(await runWorker(store, settings, new CliDockerClient(flags.get('--docker-context') ?? null), execute, { signal: controller.signal, reviews: options.reviews, afterRun: options.afterRun })); }
      finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
      return;
    }
    throw new Error('Unknown RSI command. Use --help');
  } finally { db.close(); }
}
