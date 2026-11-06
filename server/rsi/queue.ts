import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Database as Db } from 'better-sqlite3';
import type { RsiOptimizerSession, RsiInstruction, RsiActor, RsiLedgerEvent, RsiLedgerInput, RsiQueueItem, RsiTask, RsiIteration, RsiEvaluation, RsiRun, RsiFinding, RsiDecision } from '../../src/core/rsi-types.js';
import { appendLedger, canonicalJson, computeLedgerHash, RSI_LEDGER_GENESIS_HASH } from './ledger.js';
import { applyRsiLedgerEntry, getRsiLedgerHead, rebuildRsiIndexFromLedger, RsiIndexRaceError } from '../storage/rsi.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { RSI_SESSION_COLS, RSI_INSTRUCTION_COLS, RSI_TASK_COLS, RSI_ITERATION_COLS, RSI_EVALUATION_COLS, RSI_RUN_COLS, RSI_FINDING_COLS, RSI_DECISION_COLS, RSI_QUEUE_COLS } from '../storage/columns.js';

interface Entities { session_put: RsiOptimizerSession; instruction_put: RsiInstruction; task_put: RsiTask; iteration_put: RsiIteration; evaluation_put: RsiEvaluation; run_put: RsiRun; finding_put: RsiFinding; decision_put: RsiDecision; queue_put: RsiQueueItem }
const tables = {
  session_put: ['rsi_sessions', RSI_SESSION_COLS], instruction_put: ['rsi_instructions', RSI_INSTRUCTION_COLS],
  task_put: ['rsi_tasks', RSI_TASK_COLS], iteration_put: ['rsi_iterations', RSI_ITERATION_COLS],
  evaluation_put: ['rsi_evaluations', RSI_EVALUATION_COLS], run_put: ['rsi_runs', RSI_RUN_COLS],
  finding_put: ['rsi_findings', RSI_FINDING_COLS], decision_put: ['rsi_decisions', RSI_DECISION_COLS], queue_put: ['rsi_queue', RSI_QUEUE_COLS],
} as const;
export const now = (): string => new Date().toISOString();
export const newId = (): string => randomUUID();

/** Worker exclusivity and writer coordination, separate from ledger's durable lock. */
export async function taskLock<T>(root: string, name: string, action: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, `${name}.lock`), token = randomUUID(), start = Date.now();
  for (;;) {
    try {
      const handle = await open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); }
      finally { await handle.close(); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // This lock is not the ledger lock. A guard prevents competing reclaimers
      // from deleting the lock newly acquired by another writer.
      let guard;
      try { guard = await open(`${file}.reclaim`, 'wx', 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (guard) {
        try {
          let record: { pid: number; token: string } | null = null;
          try { record = JSON.parse(await readFile(file, 'utf8')) as { pid: number; token: string }; }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
          if (record && Number.isSafeInteger(record.pid) && record.pid > 0 && typeof record.token === 'string') {
            try { process.kill(record.pid, 0); }
            catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') await unlink(file); else if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e; }
          }
        } finally { await guard.close(); await unlink(`${file}.reclaim`); }
      }
      if (Date.now() - start >= timeoutMs) throw new Error(`RSI ${name} lock unavailable`, { cause: error });
      await delay(20);
    }
  }
  try { return await action(); }
  finally {
    const owner = JSON.parse(await readFile(file, 'utf8')) as { token: string };
    await releaseTaskLock(file, owner.token, token);
  }
}

async function releaseTaskLock(file: string, owner: string, expected: string): Promise<void> {
  if (owner !== expected) throw new Error('RSI lock ownership changed');
  await unlink(file);
}

interface LedgerStamp { size: number; mtimeMs: number }
/** Ledger file state each connection last synchronized to. The HTTP server builds a store per request. */
const synchronized = new WeakMap<Db, Map<string, LedgerStamp>>();
const INDEX_RACE_RETRIES = 8;
async function ledgerStamp(path: string): Promise<LedgerStamp | null> {
  try { const { size, mtimeMs } = await stat(path); return { size, mtimeMs }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export class RsiStore {
  readonly db: Db; readonly root: string; readonly taskId: string; readonly ledgerPath: string;
  private pending: Promise<void> = Promise.resolve();
  constructor(db: Db, root: string, taskId: string) {
    this.db = db; this.root = root; this.taskId = taskId; this.ledgerPath = join(root, 'ledger.jsonl');
    // Statements prepared here, never inside a row/slot loop.
    for (const [event, [table, columns]] of Object.entries(tables)) cachedStmt(db, `SELECT ${columns} FROM ${table} WHERE ${event === 'task_put' ? 'id' : 'task_id'}=? ORDER BY ${event === 'evaluation_put' ? 'ledger_seq,id' : event === 'iteration_put' ? 'seq' : 'id'}`);
  }
  list<K extends keyof Entities>(event: K): Entities[K][] {
    const [table, columns] = tables[event];
    const rows = cachedStmt(this.db, `SELECT ${columns} FROM ${table} WHERE ${event === 'task_put' ? 'id' : 'task_id'}=? ORDER BY ${event === 'evaluation_put' ? 'ledger_seq,id' : event === 'iteration_put' ? 'seq' : 'id'}`).all(this.taskId) as { entity_json: string }[];
    return rows.map(row => JSON.parse(row.entity_json) as Entities[K]);
  }
  task(): RsiTask { const task = this.list('task_put')[0]; if (!task) throw new Error('RSI task not found'); return task; }
  private remember(stamp: LedgerStamp | null): void {
    const stamps = synchronized.get(this.db) ?? new Map<string, LedgerStamp>();
    if (stamp) stamps.set(this.ledgerPath, stamp); else stamps.delete(this.ledgerPath);
    synchronized.set(this.db, stamps);
  }
  /** The worker, server and CLI share this cache, so a concurrent rebuild is expected, not a failure. */
  async refresh(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const stamp = await ledgerStamp(this.ledgerPath), known = synchronized.get(this.db)?.get(this.ledgerPath);
      if (stamp && known && known.size === stamp.size && known.mtimeMs === stamp.mtimeMs && getRsiLedgerHead(this.db, this.taskId)) return;
      try { await rebuildRsiIndexFromLedger(this.db, this.taskId, this.ledgerPath); this.remember(stamp); return; }
      catch (error) {
        if (!(error instanceof RsiIndexRaceError) || attempt >= INDEX_RACE_RETRIES) throw error;
        await delay(10 * 2 ** attempt);
      }
    }
  }
  put(event: RsiLedgerEvent, actor: RsiActor = 'worker'): Promise<void> {
    const snapshot = JSON.parse(canonicalJson(event)) as RsiLedgerEvent;
    const operation = this.pending.then(() => taskLock(this.root, 'writer', async () => {
      await this.refresh();
      const head = getRsiLedgerHead(this.db, this.taskId);
      const input = { ...snapshot, taskId: this.taskId, actor, at: now() } as RsiLedgerInput;
      // Validate the complete storage boundary BEFORE committing an irreversible
      // ledger event. Roll the dry transaction back even when validation passes.
      const unsigned = { ...input, version: 1 as const, seq: (head?.seq ?? 0) + 1, prevHash: head?.hash ?? RSI_LEDGER_GENESIS_HASH };
      const sentinel = new Error('validation rollback');
      try { this.db.transaction(() => { applyRsiLedgerEntry(this.db, { ...unsigned, hash: computeLedgerHash(unsigned) }); throw sentinel; })(); }
      catch (error) { if (error !== sentinel) throw error; }
      const entry = await appendLedger(this.ledgerPath, input, { ...(head ? { expectedHead: head } : {}) });
      applyRsiLedgerEntry(this.db, entry);
      // The writer lock is held, so this stamp is exactly the entry just applied.
      this.remember(await ledgerStamp(this.ledgerPath));
    }));
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export async function enqueue(store: RsiStore, command: RsiQueueItem['command'], actor: RsiActor,
  id = newId(), iterationId: string | null = null, evaluationId: string | null = null): Promise<RsiQueueItem> {
  const kind = ['submit', 'evaluate', 'review', 'final', 'adopt'].includes(command.action) ? command.action as RsiQueueItem['kind'] : 'intervene';
  const existing = store.list('queue_put').find(q => q.id === id);
  if (existing) {
    if (canonicalJson([existing.command, existing.requestedBy, existing.iterationId, existing.evaluationId]) !== canonicalJson([command, actor, iterationId, evaluationId])) throw new Error('RSI idempotency conflict');
    return existing;
  }
  if (command.action === 'final') {
    const commit = store.list('iteration_put').find(i => i.id === iterationId)?.commit;
    if (!commit || store.list('evaluation_put').some(e => e.phase === 'final' && e.commit === commit)
      || store.list('queue_put').some(q => q.kind === 'final' && store.list('iteration_put').find(i => i.id === q.iterationId)?.commit === commit)) throw new Error('RSI final already reserved');
  }
  const at = now(), item: RsiQueueItem = { id, taskId: store.taskId, kind, iterationId, evaluationId, state: 'queued', requestedBy: actor,
    reason: 'reason' in command ? command.reason : null, command, createdAt: at, updatedAt: at };
  await store.put({ event: 'queue_put', payload: item }, actor);
  return item;
}
