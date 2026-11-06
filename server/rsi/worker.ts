import { optionalArtifact, runTelemetry } from './page-data.js';
import { finalRuns, promotionInput } from './verdict.js';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { RsiEvaluation, RsiHoldReason, RsiIteration, RsiIterationContext, RsiIterationEvent, RsiOutcome, RsiPromotionInput, RsiQueueItem, RsiRun, RsiTaskEvent } from '../../src/core/rsi-types.js';
import { transitionIteration, transitionTask } from '../../src/core/rsi-state-machine.js';
import { calibrateNoiseBand } from '../../src/core/rsi-noise.js';
import { decidePromotion, isStableRegression, selectParent } from '../../src/core/rsi-gate.js';
import type { RsiFingerprintDictionary } from '../../src/core/rsi-types.js';
import type { QuestionBank, RsiBankQuestion, QuestionData } from './bank.js';
import { readBank, readQuestionData } from './bank.js';
import { createMirror, importCommit, git, BuildRejected, buildCandidate, candidateDiff, precheck, pruneImages } from './build.js';
import type { BuiltCandidate } from './build.js';
import type { DockerClient } from './docker.js';
import { mustDocker } from './docker.js';
import { evaluatePatch } from './evaluator.js';
import { runTarget } from './target-run.js';
import { exportProxyArtifacts, readProxyUsage, startProxy, stopProxy, upstreamEnvironment } from './proxy-run.js';
import type { MockScript, ProxySettings, UsageReceipt } from './proxy-run.js';
import { privateWrite } from './artifacts.js';
import type { RsiStore } from './queue.js';
import { enqueue, newId, now, taskLock } from './queue.js';
import { recoverWork } from './recovery.js';
import { MissingReviewProvider, resolveReviewSettings, validateReviewConfiguration, defaultReviewSettings } from './review.js';
import type { ReviewSettings } from './review.js';
import { AgentReviewProvider, auditSelected, createReviewModelClient } from './agent-review.js';
import type { ReviewEvaluationRequest } from './agent-review.js';
import { StoredOptimizerSessionReader } from './reader.js';
import type { OptimizerSessionReader } from './process-monitor.js';
import type { HealthModelClient } from '../task-health/model-client.js';
import { scanTargetPatch } from './patch-scan.js';
import type { ReviewProvider } from './review.js';
import type { AgentPins, RsiAgentProfile } from './agent-profile.js';
import { readFrozenAgent } from './agent-profile.js';
import { readFrozenOptimizer, buildOptimizer } from './optimizer-profile.js';
import { recoverOptimizerSessions, runOptimizerSession, consecutiveNoSubmissions } from './optimizer-session.js';
import { selectedParent } from './commands.js';
import { adopt } from './adopt.js';
import { measureQuality } from './quality.js';

export interface WorkerSettings {
  concurrency: number; agentTimeoutMs: number; reconciliationMaxRatio: number;
  keepRecentImages: number; imagesRoot: string; reportersRoot: string;
  agent?: AgentPins; optimizer?: AgentPins; reviews?: Partial<ReviewSettings>;
  optimizerSessionTokens?: number; optimizerSessionTimeoutMs?: number; allowUnmeteredOptimizer?: boolean; apiBase?: string;
  proxy: ProxySettings; candidateMockTable: Record<string, MockScript>;
}
export interface SlotRequest { runId: string; evaluation: RsiEvaluation; question: RsiBankQuestion; data?: QuestionData; repetition: number; attempt: 0 | 1; signal: AbortSignal }
export interface SlotResult {
  outcome: RsiOutcome; failureReason: RsiRun['failureReason']; proxyTokens: number | null;
  artifactPath: string | null; sessionPath: string | null; sessionTokens: number | null;
}
/** Only external build/container/model transport is substituted by unit tests. */
export interface ExecutionBackend {
  prepare(commit: string, signal: AbortSignal): Promise<string>;
  run(request: SlotRequest, usage: (receipt: UsageReceipt) => Promise<void>): Promise<SlotResult>;
  cleanup?(): Promise<void>;
}
export function validateWorkerSettings(v: WorkerSettings): WorkerSettings {
  const fields = (value: unknown, allowed: string[], field: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${field}`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Invalid ${field}.${key}`);
  };
  fields(v, ['concurrency', 'agentTimeoutMs', 'reconciliationMaxRatio', 'keepRecentImages', 'imagesRoot', 'reportersRoot', 'proxy', 'candidateMockTable', 'agent', 'reviews', 'optimizer', 'optimizerSessionTokens', 'optimizerSessionTimeoutMs', 'allowUnmeteredOptimizer', 'apiBase'], 'settings');
  if(v.reviews) validateReviewConfiguration(v.reviews);
  fields(v.proxy, ['mode', 'maxTokens', 'inputTokensPerByte', 'mockTable'], 'settings.proxy');
  for (const n of [v.optimizerSessionTokens, v.optimizerSessionTimeoutMs]) if (n !== undefined && (!Number.isSafeInteger(n) || n <= 0)) throw new Error('Invalid optimizer limit');
  if (v.allowUnmeteredOptimizer !== undefined && typeof v.allowUnmeteredOptimizer !== 'boolean') throw new Error('Invalid allowUnmeteredOptimizer');
  if (v.apiBase !== undefined) { const u = new URL(v.apiBase); if (u.protocol !== 'http:' || u.pathname !== '/' || u.username || u.password || u.search || u.hash) throw new Error('Invalid platform origin'); }
  if (v.optimizer && (!/^[a-f0-9]{64}$/.test(v.optimizer.profileSha256) || !/^[a-f0-9]{64}$/.test(v.optimizer.dockerfileSha256))) throw new Error('Invalid optimizer pins');
  if (v.agent) {
    fields(v.agent, ['profileSha256', 'dockerfileSha256'], 'settings.agent');
    for (const key of ['profileSha256', 'dockerfileSha256'] as const) if (!/^[a-f0-9]{64}$/.test(v.agent[key])) throw new Error(`Invalid settings.agent.${key}`);
  }
  for (const n of [v.concurrency, v.agentTimeoutMs, v.keepRecentImages, v.proxy.maxTokens]) if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid worker limit');
  if (v.concurrency > 32 || !Number.isFinite(v.reconciliationMaxRatio) || v.reconciliationMaxRatio < 0
    || !Number.isFinite(v.proxy.inputTokensPerByte) || v.proxy.inputTokensPerByte <= 0 || !['mock', 'real'].includes(v.proxy.mode)) throw new Error('Invalid worker settings');
  return v;
}
export class ContainerBackend implements ExecutionBackend {
  readonly store: RsiStore; readonly client: DockerClient; readonly bank: QuestionBank; readonly settings: WorkerSettings; readonly profile: RsiAgentProfile;
  private built = new Map<string, BuiltCandidate>(); private infrastructureReady = false;
  constructor(store: RsiStore, client: DockerClient, bank: QuestionBank, settings: WorkerSettings, profile: RsiAgentProfile) {
    this.store = store; this.client = client; this.bank = bank; this.settings = settings; this.profile = profile;
  }
  async prepare(commit: string, signal: AbortSignal): Promise<string> {
    if (!this.infrastructureReady) {
      const context = await mkdtemp(join(tmpdir(), 'rsi-evaluators-'));
      try {
        await privateWrite(join(context, 'Dockerfile'), await readFile(join(this.settings.imagesRoot, 'evaluator.Dockerfile')));
        for (const file of ['node.mjs', 'unittest.py', 'go.mjs']) await privateWrite(join(context, 'reporters', file), await readFile(join(this.settings.reportersRoot, file)));
        for (const toolchain of ['node', 'python', 'go']) await mustDocker(this.client, ['build', '--target', `evaluator-${toolchain}`, '-t', `rsi-evaluator-${toolchain}:p2`, context], { timeoutMs: 900_000, signal });
      } finally { await rm(context, { recursive: true, force: true }); }
      await mustDocker(this.client, ['build', '-t', 'rsi-proxy:p2', '-f', join(this.settings.imagesRoot, 'proxy.Dockerfile'), this.settings.imagesRoot], { timeoutMs: 900_000, signal });
      this.infrastructureReady = true;
    }
    let result = this.built.get(commit);
    if (!result) {
      result = await buildCandidate(this.client, this.store.taskId, join(this.store.root, 'private/repository.git'), commit, join(this.store.root, 'private/agent'), this.profile, signal);
      this.built.set(commit, result);
    }
    return result.packageSha256;
  }
  async run(request: SlotRequest, onUsage: (receipt: UsageReceipt) => Promise<void>): Promise<SlotResult> {
    const { evaluation: e, question: q, runId, signal } = request;
    const artifactPath = `artifacts/${e.iterationId ?? 'baseline'}/${runId}`, output = join(this.store.root, artifactPath);
    const data = request.data ?? await readQuestionData(join(this.bank.root, 'tasks', q.questionId));
    await mkdir(output, { recursive: true, mode: 0o700 });
    const proxy = await startProxy(this.client, this.store.taskId, runId, q.questionId, request.repetition,
      this.store.task().config.runTokenBudget, { ...this.settings.proxy,
        mockTable: e.iterationId === null ? this.settings.proxy.mockTable : this.settings.candidateMockTable }, signal);
    let receipt: UsageReceipt | null = null, polling = true;
    // Live polling only reports progress: the proxy enforces the budget, and the final read below is what counts.
    const poll = async (): Promise<void> => {
      while (polling && !signal.aborted) {
        try { receipt = await readProxyUsage(this.client, proxy.name, runId); await onUsage(receipt); }
        catch (error) { console.error(`RSI worker: usage poll ${runId}: ${workerErrorText(error)}`); }
        await delay(2000);
      }
    };
    const monitor = poll();
    try {
      const target = await runTarget(this.client, this.store.taskId, q, data.repo, data.statement,
        this.built.get(e.commit)!.images[q.toolchain], proxy, output, this.profile, this.settings.proxy.mode === 'mock' ? 'fixed' : upstreamEnvironment().RSI_UPSTREAM_MODEL!, this.settings.agentTimeoutMs, signal);
      if (e.iterationId) for (const finding of scanTargetPatch(target.patch.toString('utf8'))) {
        const id = createHash('sha256').update(JSON.stringify([runId, 'patch_scan', finding])).digest('hex');
        if (!this.store.list('finding_put').some(f => f.id === id)) await this.store.put({ event: 'finding_put', payload: {
          ...finding, id, taskId: e.taskId, iterationId: e.iterationId, level: 'L1', severity: 'info', source: 'patch_scan', at: now() } });
      }
      polling = false; await monitor;
      receipt = await readProxyUsage(this.client, proxy.name, runId, true); await onUsage(receipt);
      let failureReason = target.failureReason;
      if (receipt.blocked || receipt.tokens >= this.store.task().config.runTokenBudget) failureReason = 'run_token_budget';
      else if (failureReason !== 'agent_timeout' && !receipt.complete) failureReason = 'infrastructure';
      // A baseline that never reached the model is a broken setup, not a score of zero. A candidate gets no such excuse.
      else if (failureReason === 'agent_crashed' && e.iterationId === null && receipt.requests === 0) failureReason = 'infrastructure';
      let outcome: RsiOutcome = failureReason === 'infrastructure' ? 'infra_error' : failureReason ? 'fail' : 'pass';
      if (!failureReason) {
        const verdict = await evaluatePatch(this.client, this.store.taskId, q, data, target.patch,
          `rsi-evaluator-${q.toolchain}:p2`, this.settings.reportersRoot, signal);
        await privateWrite(join(output, 'evaluator.json'), JSON.stringify(verdict));
        outcome = verdict.outcome; failureReason = outcome === 'pass' ? null : outcome === 'fail' ? 'test_failed' : 'infrastructure';
      }
      return { outcome, failureReason, proxyTokens: receipt.complete ? receipt.tokens : null, artifactPath,
        sessionPath: target.sessionPath ? `${artifactPath}/${target.sessionPath}` : null, sessionTokens: target.sessionTokens };
    } finally {
      polling = false; await monitor;
      // Preserve a labelled proxy for recovery if its last usage cannot be made
      // durable. Never destroy the sole remaining accounting evidence first.
      const last = await readProxyUsage(this.client, proxy.name, runId, true);
      await onUsage(last); await exportProxyArtifacts(this.client, proxy, output); await stopProxy(this.client, proxy);
    }
  }
  async cleanup(): Promise<void> {
    const keep = [this.store.task().baselineCommit, ...this.store.list('iteration_put').filter(i => i.state === 'promoted' || !['rejected', 'held'].includes(i.state)).map(i => i.commit)];
    await pruneImages(this.client, this.store.taskId, keep, this.settings.keepRecentImages);
  }
}

function slotId(e: RsiEvaluation, questionId: string, repetition: number, attempt: number): string {
  return createHash('sha256').update(JSON.stringify([e.id, questionId, repetition, attempt])).digest('hex');
}
export { finalRuns } from './verdict.js';
export class RsiWorker {
  readonly store: RsiStore; readonly bank: QuestionBank; readonly settings: WorkerSettings;
  readonly backend: ExecutionBackend; reviews: ReviewProvider; readonly afterRun?: () => Promise<void>; readonly profile?: RsiAgentProfile;
  optimizerSession?: () => Promise<void>;
  private controller = new AbortController(); private usage = new Map<string, number>(); private accounting: Promise<void> = Promise.resolve();
  constructor(store: RsiStore, bank: QuestionBank, settings: WorkerSettings, backend: ExecutionBackend, reviews: ReviewProvider = new MissingReviewProvider(), afterRun?: () => Promise<void>, profile?: RsiAgentProfile) {
    this.store = store; this.bank = bank; this.settings = validateWorkerSettings(settings); this.backend = backend; this.reviews = reviews; this.afterRun = afterRun; this.profile = profile;
  }
  async loadUsage(): Promise<void> {
    const directory = join(this.store.root, 'private/usage'); await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(directory)) if (/^[a-f0-9]{64}\.json$/.test(file)) {
      const r = JSON.parse(await readFile(join(directory, file), 'utf8')) as UsageReceipt;
      if (file !== `${r.runId}.json` || !Number.isSafeInteger(r.tokens) || r.tokens < 0) throw new Error('Invalid usage receipt');
      this.usage.set(r.runId, r.tokens);
    }
    for (const r of this.store.list('run_put')) this.usage.set(r.id, Math.max(this.usage.get(r.id) ?? 0, r.proxyTokens ?? 0));
  }
  account(receipt: UsageReceipt): Promise<void> {
    const work = this.accounting.then(async () => {
      if (!/^[a-f0-9]{64}$/.test(receipt.runId) || !Number.isSafeInteger(receipt.tokens) || receipt.tokens < 0) throw new Error('Invalid usage receipt');
      this.usage.set(receipt.runId, Math.max(this.usage.get(receipt.runId) ?? 0, receipt.tokens));
      const file = join(this.store.root, `private/usage/${receipt.runId}.json`), temp = `${file}.tmp`;
      const handle = await open(temp, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify({ ...receipt, tokens: this.usage.get(receipt.runId) })); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, file);
      const directory = await open(join(this.store.root, 'private/usage'), 'r'); try { await directory.sync(); } finally { await directory.close(); }
      const total = [...this.usage.values()].reduce((a, b) => a + b, 0);
      if (!Number.isSafeInteger(total)) throw new Error('Task usage overflow');
      const task = this.store.task();
      if (total > task.tokenUsage) await this.store.put({ event: 'task_put', payload: { ...task, tokenUsage: total, updatedAt: now() } });
      await this.checkBudget();
    });
    this.accounting = work.then(() => undefined, () => undefined); return work;
  }
  async taskEvent(event: RsiTaskEvent, reason: string): Promise<void> {
    const task = this.store.task();
    const state = transitionTask(task.state, event, { actor: 'worker', reason, budgetAvailable: task.tokenUsage < task.config.maxTaskTokens && task.iterationCount < task.config.maxIterations,
      calibrationComplete: task.delta !== null && task.baselineSealedScore !== null, targetReached: event === 'target_reached' });
    await this.store.put({ event: 'task_put', payload: { ...task, state, pauseReason: state === 'paused' ? event as 'budget_exhausted' | 'infra_failed' | 'incomplete_comparison' : null, updatedAt: now() } });
  }
  async checkBudget(): Promise<boolean> {
    const t = this.store.task();
    if (t.state === 'completed' && !this.store.list('evaluation_put').some(e => e.phase === 'final' && (e.state === 'queued' || e.state === 'running'))
      && !this.store.list('queue_put').some(q => q.kind === 'final' && (q.state === 'queued' || q.state === 'running'))) return false;
    const exhausted = t.tokenUsage >= t.config.maxTaskTokens || t.iterationCount >= t.config.maxIterations;
    if (!exhausted) return false;
    if (['calibrating', 'running', 'completed'].includes(t.state)) await this.taskEvent('budget_exhausted', 'Task budget exhausted');
    if (this.store.task().pauseReason === 'budget_exhausted') {
      this.controller.abort();
      for (const e of this.store.list('evaluation_put')) if (e.state === 'queued' || e.state === 'running') {
        await this.store.put({ event: 'evaluation_put', payload: { ...e, state: 'invalidated', score: null, updatedAt: now() } });
      }
    }
    return true;
  }
  async iterationEvent(iteration: RsiIteration, event: RsiIterationEvent, context: RsiIterationContext): Promise<RsiIteration> {
    const state = transitionIteration(iteration.state, event, context);
    const value = { ...iteration, state, holdReasons: state === 'held' ? context.holdReasons ?? [] : [], resumeState: state === 'held' ? context.resumeState ?? null : null, updatedAt: now() };
    await this.store.put({ event: 'iteration_put', payload: value }, context.actor); return value;
  }
  completed(iterationId: string | null, phase: RsiEvaluation['phase']): RsiEvaluation | undefined {
    return this.store.list('evaluation_put').find(e => e.iterationId === iterationId && e.phase === phase && e.state === 'completed' && e.score !== null);
  }
  async evaluation(iterationId: string | null, phase: 'smoke' | 'train' | 'sealed', confirmations = false): Promise<RsiEvaluation | null> {
    const t = this.store.task(), iteration = this.store.list('iteration_put').find(i => i.id === iterationId);
    const all = this.store.list('evaluation_put').filter(e => e.iterationId === iterationId && e.phase === phase);
    let existing = all.find(e => e.state === 'queued' || e.state === 'running');
    if (!existing && !confirmations) existing = all.find(e => e.state === 'completed' && e.score !== null);
    if (!existing) {
      if (await this.checkBudget()) return null;
      if (phase === 'sealed' && iterationId !== null && !all.length) {
        const materialized = new Set(this.store.list('evaluation_put').filter(e => e.iterationId !== null && e.phase === 'sealed').map(e => e.iterationId)).size;
        // A crash may leave the counter snapshot durable before evaluation_put.
        // The oldest active iteration owns that unused reservation on replay.
        if (t.sealedQueriesUsed <= materialized) {
          if (t.sealedQueriesUsed >= t.config.sealedQueryBudget) { await this.taskEvent('sealed_budget_exhausted', 'No sealed queries remaining'); return null; }
          await this.store.put({ event: 'task_put', payload: { ...this.store.task(), sealedQueriesUsed: t.sealedQueriesUsed + 1, updatedAt: now() } });
        }
      }
      const at = now();
      existing = { id: newId(), taskId: t.id, iterationId, commit: iteration?.commit ?? t.baselineCommit, sourceCommit: null, ablationOf: null, phase, state: 'queued',
        repetitions: phase === 'sealed' ? 3 : phase === 'train' && iterationId === null ? t.config.noiseRepeats : 1,
        questionIds: [...this.bank.manifest.sets[phase]], passedCounts: [], score: null, infraErrorRatio: null, sealedVerdict: null, locked: false, createdAt: at, updatedAt: at };
      await this.store.put({ event: 'evaluation_put', payload: existing });
    }
    if (existing.state === 'completed') return existing;
    await enqueue(this.store, { action: 'evaluate', phase, commit: existing.commit }, 'worker', `eval-${existing.id}`, iterationId, existing.id);
    return this.executeEvaluation(existing);
  }
  async reviewEvaluation(input: ReviewEvaluationRequest): Promise<RsiEvaluation | null> {
    if (await this.checkBudget()) return null;
    const prefix = createHash('sha256').update(input.key).digest('hex').slice(0, 40);
    const history = this.store.list('evaluation_put').filter(e => e.id.startsWith(`${prefix}-`));
    let e = history.find(e => e.state === 'queued' || e.state === 'running')
      ?? history.find(e => e.state === 'completed' && e.score !== null);
    const questions = input.questions ? input.questions.map(v => v.question.questionId) : [...this.bank.manifest.sets.train];
    if (!e) {
      const at = now();
      e = { id: `${prefix}-${history.length}`, taskId: this.store.taskId, iterationId: input.iterationId, commit: input.commit,
        sourceCommit: input.sourceCommit ?? null, ablationOf: input.ablationOf ?? null, phase: input.phase,
        state: 'queued', repetitions: 1, questionIds: questions, passedCounts: [], score: null, infraErrorRatio: null,
        sealedVerdict: null, locked: false, createdAt: at, updatedAt: at };
      await this.store.put({ event: 'evaluation_put', payload: e });
    }
    if (e.commit !== input.commit || e.phase !== input.phase || e.iterationId !== input.iterationId
      || e.sourceCommit !== (input.sourceCommit ?? null) || e.ablationOf !== (input.ablationOf ?? null) || e.questionIds.join() !== questions.join()) throw new Error('Frozen review evaluation identity changed');
    if (e.state === 'completed') return e;
    await enqueue(this.store, { action: 'evaluate', phase: e.phase, commit: e.commit }, 'worker', `eval-${e.id}`, e.iterationId, e.id);
    return this.executeEvaluation(e, input.questions ? new Map(input.questions.map(v => [v.question.questionId, v])) : undefined);
  }
  async executeEvaluation(original: RsiEvaluation, overrides?: Map<string, { question: RsiBankQuestion; data: QuestionData }>): Promise<RsiEvaluation | null> {
    const queue = this.store.list('queue_put').find(q => q.evaluationId === original.id && q.kind === 'evaluate');
    if (queue && queue.state !== 'running') await this.store.put({ event: 'queue_put', payload: { ...queue, state: 'running', updatedAt: now() } });
    if (await this.checkBudget()) return null;
    let e = { ...original, state: 'running' as const, updatedAt: now() } as RsiEvaluation;
    await this.store.put({ event: 'evaluation_put', payload: e });
    await this.backend.prepare(e.commit, this.controller.signal);
    const slots: Array<{ questionId: string; repetition: number }> = [];
    for (let repetition = 0; repetition < e.repetitions; repetition++) for (const questionId of e.questionIds) slots.push({ questionId, repetition });
    let next = 0;
    const runSlot = async (): Promise<void> => {
      for (;;) {
        const slot = slots[next++]; if (!slot || this.controller.signal.aborted) return;
        for (const attempt of [0, 1] as const) {
          const id = slotId(e, slot.questionId, slot.repetition, attempt);
          const prior = this.store.list('run_put').find(r => r.id === id);
          if (prior) { if (prior.outcome === 'infra_error' && attempt === 0) continue; break; }
          if (attempt === 1 && !this.store.list('run_put').some(r => r.id === slotId(e, slot.questionId, slot.repetition, 0) && r.outcome === 'infra_error')) break;
          const started = performance.now(); let result: SlotResult;
          try { result = await this.backend.run({ runId: id, evaluation: e, question: overrides?.get(slot.questionId)?.question ?? this.bank.questions.get(slot.questionId)!, data: overrides?.get(slot.questionId)?.data, repetition: slot.repetition, attempt, signal: this.controller.signal }, r => this.account(r)); }
          catch (error) {
            if (!this.controller.signal.aborted) console.error(`RSI worker: run ${id}: ${workerErrorText(error)}`);
            result = { outcome: 'infra_error', failureReason: 'infrastructure', proxyTokens: null, artifactPath: null, sessionPath: null, sessionTokens: null };
          }
          if (this.controller.signal.aborted || await this.checkBudget()) return;
          if (result.proxyTokens !== null) await this.account({ runId: id, tokens: result.proxyTokens, requests: 1, complete: true, blocked: result.failureReason === 'run_token_budget' });
          if (this.controller.signal.aborted) return;
          const run: RsiRun = { id, taskId: this.store.taskId, evaluationId: e.id, questionId: slot.questionId, repetition: slot.repetition, attempt,
            outcome: result.outcome, failureReason: result.failureReason, durationMs: performance.now() - started, proxyTokens: result.proxyTokens,
            artifactPath: result.artifactPath, sessionPath: result.sessionPath, at: now() };
          if(result.artifactPath)await privateWrite(join(this.store.root,result.artifactPath,'page-metrics.json'),JSON.stringify({...await runTelemetry(this.store.root,result.artifactPath),requests:null}));
          await this.store.put({ event: 'run_put', payload: run });
          await this.afterRun?.();
          if (this.profile?.session.format !== 'none' && e.iterationId && (result.proxyTokens === null || result.sessionTokens === null || Math.abs(result.proxyTokens - result.sessionTokens) > Math.max(1, result.proxyTokens) * this.settings.reconciliationMaxRatio)) {
            await this.store.put({ event: 'finding_put', payload: { id: newId(), taskId: this.store.taskId, iterationId: e.iterationId, level: 'L2', category: 'suspicious', severity: 'info', source: 'calibration', file: null, line: null,
              evidence: JSON.stringify({ runId: id, proxyTokens: result.proxyTokens, sessionTokens: result.sessionTokens }), at: now() } });
          }
          if (result.outcome !== 'infra_error') break;
        }
      }
    };
    await Promise.all(Array.from({ length: this.settings.concurrency }, runSlot));
    if (this.controller.signal.aborted) return null;
    const runs = finalRuns(e, this.store.list('run_put'));
    if (runs.length !== e.repetitions * e.questionIds.length) throw new Error('Incomplete evaluation slots');
    const counts = Array.from({ length: e.repetitions }, (_, r) => runs.filter(x => x.repetition === r && x.outcome === 'pass').length);
    const ratio = runs.filter(r => r.outcome === 'infra_error').length / runs.length;
    const score = ratio ? null : counts.reduce((a, b) => a + b, 0) / e.repetitions;
    const parent = this.store.list('iteration_put').find(i => i.id === e.iterationId)?.parentId ?? null;
    const parentSealed = parent === null ? this.store.task().baselineSealedScore : this.store.list('iteration_put').find(i => i.id === parent)!.sealedScore;
    e = { ...e, state: ratio > this.store.task().config.infraErrorMaxRatio ? 'infra_failed' : 'completed', passedCounts: counts, score, infraErrorRatio: ratio,
      sealedVerdict: e.phase === 'sealed' && e.iterationId !== null && score !== null && parentSealed !== null ? score >= parentSealed - this.store.task().delta! ? 'accept' : 'reject' : null,
      locked: e.phase === 'final' && ratio <= this.store.task().config.infraErrorMaxRatio, updatedAt: now() };
    await this.store.put({ event: 'evaluation_put', payload: e });
    if (queue) await this.store.put({ event: 'queue_put', payload: { ...queue, state: 'completed', updatedAt: now() } });
    if (score === null && e.iterationId !== null) {
      const i = this.store.list('iteration_put').find(i => i.id === e.iterationId)!;
      if (i.state === 'training' || i.state === 'sealed') await this.iterationEvent(i, i.state === 'training' ? 'training_hold' : 'sealed_hold', {
        actor: 'worker', reason: 'incomplete_comparison', holdReasons: ['incomplete_comparison'], resumeState: i.state });
    }
    if (score === null) { await this.taskEvent(ratio > this.store.task().config.infraErrorMaxRatio ? 'infra_failed' : 'incomplete_comparison', 'Evaluation has unresolved infrastructure slots'); return null; }
    return e;
  }
  smokeFloor(): number {
    const baseline = this.completed(null, 'train');
    if (!baseline) throw new Error('Smoke floor requires complete baseline calibration');
    const runs = finalRuns(baseline, this.store.list('run_put'));
    return this.bank.manifest.sets.smoke.filter(id => {
      const own = runs.filter(r => r.questionId === id);
      return own.length === baseline.repetitions && own.every(r => r.outcome === 'pass');
    }).length;
  }
  promotionInput(iteration: RsiIteration): RsiPromotionInput { return promotionInput(this.store, this.bank.manifest.sets.train, iteration); }
  gate(iteration: RsiIteration): ReturnType<typeof decidePromotion> { return decidePromotion(this.promotionInput(iteration)); }
  async decision(i: RsiIteration, verdict: 'promote' | 'reject' | 'hold', reason: string): Promise<void> {
    const id = createHash('sha256').update(JSON.stringify([i.id, i.state, i.updatedAt, verdict, reason])).digest('hex');
    if (this.store.list('decision_put').some(d => d.id === id)) return;
    await this.store.put({ event: 'decision_put', payload: { id, taskId: this.store.taskId, iterationId: i.id, verdict, actor: 'worker', reason, approvedCategories: [], at: now() } });
  }
  async precheckIteration(i: RsiIteration): Promise<void> {
    if (i.state === 'submitted') i = await this.iterationEvent(i, 'start_precheck', { actor: 'worker' });
    const parent = this.store.list('iteration_put').find(p => p.id === i.parentId)?.commit ?? this.store.task().baselineCommit;
    const dictionary = JSON.parse(await readFile(join(this.store.root, 'private/fingerprints.json'), 'utf8')) as RsiFingerprintDictionary;
    const diff = await candidateDiff(join(this.store.root, 'private/repository.git'), parent, i.commit);
    const diffFile=join(this.store.root, `artifacts/${i.id}/diff.patch`);
    await privateWrite(`${diffFile}.tmp`, diff); await rename(`${diffFile}.tmp`,diffFile);
    await privateWrite(join(this.store.root, `artifacts/${i.id}/quality.json`), JSON.stringify(measureQuality(diff)));
    const findings = precheck(diff, dictionary, this.profile?.l1);
    for (const [n, f] of findings.entries()) {
      const id = `l1-${i.id}-${n}`;
      if (!this.store.list('finding_put').some(x => x.id === id)) await this.store.put({ event: 'finding_put', payload: { ...f, id, taskId: this.store.taskId, iterationId: i.id, level: 'L1', source: 'rule', at: now() } });
    }
    const anti = this.gate(i).conditions[0]!;
    if (anti.reasons.some(r => r === 'l0_reject' || r === 'l1_reject')) {
      await this.decision(i, 'reject', anti.reasons.join(',')); await this.iterationEvent(i, 'precheck_reject', { actor: 'worker', reason: 'L1 rejected candidate' });
    } else if (anti.reasons.includes('dependency_change')) {
      await this.decision(i, 'hold', 'dependency_change'); await this.iterationEvent(i, 'precheck_hold', { actor: 'worker', reason: 'dependency_change', holdReasons: ['dependency_change'], resumeState: 'training' });
    } else await this.iterationEvent(i, 'precheck_pass', { actor: 'worker' });
  }
  async processIteration(i: RsiIteration): Promise<void> {
    if (i.state === 'submitted' || i.state === 'precheck') { await this.precheckIteration(i); return; }
    if (i.state === 'training') {
      if (i.packageSha256 === null) {
        let packageSha256: string;
        try { packageSha256 = await this.backend.prepare(i.commit, this.controller.signal); }
        catch (error) {
          if (!(error instanceof BuildRejected)) throw error;
          const id = `l0-${i.id}`;
          if (!this.store.list('finding_put').some(f => f.id === id)) await this.store.put({ event: 'finding_put', payload: {
            id, taskId: this.store.taskId, iterationId: i.id, level: 'L0', category: 'suspicious', severity: 'reject', source: 'rule',
            file: null, line: null, evidence: 'Candidate offline compilation failed', at: now() } });
          const anti = this.gate(i).conditions[0]!;
          await this.decision(i, 'reject', anti.reasons.join(','));
          await this.iterationEvent(i, 'training_reject', { actor: 'worker', reason: 'l0_reject' }); return;
        }
        i = { ...i, packageSha256, updatedAt: now() }; await this.store.put({ event: 'iteration_put', payload: i });
      }
      const smoke = await this.evaluation(i.id, 'smoke'); if (!smoke) return;
      if (smoke.score === null || smoke.score < this.smokeFloor()) {
        await this.decision(i, 'reject', 'smoke_failed'); await this.iterationEvent(i, 'training_reject', { actor: 'worker', reason: 'smoke_failed' }); return;
      }
      const train = await this.evaluation(i.id, 'train'); if (!train) return;
      if (i.trainScore === null) { i = { ...i, trainScore: train.score, updatedAt: now() }; await this.store.put({ event: 'iteration_put', payload: i }); }
      // Confirmation groups keep the original trainScore frozen. Stop once every
      // potentially stable first failure has the required confirmation window.
      for (;;) {
        const gate = this.gate(i);
        const primary = gate.conditions[1]!;
        if (primary.verdict !== 'pass') {
          await this.decision(i, primary.verdict, primary.reasons.join(','));
          await this.iterationEvent(i, primary.verdict === 'reject' ? 'training_reject' : 'training_hold', { actor: 'worker', reason: primary.reasons.join(','),
            ...(primary.verdict === 'hold' ? { holdReasons: ['incomplete_comparison'] as RsiHoldReason[], resumeState: 'training' as const } : {}) }); return;
        }
        const t = this.store.task();
        const stableFailed = this.promotionInput(i).stableHistories.some(history => history.candidateOutcomes[0] === 'fail'
          && isStableRegression({ ...history, candidateOutcomes: Array.from({ length: t.config.stableFailRepeats }, () => 'fail' as const) }, t.config.stableWindow, t.config.stableFailRepeats));
        const completedCount = this.store.list('evaluation_put').filter(e => e.iterationId === i.id && e.phase === 'train' && e.state === 'completed' && e.score !== null).length;
        if (!stableFailed || completedCount >= t.config.stableFailRepeats) break;
        if (!await this.evaluation(i.id, 'train', true)) return;
      }
      const stable = this.gate(i).conditions[3]!;
      if (stable.verdict === 'reject') { await this.decision(i, 'reject', 'stable_regression'); await this.iterationEvent(i, 'training_reject', { actor: 'worker', reason: 'stable_regression' }); return; }
      await this.iterationEvent(i, 'training_pass', { actor: 'worker' }); return;
    }
    if (i.state === 'reviewing') {
      let review;
      const priorReviewUsage=new Map(this.usage);
      try { review = await this.reviews.review(this.store.task(), i, this.controller.signal); }
      catch (error) { if (this.controller.signal.aborted && this.store.task().pauseReason === 'budget_exhausted') return; throw error; }
      if (this.controller.signal.aborted || this.store.task().state !== 'running' || await this.checkBudget()) return;
      const reviewUsage=await optionalArtifact<{receipts:Record<string,number|null>}>(this.store.root,`artifacts/${i.id}/review-usage.json`)??{receipts:{}};
      const targetRunIds=new Set(this.store.list('run_put').map(r=>r.id));
      for(const [id,tokens] of this.usage)if(!targetRunIds.has(id)&&(!priorReviewUsage.has(id)||tokens!==priorReviewUsage.get(id))){const receipt=await optionalArtifact<UsageReceipt>(this.store.root,`private/usage/${id}.json`);reviewUsage.receipts[id]=receipt?.complete?receipt.tokens:null;}
      await privateWrite(join(this.store.root,`artifacts/${i.id}/review-usage.json`),JSON.stringify(reviewUsage));
      for (const [level, result] of [['L3', review.adversarial], ['L4', review.monitor]] as const) if (result.status !== 'missing') {
        const id = `${i.id}-${level}-${result.status}`;
        if (!this.store.list('finding_put').some(f => f.id === id)) await this.store.put({ event: 'finding_put', payload: {
          id, taskId: this.store.taskId, iterationId: i.id, level, category: result.status === 'clean' ? 'review_clean' : 'suspicious', severity: result.status === 'clean' ? 'info' : 'hold',
          source: 'monitor', file: null, line: null, evidence: null, at: now() } });
      }
      const reviewInput = promotionInput(this.store,this.bank.manifest.sets.train,i,review);
      const anti = decidePromotion(reviewInput).conditions[0]!;
      if (anti.verdict !== 'pass') {
        const reasons = anti.reasons.filter(r => ['missing_monitor', 'missing_adversarial', 'l3_suspicious', 'l4_suspicious'].includes(r)) as RsiHoldReason[];
        await this.decision(i, 'hold', reasons.join(','));
        await this.iterationEvent(i, 'review_hold', { actor: 'worker', reason: reasons.join(','), holdReasons: reasons, resumeState: 'sealed' }); return;
      }
      const t = this.store.task(), reserved = this.store.list('evaluation_put').some(e => e.iterationId === i.id && e.phase === 'sealed');
      const remaining = t.config.sealedQueryBudget - t.sealedQueriesUsed + (reserved ? 1 : 0);
      if (remaining <= 0) { await this.taskEvent('sealed_budget_exhausted', 'No sealed queries remaining'); return; }
      await this.iterationEvent(i, 'review_pass', { actor: 'worker', sealedBudgetRemaining: remaining }); return;
    }
    if (i.state === 'sealed') {
      const sealed = await this.evaluation(i.id, 'sealed'); if (!sealed) return;
      if (i.sealedScore === null) { i = { ...i, sealedScore: sealed.score, updatedAt: now() }; await this.store.put({ event: 'iteration_put', payload: i }); }
      const condition = this.gate(i).conditions[2]!;
      if (condition.verdict !== 'pass') {
        await this.decision(i, condition.verdict, condition.reasons.join(','));
        await this.iterationEvent(i, condition.verdict === 'reject' ? 'sealed_reject' : 'sealed_hold', { actor: 'worker', reason: condition.reasons.join(','),
          ...(condition.verdict === 'hold' ? { holdReasons: ['incomplete_comparison'] as RsiHoldReason[], resumeState: 'sealed' as const } : {}) }); return;
      }
      await this.iterationEvent(i, 'sealed_accept', { actor: 'worker', hasSealedResult: true }); return;
    }
    if (i.state === 'deciding') {
      const gate = this.gate(i), reason = gate.conditions.find(c => c.verdict !== 'pass')?.reasons.join(',') ?? 'all_conditions_passed';
      await this.decision(i, gate.verdict, reason);
      const first = gate.conditions.find(c => c.verdict !== 'pass');
      await this.iterationEvent(i, gate.verdict === 'promote' ? 'promotion_pass' : gate.verdict === 'reject' ? 'promotion_reject' : 'promotion_hold', {
        actor: 'worker', reason, hasSealedResult: true, ...(gate.verdict === 'hold' ? { holdReasons: first!.reasons as RsiHoldReason[], resumeState: first!.condition === 'token_growth' && reason === 'token_growth' ? 'deciding' as const : first!.condition === 'sealed' ? 'sealed' as const : 'training' as const } : {}) });
      if (gate.verdict === 'promote') {
        const t = this.store.task(), versions = [{ iterationId: null, seq: 0, state: 'baseline' as const, trainScore: t.baselineTrainScore! }, ...this.store.list('iteration_put').filter(x => x.state === 'promoted').map(x => ({ iterationId: x.id, seq: x.seq, state: x.state, trainScore: x.trainScore! }))];
        await this.store.put({ event: 'task_put', payload: { ...t, currentParentId: selectParent(versions, t.delta!).iterationId, updatedAt: now() } });
        if (i.trainScore! >= t.config.targetPassedCount) await this.taskEvent('target_reached', 'Target passed count reached');
      }
    }
  }
  async command(q: RsiQueueItem): Promise<void> {
    if (q.state === 'completed' || q.state === 'failed') return;
    await this.store.put({ event: 'queue_put', payload: { ...q, state: 'running', updatedAt: now() } });
    const c = q.command;
    if (c.action === 'rollback') {
      const t = this.store.task();
      if (c.parentId !== null && !this.store.list('iteration_put').some(i => i.id === c.parentId && i.state === 'promoted')) throw new Error('Invalid rollback parent');
      await this.store.put({ event: 'task_put', payload: { ...t, currentParentId: c.parentId, updatedAt: now() } });
    } else if (c.action === 'instruction') {
      const id = createHash('sha256').update(`instruction:${q.id}`).digest('hex');
      if (!this.store.list('instruction_put').some(i => i.id === id)) await this.store.put({ event: 'instruction_put', payload: { id, taskId: this.store.taskId, kind: c.kind, text: c.text, effectiveFromSeq: c.effectiveFromSeq, at: q.createdAt } }, 'human');
    } else if (c.action === 'adopt') {
      await adopt(this.store, q.iterationId!);
    } else if (c.action === 'set_target') {
      const t = this.store.task(); await this.store.put({ event: 'task_put', payload: { ...t, config: { ...t.config, targetPassedCount: c.targetPassedCount }, updatedAt: now() } }, 'human');
    } else if (c.action === 'start') {
      if (this.store.task().state === 'created') await this.taskEvent('start', 'Start calibration');
    } else if (c.action === 'submit') {
      const session = this.store.list('session_put').find(s => s.submissionId === q.id);
      if (session) {
        const manifest = JSON.parse(await readFile(join(this.store.root, session.artifactPath, 'imported.json'), 'utf8')) as { commit: string; queueId: string };
        if (manifest.commit !== c.commit || manifest.queueId !== q.id) throw new Error('Missing verified optimizer import');
      }
      if (!session && this.profile) {
        const mirror=join(this.store.root,'private/repository.git');
        await importCommit(this.store.task().repository,mirror,c.commit);
        await git(['--git-dir',mirror,'update-ref',`refs/rsi/submissions/${createHash('sha256').update(q.id).digest('hex')}`,c.commit]);
      }
      const id = createHash('sha256').update(`iteration:${q.id}`).digest('hex');
      let i = this.store.list('iteration_put').find(i => i.id === id);
      if (!i) {
        if (this.store.task().state !== 'running' || await this.checkBudget()) throw new Error('Task cannot accept an iteration');
        const at = now(); i = { id, taskId: this.store.taskId, seq: Math.max(0, ...this.store.list('iteration_put').map(i => i.seq)) + 1, parentId: c.parentId, commit: c.commit,
          prd: c.prd, packageSha256: null, state: 'draft', holdReasons: [], resumeState: null, approvals: [], trainScore: null, sealedScore: null, createdAt: at, updatedAt: at };
        await this.store.put({ event: 'iteration_put', payload: i }, 'optimizer');
      }
      if (i.state === 'draft') await this.iterationEvent(i, 'submit', { actor: 'optimizer' });
      const count = this.store.list('iteration_put').length, task = this.store.task();
      if (task.iterationCount < count) await this.store.put({ event: 'task_put', payload: { ...task, iterationCount: count, updatedAt: now() } });
    } else if (['approve', 'reject', 'retry_review', 'retry_evaluation'].includes(c.action)) {
      const i = this.store.list('iteration_put').find(i => i.id === q.iterationId);
      if (!i) throw new Error('Iteration missing');
      if (i.state !== 'held') {
        const already = c.action === 'retry_review' ? i.state === 'reviewing' : c.action === 'retry_evaluation' ? ['training', 'sealed'].includes(i.state)
          : c.action === 'reject' ? i.state === 'rejected' : c.action === 'approve' && i.approvals.some(a => a.reason === c.reason && a.categories.slice().sort().join(',') === c.categories.slice().sort().join(','));
        if (!already) throw new Error('Stale human iteration command');
        await this.store.put({ event: 'queue_put', payload: { ...q, state: 'completed', updatedAt: now() } }); return;
      }
      // Commands are retained before the human-attributed transition.
      const reason = 'reason' in c ? c.reason : 'Human command';
      const approval = c.action === 'approve' ? { iterationId: i.id, commit: i.commit, categories: c.categories, reason, at: now() } : null;
      const t = this.store.task(), reserved = this.store.list('evaluation_put').some(e => e.iterationId === i.id && e.phase === 'sealed');
      const context: RsiIterationContext = { actor: 'human', reason, holdReasons: i.holdReasons, ...(i.resumeState ? { resumeState: i.resumeState } : {}),
        ...(approval ? { approvedCategories: approval.categories } : {}), hasSealedResult: !!this.completed(i.id, 'sealed'), sealedBudgetRemaining: t.config.sealedQueryBudget - t.sealedQueriesUsed + (reserved ? 1 : 0) };
      await this.iterationEvent(approval ? { ...i, approvals: [...i.approvals, approval] } : i, c.action as RsiIterationEvent, context);
    } else if (c.action === 'set_budget') {
      const t = this.store.task(); await this.store.put({ event: 'task_put', payload: { ...t, config: { ...t.config, maxTaskTokens: c.maxTaskTokens, maxIterations: c.maxIterations, sealedQueryBudget: c.sealedQueryBudget }, updatedAt: now() } }, 'human');
    } else if (c.action === 'pause' || c.action === 'resume' || c.action === 'stop' || c.action === 'declare_stuck') {
      const t = this.store.task();
      if ((c.action === 'resume' && ['running', 'calibrating', 'completed'].includes(t.state)) || (c.action === 'pause' && t.state === 'paused' && t.pauseReason === 'human') || (c.action === 'stop' && t.state === 'stopped')) {
        await this.store.put({ event: 'queue_put', payload: { ...q, state: 'completed', updatedAt: now() } }); return;
      }
      const state = transitionTask(t.state, c.action, { actor: q.requestedBy, reason: c.reason, budgetAvailable: t.tokenUsage < t.config.maxTaskTokens && t.iterationCount < t.config.maxIterations,
        calibrationComplete: t.delta !== null && t.baselineSealedScore !== null, targetReached: this.store.list('iteration_put').some(i => i.state === 'promoted' && i.trainScore! >= t.config.targetPassedCount) });
      await this.store.put({ event: 'task_put', payload: { ...t, state, pauseReason: state === 'paused' ? 'human' : null, updatedAt: now() } }, q.requestedBy);
      if (c.action === 'resume') this.controller = new AbortController();
    } else if (c.action === 'final') {
      const i = this.store.list('iteration_put').find(i => i.id === q.iterationId);
      if (!i) throw new Error('Final requires promoted iteration');
      let e = this.store.list('evaluation_put').find(e => e.commit === i.commit && e.phase === 'final');
      if (!e) {
        const at = now(); e = { id: newId(), taskId: this.store.taskId, iterationId: i.id, commit: i.commit, phase: 'final', sourceCommit: null, ablationOf: null, state: 'queued', repetitions: 1,
          questionIds: [...this.bank.manifest.sets.final], passedCounts: [], score: null, infraErrorRatio: null, sealedVerdict: null, locked: false, createdAt: at, updatedAt: at };
        await this.store.put({ event: 'evaluation_put', payload: e }, 'human');
      }
      if (e.state === 'queued' || e.state === 'running') await this.executeEvaluation(e);
    } else if (c.action === 'evaluate') {
      const e = this.store.list('evaluation_put').find(e => e.id === q.evaluationId);
      if (e && (e.state === 'queued' || e.state === 'running')) await this.executeEvaluation(e);
    } else if (c.action !== 'review') throw new Error('Command is outside the P2 execution scope');
    await this.store.put({ event: 'queue_put', payload: { ...q, state: 'completed', updatedAt: now() } });
  }
  async scheduleAudits(): Promise<void> {
    const rate = this.settings.reviews?.auditSampleRate ?? defaultReviewSettings().auditSampleRate;
    for (const i of this.store.list('iteration_put')) if (i.state === 'promoted' && auditSelected(i.id, rate)) {
      const id = createHash('sha256').update(`audit:${i.id}`).digest('hex');
      await enqueue(this.store, { action: 'review', audit: true }, 'worker', id, i.id);
    }
  }
  async step(): Promise<boolean> {
    await this.store.refresh();
    await this.scheduleAudits();
    // Human recovery commands remain processable while paused/held/completed.
    const queue = this.store.list('queue_put').filter(q => q.state === 'queued' && !(q.command.action === 'review' && q.command.audit)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const human = queue.find(q => q.requestedBy === 'human' && q.kind !== 'final');
    if (human) { await this.command(human); return true; }
    const t = this.store.task();
    if (!['created', 'calibrating', 'running', 'completed'].includes(t.state)) return false;
    if (await this.checkBudget()) return false;
    const q = queue.find(q => q.kind !== 'evaluate' && (t.state !== 'completed' || q.kind === 'final'));
    if (q) { await this.command(q); return true; }
    if (t.state === 'created') { await this.taskEvent('start', 'Start calibration'); return true; }
    if (t.state === 'calibrating') {
      const train = await this.evaluation(null, 'train'); if (!train) return false;
      const runs = finalRuns(train, this.store.list('run_put'));
      const noise = calibrateNoiseBand({ plannedQuestionIds: train.questionIds, repetitions: Array.from({ length: train.repetitions }, (_, repetition) => runs.filter(r => r.repetition === repetition).map(r => ({ questionId: r.questionId, outcome: r.outcome }))), infraErrorMaxRatio: t.config.infraErrorMaxRatio });
      if (noise.status !== 'ready') { await this.taskEvent(noise.status, 'Baseline calibration incomplete'); return false; }
      const sealed = await this.evaluation(null, 'sealed'); if (!sealed) return false;
      await this.store.put({ event: 'task_put', payload: { ...this.store.task(), delta: noise.delta, baselineTrainScore: noise.baselineTrainScore, baselineSealedScore: sealed.score, updatedAt: now() } });
      await this.taskEvent('calibrated', 'Baseline calibration complete'); return true;
    }
    const finalHistory = this.store.list('evaluation_put').filter(e => e.phase === 'final');
    const interruptedFinal = finalHistory.find(e => e.state === 'invalidated' && !finalHistory.some(other => other.commit === e.commit && other.state !== 'invalidated'));
    if (interruptedFinal) {
      const at = now(), replacement: RsiEvaluation = { ...interruptedFinal, id: newId(), state: 'queued', passedCounts: [], score: null, infraErrorRatio: null, locked: false, createdAt: at, updatedAt: at };
      await this.store.put({ event: 'evaluation_put', payload: replacement }); await this.executeEvaluation(replacement); return true;
    }
    if (t.state === 'completed') return false;
    const promoted = this.store.list('iteration_put').filter(i => i.state === 'promoted');
    if (promoted.length) {
      const selected = selectedParent(this.store);
      if (selected !== t.currentParentId) await this.store.put({ event: 'task_put', payload: { ...this.store.task(), currentParentId: selected, updatedAt: now() } });
      if (promoted.some(i => i.trainScore! >= t.config.targetPassedCount)) { await this.taskEvent('target_reached', 'Recover completed promotion'); return true; }
    }
    const iteration = this.store.list('iteration_put').find(i => !['draft', 'held', 'promoted', 'rejected'].includes(i.state));
    if (iteration) { await this.processIteration(iteration); return true; }
    if (this.optimizerSession && !this.store.list('iteration_put').some(i => !['promoted','rejected'].includes(i.state))) {
      if (consecutiveNoSubmissions(this.store.list('session_put')) >= 3) {
        await enqueue(this.store, { action: 'declare_stuck', reason: 'Three consecutive optimizer sessions without a submission' }, 'optimizer', `no-submission-${this.store.list('session_put').sort((a,b)=>b.seq-a.seq)[0]!.id}`); return true;
      }
      await this.optimizerSession(); return true;
    }
    return false;
  }
  async run(signal?: AbortSignal): Promise<void> {
    const abort = (): void => this.controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) this.controller.abort();
      while (!signal?.aborted && await this.step()) { /* Drain only durable queued/derived work. */ }
    } catch (error) {
      if (!signal?.aborted && ['calibrating', 'running', 'completed'].includes(this.store.task().state)) await this.taskEvent('infra_failed', 'Worker infrastructure failed');
      if (!signal?.aborted) throw error;
    } finally { signal?.removeEventListener('abort', abort); await this.accounting; await this.backend.cleanup?.(); }
  }
}

/** Secret values are stripped because this text is shown on the page. */
export function workerErrorText(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
  let text = (error instanceof Error ? error.message : String(error)).slice(-500);
  for (const key of ['RSI_UPSTREAM_API_KEY', 'RSI_MONITOR_API_KEY']) if (env[key]) text = text.replaceAll(env[key], '[redacted]');
  return text;
}
async function withHeartbeat<T>(store: RsiStore, action: (report: (error: unknown) => void) => Promise<T>): Promise<T> {
  let stopped=false, error: unknown, lastError: string | null=null, pending:Promise<void>=Promise.resolve();
  const beat=():void=>{
    const phase=stopped?'stopped':store.list('session_put').some(s=>s.state==='running')?'optimizer':store.list('evaluation_put').find(e=>e.state==='running')?.phase??store.list('iteration_put').find(i=>!['promoted','rejected','held'].includes(i.state))?.state??(store.task().state==='created'?'materializing':store.task().state);
    pending=pending.then(async()=>{const file=join(store.root,'private/worker.json');await privateWrite(`${file}.tmp`,JSON.stringify({pid:process.pid,at:now(),phase,lastError,upstreamConfigured:['RSI_UPSTREAM_BASE_URL','RSI_UPSTREAM_MODEL','RSI_UPSTREAM_API_KEY'].every(key=>Boolean(process.env[key]?.trim()))}));await rename(`${file}.tmp`,file);}).catch(e=>{error=e;});
  };
  beat();const timer=setInterval(beat,5000);timer.unref();
  let result:T;
  try { result=await action(e=>{lastError=workerErrorText(e);beat();}); }
  catch(e) { lastError=workerErrorText(e); throw e; }
  finally {clearInterval(timer);stopped=true;beat();await pending;}
  if(error)throw error;return result;
}

export async function runWorker(store: RsiStore, settings: WorkerSettings, client: DockerClient,
  execute: boolean, options: { watch?: boolean; signal?: AbortSignal; reviews?: ReviewProvider; backend?: ExecutionBackend; afterRun?: () => Promise<void>; modelClient?: HealthModelClient; sessionReader?: OptimizerSessionReader } = {}): Promise<unknown> {
  validateWorkerSettings(settings);
  await store.refresh();
  const profile = await readFrozenAgent(join(store.root, 'private/agent'), settings.agent);
  const optimizer = settings.optimizer ? await readFrozenOptimizer(join(store.root, 'private/optimizer'), settings.optimizer) : null;
  const reviewSettings=settings.reviews ? resolveReviewSettings(optimizer?.family ?? (()=>{throw new Error('Configured reviews require a frozen optimizer profile');})(),settings.reviews) : null;
  if (execute && optimizer?.egress.kind === 'vendor-allowlist' && !settings.allowUnmeteredOptimizer) throw new Error('Vendor CONNECT cannot enforce token budgets. Set WorkerSettings.allowUnmeteredOptimizer=true or --allow-unmetered-optimizer.');
  if (execute && settings.proxy.mode === 'real') upstreamEnvironment();
  if (!execute) return { execute: false, taskId: store.taskId, state: store.task().state, concurrency: settings.concurrency,
    planned: ['recover labelled containers/networks', 'baseline train × R and sealed × 3', 'L1/build', 'smoke', 'train', 'review', 'sealed × 3', 'decide'],
    queue: store.list('queue_put').filter(q => q.state === 'queued').map(q => ({ id: q.id, kind: q.kind })) };
  return taskLock(store.root, 'worker', () => withHeartbeat(store, async report => {
    await recoverOptimizerSessions(store, client);
    const mirror = join(store.root, 'private/repository.git');
    try { await stat(mirror); } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; await createMirror(store.task().repository, mirror); }
    await importCommit(store.task().repository, mirror, store.task().baselineCommit);
    await git(['--git-dir',mirror,'update-ref','refs/rsi/baseline',store.task().baselineCommit]);
    const bank = await readBank(join(store.root, 'private/bank'));
    if (bank.datasetHash !== store.task().datasetHash) throw new Error('Pinned bank hash changed');
    const worker = new RsiWorker(store, bank, settings, options.backend ?? new ContainerBackend(store, client, bank, settings, profile), options.reviews, options.afterRun, profile);
    await worker.loadUsage();
    const model = (scope: string) => createReviewModelClient(store, reviewSettings ?? defaultReviewSettings(), scope, r => worker.account(r), options.modelClient);
    await model('recovery').recover();
    if (!options.reviews && reviewSettings) worker.reviews = new AgentReviewProvider({ store, bank, settings: reviewSettings, model,
      evaluate: request => worker.reviewEvaluation(request), results: e => finalRuns(e, store.list('run_put')).map(r => ({ questionId: r.questionId, outcome: r.outcome })),
      prepare: (commit, signal) => worker.backend.prepare(commit, signal ?? new AbortController().signal),
      validate: async (q, data, patch, signal) => {
        await worker.backend.prepare(store.task().baselineCommit, signal ?? new AbortController().signal);
        return evaluatePatch(client, store.taskId, q, data, patch, `rsi-evaluator-${q.toolchain}:p2`, settings.reportersRoot, signal);
      }, sessionReader: options.sessionReader ?? new StoredOptimizerSessionReader(store) });
    await recoverWork(store, client, async (name, runId) => worker.account(await readProxyUsage(client, name, runId, true)));
    // Reconcile fsynced receipts after a crash between telemetry and task_put.
    for (const r of await readdir(join(store.root, 'private/usage'))) if (/^[a-f0-9]{64}\.json$/.test(r)) await worker.account(JSON.parse(await readFile(join(store.root, 'private/usage', r), 'utf8')) as UsageReceipt);
    let optimizerImage: string | null = null;
    if (optimizer) worker.optimizerSession = async () => {
      // The proxy image is normally prepared during baseline evaluation.
      if (!optimizerImage) optimizerImage = await buildOptimizer(client, join(store.root,'private/optimizer'), optimizer, options.signal);
      await runOptimizerSession(store,client,optimizer,optimizerImage!,settings,r=>worker.account(r),options.signal);
    };
    do {
      try { await worker.run(options.signal); }
      catch(error) {
        // run() already paused the task. Watch mode keeps serving human recovery commands.
        if(!options.watch || options.signal?.aborted) throw error;
        report(error); console.error(`RSI worker: ${workerErrorText(error)}`);
      }
      if(!options.watch || options.signal?.aborted) break;
      try { await delay(5000,undefined,{signal:options.signal}); } catch(e) { if(!options.signal?.aborted) throw e; }
      await store.refresh();
    } while(!options.signal?.aborted);
    return { execute: true, taskId: store.taskId, state: store.task().state };
  }));
}
