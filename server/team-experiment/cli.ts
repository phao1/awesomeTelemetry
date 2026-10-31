import { validateTeamExperimentPlan } from '../../src/core/team-experiment-validation.js';
import { readBenchmarkJson } from '../benchmark/runner.js';
import { runSuccess } from '../../src/core/benchmark-analysis.js';
import { runTeamExperiment } from './runner.js';
export { runTeamExperiment } from './runner.js';

export async function runTeamExperimentCli(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: telemetry-team-experiment <plan.json> [--execute --output <new-directory>] [--synthetic]\nWithout --execute: validate and print the plan. Real drivers run only with --execute. Use --synthetic for fixture drivers.'); return;
  }
  const execute = args.includes('--execute'), synthetic = args.includes('--synthetic'), outputIndex = args.indexOf('--output');
  const allowed = new Set([0, ...(execute ? [args.indexOf('--execute')] : []), ...(synthetic ? [args.indexOf('--synthetic')] : []), ...(outputIndex >= 0 ? [outputIndex, outputIndex + 1] : [])]);
  if (args.some((_, i) => !allowed.has(i)) || (outputIndex >= 0 && !args[outputIndex + 1])) throw new Error('Invalid team experiment arguments. Use --help.');
  const plan = validateTeamExperimentPlan(await readBenchmarkJson(args[0]!));
  console.log(`${plan.name}: ${plan.task.id}; ${plan.variants.length} variants × ${plan.repetitions}; ${plan.schedule}; ${plan.task.caseIds.length} named acceptance cases.`);
  for (const variant of plan.variants) console.log(`${variant.id}: ${variant.mode} / ${variant.product} / ${variant.model} / ${variant.environment}`);
  if (!execute) { console.log('Plan validated. Nothing executed. Use --execute --output <new-directory> to run.'); return; }
  if (outputIndex < 0) throw new Error('--output is required for execution.');
  const controller = new AbortController(), abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    const report = await runTeamExperiment(plan, { output: args[outputIndex + 1]!, synthetic, signal: controller.signal, onProgress: console.log });
    const passed = report.trials.length === plan.variants.length * plan.repetitions && report.trials.every(t => runSuccess(t.run, plan.task.expectedTests) === true && t.cases?.length === plan.task.caseIds.length && t.cases.every(c => c.status === 'passed'));
    process.exitCode = passed ? 0 : 1;
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
