// Method: anthropics/single-agent-loop-kit @ c437962, Apache-2.0.
// Heuristic thresholds below are telemetry defaults, not an Anthropic formula.
import { analyzeFoldingProject } from './agent-folding-analysis.js';
import type { FoldingProject, FoldingRuleDecision, FoldingRuleEvidence, FoldingRuleThresholds } from './agent-folding-types.js';

export const DEFAULT_FOLDING_THRESHOLDS: Readonly<FoldingRuleThresholds> = Object.freeze({
  version: 'architecture-r4-1', minSamples: 2, largeInputTokens: 10000,
  inputReturnRatio: 10, minCoupling: 0.5, minShare: 0.05,
});

export function decideFoldingAgent(e: FoldingRuleEvidence, isMain = false, overrides: Partial<FoldingRuleThresholds> = {}): FoldingRuleDecision {
  const thresholds = { ...DEFAULT_FOLDING_THRESHOLDS, ...overrides };
  if (!thresholds.version || !Number.isInteger(thresholds.minSamples) || thresholds.minSamples < 1
    || !Number.isFinite(thresholds.largeInputTokens) || thresholds.largeInputTokens <= 0
    || !Number.isFinite(thresholds.inputReturnRatio) || thresholds.inputReturnRatio <= 0
    || [thresholds.minCoupling, thresholds.minShare].some(n => !Number.isFinite(n) || n < 0 || n > 1)
    || !Number.isInteger(e.sampleCount) || e.sampleCount < 0
    || [e.inputTokens, e.returnTokens].some(n => n !== null && (!Number.isFinite(n) || n < 0))) throw new Error('Invalid rule evidence or thresholds.');
  const candidate = e.mergeCandidate;
  if (candidate && (!candidate.agentId || [candidate.coupling, candidate.share].some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw new Error('Invalid merge evidence.');
  const ratio = e.inputTokens !== null && e.returnTokens !== null && e.returnTokens > 0 ? e.inputTokens / e.returnTokens : null;
  const large = e.inputTokens === null || ratio === null ? null : e.inputTokens >= thresholds.largeInputTokens && ratio >= thresholds.inputReturnRatio && e.filteringSuffices === false;
  const independent = e.parallel === true || e.independentVerification === true ? true : e.parallel === false && e.independentVerification === false ? false : null;
  const merge = candidate !== null && candidate.agentId !== e.agentId && candidate.coupling >= thresholds.minCoupling && candidate.share >= thresholds.minShare;
  const enough = e.sampleCount >= thresholds.minSamples && (e.codeSupported || e.traceSupported);
  const result: FoldingRuleDecision = {
    agentId: e.agentId, action: 'insufficient', mergeWith: null,
    confidence: e.codeSupported && e.traceSupported ? 'high' : e.codeSupported || e.traceSupported ? 'medium' : 'low',
    sampleCount: e.sampleCount, thresholds,
    reasons: [
      { rule: 'samples', met: enough, value: e.sampleCount, threshold: thresholds.minSamples },
      { rule: 'large_input', met: large, value: e.inputTokens, threshold: thresholds.largeInputTokens },
      { rule: 'input_return_ratio', met: ratio === null ? null : ratio >= thresholds.inputReturnRatio, value: ratio, threshold: thresholds.inputReturnRatio },
      { rule: 'parallel_or_independent_verification', met: independent, value: null, threshold: null },
      { rule: 'skill_unresolvable_conflict', met: e.skillCannotResolveConflict, value: null, threshold: null },
      { rule: 'direct_user_dialogue', met: e.talksToUser, value: null, threshold: null },
      { rule: 'external_control', met: e.externalControl, value: null, threshold: null },
      { rule: 'merge_coupling', met: candidate ? candidate.coupling >= thresholds.minCoupling : null, value: candidate?.coupling ?? null, threshold: thresholds.minCoupling },
      { rule: 'merge_share', met: candidate ? candidate.share >= thresholds.minShare : null, value: candidate?.share ?? null, threshold: thresholds.minShare },
    ], counterEvidence: [...e.counterEvidence], evidenceIds: [...e.evidenceIds],
    ownerQuestions: e.skillCannotResolveConflict === null ? ['Can skills resolve the observed tool or instruction conflict?'] : [],
  };
  if (isMain) result.action = 'main';
  else if (e.talksToUser === true || e.externalControl === true) result.action = 'keep';
  else if (enough) {
    if (large === true || independent === true || e.skillCannotResolveConflict === true) result.action = 'as_tool';
    else if (merge) { result.action = 'merge'; result.mergeWith = candidate!.agentId; }
    else result.action = 'fold';
  }
  return result;
}

/** Shared inventory entry point; declarations retain their original evidence. */
export function decideFoldingInventory(project: FoldingProject, overrides: Partial<FoldingRuleThresholds> = {}): FoldingRuleDecision[] {
  const coupling = analyzeFoldingProject(project).coupling;
  return project.agents.map(agent => {
    const refs = project.evidence.filter(ref => agent.evidenceIds.includes(ref.id));
    const calls = project.traffic.filter(call => call.agentId === agent.id);
    const pair = coupling.filter(p => p.left === agent.id || p.right === agent.id).sort((a, b) => b.coupling - a.coupling || b.share - a.share)[0];
    return decideFoldingAgent({
      agentId: agent.id, sampleCount: calls.length,
      codeSupported: refs.some(ref => ref.kind === 'code'),
      traceSupported: refs.some(ref => ref.kind === 'trace'),
      inputTokens: null, returnTokens: null, filteringSuffices: null,
      parallel: agent.contextNeed === 'independent_parallel' ? true : null,
      independentVerification: agent.contextNeed === 'independent_verification' ? true : null,
      skillCannotResolveConflict: null,
      talksToUser: agent.talksToUser, externalControl: agent.externalOwner,
      mergeCandidate: pair ? { agentId: pair.left === agent.id ? pair.right : pair.left, coupling: pair.coupling, share: pair.share } : null, counterEvidence: [], evidenceIds: [...agent.evidenceIds],
    }, agent.isMain, overrides);
  });
}
