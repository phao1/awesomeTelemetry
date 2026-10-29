import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCommand } from '../benchmark/runner.js';
import { DEFAULT_FOLDING_PLAN, loadFoldingExample } from './catalog.js';
import { freshFoldingProject, runFoldingExperiment } from './runner.js';
import { externalFoldingChecks } from './external.js';

const dirs: string[] = []; afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
it('runs real isolated Git/argv workers for distinct case prompts and keeps the independent evaluator private', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-external-')); dirs.push(dir);
  const repository = join(dir, 'repo');
  const init = await runCommand(['git', 'init', repository], dir, process.env, 10000); expect(init.status).toBe('completed');
  const driver = `import fs from 'node:fs';const c=JSON.parse(fs.readFileSync(process.env.BENCHMARK_CONTEXT,'utf8'));if(process.env.TEAM_EXPERIMENT_CASES_PATH)process.exit(9);fs.writeFileSync('actual.json',JSON.stringify({prompt:c.prompt,id:c.task.id,mode:c.mode,workspace:c.workspace}));fs.writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed:0,total:1,quality:Object.fromEntries(['loc','vulnerabilities','duplicationPct','complexity','redundancy','buildWarnings','staticWarnings','critical','major','minor','suggestion'].map(k=>[k,null]))}));`;
  const evaluator = `import fs from 'node:fs';const c=JSON.parse(fs.readFileSync(process.env.BENCHMARK_CONTEXT,'utf8')),a=JSON.parse(fs.readFileSync('actual.json','utf8'));const ok=a.id===c.task.id&&a.prompt.includes(c.task.id);const quality=Object.fromEntries(['loc','vulnerabilities','duplicationPct','complexity','redundancy','buildWarnings','staticWarnings','critical','major','minor','suggestion'].map(k=>[k,null]));fs.writeFileSync(process.env.BENCHMARK_VERDICT_PATH,JSON.stringify({passed:ok?1:0,total:1,quality}));fs.writeFileSync(process.env.TEAM_EXPERIMENT_CASES_PATH,JSON.stringify([{id:c.task.id,status:ok?'passed':'failed',detail:JSON.stringify({folding_checks:[{id:'one',passed:ok},{id:'two',passed:ok}]})}]));`;
  await writeFile(join(repository, 'driver.mjs'), driver); await writeFile(join(repository, 'evaluator.mjs'), evaluator);
  for (const args of [['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']]) expect((await runCommand(['git', '-C', repository, ...args], dir, process.env, 10000)).status).toBe('completed');
  const project = freshFoldingProject(await loadFoldingExample());
  project.cases = ['case-a', 'case-b'].map(id => ({ id, title: id, turns: [`Complete ${id}`], customerId: null, tags: [], checks: [{ id: 'one', kind: 'external', expected: true, required: true }, { id: 'two', kind: 'external', expected: true, required: true }], requiredChains: [], split: 'train', evidenceIds: [] }));
  const plan = { ...structuredClone(DEFAULT_FOLDING_PLAN), skillAblation: false, adapter: 'external' as const, caseIds: project.cases.map(c => c.id), repetitions: 1, schedule: 'parallel' as const, external: { repository, ref: 'HEAD', baselineDriver: [process.execPath, 'driver.mjs'], candidateDriver: [process.execPath, 'driver.mjs'], evaluator: [process.execPath, 'evaluator.mjs'], cases: project.cases, project } };
  const output = join(dir, 'output'), report = await runFoldingExperiment(project, plan, { output });
  expect(report.trials).toHaveLength(4); expect(report.trials.every(t => t.harnessError === null && t.grade === null && t.repetition === 0)).toBe(true);
  const children = (await readdir(output)).filter(name => name.startsWith('case-'));
  const workspaces: string[] = [], prompts: string[] = [];
  for (const child of children) for (const variant of ['baseline', 'candidate']) {
    const actual = JSON.parse(await readFile(join(output, child, `${variant}-1/workspace/actual.json`), 'utf8')) as { workspace: string; prompt: string; mode: string };
    workspaces.push(actual.workspace); prompts.push(actual.prompt); expect(actual.mode).toBe('subagents');
    const legacy = JSON.parse(await readFile(join(output, child, 'report.json'), 'utf8')) as { trials: Array<{ run: { verdict: { passed: number } } }> };
    expect(legacy.trials.every(t => t.run.verdict.passed === 1)).toBe(true);
  }
  expect(new Set(workspaces).size).toBe(4); expect(new Set(prompts).size).toBe(2); expect(await readdir(repository)).not.toContain('actual.json');
});
it('accepts only exact independently named check sets; legacy case-level detail remains unknown', async () => {
  const project = await loadFoldingExample(), task = project.cases[0]!;
  expect(externalFoldingChecks(task, 'legacy passed', 'e')).toBeNull();
  const detail = JSON.stringify({ folding_checks: task.checks.map(c => ({ id: c.id, passed: true })) });
  expect(externalFoldingChecks(task, detail, 'e')?.every(c => c.passed)).toBe(true);
  expect(() => externalFoldingChecks(task, JSON.stringify({ folding_checks: [{ id: 'wrong', passed: true }] }), 'e')).toThrow('check');
});
