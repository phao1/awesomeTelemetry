import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTeamExperimentDemo } from './team-experiment-demo.js';
import { teamExperimentPromptSha256, validateTeamExperimentCases, validateTeamExperimentDemo, validateTeamExperimentEvidence, validateTeamExperimentPlan, validateTeamExperimentReport } from './team-experiment-validation.js';

describe('TEAM-EXP-002 strict evidence and report validation', () => {
  it.each([['empty', ''], ['ascii', 'abc'], ['unicode', '中文🙂\r\n原样提示词'], ['long', 'a'.repeat(32000)], ['surrogate', '\ud800']])('matches standard UTF-8 SHA256 for %s', (_label, value) => {
    expect(teamExperimentPromptSha256(value)).toBe(createHash('sha256').update(value).digest('hex'));
  });
  it('validates all four scenarios without mutating the report', () => {
    for (const scenario of ['single_wins', 'subagents_win', 'team_quality', 'incomplete'] as const) { const report = createTeamExperimentDemo(scenario), before = structuredClone(report); expect(validateTeamExperimentReport(report)).toEqual(before); expect(report).toEqual(before); }
  });
  it('accepts plan and demo inputs, and preserves exact variant prompts', () => {
    const report = createTeamExperimentDemo('single_wins');
    expect(validateTeamExperimentPlan(report.plan)).toEqual(report.plan);
    const demo = { name: 'paired fixture', repetitions: 3, schedule: 'parallel', variants: report.plan.variants.map(v => ({ mode: v.mode, prompt: v.prompt + '\n' })) };
    expect(validateTeamExperimentDemo(demo)).toEqual(demo);
  });
  it('requires portable absolute repository paths, without dereferencing them', () => {
    const plan = createTeamExperimentDemo('single_wins').plan;
    for (const path of ['/tmp/task', 'C:\\Users\\task', 'D:/task', '\\\\host\\share\\task']) { plan.task.repository = path; expect(validateTeamExperimentPlan(plan).task.repository).toBe(path); }
    for (const path of ['../task', '~/task', 'C:task', '\\task']) { plan.task.repository = path; expect(() => validateTeamExperimentPlan(plan)).toThrow('absolute local path'); }
  });
  it.each(['repetition', 'count', 'case-duplicate', 'unknown-field', 'shell', 'mode', 'case-cap'])('rejects invalid plan %s', kind => {
    const plan = createTeamExperimentDemo('single_wins').plan;
    if (kind === 'repetition') plan.repetitions = 0;
    if (kind === 'count') plan.task.expectedTests++;
    if (kind === 'case-duplicate') plan.task.caseIds[1] = plan.task.caseIds[0]!;
    if (kind === 'unknown-field') Object.assign(plan.variants[0]!, { executeOnLoad: true });
    if (kind === 'shell') Object.assign(plan.variants[0]!, { driver: 'echo unsafe' });
    if (kind === 'mode') Object.assign(plan.variants[0]!, { mode: 'several-tools' });
    if (kind === 'case-cap') { plan.task.caseIds = Array.from({ length: 1001 }, (_, i) => `case-${i}`); plan.task.expectedTests = 1001; }
    expect(() => validateTeamExperimentPlan(plan)).toThrow();
  });
  it.each(['parent-cycle', 'parent-missing', 'event-cycle', 'dependency-missing', 'agent-missing', 'target-missing', 'event-duplicate', 'negative', 'nan', 'duration', 'detail', 'coverage', 'agent-cap', 'event-cap'])('rejects invalid collaboration %s', kind => {
    const evidence = createTeamExperimentDemo('subagents_win').trials[3]!.evidence!, e = evidence.events[0]!;
    if (kind === 'parent-cycle') evidence.agents[0]!.parentId = 'api';
    if (kind === 'parent-missing') evidence.agents[1]!.parentId = 'absent';
    if (kind === 'event-cycle') e.dependsOn = [e.id];
    if (kind === 'dependency-missing') e.dependsOn = ['absent'];
    if (kind === 'agent-missing') e.agentId = 'absent';
    if (kind === 'target-missing') e.targetAgentId = 'absent';
    if (kind === 'event-duplicate') evidence.events.push({ ...e });
    if (kind === 'negative') e.startMs = -1;
    if (kind === 'nan') e.startMs = NaN;
    if (kind === 'duration') e.durationMs = 86400001;
    if (kind === 'detail') e.detail = 'x'.repeat(32001);
    if (kind === 'coverage') Object.assign(evidence.coverage, { communication: 'complete' });
    if (kind === 'agent-cap') evidence.agents = Array.from({ length: 65 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i}`, parentId: null, sessionKey: null }));
    if (kind === 'event-cap') evidence.events = Array.from({ length: 2001 }, (_, i) => ({ ...e, id: `event-${i}` }));
    expect(() => validateTeamExperimentEvidence(evidence)).toThrow('Invalid team experiment');
  });
  it.each(['unknown-variant', 'trial-duplicate', 'identity', 'prompt', 'date', 'run-fields', 'outside-clock'])('rejects invalid report %s', kind => {
    const report = createTeamExperimentDemo('single_wins'), trial = report.trials[0]!;
    if (kind === 'unknown-variant') trial.variantId = 'absent';
    if (kind === 'trial-duplicate') report.trials.push(trial);
    if (kind === 'identity') trial.run.repetition++;
    if (kind === 'prompt') report.plan.variants[0]!.prompt += 'changed';
    if (kind === 'date') report.createdAt = '2026-10-29 12:00:00';
    if (kind === 'run-fields') Object.assign(trial.run, { execution: 'hidden' });
    if (kind === 'outside-clock') trial.evidence!.events[0]!.startMs = trial.run.e2eMs! + 2;
    expect(() => validateTeamExperimentReport(report)).toThrow();
  });
  it('requires exactly the independent named case set and known statuses', () => {
    const report = createTeamExperimentDemo('team_quality'), cases = report.trials[0]!.cases!;
    expect(validateTeamExperimentCases(cases, report.plan.task.caseIds)).toEqual(cases);
    expect(() => validateTeamExperimentCases(cases.slice(1), report.plan.task.caseIds)).toThrow();
    expect(() => validateTeamExperimentCases([...cases, cases[0]!], report.plan.task.caseIds)).toThrow();
    expect(() => validateTeamExperimentCases([{ ...cases[0], status: 'claimed-success' }], [cases[0]!.id])).toThrow();
  });
  it('bounds total events even when each trial is individually valid', () => {
    const report = createTeamExperimentDemo('single_wins'); report.plan.repetitions = 10;
    report.trials = Array.from({ length: 11 }, (_, index) => {
      const source = structuredClone(report.trials[index % 9]!); source.repetition = Math.floor(index / 3) + 1; source.variantId = report.plan.variants[index % 3]!.id; source.promptSha256 = teamExperimentPromptSha256(report.plan.variants[index % 3]!.prompt); source.id = `${source.variantId}-${source.repetition}`; source.run = { ...source.run, id: source.id, variantId: source.variantId, repetition: source.repetition };
      source.evidence = { coverage: { roster: true, activities: true, communication: true }, agents: [{ id: 'lead', name: 'Lead', parentId: null, sessionKey: null }], events: Array.from({ length: 1900 }, (_, i) => ({ id: `event-${i}`, agentId: 'lead', targetAgentId: null, kind: 'context', name: 'Context', detail: null, startMs: 0, durationMs: 0, timing: 'observed', status: 'ok', dependsOn: [], tokens: null, sessionKey: null, eventId: null })) };
      return source;
    });
    expect(() => validateTeamExperimentReport(report)).toThrow('report event count');
  });
  it('rejects over-size reports and cyclic object input before traversal', () => {
    const report = createTeamExperimentDemo('single_wins'); report.trials[0]!.evidence!.events[0]!.detail = 'x'.repeat(16 * 1024 * 1024);
    expect(() => validateTeamExperimentReport(report)).toThrow('report bytes');
    const value: Record<string, unknown> = {}; value.cycle = value;
    expect(() => validateTeamExperimentReport(value)).toThrow('Invalid team experiment: JSON');
  });
});
