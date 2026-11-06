import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

describe('a reader sharing the cache with the writer', () => {
  async function pair() {
    const root = await mkdtemp(join(tmpdir(), 'rsi-tail-')); roots.push(root);
    const file = join(root, 'index.db'), db = openWritable(file), other = openWritable(file);
    const at = new Date().toISOString(), writer = new RsiStore(db, join(root, 'task'), 'task'), reader = new RsiStore(other, join(root, 'task'), 'task');
    await writer.put(task(at)); await writer.put(instruction('one', at), 'human');
    return { db, other, writer, reader, at };
  }
  it('does not replay the ledger when the cache already holds its last entry', async () => {
    const { db, other, writer, reader, at } = await pair();
    try {
      await reader.refresh();
      // Damage far from the tail is left to `ledger verify`: replaying per change would grow with the task.
      const original = await readFile(writer.ledgerPath, 'utf8'), lines = original.trimEnd().split('\n');
      await writeFile(writer.ledgerPath, [lines[0]!.replace('"actor":"worker"', '"actor":"human"'), ...lines.slice(1)].join('\n') + '\n');
      await reader.refresh();
      expect(reader.list('instruction_put').map(i => i.id)).toEqual(['one']);
      await writeFile(writer.ledgerPath, original);
      await writer.put(instruction('two', at), 'human'); await reader.refresh();
      expect(reader.list('instruction_put').map(i => i.id)).toEqual(['one', 'two']);
    } finally { db.close(); other.close(); }
  });
  it('still rebuilds and reports a ledger whose tail disagrees with the cache', async () => {
    const { db, other, writer, reader } = await pair();
    try {
      await reader.refresh();
      await appendFile(writer.ledgerPath, '{"seq":3,"hash":"forged"}\n');
      await expect(reader.refresh()).rejects.toThrow();
    } finally { db.close(); other.close(); }
  });
});
