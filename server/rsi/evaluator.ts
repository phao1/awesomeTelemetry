import { randomBytes, randomUUID } from 'node:crypto';
import type { RsiBankQuestion, QuestionData } from './bank.js';
import type { DockerClient, CommandResult } from './docker.js';
import { isolationArgs, mustDocker, successful } from './docker.js';
import { packFiles } from './artifacts.js';
import { parseReport, testArgv } from './reporters/parse.js';
import type { TestVerdict } from './reporters/parse.js';

export function classifyApply(r: CommandResult): 'ok' | 'fail' | 'infra_error' {
  if (successful(r)) return 'ok';
  if (r.timedOut || r.cancelled || r.overflow) return 'infra_error';
  const message = r.stderr.toString('utf8');
  if (/permission denied|read-only|cannot (?:open|create)|unable to (?:open|create)|input\/output|no space|not found/i.test(message)) return 'infra_error';
  return r.code === 1 && /patch (?:failed|does not apply)|already exists in working directory|No valid patches|corrupt patch|unrecognized input/i.test(message) ? 'fail' : 'infra_error';
}
export async function putTar(client: DockerClient, container: string, destination: string, input: Buffer, signal?: AbortSignal): Promise<void> {
  await mustDocker(client, ['exec', container, 'mkdir', '-p', destination], { signal });
  await mustDocker(client, ['exec', '-i', container, 'tar', '-xf', '-', '--no-same-owner', '--no-same-permissions', '-C', destination], { input, signal });
}
export async function memoryPeak(client: DockerClient, container: string): Promise<number> {
  const n = Number((await mustDocker(client, ['exec', container, 'cat', '/sys/fs/cgroup/memory.peak'])).toString().trim());
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid memory.peak');
  return n;
}
export interface EvaluationResult extends TestVerdict { memoryPeakBytes: number | null }
export async function evaluatePatch(client: DockerClient, taskId: string, q: RsiBankQuestion, data: QuestionData,
  patch: Buffer, image: string, _reportersRoot: string, signal?: AbortSignal): Promise<EvaluationResult> {
  const name = `rsi-eval-${randomUUID()}`, work = `/tmp/${randomBytes(16).toString('hex')}`, sealed = `/tmp/${randomBytes(16).toString('hex')}`;
  let peak: number | null = null;
  let verdict: TestVerdict;
  let created = false;
  try {
    await mustDocker(client, ['create', ...isolationArgs('none', taskId, name, '768m'), image], { signal }); created = true;
    await mustDocker(client, ['start', name], { signal });
    await putTar(client, name, work, data.repo, signal);
    await putTar(client, name, sealed, packFiles(new Map([['candidate.patch', patch]])), signal);
    if (patch.length) {
      const checked = classifyApply(await client.run(['exec', '-w', work, name, 'git', 'apply', '--check', `${sealed}/candidate.patch`], { signal }));
      if (checked !== 'ok') return { outcome: checked, observedTests: 0, reason: checked === 'fail' ? 'patch_rejected' : 'patch_infrastructure', memoryPeakBytes: null };
      const applied = classifyApply(await client.run(['exec', '-w', work, name, 'git', 'apply', `${sealed}/candidate.patch`], { signal }));
      if (applied !== 'ok') return { outcome: applied, observedTests: 0, reason: applied === 'fail' ? 'patch_rejected' : 'patch_infrastructure', memoryPeakBytes: null };
    }
    // A patch must not redirect overlay writes through symlinks.
    await mustDocker(client, ['exec', name, 'node', '-e',
      "const f=require('fs'),p=require('path');function walk(d){for(const e of f.readdirSync(d,{withFileTypes:true})){if(e.isSymbolicLink())process.exit(125);if(e.isDirectory())walk(p.join(d,e.name))}}walk(process.argv[1])", work], { signal });
    await putTar(client, name, work, data.hidden, signal);
    // Reporters are baked into the trusted image, owned by root and read-only
    // to the unprivileged patch/test process.
    const r = await client.run(['exec', '-w', work, name, ...testArgv(q)], { timeoutMs: q.timeoutSeconds * 1000, signal });
    if (r.timedOut) verdict = { outcome: 'fail', observedTests: 0, reason: 'test_timeout' };
    else if (r.cancelled || r.overflow || r.code === 125 || r.code === 126 || r.code === 127) verdict = { outcome: 'infra_error', observedTests: 0, reason: 'test_infrastructure' };
    else verdict = parseReport(r.stdout.toString(), r.code, q);
  } catch { verdict = { outcome: 'infra_error', observedTests: 0, reason: 'evaluator_infrastructure' }; }
  finally {
    if (created) {
      try { peak = await memoryPeak(client, name); }
      finally { await mustDocker(client, ['rm', '-f', name]); }
    }
  }
  return { ...verdict, memoryPeakBytes: peak };
}
