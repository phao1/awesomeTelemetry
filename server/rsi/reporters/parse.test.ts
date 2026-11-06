import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../docker.js';
import { parseReport } from './parse.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('actual trusted reporter processes', () => {
  it.each(['node', 'python'] as const)('runs real %s tests with exact inventory', async tool => {
    const root = await mkdtemp(join(tmpdir(), 'reporter-')); dirs.push(root);
    const fixture = resolve(`server/rsi/__fixtures__/bank/tasks/train_${tool}`);
    await cp(join(fixture, 'repo'), root, { recursive: true }); await cp(join(fixture, 'hidden_tests'), root, { recursive: true });
    const report = tool === 'node' ? 'node-test-events' as const : 'unittest-json' as const;
    const argv = tool === 'node' ? ['--test', `--test-reporter=${resolve('server/rsi/reporters/node.mjs')}`, 'checks.test.mjs'] : ['-I', resolve('server/rsi/reporters/unittest.py'), 'test_checks.py'];
    const r = await runProcess(tool === 'node' ? process.execPath : 'python3', argv, { cwd: root });
    expect(parseReport(r.stdout.toString(), r.code, { report, expectedTests: 1 }).outcome).toBe('fail');
    expect(parseReport(r.stdout.toString(), r.code, { report, expectedTests: 2 }).outcome).toBe('infra_error');
  });
});
