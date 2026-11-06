import { mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, basename, join } from 'node:path';
import type { RsiAgentProfile } from './agent-profile.js';
import { renderAgentRun } from './agent-profile.js';
import Database from 'better-sqlite3';
import type { RsiBankQuestion } from './bank.js';
import type { DockerClient } from './docker.js';
import { isolationArgs, mustDocker, successful } from './docker.js';
import { extractFiles, packFiles, privateWrite } from './artifacts.js';
import { memoryPeak, putTar } from './evaluator.js';
import type { ProxyRun } from './proxy-run.js';
import type { RsiRun } from '../../src/core/rsi-types.js';

export interface TargetResult {
  patch: Buffer; failureReason: RsiRun['failureReason']; memoryPeakBytes: number | null;
  sessionTokens: number | null; sessionPath: string | null;
}
export function sessionTokens(file: string): number {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('trusted_schema=OFF');
    const rows = db.prepare('SELECT tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session_v2').all() as Record<string, number>[];
    let total = 0;
    for (const row of rows) for (const n of Object.values(row)) {
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid session usage'); total += n;
    }
    if (!Number.isSafeInteger(total) || !rows.length) throw new Error('Missing session usage');
    return total;
  } finally { db.close(); }
}
export async function runTarget(client: DockerClient, taskId: string, q: RsiBankQuestion, repo: Buffer, statement: string,
  image: string, proxy: ProxyRun, output: string, profile: RsiAgentProfile, model: string, timeoutMs: number, signal?: AbortSignal): Promise<TargetResult> {
  const name = `rsi-target-${randomUUID()}`, work = `/tmp/${randomBytes(16).toString('hex')}`;
  const run = renderAgentRun(profile, { statement, model, apiKey: proxy.token });
  let created = false, peak: number | null = null;
  let result: TargetResult = { patch: Buffer.alloc(0), failureReason: 'infrastructure', memoryPeakBytes: null, sessionTokens: null, sessionPath: null };
  try {
    await mustDocker(client, ['create', ...isolationArgs(proxy.network, taskId, name), ...Object.entries(run.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), image], { signal }); created = true;
    await mustDocker(client, ['start', name], { signal });
    const network = JSON.parse((await mustDocker(client, ['inspect', '--format', '{{json .NetworkSettings.Networks}}', name], { signal })).toString()) as Record<string, unknown>;
    const mounts = JSON.parse((await mustDocker(client, ['inspect', '--format', '{{json .Mounts}}', name], { signal })).toString()) as unknown[];
    if (Object.keys(network).length !== 1 || !Object.hasOwn(network, proxy.network) || mounts.length) throw new Error('Target isolation violation');
    await putTar(client, name, work, repo, signal);
    for (const file of run.files) await putTar(client, name, dirname(file.path), packFiles(new Map([[basename(file.path), Buffer.from(file.content)]])), signal);
    await mustDocker(client, ['exec', name, 'mkdir', '-p', profile.session.dir], { signal });
    const exec = (argv: string[], input?: Buffer): Promise<Buffer> => mustDocker(client, ['exec', ...(input ? ['-i'] : []), '-w', work, name, ...argv], { input, signal });
    await exec(['git', '-c', 'core.hooksPath=/dev/null', 'init', '-q']);
    await exec(['git', 'config', 'core.hooksPath', '/dev/null']);
    await exec(['git', 'add', '-A']);
    await exec(['git', '-c', 'user.name=RSI', '-c', 'user.email=rsi@localhost', 'commit', '--allow-empty', '-qm', 'snapshot']);
    const r = await client.run(['exec', '-w', work, name, ...run.argv], { timeoutMs, signal });
    await privateWrite(join(output, 'agent.stdout'), r.stdout); await privateWrite(join(output, 'agent.stderr'), r.stderr);
    if (r.timedOut) result.failureReason = 'agent_timeout';
    else if (!successful(r)) result.failureReason = 'infrastructure';
    else {
      await exec(['git', 'add', '-A']);
      result.patch = await exec(['git', 'diff', '--cached', '--binary', '--']);
      result.failureReason = null;
      await privateWrite(join(output, 'workspace.patch'), result.patch);
    }
    // Export the profile session directory as one tar stream after Agent exit.
    if (!r.timedOut && !r.cancelled) {
      const archive = await mustDocker(client, ['exec', name, 'tar', '-cf', '-', '-C', profile.session.dir, '.'], { signal, maxOutputBytes: 64 * 1024 * 1024 });
      await mkdir(join(output, 'session'), { recursive: true, mode: 0o700 });
      await extractFiles(archive, join(output, 'session'));
      result.sessionPath = 'session';
      if (profile.session.format === 'opencode-db') {
        try { result.sessionTokens = sessionTokens(join(output, 'session/session.db')); result.sessionPath = 'session/session.db'; }
        catch { result.sessionTokens = null; }
      }
    }
  } finally {
    if (created) {
      try { peak = await memoryPeak(client, name); }
      finally { await mustDocker(client, ['rm', '-f', name]); }
    }
  }
  result = { ...result, memoryPeakBytes: peak };
  await privateWrite(join(output, 'target.json'), JSON.stringify({ memoryPeakBytes: peak, sessionTokens: result.sessionTokens, toolchain: q.toolchain }));
  return result;
}
