import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FoldingCase, FoldingCheckResult, FoldingProject, FoldingRunPlan, FoldingTrial } from '../../src/core/agent-folding-types.js';
import type { TeamExperimentPlan } from '../../src/core/team-experiment-types.js';
import { runTeamExperiment } from '../team-experiment/runner.js';
import type { FoldingRunnerOptions } from './runner.js';
import { saveFoldingProject } from './runner.js';

export function externalFoldingChecks(task: FoldingCase, detail: string | null, evidenceId: string): FoldingCheckResult[] | null {
  if (!detail?.trim().startsWith('{')) return null;
  let parsed: unknown; try { parsed = JSON.parse(detail); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join() !== 'folding_checks') return null;
  const values = (parsed as { folding_checks: unknown }).folding_checks;
  if (!Array.isArray(values) || values.length !== task.checks.length) throw new Error('Independent evaluator check set does not match the fixed case.');
  const ids = new Set<string>();
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'id,passed') throw new Error('Invalid independent evaluator check result.');
    const check = value as { id: unknown; passed: unknown };
    if (typeof check.id !== 'string' || ids.has(check.id) || !task.checks.some(c => c.id === check.id) || !(check.passed === null || typeof check.passed === 'boolean')) throw new Error('Invalid independent evaluator check identity.');
    ids.add(check.id); return { id: check.id, label: 'Independent named external check', passed: check.passed, evidenceId };
  });
}

/** Adapts each independent case to the existing isolated Git/argv/evaluator protocol. */
export async function runExternalFoldingExperiment(project: FoldingProject, plan: FoldingRunPlan, options: FoldingRunnerOptions): Promise<FoldingProject> {
  if (!plan.external) throw new Error('External driver configuration is required.');
  if (plan.skillAblation) throw new Error('External skill ablation needs a distinct declared driver; the legacy two-driver adapter cannot certify skill-off.');
  if (plan.provider !== 'fixture' && !options.allowPaid) throw new Error('External paid execution requires --allow-paid.');
  const output = resolve(options.output); await mkdir(dirname(output), { recursive: true }); await mkdir(output, { mode: 0o700 });
  const id = `external-${randomUUID()}`, sourceId = `${id}-source`, external = plan.external;
  const boundary = project.boundaries.find(b => b.id === plan.boundaryId);
  if (!boundary || boundary.proposed !== plan.operation || [...boundary.targetAgentIds].sort().join() !== [...plan.targetAgentIds].sort().join()) throw new Error('External plan does not match a declared boundary.');
  const tasks = plan.caseIds.map(caseId => {
    const task = external.cases.find(c => c.id === caseId), original = project.cases.find(c => c.id === caseId);
    if (!task || !original || JSON.stringify(task) !== JSON.stringify(original)) throw new Error('External cases must match the fixed project case set.');
    return task;
  });
  project.sources.push({ id: sourceId, kind: plan.provider === 'fixture' ? 'offline_smoke' : 'live_api', title: 'Local isolated external driver execution', url: null, revision: external.ref, observedAt: new Date().toISOString(), model: plan.model, limitations: [
    'External driver model/configuration and internal budgets are declarations; the runner enforces wall deadlines and checks reported usage after execution.',
    'Git workspaces, argv execution and independent evaluator are enforced; arbitrary external services or GUI processes remain driver scope.',
    'Legacy driver capture does not provide an authoritative action log; an empty actions array does not certify that no writes occurred.',
  ] });
  const experiment = { id, title: plan.title, boundaryId: plan.boundaryId, operation: plan.operation, baselineVariantId: 'baseline', candidateVariantId: 'candidate', caseIds: plan.caseIds, expectedRepetitions: plan.repetitions,
    controls: { taskSet: 'verified' as const, grader: 'declared' as const, model: 'unknown' as const, nonTarget: 'declared' as const, intervention: 'declared' as const, execution: 'declared' as const,
      baselineRevision: null as string | null, candidateRevision: null as string | null, skillAblation: 'not_run' as const, notes: ['Same per-case turns/identity and isolated pinned commit; semantic boundary isolation is driver-declared.', 'Both variants may use the same declared architecture mode.'] }, trialIds: [] as string[], evidenceIds: [] as string[] };
  project.experiments.push(experiment); await saveFoldingProject(join(output, 'report.json'), project);
  for (const task of tasks) {
    if (options.signal?.aborted) break;
    const prompt = `Case ${task.id}\nSigned-in customer: ${task.customerId ?? 'not specified'}\n${task.turns.map((turn, i) => `Turn ${i + 1}: ${turn}`).join('\n')}`;
    const common = { product: 'external-driver', model: plan.model ?? 'fixture', environment: 'isolated local Git checkout; external effects are driver-owned', parameters: JSON.stringify({ budgets: plan.budgets, caseId: task.id, customerId: task.customerId, operation: plan.operation, targets: plan.targetAgentIds }), toolSet: 'Driver declared', mode: 'subagents' as const, prompt };
    for (let offset = 0; offset < plan.repetitions; offset += 10) {
    if (options.signal?.aborted) break;
    const oldPlan: TeamExperimentPlan = { version: 1, kind: 'team-experiment', name: `${plan.title}: ${task.id}`, repetitions: Math.min(10, plan.repetitions - offset), schedule: plan.schedule,
      task: { id: task.id, repository: external.repository, ref: external.ref, prompt, expectedTests: 1, evaluator: external.evaluator, timeoutMs: plan.budgets.timeoutMs, caseIds: [task.id] },
      variants: [{ ...common, id: 'baseline', driver: external.baselineDriver }, { ...common, id: 'candidate', driver: external.candidateDriver }] };
    const caseName = `case-${createHash('sha256').update(task.id).digest('hex').slice(0, 12)}-${offset}`, caseDirectory = join(output, caseName);
    // The reused runner atomically preserves its own partial report even when cancelled.
    const result = await runTeamExperiment(oldPlan, { output: caseDirectory, signal: options.signal, synthetic: plan.provider === 'fixture', onProgress: options.onProgress });
    experiment.controls.baselineRevision = result.commit; experiment.controls.candidateRevision = result.commit;
    for (const old of result.trials) {
      const trialId = `${id}-${caseName}-${old.variantId}-${offset + old.repetition - 1}`, evidenceId = `${trialId}-evidence`, usage = old.run.telemetry?.usage;
      let inputTokens: number | null = null;
      if (usage?.input !== null && usage?.input !== undefined && usage.inputIncludesCache !== null) {
        inputTokens = usage.inputIncludesCache ? usage.input : usage.cacheRead !== null && usage.cacheWrite !== null ? usage.input + usage.cacheRead + usage.cacheWrite : null;
      }
      let outputTokens = usage?.output ?? null;
      if (usage && outputTokens !== null && usage.outputIncludesReasoning === false) outputTokens = usage.reasoning !== null ? outputTokens + usage.reasoning : null;
      if (usage && usage.outputIncludesReasoning === null) outputTokens = null;
      const modelCalls = old.run.telemetry?.spans.filter(s => s.kind === 'model').length ?? null;
      const overBudget = modelCalls !== null && modelCalls > plan.budgets.maxCallsPerCase || inputTokens !== null && outputTokens !== null && inputTokens + outputTokens > plan.budgets.maxTotalTokensPerCase;
      const verdict = old.cases?.find(c => c.id === task.id), aggregate = old.run.verdict;
      const acceptable = old.run.status === 'completed' && verdict && aggregate?.total === 1 && (aggregate.passed === 1) === (verdict.status === 'passed');
      let grade: 0 | 1 | null = plan.provider === 'fixture' || !acceptable || overBudget || verdict?.status === 'unknown' ? null : verdict?.status === 'passed' ? 1 : 0;
      let named: FoldingCheckResult[] | null = null, checkError: string | null = null;
      try {
        named = externalFoldingChecks(task, verdict?.detail ?? null, evidenceId);
        if (named && grade !== null) {
          const required = named.filter(c => task.checks.find(t => t.id === c.id)?.required);
          const namedGrade = required.some(c => c.passed === false) ? 0 : required.some(c => c.passed === null) ? null : 1;
          if (namedGrade !== grade) throw new Error('Named checks contradict the independent case verdict.');
        }
      } catch (error) { grade = null; checkError = error instanceof Error ? error.message : 'Invalid external named checks.'; }
      const gradeEvidenceId = `${trialId}-grade`, checks = named ?? task.checks.map(check => ({ id: check.id, label: 'Legacy case-level verdict; individual check detail unavailable', passed: null, evidenceId }));
      const trial: FoldingTrial = { id: trialId, experimentId: id, variantId: old.variantId, caseId: task.id, repetition: offset + old.repetition - 1, sourceId, grade, checks: checks.map(c => ({ ...c, evidenceId: gradeEvidenceId, passed: plan.provider === 'fixture' || checkError ? null : c.passed })), answer: null,
        latencyMs: old.run.e2eMs, inputTokens, outputTokens, modelCalls, toolCalls: old.evidence?.events.filter(e => e.kind === 'tool').length ?? null, model: old.run.telemetry?.actualModel ?? null, byAgent: {}, actions: [],
        events: old.evidence?.events.map((e, i) => ({ id: `${trialId}-${i}`, sequence: i + 1, role: e.kind === 'handoff' ? 'handoff' : e.kind === 'verification' ? 'verification' : e.kind === 'tool' ? 'tool_call' : 'model', agentId: e.agentId, targetAgentId: e.targetAgentId, name: e.name, content: e.detail === null ? null : Buffer.from(e.detail).subarray(0, 15000).toString('utf8'), startMs: e.startMs, durationMs: e.durationMs, evidenceId, complete: e.detail === null || Buffer.byteLength(e.detail) <= 15000 })) ?? [],
        harnessError: old.run.status !== 'completed' ? old.run.error ?? old.run.status : overBudget ? 'External driver reported usage above the plan budget.' : checkError ?? old.evidenceError, evidenceIds: [evidenceId, gradeEvidenceId] };
      project.trials.push(trial); experiment.trialIds.push(trial.id); experiment.evidenceIds.push(evidenceId);
      project.evidence.push({ id: evidenceId, sourceId, path: `${caseName}/report.json`, pointer: `/trials/${result.trials.indexOf(old)}`, sha256: null, kind: 'trace', excerpt: 'External driver capture; model and complete internal-budget compliance are not independently certified.', text: null, complete: old.evidence?.coverage.activities ?? false, native: null });
      project.evidence.push({ id: gradeEvidenceId, sourceId, path: `${caseName}/report.json`, pointer: `/trials/${result.trials.indexOf(old)}/cases`, sha256: null, kind: 'grade', excerpt: named ? 'Independent evaluator named check results.' : 'Legacy case-level verdict only; individual check detail unavailable.', text: null, complete: named !== null && !checkError, native: null });
      await saveFoldingProject(join(output, 'report.json'), project);
    }
    }
  }
  return project;
}
