import type { CaptureNetworkTiming, RequestContextFormat } from '../../src/core/trace-types.js';
import { contentEncoding } from './body-decoder.js';
import { SseDecoder } from './sse-accumulator.js';

export const ARRIVAL_POINT_LIMIT = 4096;
export const ARRIVAL_BYTES = ARRIVAL_POINT_LIMIT * (Uint32Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT);

/** Internal worker input only; offsets refer to encoded response preview bytes. */
export interface ResponseArrivalTimeline {
  offsets: Uint32Array;
  elapsedMs: Float64Array;
  count: number;
  limited: boolean;
}
type Kind = NonNullable<CaptureNetworkTiming['firstContentKind']>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nonempty = (value: unknown): boolean => typeof value === 'string' && value.length > 0;
const text = (value: unknown): boolean => nonempty(value) || array(value).some(value => {
  const block = record(value); return block !== null && (nonempty(block.text) || nonempty(block.refusal));
});

function contentKind(value: unknown, format: RequestContextFormat): Kind | null {
  const frame = record(value);
  if (frame === null) return null;
  if (format === 'openai_chat') {
    for (const value of array(frame.choices)) {
      const choice = record(value), message = record(choice?.delta) ?? record(choice?.message);
      if (message === null) continue;
      if (text(message.content) || nonempty(message.refusal)) return 'text';
      if (nonempty(message.reasoning_content) || nonempty(message.reasoning)) return 'reasoning';
      if (array(message.tool_calls ?? (message.function_call ? [message.function_call] : [])).some(value => {
        const call = record(value), fn = record(call?.function) ?? call;
        return nonempty(fn?.arguments);
      })) return 'tool_arguments';
    }
  } else if (format === 'openai_responses') {
    const type = typeof frame.type === 'string' ? frame.type : '';
    if ((type.startsWith('response.output_text.') || type.startsWith('response.refusal.')) &&
      (nonempty(frame.delta) || nonempty(frame.text) || nonempty(frame.refusal))) return 'text';
    if ((type.startsWith('response.reasoning_summary_text.') || type.startsWith('response.reasoning_text.')) &&
      (nonempty(frame.delta) || nonempty(frame.text))) return 'reasoning';
    if (type.startsWith('response.function_call_arguments.') && (nonempty(frame.delta) || nonempty(frame.arguments))) return 'tool_arguments';
    const response = record(frame.response) ?? frame;
    for (const value of [...array(response.output), ...(frame.item === undefined ? [] : [frame.item])]) {
      const item = record(value);
      if (item?.type === 'function_call' && nonempty(item.arguments)) return 'tool_arguments';
      if (item?.type === 'reasoning' && array(item.summary).some(value => nonempty(record(value)?.text))) return 'reasoning';
      if (item?.type === 'message' && text(item.content)) return 'text';
    }
  } else if (format === 'anthropic_messages') {
    const delta = record(frame.delta);
    if (delta?.type === 'text_delta' && nonempty(delta.text)) return 'text';
    if (delta?.type === 'thinking_delta' && nonempty(delta.thinking)) return 'reasoning';
    if (delta?.type === 'input_json_delta' && nonempty(delta.partial_json)) return 'tool_arguments';
    const message = record(frame.message) ?? frame;
    for (const value of [...array(message.content), ...(frame.content_block === undefined ? [] : [frame.content_block])]) {
      const block = record(value);
      if (block?.type === 'text' && nonempty(block.text)) return 'text';
      if (block?.type === 'thinking' && nonempty(block.thinking)) return 'reasoning';
      // An empty tool-use declaration is not a generated argument fragment.
      const input = record(block?.input);
      if (block?.type === 'tool_use' && input !== null && Object.keys(input).length > 0) return 'tool_arguments';
    }
  }
  return null;
}

export function classifyContentTiming(input: {
  timing: CaptureNetworkTiming; bytes: Uint8Array; timeline?: ResponseArrivalTimeline;
  format: RequestContextFormat; streaming: boolean; responseComplete: boolean; encoding?: string;
}): CaptureNetworkTiming {
  const base = { ...input.timing, firstContentMs: null, firstContentKind: null, firstContentBasis: null };
  const unavailable = (contentTimingStatus: CaptureNetworkTiming['contentTimingStatus']): CaptureNetworkTiming => ({ ...base, contentTimingStatus });
  const observed = (ms: number, kind: Kind): CaptureNetworkTiming => ({ ...base, firstContentMs: Math.round(ms), firstContentKind: kind,
    firstContentBasis: input.streaming ? 'sse_event_dispatch' : 'json_document_complete', contentTimingStatus: 'observed' });
  if (contentEncoding(input.encoding) !== 'identity') return unavailable('unsupported_encoding');
  if (input.format === 'unknown') return unavailable('not_collected');
  const timeline = input.timeline;
  if (input.bytes.length === 0) return unavailable(input.responseComplete ? 'no_content' : 'not_collected');
  if (timeline === undefined) return unavailable('not_collected');
  if (!Number.isSafeInteger(timeline.count) || timeline.count < 0 || timeline.count > ARRIVAL_POINT_LIMIT ||
    timeline.count > timeline.offsets.length || timeline.count > timeline.elapsedMs.length) return unavailable('decode_error');
  let previousOffset = 0, previousMs = 0;
  for (let i = 0; i < timeline.count; i += 1) {
    const offset = timeline.offsets[i]!, ms = timeline.elapsedMs[i]!;
    if (offset <= previousOffset || offset > input.bytes.length || !Number.isFinite(ms) || ms < previousMs ||
      input.timing.completedMs !== null && Math.round(ms) > input.timing.completedMs) return unavailable('decode_error');
    previousOffset = offset; previousMs = ms;
  }
  const limited = timeline.limited || previousOffset < input.bytes.length;
  if (!input.streaming) {
    if (limited) return unavailable('preview_limit');
    if (!input.responseComplete) return unavailable('not_collected');
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes)) as unknown;
      const kind = contentKind(value, input.format);
      return kind === null ? unavailable('no_content') : observed(previousMs, kind);
    } catch { return unavailable('decode_error'); }
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const sse = new SseDecoder();
  let start = 0, events = 0;
  try {
    for (let i = 0; i < timeline.count; i += 1) {
      const end = timeline.offsets[i]!;
      for (let offset = start; offset < end; offset += 8192) {
        const text = decoder.decode(input.bytes.subarray(offset, Math.min(end, offset + 8192)), { stream: true });
        for (const event of sse.push(text)) {
          events += 1;
          if (events > 8192) return unavailable('preview_limit');
          if (event.data === undefined || event.data.trim() === '' || event.data === '[DONE]') continue;
          const kind = contentKind(JSON.parse(event.data) as unknown, input.format);
          if (kind !== null) return observed(timeline.elapsedMs[i]!, kind);
        }
      }
      start = end;
    }
    if (limited) return unavailable('preview_limit');
    decoder.decode(); sse.finish();
    if (sse.incompleteEvents > 0 || sse.droppedEvents > 0) return unavailable('decode_error');
    return unavailable(input.responseComplete ? 'no_content' : 'not_collected');
  } catch { return unavailable('decode_error'); }
}

/** Stored/recovered timing is bounded independently of legacy network outcome. */
export function validNetworkTiming(value: CaptureNetworkTiming): boolean {
  if (value === null || typeof value !== 'object' || value.version !== 1 || value.clock !== 'proxy_monotonic') return false;
  for (const field of ['responseHeadersMs', 'firstBodyByteMs', 'firstContentMs', 'completedMs'] as const) {
    const ms = value[field];
    if (ms !== null && (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0)) return false;
  }
  if (!['observed', 'no_content', 'not_collected', 'unsupported_encoding', 'preview_limit', 'decode_error'].includes(value.contentTimingStatus) ||
    !(value.serverTiming === null || typeof value.serverTiming === 'string' && value.serverTiming.length <= 512) || typeof value.serverTimingTruncated !== 'boolean') return false;
  if (value.firstContentMs === null) return value.firstContentKind === null && value.firstContentBasis === null && value.contentTimingStatus !== 'observed';
  return value.contentTimingStatus === 'observed' && value.firstBodyByteMs !== null &&
    ['text', 'reasoning', 'tool_arguments'].includes(value.firstContentKind ?? '') &&
    ['sse_event_dispatch', 'json_document_complete'].includes(value.firstContentBasis ?? '') &&
    value.firstContentMs >= value.firstBodyByteMs && (value.completedMs === null || value.firstContentMs <= value.completedMs);
}
