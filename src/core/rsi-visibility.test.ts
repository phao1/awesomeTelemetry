import { describe, expect, it } from 'vitest';
import { projectTaskForOptimizer, projectIterationForOptimizer, projectEvaluationForOptimizer, projectRunForOptimizer,
  projectFindingForOptimizer, projectDecisionForOptimizer, projectInstructionForOptimizer } from './rsi-visibility.js';
import { defaultRsiConfig } from './rsi-validation.js';

const poison = { raw: 'SECRET', hiddenTests: 'SECRET', assertions: 'SECRET', monitorText: 'SECRET', sealedScore: 99,
  questionIds: ['SEALED_QUESTION'], taskTokenHash: 'SECRET', artifactPath: '/private/SECRET', unexpected: { nested: 'SECRET' } };
describe('RSI optimizer projection allowlists', () => {
  it('sealed exposes only accept/reject; final exposes absolutely nothing', () => {
    expect(projectEvaluationForOptimizer({ ...poison, phase: 'sealed', id: 'SECRET', state: 'completed', infraErrorRatio: 0, score: 99, passedCounts: [99], sealedVerdict: 'accept' })).toEqual({ verdict: 'accept' });
    expect(projectEvaluationForOptimizer({ ...poison, phase: 'sealed', sealedVerdict: null })).toBeNull();
    expect(projectEvaluationForOptimizer({ ...poison, phase: 'final', state: 'completed', score: 99 })).toBeNull();
    expect(projectEvaluationForOptimizer({ phase: 'sealed', state: 'completed', infraErrorRatio: .1, score: null, sealedVerdict: 'accept' })).toBeNull();
  });
  it.each(['smoke', 'train'])('%s exposes safe structured results but no log/test/assertion bodies', phase => {
    expect(projectEvaluationForOptimizer({ ...poison, id: 'e', phase, state: 'completed', repetitions: 1, passedCounts: [3], score: 3, infraErrorRatio: 0 })).toEqual({ id: 'e', phase, state: 'completed', repetitions: 1, passedCounts: [3], score: 3, infraErrorRatio: 0 });
  });
  it.each(['adversarial', 'ablation'])('%s exposes phase and state only', phase => {
    expect(projectEvaluationForOptimizer({ ...poison, phase, state: 'completed', score: 20 })).toEqual({ phase, state: 'completed' });
  });
  it('task strips hashes, sealed scores, paths and nested private configuration', () => {
    const projected = projectTaskForOptimizer({ ...poison, id: 't', state: 'running', mainMetric: 'passed_count', delta: 0,
      baselineTrainScore: 4, sealedQueriesUsed: 2, config: { ...defaultRsiConfig(), secret: 'SECRET' } });
    expect(projected?.sealedQueriesRemaining).toBe(8);
    expect(JSON.stringify(projected)).not.toMatch(/SECRET|sealedScore|questionIds|taskTokenHash|l1/);
  });
  it('iteration recursively filters PRD and hold categories', () => {
    const result = projectIterationForOptimizer({ ...poison, id: 'i', seq: 1, state: 'held', trainScore: 3,
      prd: { observation: 'mine', hypothesis: 'general', changes: ['src/a.ts', { hiddenTests: 'SECRET' }], expectedImpact: 'more pass', ...poison },
      holdReasons: ['l4_suspicious', 'SECRET'], approvals: [{ reason: 'SECRET' }] });
    expect(result).toEqual({ id: 'i', seq: 1, state: 'held', trainScore: 3, prd: { observation: 'mine', hypothesis: 'general', changes: ['src/a.ts'], expectedImpact: 'more pass' }, holdReasons: ['l4_suspicious'] });
  });
  it.each(['sealed', 'final', 'adversarial', 'ablation'] as const)('%s hides every single-run field', phase => {
    expect(projectRunForOptimizer({ ...poison, outcome: 'pass', questionId: 'SECRET' }, phase)).toBeNull();
  });
  it('train run retains timing and proxy tokens but removes hidden outputs and paths', () => {
    expect(projectRunForOptimizer({ ...poison, id: 'r', questionId: 'public', outcome: 'fail', durationMs: 42, proxyTokens: 8, outputSummary: 'SECRET' }, 'train'))
      .toEqual({ id: 'r', questionId: 'public', outcome: 'fail', durationMs: 42, proxyTokens: 8 });
  });
  it.each(['L3', 'L4'])('%s monitor exposes held and category without original prose', level => {
    expect(projectFindingForOptimizer({ ...poison, level, category: 'suspicious', severity: 'hold', evidence: 'SECRET', line: 3 })).toEqual({ held: true, category: 'suspicious' });
    expect(projectFindingForOptimizer({ level, category: 'suspicious', severity: 'info' })).toBeNull();
  });
  it('findings/decisions cannot reveal fingerprint text or sealed differences', () => {
    expect(projectFindingForOptimizer({ ...poison, level: 'L1', category: 'task_fingerprint', severity: 'reject', evidence: 'SECRET' })).toEqual({ category: 'task_fingerprint', severity: 'reject' });
    expect(projectFindingForOptimizer({ level: 'L2', category: 'suspicious' })).toBeNull();
    expect(projectDecisionForOptimizer({ ...poison, verdict: 'reject', reason: 'sealed missed SECRET by 4' })).toEqual({ verdict: 'reject' });
  });
  it('keeps authorized instruction fields and drops unknown fields', () => {
    expect(projectInstructionForOptimizer({ ...poison, id: 'x', kind: 'idea', text: 'Use a generic parser', effectiveFromSeq: 2 })).toEqual({ id: 'x', kind: 'idea', text: 'Use a generic parser', effectiveFromSeq: 2 });
  });
  it('fails closed on unknown discriminators and nonprimitive whitelist injections', () => {
    expect(projectEvaluationForOptimizer({ phase: 'future', score: 99 })).toBeNull();
    expect(projectEvaluationForOptimizer({ phase: 'train', score: { secret: true } })).toEqual({ phase: 'train' });
    expect(projectFindingForOptimizer({ level: 'L4', category: 'SECRET', severity: 'hold' })).toBeNull();
  });
});
