import { describe, expect, it } from 'vitest';
import { loadFoldingExample, loadSupportDeskFixture, SINGLE_LOOP_KIT_REVISION, toFoldingPlanDefault } from './catalog.js';
import { analyzeFoldingProject } from '../../src/core/agent-folding-analysis.js';
import { importFoldingProject } from '../../src/core/agent-folding-validation.js';

describe('pinned single-agent-loop-kit catalog', () => {
  it('loads licensed real recorded experiments with distinct identities and every supplemental repetition', async () => {
    const project = await loadFoldingExample();
    expect(SINGLE_LOOP_KIT_REVISION).toBe('c43796287b83bec847db923f07131d1cc8de750d');
    expect(project.trials).toHaveLength(132); expect(project.cases).toHaveLength(19);
    const returns = project.trials.filter(trial => trial.experimentId === 'returns-fold');
    expect(returns.filter(trial => trial.variantId === 'baseline' && trial.grade === 1)).toHaveLength(22);
    expect(returns.filter(trial => trial.variantId === 'folded' && trial.grade === 1)).toHaveLength(23);
    const diagnostic = project.trials.filter(trial => trial.experimentId === 'diagnostics-as-tool');
    for (const variant of ['baseline', 'as-tool']) for (const caseId of ['t01', 't10']) {
      expect(diagnostic.filter(trial => trial.variantId === variant && trial.caseId === caseId).map(trial => trial.repetition).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    }
    expect(project.sources.find(source => source.id === 'generated-traffic')?.kind).toBe('synthetic_traffic');
    expect(project.traffic).toHaveLength(322); expect(new Set(project.traffic.map(call => call.traceId)).size).toBe(200);
    expect(project.humanDecisions[0]?.decidedAt).toBeNull();
    expect(project.evidence.every(ref => ref.sha256 !== null)).toBe(true);
  });
  it('blocks the observed neighbor regression despite the higher overall returns-fold score', async () => {
    const project = await loadFoldingExample(), analysis = analyzeFoldingProject(project);
    const fold = analysis.experiments.find(value => value.experimentId === 'returns-fold')!;
    expect(fold.status).toBe('regression');
    expect(fold.regressions).toEqual(expect.arrayContaining([expect.objectContaining({ caseId: 't01', repetition: 1 })]));
    const failed = project.trials.find(trial => trial.id === fold.regressions.find(pair => pair.caseId === 't01')!.candidateTrialId)!;
    expect(failed.events.filter(event => event.role === 'tool_call').map(event => event.name)).toEqual(['router.get_order']);
    expect(failed.checks.some(check => check.passed === false && check.label.includes('2026-10-03'))).toBe(true);
    expect(project.sources.filter(source => source.kind === 'official_recording')).toHaveLength(2);
    const imported = importFoldingProject(project); expect(imported.sources.every(source => source.kind === 'user_import')).toBe(true);
  });
  it('provides actual pinned tool schemas, deterministic device log and explicit unscored default plan', async () => {
    const fixture = await loadSupportDeskFixture(), plan = toFoldingPlanDefault();
    expect(fixture.toolsByAgent.orders?.some(tool => tool.name === 'get_order')).toBe(true);
    expect(fixture.deviceLogs['SN-VAC-3391']?.match(/ERR {2}E42/g)).toHaveLength(5);
    expect(plan).toMatchObject({ provider: 'fixture', model: null, boundaryId: 'returns', operation: 'fold', repetitions: 2 });
    expect(plan.caseIds).toHaveLength(19); plan.targetAgentIds.push('changed'); expect(toFoldingPlanDefault().targetAgentIds).toEqual(['returns']);
  });
});
