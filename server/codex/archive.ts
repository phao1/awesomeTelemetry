import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureBodyRef } from '../../src/core/trace-types.js';
import { WS_ARCHIVE_MAGIC, type WsRecord } from '../proxy/websocket-archive.js';
import type { CodexSource } from './source.js';

export const MAX_FRAME = 2 * 1024 * 1024;
export class CodexInspectionError extends Error {
  readonly code: 'CODEX_SOURCE_UNAVAILABLE' | 'CODEX_INSPECTION_LIMIT' | 'CODEX_INSPECTION_FAILED' | 'CODEX_INSPECTION_BUSY' | 'CODEX_SOURCE_CHANGED';
  constructor(code: CodexInspectionError['code']) { super(code); this.code = code; }
}
const fail = (): never => { throw new CodexInspectionError('CODEX_INSPECTION_FAILED'); };
export interface DirectedRecord extends WsRecord { direction: 'request' | 'response' }

async function* direction(source: CodexSource, ref: CaptureBodyRef, name: DirectedRecord['direction'], reasons: Set<string>): AsyncGenerator<DirectedRecord> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ref.id) || !/^[0-9a-f]{64}$/.test(ref.sha256)
    || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > 100 * 1024 * 1024) throw new CodexInspectionError('CODEX_SOURCE_UNAVAILABLE');
  let file;
  try { file = await open(join(source.directory, ref.id + (source.active ? '.part' : '.body')), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (!source.active || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    file = await open(join(source.directory, ref.id + '.body'), constants.O_RDONLY | constants.O_NOFOLLOW);
  }
  const info = await file.stat();
  if (!info.isFile() || info.size < ref.bytes || !source.active && info.size !== ref.bytes) { await file.close(); fail(); }
  const hash = createHash('sha256');
  const stream = ref.bytes === 0 ? null : file.createReadStream({ start: 0, end: ref.bytes - 1, highWaterMark: 64 * 1024, autoClose: false });
  const iterator = stream?.[Symbol.asyncIterator]();
  let block: Buffer = Buffer.alloc(0), position = 0, consumed = 0;
  const read = async (size: number): Promise<Buffer | null> => {
    const result = Buffer.allocUnsafe(size); let filled = 0;
    while (filled < size) {
      if (position === block.length) {
        const next = await iterator?.next();
        if (next === undefined || next.done) return filled === 0 ? null : result.subarray(0, filled);
        block = next.value as Buffer; position = 0; hash.update(block);
      }
      const count = Math.min(size - filled, block.length - position);
      block.copy(result, filled, position, position + count); filled += count; position += count; consumed += count;
    }
    return result;
  };
  let sequence = -1, elapsed = -1, count = 0;
  try {
    const magic = await read(WS_ARCHIVE_MAGIC.length);
    if (magic === null || magic.length < WS_ARCHIVE_MAGIC.length) {
      if (!source.active && ref.status === 'complete') fail();
      reasons.add(name + '_archive_prefix');
    } else {
      if (!magic.equals(WS_ARCHIVE_MAGIC)) fail();
      while (consumed < ref.bytes) {
        if (++count > 65536) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
        const header = await read(18);
        if (header === null || header.length !== 18) { reasons.add(name + '_partial_record'); break; }
        const kind = header[0], binary = header[1], seq = header.readUInt32BE(2), ms = header.readDoubleBE(6), length = header.readUInt32BE(14);
        if (kind === undefined || kind < 1 || kind > 4 || binary === undefined || binary > 1 || seq <= sequence || !Number.isFinite(ms) || ms < elapsed || ms < 0) fail();
        if (length > MAX_FRAME) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
        const payload = length === 0 ? Buffer.alloc(0) : await read(length);
        if (payload === null || payload.length !== length) { reasons.add(name + '_partial_record'); break; }
        if (kind === 4 && length < 2) fail();
        sequence = seq; elapsed = ms;
        yield { direction: name, kind: (['message', 'ping', 'pong', 'close'] as const)[kind! - 1]!, binary: binary === 1, sequence: seq, elapsedMs: ms, payload: payload! };
      }
    }
    // Hash every snapshot byte, even a partial trailing record.
    while (consumed < ref.bytes) { if (await read(Math.min(64 * 1024, ref.bytes - consumed)) === null) fail(); }
    if (consumed !== ref.bytes || hash.digest('hex') !== ref.sha256) fail();
    if (ref.status !== 'complete') reasons.add(name + (source.active ? '_live_prefix' : '_original_' + ref.status));
  } finally { stream?.destroy(); await file.close(); }
}

/** Two bounded cursors; no whole archive or frame inventory retained. */
export async function* readCodexArchive(source: CodexSource, reasons: Set<string>): AsyncGenerator<DirectedRecord> {
  const a = direction(source, source.request, 'request', reasons), b = direction(source, source.response, 'response', reasons);
  let left, right, elapsed = -1;
  try {
    left = await a.next(); right = await b.next();
    while (!left.done || !right.done) {
      if (!left.done && !right.done && left.value.sequence === right.value.sequence) fail();
      const takeLeft = right.done || !left.done && left.value.sequence < right.value.sequence;
      const value = takeLeft ? left.value! : right.value!;
      if (value.elapsedMs < elapsed) fail(); elapsed = value.elapsedMs;
      yield value;
      if (takeLeft) left = await a.next(); else right = await b.next();
    }
  } finally { await a.return(undefined); await b.return(undefined); }
}
