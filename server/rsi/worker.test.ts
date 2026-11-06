import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { RSI_SCHEMA_SQL } from '../storage/schema.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { transitionIteration } from '../../src/core/rsi-state-machine.js';
import type { RsiIteration } from '../../src/core/rsi-types.js';
import { RsiStore, enqueue, now } from './queue.js';
import { readBank } from './bank.js';
import { defaultWorkerSettings } from './cli.js';
import { RsiWorker } from './worker.js';
import type { ExecutionBackend, SlotRequest, SlotResult } from './worker.js';
import type { ReviewProvider } from './review.js';
import { recoverWork } from './recovery.js';
import type { CommandResult, DockerClient } from './docker.js';
import { parseReport } from './reporters/parse.js';

const dbs: Database.Database[] = [], dirs: string[] = [], baseline = 'a'.repeat(40), commit = 'b'.repeat(40);
afterEach(async () => { for (const db of dbs.splice(0)) db.close(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const clean: ReviewProvider = { review: async () => ({ monitor: { status: 'clean' }, adversarial: { status: 'clean' } }) };
class FakeDocker implements DockerClient {
  calls: string[][] = []; fail = false;
  async run(argv: string[]): Promise<CommandResult> {
    this.calls.push(argv);
    return { code: this.fail ? 1 : 0, stdout: Buffer.from(JSON.stringify({ reporter: 'rsi-node-v1', tests: 1, passed: this.fail ? 0 : 1, failed: this.fail ? 1 : 0, skipped: 0, cancelled: 0, todo: 0 })), stderr: Buffer.alloc(0), cancelled: false, timedOut: false, overflow: false };
  }
}
class ModelBackend implements ExecutionBackend {
  calls: SlotRequest[] = []; infra = new Set<string>(); tokens = 100; candidateFail = false; crashAt = 0;
  plan?: (req: SlotRequest) => boolean; forcedFailure: 'agent_timeout' | 'run_token_budget' | null = null;
  docker = new FakeDocker();
  async prepare(): Promise<string> { return 'f'.repeat(64); }
  async run(req: SlotRequest): Promise<SlotResult> {
    this.calls.push(req);
    if (this.crashAt && this.calls.length === this.crashAt) throw new Error('transport failure');
    const key = `${req.evaluation.phase}:${req.question.questionId}`;
    if (this.infra.has(key)) return { outcome: 'infra_error', failureReason: 'infrastructure', proxyTokens: this.tokens, artifactPath: null, sessionPath: null, sessionTokens: this.tokens };
    if (this.forcedFailure) return { outcome: 'fail', failureReason: this.forcedFailure, proxyTokens: this.tokens, artifactPath: null, sessionPath: null, sessionTokens: this.tokens };
    this.docker.fail = this.plan ? !this.plan(req) : req.evaluation.iterationId === null ? !(req.question.questionId === 'train_python' && req.repetition === 1) : this.candidateFail;
    const r = await this.docker.run(['exec', 'test']);
    const verdict = parseReport(r.stdout.toString(), r.code, { report: 'node-test-events', expectedTests: 1 });
    return { outcome: verdict.outcome, failureReason: verdict.outcome === 'pass' ? null : 'test_failed', proxyTokens: this.tokens, artifactPath: null, sessionPath: null, sessionTokens: this.tokens };
  }
}
async function setup(config = {}, reviews?: ReviewProvider): Promise<{ store: RsiStore; worker: RsiWorker; backend: ModelBackend }> {
  const root = await mkdtemp(join(tmpdir(), 'worker-')); dirs.push(root);
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); db.exec(RSI_SCHEMA_SQL);
  const store = new RsiStore(db, root, 'task'), at = now();
  const bank = await readBank(resolve('server/rsi/__fixtures__/bank'));
  await store.put({ event: 'task_put', payload: { id: 'task', repository: 'local', baselineCommit: baseline, datasetHash: bank.datasetHash, mainMetric: 'passed_count', config: { ...defaultRsiConfig(), targetPassedCount: 3, ...config }, state: 'created', pauseReason: null, delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: at, updatedAt: at } }, 'human');
  const backend = new ModelBackend(), worker = new RsiWorker(store, bank, defaultWorkerSettings(), backend, reviews); await worker.loadUsage();
  return { store, worker, backend };
}
async function candidate(store: RsiStore): Promise<RsiIteration> {
  const at = now(); let i: RsiIteration = { id: 'candidate', taskId: 'task', seq: 1, parentId: null, commit, prd: { observation: 'misses', hypothesis: 'repair', changes: ['agent.ts'], expectedImpact: 'more passes' }, packageSha256: null, state: 'draft', holdReasons: [], resumeState: null, approvals: [], trainScore: null, sealedScore: null, createdAt: at, updatedAt: at };
  await store.put({ event: 'iteration_put', payload: i }, 'optimizer');
  for (const [event, actor] of [['submit', 'optimizer'], ['start_precheck', 'worker'], ['precheck_pass', 'worker']] as const) {
    i = { ...i, state: transitionIteration(i.state, event, { actor }), updatedAt: now() }; await store.put({ event: 'iteration_put', payload: i }, actor);
  }
  return i;
}
describe('ledger-backed worker scheduling', () => {
  it('calibrates nonzero delta, holds missing reviews and spends no candidate sealed query', async () => {
    const { store, worker, backend } = await setup(); await worker.run();
    expect(store.task().state).toBe('running'); expect(store.task().delta).toBeGreaterThan(0);
    expect(store.task().baselineTrainScore).toBe(1 / 3); expect(store.task().baselineSealedScore).toBe(0);
    expect(backend.calls.length).toBe(18); await candidate(store); await worker.run();
    const i = store.list('iteration_put')[0]!;
    expect(i.state).toBe('held'); expect(i.holdReasons).toEqual(['missing_monitor', 'missing_adversarial']); expect(i.trainScore).toBe(3);
    expect(store.task().sealedQueriesUsed).toBe(0); expect(backend.calls.filter(c => c.evaluation.iterationId !== null && c.evaluation.phase === 'sealed')).toHaveLength(0);
  });
  it('runs sealed after clean reviews and promotes through the existing gate', async () => {
    const { store, worker, backend } = await setup({}, clean); await worker.run(); await candidate(store); await worker.run();
    expect(store.task().state).toBe('completed'); expect(store.task().sealedQueriesUsed).toBe(1);
    expect(store.list('iteration_put')[0]!.state).toBe('promoted'); expect(store.list('iteration_put')[0]!.sealedScore).toBe(3);
    expect(backend.calls.filter(c => c.evaluation.iterationId !== null && c.evaluation.phase === 'sealed')).toHaveLength(9);
    const calls = backend.calls.length; await worker.run(); expect(backend.calls).toHaveLength(calls);
  });
  it('stops after smoke failure without scheduling train or reviews', async () => {
    const { store, worker, backend } = await setup({}, clean); await worker.run(); await candidate(store); backend.candidateFail = true; await worker.run();
    expect(store.list('iteration_put')[0]!.state).toBe('rejected');
    expect(backend.calls.filter(c => c.evaluation.iterationId !== null).map(c => c.evaluation.phase)).toEqual(['smoke']);
  });
  it('retries infra errors once and pauses without calibration; fail slots never retry', async () => {
    const { store, worker, backend } = await setup(); backend.infra.add('train:train_node'); await worker.run();
    expect(store.task().state).toBe('paused'); expect(store.task().pauseReason).toBe('infra_failed'); expect(store.task().delta).toBeNull();
    expect(backend.calls.filter(c => c.question.questionId === 'train_node')).toHaveLength(6);
    expect(backend.calls.filter(c => c.question.questionId === 'train_go')).toHaveLength(3);
  });
  it('invalidates in-flight evaluations when task tokens reach the limit', async () => {
    const { store, worker } = await setup({ maxTaskTokens: 150 }); await worker.run();
    expect(store.task().state).toBe('paused'); expect(store.task().pauseReason).toBe('budget_exhausted');
    expect(store.task().tokenUsage).toBeGreaterThanOrEqual(150); expect(store.task().delta).toBeNull();
    expect(store.list('evaluation_put')[0]!.state).toBe('invalidated'); expect(store.list('evaluation_put')[0]!.score).toBeNull();
  });
  it('requires human retry_review before a missing review can proceed', async () => {
    const { store, worker, backend } = await setup(); await worker.run(); await candidate(store); await worker.run();
    await enqueue(store, { action: 'retry_review', reason: 'Review provider available' }, 'human', 'retry', 'candidate');
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), resumed = new RsiWorker(store, bank, defaultWorkerSettings(), backend, clean);
    await resumed.loadUsage(); await resumed.run(); expect(store.list('iteration_put')[0]!.state).toBe('promoted');
  });
  it('recovers a running evaluation using retained run slots without charging them twice', async () => {
    const { store, worker, backend } = await setup(); await worker.taskEvent('start', 'start');
    const at = now(), e = { id: 'interrupted', taskId: 'task', iterationId: null, commit: baseline, phase: 'train' as const, state: 'queued' as const,
      repetitions: 3, questionIds: ['train_node', 'train_python', 'train_go'], passedCounts: [], score: null, infraErrorRatio: null, sealedVerdict: null, locked: false, createdAt: at, updatedAt: at };
    await store.put({ event: 'evaluation_put', payload: e }); await store.put({ event: 'evaluation_put', payload: { ...e, state: 'running' } });
    const { createHash } = await import('node:crypto');
    const id = createHash('sha256').update(JSON.stringify([e.id, 'train_node', 0, 0])).digest('hex');
    await store.put({ event: 'run_put', payload: { id, taskId: 'task', evaluationId: e.id, questionId: 'train_node', repetition: 0, attempt: 0, outcome: 'fail', failureReason: 'test_failed', durationMs: 1, proxyTokens: 100, artifactPath: null, sessionPath: null, at } });
    const cleanup: string[][] = [], docker: DockerClient = { run: async argv => { cleanup.push(argv); return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, cancelled: false, overflow: false }; } };
    await recoverWork(store, docker); await worker.loadUsage(); await worker.run();
    expect(store.task().state).toBe('running'); expect(backend.calls).toHaveLength(17);
    expect(store.list('run_put').filter(r => r.id === id)).toHaveLength(1); expect(store.task().tokenUsage).toBe(1800);
    expect(cleanup[0]).toContain('label=awesome-telemetry.rsi=task');
  });
});

describe('worker budget and late approval recovery', () => {
  it.each(['agent_timeout', 'run_token_budget'] as const)('%s is fail and never retried', async failure => {
    const { store, worker, backend } = await setup(); backend.forcedFailure = failure; await worker.run();
    expect(store.task().state).toBe('running'); expect(backend.calls).toHaveLength(18);
    expect(store.list('run_put').every(r => r.outcome === 'fail' && r.attempt === 0 && r.failureReason === failure)).toBe(true);
  });
  it('does not calibrate below the tolerated infra ratio', async () => {
    const { store, worker, backend } = await setup({ infraErrorMaxRatio: 0.5 }); backend.infra.add('train:train_node'); await worker.run();
    expect(store.task().pauseReason).toBe('incomplete_comparison'); expect(store.task().delta).toBeNull();
    expect(store.list('evaluation_put')[0]!.state).toBe('completed'); expect(store.list('evaluation_put')[0]!.score).toBeNull();
  });
  it('creates a new evaluation after a human increases and resumes the budget', async () => {
    const { store, worker } = await setup({ maxTaskTokens: 150 }); await worker.run();
    const invalidId = store.list('evaluation_put')[0]!.id;
    await enqueue(store, { action: 'set_budget', maxTaskTokens: 10000, maxIterations: 20, sealedQueryBudget: 10, reason: 'Raise budget' }, 'human', 'raise');
    await enqueue(store, { action: 'resume', reason: 'Resume calibration' }, 'human', 'resume');
    await worker.run(); expect(store.task().state).toBe('running');
    expect(store.list('evaluation_put').find(e => e.id === invalidId)!.state).toBe('invalidated');
    expect(store.list('evaluation_put').some(e => e.id !== invalidId && e.phase === 'train' && e.state === 'completed')).toBe(true);
  });
  it('reuses sealed evidence after exact human token-growth approval', async () => {
    const { store, worker, backend } = await setup({}, clean); await worker.run(); await candidate(store); backend.tokens = 200; await worker.run();
    const i = store.list('iteration_put')[0]!; expect(i.holdReasons).toEqual(['token_growth']); expect(i.resumeState).toBe('deciding');
    const count = backend.calls.length;
    await enqueue(store, { action: 'approve', categories: ['token_growth'], reason: 'Accept documented increase' }, 'human', 'approve-tokens', i.id);
    await worker.run(); expect(store.list('iteration_put')[0]!.state).toBe('promoted'); expect(store.task().sealedQueriesUsed).toBe(1); expect(backend.calls).toHaveLength(count);
  });
  it('confirms stable failure without replacing the first train score', async () => {
    const { store, worker, backend } = await setup({ stableWindow: 1 }, clean);
    backend.plan = req => req.evaluation.iterationId === null ? req.question.questionId === 'train_python' : req.question.questionId !== 'train_python';
    await worker.run(); await candidate(store); await worker.run();
    const i = store.list('iteration_put')[0]!; expect(i.state).toBe('rejected'); expect(i.trainScore).toBe(2);
    expect(store.list('evaluation_put').filter(e => e.iterationId === i.id && e.phase === 'train')).toHaveLength(2);
    expect(store.list('decision_put').at(-1)!.reason).toBe('stable_regression');
  });
});

describe('crash windows around reservations and promotion', () => {
  it('does not consume a second sealed reservation after a crash before evaluation creation', async () => {
    const { store, worker, backend } = await setup({}, clean); await worker.run(); await candidate(store);
    await worker.processIteration(store.list('iteration_put')[0]!); await worker.processIteration(store.list('iteration_put')[0]!);
    expect(store.list('iteration_put')[0]!.state).toBe('sealed');
    await store.put({ event: 'task_put', payload: { ...store.task(), sealedQueriesUsed: 1, updatedAt: now() } });
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), resumed = new RsiWorker(store, bank, defaultWorkerSettings(), backend, clean);
    await resumed.loadUsage(); await resumed.run(); expect(store.task().sealedQueriesUsed).toBe(1); expect(store.task().state).toBe('completed');
  });
  it('repairs task parent and target after promotion was durable before task updates', async () => {
    const { store, worker, backend } = await setup({}, clean); await worker.run(); await candidate(store);
    for (let n = 0; n < 3; n++) await worker.processIteration(store.list('iteration_put')[0]!);
    const i = store.list('iteration_put')[0]!; expect(i.state).toBe('deciding'); expect(worker.gate(i).verdict).toBe('promote');
    await worker.iterationEvent(i, 'promotion_pass', { actor: 'worker', hasSealedResult: true });
    const count = backend.calls.length; await worker.run(); expect(store.task().state).toBe('completed'); expect(store.task().currentParentId).toBe(i.id); expect(backend.calls).toHaveLength(count);
  });
  it('locks final results and rejects another human reservation', async () => {
    const { store, worker, backend } = await setup({}, clean); await worker.run(); await candidate(store); await worker.run();
    await enqueue(store, { action: 'final', reason: 'Human final request' }, 'human', 'final', 'candidate'); await worker.run();
    const e = store.list('evaluation_put').find(e => e.phase === 'final')!; expect(e.locked).toBe(true); expect(e.score).toBe(3);
    const count = backend.calls.length; await worker.run(); expect(backend.calls).toHaveLength(count);
    await expect(enqueue(store, { action: 'final', reason: 'Again' }, 'human', 'another-final', 'candidate')).rejects.toThrow('already reserved');
  });
});
