import { describe, expect, it } from 'vitest';
import { decideFoldingAgent } from './agent-folding-rules.js';
import type { FoldingRuleEvidence } from './agent-folding-types.js';
const evidence = (patch: Partial<FoldingRuleEvidence> = {}): FoldingRuleEvidence => ({ agentId: 'reviewer', sampleCount: 4, codeSupported: true, traceSupported: true,
  inputTokens: 3000, returnTokens: 1000, parallel: false, independentVerification: false, filteringSuffices: false, skillCannotResolveConflict: false,
  talksToUser: false, externalControl: false, mergeCandidate: null, counterEvidence: [], evidenceIds: ['observed'], ...patch });

describe('r4 boundary decision rules', () => {
  it('keeps the main loop and does not mistake a specialist for main', () => {
    expect(decideFoldingAgent(evidence(), true).action).toBe('main');
    expect(decideFoldingAgent(evidence()).action).toBe('fold');
    expect(decideFoldingAgent(evidence({ sampleCount: 0 })).action).toBe('insufficient');
  });
  it('defaults to fold but preserves independent review counter-evidence', () => {
    expect(decideFoldingAgent(evidence()).action).toBe('fold');
    const r = decideFoldingAgent(evidence({ independentVerification: true, counterEvidence: ['Reviewer found a missed defect despite duplicate reads.'] }));
    expect(r.action).toBe('as_tool'); expect(r.counterEvidence).toHaveLength(1);
    expect(decideFoldingAgent(evidence({ traceSupported: false, codeSupported: false })).action).toBe('insufficient');
  });
  it('requires both large input and a ratio; filtering or missing return data prevents context justification', () => {
    expect(decideFoldingAgent(evidence({ inputTokens: 30000, returnTokens: 1000 })).action).toBe('as_tool');
    expect(decideFoldingAgent(evidence({ inputTokens: 30000, returnTokens: 1000, filteringSuffices: true })).action).toBe('fold');
    const r = decideFoldingAgent(evidence({ returnTokens: null, sampleCount: 0 }));
    expect(r.action).toBe('insufficient'); expect(r.reasons.find(x => x.rule === 'input_return_ratio')?.value).toBeNull();
  });
  it('protects declared dialogue and external control, without equating a bounded tool call with keep', () => {
    expect(decideFoldingAgent(evidence({ talksToUser: true })).action).toBe('keep');
    expect(decideFoldingAgent(evidence({ externalControl: true })).action).toBe('keep');
    expect(decideFoldingAgent(evidence({ parallel: true })).action).toBe('as_tool');
    expect(decideFoldingAgent(evidence({ talksToUser: null, externalControl: null, sampleCount: 0 })).action).toBe('insufficient');
  });
  it('merges qualifying candidates, except independent reviewers, and keeps missing observations insufficient', () => {
    const mergeCandidate = { agentId: 'implementer', coupling: 0.5, share: 0.05 };
    expect(decideFoldingAgent(evidence({ mergeCandidate }))).toMatchObject({ action: 'merge', mergeWith: 'implementer' });
    expect(decideFoldingAgent(evidence({ mergeCandidate, independentVerification: true })).action).toBe('as_tool');
    expect(decideFoldingAgent(evidence({ mergeCandidate, sampleCount: 1 })).action).toBe('insufficient');
  });
  it('records configurable versioned heuristics and evidence-based confidence', () => {
    const r = decideFoldingAgent(evidence({ codeSupported: false, skillCannotResolveConflict: null }), false, { minSamples: 5, version: 'local-2' });
    expect(r).toMatchObject({ action: 'insufficient', confidence: 'medium', thresholds: { minSamples: 5, version: 'local-2' } });
    expect(r.ownerQuestions).toHaveLength(1);
    expect(decideFoldingAgent(evidence()).confidence).toBe('high');
    expect(decideFoldingAgent(evidence({ codeSupported: false, traceSupported: false })).confidence).toBe('low');
    expect(() => decideFoldingAgent(evidence(), false, { minShare: 2 })).toThrow();
  });
});
