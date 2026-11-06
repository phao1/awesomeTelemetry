import { constants } from 'node:fs';
import { lstat, open, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyLedger, LedgerIntegrityError, RSI_LEDGER_DEFAULTS } from './ledger.js';
import type { RsiLedgerHead } from '../../src/core/rsi-types.js';
import { mustDocker, RSI_LABEL } from './docker.js';
import type { DockerClient } from './docker.js';
import type { RsiStore } from './queue.js';
import { now, taskLock } from './queue.js';

export async function recoverWork(store: RsiStore, client: DockerClient,
  beforeCleanup?: (name: string, runId: string) => Promise<void>): Promise<void> {
  // No destructive cleanup before verification and cache reconstruction succeeds.
  await store.refresh();
  const names = (await mustDocker(client, ['ps', '-a', '--filter', `label=${RSI_LABEL}=${store.taskId}`, '--format', '{{.Names}}'])).toString().trim().split('\n').filter(Boolean);
  for (const name of names.sort((a, b) => Number(a.startsWith('rsi-proxy-')) - Number(b.startsWith('rsi-proxy-')))) {
    if (beforeCleanup && name.startsWith('rsi-proxy-')) {
      const runId = (await mustDocker(client, ['inspect', '--format', '{{index .Config.Labels "rsi.run"}}', name])).toString().trim();
      if (runId) {
        const running = (await mustDocker(client, ['inspect', '--format', '{{.State.Running}}', name])).toString().trim();
        if (running !== 'true') await mustDocker(client, ['start', name]);
        await beforeCleanup(name, runId);
      }
    }
    await mustDocker(client, ['rm', '-f', name]);
  }
  const networks = (await mustDocker(client, ['network', 'ls', '--filter', `label=${RSI_LABEL}=${store.taskId}`, '--format', '{{.ID}}'])).toString().trim().split('\n').filter(Boolean);
  for (const id of networks) await mustDocker(client, ['network', 'rm', id]);
  for (const e of store.list('evaluation_put')) if (e.state === 'running') await store.put({ event: 'evaluation_put', payload: { ...e, state: 'queued', updatedAt: now() } });
  for (const q of store.list('queue_put')) if (q.state === 'running' || q.state === 'queued') {
    const e = store.list('evaluation_put').find(e => e.id === q.evaluationId);
    const state = e && ['completed', 'infra_failed', 'invalidated'].includes(e.state) ? 'completed' : 'queued';
    if (state !== q.state) await store.put({ event: 'queue_put', payload: { ...q, state, updatedAt: now() } });
  }
}

async function recoveryLedgerLock(file: string): Promise<Awaited<ReturnType<typeof open>>> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  try { return await open(`${file}.lock`, flags, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const guard = await open(`${file}.lock.reclaim`, flags, 0o600);
  try {
    const existing = await open(`${file}.lock`, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await existing.stat();
      if (info.size > 4096) throw new Error('Ledger lock requires operator inspection');
      const owner = JSON.parse(await existing.readFile('utf8')) as { version: number; pid: number; owner: string; createdAt: string };
      const created = Date.parse(owner.createdAt);
      if (owner.version !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.owner !== 'string' || !owner.owner
        || !Number.isFinite(created) || Date.now() - created < RSI_LEDGER_DEFAULTS.lockStaleMs || Date.now() - info.mtimeMs < RSI_LEDGER_DEFAULTS.lockStaleMs) throw new Error('Ledger lock requires operator inspection');
      let dead = false;
      try { process.kill(owner.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') dead = true; else if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error; }
      if (!dead) throw new Error('Ledger lock owner is live or unknown');
      const current = await lstat(`${file}.lock`);
      if (current.dev !== info.dev || current.ino !== info.ino) throw new Error('Ledger lock owner changed');
      await unlink(`${file}.lock`);
    } finally { await existing.close(); }
    return await open(`${file}.lock`, flags, 0o600);
  } finally { await guard.close(); await unlink(`${file}.lock.reclaim`); }
}

/** Explicit operator action only. Preserve tail and fsync quarantine before truncation. */
export async function recoverLedgerTail(root: string, taskId: string, expectedHead?: RsiLedgerHead): Promise<{ quarantine: string; bytes: number }> {
  return taskLock(root, 'worker', () => taskLock(root, 'writer', async () => {
    const file = join(root, 'ledger.jsonl');
    // Reclaim only an old, known-dead owner under RSI-007's separate guard.
    const lock = await recoveryLedgerLock(file);
    try {
      await lock.writeFile(JSON.stringify({ version: 1, pid: process.pid, owner: randomUUID(), createdAt: now() })); await lock.sync();
      const verification = await verifyLedger(file, { taskId, ...(expectedHead ? { expectedHead } : {}) });
      if (!verification.partialTail || verification.issues.some(i => i.code !== 'partial_tail')) throw new LedgerIntegrityError(verification);
      const snapshot = await stat(file), bytes = verification.partialTail.byteLength, cutoff = snapshot.size - bytes;
      const source = await open(file, constants.O_RDWR | constants.O_NOFOLLOW);
      const quarantine = join(root, `ledger-tail-${randomUUID()}.quarantine`);
      const target = await open(quarantine, 'wx', 0o600);
      try {
        const data = Buffer.alloc(bytes); const got = await source.read(data, 0, bytes, cutoff);
        if (got.bytesRead !== bytes) throw new Error('Ledger changed during tail recovery');
        await target.writeFile(data); await target.sync();
        const parent = await open(dirname(file), constants.O_RDONLY);
        try { await parent.sync(); } finally { await parent.close(); }
        await source.truncate(cutoff); await source.sync();
      } finally { await target.close(); await source.close(); }
      if (!(await verifyLedger(file, { taskId, ...(expectedHead ? { expectedHead } : {}) })).valid) throw new Error('Recovered ledger failed verification');
      return { quarantine, bytes };
    } finally { await lock.close(); await unlink(`${file}.lock`); }
  }));
}
