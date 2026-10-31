import { resolve, dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { openReadonly } from '../storage/db.js';
import { createNativeScopeCollector } from './native-scope.js';
import { buildKitArtifacts, parseKitResults, projectKitTraces } from '../../src/core/agent-folding-interchange.js';
import { kitCoupling, kitCoverage, kitCompare, kitEstimate } from '../../src/core/agent-folding-kit.js';
import type { FoldingNativeScope } from '../../src/core/agent-folding-types.js';
import { estimateFoldingPlan } from '../../src/core/agent-folding-analysis.js';
import { importFoldingProject, validateFoldingRunPlan } from '../../src/core/agent-folding-validation.js';
import { readBenchmarkJson } from '../benchmark/runner.js';
import { loadFoldingExample } from './catalog.js';
import { freshFoldingProject, runFoldingExperiment } from './runner.js';
export { runFoldingExperiment } from './runner.js';

async function readResults(path: string) {
  const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
  const values: string[] = []; let bytes = 0;
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > 8 * 1024 * 1024 || values.length > 4000) throw new Error('Results exceed import limit');
      if (line.trim()) values.push(line);
    }
    return parseKitResults(values);
  } finally { lines.close(); stream.destroy(); }
}
async function readOnlyCommand(args: string[]): Promise<void> {
  const command = args[0]!, options = new Map<string, string>();
  const allowed = new Set(['--db', '--scope', '--before', '--after', '--reps', '--output']);
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!allowed.has(key) || options.has(key) || !value || value.startsWith('--')) throw new Error('Invalid read-only command arguments');
    options.set(key, value);
  }
  if (!options.has('--db')) throw new Error('--db is required');
  if (['coverage', 'compare', 'estimate'].includes(command) && !options.has('--before')) throw new Error('--before is required');
  if (command === 'compare' && !options.has('--after')) throw new Error('--after is required');
  if (command === 'export' && !options.has('--output')) throw new Error('--output is required');
  if (command !== 'export' && options.has('--output')) throw new Error('--output is only for export');
  const reps = options.has('--reps') ? Number(options.get('--reps')) : 1;
  if (!Number.isInteger(reps) || reps < 1 || reps > 100) throw new Error('Invalid repetitions');
  const scope = options.has('--scope') ? await readBenchmarkJson(options.get('--scope')!, 16384) : {};
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Invalid scope');
  const db = openReadonly(options.get('--db')!), collector = createNativeScopeCollector(db), controller = new AbortController();
  const abort = () => controller.abort(); process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    const project = await collector.collect(scope as FoldingNativeScope, controller.signal), traces = projectKitTraces(project);
    const before = options.has('--before') ? await readResults(options.get('--before')!) : [];
    controller.signal.throwIfAborted();
    let result: unknown;
    if (command === 'coupling') result = kitCoupling(traces);
    else if (command === 'coverage') result = kitCoverage(traces, before, { exclude: project.agents.filter(a => a.isMain).map(a => a.id) });
    else if (command === 'compare') result = kitCompare(before, await readResults(options.get('--after')!));
    else if (command === 'estimate') result = kitEstimate(before, { reps });
    else {
      const directory = resolve(options.get('--output')!), artifacts = buildKitArtifacts(project);
      await mkdir(directory, { mode: 0o700 });
      for (const artifact of artifacts) {
        controller.signal.throwIfAborted(); const path = join(directory, artifact.path);
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, artifact.content, { flag: 'wx', mode: 0o600 });
      }
      result = { directory, files: artifacts.map(a => a.path), limitations: project.limitations };
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); collector.close(); db.close(); }
}
export async function runAgentFoldingCli(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help')) {
    console.log('Read-only: telemetry-agent-folding <coupling|coverage|compare|estimate|export> --db <existing.sqlite> [--scope scope.json] [--before results.jsonl] [--after results.jsonl] [--reps N] [--output new-directory]\nUsage: telemetry-agent-folding <plan.json> [--execute --output <new-directory>] [--allow-paid]\nWithout --execute: validate the concrete plan and print its token estimate. Browser execution is fixed offline smoke only. Anthropic execution requires an explicit model, ANTHROPIC_API_KEY in the environment, --execute and --allow-paid. External drivers use isolated Git/argv and an independent evaluator.'); return;
  }
  if (['coupling', 'coverage', 'compare', 'estimate', 'export'].includes(args[0]!)) { await readOnlyCommand(args); return; }
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
