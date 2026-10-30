import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeFoldingProject, estimateFoldingPlan } from './agent-folding-analysis.js';
import { importFoldingProject, validateFoldingProject } from './agent-folding-validation.js';
import type { FoldingProject, FoldingRunPlan, FoldingTrial } from './agent-folding-types.js';

const TIME = '2026-10-29T01:00:00.000Z';
const text = { zh: '保留核验，试折叠边界', en: 'Try folding the boundary while retaining verification' };
function fixture(): FoldingProject {
  const project: FoldingProject = {
    version: 1, kind: 'agent-folding-project', id: 'test-project', title: 'Boundary measurement fixture', createdAt: TIME,
    sources: [{ id: 'record', kind: 'live_api', title: 'Internal fixture of retained Messages records', url: null, revision: 'rev', observedAt: TIME, model: 'test-model', limitations: [] },
      { id: 'code', kind: 'source_code', title: 'Controlled graph', url: null, revision: 'graph', observedAt: TIME, model: null, limitations: [] }],
    agents: [{ id: 'main', name: 'Main', owner: 'team', isMain: true, prompt: 'Verify independently', tools: [], invokedBy: [], returns: null, talksToUser: true, externalOwner: false, contextNeed: 'none', proposed: 'main', rationale: text, evidenceIds: ['graph'] },
      { id: 'specialist', name: 'Specialist', owner: 'team', isMain: false, prompt: 'Perform focused task', tools: ['write'], invokedBy: ['main'], returns: 'result', talksToUser: false, externalOwner: false, contextNeed: 'none', proposed: 'fold', rationale: text, evidenceIds: ['graph'] }],
    boundaries: [{ id: 'fold-specialist', fromAgentId: 'main', targetAgentIds: ['specialist'], proposed: 'fold', title: text, rationale: text, requirements: [], evidenceIds: ['graph'] }],
    cases: ['train', 'confirmation'].map(id => ({ id, title: id, turns: ['Do the independent task'], customerId: id, tags: [],
      checks: [{ id: 'terminal', kind: 'external', expected: true, required: true }], requiredChains: [['main', 'specialist']],
      chainChecks: [{ chain: ['main', 'specialist'], checkId: 'terminal' }], split: id === 'train' ? 'train' : 'confirmation', evidenceIds: ['graph'] })),
    traffic: [], experiments: [{ id: 'experiment', title: 'One boundary only', boundaryId: 'fold-specialist', operation: 'fold', baselineVariantId: 'baseline', candidateVariantId: 'candidate', caseIds: ['train', 'confirmation'], expectedRepetitions: 3,
      controls: { taskSet: 'verified', grader: 'verified', model: 'same_recorded', nonTarget: 'verified', intervention: 'verified', execution: 'verified', baselineRevision: 'base', candidateRevision: 'after', skillAblation: 'not_applicable', notes: [] }, trialIds: [], evidenceIds: ['graph'] }],
    trials: [], evidence: [{ id: 'graph', sourceId: 'code', path: 'graph.json', pointer: '/agents', sha256: null, kind: 'code', excerpt: 'controlled test graph', text: null, complete: true, native: null }],
    humanDecisions: [], limitations: [],
  };
  for (const c of project.cases) for (let repetition = 0; repetition < 3; repetition += 1) for (const variant of ['baseline', 'candidate']) addTrial(project, c.id, repetition, variant);
  return project;
}
function addTrial(project: FoldingProject, caseId: string, repetition: number, variantId: string, passed = true): FoldingTrial {
  const id = `${variantId}:${caseId}:${repetition}`, gradeRef = `${id}:grade`, eventRef = `${id}:events`;
  project.evidence.push({ id: gradeRef, sourceId: 'record', path: 'retained.jsonl', pointer: `/${id}/grade`, sha256: null, kind: 'grade', excerpt: passed ? 'passed' : 'failed', text: null, complete: true, native: null },
    { id: eventRef, sourceId: 'record', path: 'retained.jsonl', pointer: `/${id}/events`, sha256: null, kind: 'trace', excerpt: 'sequence', text: null, complete: true, native: null });
  const trial: FoldingTrial = { id, experimentId: 'experiment', variantId, caseId, repetition, sourceId: 'record', grade: passed ? 1 : 0,
    checks: [{ id: 'terminal', label: 'Terminal fact', passed, evidenceId: gradeRef }], answer: 'Done', latencyMs: 100.25,
    inputTokens: 1000, outputTokens: 100, modelCalls: 2, toolCalls: 1, model: 'test-model', byAgent: {},
    actions: [{ name: 'write', args: { id: caseId, value: 'expected' }, evidenceId: eventRef }],
    events: ['main', 'specialist'].map((agentId, sequence) => ({ id: `${id}:event:${sequence}`, sequence, role: 'model', agentId, targetAgentId: null, name: null, content: null, startMs: null, durationMs: null, evidenceId: eventRef, complete: true })),
    harnessError: null, evidenceIds: [gradeRef, eventRef] };
  project.trials.push(trial); project.experiments[0]!.trialIds.push(id); return trial;
}
const plan = (): FoldingRunPlan => ({ version: 1, kind: 'agent-folding-plan', title: 'Plan', adapter: 'support-desk', provider: 'anthropic', model: 'test-model',
  boundaryId: 'fold-specialist', operation: 'fold', targetAgentIds: ['specialist'], caseIds: ['train', 'confirmation'], repetitions: 3, schedule: 'sequential',
  budgets: { maxCallsPerCase: 10, maxOutputTokens: 1000, maxInputChars: 100_000, maxTotalTokensPerCase: 20_000, timeoutMs: 10_000, maxToolBatch: 4 }, external: null });

describe('AF-003 per-boundary repeated task evaluation', () => {
  it('supports one fully controlled boundary with complete real paired reps and confirmation', () => {
    const project = fixture(), before = structuredClone(project), result = analyzeFoldingProject(project);
    expect(result.decisions[0]!.status).toBe('supported'); expect(result.experiments[0]!.status).toBe('supported');
    expect(result.experiments[0]!.candidate).toMatchObject({ passed: 6, known: 6, expected: 6, taskScore: 100 });
    expect(result.experiments[0]!.candidate.interval).toHaveLength(2);
    expect(result.experiments[0]!.coverage.every(chain => chain.trialsSuccessful === 6)).toBe(true);
    expect(result.experiments[0]!.coverage.map(chain => chain.variantId)).toEqual(['baseline', 'candidate']);
    expect(project).toEqual(before);
  });
  it('blocks any task pass-to-fail even when the overall average improves', () => {
    const project = fixture();
    project.trials.filter(trial => trial.variantId === 'baseline' && trial.caseId === 'confirmation').forEach(trial => { trial.grade = 0; trial.checks[0]!.passed = false; });
    const regression = project.trials.find(trial => trial.variantId === 'candidate' && trial.caseId === 'train' && trial.repetition === 0)!;
    regression.grade = 0; regression.checks[0]!.passed = false;
    project.humanDecisions.push({ id: 'human', boundaryId: 'fold-specialist', action: 'keep_change', note: 'I prefer it', decidedAt: null, evidenceIds: [] });
    const result = analyzeFoldingProject(project), experiment = result.experiments[0]!;
    expect(experiment.candidate.taskScore).toBeGreaterThan(experiment.baseline.taskScore!);
    expect(experiment.regressions).toHaveLength(1); expect(experiment.improvements).toHaveLength(3);
    expect(experiment.status).toBe('regression'); expect(result.decisions[0]!.status).toBe('regression');
  });
  it('keeps extra recorded repetitions within their own task and weights independent tasks equally', () => {
    const project = fixture(); project.experiments[0]!.expectedRepetitions = 2;
    project.trials = project.trials.filter(trial => trial.repetition < 2);
    project.experiments[0]!.trialIds = project.trials.map(trial => trial.id);
    project.evidence = project.evidence.filter(evidence => evidence.id === 'graph' || project.trials.some(trial => trial.evidenceIds.includes(evidence.id)));
    for (let repetition = 2; repetition < 6; repetition += 1) for (const variant of ['baseline', 'candidate']) addTrial(project, 'train', repetition, variant);
    project.trials.filter(trial => trial.caseId === 'confirmation').forEach(trial => { trial.grade = 0; trial.checks[0]!.passed = false; });
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    expect(experiment.baseline).toMatchObject({ passed: 6, known: 8, expected: 8, taskScore: 50 });
    expect(experiment.pairs.filter(pair => pair.caseId === 'train')).toHaveLength(6);
    expect(experiment.pairs.filter(pair => pair.caseId === 'confirmation')).toHaveLength(2);
    expect(experiment.status).toBe('needs_evidence');
  });
  it('keeps missing pairs and harness errors unknown in expected denominators', () => {
    const project = fixture(), removed = project.trials.find(trial => trial.variantId === 'candidate')!;
    project.trials = project.trials.filter(trial => trial.id !== removed.id); project.experiments[0]!.trialIds = project.trials.map(trial => trial.id);
    project.trials.find(trial => trial.variantId === 'baseline' && trial.repetition === 1)!.harnessError = 'timeout';
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    expect(experiment.candidate).toMatchObject({ known: 5, expected: 6, taskScore: null });
    expect(experiment.baseline).toMatchObject({ known: 5, expected: 6, taskScore: null });
    expect(experiment.pairs.filter(pair => pair.outcome === 'unknown')).toHaveLength(2);
    expect(experiment.status).toBe('needs_evidence');
  });
  it('does not union ordered chain fragments across repetitions or accept reversed order', () => {
    const project = fixture();
    project.trials.filter(trial => trial.variantId === 'candidate' && trial.caseId === 'train').forEach(trial => {
      if (trial.repetition === 0) trial.events = trial.events.slice(0, 1);
      if (trial.repetition === 1) trial.events = trial.events.slice(1);
      if (trial.repetition === 2) trial.events.reverse().forEach((event, sequence) => { event.sequence = sequence; });
    });
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    const candidateCoverage = experiment.coverage.find(chain => chain.variantId === 'candidate')!;
    expect(candidateCoverage.trialsSeen).toBe(3); expect(candidateCoverage.trialsSuccessful).toBe(3);
    expect(experiment.status).toBe('needs_evidence');
  });
  it('distinguishes observed chain occurrence from the successful assertion of its terminal fact', () => {
    const project = fixture(); delete project.cases[0]!.chainChecks;
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    expect(experiment.coverage[1]).toMatchObject({ trialsSeen: 6, trialsSuccessful: 3 });
    expect(experiment.status).toBe('needs_evidence');
  });
  it('uses only declared verified evidence-backed direct-tool chain equivalence', () => {
    const project = fixture(); project.trials.filter(trial => trial.variantId === 'candidate').forEach(trial => {
      trial.events[1]!.agentId = 'main'; trial.events[1]!.name = 'direct_write'; trial.events[1]!.role = 'tool_call';
    });
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
    project.experiments[0]!.chainMappings = [{ variantId: 'candidate', before: ['main', 'specialist'], after: ['main', 'direct_write'], verified: true, evidenceIds: ['graph'] }];
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('supported');
    project.experiments[0]!.chainMappings[0]!.verified = false;
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
  });
  it('compares full action names, order and arguments, ignoring irrelevant JSON key order', () => {
    const project = fixture(), trial = project.trials.find(trial => trial.variantId === 'candidate')!;
    trial.actions[0]!.args = { value: 'expected', id: trial.caseId };
    expect(analyzeFoldingProject(project).experiments[0]!.pairs[0]!.actionsChanged).toBe(false);
    trial.actions[0]!.args = { value: 'unexpected', id: trial.caseId };
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    expect(experiment.pairs[0]!.actionsChanged).toBe(true);
    expect(experiment.observations.some(observation => observation.title.en.includes('arguments changed'))).toBe(true);
  });
  it('keeps missing or incomplete action records unknown but uses full grade actions despite partial previews', () => {
    const project = fixture(), trial = project.trials.find(trial => trial.variantId === 'candidate')!;
    const gradeRef = project.evidence.find(evidence => evidence.id === trial.evidenceIds[0])!, actionRef = project.evidence.find(evidence => evidence.id === trial.actions[0]!.evidenceId)!;
    actionRef.complete = false;
    expect(analyzeFoldingProject(project).experiments[0]!.pairs[0]!.actionsChanged).toBe(false);
    gradeRef.complete = false;
    expect(analyzeFoldingProject(project).experiments[0]!.pairs[0]!.actionsChanged).toBeNull();
    project.trials = project.trials.filter(record => record.id !== trial.id); project.experiments[0]!.trialIds = project.trials.map(record => record.id);
    expect(analyzeFoldingProject(project).experiments[0]!.pairs[0]!.actionsChanged).toBeNull();
  });
  it.each(['taskSet', 'grader', 'nonTarget', 'intervention', 'execution'] as const)('does not promote unverified %s controls to support', control => {
    const project = fixture(); project.experiments[0]!.controls[control] = 'declared';
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
  });
  it('requires confirmation, actual model consistency, full checks and skill-off ablation', () => {
    for (const kind of ['confirmation', 'model', 'check', 'ablation', 'trace', 'grade-ref'] as const) {
      const project = fixture();
      if (kind === 'confirmation') project.cases.forEach(c => { c.split = 'train'; });
      if (kind === 'model') project.trials[0]!.model = 'other-model';
      if (kind === 'check') project.trials[0]!.checks[0]!.passed = null;
      if (kind === 'ablation') project.experiments[0]!.controls.skillAblation = 'not_run';
      if (kind === 'trace') project.trials[0]!.events[0]!.complete = false;
      if (kind === 'grade-ref') project.evidence.find(evidence => evidence.id === project.trials[0]!.evidenceIds[0])!.complete = false;
      expect(analyzeFoldingProject(project).experiments[0]!.status, kind).toBe('needs_evidence');
    }
  });
  it('protects externally owned or direct-dialogue targets and keeps missing owner facts missing', () => {
    for (const kind of ['externalOwner', 'talksToUser'] as const) {
      const project = fixture(); project.agents[1]![kind] = true;
      const decision = analyzeFoldingProject(project).decisions[0]!;
      expect(decision.status).toBe('protected'); expect(decision.action).toBe('keep');
    }
    const project = fixture(); project.experiments = []; project.trials = []; project.agents[1]!.owner = null;
    expect(analyzeFoldingProject(project).decisions[0]!.status).toBe('needs_evidence');
    project.agents[1]!.owner = 'team';
    expect(analyzeFoldingProject(project).decisions[0]!.status).toBe('candidate');
  });
  it('keeps imports user-reported and offline smoke unscored', () => {
    expect(analyzeFoldingProject(importFoldingProject(fixture())).experiments[0]!.status).toBe('needs_evidence');
    const project = fixture(); project.sources[0]!.kind = 'offline_smoke'; project.trials.forEach(trial => { trial.grade = null; trial.checks.forEach(check => { check.passed = null; }); });
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    expect(experiment.status).toBe('unscored'); expect(experiment.candidate.taskScore).toBeNull(); expect(experiment.candidate.known).toBe(0);
  });
  it('requires actual skill-off records and keeps ablation failures separate from the intervention regression gate', () => {
    const project = fixture(); project.experiments[0]!.controls.skillAblation = 'complete';
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
    project.experiments[0]!.ablationVariantId = 'skill-off';
    for (const c of project.cases) for (let repetition = 0; repetition < 3; repetition += 1) addTrial(project, c.id, repetition, 'skill-off', c.id !== 'train');
    const experiment = analyzeFoldingProject(project).experiments[0]!;
    expect(experiment.status).toBe('supported'); expect(experiment.regressions).toHaveLength(0); expect(experiment.pairs).toHaveLength(6);
    expect(experiment.ablation).toMatchObject({ variantId: 'skill-off', passed: 3, known: 6, expected: 6, taskScore: 50, regressions: 3 });
    project.trials.find(trial => trial.variantId === 'skill-off')!.checks[0]!.passed = null;
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
  });
  it('does not accept not_applicable when actual candidate skill discovery contradicts it', () => {
    const project = fixture(), trial = project.trials.find(trial => trial.variantId === 'candidate')!;
    trial.events.push({ ...trial.events[0]!, id: 'skill-event', sequence: 2, role: 'skill', name: 'load_skill' });
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
  });
  it('does not turn contradictory passing grades or unknown owners into supported boundary adoption', () => {
    const project = fixture(); project.cases[0]!.requiredChains = []; project.cases[0]!.chainChecks = [];
    project.trials.find(trial => trial.variantId === 'candidate' && trial.caseId === 'train')!.checks[0]!.passed = false;
    expect(analyzeFoldingProject(project).experiments[0]!.status).toBe('needs_evidence');
    const unknown = fixture(); unknown.agents[1]!.owner = null;
    expect(analyzeFoldingProject(unknown).decisions[0]!.status).toBe('needs_evidence');
  });
  it('computes directional same-trace adjacency from distinct traces without using timestamps or cross-trace union', () => {
    const project = fixture();
    project.traffic = [
      { traceId: 'a', sequence: 0, agentId: 'main', callerId: null, timestamp: null, durationMs: null, inputTokens: null, evidenceId: 'graph' },
      { traceId: 'a', sequence: 1, agentId: 'specialist', callerId: 'main', timestamp: null, durationMs: null, inputTokens: null, evidenceId: 'graph' },
      { traceId: 'a', sequence: 2, agentId: 'main', callerId: null, timestamp: null, durationMs: null, inputTokens: null, evidenceId: 'graph' },
      { traceId: 'a', sequence: 3, agentId: 'specialist', callerId: 'main', timestamp: null, durationMs: null, inputTokens: null, evidenceId: 'graph' },
      { traceId: 'b', sequence: 0, agentId: 'main', callerId: null, timestamp: null, durationMs: null, inputTokens: null, evidenceId: 'graph' },
      { traceId: 'c', sequence: 0, agentId: 'specialist', callerId: null, timestamp: null, durationMs: null, inputTokens: null, evidenceId: 'graph' },
    ];
    const coupling = analyzeFoldingProject(project).coupling.find(item => item.left === 'main' && item.right === 'specialist')!;
    expect(coupling.traces).toBe(1); expect(coupling.share).toBeCloseTo(1 / 3); expect(coupling.coupling).toBeCloseTo(1 / 2);
  });
  it('retains official recorded extra reps and honest historical limitations', () => {
    const project = validateFoldingProject(JSON.parse(readFileSync('data/agent-folding/support-desk-project.json', 'utf8')));
    const result = analyzeFoldingProject(project);
    expect(result.experiments).toHaveLength(2);
    expect(result.experiments.find(experiment => experiment.experimentId === 'returns-fold')!.pairs).toHaveLength(24);
    const diagnostics = result.experiments.find(experiment => experiment.experimentId === 'diagnostics-as-tool')!;
    expect(diagnostics.pairs).toHaveLength(42);
    expect(diagnostics.pairs.filter(pair => pair.caseId === 't01')).toHaveLength(6);
    expect(result.experiments.every(experiment => experiment.status !== 'supported')).toBe(true);
    expect(diagnostics.regressions.length).toBeGreaterThan(0);
  });
});

describe('AF-004 explicit bounded planning estimates', () => {
  it('uses measured baseline task means and includes both variants without adding nested totals twice', () => {
    const project = fixture(); project.trials.forEach(trial => { trial.byAgent = { specialist: { calls: 100, inputTokens: 999_999, outputTokens: 999_999 } }; });
    const estimate = estimateFoldingPlan(plan(), project);
    expect(estimate).toMatchObject({ cases: 2, repetitions: 3, variants: 2, modelCalls: 24, inputTokens: 12_000, outputTokens: 1200, basis: 'measured_baseline' });
    expect(estimate.limitations.join(' ')).toContain('cannot guarantee an exact maximum bill');
  });
  it('keeps missing or wrong-model baselines unknown instead of returning zero estimates', () => {
    expect(estimateFoldingPlan(plan())).toMatchObject({ inputTokens: null, outputTokens: null, modelCalls: null, basis: 'unknown' });
    const project = fixture(); project.trials.filter(trial => trial.variantId === 'baseline').forEach(trial => { trial.model = 'different'; });
    expect(estimateFoldingPlan(plan(), project).basis).toBe('unknown');
  });
  it('includes an explicitly planned third skill-off variant in the measured-baseline estimate', () => {
    const value = plan(); value.skillAblation = true;
    expect(estimateFoldingPlan(value, fixture())).toMatchObject({ variants: 3, modelCalls: 36, inputTokens: 18_000, outputTokens: 1800 });
  });
});
