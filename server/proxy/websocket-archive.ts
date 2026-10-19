import { StringDecoder } from 'node:string_decoder';

export const WS_ARCHIVE_MAGIC = Buffer.from('AWSP1\n');
export type WsKind = 'message' | 'ping' | 'pong' | 'close';
const KINDS: readonly WsKind[] = ['message', 'ping', 'pong', 'close'];
export interface WsRecord { kind: WsKind; binary: boolean; sequence: number; elapsedMs: number; payload: Buffer }

/** No payload serialization/copy here; headers and payloads are separate writes. */
export function wsRecordHeader(kind: WsKind, binary: boolean, sequence: number, elapsedMs: number, bytes: number): Buffer {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 0xffffffff ||
    !Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isInteger(bytes) || bytes < 0 || bytes > 0xffffffff) throw new RangeError('Invalid WS record');
  const header = Buffer.alloc(18);
  header[0] = KINDS.indexOf(kind) + 1; header[1] = binary ? 1 : 0;
  header.writeUInt32BE(sequence, 2); header.writeDoubleBE(elapsedMs, 6); header.writeUInt32BE(bytes, 14);
  return header;
}

export function wsPayloadParts(value: unknown): Buffer[] {
  if (Buffer.isBuffer(value)) return [value];
  if (value instanceof ArrayBuffer) return [Buffer.from(value)];
  if (ArrayBuffer.isView(value)) return [Buffer.from(value.buffer, value.byteOffset, value.byteLength)];
  if (Array.isArray(value) && value.every(Buffer.isBuffer)) return value as Buffer[];
  if (typeof value === 'string') return [Buffer.from(value)];
  throw new TypeError('Unsupported WS payload');
}

/** Bounded source only. A partial trailing record is a prefix, never a message. */
export function readWsArchive(bytes: Uint8Array, allowPrefix = false): { records: WsRecord[]; limited: boolean } {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new RangeError('WS source limit');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < WS_ARCHIVE_MAGIC.length || !data.subarray(0, 6).equals(WS_ARCHIVE_MAGIC)) throw new Error('WS_ARCHIVE_INVALID');
  const records: WsRecord[] = [];
  let offset = 6, previousSequence = 0, previousTime = 0;
  while (offset < data.length) {
    if (records.length >= 8192) return { records, limited: true };
    if (offset + 18 > data.length) { if (allowPrefix) return { records, limited: true }; throw new Error('WS_ARCHIVE_INVALID'); }
    const kind = KINDS[data[offset]! - 1], flag = data[offset + 1]!, sequence = data.readUInt32BE(offset + 2), elapsedMs = data.readDoubleBE(offset + 6), length = data.readUInt32BE(offset + 14);
    if (kind === undefined || flag > 1 || sequence <= previousSequence || !Number.isFinite(elapsedMs) || elapsedMs < previousTime) throw new Error('WS_ARCHIVE_INVALID');
    offset += 18;
    if (offset + length > data.length) { if (allowPrefix) return { records, limited: true }; throw new Error('WS_ARCHIVE_INVALID'); }
    if (kind === 'close' && length < 2) throw new Error('WS_ARCHIVE_INVALID');
    records.push({ kind, binary: flag === 1, sequence, elapsedMs, payload: data.subarray(offset, offset + length) });
    previousSequence = sequence; previousTime = elapsedMs; offset += length;
  }
  return { records, limited: false };
}

export function wsRecordText(record: WsRecord, direction: 'request' | 'response', maxPayloadBytes = 4096): string {
  const clipped = record.payload.subarray(0, maxPayloadBytes);
  const text = record.kind === 'close' && record.payload.length >= 2
    ? `code=${record.payload.readUInt16BE(0)} ${new StringDecoder('utf8').write(clipped.subarray(2))}`
    : record.binary ? clipped.toString('base64') : new StringDecoder('utf8').write(clipped);
  return `#${record.sequence} +${record.elapsedMs.toFixed(3)}ms ${direction === 'request' ? 'client → upstream' : 'upstream → client'} ${record.kind} ${record.binary ? 'base64' : 'utf8'} ${record.payload.length}B\n${text}${clipped.length < record.payload.length ? '\n[preview truncated]' : ''}\n`;
}

/** Runs in the existing worker; binary containers never enter HTTP parsers. */
export function wsTranscript(bytes: Uint8Array, direction: 'request' | 'response', allowPrefix: boolean): { text: string | null; truncated: boolean } {
  const archive = readWsArchive(bytes, allowPrefix);
  const chunks: string[] = [];
  let remaining = 64 * 1024, truncated = archive.limited || allowPrefix;
  for (const record of archive.records) {
    if (remaining === 0) { truncated = true; break; }
    const rendered = wsRecordText(record, direction, Math.min(record.payload.length, remaining));
    const encoded = Buffer.from(rendered);
    const text = new StringDecoder('utf8').write(encoded.subarray(0, remaining));
    chunks.push(text); remaining -= Buffer.byteLength(text);
    if (encoded.length > Buffer.byteLength(text)) truncated = true;
  }
  return { text: chunks.length === 0 ? null : chunks.join(''), truncated };
}
