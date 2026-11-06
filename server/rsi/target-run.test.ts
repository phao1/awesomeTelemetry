import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { readAgentProfile } from './agent-profile.js';
import { runTarget } from './target-run.js';
import { packTree } from './artifacts.js';
import { readBank, readQuestionData } from './bank.js';
import type { CommandOptions, CommandResult, DockerClient } from './docker.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
function ok(text: string | Buffer = ''): CommandResult { return { code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0), timedOut: false, cancelled: false, overflow: false }; }
describe('target container P0 regressions', () => {
  it.each([false, true])('exports new files/session tar and samples cgroup before removal; timeout=%s', async timedOut => {
    const root = await mkdtemp(join(tmpdir(), 'target-')); dirs.push(root);
    const db = new Database(join(root, 'session.db'));
    db.exec('CREATE TABLE session_v2 (tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER); INSERT INTO session_v2 VALUES(10,20,5,15,10)'); db.close();
    const archive = await packTree(root), calls: Array<{ argv: string[]; input: boolean }> = [];
    const patch = 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n';
    const docker: DockerClient = { run: async (argv: string[], options?: CommandOptions) => {
      calls.push({ argv, input: !!options?.input });
      if (argv.includes('{{json .NetworkSettings.Networks}}')) return ok('{"internal":{}}');
      if (argv.includes('{{json .Mounts}}')) return ok('[]');
      if (argv.includes('opencode') && argv.includes('run')) return { ...ok('{}'), timedOut, code: timedOut ? 137 : 0 };
      if (argv.includes('--cached')) return ok(patch);
      if (argv.includes('-cf')) return ok(archive);
      if (argv.includes('/sys/fs/cgroup/memory.peak')) return ok('2048');
      return ok();
    } };
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), q = bank.questions.get('train_node')!;
    const data = await readQuestionData(join(bank.root, 'tasks/train_node'));
    const r = await runTarget(docker, 'task', q, data.repo, data.statement, 'target-node', { name: 'proxy', network: 'internal', token: 'temporary', runId: 'run' }, join(root, 'out'), (await readAgentProfile(resolve('rsi-agents/opencode/profile.json'))).profile, 'fixed', 1000);
    expect(r.failureReason).toBe(timedOut ? 'agent_timeout' : null); expect(r.memoryPeakBytes).toBe(2048);
    expect(calls.at(-2)!.argv).toContain('/sys/fs/cgroup/memory.peak'); expect(calls.at(-1)!.argv[0]).toBe('rm');
    expect(calls.filter(c => c.argv.includes('tar') && c.argv.includes('-xf')).every(c => c.input && c.argv.includes('-i'))).toBe(true);
    expect(calls[0]!.argv.join(' ')).not.toContain(q.questionId); expect(calls[0]!.argv).not.toContain('-w');
    if (!timedOut) {
      const at = calls.findIndex(c => c.argv.includes('--cached')); expect(calls[at - 1]!.argv.slice(-3)).toEqual(['git', 'add', '-A']);
      expect(calls[at]!.argv).toContain('--binary'); expect(r.patch.toString()).toBe(patch); expect(r.sessionTokens).toBe(60);
    }
  });
});

it('runs the none-session Agent using profile argv/env without loading a native database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'target-none-')); dirs.push(root);
  const calls: string[][] = [], statement = 'repair "quoted"; $(no-shell)';
  const docker: DockerClient = { run: async argv => {
    calls.push(argv);
    if (argv.includes('{{json .NetworkSettings.Networks}}')) return ok('{"internal":{}}');
    if (argv.includes('{{json .Mounts}}')) return ok('[]');
    if (argv.includes('-cf')) return ok(await packTree(root));
    if (argv.includes('/sys/fs/cgroup/memory.peak')) return ok('2048');
    return ok();
  } };
  const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), q = bank.questions.get('train_node')!;
  const data = await readQuestionData(join(bank.root, 'tasks/train_node'));
  const { profile } = await readAgentProfile(resolve('rsi-agents/mini-agent/profile.json'));
  const result = await runTarget(docker, 'task', q, data.repo, statement, 'target-node', { name: 'proxy', network: 'internal', token: 'temporary', runId: 'run' }, join(root, 'out'), profile, 'fixed', 1000);
  expect(result.failureReason).toBeNull(); expect(result.sessionTokens).toBeNull(); expect(result.sessionPath).toBe('session');
  expect(calls.find(argv => argv.includes('/opt/mini-agent/agent.mjs'))!.slice(-3)).toEqual(['node', '/opt/mini-agent/agent.mjs', statement]);
  expect(calls[0]).toContain('OPENAI_API_KEY=temporary'); expect(calls[0]).not.toContain('OPENCODE_DB=/data/session.db');
});

describe('Agent exit classification', () => {
  const run = async (result: Partial<CommandResult>): Promise<string | null> => {
    const root = await mkdtemp(join(tmpdir(), 'target-exit-')); dirs.push(root);
    const docker: DockerClient = { run: async argv => {
      if (argv.includes('{{json .NetworkSettings.Networks}}')) return ok('{"internal":{}}');
      if (argv.includes('{{json .Mounts}}')) return ok('[]');
      if (argv.includes('/opt/mini-agent/agent.mjs')) return { ...ok(), ...result };
      if (argv.includes('-cf')) return ok(await packTree(root));
      if (argv.includes('/sys/fs/cgroup/memory.peak')) return ok('2048');
      return ok();
    } };
    const bank = await readBank(resolve('server/rsi/__fixtures__/bank')), q = bank.questions.get('train_node')!;
    const data = await readQuestionData(join(bank.root, 'tasks/train_node'));
    const { profile } = await readAgentProfile(resolve('rsi-agents/mini-agent/profile.json'));
    return (await runTarget(docker, 'task', q, data.repo, 'statement', 'target-node', { name: 'proxy', network: 'internal', token: 'temporary', runId: 'run' }, join(root, 'out'), profile, 'fixed', 1000)).failureReason;
  };
  it.each([1, 2, 137])('a crash with exit %i is the Agent failing, so a broken candidate cannot pause the task', async code => {
    expect(await run({ code })).toBe('agent_crashed');
  });
  it('an Agent that floods its output fails instead of looking like an infrastructure problem', async () => {
    expect(await run({ code: 0, overflow: true })).toBe('agent_crashed');
  });
  it.each([125, 126, 127, null])('docker failing to start the command stays infrastructure (exit %s)', async code => {
    expect(await run({ code })).toBe('infrastructure');
  });
  it('a cancelled run stays infrastructure', async () => {
    expect(await run({ code: 1, cancelled: true })).toBe('infrastructure');
  });
});
