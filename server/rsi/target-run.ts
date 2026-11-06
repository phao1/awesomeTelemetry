import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
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
  image: string, proxy: ProxyRun, output: string, maxTokens: number, timeoutMs: number, signal?: AbortSignal): Promise<TargetResult> {
  const name = `rsi-target-${randomUUID()}`, work = `/tmp/${randomBytes(16).toString('hex')}`;
  let created = false, peak: number | null = null;
  let result: TargetResult = { patch: Buffer.alloc(0), failureReason: 'infrastructure', memoryPeakBytes: null, sessionTokens: null, sessionPath: null };
  try {
    await mustDocker(client, ['create', ...isolationArgs(proxy.network, taskId, name), '-e', 'OPENCODE_DB=/data/session.db', image], { signal }); created = true;
    await mustDocker(client, ['start', name], { signal });
    const network = JSON.parse((await mustDocker(client, ['inspect', '--format', '{{json .NetworkSettings.Networks}}', name], { signal })).toString()) as Record<string, unknown>;
    const mounts = JSON.parse((await mustDocker(client, ['inspect', '--format', '{{json .Mounts}}', name], { signal })).toString()) as unknown[];
    if (Object.keys(network).length !== 1 || !Object.hasOwn(network, proxy.network) || mounts.length) throw new Error('Target isolation violation');
    await putTar(client, name, work, repo, signal);
    const config = { model: 'rsi/fixed', update: 'disable', share: 'disabled', snapshots: false, lsp: false, formatter: false, plugins: [],
      providers: { rsi: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: 'http://rsi-proxy:8080/v1', apiKey: proxy.token },
        models: { fixed: { name: 'fixed', limit: { context: 1000000, output: maxTokens }, capabilities: { tools: true, input: ['text'], output: ['text'] } } } } } };
    await putTar(client, name, '/home/node/.config/opencode', packFiles(new Map([['opencode.json', Buffer.from(JSON.stringify(config))]])), signal);
    const exec = (argv: string[], input?: Buffer): Promise<Buffer> => mustDocker(client, ['exec', ...(input ? ['-i'] : []), '-w', work, name, ...argv], { input, signal });
    await exec(['git', '-c', 'core.hooksPath=/dev/null', 'init', '-q']);
    await exec(['git', 'config', 'core.hooksPath', '/dev/null']);
    await exec(['git', 'add', '-A']);
    await exec(['git', '-c', 'user.name=RSI', '-c', 'user.email=rsi@localhost', 'commit', '--allow-empty', '-qm', 'snapshot']);
    const r = await client.run(['exec', '-w', work, name, 'opencode', 'run', '--standalone', '--auto', '--format', 'json', '--model', 'rsi/fixed', statement], { timeoutMs, signal });
    await privateWrite(join(output, 'agent.stdout'), r.stdout); await privateWrite(join(output, 'agent.stderr'), r.stderr);
    if (r.timedOut) result.failureReason = 'agent_timeout';
    else if (!successful(r)) result.failureReason = 'infrastructure';
    else {
      await exec(['git', 'add', '-A']);
      result.patch = await exec(['git', 'diff', '--cached', '--binary', '--']);
      result.failureReason = null;
      await privateWrite(join(output, 'workspace.patch'), result.patch);
    }
    // OpenCode has exited: export DB/WAL/SHM as one tar stream, no docker cp.
    if (!r.timedOut && !r.cancelled) {
      const archive = await mustDocker(client, ['exec', name, 'tar', '-cf', '-', '-C', '/data', '.'], { signal, maxOutputBytes: 64 * 1024 * 1024 });
      await extractFiles(archive, join(output, 'session'));
      try { result.sessionTokens = sessionTokens(join(output, 'session/session.db')); result.sessionPath = 'session/session.db'; }
      catch { result.sessionTokens = null; }
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
