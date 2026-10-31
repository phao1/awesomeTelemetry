// Local subprocess acceptance smoke. No GUI/model/network calls.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { runBenchmark } from '../server-dist/benchmark.js';

const directory = await mkdtemp(join(tmpdir(), 'telemetry-benchmark-demo-'));
const git = args => new Promise((done, fail) => {
  const child = spawn('git', args, { cwd: directory, stdio: 'ignore' });
  child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error('Demo Git setup failed.')));
});
await git(['init']); await git(['config', 'user.name', 'Telemetry Demo']); await git(['config', 'user.email', 'demo@example.invalid']);
await writeFile(join(directory, 'sum.cjs'), 'module.exports=(a,b)=>0;\n');
await git(['add', 'sum.cjs']); await git(['commit', '-m', 'Synthetic task fixture']);
const driver = join(directory, 'driver.cjs'), evaluator = join(directory, 'evaluator.cjs');
const quality = Object.fromEntries(['loc', 'vulnerabilities', 'duplicationPct', 'complexity', 'redundancy', 'buildWarnings', 'staticWarnings', 'critical', 'major', 'minor', 'suggestion'].map(k => [k, null]));
await writeFile(driver, `const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(process.env.BENCHMARK_CONTEXT));fs.writeFileSync('sum.cjs',c.variant.id==='fixture-pass'?'module.exports=(a,b)=>a+b;':'module.exports=(a,b)=>a-b;');`);
await writeFile(evaluator, `const fs=require('node:fs');const sum=require(process.env.BENCHMARK_WORKSPACE+'/sum.cjs');const cases=[[2,3,5],[-1,1,0],[0,0,0]];const passed=cases.filter(([a,b,want])=>sum(a,b)===want).length;fs.writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed,total:3,quality:${JSON.stringify(quality)}}));process.exitCode=passed===3?0:1;`);
const manifest = { version: 1, name: 'SYNTHETIC local subprocess acceptance', repetitions: 3,
  task: { id: 'synthetic-addition', repository: directory, ref: 'HEAD', prompt: 'Implement addition.', expectedTests: 3, evaluator: [process.execPath, evaluator], timeoutMs: 10000 },
  variants: ['pass', 'fail'].map(kind => ({ id: `fixture-${kind}`, product: `Synthetic ${kind} driver`, model: 'none-local-fixture', environment: 'synthetic local', parameters: 'fixed', toolSet: 'local file write', driver: [process.execPath, driver] })) };
const output = process.argv[2] ? resolve(process.argv[2]) : join(directory, 'results');
await runBenchmark(manifest, { output, synthetic: true, onProgress: console.log });
console.log(`Import ${join(output, 'report.json')} in the Benchmark center. All workspaces are retained in ${directory}.`);
