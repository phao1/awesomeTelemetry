import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { BenchmarkManifest, BenchmarkReport, BenchmarkRun, BenchmarkSpan } from '../../src/core/benchmark-types.js';
import { BENCHMARK_MAX_BYTES, validateBenchmarkManifest, validateBenchmarkReport, validateBenchmarkTelemetry, validateBenchmarkVerdict } from '../../src/core/benchmark-validation.js';

export interface CommandResult { status: 'completed' | 'failed' | 'timeout' | 'cancelled'; code: number | null; output: string }
/** Bounded diagnostics; no shell. Driver owns any independently launched GUI. */
export function runCommand(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  if (signal?.aborted) return Promise.resolve({ status: 'cancelled', code: null, output: '' });
  return new Promise(resolveCommand => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let status: CommandResult['status'] | null = null, output = '', bytes = 0, done = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined;
    const append = (chunk: Buffer) => { if (bytes < 65536) { output += chunk.subarray(0, 65536 - bytes).toString('utf8'); bytes += chunk.length; } };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const finish = (code: number | null) => {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer); signal?.removeEventListener('abort', abort);
      child.stdout.destroy(); child.stderr.destroy();
      resolveCommand({ status: status ?? (code === 0 ? 'completed' : 'failed'), code, output });
    };
    const kill = (sig: NodeJS.Signals) => {
      if (!child.pid) return;
      try { if (process.platform === 'win32') child.kill(sig); else process.kill(-child.pid, sig); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') append(Buffer.from('Process cleanup failed.')); }
    };
    const stop = (next: 'timeout' | 'cancelled') => {
      if (status || done) return; status = next; kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
      closeTimer = setTimeout(() => finish(null), 1500);
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', () => { status ??= 'failed'; append(Buffer.from('Unable to start command.')); finish(null); });
    child.on('close', code => { if (status === 'timeout' || status === 'cancelled') kill('SIGKILL'); finish(code); });
  });
}
export async function readBenchmarkJson(path: string, max = BENCHMARK_MAX_BYTES): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > max) throw new Error('Benchmark file is not a bounded regular file.');
    const buffer = Buffer.alloc(max + 1); let size = 0;
    while (size < buffer.length) { const r = await file.read(buffer, size, buffer.length - size, size); if (!r.bytesRead) break; size += r.bytesRead; }
    if (size > max) throw new Error('Benchmark file exceeds size limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown;
  } finally { await file.close(); }
}
async function optionalJson(path: string): Promise<unknown | null> {
  try { return await readBenchmarkJson(path, 2 * 1024 * 1024); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function saveReport(path: string, report: BenchmarkReport): Promise<void> {
  validateBenchmarkReport(report);
  const text = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(text) > BENCHMARK_MAX_BYTES) throw new Error('Benchmark report exceeds size limit. Finished run artifacts remain on disk.');
  const temp = `${path}.${randomUUID()}.tmp`, file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
}
export interface BenchmarkRunnerOptions { output: string; signal?: AbortSignal; synthetic?: boolean; onProgress?: (message: string) => void }
export async function runBenchmark(input: BenchmarkManifest, options: BenchmarkRunnerOptions): Promise<BenchmarkReport> {
  const manifest = validateBenchmarkManifest(input), output = resolve(options.output);
  if (!isAbsolute(manifest.task.repository)) throw new Error('Task repository must be an absolute local path.');
  const pin = await runCommand(['git', '-C', manifest.task.repository, 'rev-parse', '--verify', '--end-of-options', `${manifest.task.ref}^{commit}`], process.cwd(), process.env, 30000, options.signal);
  const commit = pin.output.trim();
  if (pin.status !== 'completed' || !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Cannot resolve local task commit.');
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 }); // Existing output is an error; never overwrite an experiment.
  const report: BenchmarkReport = { version: 1, synthetic: options.synthetic ?? false, manifest, commit,
    promptSha256: createHash('sha256').update(manifest.task.prompt).digest('hex'), createdAt: new Date().toISOString(), runs: [] };
  const reportPath = join(output, 'report.json');
  await saveReport(reportPath, report);
  for (let repetition = 1; repetition <= manifest.repetitions; repetition++) {
    const order = manifest.variants.map((_, i) => manifest.variants[(i + repetition - 1) % manifest.variants.length]!);
    for (const variant of order) {
      if (options.signal?.aborted) return report;
      const id = `${variant.id}-${repetition}`, directory = join(output, id), workspace = join(directory, 'workspace');
      await mkdir(directory, { mode: 0o700 });
      const origin = performance.now();
      const run: BenchmarkRun = { id, variantId: variant.id, repetition, startedAt: new Date().toISOString(), status: 'failed', host: hostname(), e2eMs: null, telemetry: null, verdict: null, phases: [], error: null };
      const env = { ...process.env, BENCHMARK_WORKSPACE: workspace, BENCHMARK_CONTEXT: join(directory, 'context.json'),
        BENCHMARK_RESULT_PATH: join(directory, 'telemetry.json'), BENCHMARK_VERDICT_PATH: join(directory, 'verdict.json') };
      await writeFile(env.BENCHMARK_CONTEXT, JSON.stringify({ task: manifest.task, variant, repetition, commit, workspace }), { flag: 'wx', mode: 0o600 });
      options.onProgress?.(`${id}: preparing ${commit.slice(0, 12)}`);
      const phase = async (name: string, argv: string[], cwd: string, timeoutMs = manifest.task.timeoutMs): Promise<CommandResult> => {
        const start = performance.now();
        const result = await runCommand(argv, cwd, env, timeoutMs, options.signal);
        const span: BenchmarkSpan = { id: `runner-${name}`, kind: 'runner', name, startMs: start - origin, durationMs: performance.now() - start, timing: 'measured',
          status: result.status === 'completed' ? 'ok' : 'error', firstTokenMs: null, outputTokens: null, sessionKey: null, eventId: null };
        run.phases.push(span);
        await writeFile(join(directory, `${name}.log`), result.output, { flag: 'wx', mode: 0o600 });
        return result;
      };
      try {
        let result = await phase('checkout', ['git', 'clone', '--local', '--no-hardlinks', '--no-checkout', '--', manifest.task.repository, workspace], directory, 60000);
        if (result.status === 'completed') result = await phase('pin', ['git', 'checkout', '--detach', commit], workspace, 60000);
        if (result.status === 'completed') {
          options.onProgress?.(`${id}: running ${variant.product} / ${variant.model}`);
          result = await phase('agent', variant.driver, workspace);
          run.status = result.status;
          const agent = run.phases.at(-1)!;
          run.e2eMs = agent.durationMs;
          // Capture quality and independent acceptance are separate outcomes.
          // A malformed trace must not prevent checking the actual work product.
          try {
            const raw = await optionalJson(env.BENCHMARK_RESULT_PATH);
            if (raw !== null) {
              run.telemetry = validateBenchmarkTelemetry(raw);
              // Driver offsets use agent-start; report offsets use run-start.
              run.telemetry.spans = run.telemetry.spans.map(s => ({ ...s, startMs: s.startMs + agent.startMs }));
            }
          } catch (error) {
            run.telemetry = null;
            run.error = `Telemetry unavailable: ${error instanceof Error ? error.message : 'invalid evidence'}`.slice(0, 1000);
          }
          if (result.status === 'completed') {
            options.onProgress?.(`${id}: evaluating`);
            result = await phase('evaluate', manifest.task.evaluator, workspace);
            run.status = result.status;
            const verdict = await optionalJson(env.BENCHMARK_VERDICT_PATH);
            if (verdict !== null) run.verdict = validateBenchmarkVerdict(verdict);
          }
        }
        run.status = result.status;
        if (result.status !== 'completed') run.error = `${result.status}; exit=${result.code ?? 'unknown'}; inspect phase logs${run.error ? `; ${run.error}` : ''}`.slice(0, 1000);
      } catch (error) {
        if (run.status !== 'timeout' && run.status !== 'cancelled') run.status = options.signal?.aborted ? 'cancelled' : 'failed';
        run.error = error instanceof Error ? error.message.slice(0, 1000) : 'Run evidence unavailable';
      }
      report.runs.push(run);
      await saveReport(reportPath, report);
      options.onProgress?.(`${id}: ${run.status}; ${reportPath}`);
      if (run.status === 'timeout' || run.status === 'cancelled') return report;
    }
  }
  return report;
}
