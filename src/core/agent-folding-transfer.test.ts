import { expect, it } from 'vitest';
import { demoBenchmarkReport } from './benchmark-demo.js';
import { createTeamExperimentDemo } from './team-experiment-demo.js';
import { parseArchitectureTransfer } from './agent-folding-transfer.js';
import { foldingComparison, foldingRunMetrics } from './agent-folding-metrics.js';
it('preserves synthetic provenance and does not upgrade imported timing or scanner scope', () => {
  const report = demoBenchmarkReport(), parsed = parseArchitectureTransfer(JSON.stringify(report));
  expect(parsed.synthetic).toBe(true); expect(parsed.runs).toHaveLength(report.runs.length);
  expect(foldingRunMetrics(parsed.runs[0]!).ttft).toBeNull();
  expect(parsed.runs[0]!.labels.qualityScope).toBeNull();
  expect(parsed.runs[0]!.limitations.join()).toContain('合成');
  const comparison = foldingComparison(parsed.runs.slice(0, 3), parsed.runs.slice(3));
  expect(comparison.rows.find(r => r.key === 'loc')!.comparable).toBe(false);
  expect(() => parseArchitectureTransfer('{}')).toThrow();
});
it('retains team case outcomes and converts only explicitly covered roster evidence', () => {
  const report = createTeamExperimentDemo('incomplete'), parsed = parseArchitectureTransfer(JSON.stringify(report));
  expect(parsed.runs).toHaveLength(report.trials.length);
  for (const [i, run] of parsed.runs.entries()) {
    const trial = report.trials[i]!;
    expect(run.architecture.subAgents).toBe(trial.evidence?.coverage.roster ? trial.evidence.agents.filter(a => a.parentId !== null).length : null);
    expect(run.labels.definitionFingerprint).toBe(trial.promptSha256);
  }
});
