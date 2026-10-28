import { readBenchmarkJson, runBenchmark } from './runner.js';
import { validateBenchmarkManifest } from '../../src/core/benchmark-validation.js';
import { runSuccess } from '../../src/core/benchmark-analysis.js';
export { runBenchmark } from './runner.js';

export async function runBenchmarkCli(args: string[]): Promise<void> {
  if (args.includes('--help') || !args.length) {
    console.log('Usage: telemetry-benchmark <manifest.json> [--execute --output <new-directory>]\nWithout --execute: validate and print plan only. Drivers may invoke paid models when executed.'); return;
  }
  const execute = args.includes('--execute'), outputIndex = args.indexOf('--output');
  const allowed = new Set([0, ...(execute ? [args.indexOf('--execute')] : []), ...(outputIndex >= 0 ? [outputIndex, outputIndex + 1] : [])]);
  if (args.some((_, i) => !allowed.has(i)) || (outputIndex >= 0 && !args[outputIndex + 1])) throw new Error('Invalid benchmark arguments. Use --help.');
  const manifest = validateBenchmarkManifest(await readBenchmarkJson(args[0]!, 128 * 1024));
  console.log(`${manifest.name}: ${manifest.task.id}; ${manifest.variants.length} variants × ${manifest.repetitions} repetitions; ${manifest.task.expectedTests} acceptance tests.`);
  for (const v of manifest.variants) console.log(`${v.id}: ${v.product} / ${v.model} / ${v.environment}`);
  if (!execute) { console.log('Plan validated. Nothing executed. Supply --execute --output <new-directory> to run.'); return; }
  if (outputIndex < 0) throw new Error('--output is required for execution.');
  const controller = new AbortController(), abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    const report = await runBenchmark(manifest, { output: args[outputIndex + 1]!, signal: controller.signal, onProgress: console.log });
    const complete = report.runs.length === manifest.variants.length * manifest.repetitions;
    process.exitCode = complete && report.runs.every(r => runSuccess(r, manifest.task.expectedTests) === true) ? 0 : 1;
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
