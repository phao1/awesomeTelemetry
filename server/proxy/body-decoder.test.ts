import { describe, expect, it } from 'vitest';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { decodeBodyBytes } from './body-decoder.js';
import { SseDecoder, type SseEvent } from './sse-accumulator.js';

async function* oneByte(bytes: Uint8Array) { for (const byte of bytes) yield Uint8Array.of(byte); }
describe('bounded incremental content decoding', () => {
  it('preserves byte-split Chinese/BOM and multiline CRLF SSE events', async () => {
    const text = '\ufeff: heartbeat\r\nevent: delta\r\ndata: 中文🙂\r\ndata: second\r\n\r\ndata: [DONE]\r\n\r\n';
    const sse = new SseDecoder(); const events: SseEvent[] = [];
    const result = await decodeBodyBytes(oneByte(Buffer.from(text)), { onText: text => events.push(...sse.push(text)) });
    events.push(...sse.finish());
    expect(result).toEqual({ ok: true, body: text });
    expect(events).toEqual([{ event: 'delta', data: '中文🙂\nsecond' }, { data: '[DONE]' }]);
  });
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('incrementally decodes %s with fragmented encoded input and unchanged source', async (encoding, compress) => {
    const text = '{"content":"中文🙂","tool":"literal"}';
    const bytes = compress(Buffer.from(text)); const snapshot = Buffer.from(bytes);
    expect(await decodeBodyBytes(oneByte(bytes), { contentEncoding: encoding })).toEqual({ ok: true, body: text });
    expect(bytes).toEqual(snapshot);
  });
  it('bounds both source and decoded bytes and refuses stacked/unknown encodings or corrupt compressed input', async () => {
    expect(await decodeBodyBytes(Buffer.from('x'.repeat(33)), { maxBytes: 32 })).toEqual({ ok: false, reason: 'source_too_large' });
    const bomb = gzipSync(Buffer.from('x'.repeat(1024 * 1024)));
    expect(await decodeBodyBytes(bomb, { contentEncoding: 'gzip', maxBytes: 4096 })).toEqual({ ok: false, reason: 'decoded_too_large' });
    expect(await decodeBodyBytes(bomb, { contentEncoding: 'gzip, br' })).toEqual({ ok: false, reason: 'unsupported_content_encoding' });
    expect(await decodeBodyBytes(bomb.subarray(0, bomb.length - 3), { contentEncoding: 'gzip' })).toEqual({ ok: false, reason: 'decode_failed' });
  });
  it('never replaces malformed UTF-8 or a bounded trailing partial character with invented content', async () => {
    const bytes = Buffer.from('a中');
    expect(await decodeBodyBytes(oneByte(Uint8Array.of(0xff)))).toEqual({ ok: false, reason: 'invalid_utf8' });
    expect(await decodeBodyBytes(bytes.subarray(0, bytes.length - 1))).toEqual({ ok: false, reason: 'invalid_utf8' });
    expect(await decodeBodyBytes(bytes.subarray(0, bytes.length - 1), { allowTruncatedUtf8: true })).toEqual({ ok: true, body: 'a' });
  });
  it('cleans an exceptional source/consumer rather than misreporting it as invalid UTF-8', async () => {
    async function* failing() { yield Buffer.from('text'); throw new Error('synthetic private exception'); }
    expect(await decodeBodyBytes(failing())).toEqual({ ok: false, reason: 'decode_failed' });
    expect(await decodeBodyBytes(Buffer.from('text'), { onText: () => { throw new Error('synthetic private exception'); } })).toEqual({ ok: false, reason: 'decode_failed' });
  });
});
