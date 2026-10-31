import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { TeamExperimentPlan } from '../../src/core/team-experiment-types.js';
import { EMPTY_QUALITY, EMPTY_USAGE } from '../../src/core/benchmark-types.js';
import { validateTeamExperimentReport } from '../../src/core/team-experiment-validation.js';
import { runSuccess } from '../../src/core/benchmark-analysis.js';
import { readBenchmarkJson, runCommand } from '../benchmark/runner.js';
import { runTeamExperiment } from './runner.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'team-experiment-test-')); directories.push(directory);
  for (const argv of [['git', 'init', directory], ['git', '-C', directory, 'config', 'user.name', 'Fixture'], ['git', '-C', directory, 'config', 'user.email', 'fixture@example.invalid']]) expect((await runCommand(argv, directory, process.env, 10000)).status).toBe('completed');
  await writeFile(join(directory, 'answer.txt'), 'original');
  expect((await runCommand(['git', 'add', 'answer.txt'], directory, process.env, 10000)).status).toBe('completed');
  expect((await runCommand(['git', 'commit', '-m', 'Pinned fixture'], directory, process.env, 10000)).status).toBe('completed');
  const driver = join(directory, 'driver.cjs'), evaluator = join(directory, 'evaluator.cjs');
  await writeFile(driver, `const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(process.env.BENCHMARK_CONTEXT));if(process.env.TEAM_EXPERIMENT_CASES_PATH)process.exit(8);if(fs.readFileSync('answer.txt','utf8')!=='original')process.exit(9);fs.writeFileSync('answer.txt','fixed');fs.writeFileSync('driver-context.json',JSON.stringify(c));fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,JSON.stringify({actualModel:c.variant.model,sessionKey:null,complete:true,usage:${JSON.stringify(EMPTY_USAGE)},spans:[]}));`);
  await writeFile(evaluator, `const fs=require('node:fs');const passed=fs.readFileSync('answer.txt','utf8')==='fixed'?1:0;fs.writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed,total:1,quality:${JSON.stringify(EMPTY_QUALITY)}}));fs.writeFileSync(process.env.TEAM_EXPERIMENT_CASES_PATH,JSON.stringify([{id:'answer',status:passed?'passed':'failed',detail:null}]));process.exitCode=passed?0:1;`);
  const base = { product: 'Fixture', model: 'same-model', environment: 'local', parameters: 'fixed', toolSet: 'fixed', driver: [process.execPath, driver] };
  const plan: TeamExperimentPlan = { version: 1, kind: 'team-experiment', name: 'Mode comparison', repetitions: 1, schedule: 'parallel', task: { id: 'answer-task', repository: directory, ref: 'HEAD', prompt: 'Fix the answer', caseIds: ['answer'], expectedTests: 1, evaluator: [process.execPath, evaluator], timeoutMs: 10000 },
    variants: [{ ...base, id: 'single', mode: 'single_loop', prompt: 'Fix it in a single loop' }, { ...base, id: 'delegated', mode: 'subagents', prompt: 'Delegate an independent subtask then fix it' }] };
  return { directory, driver, evaluator, plan };
}
it('prepares all pinned workspaces before parallel drivers and preserves exact per-variant prompts', async () => {
  const { directory, driver, plan } = await setup(); plan.repetitions = 2;
  const original = await readFile(driver, 'utf8');
  await writeFile(driver, `const path=require('node:path');${original}const root=path.dirname(path.dirname(process.env.BENCHMARK_CONTEXT));const r=c.repetition;for(const id of ['single','delegated'])if(!fs.existsSync(path.join(root,id+'-'+r,'workspace','answer.txt')))process.exit(10);fs.writeFileSync(path.join(root,c.variant.id+'-'+r+'.ready'),'ready');const timer=setInterval(()=>{if(['single','delegated'].every(id=>fs.existsSync(path.join(root,id+'-'+r+'.ready')))){clearInterval(timer);fs.writeFileSync('paired-barrier.json',JSON.stringify({pid:process.pid,passed:true}));}},10);`);
  const output = join(directory, 'parallel'), report = await runTeamExperiment(plan, { output, synthetic: true });
  expect(report.trials.map(t => t.id)).toEqual(['single-1', 'delegated-1', 'single-2', 'delegated-2']);
  expect(report.trials.every(t => runSuccess(t.run, 1))).toBe(true);
  for (const trial of report.trials) {
    const variant = plan.variants.find(v => v.id === trial.variantId)!;
    expect(trial.promptSha256).toBe(createHash('sha256').update(variant.prompt).digest('hex'));
    expect(trial.run.phases.map(p => p.name)).toEqual(['checkout', 'pin', 'agent', 'evaluate']);
    expect(trial.cases).toEqual([{ id: 'answer', status: 'passed', detail: null }]);
    const workspace = join(output, trial.id, 'workspace');
    expect(JSON.parse(await readFile(join(workspace, 'paired-barrier.json'), 'utf8'))).toMatchObject({ passed: true });
    expect(JSON.parse(await readFile(join(workspace, 'driver-context.json'), 'utf8'))).toMatchObject({ prompt: variant.prompt, taskPrompt: plan.task.prompt, mode: variant.mode, task: { prompt: variant.prompt } });
  }
  expect(await readFile(join(directory, 'answer.txt'), 'utf8')).toBe('original');
  expect(validateTeamExperimentReport(await readBenchmarkJson(join(output, 'report.json')))).toEqual(report);
  await expect(runTeamExperiment(plan, { output })).rejects.toThrow();
}, 30000);
it('runs independent acceptance after malformed telemetry and malformed collaboration evidence', async () => {
  const { directory, driver, plan } = await setup();
  await writeFile(driver, `const fs=require('node:fs');if(process.env.TEAM_EXPERIMENT_CASES_PATH)process.exit(8);fs.writeFileSync('answer.txt','fixed');fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,'invalid JSON');fs.writeFileSync(process.env.TEAM_EXPERIMENT_EVIDENCE_PATH,JSON.stringify({bad:true}));`);
  const report = await runTeamExperiment(plan, { output: join(directory, 'malformed') });
  expect(report.trials.every(t => t.run.status === 'completed' && runSuccess(t.run, 1))).toBe(true);
  expect(report.trials.every(t => t.run.telemetry === null && t.evidence === null)).toBe(true);
  expect(report.trials.every(t => t.evidenceError?.includes('Telemetry') && t.evidenceError.includes('Collaboration'))).toBe(true);
  expect(report.trials.every(t => t.cases?.[0]?.status === 'passed')).toBe(true);
}, 20000);
it.each(['runner-evaluate', 'runner-checkout', 'runner-future-phase'])('keeps reserved driver span %s unknown and saves independent acceptance', async reservedId => {
  const { directory, driver, plan } = await setup(), original = await readFile(driver, 'utf8');
  await writeFile(driver, `${original}const t=JSON.parse(fs.readFileSync(process.env.BENCHMARK_RESULT_PATH));t.spans=[{id:${JSON.stringify(reservedId)},kind:'tool',name:'Reserved span fixture',startMs:0,durationMs:0,timing:'measured',status:'ok',firstTokenMs:null,outputTokens:null,sessionKey:null,eventId:null}];fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,JSON.stringify(t));`);
  const output = join(directory, 'reserved'), report = await runTeamExperiment(plan, { output, synthetic: true });
  expect(report.trials).toHaveLength(2);
  for (const trial of report.trials) {
    expect(trial.run.status).toBe('completed'); expect(runSuccess(trial.run, 1)).toBe(true);
    expect(trial.run.telemetry).toBeNull(); expect(trial.evidenceError).toContain('reserved runner-*');
    expect(trial.cases).toEqual([{ id: 'answer', status: 'passed', detail: null }]);
    const raw = await readBenchmarkJson(join(output, trial.id, 'telemetry.json')) as { spans: Array<{ id: string }> };
    expect(raw.spans[0]!.id).toBe(reservedId);
  }
  expect(validateTeamExperimentReport(await readBenchmarkJson(join(output, 'report.json')))).toEqual(report);
}, 20000);
it.each(['events', 'spans'] as const)('retains completed trials when the full-report %s budget is exhausted', async kind => {
  const { directory, driver, plan } = await setup(), original = await readFile(driver, 'utf8');
  plan.repetitions = 6;
  const fixture = kind === 'events'
    ? `const evidence={coverage:{roster:true,activities:true,communication:true},agents:[{id:'lead',name:'Lead',parentId:null,sessionKey:null}],events:Array.from({length:2000},(_,i)=>({id:'e'+i,agentId:'lead',targetAgentId:null,kind:'tool',name:'E',detail:null,startMs:0,durationMs:0,timing:'measured',status:'ok',dependsOn:[],tokens:null,sessionKey:null,eventId:null}))};fs.writeFileSync(process.env.TEAM_EXPERIMENT_EVIDENCE_PATH,JSON.stringify(evidence));`
    : `const telemetry=JSON.parse(fs.readFileSync(process.env.BENCHMARK_RESULT_PATH));telemetry.spans=Array.from({length:2000},(_,i)=>({id:'s'+i,kind:'tool',name:'S',startMs:0,durationMs:0,timing:'measured',status:'ok',firstTokenMs:null,outputTokens:null,sessionKey:null,eventId:null}));fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,JSON.stringify(telemetry));`;
  await writeFile(driver, original + fixture);
  const output = join(directory, `capacity-${kind}`), report = await runTeamExperiment(plan, { output, synthetic: true });
  expect(report.trials).toHaveLength(12);
  expect(report.trials.every(t => t.run.status === 'completed' && runSuccess(t.run, 1) && t.cases?.[0]?.status === 'passed')).toBe(true);
  const retained = (trial: typeof report.trials[number]) => kind === 'events' ? trial.evidence?.events ?? null : trial.run.telemetry?.spans ?? null;
  expect(report.trials.slice(0, 10).every(t => retained(t)?.length === 2000)).toBe(true);
  expect(report.trials.slice(10).every(t => retained(t) === null && t.evidenceError?.includes('全报告容量不足，该trial原始文件保留'))).toBe(true);
  expect(report.trials.reduce((n, t) => n + (retained(t)?.length ?? 0), 0)).toBe(20000);
  for (const trial of report.trials) {
    const raw = await readBenchmarkJson(join(output, trial.id, kind === 'events' ? 'evidence.json' : 'telemetry.json')) as { events?: unknown[]; spans?: unknown[] };
    expect(raw[kind]).toHaveLength(2000);
  }
  expect(validateTeamExperimentReport(await readBenchmarkJson(join(output, 'report.json')))).toEqual(report);
}, 30000);
it('keeps out-of-clock evidence unknown while still accepting the independently checked task', async () => {
  const { directory, driver, plan } = await setup();
  await writeFile(driver, `const fs=require('node:fs');fs.writeFileSync('answer.txt','fixed');fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,JSON.stringify({actualModel:'same-model',sessionKey:null,complete:true,usage:${JSON.stringify(EMPTY_USAGE)},spans:[{id:'late',kind:'tool',name:'Late',startMs:80000000,durationMs:1,timing:'measured',status:'ok',firstTokenMs:null,outputTokens:null,sessionKey:null,eventId:null}]}));fs.writeFileSync(process.env.TEAM_EXPERIMENT_EVIDENCE_PATH,JSON.stringify({coverage:{roster:true,activities:true,communication:true},agents:[{id:'lead',name:'Lead',parentId:null,sessionKey:null}],events:[{id:'late',agentId:'lead',targetAgentId:null,kind:'tool',name:'Late',detail:null,startMs:80000000,durationMs:1,timing:'measured',status:'ok',dependsOn:[],tokens:null,sessionKey:null,eventId:null}]}));`);
  const report = await runTeamExperiment(plan, { output: join(directory, 'outside-clock') });
  expect(report.trials.every(t => runSuccess(t.run, 1) && t.cases?.[0]?.status === 'passed')).toBe(true);
  expect(report.trials.every(t => t.run.telemetry === null && t.evidence === null && t.evidenceError !== null)).toBe(true);
}, 20000);
it('rejects the wrong named case set and removes inherited evaluator output paths from drivers', async () => {
  const { directory, evaluator, plan } = await setup(), previous = process.env.TEAM_EXPERIMENT_CASES_PATH;
  const original = await readFile(evaluator, 'utf8');
  await writeFile(evaluator, original.replace("id:'answer'", "id:'different-case'"));
  process.env.TEAM_EXPERIMENT_CASES_PATH = '/never-forward-an-evaluator-locator';
  try {
    const report = await runTeamExperiment(plan, { output: join(directory, 'wrong-cases') });
    expect(report.trials.every(t => t.run.status === 'completed' && t.run.verdict?.passed === 1)).toBe(true);
    expect(report.trials.every(t => t.cases === null && t.evidenceError?.includes('Named acceptance'))).toBe(true);
  } finally { if (previous === undefined) delete process.env.TEAM_EXPERIMENT_CASES_PATH; else process.env.TEAM_EXPERIMENT_CASES_PATH = previous; }
}, 20000);
it('does not accept a driver-seeded verdict when the independent evaluator supplies none', async () => {
  const { directory, driver, plan } = await setup();
  await writeFile(driver, `require('node:fs').writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed:1,total:1,quality:${JSON.stringify(EMPTY_QUALITY)}}));`);
  plan.task.evaluator = [process.execPath, '-e', 'process.exit(0)'];
  const report = await runTeamExperiment(plan, { output: join(directory, 'unknown') });
  expect(report.trials.every(t => t.run.status === 'completed' && t.run.verdict === null && t.cases === null)).toBe(true);
}, 20000);
it('supports sequential diagnosis and retains telemetry clocks relative to run preparation', async () => {
  const { directory, driver, plan } = await setup(); plan.schedule = 'sequential';
  const original = await readFile(driver, 'utf8');
  await writeFile(driver, `${original}const t=JSON.parse(fs.readFileSync(process.env.BENCHMARK_RESULT_PATH));t.spans=[{id:'write',kind:'tool',name:'write',startMs:0,durationMs:1,timing:'measured',status:'ok',firstTokenMs:null,outputTokens:null,sessionKey:null,eventId:null}];fs.writeFileSync(process.env.BENCHMARK_RESULT_PATH,JSON.stringify(t));`);
  const report = await runTeamExperiment(plan, { output: join(directory, 'sequential') });
  const [first, second] = report.trials;
  const absolute = (trial: typeof first, name: string) => Date.parse(trial!.run.startedAt) + trial!.run.phases.find(p => p.name === name)!.startMs;
  expect(absolute(second, 'agent')).toBeGreaterThan(absolute(first, 'evaluate'));
  for (const trial of report.trials) expect(trial.run.telemetry!.spans[0]!.startMs).toBe(trial.run.phases.find(p => p.name === 'agent')!.startMs);
}, 20000);
it('cancels owned concurrent processes and durably retains both finished cancellation records', async () => {
  const { directory, driver, plan } = await setup(), controller = new AbortController();
  await writeFile(driver, `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync('owned-pid',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
  const output = join(directory, 'cancelled');
  const pending = runTeamExperiment(plan, { output, signal: controller.signal });
  const pids: number[] = [];
  try {
    const deadline = Date.now() + 10000;
    while (pids.length < 4 && Date.now() < deadline) {
      pids.length = 0;
      for (const id of ['single-1', 'delegated-1']) { try { pids.push(...JSON.parse(await readFile(join(output, id, 'workspace', 'owned-pid'), 'utf8')) as number[]); } catch { /* Process has not reached its marker yet. */ } }
      if (pids.length < 4) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(pids).toHaveLength(4);
  } finally { controller.abort(); }
  const report = await pending;
  expect(report.trials).toHaveLength(2);
  expect(report.trials.every(t => t.run.status === 'cancelled')).toBe(true);
  expect(validateTeamExperimentReport(await readBenchmarkJson(join(output, 'report.json')))).toEqual(report);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  expect((await readdir(output)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  expect(dirname(output)).toBe(directory);
}, 20000);
it('stops the paired experiment on timeout rather than launching another repetition', async () => {
  const { directory, plan } = await setup(); plan.repetitions = 2; plan.task.timeoutMs = 100;
  plan.variants.forEach(v => { v.driver = [process.execPath, '-e', 'setInterval(()=>{},1000)']; });
  const report = await runTeamExperiment(plan, { output: join(directory, 'timeout') });
  expect(report.trials).toHaveLength(2);
  expect(report.trials.some(t => t.run.status === 'timeout')).toBe(true);
  expect(report.trials.every(t => ['timeout', 'cancelled'].includes(t.run.status))).toBe(true);
  expect(report.trials.every(t => t.repetition === 1)).toBe(true);
}, 20000);
