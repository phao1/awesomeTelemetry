import { describe, expect, it } from 'vitest';

import { extractTokenUsageFromSse, parseSseChunk, SseDecoder } from './sse-accumulator.js';

describe('REQ-010 sse-accumulator', () => {
  it('does not dispatch a final data/terminal frame at EOF without its blank line', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: valid\n\ndata: [DONE]\n')).toEqual([{ data: 'valid' }]);
    expect(decoder.finish()).toEqual([]);
    expect(decoder.incompleteEvents).toBe(1);
    expect(decoder.finish()).toEqual([]);
  });
  it('strips one initial BOM, ignores event-only blocks, keeps last id and preserves empty data events', () => {
    const decoder = new SseDecoder();
    const bytes = Buffer.from('\ufeffid: native-1\r\nevent: unused\r\n\r\ndata:\r\n\r\ndata: \ufefftext\r\n\r\n');
    const events = [...bytes].flatMap(byte => decoder.push(Buffer.from([byte])));
    events.push(...decoder.finish());
    expect(events).toEqual([{ id: 'native-1', data: '' }, { id: 'native-1', data: '\ufefftext' }]);
    expect(decoder.incompleteEvents).toBe(0);
  });
  it('reconstructs byte-by-byte UTF-8 and CRLF framing without treating comments as content', () => {
    const decoder = new SseDecoder();
    const original = ': heartbeat\r\nevent: delta\r\ndata: 中文\r\ndata:  second line\r\n\r\n';
    const events = [...Buffer.from(original)].flatMap(byte => decoder.push(Buffer.from([byte])));
    events.push(...decoder.finish());
    expect(events).toEqual([{ event: 'delta', data: '中文\n second line' }]);
    expect(decoder.droppedEvents).toBe(0);
  });

  it('accepts every split position across the same SSE payload', () => {
    const bytes = Buffer.from('data: {"text":"中文"}\r\n\r\ndata: [DONE]\n\n');
    for (let split = 0; split <= bytes.length; split += 1) {
      const decoder = new SseDecoder();
      const events = [...decoder.push(bytes.subarray(0, split)), ...decoder.push(bytes.subarray(split)), ...decoder.finish()];
      expect(events).toEqual([{ data: '{"text":"中文"}' }, { data: '[DONE]' }]);
    }
  });

  it('bounds oversized events, records the drop and recovers at the next event boundary', () => {
    const decoder = new SseDecoder(20);
    expect(decoder.push('data: ' + 'x'.repeat(30))).toEqual([]);
    expect(decoder.push('\nmore oversized\n\ndata: ok\n\n')).toEqual([{ data: 'ok' }]);
    expect(decoder.droppedEvents).toBe(1);
    expect(decoder.finish()).toEqual([]);
  });

  it('merges nested partial usage snapshots without summing duplicate updates', () => {
    const events = [
      { data: '{"message":{"usage":{"input_tokens":12,"output_tokens":0}}}' },
      { data: '{"usage":{"output_tokens":7}}' },
      { data: '{"usage":{"output_tokens":7}}' },
    ];
    expect(extractTokenUsageFromSse(events)).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect(extractTokenUsageFromSse([{ data: '{"response":{"usage":{"input_tokens":0,"output_tokens":0}}}' }])).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('rejects invalid counters and malformed data without fabricating zero usage', () => {
    expect(extractTokenUsageFromSse([{ data: '{"usage":{"input_tokens":-1,"output_tokens":"7"}}' }, { data: 'null' }, { data: '[DONE]' }])).toBeNull();
  });
  it('parseSseChunk 按空行分块并拼接 data', () => {
    const events = parseSseChunk('event: x\ndata: a\ndata: b\n\nid: 1\ndata: {"n":1}\n\n');
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe('x');
    expect(events[0]?.data).toBe('a\nb');
    expect(events[1]?.id).toBe('1');
  });

  it('extractTokenUsageFromSse 识别 OpenAI 与 Anthropic 字段', () => {
    const events = parseSseChunk(
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
        'data: {"usage":{"input_tokens":20,"output_tokens":7}}\n\n',
    );
    const usage = extractTokenUsageFromSse(events);
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 7 }); // 后者覆盖
  });

  it('无 usage 时返回 null', () => {
    expect(extractTokenUsageFromSse(parseSseChunk('data: {"ok":true}\n\n'))).toBeNull();
  });
});
