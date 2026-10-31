import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EMPTY_QUALITY, EMPTY_USAGE } from '../../src/core/benchmark-types.js';
import type { BenchmarkDemoInput, BenchmarkManifest, BenchmarkReport } from '../../src/core/benchmark-types.js';
import { validateBenchmarkDemo } from '../../src/core/benchmark-validation.js';
import { runBenchmark, runCommand } from './runner.js';

/** Fixed trusted fixture only: input never supplies commands, paths or executable code. */
export async function runBenchmarkDemo(value: BenchmarkDemoInput, parent: string, signal?: AbortSignal): Promise<BenchmarkReport> {
  const input = validateBenchmarkDemo(value), root = join(parent, randomUUID()), repository = join(root, 'task');
  await mkdir(repository, { recursive: true, mode: 0o700 });
  const git = async (args: string[]) => {
    const r = await runCommand(['git', ...args], repository, process.env, 10000, signal);
    if (r.status !== 'completed') throw new Error('Example repository preparation failed.');
  };
  await git(['init']); await git(['config', 'user.name', 'Telemetry Example']); await git(['config', 'user.email', 'example@example.invalid']);
  await writeFile(join(repository, 'sum.cjs'), 'module.exports=(a,b)=>0;\n');
  await git(['add', 'sum.cjs']); await git(['commit', '-m', 'Synthetic addition fixture']);
  const driver = join(root, 'driver.cjs'), evaluator = join(root, 'evaluator.cjs');
  // Odd fixture variants intentionally fail two of three tests to exercise diagnosis.
  await writeFile(driver, `const fs=require('node:fs');const {performance}=require('node:perf_hooks');const c=JSON.parse(fs.readFileSync(process.env.BENCHMARK_CONTEXT));const started=performance.now();fs.writeFileSync('sum.cjs',Number(c.variant.id.split('-')[1])%2===0?'module.exports=(a,b)=>a+b;':'module.exports=(a,b)=>a-b;');const duration=performance.now()-started;fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,JSON.stringify({actualModel:null,sessionKey:null,complete:true,usage:${JSON.stringify(EMPTY_USAGE)},spans:[{id:'example-write',kind:'tool',name:'Synthetic local file write',startMs:0,durationMs:duration,timing:'measured',status:'ok',firstTokenMs:null,outputTokens:null,sessionKey:null,eventId:null}]}));`, { mode: 0o600 });
  await writeFile(evaluator, `const fs=require('node:fs');const sum=require(process.env.BENCHMARK_WORKSPACE+'/sum.cjs');const passed=[[2,3,5],[-1,1,0],[0,0,0]].filter(([a,b,want])=>sum(a,b)===want).length;fs.writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed,total:3,quality:${JSON.stringify(EMPTY_QUALITY)}}));process.exitCode=passed===3?0:1;`, { mode: 0o600 });
  const manifest: BenchmarkManifest = { version: 1, name: `SYNTHETIC ${input.name}`.slice(0, 120), repetitions: input.repetitions,
    task: { id: 'synthetic-addition', repository, ref: 'HEAD', prompt: 'Implement addition. Synthetic local example, no model invocation.', expectedTests: 3, evaluator: [process.execPath, evaluator], timeoutMs: 10000 },
    variants: input.variants.map((v, i) => ({ id: `example-${i}`, product: v.product, model: v.model, environment: 'synthetic local fixture', parameters: 'fixed fixture', toolSet: 'local file write', driver: [process.execPath, driver] })) };
  return runBenchmark(manifest, { output: join(root, 'results'), signal, synthetic: true });
}
