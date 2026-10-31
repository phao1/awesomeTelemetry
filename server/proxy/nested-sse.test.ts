import { describe, expect, it } from 'vitest';

import { SseDecoder } from './sse-accumulator.js';
import { unwrapQoderSseFrame } from './nested-sse.js';

function wrapper(frame: unknown, statusCode = 'OK') {
  return { headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(frame), statusCode };
}

const chunk = { object: 'chat.completion.chunk', id: 'native-response', model: 'synthetic-model', choices: [{ index: 0, delta: { content: '中文🙂' } }] };

describe('Qoder single-layer SSE envelope', () => {
  it('unwraps the documented string body while preserving original wrapper and native fields', () => {
    const outer = wrapper(chunk);
    const before = JSON.stringify(outer);
    expect(unwrapQoderSseFrame(outer)).toEqual({ kind: 'frame', frame: chunk, sourcePathSuffix: '.body' });
    expect(JSON.stringify(outer)).toBe(before);
  });

  it('accepts usage-only standard chat chunks with genuine zero counters and empty choices', () => {
    const frame = { object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 100, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 0 }, total_tokens: 100 } };
    expect(unwrapQoderSseFrame(wrapper(frame))).toEqual({ kind: 'frame', frame, sourcePathSuffix: '.body' });
  });

  it('preserves parallel tool argument fragments without joining, renumbering or rewriting ids', () => {
    const frame = { object: 'chat.completion.chunk', choices: [{ index: 1, delta: { tool_calls: [{ index: 3, id: 'call:7', function: { name: 'Read', arguments: '{"路径":' } }] } }] };
    expect(unwrapQoderSseFrame(wrapper(frame))).toMatchObject({ kind: 'frame', frame });
  });

  it.each([null, [], '[DONE]', chunk, { body: JSON.stringify(chunk) }, { headers: {}, body: JSON.stringify(chunk) }, { headers: [], statusCode: 'OK', body: JSON.stringify(chunk) }])('does not guess wrappers from unrelated values: %j', value => {
    expect(unwrapQoderSseFrame(value)).toBeNull();
  });

  it.each(['ERROR', 'FAILED', '200', 'ok', ''])('does not interpret non-OK wrapper status %j as successful content', statusCode => {
    expect(unwrapQoderSseFrame(wrapper(chunk, statusCode))).toEqual({ kind: 'invalid', reason: 'qoder_status', statusCode, sourcePathSuffix: '.statusCode' });
  });

  it.each(['{', '[DONE]', '', null, 42, chunk])('rejects malformed or non-string inner bodies: %j', body => {
    expect(unwrapQoderSseFrame({ headers: {}, statusCode: 'OK', body })).toEqual({ kind: 'invalid', reason: 'qoder_body_invalid', statusCode: 'OK', sourcePathSuffix: '.body' });
  });

  it.each([null, [], 'text', { object: 'chat.completion.chunk' }, { object: 'chat.completion', choices: [] }, { body: JSON.stringify(chunk), headers: {}, statusCode: 'OK' }, { response: chunk }])('never recursively unwraps or guesses an unsupported inner protocol: %j', inner => {
    expect(unwrapQoderSseFrame(wrapper(inner))).toEqual({ kind: 'invalid', reason: 'qoder_inner_shape', statusCode: 'OK', sourcePathSuffix: '.body' });
  });

  it('bounds the decoded body by UTF-8 bytes instead of character count', () => {
    const outer = wrapper({ ...chunk, extra: '中'.repeat(700_000) });
    expect(outer.body.length).toBeLessThan(2 * 1024 * 1024);
    expect(unwrapQoderSseFrame(outer)).toEqual({ kind: 'invalid', reason: 'qoder_body_limit', statusCode: 'OK', sourcePathSuffix: '.body' });
  });

  it('works after actual incremental SSE framing across every UTF-8 byte boundary', () => {
    const bytes = Buffer.from('data:' + JSON.stringify(wrapper(chunk)) + '\r\n\r\n');
    for (let split = 1; split < bytes.length; split += 1) {
      const decoder = new SseDecoder();
      const events = [...decoder.push(bytes.subarray(0, split)), ...decoder.push(bytes.subarray(split)), ...decoder.finish()];
      expect(events).toHaveLength(1);
      expect(unwrapQoderSseFrame(JSON.parse(events[0]!.data!))).toEqual({ kind: 'frame', frame: chunk, sourcePathSuffix: '.body' });
    }
  });
});
