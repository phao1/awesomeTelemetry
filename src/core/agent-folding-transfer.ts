import type { BenchmarkReport } from './benchmark-types.js';
import type { TeamExperimentReport } from './team-experiment-types.js';
import { EMPTY_FOLDING_ARCHITECTURE, EMPTY_FOLDING_LABELS } from './agent-folding-metrics.js';
import type { FoldingMetricRun } from './agent-folding-metrics.js';
import { validateBenchmarkReport } from './benchmark-validation.js';
import { validateTeamExperimentReport } from './team-experiment-validation.js';
export function benchmarkToFoldingRuns(report: BenchmarkReport): FoldingMetricRun[] {
  return report.runs.map(run => { const variant = report.manifest.variants.find(v => v.id === run.variantId)!;
    return { id: run.id, taskId: run.telemetry?.sessionKey ? `collected:${run.telemetry.sessionKey}` : null, run, expectedTests: report.manifest.task.expectedTests,
      labels: { ...EMPTY_FOLDING_LABELS, productMode: variant.product, environment: variant.environment, model: run.telemetry?.actualModel ?? variant.model,
        definitionFingerprint: report.promptSha256, toolPermissions: variant.toolSet, acceptanceSource: JSON.stringify(report.manifest.task.evaluator), caseId: report.manifest.task.id,
        host: run.host, qualitySource: run.verdict?.qualitySource ?? null }, architecture: { ...EMPTY_FOLDING_ARCHITECTURE }, limitations: [report.synthetic ? '合成示例，不代表真实表现' : '导入报告声明未经独立核验', '首 Token 测量来源及 LOC 范围未知'] };
  });
}
export function teamExperimentToFoldingRuns(report: TeamExperimentReport): FoldingMetricRun[] {
  return report.trials.map(trial => {
    const item = benchmarkToFoldingRuns({ version: 1, synthetic: report.synthetic, manifest: report.plan, commit: report.commit, promptSha256: trial.promptSha256, createdAt: report.createdAt, runs: [trial.run] })[0]!;
    item.id = trial.id; item.labels.productMode = report.plan.variants.find(v => v.id === trial.variantId)!.mode;
    if (trial.cases && trial.cases.every(c => c.status !== 'unknown') && item.run.verdict) item.run = { ...item.run, verdict: { ...item.run.verdict, cases: trial.cases.map(c => ({ id: c.id, passed: c.status === 'passed' })) } };
    if (trial.evidence?.coverage.roster) item.architecture.subAgents = trial.evidence.agents.filter(a => a.parentId !== null).length;
    return item;
  });
}
export function parseArchitectureTransfer(text: string) {
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024) throw new Error('Report exceeds 8MiB');
  const raw: unknown = JSON.parse(text);
  if (raw && typeof raw === 'object' && 'kind' in raw && raw.kind === 'team-experiment-report') { const report = validateTeamExperimentReport(raw); return { runs: teamExperimentToFoldingRuns(report), variants: report.plan.variants, synthetic: report.synthetic }; }
  const report = validateBenchmarkReport(raw); return { runs: benchmarkToFoldingRuns(report), variants: report.manifest.variants, synthetic: report.synthetic };
}
