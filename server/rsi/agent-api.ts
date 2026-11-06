import { createHash, timingSafeEqual } from 'node:crypto';
import type { RsiStore } from './queue.js';
import { agentCommand, selectedParent, targetAllowPaths } from './commands.js';
import { boundedJson, notFound, page, RsiError, strictObject, runTrajectory, validId } from './reader.js';
import { projectTaskForOptimizer, projectIterationForOptimizer, projectEvaluationForOptimizer, projectRunForOptimizer, projectFindingForOptimizer, projectDecisionForOptimizer, projectInstructionForOptimizer, projectQualityForOptimizer } from '../../src/core/rsi-visibility.js';
import type { RsiPrd } from '../../src/core/rsi-types.js';
export function tokenMatches(token: string, hash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(hash, 'hex'));
}
export async function authenticateAgent(stores: RsiStore[], token: string): Promise<RsiStore | null> {
  let match: RsiStore | null = null;
  for (const store of stores) {
    if (tokenMatches(token, store.task().taskTokenHash)) match = store;
    try {
      const value = await boundedJson(store.root, 'private/agent-session.json', 4096) as { sessionId: string; tokenHash: string; expiresAt: string };
      const same = typeof value.tokenHash === 'string' && tokenMatches(token, value.tokenHash);
      if (same && Date.parse(value.expiresAt) > Date.now() && store.list('session_put').some(s => s.id === value.sessionId && s.state === 'running')) match = store;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return match;
}
export async function brief(store: RsiStore): Promise<unknown> {
  const t = store.task(), active = store.list('session_put').find(s => s.state === 'running');
  const parentId = active ? active.parentId : selectedParent(store);
  const parent = store.list('iteration_put').find(i => i.id === parentId), seq = Math.max(0, ...store.list('iteration_put').map(i => i.seq));
  return { task: projectTaskForOptimizer(t), parent: { iterationId: parentId, commit: parent?.commit ?? t.baselineCommit, trainScore: parent?.trainScore ?? t.baselineTrainScore ?? 0 },
    instructions: store.list('instruction_put').filter(i => i.effectiveFromSeq <= seq + 1).map(projectInstructionForOptimizer).filter(Boolean),
    remainingTaskTokens: Math.max(0, t.config.maxTaskTokens - t.tokenUsage), remainingIterations: Math.max(0, t.config.maxIterations - t.iterationCount), lastIterationSeq: seq,
    allowPaths: await targetAllowPaths(store) };
}
export async function optimizerResults(store: RsiStore, seq: string, query: URLSearchParams): Promise<unknown> {
  if (!/^(?:0|[1-9]\d*)$/.test(seq)) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  // Round 0 is the baseline: without its training results the first round would have no failures to study. Only training, never sealed.
  if (seq === '0') {
    const evaluations = page(store.list('evaluation_put').filter(e => e.iterationId === null && e.phase === 'train' && e.commit === store.task().baselineCommit && projectEvaluationForOptimizer(e) !== null), query);
    const ids = new Set(evaluations.items.map(e => e.id));
    return { iteration: null, evaluations: evaluations.items.map(projectEvaluationForOptimizer), runs: store.list('run_put').filter(r => ids.has(r.evaluationId)).map(r => projectRunForOptimizer(r, 'train')).filter(Boolean), findings: [], decisions: [], quality: null, nextCursor: evaluations.nextCursor };
  }
  const i = store.list('iteration_put').find(i => i.seq === Number(seq)); if (!i) return notFound();
  // Filter before pagination, so final existence is not disclosed by cursors.
  const evaluations = page(store.list('evaluation_put').filter(e => e.iterationId === i.id && e.phase !== 'final' && projectEvaluationForOptimizer(e) !== null), query);
  const ids = new Set(evaluations.items.map(e => e.id));
  let quality: unknown = null;
  try { quality = projectQualityForOptimizer(await boundedJson(store.root, `artifacts/${i.id}/quality.json`)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return { iteration: projectIterationForOptimizer(i), evaluations: evaluations.items.map(projectEvaluationForOptimizer),
    runs: store.list('run_put').filter(r => ids.has(r.evaluationId)).map(r => projectRunForOptimizer(r, evaluations.items.find(e => e.id === r.evaluationId)!.phase)).filter(Boolean),
    findings: store.list('finding_put').filter(f => f.iterationId === i.id).map(projectFindingForOptimizer).filter(Boolean),
    decisions: store.list('decision_put').filter(d => d.iterationId === i.id).map(projectDecisionForOptimizer).filter(Boolean), quality, nextCursor: evaluations.nextCursor };
}
export async function agentMutation(store: RsiStore, action: 'submit' | 'declare_stuck', input: unknown): Promise<unknown> {
  const o = strictObject(input, action === 'submit' ? ['requestId','commit','prd'] : ['requestId','reason']);
  const requestId = validId(o.requestId as string);
  const q = await agentCommand(store, requestId, action === 'submit' ? { action, commit: o.commit as string, prd: o.prd as RsiPrd, parentId: null } : { action, reason: o.reason as string });
  return { taskId: store.taskId, queueId: q.id, status: 'queued' };
}
export { runTrajectory };
