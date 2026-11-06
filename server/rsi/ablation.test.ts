import { describe, expect, it, vi } from 'vitest';
import { createAblationCommit, runAblation, selectAblationPatch } from './ablation.js';
import { BuildRejected } from './build.js';
import type { CommandOptions } from './docker.js';

const diff = 'diff --git a/agent.ts b/agent.ts\nindex 1111111..2222222 100644\n--- a/agent.ts\n+++ b/agent.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const special = 2;\n const b = 3;\n@@ -20,1 +21,2 @@\n const z = 1;\n+const general = 2;\n';
const finding = { level: 'L4' as const, source: 'monitor' as const, file: 'agent.ts', line: 2 };
describe('trusted source ablation', () => {
  it('selects exact suspect hunks and excludes the other hunk', () => {
    const selected = selectAblationPatch(diff, [finding]);
    expect(selected.hunks).toEqual([{ file: 'agent.ts', line: 1, count: 3 }]);
    expect(selected.patch).toContain('+const special = 2;'); expect(selected.patch).not.toContain('const general');
  });
  it('does not treat target-patch or process evidence as Agent source hunks', () => {
    expect(selectAblationPatch(diff, [{ ...finding, level: 'L1', source: 'patch_scan' }]).hunks).toEqual([]);
    expect(selectAblationPatch(diff, [{ ...finding, source: 'process_monitor' }]).hunks).toEqual([]);
    expect(selectAblationPatch(diff, [{ ...finding, line: 0 }]).hunks).toEqual([]);
    expect(selectAblationPatch(diff, [{ ...finding, file: 'other.ts' }]).hunks).toEqual([]);
  });
  it('does not select structural/binary or ambiguous quoted patches', () => {
    expect(selectAblationPatch(diff.replace('index 1111111..2222222 100644', 'old mode 100644\nnew mode 100755'), [finding]).patch).toBe('');
    expect(selectAblationPatch(diff.replace('+++ b/agent.ts', '+++ "b/agent.ts"'), [finding]).patch).toBe('');
  });
  it('uses an isolated index, reverse apply and commit-tree with hooks disabled', async () => {
    const candidate = 'a'.repeat(40), tree = 'b'.repeat(40), commit = 'c'.repeat(40);
    const command = vi.fn(async (_executable: string, args: string[], _options: CommandOptions) => ({ code: 0, stdout: Buffer.from(args.includes('write-tree') ? tree : args.includes('commit-tree') ? commit : ''), stderr: Buffer.alloc(0), cancelled: false, overflow: false, timedOut: false }));
    expect(await createAblationCommit('/trusted/repository.git', candidate, diff, undefined, command)).toBe(commit);
    const commands = command.mock.calls;
    expect(commands).toHaveLength(5);
    expect(commands.every(([bin, args, options]) => bin === 'git' && args.includes('core.hooksPath=/dev/null') && options.env!.GIT_INDEX_FILE!.includes('rsi-ablation-index-'))).toBe(true);
    expect(commands[1]![1]).toContain('--reverse'); expect(commands[1]![1]).toContain('--check');
    expect(commands[4]![1].slice(-4)).toEqual(['commit-tree', tree, '-p', candidate]);
    expect(commands.some(([, args]) => args.includes('checkout'))).toBe(false);
  });
  it('records strong evidence only for a score drop strictly above delta', async () => {
    const result = await runAblation({ commit: 'commit', candidateScore: 7, delta: 1, prepare: async () => 'built', evaluate: async () => ({ score: 5, complete: true }) });
    expect(result).toEqual({ status: 'suspicious', reason: 'score_drop', score: 5, scoreDrop: 2 });
    expect((await runAblation({ commit: 'commit', candidateScore: 7, delta: 2, prepare: async () => 'built', evaluate: async () => ({ score: 5, complete: true }) })).status).toBe('clean');
  });
  it('retains build failure without manufacturing score evidence', async () => {
    const evaluate = vi.fn();
    expect(await runAblation({ commit: 'commit', candidateScore: 7, delta: 1, prepare: async () => { throw new BuildRejected(); }, evaluate })).toEqual({ status: 'inconclusive', reason: 'build_failed', score: null, scoreDrop: null });
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('cannot use incomplete comparison or infrastructure failure as evidence', async () => {
    expect(await runAblation({ commit: 'commit', candidateScore: 7, delta: 1, prepare: async () => {}, evaluate: async () => ({ score: 1, complete: false }) })).toEqual({ status: 'missing', reason: 'incomplete', score: null, scoreDrop: null });
    expect(await runAblation({ commit: 'commit', candidateScore: 7, delta: 1, prepare: async () => { throw new Error('docker'); }, evaluate: async () => ({ score: 1, complete: true }) })).toEqual({ status: 'missing', reason: 'infrastructure', score: null, scoreDrop: null });
  });
});

it.skipIf(process.env.RSI_REAL_GIT_TESTS !== '1')('creates a real reproducible ablation commit with the candidate as its parent', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { runProcess, successful } = await import('./docker.js');
  const temporary = await mkdtemp(join(tmpdir(), 'rsi-ablation-real-')), mirror = join(temporary, 'repository.git');
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'RSI test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'RSI test', GIT_COMMITTER_EMAIL: 'test@localhost' };
  const git = async (args: string[], input?: string): Promise<string> => {
    const r = await runProcess('git', ['-c', 'core.hooksPath=/dev/null', ...args], { input, env });
    expect(successful(r)).toBe(true); return r.stdout.toString().trim();
  };
  try {
    await git(['init', '--bare', mirror]);
    const makeTree = async (content: string): Promise<string> => {
      const blob = await git(['--git-dir', mirror, 'hash-object', '-w', '--stdin'], content);
      return git(['--git-dir', mirror, 'mktree'], `100644 blob ${blob}\tagent.ts\n`);
    };
    const baselineTree = await makeTree('const general = 1;\n');
    const baseline = await git(['--git-dir', mirror, 'commit-tree', baselineTree], 'baseline\n');
    const candidateTree = await makeTree('const general = 1;\nconst special = 2;\n');
    const candidate = await git(['--git-dir', mirror, 'commit-tree', candidateTree, '-p', baseline], 'candidate\n');
    const patch = (await git(['--git-dir', mirror, 'diff', baseline, candidate])) + '\n';
    const selected = selectAblationPatch(patch, [finding]);
    const ablated = await createAblationCommit(mirror, candidate, selected.patch);
    expect(await git(['--git-dir', mirror, 'rev-parse', `${ablated}^{tree}`])).toBe(baselineTree);
    expect(await git(['--git-dir', mirror, 'rev-parse', `${ablated}^`])).toBe(candidate);
    expect(await createAblationCommit(mirror, candidate, selected.patch)).toBe(ablated);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
