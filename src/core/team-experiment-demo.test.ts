import { describe, expect, it } from 'vitest';
import { createTeamExperimentDemo } from './team-experiment-demo.js';
import { validateTeamExperimentReport } from './team-experiment-validation.js';

describe('TEAM-EXP-004 offline recorded replay scenarios', () => {
  it.each(['single_wins', 'subagents_win', 'team_quality', 'incomplete'] as const)('provides bounded independent %s data with public details', scenario => {
    const report = createTeamExperimentDemo(scenario);
    expect(report.synthetic).toBe(true); expect(report.trials).toHaveLength(9);
    expect(validateTeamExperimentReport(report)).toEqual(report);
    expect(report.trials.every(t => t.run.telemetry?.actualModel === 'synthetic-model')).toBe(true);
    expect(report.trials.every(t => t.evidence!.events.every(e => e.sessionKey === null && e.eventId === null))).toBe(true);
    const kinds = new Set(report.trials.flatMap(t => t.evidence!.events.map(e => e.kind)));
    expect(kinds.has('wait')).toBe(true); expect(kinds.has('message')).toBe(true); expect(kinds.has('handoff')).toBe(true); expect(kinds.has('context')).toBe(true);
    expect(report.trials.some(t => t.evidence!.events.some(e => e.detail?.includes('参数：') && e.detail.includes('结果：')))).toBe(true);
    const fresh = createTeamExperimentDemo(scenario); report.plan.task.caseIds.pop(); report.trials[0]!.evidence!.agents[0]!.name = 'changed';
    expect(fresh.plan.task.caseIds).toHaveLength(6); expect(fresh.trials[0]!.evidence!.agents[0]!.name).toBe('主 Agent');
  });
});
