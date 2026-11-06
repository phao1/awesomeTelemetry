import type { RsiTask, RsiIteration, RsiEvaluation, RsiRun, RsiFinding, RsiInstruction, RsiDecision, RsiCommand, RsiConfig, RsiOptimizerSession, RsiMonitorCalibration, RsiLedgerHead, RsiPromotionResult, RsiPhase, RsiOutcome, RsiQueueItem } from './rsi-types.js';

// RSI-016 page DTOs. All nullable metrics are observed values, never estimates.
export type RsiTaskView = Omit<RsiTask, 'taskTokenHash'>;
export interface RsiPage<T> { items: T[]; nextCursor: string | null }
export interface RsiPageSettings { optimizerSessionTokens?: number; optimizerSessionTimeoutMs?: number; allowUnmeteredOptimizer?: boolean; concurrency?: number }
export interface RsiCreateRequest { requestId: string; repository: string; baselineCommit: string; agentProfile: string; optimizerProfile: string; bank: string; subset?: 'small' | 'full'; config: RsiConfig; settings?: RsiPageSettings }
export interface RsiAccepted { taskId: string; queueId: string; status: 'queued' }
export interface RsiCreated extends RsiAccepted { agentToken: string | null }
export interface RsiWorkerStatus { pid: number | null; at: string | null; phase: string | null; running: boolean; upstreamConfigured: boolean | null }
export interface RsiSummary {
  task: RsiTaskView; agentName: string | null; optimizerName: string | null; repositoryName: string;
  pendingCount: number; bestTrainScore: number | null; trainScores: { seq: number; score: number | null }[];
  sealedRemaining: number; tokenUsage: number; tokenBudget: number; lastActivity: string;
  trainCount: number | null; worker: RsiWorkerStatus;
}
export interface RsiReviewItem { id: string; taskId: string; taskName: string; iteration: RsiIteration; kind: 'held' | 'audit'; reasons: string[]; at: string }
export interface RsiOverview { tasks: RsiSummary[]; reviews: RsiReviewItem[]; pendingCount: number }
export interface RsiProfileOption { id: string; path: string; name: string; description: string | null; family: string | null; egress: 'model-proxy' | 'vendor-allowlist' | null; loginRequired: boolean; verified: boolean }
export interface RsiBankDistribution { phase: 'smoke' | 'train' | 'sealed' | 'final'; count: number; languages: Record<string, number> }
export interface RsiOptions { agents: RsiProfileOption[]; optimizers: RsiProfileOption[]; bank: { path: string; full: RsiBankDistribution[]; small: RsiBankDistribution[] } | null; defaults: RsiConfig; settings: Required<RsiPageSettings> }
export interface RsiIterationMetric { iteration: RsiIteration; iterationId: string; seq: number; targetTokens: number | null; optimizerTokens: number | null; reviewTokens: number | null; durationMs: number | null; cacheHitRate: number | null; reason: string | null; defenses: RsiVerdict['defenses']; finalState: 'not_requested' | 'reserved' | 'completed'; session: RsiOptimizerSession | null }
export interface RsiMetrics { iterations: RsiIterationMetric[]; cacheHitRate: number | null; helpReason: string | null; pendingCommands: number; baselineProgress: { completed: number; planned: number } | null }
export type RsiDefenseState = 'pass' | 'hold' | 'reject' | 'missing' | 'not_reached';
export interface RsiVerdict { result: RsiPromotionResult; defenses: { level: RsiFinding['level']; state: RsiDefenseState; reason: string }[]; parentTrainScore: number | null; candidateTrainScore: number | null; parentSealedScore: number | null; candidateSealedScore: number | null; delta: number | null; parentTokens: number | null; candidateTokens: number | null }
export interface RsiPageRun { id: string; questionId: string; phase: RsiPhase; language: string | null; outcome: RsiOutcome; failureReason: RsiRun['failureReason']; tokens: number | null; durationMs: number; memoryPeakBytes: number | null; sessionTokens: number | null; tokenDifference: number | null; at: string; repetition: number; attempt: number }
export interface RsiReviewEvidence {
  scope: string | null; monitor: { status: 'clean' | 'suspicious' | 'missing'; reason: string; model: string | null; promptVersion: string | null; conclusions: { category: string; evidence: string; confidence: number; file: string; line: number }[] } | null;
  process: { status: 'clean' | 'suspicious' | 'missing'; reason: string; evidence: string[] } | null;
  variants: { questionId: string; sourceQuestionId: string; parentOutcome: RsiOutcome | null; candidateOutcome: RsiOutcome | null; regression: boolean | null }[];
  discarded: { questionId: string; reason: string }[];
  ablation: { status: string; reason: string; score: number | null; scoreDrop: number | null; hunks: { file: string; line: number; count: number }[] } | null;
}
export interface RsiLedgerReport { valid: boolean; entryCount: number; head: RsiLedgerHead; issues: { code: string; line: number }[]; anchored: boolean }
export interface RsiQuality { addedLines: number; deletedLines: number; changedLines: number; files: number; addedFunctions: number }
export interface RsiTraceUsage { requestId: string; tokens: number | null; cacheHitRate: number | null }
export interface RsiTrajectoryPage { file: 'responses' | 'last-request'; content: string; nextOffset: number | null; truncated: boolean; usage: RsiTraceUsage[] | null; sessionTokens: number | null }
export interface RsiFieldError { field?: string; reason: string }

export class RsiApiError extends Error {
  readonly status: number; readonly code: string; readonly details: RsiFieldError | null;
  constructor(status: number, code: string, details: RsiFieldError | null = null) { super(code); this.status = status; this.code = code; this.details = details; }
}
/** Page bearer exists only in this closure. Concurrent callers share bootstrap. */
export function createRsiClient(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let token: Promise<string> | null = null;
  async function decode<T>(response: Response): Promise<T> {
    const value: unknown = await response.json();
    if (!response.ok) {
      const envelope = value as { error?: { code?: string; details?: RsiFieldError } };
      throw new RsiApiError(response.status, envelope.error?.code ?? 'INTERNAL_ERROR', envelope.error?.details ?? null);
    }
    return value as T;
  }
  const authenticate = () => token ??= fetcher('/api/rsi/session', { cache: 'no-store', credentials: 'same-origin' }).then(r => decode<{ token: string }>(r)).then(v => v.token).catch(error => { token = null; throw error; });
  async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
    const bearer = await authenticate();
    const response = await fetcher('/api/rsi' + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin', signal, headers: { Authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return decode<T>(response);
  }
  const taskPath = (id: string) => '/tasks/' + encodeURIComponent(id);
  const list = <T>(id: string, name: string, cursor?: string | null, signal?: AbortSignal) => request<RsiPage<T>>(`${taskPath(id)}/${name}?limit=200${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, signal);
  return {
    overview: (signal?: AbortSignal) => request<RsiOverview>('/overview', signal), options: (signal?: AbortSignal) => request<RsiOptions>('/options', signal),
    create: (body: RsiCreateRequest) => request<RsiCreated>('/tasks', undefined, body),
    command: (id: string, iterationId: string | null, command: RsiCommand, requestId: string) => request<RsiAccepted>(taskPath(id) + '/commands', undefined, { requestId, iterationId, command }),
    task: (id: string, signal?: AbortSignal) => request<{ task: RsiTaskView; head: RsiLedgerHead | null }>(taskPath(id), signal),
    iteration: (id: string, seq: number, signal?: AbortSignal) => request<{ iteration: RsiIteration }>(`${taskPath(id)}/iterations/${seq}`, signal),
    queue: (id: string, cursor?: string | null, signal?: AbortSignal) => list<RsiQueueItem & {audit:boolean}>(id, 'queue', cursor, signal),
    iterations: (id: string, cursor?: string | null, signal?: AbortSignal) => list<RsiIteration>(id, 'iterations', cursor, signal),
    evaluations: (id: string, cursor?: string | null, signal?: AbortSignal) => list<RsiEvaluation>(id, 'evaluations', cursor, signal),
    instructions: (id: string, cursor?: string | null, signal?: AbortSignal) => list<RsiInstruction>(id, 'instructions', cursor, signal),
    decisions: (id: string, cursor?: string | null, signal?: AbortSignal) => list<RsiDecision>(id, 'decisions', cursor, signal),
    findings: (id: string, seq: number, cursor?: string | null, signal?: AbortSignal) => list<RsiFinding>(id, `iterations/${seq}/findings`, cursor, signal),
    metrics: (id: string, signal?: AbortSignal) => request<RsiMetrics>(taskPath(id) + '/metrics', signal),
    worker: (id: string, signal?: AbortSignal) => request<RsiWorkerStatus>(taskPath(id) + '/worker', signal),
    verdict: (id: string, seq: number, signal?: AbortSignal) => request<RsiVerdict>(`${taskPath(id)}/iterations/${seq}/verdict`, signal),
    runs: (id: string, seq: number, cursor?: string | null, signal?: AbortSignal) => list<RsiPageRun>(id, `iterations/${seq}/runs`, cursor, signal),
    review: (id: string, seq: number, signal?: AbortSignal) => request<RsiReviewEvidence>(`${taskPath(id)}/iterations/${seq}/review`, signal),
    diff: (id: string, seq: number, signal?: AbortSignal) => request<{ diff: string; quality: RsiQuality; findings: RsiFinding[] }>(`${taskPath(id)}/iterations/${seq}/diff`, signal),
    calibration: (id: string, signal?: AbortSignal) => request<{ monitorCalibration: RsiMonitorCalibration | null; latestReport: RsiMonitorCalibration | null }>(taskPath(id) + '/calibration', signal),
    verify: (id: string, signal?: AbortSignal) => request<RsiLedgerReport>(taskPath(id) + '/ledger/verify', signal),
    trajectory: (id: string, kind: 'runs' | 'sessions', entity: string, file: 'responses' | 'last-request', offset = 0, signal?: AbortSignal) => request<RsiTrajectoryPage>(`${taskPath(id)}/${kind}/${encodeURIComponent(entity)}/trajectory?file=${file}&offset=${offset}&limit=65536`, signal),
  };
}
export const rsiApi = createRsiClient();
