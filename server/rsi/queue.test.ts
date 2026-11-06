import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openWritable } from '../storage/db.js';
import { RsiStore } from './queue.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import type { RsiLedgerEvent } from '../../src/core/rsi-types.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function instruction(id: string, at: string): RsiLedgerEvent {
  return { event: 'instruction_put', payload: { id, taskId: 'task', kind: 'idea', text: `idea ${id}`, effectiveFromSeq: 1, at } } as unknown as RsiLedgerEvent;
}
function task(at: string): RsiLedgerEvent {
  return { event: 'task_put', payload: { id: 'task', state: 'created', repository: 'local', baselineCommit: 'a'.repeat(40), mainMetric: 'passed_count', datasetHash: 'b'.repeat(64),
    taskTokenHash: 'c'.repeat(64), config: defaultRsiConfig(), delta: null, baselineTrainScore: null, baselineSealedScore: null, currentParentId: null, tokenUsage: 0, iterationCount: 0,
    sealedQueriesUsed: 0, pauseReason: null, monitorCalibration: null, createdAt: at, updatedAt: at } } as unknown as RsiLedgerEvent;
}

describe('RsiStore shared by several processes', () => {
  it('keeps writing while another connection rebuilds the same cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rsi-store-')); roots.push(root);
    const taskRoot = join(root, 'task'), file = join(root, 'index.db');
    const writerDb = openWritable(file), readerDb = openWritable(file);
    try {
      const writer = new RsiStore(writerDb, taskRoot, 'task'), reader = new RsiStore(readerDb, taskRoot, 'task');
      const at = new Date().toISOString();
      await writer.put(task(at));
      let writing = true, rebuilds = 0;
      const rebuild = (async () => {
        // A new connection has no synchronized stamp, so each pass really rebuilds the shared cache.
        while (writing) {
          const connection = openWritable(file);
          try { await new RsiStore(connection, taskRoot, 'task').refresh(); rebuilds++; } finally { connection.close(); }
        }
      })();
      try { for (let i = 0; i < 25; i++) await writer.put(instruction(`i${i}`, at), 'human'); }
      finally { writing = false; await rebuild; }
      await reader.refresh();
      expect(reader.list('instruction_put')).toHaveLength(25);
      expect(writer.list('instruction_put')).toHaveLength(25);
      expect(rebuilds).toBeGreaterThan(0);
    } finally { writerDb.close(); readerDb.close(); }
  });
  it('skips the rebuild while the ledger file is unchanged and catches up after a write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rsi-store-')); roots.push(root);
    const taskRoot = join(root, 'task'), file = join(root, 'index.db');
    const db = openWritable(file), other = openWritable(file);
    try {
      const store = new RsiStore(db, taskRoot, 'task'), peer = new RsiStore(other, taskRoot, 'task');
      const at = new Date().toISOString();
      await store.put(task(at));
      await peer.refresh();
      const before = await stat(store.ledgerPath);
      await peer.refresh();
      expect((await stat(store.ledgerPath)).size).toBe(before.size);
      await store.put(instruction('after', at), 'human');
      await peer.refresh();
      expect(peer.list('instruction_put').map(i => i.id)).toEqual(['after']);
    } finally { db.close(); other.close(); }
  });
});
