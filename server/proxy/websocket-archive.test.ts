import { describe, expect, it } from 'vitest';
import { readWsArchive, WS_ARCHIVE_MAGIC, wsPayloadParts, wsRecordHeader, wsTranscript } from './websocket-archive.js';

const frame = (payload: Buffer, sequence = 1, binary = false) => Buffer.concat([wsRecordHeader('message', binary, sequence, sequence * 1.25, payload.length), payload]);
describe('AWSP1 application-message archive', () => {
  it('retains Unicode, zero-length/binary messages, boundaries and cross-direction sequence gaps', () => {
    const a = Buffer.from('中文\n{"type":"response.completed"}'), b = Buffer.from([0, 255, 128]);
    const archive = Buffer.concat([WS_ARCHIVE_MAGIC, frame(a), frame(b, 3, true), frame(Buffer.alloc(0), 5)]);
    expect(readWsArchive(archive).records.map(r => [r.sequence, r.elapsedMs, r.binary, r.payload])).toEqual([[1, 1.25, false, a], [3, 3.75, true, b], [5, 6.25, false, Buffer.alloc(0)]]);
    const preview = wsTranscript(archive, 'response', false);
    expect(preview.truncated).toBe(false); expect(preview.text).toContain('upstream → client'); expect(preview.text).toContain('中文'); expect(preview.text).toContain(b.toString('base64'));
  });
  it('does not invent a message from a partial record; strict complete archives reject it', () => {
    const source = Buffer.concat([WS_ARCHIVE_MAGIC, frame(Buffer.from('prefix')), frame(Buffer.from('incomplete'), 2)]).subarray(0, -3);
    expect(() => readWsArchive(source)).toThrow('WS_ARCHIVE_INVALID');
    expect(readWsArchive(source, true)).toMatchObject({ limited: true, records: [{ sequence: 1 }] });
    expect(wsTranscript(source, 'request', true).text).not.toContain('incomplete');
  });
  it('rejects invalid header, nonmonotonic order/time and source overrun', () => {
    expect(() => readWsArchive(Buffer.from('not archive'))).toThrow();
    expect(() => readWsArchive(Buffer.concat([WS_ARCHIVE_MAGIC, frame(Buffer.alloc(0)), frame(Buffer.alloc(0))]))).toThrow();
    const bad = frame(Buffer.alloc(0)); bad.writeDoubleBE(NaN, 6);
    expect(() => readWsArchive(Buffer.concat([WS_ARCHIVE_MAGIC, bad]))).toThrow();
    expect(() => readWsArchive(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow(RangeError);
  });
  it('bounds readable transcript and record counts independently from originals', () => {
    const payload = Buffer.from('中'.repeat(50_000));
    const source = Buffer.concat([WS_ARCHIVE_MAGIC, frame(payload)]);
    const view = wsTranscript(source, 'request', false);
    expect(Buffer.byteLength(view.text!)).toBeLessThanOrEqual(65536); expect(view.truncated).toBe(true); expect(view.text).not.toContain('�');
    const small = Array.from({ length: 8193 }, (_, i) => frame(Buffer.alloc(0), i + 1));
    expect(readWsArchive(Buffer.concat([WS_ARCHIVE_MAGIC, ...small]))).toMatchObject({ limited: true });
    expect(readWsArchive(source).records[0]!.payload.equals(payload)).toBe(true);
  });
  it('normalizes engine payload views without mutating or concatenating caller buffers', () => {
    const payload = Buffer.from([1, 2, 3]);
    expect(wsPayloadParts(payload)[0]).toBe(payload);
    expect(wsPayloadParts([payload, payload])).toEqual([payload, payload]);
    expect(wsPayloadParts(new Uint8Array([4, 5]))[0]).toEqual(Buffer.from([4, 5]));
    expect(() => wsPayloadParts({})).toThrow(TypeError);
  });
});
