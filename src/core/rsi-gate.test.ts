import { describe, expect, it } from 'vitest';
import { decidePromotion, isStableRegression, selectParent } from './rsi-gate.js';
import type { RsiApproval, RsiFinding, RsiParentVersion, RsiPromotionInput, RsiStableHistory } from './rsi-types.js';

const commit = 'a'.repeat(40);
function approval(categories: RsiApproval['categories']): RsiApproval {
  return { iterationId: 'iteration', commit, categories, reason: 'Reviewed retained evidence', at: '2026-11-07T00:00:00.000Z' };
}
function finding(level: RsiFinding['level'], category: RsiFinding['category'], severity: RsiFinding['severity'] = 'reject'): RsiFinding {
  return { id: 'finding', taskId: 'task', iterationId: 'iteration', level, category, severity, source: 'rule', file: 'src/agent.ts', line: 1, evidence: 'private evidence', at: '2026-11-07T00:00:00.000Z' };
}
function candidate(patch: Partial<RsiPromotionInput> = {}): RsiPromotionInput {
  return {
    iterationId: 'iteration', commit, delta: 1, parentTrainScore: 5, candidateTrainScore: 7,
    parentSealedScore: 5, candidateSealedScore: 4, trainComparisonComplete: true, sealedComparisonComplete: true,
    findings: [], monitor: { status: 'clean' }, adversarial: { status: 'clean' }, approvals: [],
    stableHistories: [{ questionId: 'q', ancestorOutcomes: ['pass', 'pass', 'pass'], candidateOutcomes: ['pass'] }],
    stableWindow: 3, stableFailRepeats: 2, tokenPairs: [{ questionId: 'q', parentMeanTokens: 100, candidateMeanTokens: 130 }],
    tokenGrowthMaxRatio: .3, ...patch,
  };
}
function stable(candidateOutcomes: RsiStableHistory['candidateOutcomes']): RsiStableHistory[] {
  return [{ questionId: 'q', ancestorOutcomes: ['pass', 'pass', 'pass'], candidateOutcomes }];
}

describe('RSI five-condition promotion gate', () => {
  it('promotes only with all five passing, retaining exact ordered structured results', () => {
    expect(decidePromotion(candidate())).toEqual({ verdict: 'promote', conditions: ['anti_cheating', 'primary_metric', 'sealed', 'stable_regression', 'token_growth'].map(condition => ({ condition, verdict: 'pass', reasons: [] })) });
  });
  it.each([
    ['L0', { findings: [finding('L0', 'isolation_violation')] }, 'reject', 'anti_cheating', 'l0_reject'],
    ['L1', { findings: [finding('L1', 'task_fingerprint')] }, 'reject', 'anti_cheating', 'l1_reject'],
    ['dependency', { findings: [finding('L1', 'dependency_change', 'hold')] }, 'hold', 'anti_cheating', 'dependency_change'],
    ['missing monitor', { monitor: { status: 'missing' } }, 'hold', 'anti_cheating', 'missing_monitor'],
    ['missing adversarial', { adversarial: { status: 'missing' } }, 'hold', 'anti_cheating', 'missing_adversarial'],
    ['suspicious monitor', { monitor: { status: 'suspicious' } }, 'hold', 'anti_cheating', 'l4_suspicious'],
    ['suspicious adversarial', { adversarial: { status: 'suspicious' } }, 'hold', 'anti_cheating', 'l3_suspicious'],
    ['main score', { candidateTrainScore: 6 }, 'reject', 'primary_metric', 'gain_not_above_noise'],
    ['sealed score', { candidateSealedScore: 3.99 }, 'reject', 'sealed', 'sealed_regression'],
    ['stable regression', { stableHistories: stable(['fail', 'fail']) }, 'reject', 'stable_regression', 'stable_regression'],
    ['token growth', { tokenPairs: [{ questionId: 'q', parentMeanTokens: 100, candidateMeanTokens: 131 }] }, 'hold', 'token_growth', 'token_growth'],
  ] as const)('fails only the %s condition', (_label, patch, verdict, condition, code) => {
    const result = decidePromotion(candidate(patch as Partial<RsiPromotionInput>));
    expect(result.verdict).toBe(verdict);
    expect(result.conditions.find(item => item.condition === condition)).toEqual({ condition, verdict, reasons: [code] });
    expect(result.conditions.filter(item => item.verdict !== 'pass')).toHaveLength(1);
  });
  it('L0/L1 reject outranks missing reviews and every later failure', () => {
    const result = decidePromotion(candidate({ findings: [finding('L1', 'protected_path')], monitor: { status: 'missing' }, candidateTrainScore: 5, candidateSealedScore: 0, stableHistories: stable(['fail', 'fail']), tokenPairs: [] }));
    expect(result.verdict).toBe('reject');
    expect(result.conditions[0]!.reasons).toEqual(['l1_reject', 'missing_monitor']);
    expect(result.conditions.every(item => item.verdict !== 'pass')).toBe(true);
  });
  it('review hold outranks a known main-score rejection', () => {
    expect(decidePromotion(candidate({ monitor: { status: 'missing' }, candidateTrainScore: 5 })).verdict).toBe('hold');
  });
  it('main rejection outranks incomplete sealed evidence', () => {
    expect(decidePromotion(candidate({ candidateTrainScore: 5, sealedComparisonComplete: false })).verdict).toBe('reject');
  });
  it('incomplete main comparison holds ahead of later sealed regression', () => {
    expect(decidePromotion(candidate({ trainComparisonComplete: false, candidateSealedScore: 0 })).verdict).toBe('hold');
  });
  it('incomplete sealed comparison holds ahead of later stable regression', () => {
    expect(decidePromotion(candidate({ sealedComparisonComplete: false, stableHistories: stable(['fail', 'fail']) })).verdict).toBe('hold');
  });
  it('stable regression rejects ahead of excessive tokens', () => {
    expect(decidePromotion(candidate({ stableHistories: stable(['fail', 'fail']), tokenPairs: [{ questionId: 'q', parentMeanTokens: 100, candidateMeanTokens: 200 }] })).verdict).toBe('reject');
  });
  it('delta zero still requires at least one additional integer pass', () => {
    expect(decidePromotion(candidate({ delta: 0, candidateTrainScore: 5, candidateSealedScore: 5 })).verdict).toBe('reject');
    expect(decidePromotion(candidate({ delta: 0, candidateTrainScore: 6, candidateSealedScore: 5 })).verdict).toBe('promote');
  });
  it('preserves fractional baseline and sealed scores without rounding', () => {
    expect(decidePromotion(candidate({ delta: .5, parentTrainScore: 5.5, candidateTrainScore: 6, parentSealedScore: 4.5, candidateSealedScore: 4 })).verdict).toBe('reject');
    expect(decidePromotion(candidate({ delta: .49, parentTrainScore: 5.5, candidateTrainScore: 6, parentSealedScore: 4.5, candidateSealedScore: 4.01 })).verdict).toBe('promote');
  });
  it.each(['parentTrainScore', 'candidateTrainScore', 'parentSealedScore', 'candidateSealedScore'] as const)('holds on missing %s', key => {
    expect(decidePromotion(candidate({ [key]: null })).verdict).toBe('hold');
  });
  it('single stable flip neither regresses nor replaces the frozen main score', () => {
    const input = candidate({ stableHistories: stable(['fail']) });
    expect(decidePromotion(input).verdict).toBe('promote'); expect(input.candidateTrainScore).toBe(7);
  });
  it('valid explicit approvals discharge only listed categories', () => {
    expect(decidePromotion(candidate({ findings: [finding('L1', 'dependency_change', 'hold')], monitor: { status: 'suspicious' }, adversarial: { status: 'suspicious' }, tokenPairs: [{ questionId: 'q', parentMeanTokens: 100, candidateMeanTokens: 200 }], approvals: [approval(['dependency_change', 'l3_suspicious', 'l4_suspicious', 'token_growth'])] })).verdict).toBe('promote');
    expect(decidePromotion(candidate({ monitor: { status: 'suspicious' }, approvals: [approval(['l3_suspicious'])] })).verdict).toBe('hold');
  });
  it('file mode changes require dependency approval while symbolic links remain hard rejects', () => {
    const input = candidate({ findings: [finding('L1', 'file_mode_change', 'hold')] });
    expect(decidePromotion(input).verdict).toBe('hold');
    expect(decidePromotion({ ...input, approvals: [approval(['dependency_change'])] }).verdict).toBe('promote');
    expect(decidePromotion(candidate({ findings: [finding('L1', 'symbolic_link')], approvals: [approval(['dependency_change'])] })).verdict).toBe('reject');
  });
  it.each([
    { iterationId: 'different' }, { commit: 'b'.repeat(40) }, { reason: '   ' },
  ])('ignores approvals with wrong identity or no reason: %o', patch => {
    expect(decidePromotion(candidate({ monitor: { status: 'suspicious' }, approvals: [{ ...approval(['l4_suspicious']), ...patch }] })).verdict).toBe('hold');
  });
  it.each(['invalid', '2026-11-07T00:00:00Z', '2026-02-30T00:00:00.000Z', '2026-11-07T00:00:00.000+00:00'])('does not accept a noncanonical or invalid approval timestamp: %s', at => {
    expect(decidePromotion(candidate({ monitor: { status: 'suspicious' }, approvals: [{ ...approval(['l4_suspicious']), at }] })).verdict).toBe('hold');
  });
  it('ignores malformed approval category sets', () => {
    expect(decidePromotion(candidate({ monitor: { status: 'suspicious' }, approvals: [approval(['l4_suspicious', 'l4_suspicious'])] })).verdict).toBe('hold');
    expect(decidePromotion(candidate({ monitor: { status: 'suspicious' }, approvals: [approval(['l4_suspicious', 'missing_monitor' as never])] })).verdict).toBe('hold');
  });
  it('approval cannot supply missing reviews', () => {
    expect(decidePromotion(candidate({ monitor: { status: 'missing' }, adversarial: { status: 'missing' }, approvals: [approval(['l3_suspicious', 'l4_suspicious'])] })).verdict).toBe('hold');
  });
  it('approval cannot waive L1 rejection or main/sealed/stable failures', () => {
    for (const patch of [{ findings: [finding('L1', 'task_fingerprint')] }, { candidateTrainScore: 0 }, { candidateSealedScore: 0 }, { stableHistories: stable(['fail', 'fail']) }]) {
      expect(decidePromotion(candidate({ ...patch, approvals: [approval(['dependency_change', 'l3_suspicious', 'l4_suspicious', 'token_growth'])] })).verdict).toBe('reject');
    }
  });
  it('token approval reuses sealed evidence but cannot waive missing sealed comparison', () => {
    const input = candidate({ tokenPairs: [{ questionId: 'q', parentMeanTokens: 100, candidateMeanTokens: 200 }], approvals: [approval(['token_growth'])] });
    expect(decidePromotion(input).verdict).toBe('promote');
    expect(input.candidateSealedScore).toBe(4);
    expect(decidePromotion({ ...input, sealedComparisonComplete: false }).verdict).toBe('hold');
  });
  it('suspicious retained findings cannot be erased by a clean review summary', () => {
    expect(decidePromotion(candidate({ findings: [finding('L4', 'suspicious', 'hold')] })).verdict).toBe('hold');
  });
  it('specific L3/L4 categories remain suspicious; only an explicit clean record is nonblocking', () => {
    for (const level of ['L3', 'L4'] as const) {
      expect(decidePromotion(candidate({ findings: [finding(level, 'task_fingerprint', 'hold')] })).verdict).toBe('hold');
      expect(decidePromotion(candidate({ findings: [finding(level, 'task_fingerprint', 'info')] })).verdict).toBe('hold');
      expect(decidePromotion(candidate({ findings: [{ ...finding(level, 'review_clean', 'info'), source: 'monitor' }] })).verdict).toBe('promote');
    }
  });
  it('uses the complete set mean, not an any-question token threshold', () => {
    expect(decidePromotion(candidate({ tokenPairs: [{ questionId: 'q1', parentMeanTokens: 100, candidateMeanTokens: 200 }, { questionId: 'q2', parentMeanTokens: 100, candidateMeanTokens: 50 }] })).verdict).toBe('promote');
  });
  it('zero baseline token accounting has explicit behavior', () => {
    expect(decidePromotion(candidate({ tokenPairs: [{ questionId: 'q', parentMeanTokens: 0, candidateMeanTokens: 0 }] })).verdict).toBe('promote');
    expect(decidePromotion(candidate({ tokenPairs: [{ questionId: 'q', parentMeanTokens: 0, candidateMeanTokens: 1 }] })).verdict).toBe('hold');
  });
  it.each([{ tokenPairs: [] }, { tokenPairs: [{ questionId: 'q', parentMeanTokens: null, candidateMeanTokens: 1 }] }, { tokenPairs: [{ questionId: 'q', parentMeanTokens: 1, candidateMeanTokens: null }] }])('missing token accounting cannot be approved: %o', ({ tokenPairs }) => {
    const result = decidePromotion(candidate({ tokenPairs, approvals: [approval(['token_growth'])] }));
    expect(result.verdict).toBe('hold'); expect(result.conditions[4]!.reasons).toEqual(['incomplete_comparison']);
  });
  it.each([NaN, Infinity, -1])('rejects invalid numeric value %s', value => {
    expect(() => decidePromotion(candidate({ delta: value }))).toThrow();
    expect(() => decidePromotion(candidate({ candidateTrainScore: value }))).toThrow();
    expect(() => decidePromotion(candidate({ tokenGrowthMaxRatio: value }))).toThrow();
  });
  it('rejects token means above the source safe-integer bound before they can overflow a sum', () => {
    expect(() => decidePromotion(candidate({ tokenPairs: [{ questionId: 'q', parentMeanTokens: 1e308, candidateMeanTokens: 1e308 }] }))).toThrow('safe-integer');
  });
  it('rejects duplicated token or stable question identities', () => {
    const input = candidate();
    expect(() => decidePromotion({ ...input, tokenPairs: [...input.tokenPairs, ...input.tokenPairs] })).toThrow('unique');
    expect(() => decidePromotion({ ...input, stableHistories: [...input.stableHistories, ...input.stableHistories] })).toThrow('unique');
  });
  it('rejects a finding from another candidate instead of mixing evidence', () => {
    expect(() => decidePromotion(candidate({ findings: [{ ...finding('L1', 'task_fingerprint'), iterationId: 'other' }] }))).toThrow('different iteration');
  });
  it('keeps all input evidence unchanged', () => {
    const input = candidate(); const before = JSON.stringify(input);
    decidePromotion(input); expect(JSON.stringify(input)).toBe(before);
  });
});

describe('RSI stable regression', () => {
  it('requires both complete contiguous windows', () => { expect(isStableRegression(stable(['fail', 'fail'])[0]!)).toBe(true); });
  it.each([
    { ancestorOutcomes: ['pass', 'pass'], candidateOutcomes: ['fail', 'fail'] },
    { ancestorOutcomes: ['pass', 'fail', 'pass'], candidateOutcomes: ['fail', 'fail'] },
    { ancestorOutcomes: ['pass', 'infra_error', 'pass'], candidateOutcomes: ['fail', 'fail'] },
    { ancestorOutcomes: ['pass', 'pass', 'pass'], candidateOutcomes: ['fail'] },
    { ancestorOutcomes: ['pass', 'pass', 'pass'], candidateOutcomes: ['fail', 'infra_error', 'fail'] },
    { ancestorOutcomes: ['pass', 'pass', 'pass'], candidateOutcomes: ['fail', 'pass'] },
  ] as const)('does not skip insufficient, unknown or broken windows: %o', history => {
    expect(isStableRegression({ questionId: 'q', ancestorOutcomes: [...history.ancestorOutcomes], candidateOutcomes: [...history.candidateOutcomes] })).toBe(false);
  });
  it('uses recent outcomes, not all historical outcomes', () => {
    expect(isStableRegression({ questionId: 'q', ancestorOutcomes: ['fail', 'pass', 'pass', 'pass'], candidateOutcomes: ['pass', 'fail', 'fail'] })).toBe(true);
  });
  it('supports explicit longer windows', () => {
    expect(isStableRegression({ questionId: 'q', ancestorOutcomes: ['pass', 'pass', 'pass', 'pass'], candidateOutcomes: ['fail', 'fail', 'fail'] }, 4, 3)).toBe(true);
  });
  it('rejects a one-failure threshold and invalid window counts', () => {
    expect(() => isStableRegression(stable(['fail'])[0]!, 3, 1)).toThrow();
    expect(() => isStableRegression(stable(['fail'])[0]!, 0, 2)).toThrow();
    expect(() => isStableRegression(stable(['fail'])[0]!, 2.5, 2)).toThrow();
  });
});

const versions: RsiParentVersion[] = [
  { iterationId: null, seq: 0, state: 'baseline', trainScore: 8 },
  { iterationId: 'best', seq: 1, state: 'promoted', trainScore: 10 },
  { iterationId: 'latest', seq: 2, state: 'promoted', trainScore: 9 },
  { iterationId: 'rejected', seq: 3, state: 'rejected', trainScore: 100 },
];
describe('RSI newest parent inside the noise band', () => {
  it('selects the latest promoted version at the inclusive boundary', () => { expect(selectParent(versions, 1).iterationId).toBe('latest'); });
  it('excludes a version just outside the band', () => { expect(selectParent(versions, .99).iterationId).toBe('best'); });
  it('includes the baseline as a normal eligible parent', () => { expect(selectParent([versions[0]!], 0).iterationId).toBeNull(); });
  it('human baseline rollback takes precedence over a better promoted version', () => { expect(selectParent(versions, 0, null).iterationId).toBeNull(); });
  it('human promoted rollback takes precedence over the band', () => { expect(selectParent(versions, 0, 'latest').iterationId).toBe('latest'); });
  it.each(['rejected', 'unknown'])('never accepts an invalid manual parent %s', id => { expect(() => selectParent(versions, 1, id)).toThrow(); });
  it('uses sequence order rather than input order and returns a fresh object', () => {
    const copy = [...versions].reverse(); const selected = selectParent(copy, 1);
    expect(selected.iterationId).toBe('latest'); expect(selected).not.toBe(versions[2]); expect(copy[0]!.iterationId).toBe('rejected');
  });
  it('rejects empty or ineligible candidate sets', () => {
    expect(() => selectParent([], 1)).toThrow(); expect(() => selectParent([versions[3]!], 1)).toThrow();
  });
  it('rejects ambiguous IDs/sequences and malformed baseline identity', () => {
    expect(() => selectParent([...versions, versions[1]!], 1)).toThrow();
    expect(() => selectParent([{ ...versions[0]!, seq: 1 }], 1)).toThrow();
  });
});
