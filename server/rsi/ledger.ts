import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { RsiLedgerEntry, RsiLedgerHead, RsiLedgerInput } from '../../src/core/rsi-types.js';
import { validateRsiLedgerEntry, validateRsiLedgerEvent } from '../../src/core/rsi-validation.js';

export const RSI_LEDGER_GENESIS_HASH = '0'.repeat(64);
export const RSI_LEDGER_DEFAULTS = Object.freeze({
  lockStaleMs: 60_000, lockTimeoutMs: 10_000, lockRetryMs: 10, maxLineBytes: 1_048_576,
});
export type LedgerIssueCode = 'invalid_json' | 'invalid_entry' | 'non_canonical'
  | 'sequence_mismatch' | 'prev_hash_mismatch' | 'hash_mismatch' | 'task_mismatch'
  | 'anchor_mismatch' | 'tail_truncated' | 'partial_tail' | 'line_too_large';
export interface LedgerIssue { code: LedgerIssueCode; line: number }
export interface LedgerPartialTail { line: number; byteLength: number }
export interface LedgerVerification {
  valid: boolean; head: RsiLedgerHead; entryCount: number; issues: LedgerIssue[];
  partialTail: LedgerPartialTail | null; anchored: boolean; tampered: boolean;
}
export interface VerifyLedgerOptions {
  taskId?: string; expectedHead?: RsiLedgerHead; maxLineBytes?: number;
  onEntry?: (entry: RsiLedgerEntry) => void | Promise<void>;
}
export interface AppendLedgerOptions {
  expectedHead?: RsiLedgerHead; lockStaleMs?: number; lockTimeoutMs?: number;
  lockRetryMs?: number; maxLineBytes?: number;
}
export type UnsignedLedgerEntry = RsiLedgerInput & { version: 1; seq: number; prevHash: string };

export class LedgerIntegrityError extends Error {
  readonly verification: LedgerVerification;
  constructor(verification: LedgerVerification) {
    super(`RSI ledger integrity failure: ${verification.issues.map(issue => issue.code).join(', ')}`);
    this.name = 'LedgerIntegrityError';
    this.verification = verification;
  }
}

/** RSI-007: exact JSON data only; do not silently discard unknown JS values. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 64) throw new TypeError('RSI canonical JSON nesting exceeds 64');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('RSI canonical JSON requires finite numbers');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('RSI canonical JSON requires JSON values');
    if (ancestors.has(item)) throw new TypeError('RSI canonical JSON cannot encode cycles');
    if (Object.getOwnPropertySymbols(item).length > 0) throw new TypeError('RSI canonical JSON cannot encode symbols');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length || Object.getOwnPropertyNames(item).length !== item.length + 1) {
          throw new TypeError('RSI canonical JSON requires dense arrays without extra fields');
        }
        const values: string[] = [];
        for (let index = 0; index < item.length; index += 1) {
          const property = Object.getOwnPropertyDescriptor(item, String(index));
          if (!property || !('value' in property)) throw new TypeError('RSI canonical JSON cannot encode accessors');
          values.push(encode(property.value, depth + 1));
        }
        return `[${values.join(',')}]`;
      }
      const prototype: object | null = Object.getPrototypeOf(item) as object | null;
      const constructor = prototype === null ? undefined : Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value as unknown;
      const plain = prototype === null || (Object.getPrototypeOf(prototype) === null
        && typeof constructor === 'function'
        && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object));
      if (!plain) throw new TypeError('RSI canonical JSON requires plain objects');
      const keys = Object.getOwnPropertyNames(item).sort();
      return `{${keys.map(key => {
        const property = Object.getOwnPropertyDescriptor(item, key)!;
        if (!property.enumerable || !('value' in property)) throw new TypeError('RSI canonical JSON cannot encode hidden fields or accessors');
        return `${JSON.stringify(key)}:${encode(property.value, depth + 1)}`;
      }).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value, 0);
}

export function computeLedgerHash(entry: UnsignedLedgerEntry): string {
  return createHash('sha256').update(canonicalJson(entry), 'utf8').digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}

function positiveInteger(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new TypeError(`RSI ledger invalid ${name}`);
  return value;
}

function validateHead(head: RsiLedgerHead | undefined): void {
  if (!head) return;
  positiveInteger(head.seq, 'expectedHead.seq', true);
  if (!/^[0-9a-f]{64}$/.test(head.hash) || (head.seq === 0 && head.hash !== RSI_LEDGER_GENESIS_HASH)) {
    throw new TypeError('RSI ledger invalid expectedHead.hash');
  }
}

/** One read pass: callbacks may stage rows, but only valid=true commits them. */
export async function verifyLedger(path: string, options: VerifyLedgerOptions = {}): Promise<LedgerVerification> {
  validateHead(options.expectedHead);
  const expectedHead = options.expectedHead ? { ...options.expectedHead } : undefined;
  const maxLineBytes = positiveInteger(options.maxLineBytes ?? RSI_LEDGER_DEFAULTS.maxLineBytes, 'maxLineBytes');
  const result: LedgerVerification = {
    valid: true, head: { seq: 0, hash: RSI_LEDGER_GENESIS_HASH }, entryCount: 0,
    issues: [], partialTail: null, anchored: expectedHead !== undefined, tampered: false,
  };
  const issue = (code: LedgerIssueCode, line: number): void => {
    result.issues.push({ code, line });
    result.valid = false;
    if (code !== 'partial_tail') result.tampered = true;
  };
  let taskId = options.taskId;
  let lineNumber = 0;
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  if (handle) {
    let stream: ReturnType<FileHandle['createReadStream']> | undefined;
    let pending: Buffer = Buffer.alloc(0);
    try {
      const snapshot = await handle.stat();
      if (!snapshot.isFile()) throw new Error('RSI ledger must be a regular file');
      if (snapshot.size > 0) stream = handle.createReadStream({ highWaterMark: 65_536, autoClose: false, end: snapshot.size - 1 });
      outer: for await (const raw of stream ?? []) {
        const chunk = raw as Buffer;
        const bytes = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        let start = 0;
        for (let end = bytes.indexOf(10, start); end !== -1; end = bytes.indexOf(10, start)) {
          lineNumber += 1;
          if (end - start > maxLineBytes) { issue('line_too_large', lineNumber); break outer; }
          const line = bytes.subarray(start, end);
          let text: string;
          let value: unknown;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(line);
            value = JSON.parse(text);
          } catch {
            issue('invalid_json', lineNumber); break outer;
          }
          let entry: RsiLedgerEntry;
          try {
            entry = validateRsiLedgerEntry(value);
          } catch {
            issue('invalid_entry', lineNumber); break outer;
          }
          if (text !== canonicalJson(entry)) { issue('non_canonical', lineNumber); break outer; }
          if (entry.taskId !== (taskId ?? entry.taskId)) { issue('task_mismatch', lineNumber); break outer; }
          if (entry.seq !== result.head.seq + 1) { issue('sequence_mismatch', lineNumber); break outer; }
          if (entry.prevHash !== result.head.hash) { issue('prev_hash_mismatch', lineNumber); break outer; }
          const { hash, ...unsigned } = entry;
          if (computeLedgerHash(unsigned) !== hash) { issue('hash_mismatch', lineNumber); break outer; }
          if (entry.seq === expectedHead?.seq && entry.hash !== expectedHead.hash) {
            issue('anchor_mismatch', lineNumber); break outer;
          }
          taskId ??= entry.taskId;
          result.head = { seq: entry.seq, hash: entry.hash };
          result.entryCount += 1;
          await options.onEntry?.(entry);
          start = end + 1;
        }
        pending = Buffer.from(bytes.subarray(start));
        if (pending.length > maxLineBytes) { issue('line_too_large', lineNumber + 1); break; }
      }
      if (result.valid && pending.length > 0) {
        result.partialTail = { line: lineNumber + 1, byteLength: pending.length };
        issue('partial_tail', lineNumber + 1);
      }
    } finally {
      stream?.destroy();
      await handle.close();
    }
  }
  if (expectedHead && result.head.seq < expectedHead.seq && result.issues.every(item => item.code === 'partial_tail')) {
    issue('tail_truncated', lineNumber + 1);
  }
  return result;
}

interface LockRecord { version: 1; pid: number; owner: string; createdAt: string }
interface OwnedLock { handle: FileHandle; path: string; dev: number; ino: number }
interface LockOptions { lockStaleMs: number; lockTimeoutMs: number; lockRetryMs: number }

async function createLock(path: string): Promise<OwnedLock | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return null;
    throw error;
  }
  const stat = await handle.stat();
  const owned = { handle, path, dev: stat.dev, ino: stat.ino };
  try {
    const record: LockRecord = { version: 1, pid: process.pid, owner: randomUUID(), createdAt: new Date().toISOString() };
    await handle.writeFile(canonicalJson(record), 'utf8');
    await handle.sync();
    return owned;
  } catch (error) {
    await releaseLock(owned);
    throw error;
  }
}

async function releaseLock(lock: OwnedLock): Promise<void> {
  try {
    let stat;
    try { stat = await lstat(lock.path); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    if (stat && stat.dev === lock.dev && stat.ino === lock.ino) await unlink(lock.path);
  } finally {
    await lock.handle.close();
  }
}

function processIsKnownDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return errorCode(error) === 'ESRCH'; }
}

async function recoverStaleLock(path: string, staleMs: number): Promise<void> {
  // Every reclaimer reads the primary lock only AFTER acquiring this guard.
  // A crashed/partial guard cannot safely establish ownership: fail closed.
  const guard = await createLock(`${path}.reclaim`);
  if (!guard) return;
  try {
    let handle: FileHandle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (errorCode(error) === 'ENOENT') return; throw error; }
    try {
      const stat = await handle.stat();
      if (stat.size > 4096 || Date.now() - stat.mtimeMs < staleMs) return;
      let record: unknown;
      try { record = JSON.parse(await handle.readFile('utf8')); }
      catch (error) { if (error instanceof SyntaxError) return; throw error; }
      if (record === null || typeof record !== 'object' || !('version' in record) || record.version !== 1
        || !('pid' in record) || typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid < 1
        || !('owner' in record) || typeof record.owner !== 'string' || record.owner.length === 0
        || !('createdAt' in record) || typeof record.createdAt !== 'string') return;
      const created = Date.parse(record.createdAt);
      if (!Number.isFinite(created) || Date.now() - created < staleMs || !processIsKnownDead(record.pid)) return;
      const current = await lstat(path);
      if (current.dev === stat.dev && current.ino === stat.ino) await unlink(path);
    } finally { await handle.close(); }
  } finally { await releaseLock(guard); }
}

async function acquireLock(path: string, options: LockOptions): Promise<OwnedLock> {
  const startedAt = Date.now();
  for (;;) {
    const lock = await createLock(path);
    if (lock) return lock;
    await recoverStaleLock(path, options.lockStaleMs);
    if (Date.now() - startedAt >= options.lockTimeoutMs) throw new Error('RSI ledger lock acquisition timed out');
    await delay(options.lockRetryMs);
  }
}

const writeQueues = new Map<string, Promise<void>>();

function serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const result = previous.then(operation);
  // Failed append rejects its caller but does not poison subsequent queue work.
  const settled = result.then(() => undefined, () => undefined);
  writeQueues.set(path, settled);
  void settled.then(() => { if (writeQueues.get(path) === settled) writeQueues.delete(path); });
  return result;
}

export async function appendLedger(path: string, input: RsiLedgerInput, options: AppendLedgerOptions = {}): Promise<RsiLedgerEntry> {
  // Freeze the entire input BEFORE waiting: caller mutations cannot alter a queued event.
  const snapshot = validateRsiLedgerEvent(JSON.parse(canonicalJson(input)));
  validateHead(options.expectedHead);
  const anchor = options.expectedHead ? { ...options.expectedHead } : undefined;
  const maxLineBytes = positiveInteger(options.maxLineBytes ?? RSI_LEDGER_DEFAULTS.maxLineBytes, 'maxLineBytes');
  const lockOptions: LockOptions = {
    lockStaleMs: positiveInteger(options.lockStaleMs ?? RSI_LEDGER_DEFAULTS.lockStaleMs, 'lockStaleMs'),
    lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? RSI_LEDGER_DEFAULTS.lockTimeoutMs, 'lockTimeoutMs', true),
    lockRetryMs: positiveInteger(options.lockRetryMs ?? RSI_LEDGER_DEFAULTS.lockRetryMs, 'lockRetryMs'),
  };
  const parent = dirname(resolve(path));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const canonicalPath = join(await realpath(parent), basename(path));
  return serialize(canonicalPath, async () => {
    const lock = await acquireLock(`${canonicalPath}.lock`, lockOptions);
    try {
      const verification = await verifyLedger(canonicalPath, { taskId: snapshot.taskId, expectedHead: anchor, maxLineBytes });
      if (!verification.valid) throw new LedgerIntegrityError(verification);
      const seq = positiveInteger(verification.head.seq + 1, 'seq');
      const unsigned: UnsignedLedgerEntry = { ...snapshot, version: 1, seq, prevHash: verification.head.hash };
      const entry: RsiLedgerEntry = { ...unsigned, hash: computeLedgerHash(unsigned) };
      const line = canonicalJson(entry);
      if (Buffer.byteLength(line, 'utf8') > maxLineBytes) throw new RangeError('RSI ledger line exceeds maxLineBytes');
      const handle = await open(canonicalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(`${line}\n`, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      // Persist the directory entry as well, including the first ledger creation.
      const directory = await open(dirname(canonicalPath), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
      return entry;
    } finally { await releaseLock(lock); }
  });
}
