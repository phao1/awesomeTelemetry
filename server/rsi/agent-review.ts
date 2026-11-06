import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RsiEvaluation, RsiFinding, RsiIteration, RsiQuestionResult, RsiTask } from '../../src/core/rsi-types.js';
import { createHealthModelClient } from '../task-health/model-client.js';
import type { HealthModelClient, HealthModelRequest, HealthModelResponse } from '../task-health/model-client.js';
import type { QuestionBank, QuestionData, RsiBankQuestion } from './bank.js';
import { candidateDiff, git } from './build.js';
import { ADVERSARY_PROMPT_VERSION, compareAdversarial, prepareAdversarialVariants } from './adversary.js';
import { createAblationCommit, runAblation, selectAblationPatch } from './ablation.js';
import { MONITOR_PROMPT_VERSION, runMonitor } from './monitor.js';
import { PROCESS_MONITOR_PROMPT_VERSION, runProcessMonitor } from './process-monitor.js';
import type { OptimizerSessionReader } from './process-monitor.js';
import type { ReviewProvider, ReviewResult, ReviewSettings } from './review.js';
import { validateReviewSettings } from './review.js';
import type { RsiStore } from './queue.js';
import { now } from './queue.js';
import type { UsageReceipt } from './proxy-run.js';

export const AGENT_REVIEW_POLICY_VERSION = 'rsi-agent-review-v2';
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function durableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`, file = await open(temp, 'w', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const dir = await open(dirname(path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
async function optionalJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function auditSelected(iterationId: string, rate: number): boolean {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('Invalid audit rate');
  return Number.parseInt(digest(['audit-v1', iterationId]).slice(0, 13), 16) / 0x10000000000000 < rate;
}
interface ModelReceipt {
  id: string; state: 'reserved' | 'settled'; reservation: number; tokens: number;
  response: HealthModelResponse | null; complete: boolean;
}
export interface ReviewModelClient extends HealthModelClient { recover(): Promise<void> }
/** Durable admission and receipts around the existing tool-free transport. Never persist prompts or keys. */
export function createReviewModelClient(store: RsiStore, settings: ReviewSettings, scope: string,
  account: (receipt: UsageReceipt) => Promise<void>, transport?: HealthModelClient,
  env: NodeJS.ProcessEnv = process.env): ReviewModelClient {
  validateReviewSettings(settings);
  const root = join(store.root, 'private/review-calls');
  let serial: Promise<unknown> = Promise.resolve();
  const charge = async (r: ModelReceipt): Promise<void> => account({ runId: r.id, tokens: r.tokens,
    requests: 1, blocked: false, complete: r.complete });
  const execute = async (request: HealthModelRequest): Promise<HealthModelResponse> => {
    request.signal.throwIfAborted();
    const id = digest([scope, settings.monitorFamily, settings.monitorModel, MONITOR_PROMPT_VERSION, request.system, request.user, request.maxTokens]);
    const file = join(root, `${id}.json`), prior = await optionalJson<ModelReceipt>(file);
    if (prior) {
      if (prior.state === 'reserved') { prior.state = 'settled'; prior.tokens = prior.reservation; prior.complete = false; await durableJson(file, prior); }
      await charge(prior);
      if (!prior.complete || !prior.response) throw new Error('Review request interrupted or unavailable');
      request.signal.throwIfAborted(); return prior.response;
    }
    // One token per UTF8 byte plus requested output is a conservative admission estimate,
    // not an assertion about a vendor tokenizer. Observed usage is always fully charged.
    const reservation = Buffer.byteLength(request.system) + Buffer.byteLength(request.user) + request.maxTokens;
    const task = store.task();
    if (reservation > task.config.maxTaskTokens - task.tokenUsage) throw new Error('Review token admission budget unavailable');
    const client = transport ?? createHealthModelClient({ HEALTH_MODEL_PROVIDER: 'openai-compatible', HEALTH_MODEL: settings.monitorModel,
      HEALTH_MODEL_BASE_URL: settings.monitorBaseUrl, HEALTH_MODEL_API_KEY: env.RSI_MONITOR_API_KEY });
    const r: ModelReceipt = { id, state: 'reserved', reservation, tokens: reservation, response: null, complete: false };
    await durableJson(file, r);
    let failure: unknown;
    try {
      let remove = (): void => {};
      const stopped = new Promise<never>((_, reject) => {
        const abort = (): void => reject(new Error('Review request cancelled'));
        request.signal.addEventListener('abort', abort, { once: true });
        remove = () => request.signal.removeEventListener('abort', abort);
        if (request.signal.aborted) abort();
      });
      let response: HealthModelResponse;
      try { response = await Promise.race([client.create(request), stopped]); } finally { remove(); }
      if (response.inputTokens !== null && response.outputTokens !== null && Number.isSafeInteger(response.inputTokens)
        && Number.isSafeInteger(response.outputTokens) && response.inputTokens >= 0 && response.outputTokens >= 0) {
        r.tokens = response.inputTokens + response.outputTokens; r.complete = true; r.response = response;
      }
    } catch (error) { failure = error; }
    r.state = 'settled'; await durableJson(file, r); await charge(r);
    request.signal.throwIfAborted();
    if (failure || !r.complete || !r.response) throw new Error('Review model response unavailable');
    return r.response;
  };
  return {
    create(request) { const job = serial.then(() => execute(request)); serial = job.catch(() => undefined); return job; },
    async recover() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      for (const file of await readdir(root)) if (/^[a-f0-9]{64}\.json$/.test(file)) {
        const receipt = await optionalJson<ModelReceipt>(join(root, file));
        if (!receipt || `${receipt.id}.json` !== file || !Number.isSafeInteger(receipt.tokens) || receipt.tokens < 0
          || !Number.isSafeInteger(receipt.reservation) || receipt.reservation < 0) throw new Error('Invalid review receipt');
        if (receipt.state === 'reserved') { receipt.state = 'settled'; receipt.tokens = receipt.reservation; receipt.complete = false; receipt.response = null; await durableJson(join(root, file), receipt); }
        await charge(receipt);
      }
    },
  };
}
export interface ReviewEvaluationRequest {
  key: string; iterationId: string | null; commit: string; phase: 'adversarial' | 'ablation';
  questions?: { question: RsiBankQuestion; data: QuestionData }[]; sourceCommit?: string; ablationOf?: string;
}
export interface AgentReviewServices {
  store: RsiStore; bank: QuestionBank; settings: ReviewSettings;
  model(scope: string): HealthModelClient;
  evaluate(input: ReviewEvaluationRequest, signal?: AbortSignal): Promise<RsiEvaluation | null>;
  results(evaluation: RsiEvaluation): RsiQuestionResult[];
  validate(question: RsiBankQuestion, data: QuestionData, patch: Buffer, signal?: AbortSignal): Promise<{ outcome: 'pass' | 'fail' | 'infra_error' }>;
  prepare(commit: string, signal?: AbortSignal): Promise<unknown>;
  sessionReader?: OptimizerSessionReader;
  diff?(iteration: RsiIteration, fullContext: boolean): Promise<string>;
  ablationCommit?(iteration: RsiIteration, patch: string, signal?: AbortSignal): Promise<string>;
}
export class AgentReviewProvider implements ReviewProvider {
  readonly services: AgentReviewServices;
  constructor(services: AgentReviewServices) { validateReviewSettings(services.settings); this.services = services; }
  async review(task: RsiTask, iteration: RsiIteration, signal?: AbortSignal): Promise<ReviewResult> {
    const s = this.services, parent = s.store.list('iteration_put').find(i => i.id === iteration.parentId);
    const retry = s.store.list('queue_put').filter(q => q.iterationId === iteration.id && q.command.action === 'retry_review')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1)?.id ?? 'initial';
    const scope = digest([AGENT_REVIEW_POLICY_VERSION, iteration.id, retry, s.settings, MONITOR_PROMPT_VERSION, ADVERSARY_PROMPT_VERSION, PROCESS_MONITOR_PROMPT_VERSION, task.monitorCalibration]), root = join(s.store.root, 'private/reviews', iteration.id, scope);
    const cached = await optionalJson<ReviewResult>(join(root, 'result.json'));
    if (cached) return cached;
    const mirror = join(s.store.root, 'private/repository.git'), parentCommit = parent?.commit ?? task.baselineCommit;
    const diff = s.diff ? await s.diff(iteration, false) : await candidateDiff(mirror, parentCommit, iteration.commit);
    const monitorDiff = s.diff ? await s.diff(iteration, true) : (await git(['--git-dir', mirror, 'diff', '--no-ext-diff', '--no-textconv', '--unified=1000000', parentCommit, iteration.commit, '--'], { signal, maxOutputBytes: 128 * 1024 * 1024 })).toString();
    const client = s.model(scope), options = { client, model: s.settings.monitorModel, timeoutMs: s.settings.timeoutMs, maxTokens: s.settings.maxOutputTokens };
    const findings = s.store.list('finding_put').filter(f => f.iterationId === iteration.id);
    const statements: string[] = [];
    // The bank reader is the sole reader of the primary frozen bank.
    const { readQuestionData } = await import('./bank.js');
    for (const id of s.bank.manifest.sets.train) statements.push((await readQuestionData(join(s.bank.root, 'tasks', id))).statement);
    const monitor = await runMonitor({ iterationId: iteration.id, diff: monitorDiff, statements,
      l1Alerts: findings.filter(f => f.level === 'L1').map(({ category, file, line }) => ({ category, file, line })) }, options, signal);
    await durableJson(join(root, 'monitor.json'), monitor);
    const calibration = task.monitorCalibration;
    const degraded = calibration?.status === 'failed' && calibration.family === s.settings.monitorFamily
      && calibration.model === s.settings.monitorModel && calibration.promptVersion === MONITOR_PROMPT_VERSION;
    const save = async (tag: string, value: Pick<RsiFinding, 'level' | 'severity' | 'source' | 'file' | 'line' | 'evidence'> & { category?: RsiFinding['category'] }): Promise<void> => {
      const id = digest([scope, tag, value]);
      if (!s.store.list('finding_put').some(f => f.id === id)) await s.store.put({ event: 'finding_put', payload: {
        ...value, id, taskId: task.id, iterationId: iteration.id, category: value.category ?? 'suspicious', at: now() } });
    };
    for (const [index, c] of monitor.conclusions.entries()) await save(`monitor-${index}`, { level: 'L4', severity: degraded ? 'info' : 'hold',
      source: degraded ? 'degraded_monitor' : 'monitor', file: c.file, line: c.line, evidence: JSON.stringify(c) });
    const process = await runProcessMonitor(iteration, diff, s.sessionReader ?? { read: async () => null }, options, signal);
    await durableJson(join(root, 'process.json'), process);
    await save('process', { level: 'L4', severity: 'info', source: 'process_monitor', file: null, line: null,
      category: process.status === 'suspicious' ? 'suspicious' : 'review_clean',
      evidence: JSON.stringify({ status: process.status, evidence: process.evidence, reason: process.reason }).slice(0, 65536) });
    let adversarial: ReviewResult['adversarial'] = { status: 'missing' };
    try {
      const prepared = await prepareAdversarialVariants({ iterationId: iteration.id, candidateDiff: diff, bank: s.bank,
        directory: join(root, 'variants'), questions: s.settings.adversarialQuestions, minimumValid: s.settings.adversarialMinValid,
        client, maxTokens: s.settings.maxOutputTokens, timeoutMs: s.settings.timeoutMs, validate: s.validate }, signal);
      if (prepared.status === 'ready') {
        const questions = prepared.variants.map(v => ({ question: v.question, data: v.data }));
        const p = await s.evaluate({ key: `${scope}-${prepared.manifestHash}-parent`, iterationId: iteration.parentId, commit: parentCommit, phase: 'adversarial', questions }, signal);
        const c = p && await s.evaluate({ key: `${scope}-${prepared.manifestHash}-candidate`, iterationId: iteration.id, commit: iteration.commit, phase: 'adversarial', questions }, signal);
        if (p && c) adversarial = compareAdversarial(prepared.variants, s.results(p), s.results(c), s.settings.adversarialRegressionMin);
      }
    } catch (error) { if (signal?.aborted) throw error; adversarial = { status: 'missing' }; }
    const ablationFindings = [...findings.filter(f => f.level === 'L1' && f.source !== 'patch_scan'),
      ...monitor.conclusions.map(c => ({ level: 'L4' as const, source: degraded ? 'degraded_monitor' as const : 'monitor' as const, file: c.file, line: c.line }))];
    const selected = selectAblationPatch(diff, ablationFindings);
    if (selected.hunks.length && s.store.task().state === 'running') {
      let ablation;
      try {
        const commit = s.ablationCommit ? await s.ablationCommit(iteration, selected.patch, signal) : await createAblationCommit(mirror, iteration.commit, selected.patch, signal);
        ablation = await runAblation({ commit, candidateScore: iteration.trainScore!, delta: task.delta!,
          prepare: async (sha, owned) => { await s.prepare(sha, owned); },
          evaluate: async (sha, owned) => {
            const e = await s.evaluate({ key: `${scope}-ablation`, iterationId: iteration.id, commit: sha, phase: 'ablation', sourceCommit: iteration.commit, ablationOf: iteration.id }, owned);
            return { score: e?.score ?? null, complete: !!e && e.score !== null };
          } }, signal);
      } catch (error) { if (signal?.aborted) throw error; ablation = { status: 'missing' as const, reason: 'ablation_unavailable', score: null, scoreDrop: null }; }
      await durableJson(join(root, 'ablation.json'), ablation);
      if (ablation.status === 'suspicious') await save('ablation', { level: 'L3', severity: 'hold', source: 'monitor', file: null, line: null, evidence: JSON.stringify(ablation) });
      if (ablation.status === 'inconclusive') {
        // L2 is informational to the existing gate and invisible in optimizer projections.
        await save('ablation-build-failed', { level: 'L2', severity: 'info', source: 'calibration', file: null, line: null,
          evidence: JSON.stringify({ kind: 'ablation', ...ablation, sourceCommit: iteration.commit, ablationOf: iteration.id }) });
      } else {
        adversarial = { status: adversarial.status === 'missing' || ablation.status === 'missing' ? 'missing'
          : adversarial.status === 'suspicious' || ablation.status === 'suspicious' ? 'suspicious' : 'clean' };
      }
    }
    const result: ReviewResult = { monitor: { status: monitor.status === 'suspicious' && degraded ? 'clean' : monitor.status }, adversarial: { status: adversarial.status } };
    signal?.throwIfAborted();
    if (s.store.task().state === 'running') await durableJson(join(root, 'result.json'), result);
    return result;
  }
}
