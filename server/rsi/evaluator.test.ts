import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBank, readQuestionData } from './bank.js';
import { classifyApply, evaluatePatch } from './evaluator.js';
import type { CommandResult, CommandOptions, DockerClient } from './docker.js';
import { unpackFiles } from './artifacts.js';
import { parseReport, testArgv } from './reporters/parse.js';
const ok = (stdout = '', code = 0): CommandResult => ({ code, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), timedOut: false, cancelled: false, overflow: false });
const report = (tests = 1, failed = 0): string => JSON.stringify({ reporter: 'rsi-node-v1', tests, passed: tests - failed, failed, skipped: 0, cancelled: 0, todo: 0 });
class FakeDocker implements DockerClient {
  calls: string[][] = []; transfers: Array<{ index: number; files: string[] }> = []; result = ok(report()); apply = ok(); denied = false;
  async run(argv: string[], options?: CommandOptions): Promise<CommandResult> {
    this.calls.push(argv);
    if (argv.includes('tar') && Buffer.isBuffer(options?.input)) this.transfers.push({ index: this.calls.length - 1, files: [...unpackFiles(options.input).keys()] });
    if (this.denied && argv.includes('tar')) return { ...ok('', 1), stderr: Buffer.from('Permission denied') };
    if (argv.includes('memory.peak')) return ok('1024');
    if (argv.some(a => a.includes('memory.peak'))) return ok('1024');
    if (argv.includes('apply')) return this.apply;
    if (argv.includes('--test')) return this.result;
    return ok();
  }
}
describe('two-stage trusted evaluator', () => {
  it('overlays hidden tests only after apply, uses network none and reads cgroup before rm', async () => {
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), q = bank.questions.get('train_node')!, docker = new FakeDocker();
    const r = await evaluatePatch(docker, 'task', q, await readQuestionData(resolve(bank.root, 'tasks/train_node')), Buffer.from('patch'), 'evaluator', resolve('server/rsi/reporters'));
    expect(r.outcome).toBe('pass'); expect(r.memoryPeakBytes).toBe(1024);
    expect(docker.calls[0]).toContain('none');
    expect(docker.calls.findIndex(a => a.includes('apply'))).toBeLessThan(docker.transfers.find(t => t.files.includes('checks.test.mjs'))!.index);
    expect(docker.calls.at(-2)).toContain('/sys/fs/cgroup/memory.peak'); expect(docker.calls.at(-1)![0]).toBe('rm');
  });
  it.each(['failed', 'timeout', 'bad-count', 'permissions'] as const)('classifies %s correctly', async kind => {
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), docker = new FakeDocker();
    if (kind === 'failed') docker.result = ok(report(1, 1), 1);
    if (kind === 'timeout') docker.result = { ...ok('', 137), timedOut: true };
    if (kind === 'bad-count') docker.result = ok(report(2));
    if (kind === 'permissions') docker.denied = true;
    const r = await evaluatePatch(docker, 'task', bank.questions.get('train_node')!, await readQuestionData(resolve(bank.root, 'tasks/train_node')), Buffer.alloc(0), 'evaluator', resolve('server/rsi/reporters'));
    expect(r.outcome).toBe(kind === 'failed' || kind === 'timeout' ? 'fail' : 'infra_error');
  });
  it('does not treat every git apply exit 1 as a candidate failure', () => {
    expect(classifyApply({ ...ok('', 1), stderr: Buffer.from('error: patch failed: answer.mjs:1') })).toBe('fail');
    for (const text of ['Permission denied', 'cannot create file', 'unknown error', 'No space left on device']) expect(classifyApply({ ...ok('', 1), stderr: Buffer.from(text) })).toBe('infra_error');
    expect(classifyApply({ ...ok('', 128), stderr: Buffer.from('patch failed') })).toBe('infra_error');
  });
  it('rejects forged/partial/skipped reports and builds platform argv', async () => {
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank'));
    const q = bank.questions.get('train_node')!;
    expect(testArgv(q)).toEqual(['node', '--test', '--test-reporter=/opt/rsi/node.mjs', '--', 'checks.test.mjs']);
    for (const text of ['', 'pass', report(0), `${report()}\n${report()}`, report().replace('"skipped":0', '"skipped":1')]) expect(parseReport(text, 0, q).outcome).toBe('infra_error');
    expect(parseReport(JSON.stringify({ reporter: 'rsi-unittest-v1', tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }), 0, { report: 'unittest-json', expectedTests: 1 }).outcome).toBe('pass');
  });
  it('counts Go test events once, requires package completion and rejects missing tests', () => {
    const q = { report: 'go-test-json' as const, expectedTests: 1 };
    const lines = [{ Action: 'run', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p' }].map(x => JSON.stringify(x)).join('\n');
    expect(parseReport(lines, 0, q).outcome).toBe('pass');
    expect(parseReport(lines, 1, q).outcome).toBe('fail');
    expect(parseReport(lines, 0, { ...q, expectedTests: 2 }).outcome).toBe('infra_error');
    expect(parseReport(`${lines}\n${JSON.stringify({ Action: 'pass', Package: 'p', Test: 'TestA' })}`, 0, q).outcome).toBe('infra_error');
  });
});
