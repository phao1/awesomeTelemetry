import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { invalid, limit } from './format.js';

class ByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private buffer: Buffer = Buffer.alloc(0);
  private position = 0;
  private total = 0;
  constructor(source: AsyncIterable<Buffer>) { this.iterator = source[Symbol.asyncIterator](); }
  async read(count: number, eof = false): Promise<Buffer> {
    const parts: Buffer[] = []; let length = 0;
    while (length < count) {
      if (this.position === this.buffer.length) {
        const next = await this.iterator.next();
        if (next.done) { if (eof && length === 0) return Buffer.alloc(0); invalid(); }
        this.buffer = next.value; this.position = 0; this.total += this.buffer.length;
        if (this.total > 512 * 1024 * 1024) limit();
      }
      const n = Math.min(count - length, this.buffer.length - this.position);
      parts.push(this.buffer.subarray(this.position, this.position + n)); this.position += n; length += n;
    }
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts, length);
  }
}
function field(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length); const zero = bytes.indexOf(0);
  // GNU long-name headers may leave the following 100-byte legacy name cut in
  // the middle of UTF-8. That unused fallback is not the effective member name.
  return (zero < 0 ? bytes : bytes.subarray(0, zero)).toString('utf8');
}
function octal(value: string): number {
  const token = value.trim(); if (!/^[0-7]+$/.test(token)) invalid();
  const number = Number.parseInt(token, 8); if (!Number.isSafeInteger(number) || number < 0) invalid(); return number;
}
function safePath(value: string): string {
  if (value.length > 4096) limit();
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) invalid();
  return value.replace(/^(?:\.\/)+/, '');
}
function pax(bytes: Buffer): Record<string, string> {
  const result: Record<string, string> = {}; let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset); if (space < 0 || space - offset > 8) invalid();
    const size = Number(bytes.subarray(offset, space).toString('ascii'));
    if (!Number.isSafeInteger(size) || size <= space - offset + 2 || offset + size > bytes.length || bytes[offset + size - 1] !== 10) invalid();
    const line = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(space + 1, offset + size - 1));
    const equal = line.indexOf('='); if (equal < 1) invalid();
    const key = line.slice(0, equal);
    if (key === 'path' || key === 'size' || key === 'linkpath') result[key] = line.slice(equal + 1);
    offset += size;
  }
  return result;
}

/** Never extracts a member name. Only owned trace-N.json paths may be written. */
export async function extractTraceArchive(path: string, directory: string): Promise<{ files: { path: string; member: string }[]; ignoredEntries: number }> {
  const input = createReadStream(path), gunzip = createGunzip();
  input.on('error', error => gunzip.destroy(error)); input.pipe(gunzip);
  const reader = new ByteReader(gunzip as AsyncIterable<Buffer>), files: { path: string; member: string }[] = [];
  let count = 0, ignoredEntries = 0, selectedBytes = 0, extended: Record<string, string> = {}, global: Record<string, string> = {}, longName: string | null = null;
  try {
    for (;;) {
      const header = await reader.read(512);
      if (header.every(byte => byte === 0)) {
        const second = await reader.read(512); if (!second.every(byte => byte === 0)) invalid();
        for (;;) { const tail = await reader.read(512, true); if (tail.length === 0) break; if (!tail.every(byte => byte === 0)) invalid(); }
        if (Object.keys(extended).length > 0 || longName !== null) invalid();
        break;
      }
      count += 1; if (count > 50000) limit();
      const checksum = octal(field(header, 148, 8)); let actual = 0;
      for (let i = 0; i < 512; i += 1) actual += i >= 148 && i < 156 ? 32 : header[i]!;
      if (actual !== checksum) invalid();
      const type = field(header, 156, 1), rawName = field(header, 0, 100), prefix = field(header, 345, 155);
      let size = octal(field(header, 124, 12));
      if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
        if (size > 64 * 1024) limit();
        const data = await reader.read(size);
        if (type === 'x') extended = pax(data);
        else if (type === 'g') global = { ...global, ...pax(data) };
        else if (type === 'L') longName = field(data, 0, data.length).replace(/\n$/, '');
        await reader.read((512 - size % 512) % 512); ignoredEntries += 1; continue;
      }
      const attributes = { ...global, ...extended };
      const member = safePath(attributes.path ?? longName ?? (prefix ? prefix + '/' + rawName : rawName));
      if (attributes.size !== undefined) { if (!/^\d{1,12}$/.test(attributes.size)) invalid(); size = Number(attributes.size); }
      if (!Number.isSafeInteger(size) || size > 512 * 1024 * 1024) limit();
      extended = {}; longName = null;
      const selected = /(?:^|\/)traces\/[^/]+\.json$/i.test(member);
      if (selected && member.includes('\uFFFD')) invalid();
      if (selected && type !== '' && type !== '0') invalid();
      if (selected && (member.length > 512 || size > 100 * 1024 * 1024 || files.length >= 16 || selectedBytes + size > 200 * 1024 * 1024)) limit();
      const target = selected ? join(directory, `trace-${files.length}.json`) : null;
      const file = target === null ? null : await open(target, 'wx', 0o600);
      try {
        let remaining = size;
        while (remaining > 0) {
          const bytes = await reader.read(Math.min(64 * 1024, remaining)); remaining -= bytes.length;
          if (file !== null) { let offset = 0; while (offset < bytes.length) { const n = (await file.write(bytes, offset, bytes.length - offset)).bytesWritten; if (n === 0) invalid(); offset += n; } }
        }
      } finally { await file?.close(); }
      if (target !== null) { files.push({ path: target, member }); selectedBytes += size; } else ignoredEntries += 1;
      await reader.read((512 - size % 512) % 512);
    }
    if (files.length === 0) invalid();
    return { files, ignoredEntries };
  } finally { input.destroy(); gunzip.destroy(); }
}
