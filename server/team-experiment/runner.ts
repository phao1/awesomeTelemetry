import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { BenchmarkSpan } from '../../src/core/benchmark-types.js';
import type { TeamExperimentPlan, TeamExperimentReport, TeamExperimentTrial, TeamExperimentVariant } from '../../src/core/team-experiment-types.js';
import { BENCHMARK_MAX_BYTES, validateBenchmarkTelemetry, validateBenchmarkVerdict } from '../../src/core/benchmark-validation.js';
import { validateTeamExperimentCases, validateTeamExperimentEvidence, validateTeamExperimentPlan, validateTeamExperimentReport } from '../../src/core/team-experiment-validation.js';
import { readBenchmarkJson, runCommand } from '../benchmark/runner.js';
import type { CommandResult } from '../benchmark/runner.js';

export interface TeamExperimentRunnerOptions {
  output: string; signal?: AbortSignal; synthetic?: boolean;
  onProgress?: (message: string) => void;
}
interface PreparedTrial {
  trial: TeamExperimentTrial; variant: TeamExperimentVariant; directory: string;
  workspace: string; origin: number; env: NodeJS.ProcessEnv;
  casesPath: string; ready: boolean;
}
async function optionalJson(path: string): Promise<unknown | null> {
  try { return await readBenchmarkJson(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function saveReport(path: string, report: TeamExperimentReport): Promise<void> {
  const text = JSON.stringify(validateTeamExperimentReport(report), null, 2);
  if (Buffer.byteLength(text) > BENCHMARK_MAX_BYTES) throw new Error('Team experiment report exceeds 16 MiB. Completed trial artifacts remain on disk.');
  const temp = `${path}.${randomUUID()}.tmp`, file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
}
function evidenceError(trial: TeamExperimentTrial, label: string): void {
  trial.evidenceError = [trial.evidenceError, label].filter(Boolean).join('; ').slice(0, 1000);
}

/** Explicit local CLI execution only; each driver owns any external GUI it launches. */
export async function runTeamExperiment(input: TeamExperimentPlan, options: TeamExperimentRunnerOptions): Promise<TeamExperimentReport> {
  const plan = validateTeamExperimentPlan(input), output = resolve(options.output);
  if (!isAbsolute(plan.task.repository)) throw new Error('Task repository must be an absolute local path.');
  const controller = new AbortController(), abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let writing: Promise<void> = Promise.resolve();
  try {
    const pin = await runCommand(['git', '-C', plan.task.repository, 'rev-parse', '--verify', '--end-of-options', `${plan.task.ref}^{commit}`], process.cwd(), process.env, 30000, controller.signal);
    const commit = pin.output.trim();
    if (pin.status !== 'completed' || !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Cannot resolve local task commit.');
    await mkdir(dirname(output), { recursive: true });
    await mkdir(output, { mode: 0o700 });
    const report: TeamExperimentReport = { version: 1, kind: 'team-experiment-report', synthetic: options.synthetic ?? false, plan, commit, createdAt: new Date().toISOString(), trials: [] };
    const reportPath = join(output, 'report.json');
    const persist = () => { writing = writing.then(() => saveReport(reportPath, report)); return writing; };
    await persist();
    const phase = async (p: PreparedTrial, name: string, argv: string[], cwd: string, env = p.env, timeoutMs = plan.task.timeoutMs): Promise<CommandResult> => {
      const start = performance.now();
      const result = await runCommand(argv, cwd, env, timeoutMs, controller.signal);
      const span: BenchmarkSpan = { id: `runner-${name}`, kind: 'runner', name, startMs: start - p.origin, durationMs: performance.now() - start, timing: 'measured', status: result.status === 'completed' ? 'ok' : 'error', firstTokenMs: null, outputTokens: null, sessionKey: null, eventId: null };
      p.trial.run.phases.push(span);
      await writeFile(join(p.directory, `${name}.log`), result.output, { flag: 'wx', mode: 0o600 });
      return result;
    };
    const finish = async (p: PreparedTrial) => {
      // Per-trial bounds alone do not guarantee a persistable experiment. Keep
      // complete raw artifacts on disk instead of silently truncating an overflow.
      const retainedEvents = report.trials.reduce((n, trial) => n + (trial.evidence?.events.length ?? 0), 0);
      const retainedSpans = report.trials.reduce((n, trial) => n + (trial.run.telemetry?.spans.length ?? 0), 0);
      if (retainedEvents + (p.trial.evidence?.events.length ?? 0) > 20000) {
        p.trial.evidence = null;
        evidenceError(p.trial, 'Collaboration evidence: 全报告容量不足，该trial原始文件保留 (report event capacity exceeded; original trial files retained)');
      }
      if (retainedSpans + (p.trial.run.telemetry?.spans.length ?? 0) > 20000) {
        p.trial.run.telemetry = null;
        evidenceError(p.trial, 'Telemetry: 全报告容量不足，该trial原始文件保留 (report span capacity exceeded; original trial files retained)');
      }
      report.trials.push(p.trial);
      // Stable identities/order survive whichever parallel trial happens to finish first.
      report.trials.sort((a, b) => a.repetition - b.repetition || plan.variants.findIndex(v => v.id === a.variantId) - plan.variants.findIndex(v => v.id === b.variantId));
      await persist();
      options.onProgress?.(`${p.trial.id}: ${p.trial.run.status}; ${reportPath}`);
    };
    const execute = async (p: PreparedTrial) => {
      const { trial, workspace, variant } = p, run = trial.run;
      if (!p.ready) { await finish(p); return; }
      try {
        options.onProgress?.(`${trial.id}: running ${variant.mode}`);
        let result = await phase(p, 'agent', variant.driver, workspace);
        run.status = result.status;
        const agent = run.phases.at(-1)!;
        run.e2eMs = agent.durationMs;
        if (result.status === 'timeout') controller.abort();
        // Capture/parsing failures never suppress the independent acceptance phase.
        try {
          const raw = await optionalJson(p.env.BENCHMARK_RESULT_PATH!);
          if (raw !== null) {
            const telemetry = validateBenchmarkTelemetry(raw);
            if (telemetry.spans.some(s => s.id.startsWith('runner-'))) {
              evidenceError(trial, 'Telemetry uses reserved runner-* span IDs; original trial file retained');
            } else {
              if (telemetry.spans.some(s => s.startMs + (s.durationMs ?? 0) > run.e2eMs! + 1)) throw new Error('Telemetry extends outside the measured driver interval');
              run.telemetry = validateBenchmarkTelemetry({ ...telemetry, spans: telemetry.spans.map(s => ({ ...s, startMs: s.startMs + agent.startMs })) });
            }
          }
        } catch { evidenceError(trial, 'Telemetry is malformed or unreadable'); }
        try {
          const raw = await optionalJson(p.env.TEAM_EXPERIMENT_EVIDENCE_PATH!);
          if (raw !== null) {
            const evidence = validateTeamExperimentEvidence(raw);
            if (evidence.events.some(e => e.startMs + (e.durationMs ?? 0) > run.e2eMs! + 1)) throw new Error('Evidence extends outside the measured driver interval');
            trial.evidence = evidence;
          }
        } catch { evidenceError(trial, 'Collaboration evidence is malformed or unreadable'); }
        if (result.status === 'completed' && !controller.signal.aborted) {
          // Neither a driver's seeded verdict nor a stale cases file is acceptance.
          for (const path of [p.env.BENCHMARK_VERDICT_PATH!, p.casesPath]) {
            try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
          result = await phase(p, 'evaluate', plan.task.evaluator, workspace, { ...p.env, TEAM_EXPERIMENT_CASES_PATH: p.casesPath });
          run.status = result.status;
          if (result.status === 'timeout') controller.abort();
          try {
            const raw = await optionalJson(p.env.BENCHMARK_VERDICT_PATH!);
            if (raw !== null) run.verdict = validateBenchmarkVerdict(raw);
          } catch { evidenceError(trial, 'Aggregate acceptance verdict is malformed or unreadable'); }
          try {
            const raw = await optionalJson(p.casesPath);
            if (raw !== null) trial.cases = validateTeamExperimentCases(raw, plan.task.caseIds);
          } catch { evidenceError(trial, 'Named acceptance cases are malformed or do not match the plan'); }
        } else if (result.status === 'completed' && controller.signal.aborted) {
          run.status = 'cancelled';
        }
        if (run.status !== 'completed') run.error = `${run.status}; exit=${result.code ?? 'unknown'}; inspect phase logs`;
      } catch (error) {
        if (run.status !== 'timeout' && run.status !== 'cancelled') run.status = controller.signal.aborted ? 'cancelled' : 'failed';
        run.error = error instanceof Error ? error.message.slice(0, 1000) : 'Trial failed';
      }
      await finish(p);
    };
    for (let repetition = 1; repetition <= plan.repetitions; repetition++) {
      if (controller.signal.aborted) break;
      const prepared: PreparedTrial[] = [];
      // Prepare every peer first. No driver starts while another workspace is cloning.
      for (const variant of plan.variants) {
        const id = `${variant.id}-${repetition}`, directory = join(output, id), workspace = join(directory, 'workspace');
        await mkdir(directory, { mode: 0o700 });
        const trial: TeamExperimentTrial = { id, variantId: variant.id, repetition, promptSha256: createHash('sha256').update(variant.prompt).digest('hex'), cases: null, evidence: null, evidenceError: null,
          run: { id, variantId: variant.id, repetition, startedAt: new Date().toISOString(), status: 'failed', host: hostname(), e2eMs: null, telemetry: null, verdict: null, phases: [], error: null } };
        const env: NodeJS.ProcessEnv = { ...process.env, BENCHMARK_WORKSPACE: workspace, BENCHMARK_CONTEXT: join(directory, 'context.json'), BENCHMARK_RESULT_PATH: join(directory, 'telemetry.json'), BENCHMARK_VERDICT_PATH: join(directory, 'verdict.json'), TEAM_EXPERIMENT_EVIDENCE_PATH: join(directory, 'evidence.json') };
        // Never inherit another evaluator's private output locator into a driver.
        delete env.TEAM_EXPERIMENT_CASES_PATH;
        const p: PreparedTrial = { trial, variant, directory, workspace, origin: performance.now(), env, casesPath: join(directory, `cases-${randomUUID()}.json`), ready: false };
        prepared.push(p);
        const { evaluator: _evaluator, caseIds: _caseIds, ...publicTask } = plan.task;
        void _evaluator; void _caseIds;
        await writeFile(env.BENCHMARK_CONTEXT!, JSON.stringify({ task: { ...publicTask, prompt: variant.prompt }, taskPrompt: plan.task.prompt, prompt: variant.prompt, mode: variant.mode, variant, repetition, commit, workspace }), { flag: 'wx', mode: 0o600 });
        options.onProgress?.(`${id}: preparing ${commit.slice(0, 12)}`);
        let result = await phase(p, 'checkout', ['git', 'clone', '--local', '--no-hardlinks', '--no-checkout', '--', plan.task.repository, workspace], directory, env, 60000);
        if (result.status === 'completed') result = await phase(p, 'pin', ['git', 'checkout', '--detach', commit], workspace, env, 60000);
        p.ready = result.status === 'completed';
        if (!p.ready) { trial.run.status = result.status; trial.run.error = `${result.status} preparing pinned workspace`; if (result.status === 'timeout') controller.abort(); }
      }
      if (plan.schedule === 'parallel') {
        const results = await Promise.allSettled(prepared.map(execute));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
      } else for (const p of prepared) await execute(p);
      if (report.trials.some(t => t.repetition === repetition && ['timeout', 'cancelled'].includes(t.run.status))) break;
    }
    await writing;
    return report;
  } finally { options.signal?.removeEventListener('abort', abort); }
}
