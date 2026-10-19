import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { CaptureContentEncoding } from '../../src/core/trace-types.js';

export type BodyDecodeReason = 'source_too_large' | 'decoded_too_large' | 'invalid_utf8' | 'unsupported_content_encoding' | 'decode_failed';
export type BodyDecodeResult = { ok: true; body: string } | { ok: false; reason: BodyDecodeReason };
class DecodeFailure extends Error { readonly reason: BodyDecodeReason; constructor(reason: BodyDecodeReason) { super(reason); this.reason = reason; } }

export function contentEncoding(value: string | null | undefined): CaptureContentEncoding {
  const encoding = value?.trim().toLowerCase() ?? '';
  return encoding === '' || encoding === 'identity' ? 'identity'
    : encoding === 'gzip' || encoding === 'br' || encoding === 'deflate' ? encoding : 'unsupported';
}

/** Shared incremental source/decoded bound; never changes the observed bytes. */
export async function decodeBodyBytes(source: Uint8Array | AsyncIterable<Uint8Array>, options: { contentEncoding?: string | null; maxBytes?: number; allowTruncatedUtf8?: boolean; onText?: (text: string) => void } = {}): Promise<BodyDecodeResult> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('Invalid decoded body bound');
  const encoding = contentEncoding(options.contentEncoding);
  if (encoding === 'unsupported') return { ok: false, reason: 'unsupported_content_encoding' };
  const pieces: string[] = [];
  let pending: string[] = [], pendingChars = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  async function* encoded(): AsyncGenerator<Uint8Array> {
    // Buffer/Uint8Array can originate in another VM/jsdom realm; instanceof
    // would treat a Buffer as an iterable of numbers and silently decode none.
    const input = ArrayBuffer.isView(source) ? [source as Uint8Array] : source as AsyncIterable<Uint8Array>;
    let bytes = 0;
    for await (const chunk of input) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new DecodeFailure('source_too_large');
      for (let offset = 0; offset < chunk.byteLength; offset += 8192) yield chunk.subarray(offset, offset + 8192);
    }
  }
  const consume = async (chunks: AsyncIterable<Buffer>): Promise<void> => {
    let decodedBytes = 0;
    const accept = (text: string): void => {
      if (text === '') return;
      pending.push(text); pendingChars += text.length;
      if (pendingChars >= 8192) { pieces.push(pending.join('')); pending = []; pendingChars = 0; }
      options.onText?.(text);
    };
    for await (const chunk of chunks) {
      decodedBytes += chunk.byteLength;
      if (decodedBytes > maxBytes) throw new DecodeFailure('decoded_too_large');
      let text: string;
      try { text = decoder.decode(chunk, { stream: true }); }
      catch { throw new DecodeFailure('invalid_utf8'); }
      accept(text);
    }
    if (options.allowTruncatedUtf8 !== true) {
      let text: string;
      try { text = decoder.decode(); } catch { throw new DecodeFailure('invalid_utf8'); }
      accept(text);
    }
  };
  try {
    const input = Readable.from(encoded(), { objectMode: false });
    const decompress = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
    if (decompress === null) await pipeline(input, consume);
    else await pipeline(input, decompress, consume);
    if (pending.length > 0) pieces.push(pending.join(''));
    return { ok: true, body: pieces.join('') };
  } catch (error) { return { ok: false, reason: error instanceof DecodeFailure ? error.reason : 'decode_failed' }; }
}
