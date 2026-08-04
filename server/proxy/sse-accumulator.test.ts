import { describe, expect, it } from 'vitest';

import { extractTokenUsageFromSse, parseSseChunk } from './sse-accumulator.js';

describe('REQ-010 sse-accumulator', () => {
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
