import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FOLDING_MAX_BYTES, importFoldingProject, validateFoldingProject, validateFoldingRunPlan } from './agent-folding-validation.js';
import type { FoldingProject, FoldingRunPlan } from './agent-folding-types.js';

const official = (): FoldingProject => JSON.parse(readFileSync('data/agent-folding/support-desk-project.json', 'utf8')) as FoldingProject;
const plan = (): FoldingRunPlan => ({ version: 1, kind: 'agent-folding-plan', title: 'Explicit boundary plan', adapter: 'support-desk', provider: 'fixture', model: null,
  boundaryId: 'fold-returns', operation: 'fold', targetAgentIds: ['returns'], caseIds: ['t01'], repetitions: 3, schedule: 'sequential',
  budgets: { maxCallsPerCase: 10, maxOutputTokens: 1000, maxInputChars: 100_000, maxTotalTokensPerCase: 20_000, timeoutMs: 5000, maxToolBatch: 4 }, external: null });

describe('AF-001/005 strict portable project validation', () => {
  it('validates the actual pinned published records, preserving extra repetitions and unknown times', () => {
    const project = official(), before = structuredClone(project), validated = validateFoldingProject(project);
    expect(validated.trials).toHaveLength(132); expect(validated.evidence.length).toBeLessThanOrEqual(2000);
    expect(validated.humanDecisions.some(decision => decision.decidedAt === null)).toBe(true);
    expect(validated.trials.some(trial => trial.repetition === 0)).toBe(true);
    expect(validated.trials.some(trial => trial.repetition === 5)).toBe(true);
    expect(project).toEqual(before);
  });
  it('forces imported source claims to user_import and strips unverified native locators and verified controls', () => {
    const project = official(); project.evidence[0]!.native = { taskId: 'invented', sessionKey: 'fake-session', eventId: 'fake-event', captureId: null, callSequence: null };
    const imported = importFoldingProject(project);
    expect(imported.sources.every(source => source.kind === 'user_import')).toBe(true);
    expect(imported.evidence.every(evidence => evidence.native === null)).toBe(true);
    expect(imported.experiments.every(experiment => experiment.controls.taskSet !== 'verified')).toBe(true);
    expect(imported.sources[0]!.limitations.join(' ')).toContain('original claimed kind: official_recording');
    expect(project.sources[0]!.kind).toBe('official_recording'); expect(project.evidence[0]!.native).not.toBeNull();
  });
  it.each(['unknown-field', 'duplicate-source', 'duplicate-trial-tuple', 'bad-ref', 'cross-experiment', 'variant', 'negative-rep', 'main-target', 'second-main', 'wrong-chain-check', 'no-required-check'] as const)('rejects malformed or ambiguous project %s', kind => {
    const project = official();
    if (kind === 'unknown-field') Object.assign(project, { execute: true });
    if (kind === 'duplicate-source') project.sources.push({ ...project.sources[0]! });
    if (kind === 'duplicate-trial-tuple') { const duplicate = { ...project.trials[0]!, id: 'another-id' }; project.trials.push(duplicate); project.experiments.find(experiment => experiment.id === duplicate.experimentId)!.trialIds.push(duplicate.id); }
    if (kind === 'bad-ref') project.agents[0]!.evidenceIds = ['does-not-exist'];
    if (kind === 'cross-experiment') project.trials[0]!.experimentId = project.experiments[1]!.id;
    if (kind === 'variant') project.trials[0]!.variantId = 'unrelated-v1';
    if (kind === 'negative-rep') project.trials[0]!.repetition = -1;
    if (kind === 'main-target') project.boundaries[0]!.targetAgentIds = [project.agents.find(agent => agent.isMain)!.id];
    if (kind === 'second-main') project.agents[1]!.isMain = true;
    if (kind === 'wrong-chain-check') project.cases[0]!.chainChecks = [{ chain: ['invented'], checkId: 'invented' }];
    if (kind === 'no-required-check') project.cases[0]!.checks.forEach(check => { check.required = false; });
    expect(() => validateFoldingProject(project)).toThrow('Invalid agent folding');
  });
  it('never accepts a grade or check score for offline smoke or synthetic traffic', () => {
    const project = official(); project.sources.find(source => source.id === project.trials[0]!.sourceId)!.kind = 'offline_smoke';
    expect(() => validateFoldingProject(project)).toThrow('offline/synthetic grading');
  });
  it('keeps historic unknown recorded roles without inventing an audited owner', () => {
    const project = official(), trial = project.trials[0]!;
    trial.events[0]!.agentId = 'unknown-recorded-role'; trial.byAgent['unknown-recorded-role'] = { calls: 1, inputTokens: 10, outputTokens: 1 };
    const result = validateFoldingProject(project);
    expect(result.agents.some(agent => agent.id === 'unknown-recorded-role')).toBe(false);
    expect(result.trials[0]!.byAgent['unknown-recorded-role']!.calls).toBe(1);
  });
  it('accepts measured fractional milliseconds while rejecting fractional token counts', () => {
    const project = official(); project.trials[0]!.latencyMs = 1.25; project.trials[0]!.events[0]!.startMs = 0.05;
    expect(validateFoldingProject(project).trials[0]!.latencyMs).toBe(1.25);
    project.trials[0]!.inputTokens = 1.25;
    expect(() => validateFoldingProject(project)).toThrow('inputTokens');
  });
  it('bounds UTF8 text, total bytes, trace events and declared expected denominators', () => {
    const large = official(); large.evidence[0]!.text = '证'.repeat(6000);
    expect(() => validateFoldingProject(large)).toThrow('text');
    expect(() => validateFoldingProject({ value: 'x'.repeat(FOLDING_MAX_BYTES) })).toThrow('8MiB');
    const denominators = official(); denominators.experiments.forEach(experiment => { experiment.expectedRepetitions = 100; });
    expect(() => validateFoldingProject(denominators)).toThrow('expected trial budget');
  });
  it('rejects non-JSON, unsafe nested argument keys and invalid timestamps without evaluating strings', () => {
    const circular: Record<string, unknown> = {}; circular.circular = circular;
    expect(() => validateFoldingProject(circular)).toThrow('JSON');
    const project = official(); project.trials[0]!.actions.push({ name: 'shell text is inert', args: JSON.parse('{"__proto__":{"polluted":true}}'), evidenceId: null });
    expect(() => validateFoldingProject(project)).toThrow('unsafe key');
    project.trials[0]!.actions = []; project.createdAt = '2026-10-29';
    expect(() => validateFoldingProject(project)).toThrow('createdAt');
  });
});

describe('AF-004 bounded execution plan validation', () => {
  it('validates fixture and explicit-current-model plans without running them', () => {
    expect(validateFoldingRunPlan(plan()).provider).toBe('fixture');
    const real = plan(); real.provider = 'anthropic'; real.model = 'explicit-current-model';
    expect(validateFoldingRunPlan(real).model).toBe('explicit-current-model');
  });
  it.each(['implicit-model', 'zero-budget', 'fractional-calls', 'oversized-batch', 'too-many-runs', 'duplicate-cases', 'external-mismatch', 'unknown-execute'] as const)('rejects invalid plan %s', kind => {
    const value = plan();
    if (kind === 'implicit-model') value.provider = 'anthropic';
    if (kind === 'zero-budget') value.budgets.timeoutMs = 0;
    if (kind === 'fractional-calls') value.budgets.maxCallsPerCase = 1.5;
    if (kind === 'oversized-batch') value.budgets.maxToolBatch = 33;
    if (kind === 'too-many-runs') { value.caseIds = Array.from({ length: 200 }, (_, index) => String(index)); value.repetitions = 100; }
    if (kind === 'duplicate-cases') value.caseIds = ['t01', 't01'];
    if (kind === 'external-mismatch') value.adapter = 'external';
    if (kind === 'unknown-execute') Object.assign(value, { execute: true });
    expect(() => validateFoldingRunPlan(value)).toThrow('Invalid agent folding');
  });
  it('keeps external argv as literal data and requires a fixed independent case set', () => {
    const value = plan(), task = official().cases[0]!;
    value.adapter = 'external'; value.caseIds = [task.id];
    value.external = { repository: '/tmp/reviewed-repository', ref: 'reviewed-ref', baselineDriver: ['node', 'driver.js', '$(inert)'],
      candidateDriver: ['node', 'driver.js', '--candidate'], evaluator: ['node', 'evaluator.js'], cases: [task] };
    expect(validateFoldingRunPlan(value).external!.baselineDriver[2]).toBe('$(inert)');
    value.external.repository = '../relative';
    expect(() => validateFoldingRunPlan(value)).toThrow('absolute repository');
  });
  it('validates nested own-system projects while downgrading imported provenance idempotently', () => {
    const value = plan(), project = official(), task = project.cases[0]!;
    value.adapter = 'external'; value.caseIds = [task.id]; value.skillAblation = false;
    value.external = { repository: '/tmp/reviewed-repository', ref: 'main', baselineDriver: ['node', 'before.js'], candidateDriver: ['node', 'after.js'], evaluator: ['node', 'eval.js'], cases: [task], project };
    const first = validateFoldingRunPlan(value), second = validateFoldingRunPlan(first);
    expect(first.external!.project!.sources.every(source => source.kind === 'user_import')).toBe(true);
    expect(second).toEqual(first); expect(project.sources[0]!.kind).toBe('official_recording');
  });
});
