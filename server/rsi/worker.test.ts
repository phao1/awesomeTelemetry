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
import { resolveReviewSettings, defaultReviewSettings } from './review.js';
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
  calls: SlotRequest[] = []; infra = new Set<string>(); tokens = 100; noSession = false; candidateFail = false; crashAt = 0;
  plan?: (req: SlotRequest) => boolean; forcedFailure: 'agent_timeout' | 'agent_crashed' | 'run_token_budget' | null = null;
  docker = new FakeDocker();
  async prepare(): Promise<string> { return 'f'.repeat(64); }
  async run(req: SlotRequest): Promise<SlotResult> {
    this.calls.push(req);
    if (this.crashAt && this.calls.length === this.crashAt) throw new Error('transport failure');
    const key = `${req.evaluation.phase}:${req.question.questionId}`;
    if (this.infra.has(key)) return { outcome: 'infra_error', failureReason: 'infrastructure', proxyTokens: this.tokens, artifactPath: null, sessionPath: null, sessionTokens: this.noSession ? null : this.tokens };
    if (this.forcedFailure) return { outcome: 'fail', failureReason: this.forcedFailure, proxyTokens: this.tokens, artifactPath: null, sessionPath: null, sessionTokens: this.noSession ? null : this.tokens };
    this.docker.fail = this.plan ? !this.plan(req) : req.evaluation.iterationId === null ? !(req.question.questionId === 'train_python' && req.repetition === 1) : this.candidateFail;
    const r = await this.docker.run(['exec', 'test']);
    const verdict = parseReport(r.stdout.toString(), r.code, { report: 'node-test-events', expectedTests: 1 });
    return { outcome: verdict.outcome, failureReason: verdict.outcome === 'pass' ? null : 'test_failed', proxyTokens: this.tokens, artifactPath: null, sessionPath: null, sessionTokens: this.noSession ? null : this.tokens };
  }
}
async function setup(config = {}, reviews?: ReviewProvider): Promise<{ store: RsiStore; worker: RsiWorker; backend: ModelBackend }> {
  const root = await mkdtemp(join(tmpdir(), 'worker-')); dirs.push(root);
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); db.exec(RSI_SCHEMA_SQL);
  const store = new RsiStore(db, root, 'task'), at = now();
  const bank = await readBank(resolve('server/rsi/__fixtures__/bank'));
  await store.put({ event: 'task_put', payload: { id: 'task', repository: 'local', baselineCommit: baseline, datasetHash: bank.datasetHash, mainMetric: 'passed_count', config: { ...defaultRsiConfig(), targetPassedCount: 3, ...config }, state: 'created', pauseReason: null, delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0, monitorCalibration: null, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: at, updatedAt: at } }, 'human');
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
    const { store, worker, backend } = await setup({}, clean);
    backend.plan = req => req.evaluation.iterationId === null;
    await worker.run(); expect(worker.smokeFloor()).toBe(1);
    await candidate(store); backend.candidateFail = true; backend.plan = undefined; await worker.run();
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
    const at = now(), e = { id: 'interrupted', taskId: 'task', iterationId: null, commit: baseline, phase: 'train' as const, sourceCommit: null, ablationOf: null, state: 'queued' as const,
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
  it.each(['agent_timeout', 'agent_crashed', 'run_token_budget'] as const)('%s is fail and never retried', async failure => {
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
    // The person's reason is in the decision log, and the automatic decision that followed names what they accepted.
    const decisions = store.list('decision_put');
    expect(decisions.find(d => d.actor === 'human')).toMatchObject({ verdict: 'promote', reason: 'Accept documented increase', approvedCategories: ['token_growth'] });
    expect(decisions.find(d => d.actor === 'worker' && d.verdict === 'promote')?.approvedCategories).toEqual(['token_growth']);
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

it('allows smoke failures already unstable in baseline calibration and continues to train', async () => {
  const { store, worker, backend } = await setup();
  backend.plan = req => req.evaluation.iterationId === null
    ? req.question.questionId === 'train_node' && req.repetition === 0
    : req.evaluation.phase === 'smoke' ? false : true;
  await worker.run(); expect(worker.smokeFloor()).toBe(0);
  await candidate(store); await worker.run();
  expect(backend.calls.some(c => c.evaluation.iterationId !== null && c.evaluation.phase === 'train')).toBe(true);
  expect(store.list('iteration_put')[0]!.state).toBe('held');
});

it('format none retains proxy accounting without native-session discrepancy findings', async () => {
  const { readAgentProfile } = await import('./agent-profile.js');
  const { store, worker, backend } = await setup(); backend.noSession = true;
  await worker.run(); await candidate(store);
  const profile = (await readAgentProfile(resolve('rsi-agents/mini-agent/profile.json'))).profile;
  const resumed = new RsiWorker(store, worker.bank, defaultWorkerSettings(), backend, undefined, undefined, profile);
  await resumed.loadUsage(); await resumed.run();
  expect(store.list('iteration_put')[0]!.state).toBe('held');
  expect(store.list('finding_put').filter(f => f.level === 'L2')).toEqual([]);
  expect(store.task().tokenUsage).toBeGreaterThan(0);
});

// P5 exercises real ledger/cache/gate paths; only the execution transport is fake.
describe('P5 review evaluation and audit scheduling', () => {
  it('refuses a same-family worker configuration before execution', async () => {
    const { backend } = await setup();
    expect(() => resolveReviewSettings('openai', {monitorFamily:'openai'})).toThrow('families must differ');
    expect(backend.calls).toHaveLength(0);
  });
  it('keeps old info findings in gate input and excludes only trusted P5 info sources', async () => {
    const { store, worker } = await setup(); await worker.run(); const i = await candidate(store);
    const at = now();
    for (const [id, source, level] of [['patch', 'patch_scan', 'L1'], ['process', 'process_monitor', 'L4'], ['degraded', 'degraded_monitor', 'L4'], ['old-rule', 'rule', 'L1'], ['old-monitor', 'monitor', 'L4']] as const) {
      await store.put({ event: 'finding_put', payload: { id, taskId: 'task', iterationId: i.id, source, level, category: 'suspicious', severity: 'info', file: null, line: null, evidence: 'private evidence', at } });
    }
    const input = worker.promotionInput(i);
    expect(input.findings.map(f => f.id).sort()).toEqual(['old-monitor', 'old-rule']);
    expect(worker.gate(i).conditions[0]!.reasons).toContain('l1_reject');
    expect(worker.gate(i).conditions[0]!.reasons).toContain('l4_suspicious');
    expect(worker.gate(i).conditions[0]!.reasons).toContain('missing_adversarial');
  });
  it('evaluates baseline-parent adversarial variants once and reuses durable slots', async () => {
    const { store, worker, backend } = await setup(); await worker.run();
    const source = worker.bank.questions.get('train_node')!, question = { ...source, questionId: 'variant-node' };
    const data = { repo: Buffer.from('private snapshot'), hidden: Buffer.from('private tests'), statement: 'Variant statement' };
    const request = { key: 'candidate-parent-variants', iterationId: null, commit: baseline, phase: 'adversarial' as const, questions: [{ question, data }] };
    const before = backend.calls.length, tokens = store.task().tokenUsage;
    const result = await worker.reviewEvaluation(request);
    expect(result!.repetitions).toBe(1); expect(result!.iterationId).toBeNull(); expect(result!.phase).toBe('adversarial');
    expect(result!.state).toBe('completed'); expect(result!.score).toBe(0);
    expect(backend.calls.slice(before)).toHaveLength(1); expect(backend.calls.at(-1)!.data).toEqual(data);
    expect(store.task().tokenUsage).toBe(tokens + 100);
    expect(await worker.reviewEvaluation(request)).toEqual(result);
    expect(backend.calls).toHaveLength(before + 1); expect(store.task().tokenUsage).toBe(tokens + 100);
    await expect(worker.reviewEvaluation({ ...request, phase: 'ablation' })).rejects.toThrow('identity');
  });
  it('retries adversarial infrastructure once and retains an incomplete group', async () => {
    const { store, worker, backend } = await setup(); await worker.run(); const i = await candidate(store);
    const question = { ...worker.bank.questions.get('train_node')!, questionId: 'variant-infra' };
    backend.infra.add('adversarial:variant-infra');
    expect(await worker.reviewEvaluation({ key: 'candidate-infra-variants', iterationId: i.id, commit, phase: 'adversarial', questions: [{ question, data: { repo: Buffer.alloc(0), hidden: Buffer.alloc(0), statement: 'Variant' } }] })).toBeNull();
    expect(backend.calls.filter(r => r.question.questionId === question.questionId).map(r => r.attempt)).toEqual([0, 1]);
    const evaluation = store.list('evaluation_put').find(e => e.phase === 'adversarial')!;
    expect(evaluation.score).toBeNull(); expect(evaluation.state).toBe('infra_failed'); expect(store.task().pauseReason).toBe('infra_failed');
  });
  it('records ablation source linkage and evaluates all training questions', async () => {
    const { store, worker, backend } = await setup(); await worker.run(); const i = await candidate(store);
    const ablationCommit = 'd'.repeat(40), before = backend.calls.length;
    const result = await worker.reviewEvaluation({ key: 'candidate-ablation', iterationId: i.id, commit: ablationCommit, sourceCommit: commit, ablationOf: i.id, phase: 'ablation' });
    expect(result!.commit).toBe(ablationCommit); expect(result!.sourceCommit).toBe(commit); expect(result!.ablationOf).toBe(i.id);
    expect(result!.questionIds).toEqual(worker.bank.manifest.sets.train);
    expect(backend.calls.slice(before).every(r => r.evaluation.phase === 'ablation' && r.evaluation.commit === ablationCommit)).toBe(true);
  });
  it('invalidates budget-interrupted review evaluations and uses a fresh group after resume', async () => {
    const { store, worker, backend } = await setup(); await worker.run(); const i = await candidate(store);
    const limit = store.task().tokenUsage + 50;
    await enqueue(store, { action: 'set_budget', maxTaskTokens: limit, maxIterations: 20, sealedQueryBudget: 10, reason: 'Boundary test' }, 'human', 'review-limit');
    await worker.command(store.list('queue_put').find(q => q.id === 'review-limit')!);
    const question = { ...worker.bank.questions.get('train_node')!, questionId: 'variant-budget' };
    const request = { key: 'candidate-budget-variants', iterationId: i.id, commit, phase: 'adversarial' as const, questions: [{ question, data: { repo: Buffer.alloc(0), hidden: Buffer.alloc(0), statement: 'Variant' } }] };
    expect(await worker.reviewEvaluation(request)).toBeNull();
    const invalid = store.list('evaluation_put').find(e => e.phase === 'adversarial')!;
    expect(invalid.state).toBe('invalidated'); expect(invalid.score).toBeNull(); expect(store.task().pauseReason).toBe('budget_exhausted');
    await enqueue(store, { action: 'set_budget', maxTaskTokens: 100000, maxIterations: 20, sealedQueryBudget: 10, reason: 'Raise review budget' }, 'human', 'review-raise');
    await enqueue(store, { action: 'resume', reason: 'Resume review' }, 'human', 'review-resume');
    await worker.command(store.list('queue_put').find(q => q.id === 'review-raise')!);
    await worker.command(store.list('queue_put').find(q => q.id === 'review-resume')!);
    const resumed = new RsiWorker(store, worker.bank, defaultWorkerSettings(), backend);
    await resumed.loadUsage();
    const complete = await resumed.reviewEvaluation(request);
    expect(complete!.state).toBe('completed'); expect(complete!.id).not.toBe(invalid.id);
    expect(store.list('evaluation_put').find(e => e.id === invalid.id)!.state).toBe('invalidated');
  });
  it('queues deterministic promoted audits once and leaves them pending for humans', async () => {
    const { store, worker } = await setup({}, clean);
    worker.settings.reviews = { ...defaultReviewSettings(), auditSampleRate: 1 };
    await worker.run(); await candidate(store); await worker.run();
    const iteration = store.list('iteration_put')[0]!; expect(iteration.state).toBe('promoted');
    const audits = () => store.list('queue_put').filter(q => q.command.action === 'review' && q.command.audit);
    expect(audits()).toHaveLength(1); expect(audits()[0]!.state).toBe('queued');
    await worker.run(); await worker.scheduleAudits();
    expect(audits()).toHaveLength(1); expect(audits()[0]!.state).toBe('queued');
    expect(store.list('iteration_put')[0]!.state).toBe('promoted');
  });
});

it('asks a person instead of spending a round when the baseline already meets the goal', async () => {
  const { store, worker, backend } = await setup({ targetPassedCount: 1 });
  backend.plan = () => true;
  let sessions = 0; worker.optimizerSession = async () => { sessions++; };
  await enqueue(store, { action: 'start' }, 'human', 'start');
  await worker.run();
  expect(sessions).toBe(0); expect(store.task().state).toBe('needs_help');
  expect(store.list('queue_put').find(q => q.id === 'baseline-at-target-1')?.command).toMatchObject({ action: 'declare_stuck' });
});
