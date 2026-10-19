import { describe, expect, it } from 'vitest';
import { classifyContentTiming, type ResponseArrivalTimeline } from './network-timing.js';
import type { CaptureNetworkTiming, RequestContextFormat } from '../../src/core/trace-types.js';

const timing = (): CaptureNetworkTiming => ({ version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150,
  firstContentMs: null, firstContentKind: null, firstContentBasis: null, completedMs: 2000,
  contentTimingStatus: 'not_collected', serverTiming: 'inference;dur=720', serverTimingTruncated: false });
function project(parts: Array<[string | Buffer, number]>, format: RequestContextFormat = 'openai_chat', options: { streaming?: boolean; complete?: boolean; encoding?: string; limited?: boolean } = {}) {
  let offset = 0;
  const timeline: ResponseArrivalTimeline = { offsets: new Uint32Array(parts.length), elapsedMs: new Float64Array(parts.length), count: parts.length, limited: options.limited ?? false };
  parts.forEach(([bytes, ms], i) => { offset += Buffer.byteLength(bytes); timeline.offsets[i] = offset; timeline.elapsedMs[i] = ms; });
  return classifyContentTiming({ timing: timing(), bytes: Buffer.concat(parts.map(([part]) => Buffer.from(part))), timeline,
    format, streaming: options.streaming ?? true, responseComplete: options.complete ?? true, encoding: options.encoding });
}
const frame = (value: unknown): string => 'data: ' + JSON.stringify(value) + '\n\n';

describe('worker-side arrival-backed first-content timing', () => {
  it('distinguishes 100ms headers, 150ms heartbeat, 800ms content and 2000ms network end', () => {
    const result = project([[': ping\n\n' + frame({ choices: [{ delta: { role: 'assistant', content: '' } }] }), 150],
      [frame({ choices: [{ delta: { content: '中文🙂' } }] }), 800], ['data: [DONE]\n\n', 1900]]);
    expect(result).toEqual({ ...timing(), firstContentMs: 800, firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', contentTimingStatus: 'observed' });
  });
  it.each([
    ['openai_chat', { choices: [{ delta: { reasoning_content: 'public summary' } }] }, 'reasoning'],
    ['openai_chat', { choices: [{ delta: { tool_calls: [{ function: { arguments: '{' } }] } }] }, 'tool_arguments'],
    ['openai_responses', { type: 'response.output_text.delta', delta: 'hello' }, 'text'],
    ['openai_responses', { type: 'response.reasoning_summary_text.delta', delta: 'summary' }, 'reasoning'],
    ['openai_responses', { type: 'response.function_call_arguments.delta', delta: '{' }, 'tool_arguments'],
    ['anthropic_messages', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }, 'text'],
    ['anthropic_messages', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'public reasoning' } }, 'reasoning'],
    ['anthropic_messages', { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } }, 'tool_arguments'],
  ] as const)('classifies %s content as %s at the observed dispatch time', (format, value, kind) => {
    expect(project([[': heartbeat\n\n', 150], [frame(value), 800]], format)).toMatchObject({ firstContentMs: 800, firstContentKind: kind, contentTimingStatus: 'observed' });
  });
  it('waits for split UTF-8, JSON and SSE blank-line dispatch rather than the first byte', () => {
    const bytes = Buffer.from(frame({ choices: [{ delta: { content: '中🙂' } }] }));
    const middle = bytes.indexOf(Buffer.from('中')) + 1;
    expect(project([[bytes.subarray(0, middle), 200], [bytes.subarray(middle, -1), 800], [bytes.subarray(-1), 900]])).toMatchObject({ firstContentMs: 900, firstContentKind: 'text' });
  });
  it('never dispatches incomplete EOF or malformed frames as valid content', () => {
    expect(project([[frame({ choices: [{ delta: { content: 'unfinished' } }] }).trimEnd(), 800]])).toMatchObject({ firstContentMs: null, contentTimingStatus: 'decode_error' });
    expect(project([['data: {broken}\n\n', 200], [frame({ choices: [{ delta: { content: 'later' } }] }), 800]])).toMatchObject({ firstContentMs: null, contentTimingStatus: 'decode_error' });
    expect(project([[Buffer.from([0xff]), 200]])).toMatchObject({ firstContentMs: null, contentTimingStatus: 'decode_error' });
  });
  it('labels complete JSON with its own basis, never pretending to observe streamed tokens', () => {
    const json = JSON.stringify({ choices: [{ message: { content: 'whole response' } }] });
    expect(project([[json.slice(0, 20), 300], [json.slice(20), 1200]], 'openai_chat', { streaming: false })).toMatchObject({ firstContentMs: 1200, firstContentBasis: 'json_document_complete' });
    expect(project([[json, 1200]], 'openai_chat', { streaming: false, complete: false })).toMatchObject({ firstContentMs: null, contentTimingStatus: 'not_collected' });
  });
  it('keeps compressed/unknown/missing timing evidence explicit rather than using first-byte or zero', () => {
    for (const encoding of ['gzip', 'br', 'deflate', 'unknown']) expect(project([['encoded', 150]], 'openai_chat', { encoding })).toMatchObject({ firstContentMs: null, contentTimingStatus: 'unsupported_encoding' });
    expect(project([[': ping\n\n', 150]], 'unknown')).toMatchObject({ firstContentMs: null, contentTimingStatus: 'not_collected' });
    expect(project([[': ping\n\n', 150]])).toMatchObject({ firstContentMs: null, contentTimingStatus: 'no_content' });
    expect(project([[': ping\n\n', 150]], 'openai_chat', { complete: false })).toMatchObject({ firstContentMs: null, contentTimingStatus: 'not_collected' });
  });
  it('preserves an already observed first content but exposes missing arrivals when no content was observed', () => {
    expect(project([[frame({ choices: [{ delta: { content: 'kept' } }] }), 800]], 'openai_chat', { limited: true })).toMatchObject({ firstContentMs: 800, contentTimingStatus: 'observed' });
    expect(project([[': ping\n\n', 150]], 'openai_chat', { limited: true })).toMatchObject({ firstContentMs: null, contentTimingStatus: 'preview_limit' });
  });
  it('rounds monotonic evidence consistently while preserving genuine observed zero', () => {
    const bytes = Buffer.from(frame({ choices: [{ delta: { content: 'immediate' } }] }));
    expect(classifyContentTiming({ timing: { ...timing(), responseHeadersMs: 0, firstBodyByteMs: 0, completedMs: 0 }, bytes,
      timeline: { offsets: Uint32Array.of(bytes.length), elapsedMs: Float64Array.of(0.3), count: 1, limited: false },
      format: 'openai_chat', streaming: true, responseComplete: true })).toMatchObject({ firstContentMs: 0, contentTimingStatus: 'observed' });
  });
  it('does not invent timing from missing, out-of-order or future arrival evidence', () => {
    const bytes = Buffer.from(frame({ choices: [{ delta: { content: 'untrusted stamp' } }] }));
    for (const ms of [NaN, -1, 2001]) expect(classifyContentTiming({ timing: timing(), bytes,
      timeline: { offsets: Uint32Array.of(bytes.length), elapsedMs: Float64Array.of(ms), count: 1, limited: false },
      format: 'openai_chat', streaming: true, responseComplete: true })).toMatchObject({ firstContentMs: null, contentTimingStatus: 'decode_error' });
    expect(classifyContentTiming({ timing: timing(), bytes, format: 'openai_chat', streaming: true, responseComplete: true })).toMatchObject({ firstContentMs: null, contentTimingStatus: 'not_collected' });
  });
});
