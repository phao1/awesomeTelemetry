import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runBenchmark, runCommand, readBenchmarkJson } from './runner.js';
import { BENCHMARK_TEMPLATE } from '../../src/core/benchmark-demo.js';
import { EMPTY_QUALITY, EMPTY_USAGE } from '../../src/core/benchmark-types.js';
import { runSuccess } from '../../src/core/benchmark-analysis.js';
import { validateBenchmarkReport } from '../../src/core/benchmark-validation.js';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'telemetry-benchmark-test-')); directories.push(dir);
  for (const argv of [['git', 'init', dir], ['git', '-C', dir, 'config', 'user.name', 'Benchmark Test'], ['git', '-C', dir, 'config', 'user.email', 'test@example.invalid']]) {
    expect((await runCommand(argv, dir, process.env, 10000)).status).toBe('completed');
  }
  await writeFile(join(dir, 'answer.txt'), 'original');
  expect((await runCommand(['git', 'add', 'answer.txt'], dir, process.env, 10000)).status).toBe('completed');
  expect((await runCommand(['git', 'commit', '-m', 'fixture'], dir, process.env, 10000)).status).toBe('completed');
  const driver = join(dir, 'driver.cjs'), evaluator = join(dir, 'evaluator.cjs');
  await writeFile(driver, `const fs=require('node:fs'); if(fs.readFileSync('answer.txt','utf8')!=='original')process.exit(9); fs.writeFileSync('answer.txt','fixed'); const c=JSON.parse(fs.readFileSync(process.env.BENCHMARK_CONTEXT)); fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH, JSON.stringify({actualModel:c.variant.model,sessionKey:null,complete:true,usage:${JSON.stringify(EMPTY_USAGE)},spans:[]}));`);
  await writeFile(evaluator, `const fs=require('node:fs'); const passed=fs.readFileSync('answer.txt','utf8')==='fixed'?1:0; fs.writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed,total:1,quality:${JSON.stringify(EMPTY_QUALITY)}})); process.exitCode=passed?0:1;`);
  const manifest = structuredClone(BENCHMARK_TEMPLATE); manifest.repetitions = 2;
  Object.assign(manifest.task, { repository: dir, expectedTests: 1, evaluator: [process.execPath, evaluator], timeoutMs: 10000 });
  manifest.variants.forEach(v => { v.driver = [process.execPath, driver]; });
  return { dir, driver, evaluator, manifest };
}
it('runs real subprocesses in four fresh pinned workspaces and evaluates independently', async () => {
  const { dir, manifest } = await setup(), output = join(dir, 'results');
  const report = await runBenchmark(manifest, { output, synthetic: true });
  expect(report.runs.map(r => r.id)).toEqual(['qoder-1', 'codearts-1', 'codearts-2', 'qoder-2']);
  expect(report.runs.every(r => runSuccess(r, 1))).toBe(true);
  expect(report.runs.every(r => r.phases.map(p => p.name).join(',') === 'checkout,pin,agent,evaluate')).toBe(true);
  expect(await readFile(join(dir, 'answer.txt'), 'utf8')).toBe('original');
  expect(validateBenchmarkReport(await readBenchmarkJson(join(output, 'report.json')))).toEqual(report);
  expect((await stat(join(output, 'qoder-1', 'workspace', 'answer.txt'))).isFile()).toBe(true);
  await expect(runBenchmark(manifest, { output })).rejects.toThrow();
}, 20000);
it('does not turn a successful driver without an evaluator verdict into acceptance', async () => {
  const { dir, manifest } = await setup(); manifest.repetitions = 1; manifest.variants = manifest.variants.slice(0, 1);
  manifest.task.evaluator = [process.execPath, '-e', 'process.exit(0)'];
  const report = await runBenchmark(manifest, { output: join(dir, 'unknown') });
  expect(report.runs[0]!.status).toBe('completed'); expect(runSuccess(report.runs[0]!, 1)).toBeNull();
}, 15000);
it('retains independent acceptance when a successful driver writes malformed telemetry', async () => {
  const { dir, manifest } = await setup(); manifest.repetitions = 1; manifest.variants = manifest.variants.slice(0, 1);
  manifest.variants[0]!.driver = [process.execPath, '-e', "const fs=require('node:fs');fs.writeFileSync('answer.txt','fixed');fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,'{broken');"];
  const report = await runBenchmark(manifest, { output: join(dir, 'bad-telemetry') });
  const run = report.runs[0]!;
  expect(run.status).toBe('completed');
  expect(run.phases.at(-1)?.name).toBe('evaluate');
  expect(runSuccess(run, 1)).toBe(true);
  expect(run.telemetry).toBeNull();
  expect(run.error).toContain('Telemetry unavailable');
  expect(validateBenchmarkReport(await readBenchmarkJson(join(dir, 'bad-telemetry', 'report.json')))).toEqual(report);
}, 15000);
it('stops subsequent GUI trials on timeout and keeps a durable failed record', async () => {
  const { dir, manifest } = await setup(); manifest.task.timeoutMs = 100;
  manifest.variants[0]!.driver = [process.execPath, '-e', 'setInterval(()=>{},1000)'];
  const report = await runBenchmark(manifest, { output: join(dir, 'timeout') });
  expect(report.runs).toHaveLength(1); expect(report.runs[0]!.status).toBe('timeout');
  expect(report.runs[0]!.phases.some(p => p.name === 'evaluate')).toBe(false);
}, 15000);
it('distinguishes spawn failure and cancellation without hanging', async () => {
  const dir = tmpdir(), controller = new AbortController();
  const pending = runCommand([process.execPath, '-e', 'setInterval(()=>{},1000)'], dir, process.env, 5000, controller.signal);
  controller.abort(); expect((await pending).status).toBe('cancelled');
  expect((await runCommand(['/missing/benchmark-executable'], dir, process.env, 1000)).status).toBe('failed');
});
it('bounds report file reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'benchmark-file-')); directories.push(dir);
  const path = join(dir, 'large.json'); await writeFile(path, ' '.repeat(1024));
  await expect(readBenchmarkJson(path, 100)).rejects.toThrow('bounded regular file');
});
