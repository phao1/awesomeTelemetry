import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runTeamExperimentCli } from './cli.js';
import { runTeamExperimentDemo } from './demo.js';
import { validateTeamExperimentReport } from '../../src/core/team-experiment-validation.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('validates a plan without touching its nonexistent repository or invoking its driver', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'team-experiment-cli-plan-')); directories.push(directory);
  const value = JSON.parse(await readFile(new URL('../../config/team-experiment.example.json', import.meta.url), 'utf8')) as object;
  const path = join(directory, 'plan.json'); await writeFile(path, JSON.stringify(value));
  await runTeamExperimentCli([path]);
  expect(await readdir(directory)).toEqual(['plan.json']);
  await expect(runTeamExperimentCli([path, '--execute'])).rejects.toThrow('--output is required');
  await expect(runTeamExperimentCli([path, '--unrecognized'])).rejects.toThrow('Invalid team experiment arguments');
});
it('executes only on the explicit CLI flag and writes the independently checked report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'team-experiment-cli-run-')); directories.push(directory);
  const fixture = await runTeamExperimentDemo({ name: 'CLI fixture', repetitions: 1, schedule: 'parallel', variants: [{ mode: 'single_loop', prompt: 'single' }, { mode: 'subagents', prompt: 'delegate' }] }, directory);
  const planPath = join(directory, 'plan.json'), output = join(directory, 'explicit');
  await writeFile(planPath, JSON.stringify(fixture.plan));
  const previous = process.exitCode;
  try {
    await runTeamExperimentCli([planPath, '--execute', '--output', output, '--synthetic']);
    expect(process.exitCode).toBe(0);
    const report = validateTeamExperimentReport(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')));
    expect(report.synthetic).toBe(true);
    expect(report.trials).toHaveLength(2);
    expect(report.trials.every(t => t.cases?.every(c => c.status === 'passed'))).toBe(true);
  } finally { process.exitCode = previous; }
}, 20000);
