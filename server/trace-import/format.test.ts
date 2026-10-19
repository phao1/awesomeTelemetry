import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { TraceJsonFramer, parseTrace, projectTurn } from './format.js';

describe('TraceLog bounded byte framing and source-reported projection', () => {
  it.each([1, 2, 3, 7, 65536])('preserves exact byte offsets with UTF-8/escaped quotes across %i byte chunks', async size => {
    const session = { session_id: 'native', ide_type: 'codex', title: '中文🙂', start_time: '2026-10-16T09:00:00.123456+08:00' };
    const turns = [{ turn_id: 't1', messages: JSON.stringify([{ role: 'user', content: '\\"{}[]中文🙂' }]), input_tokens: 12, output_tokens: 7, total_tokens: 19, tool_time_ms: 900, extra: { unknown: true } },
      { turn_id: 't2', output_text: '<script>INERT</script>', is_error: true }];
    const bytes = Buffer.from(JSON.stringify({ turns, session }, null, 2)); const framer = new TraceJsonFramer();
    const framed = []; for (let i = 0; i < bytes.length; i += size) framed.push(...framer.feed(bytes.subarray(i, i + size))); framer.finish();
    expect(framed.map(item => JSON.parse(item.bytes.toString()) as unknown)).toEqual([...turns, session]);
    for (const item of framed) expect(bytes.subarray(item.offset, item.offset + item.bytes.length)).toEqual(item.bytes);
    const dir = await mkdtemp(join(tmpdir(), 'trace-format-'));
    try {
      const path = join(dir, 'trace.json'); await writeFile(path, bytes); const parsed = await parseTrace(path, null);
      expect(parsed.sha256).toBe(createHash('sha256').update(bytes).digest('hex')); expect(parsed.bytes).toBe(bytes.length);
      expect(parsed.metadata).toMatchObject({ nativeSessionId: 'native', ideType: 'codex', title: '中文🙂', startedAt: '2026-10-16T01:00:00.123Z', endedAt: null });
      expect(parsed.turns[0]!.metadata).toMatchObject({ hasOutput: false, reported: { input_tokens: 12, output_tokens: 7, total_tokens: 19, tool_time_ms: 900, cache_read_tokens: null } });
      expect(parsed.turns[1]!.metadata).toMatchObject({ hasOutput: true, isError: true });
      expect(JSON.stringify(parsed.metadata) + JSON.stringify(parsed.turns)).not.toContain('INERT');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it.each(['{}', '{"session":{},"turns":[],}', '{"session":{},"turns":[{},]}', '{"session":{},"turns":[]} trailing',
    '{"session":{},"session":{},"turns":[]}', '{"session":{},"turns":[false]}', '{"session":{},"turns":[{}]', '{"other":1,"session":{},"turns":[]}'])('rejects invalid structure %s', input => {
    const parser = new TraceJsonFramer(); expect(() => { parser.feed(Buffer.from(input)); parser.finish(); }).toThrow('TRACE_IMPORT_INVALID');
  });
  it('bounds an unterminated object before allocating a whole large file', () => {
    const parser = new TraceJsonFramer(); expect(() => parser.feed(Buffer.from('{"session":{"x":"' + 'x'.repeat(65536)))).toThrow('TRACE_IMPORT_LIMIT');
  });
  it('keeps unavailable/negative/string counters null rather than inventing zero or timing precision', () => {
    const result = projectTurn({ input_tokens: -1, output_tokens: '7', total_tokens: 0, request_time: '2026-10-16 12:00:00', is_error: 'false' }, 0);
    expect(result.reported).toMatchObject({ input_tokens: null, output_tokens: null, total_tokens: 0 }); expect(result.requestTime).toBeNull(); expect(result.isError).toBeNull();
  });
  it.each(['2026-02-30T01:00:00Z', '2026-10-16T24:00:00Z', '2026-10-16T00:60:00Z', '2026-10-16T00:00:60Z'])('does not normalize an invalid calendar/clock into a fabricated UTC instant (%s)', value => {
    expect(projectTurn({ request_time: value, response_time: value }, 0)).toMatchObject({ requestTime: null, responseTime: null });
  });
});
