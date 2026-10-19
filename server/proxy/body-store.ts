import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, unlink, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setImmediate as yieldImmediate } from 'node:timers/promises';

import type {
  CaptureBodyRef,
  CaptureBodyStatus,
  CaptureStorageConfig,
  CaptureStorageStatus,
} from '../../src/core/trace-types.js';

export const DEFAULT_CAPTURE_STORAGE: Readonly<CaptureStorageConfig> = Object.freeze({
  quotaBytes: 10_000_000_000,
  maxBodyBytes: 100 * 1024 * 1024,
  maxPendingBytes: 32 * 1024 * 1024,
});

const BODY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return 'CAPTURE_WRITE_FAILED';
}

/** No directory-sized inventory; includes crash remnants, never follows symlinks. */
async function countOriginalBytes(directory: string): Promise<number> {
  let bytes = 0;
  for await (const entry of await opendir(directory)) {
    const id = entry.name.replace(/\.(body|part)$/, '');
    if (entry.isFile() && BODY_ID.test(id) && /\.(body|part)$/.test(entry.name)) {
      const info = await lstat(join(directory, entry.name)).catch((error: unknown) => { if (errorCode(error) === 'ENOENT') return null; throw error; });
      if (info?.isFile()) bytes += info.size;
    }
    await yieldImmediate();
  }
  return bytes;
}

/** Single owner per directory. Files are originals, never redacted or evicted. */
export class CaptureBodyStore {
  private usedBytes = 0;
  private pendingBytes = 0;
  private pendingOperations = 0;
  private activeBodies = 0;
  private activeReaders = 0;
  private removing = false;
  readonly directory: string;
  readonly config: Readonly<CaptureStorageConfig>;

  private constructor(directory: string, config: Readonly<CaptureStorageConfig>) {
    this.directory = directory;
    this.config = config;
  }

  static async create(
    directory: string,
    overrides: Partial<CaptureStorageConfig> = {},
  ): Promise<CaptureBodyStore> {
    const config = { ...DEFAULT_CAPTURE_STORAGE, ...overrides };
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
    const store = new CaptureBodyStore(resolve(directory), Object.freeze(config));
    await mkdir(store.directory, { recursive: true, mode: 0o700 });
    // Includes crash remnants: restarting must not reclaim or overwrite evidence.
    store.usedBytes = await countOriginalBytes(store.directory);
    return store;
  }

  status(): CaptureStorageStatus {
    return {
      ...this.config,
      usedBytes: this.usedBytes,
      pendingBytes: this.pendingBytes,
      activeBodies: this.activeBodies,
      exhausted: this.usedBytes >= this.config.quotaBytes,
    };
  }

  openRead(id: string, range?: { start: number; end: number }): ReadStream {
    if (!BODY_ID.test(id)) {
      throw new TypeError('Invalid capture body id');
    }
    if (this.removing) throw new Error('CAPTURE_STORE_BUSY');
    if (range !== undefined && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) throw new TypeError('Invalid capture byte range');
    const stream = createReadStream(join(this.directory, `${id}.body`), range);
    this.activeReaders += 1;
    stream.once('close', () => { this.activeReaders -= 1; });
    return stream;
  }

  /** Internal only: caller MUST first persist confirmed deletion intent. */
  async removeOriginals(ids: readonly string[]): Promise<number> {
    if (ids.length < 1 || ids.length > 2 || ids.some(id => !BODY_ID.test(id))) throw new TypeError('CAPTURE_DELETE_INVALID_IDS');
    if (this.removing || this.activeBodies > 0 || this.activeReaders > 0) throw new Error('CAPTURE_STORE_BUSY');
    this.removing = true;
    const before = this.usedBytes;
    const paths = [...new Set(ids)].flatMap(id => [join(this.directory, id + '.body'), join(this.directory, id + '.part')]);
    try {
      // Validate every candidate before the first irreversible unlink. An absent
      // file is idempotent; nonregular paths are evidence conflicts, not trees.
      for (const path of paths) {
        const info = await lstat(path).catch((error: unknown) => { if (errorCode(error) === 'ENOENT') return null; throw new Error('CAPTURE_DELETE_FAILED'); });
        if (info !== null && (!info.isFile() || info.isSymbolicLink())) throw new Error('CAPTURE_DELETE_CONFLICT');
      }
      for (const path of paths) await unlink(path).catch((error: unknown) => { if (errorCode(error) !== 'ENOENT') throw new Error('CAPTURE_DELETE_FAILED'); });
    } finally {
      // Also reconciles a partial unlink failure; never credit all requested
      // bytes before disk confirms the surviving original-file inventory.
      try { this.usedBytes = await countOriginalBytes(this.directory); }
      finally { this.removing = false; }
    }
    return Math.max(0, before - this.usedBytes);
  }

  /** Startup only, before this store starts accepting new captures. Never guesses completeness. */
  async recover(id: string, expected: CaptureBodyRef | null = null): Promise<CaptureBodyRef> {
    if (!BODY_ID.test(id) || (expected !== null && expected.id !== id)) throw new TypeError('CAPTURE_RECOVERY_INVALID_ID');
    if (this.removing) throw new Error('CAPTURE_STORE_BUSY');
    this.activeReaders += 1;
    try {
      const paths = [join(this.directory, `${id}.body`), join(this.directory, `${id}.part`)];
      const info = await Promise.all(paths.map(path => lstat(path).catch((error: unknown) => {
        if (errorCode(error) === 'ENOENT') return null;
        throw new Error('CAPTURE_RECOVERY_READ_FAILED');
      })));
      if (info.some(value => value !== null && (!value.isFile() || value.isSymbolicLink())) || info.every(value => value !== null)) throw new Error('CAPTURE_RECOVERY_CONFLICT');
      const index = info[0] !== null ? 0 : 1;
      if (info[index] === null) return { ...(expected ?? { id, bytes: 0, sha256: createHash('sha256').digest('hex') }), status: 'write_error', error: 'CAPTURE_BODY_MISSING' };
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(paths[index]!, { highWaterMark: 64 * 1024 })) { hash.update(chunk as Buffer); bytes += (chunk as Buffer).length; await yieldImmediate(); }
      const sha256 = hash.digest('hex');
      if (expected !== null && (expected.bytes !== bytes || expected.sha256 !== sha256)) throw new Error('CAPTURE_RECOVERY_INTEGRITY_FAILED');
      if (index === 1) await rename(paths[1]!, paths[0]!);
      return expected ?? { id, bytes, sha256, status: 'interrupted', error: 'CAPTURE_PROCESS_LOST' };
    } finally { this.activeReaders -= 1; }
  }

  begin(admission: Promise<void> = Promise.resolve()): CaptureBodyWriter {
    if (this.removing) throw new Error('CAPTURE_STORE_BUSY');
    const id = randomUUID();
    const partialPath = join(this.directory, `${id}.part`);
    const hash = createHash('sha256');
    let status: CaptureBodyStatus = 'complete';
    let error: string | null = null;
    let handle: FileHandle | null = null;
    let accepted = 0;
    let written = 0;
    let closed = false;
    let writeFailed = false;
    let result: Promise<CaptureBodyRef> | null = null;
    let finalRef: CaptureBodyRef | null = null;
    this.activeBodies += 1;

    const fail = (cause: unknown): void => {
      status = 'write_error';
      error = errorCode(cause);
      writeFailed = true;
    };
    let chain = admission.then(() => open(partialPath, 'wx', 0o600)).then((file) => {
      handle = file;
    }).catch(fail);

    const append = (chunk: Uint8Array): boolean => {
      if (closed || status !== 'complete') return false;
      if (chunk.byteLength === 0) return true;
      if (accepted + chunk.byteLength > this.config.maxBodyBytes) {
        status = 'body_limit';
        return false;
      }
      if (this.usedBytes + chunk.byteLength > this.config.quotaBytes) {
        status = 'quota_exceeded';
        return false;
      }
      if (this.pendingBytes + chunk.byteLength > this.config.maxPendingBytes) {
        status = 'queue_full';
        return false;
      }
      if (this.pendingOperations >= 4096) { status = 'queue_full'; error = 'CAPTURE_PENDING_OPERATIONS_LIMIT'; return false; }
      // Own the bytes: the forwarding engine is free to reuse its input buffer.
      const bytes = Buffer.from(chunk);
      accepted += bytes.length;
      this.usedBytes += bytes.length;
      this.pendingBytes += bytes.length;
      this.pendingOperations += 1;
      chain = chain.then(async () => {
        try {
          if (writeFailed || handle === null) return;
          let offset = 0;
          while (offset < bytes.length) {
            const count = (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten;
            if (count === 0) throw new Error('Zero-byte capture write');
            hash.update(bytes.subarray(offset, offset + count));
            offset += count;
            written += count;
          }
        } catch (cause) {
          fail(cause);
        } finally {
          this.pendingBytes -= bytes.length;
          this.pendingOperations -= 1;
        }
      });
      return true;
    };

    const finish = (interrupted = false, reason?: string): Promise<CaptureBodyRef> => {
      if (result !== null) return result;
      closed = true;
      if (interrupted && status === 'complete') {
        status = 'interrupted';
        error = reason?.slice(0, 1024) ?? null;
      }
      result = (async () => {
        await chain;
        if (handle !== null) {
          try {
            await handle.sync();
          } catch (cause) {
            fail(cause);
          }
          try {
            await handle.close();
          } catch (cause) {
            fail(cause);
          }
          try {
            await rename(partialPath, join(this.directory, `${id}.body`));
          } catch (cause) {
            fail(cause);
          }
        }
        // Failed/unwritten reservations are released; successfully written bytes stay.
        this.usedBytes -= accepted - written;
        this.activeBodies -= 1;
        finalRef = { id, bytes: written, sha256: hash.digest('hex'), status, error };
        return finalRef;
      })();
      return result;
    };
    return { id, append, finish, snapshot: () => finalRef ?? { id, bytes: written, sha256: hash.copy().digest('hex'), status: status === 'complete' ? 'interrupted' : status, error: error ?? 'LIVE_PREFIX' } };
  }
}

export interface CaptureBodyWriter {
  readonly id: string;
  /** Private written-prefix observation; never promises queued/future bytes. */
  snapshot(): CaptureBodyRef;
  /** False means collection stopped; forwarding must continue unchanged. */
  append(chunk: Uint8Array): boolean;
  /** Resolves after accepted writes flush. Repeated calls return the same result. */
  finish(interrupted?: boolean, reason?: string): Promise<CaptureBodyRef>;
}
