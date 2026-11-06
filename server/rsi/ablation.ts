import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RsiFinding, RsiReview } from '../../src/core/rsi-types.js';
import { BuildRejected } from './build.js';
import type { CommandOptions, CommandResult } from './docker.js';
import { runProcess, successful } from './docker.js';

export interface AblationSelection { patch: string; hunks: { file: string; line: number; count: number }[] }
/** Only Agent-source L1/L4 findings can select hunks. Target patches are a different repository. */
export function selectAblationPatch(diff: string, findings: Pick<RsiFinding, 'level' | 'source' | 'file' | 'line'>[]): AblationSelection {
  const selected: string[] = [], hunks: AblationSelection['hunks'] = [];
  const eligible = findings.filter(f => (f.level === 'L1' || f.level === 'L4') && f.source !== 'patch_scan' && f.source !== 'process_monitor' && f.file !== null && f.line !== null && f.line > 0);
  for (const section of diff.split(/(?=^diff --git )/m)) {
    if (!section.startsWith('diff --git ') || /^(?:GIT binary patch|old mode|new mode|rename from|rename to)/m.test(section)) continue;
    const headerEnd = section.search(/^@@ /m); if (headerEnd < 0) continue;
    const header = section.slice(0, headerEnd), path = /^\+\+\+ b\/(.+)$/m.exec(header)?.[1];
    if (!path || path.includes('"') || path.includes('\\') || path.split('/').some(p => !p || p === '..' || p === '.')) continue;
    const chosen: string[] = [];
    for (const hunk of section.slice(headerEnd).split(/(?=^@@ )/m)) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(hunk); if (!m) continue;
      const line = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]);
      if (!eligible.some(f => f.file === path && f.line! >= line && f.line! < line + Math.max(1, count))) continue;
      chosen.push(hunk); hunks.push({ file: path, line, count });
    }
    if (chosen.length) selected.push(header + chosen.join(''));
  }
  return { patch: selected.join(''), hunks };
}
export type AblationCommand = (executable: string, argv: string[], options: CommandOptions) => Promise<CommandResult>;
/** An isolated index changes only the trusted bare repository; candidate code/hooks never execute. */
export async function createAblationCommit(mirror: string, candidateCommit: string, patch: string, signal?: AbortSignal, command: AblationCommand = runProcess): Promise<string> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(candidateCommit) || !patch.startsWith('diff --git ')) throw new Error('Invalid ablation input');
  const temporary = await mkdtemp(join(tmpdir(), 'rsi-ablation-index-'));
  const env = { PATH: process.env.PATH, GIT_INDEX_FILE: join(temporary, 'index'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'RSI platform', GIT_AUTHOR_EMAIL: 'rsi@localhost', GIT_COMMITTER_NAME: 'RSI platform', GIT_COMMITTER_EMAIL: 'rsi@localhost',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
  const git = async (args: string[], input?: string): Promise<string> => {
    const result = await command('git', ['-c', 'core.hooksPath=/dev/null', '--git-dir', mirror, ...args], { env, signal, input, timeoutMs: 120000, maxOutputBytes: 1024 * 1024 });
    if (!successful(result)) throw new Error('Trusted ablation Git operation failed');
    return result.stdout.toString().trim();
  };
  try {
    await git(['read-tree', candidateCommit]);
    await git(['apply', '--cached', '--reverse', '--check', '-'], patch);
    await git(['apply', '--cached', '--reverse', '-'], patch);
    const tree = await git(['write-tree']);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree)) throw new Error('Invalid ablation tree');
    const result = await git(['commit-tree', tree, '-p', candidateCommit], `RSI ablation ${createHash('sha256').update(patch).digest('hex')}\n`);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result)) throw new Error('Invalid ablation commit');
    return result;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export interface AblationResult {
  status: RsiReview['status'] | 'inconclusive';
  reason: 'score_drop' | 'no_score_drop' | 'build_failed' | 'infrastructure' | 'incomplete';
  score: number | null; scoreDrop: number | null;
}
export async function runAblation(input: { candidateScore: number; delta: number; commit: string;
  prepare(commit: string, signal?: AbortSignal): Promise<unknown>;
  evaluate(commit: string, signal?: AbortSignal): Promise<{ score: number | null; complete: boolean }>;
}, signal?: AbortSignal): Promise<AblationResult> {
  if (![input.candidateScore, input.delta].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid ablation scores');
  try { signal?.throwIfAborted(); await input.prepare(input.commit, signal); }
  catch (error) {
    return error instanceof BuildRejected
      ? { status: 'inconclusive', reason: 'build_failed', score: null, scoreDrop: null }
      : { status: 'missing', reason: 'infrastructure', score: null, scoreDrop: null };
  }
  try {
    const result = await input.evaluate(input.commit, signal);
    if (signal?.aborted || !result.complete || result.score === null || !Number.isFinite(result.score) || result.score < 0) return { status: 'missing', reason: 'incomplete', score: null, scoreDrop: null };
    const scoreDrop = input.candidateScore - result.score;
    return { status: scoreDrop > input.delta ? 'suspicious' : 'clean', reason: scoreDrop > input.delta ? 'score_drop' : 'no_score_drop', score: result.score, scoreDrop };
  } catch { return { status: 'missing', reason: 'infrastructure', score: null, scoreDrop: null }; }
}
