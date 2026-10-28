import { describe, expect, it } from 'vitest';
import { analyzeTeamExperiment, summarizeTeamTrial } from './team-experiment-analysis.js';
import { createTeamExperimentDemo } from './team-experiment-demo.js';
import type { TeamExperimentEvent } from './team-experiment-types.js';

describe('TEAM-EXP-003 measured coordination and quality-first guidance', () => {
  it.each([['single_wins', 'single_loop'], ['subagents_win', 'subagents'], ['team_quality', 'agent_team']] as const)('illustrates %s without claiming a real preference', (scenario, mode) => {
    const result = analyzeTeamExperiment(createTeamExperimentDemo(scenario));
    expect(result.recommendation.status).toBe('illustrative'); expect(result.recommendation.mode).toBe(mode);
    expect(result.warnings.map(w => w.code)).toContain('synthetic');
    expect(result.recommendation.reasons.some(r => r.trialIds?.length && r.eventIds?.length)).toBe(true);
    const record = result.recommendation.reasons.find(r => r.code === 'collaboration')!;
    expect(record.eventIds![0]).toBe(scenario === 'team_quality' ? 'peer-check' : scenario === 'single_wins' ? 'inspect' : 'lead-wait');
  });
  it('requires real, complete repeated evidence before making a task-scoped preference', () => {
    const report = createTeamExperimentDemo('subagents_win'); report.synthetic = false;
    const result = analyzeTeamExperiment(report);
    expect(result.recommendation.status).toBe('preference'); expect(result.recommendation.variantId).toBe('subagents');
    expect(result.groups[0]!.metrics.success.mean).toBe(100);
    report.trials = report.trials.filter(t => t.repetition < 3);
    expect(analyzeTeamExperiment(report).recommendation.status).toBe('insufficient');
  });
  it('does not treat incomplete captures, unknown models or unresolved accounting as a preference', () => {
    const report = createTeamExperimentDemo('incomplete'); report.synthetic = false;
    expect(analyzeTeamExperiment(report).recommendation.status).toBe('insufficient');
    for (const kind of ['model', 'accounting', 'roster', 'error'] as const) {
      const complete = createTeamExperimentDemo('single_wins'); complete.synthetic = false;
      const trial = complete.trials[0]!;
      if (kind === 'model') trial.run.telemetry!.actualModel = null;
      if (kind === 'accounting') trial.run.telemetry!.usage.inputIncludesCache = null;
      if (kind === 'roster') trial.evidence!.coverage.roster = false;
      if (kind === 'error') trial.evidenceError = 'capture stopped';
      expect(analyzeTeamExperiment(complete).recommendation.status).toBe('insufficient');
    }
  });
  it('reports paired baseline/variant E2E ratios, never activity-duration speedup', () => {
    const result = analyzeTeamExperiment(createTeamExperimentDemo('subagents_win'));
    const pair = result.comparisons.find(c => c.variantId === 'subagents')!;
    expect(pair.pairs).toBe(3); expect(pair.e2eRatio.n).toBe(3); expect(pair.e2eRatio.median).toBeCloseTo(100000 / 55000);
    expect(pair.tokenRatio.median).toBeCloseTo(32000 / 23000);
    expect(result.warnings.map(w => w.code)).toContain('contention');
    expect(result.warnings.find(w => w.code === 'configuration')!.en).toContain('prompt');
  });
  it('retains exact named case flips and detects aggregate/named disagreements', () => {
    const report = createTeamExperimentDemo('team_quality');
    let result = analyzeTeamExperiment(report);
    expect(result.caseFlips.find(c => c.repetition === 1 && c.leftVariantId === 'single' && c.rightVariantId === 'team' && c.caseId === 'concurrency')!.outcome).toBe('right_only');
    expect(result.caseFlips.find(c => c.repetition === 1 && c.leftVariantId === 'subagents' && c.rightVariantId === 'team' && c.caseId === 'regression')!.outcome).toBe('right_only');
    report.trials[6]!.run.verdict!.passed = 5;
    result = analyzeTeamExperiment(report);
    expect(result.caseFlips.filter(c => c.repetition === 1 && c.rightVariantId === 'team').every(c => c.outcome === 'unknown')).toBe(true);
    expect(result.groups[2]!.metrics.success.n).toBe(2); expect(result.groups[2]!.known).toBe(2);
    expect(result.recommendation.status).toBe('insufficient');
  });
  it('never recommends a failed evaluator/process even when all named cases claim passed', () => {
    const report = createTeamExperimentDemo('team_quality'); report.synthetic = false;
    for (const trial of report.trials.filter(t => t.variantId === 'team')) trial.run.status = 'failed';
    const result = analyzeTeamExperiment(report);
    expect(result.recommendation.variantId).toBeNull(); expect(result.recommendation.status).toBe('tradeoff');
    expect(result.groups[2]!.successes).toBe(0);
  });
  it('does not choose a speed/token tradeoff without a user-defined priority', () => {
    const report = createTeamExperimentDemo('subagents_win'); report.synthetic = false;
    for (const trial of report.trials.filter(t => t.variantId === 'subagents')) trial.run.telemetry!.usage.input = 100000;
    expect(analyzeTeamExperiment(report).recommendation.status).toBe('tradeoff');
  });
  it.each(['vulnerabilities', 'critical', 'major', 'complexity'] as const)('does not prefer an efficient configuration with known %s regressions', metric => {
    const report = createTeamExperimentDemo('subagents_win'); report.synthetic = false;
    for (const trial of report.trials) trial.run.verdict!.quality[metric] = trial.variantId === 'subagents' ? 2 : 0;
    const result = analyzeTeamExperiment(report);
    expect(result.recommendation.variantId).toBeNull(); expect(result.recommendation.status).toBe('tradeoff');
    expect(result.qualityRegressions.some(r => r.variantId === 'subagents' && r.metric === metric && r.value === 2 && r.otherValue === 0)).toBe(true);
    expect(result.recommendation.reasons.map(r => r.code)).toContain('quality_regression');
  });
  it('keeps missing analyzer values unknown while limiting the preference scope', () => {
    const report = createTeamExperimentDemo('single_wins'); report.synthetic = false;
    for (const trial of report.trials) trial.run.verdict!.quality.vulnerabilities = null;
    const result = analyzeTeamExperiment(report);
    expect(result.recommendation.variantId).toBe('single'); expect(result.recommendation.reasons.map(r => r.code)).toContain('quality_coverage');
    expect(result.qualityRegressions.some(r => r.metric === 'vulnerabilities')).toBe(false);
  });
  it('does not infer actual Team mode from declared labels or agent count', () => {
    const report = createTeamExperimentDemo('team_quality');
    expect(summarizeTeamTrial(report.trials[0]!).topology).toBe('single');
    expect(summarizeTeamTrial(report.trials[3]!).topology).toBe('fan_out');
    expect(summarizeTeamTrial(report.trials[6]!).topology).toBe('peer_network');
    report.trials[6]!.evidence!.coverage.communication = false;
    const partial = summarizeTeamTrial(report.trials[6]!);
    expect(partial.topology).toBe('unknown'); expect(partial.messages).toBeNull(); expect(partial.handoffs).toBeNull();
  });
  it('recognizes recorded cross-branch and cross-root peer messages without inferring Team semantics', () => {
    const trial = createTeamExperimentDemo('team_quality').trials[6]!;
    trial.evidence!.agents.push({ id: 'grandchild', name: 'Nested worker', parentId: 'api', sessionKey: null });
    const source = trial.evidence!.events.find(e => e.kind === 'message')!; source.agentId = 'grandchild'; source.targetAgentId = 'verify';
    expect(summarizeTeamTrial(trial).topology).toBe('peer_network');
    trial.evidence!.agents.find(a => a.id === 'verify')!.parentId = null;
    expect(summarizeTeamTrial(trial).topology).toBe('peer_network');
    trial.evidence!.events = [source]; source.targetAgentId = 'lead';
    expect(summarizeTeamTrial(trial).topology).toBe('unknown');
  });
  it('withholds preferences across observed hosts while preserving quality comparisons', () => {
    const report = createTeamExperimentDemo('subagents_win'); report.synthetic = false; report.trials[3]!.run.host = 'other-machine';
    const result = analyzeTeamExperiment(report);
    expect(result.recommendation.status).toBe('insufficient'); expect(result.recommendation.reasons.map(r => r.code)).toContain('hosts');
    expect(result.caseFlips.every(c => c.outcome === 'both_passed')).toBe(true); expect(result.comparisons[0]!.e2eRatio.n).toBe(3);
  });
  it.each(['extra-single-member', 'no-multi-member', 'no-child-relation'])('withholds mode guidance for a contradictory complete roster: %s', kind => {
    const report = createTeamExperimentDemo('subagents_win'); report.synthetic = false;
    if (kind === 'extra-single-member') report.trials[0]!.evidence!.agents.push({ id: 'worker', name: 'Worker', parentId: 'lead', sessionKey: null });
    if (kind === 'no-multi-member') report.trials[3]!.evidence!.agents = [report.trials[3]!.evidence!.agents[0]!];
    if (kind === 'no-child-relation') for (const a of report.trials[3]!.evidence!.agents) a.parentId = null;
    const result = analyzeTeamExperiment(report);
    expect(result.recommendation.status).toBe('insufficient'); expect(result.recommendation.reasons.map(r => r.code)).toContain('mode_contradiction');
  });
  it('unions same-agent work and wait intervals before cross-agent diagnostics', () => {
    const trial = createTeamExperimentDemo('subagents_win').trials[3]!;
    const event = (id: string, agentId: string, kind: TeamExperimentEvent['kind'], startMs: number, durationMs: number): TeamExperimentEvent => ({ id, agentId, kind, startMs, durationMs, name: id, detail: null, timing: 'measured', status: 'ok', dependsOn: [], targetAgentId: null, tokens: null, sessionKey: null, eventId: null });
    trial.evidence!.events = [event('lead', 'lead', 'model', 0, 10), event('lead-nested', 'lead', 'tool', 2, 3), event('api', 'api', 'tool', 2, 5), event('verify', 'verify', 'verification', 4, 4), event('wait-1', 'lead', 'wait', 10, 10), event('wait-2', 'lead', 'wait', 15, 10), event('wait-3', 'api', 'wait', 20, 3)];
    const summary = summarizeTeamTrial(trial);
    expect(summary.peakActiveAgents).toBe(3); expect(summary.overlapMs).toBe(6); expect(summary.waitMs).toBe(18); expect(summary.contextTokens).toBeNull();
    trial.evidence!.events[0]!.timing = 'derived';
    expect(summarizeTeamTrial(trial).overlapMs).toBeNull();
    trial.evidence!.events[4]!.durationMs = null;
    expect(summarizeTeamTrial(trial).waitMs).toBeNull();
  });
  it('keeps unrecorded context tokens unknown and prevents unsafe summed counts', () => {
    const trial = createTeamExperimentDemo('single_wins').trials[0]!;
    trial.evidence!.events = trial.evidence!.events.filter(e => e.kind !== 'context');
    expect(summarizeTeamTrial(trial).contextTokens).toBeNull();
    const source = createTeamExperimentDemo('single_wins').trials[0]!.evidence!.events[0]!;
    trial.evidence!.events.push({ ...source, id: 'a', tokens: Number.MAX_SAFE_INTEGER }, { ...source, id: 'b', tokens: 1 });
    expect(summarizeTeamTrial(trial).contextTokens).toBeNull();
    trial.evidence = null;
    const missing = summarizeTeamTrial(trial);
    expect(missing.agentCount).toBeNull(); expect(missing.waitMs).toBeNull(); expect(missing.messages).toBeNull();
  });
  it('requires a single-loop baseline and preserves missing-pair sample counts', () => {
    const report = createTeamExperimentDemo('single_wins'); report.plan.variants[0]!.mode = 'subagents';
    expect(analyzeTeamExperiment(report).comparisons).toEqual([]); expect(analyzeTeamExperiment(report).recommendation.status).toBe('insufficient');
    const partial = createTeamExperimentDemo('single_wins'); partial.trials = partial.trials.filter(t => t.id !== 'subagents-3');
    const result = analyzeTeamExperiment(partial);
    expect(result.comparisons[0]!.pairs).toBe(2); expect(result.comparisons[0]!.e2eRatio.n).toBe(2);
  });
  it('retains all 1000 named cases across 30 trials without truncating comparison evidence', () => {
    const report = createTeamExperimentDemo('single_wins'); report.plan.repetitions = 10;
    report.plan.task.caseIds = Array.from({ length: 1000 }, (_, i) => `case-${i}`); report.plan.task.expectedTests = 1000;
    report.trials = report.plan.variants.flatMap(variant => Array.from({ length: 10 }, (_, i) => {
      const t = structuredClone(report.trials.find(t => t.variantId === variant.id)!); t.id = `${variant.id}-${i + 1}`; t.repetition = i + 1; t.run.id = t.id; t.run.repetition = t.repetition;
      t.cases = report.plan.task.caseIds.map(id => ({ id, status: 'passed', detail: null })); t.run.verdict!.passed = 1000; t.run.verdict!.total = 1000;
      return t;
    }));
    const result = analyzeTeamExperiment(report);
    expect(result.caseFlips).toHaveLength(30000); expect(result.caseFlips.every(c => c.outcome === 'both_passed')).toBe(true);
    expect(result.groups.every(g => g.known === 10 && g.successes === 10)).toBe(true); expect(result.comparisons.every(c => c.pairs === 10)).toBe(true);
  });
});
