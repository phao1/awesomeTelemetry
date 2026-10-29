import { resolve } from 'node:path';
import { estimateFoldingPlan } from '../../src/core/agent-folding-analysis.js';
import { importFoldingProject, validateFoldingRunPlan } from '../../src/core/agent-folding-validation.js';
import { readBenchmarkJson } from '../benchmark/runner.js';
import { loadFoldingExample } from './catalog.js';
import { freshFoldingProject, runFoldingExperiment } from './runner.js';
export { runFoldingExperiment } from './runner.js';

export async function runAgentFoldingCli(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: telemetry-agent-folding <plan.json> [--execute --output <new-directory>] [--allow-paid]\nWithout --execute: validate the concrete plan and print its token estimate. Browser execution is fixed offline smoke only. Anthropic execution requires an explicit model, ANTHROPIC_API_KEY in the environment, --execute and --allow-paid. External drivers use isolated Git/argv and an independent evaluator.'); return;
  }
  const execute = args.includes('--execute'), paid = args.includes('--allow-paid'), oi = args.indexOf('--output');
  const allowed = new Set([0, ...(execute ? [args.indexOf('--execute')] : []), ...(paid ? [args.indexOf('--allow-paid')] : []), ...(oi >= 0 ? [oi, oi + 1] : [])]);
  if (args[0]!.startsWith('--') || args.some((_, i) => !allowed.has(i)) || oi >= 0 && !args[oi + 1]) throw new Error('Invalid arguments. Use --help.');
  const plan = validateFoldingRunPlan(await readBenchmarkJson(args[0]!, 8 * 1024 * 1024));
  if (plan.adapter === 'external' && !plan.external?.project) throw new Error('External execution requires its own project inventory and cases in external.project.');
  const project = freshFoldingProject(plan.adapter === 'external' ? importFoldingProject(plan.external!.project!) : await loadFoldingExample());
  console.log(JSON.stringify({ plan, estimate: estimateFoldingPlan(plan, project), limitations: ['The token estimate is unknown until a comparable measured baseline exists.', 'Measured usage is charged after responses; hard per-request output/call/time bounds do not guarantee an exact invoice cap.'] }, null, 2));
  if (!execute) { console.log('Validated. Nothing executed.'); return; }
  if (oi < 0) throw new Error('--output is required for execution.');
  if (plan.provider === 'anthropic' && !paid) throw new Error('Paid model execution requires --allow-paid.');
  const controller = new AbortController(), abort = () => controller.abort(); process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    const report = await runFoldingExperiment(project, plan, { output: resolve(args[oi + 1]!), allowPaid: paid, signal: controller.signal, onProgress: console.log });
    const experiment = report.experiments.at(-1)!, trials = report.trials.filter(t => t.experimentId === experiment.id);
    process.exitCode = !controller.signal.aborted && trials.length === plan.caseIds.length * plan.repetitions * (experiment.ablationVariantId ? 3 : 2) && trials.every(t => !t.harnessError) ? 0 : 1;
    console.log(`${trials.length} completed trials. ${plan.provider === 'fixture' ? 'Offline smoke is unscored.' : 'Review per-case regressions and process evidence before adopting a change.'}`);
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
