import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendLedger, verifyLedger } from './ledger.js';
import { recoverLedgerTail } from './recovery.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('explicit crash-tail quarantine', () => {
  it('preserves exact trailing bytes before removing the partial record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tail-')); dirs.push(root); const file = join(root, 'ledger.jsonl'), at = new Date().toISOString();
    const entry = await appendLedger(file, { taskId: 'task', at, actor: 'human', event: 'task_put', payload: { id: 'task', repository: 'local', baselineCommit: 'a'.repeat(40), datasetHash: 'b'.repeat(64), mainMetric: 'passed_count', config: defaultRsiConfig(), state: 'created', pauseReason: null, delta: null, baselineTrainScore: null, baselineSealedScore: null, sealedQueriesUsed: 0, tokenUsage: 0, iterationCount: 0, monitorCalibration: null, currentParentId: null, taskTokenHash: 'c'.repeat(64), createdAt: at, updatedAt: at } });
    const bytes = Buffer.from('{"partial":\xe4\xb8', 'latin1'); await appendFile(file, bytes);
    expect((await verifyLedger(file)).partialTail?.byteLength).toBe(bytes.length);
    const recovered = await recoverLedgerTail(root, 'task', { seq: entry.seq, hash: entry.hash });
    expect(await readFile(recovered.quarantine)).toEqual(bytes); expect((await verifyLedger(file)).valid).toBe(true);
  });
  it('refuses complete corrupt records without truncating anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tail-')); dirs.push(root); const file = join(root, 'ledger.jsonl'); await appendFile(file, 'bad\npartial');
    await expect(recoverLedgerTail(root, 'task')).rejects.toThrow(); expect(await readFile(file, 'utf8')).toBe('bad\npartial');
  });
});
