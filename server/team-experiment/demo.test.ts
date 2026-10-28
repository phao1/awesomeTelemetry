import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runSuccess } from '../../src/core/benchmark-analysis.js';
import { validateTeamExperimentReport } from '../../src/core/team-experiment-validation.js';
import { runTeamExperimentDemo } from './demo.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('executes real isolated fixture workers, IPC and independent named acceptance without models', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'team-experiment-demo-')); directories.push(directory);
  const report = await runTeamExperimentDemo({ name: 'Modes', repetitions: 1, schedule: 'parallel', variants: [{ mode: 'single_loop', prompt: 'single prompt' }, { mode: 'subagents', prompt: 'delegate prompt' }, { mode: 'agent_team', prompt: 'team prompt' }] }, directory);
  expect(validateTeamExperimentReport(report)).toEqual(report);
  expect(report.synthetic).toBe(true); expect(report.trials).toHaveLength(3);
  expect(report.trials.every(t => runSuccess(t.run, 3) && t.cases?.every(c => c.status === 'passed'))).toBe(true);
  expect(report.trials.every(t => t.run.telemetry?.actualModel === null)).toBe(true);
  expect(report.trials.map(t => t.evidence?.agents.length)).toEqual([1, 3, 3]);
  expect(report.trials[1]!.evidence!.events.filter(e => e.kind === 'message')).toHaveLength(4);
  expect(report.trials[2]!.evidence!.events.some(e => e.kind === 'verification')).toBe(true);
  const [id] = await readdir(directory), result = join(directory, id!, 'results');
  const processes = await Promise.all(report.trials.map(async t => JSON.parse(await readFile(join(result, t.id, 'workspace', 'fixture-process.json'), 'utf8')) as { pid: number; origin: number; completed: number }));
  expect(new Set(processes.map(p => p.pid)).size).toBe(3);
  expect(processes.every(p => p.completed >= p.origin)).toBe(true);
}, 20000);
