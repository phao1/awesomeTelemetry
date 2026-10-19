import { setImmediate as yieldTurn } from 'node:timers/promises';

import type { CaptureTransportResult, ProxyProtocolAnalysis, ProxyProtocolItem, RequestContextFormat } from '../../src/core/trace-types.js';
import { normalizeRequestContext } from './context-normalizer.js';
import { SseDecoder } from './sse-accumulator.js';
import { unwrapQoderSseFrame } from './nested-sse.js';

type RecordValue = Record<string, unknown>;
export const CAPTURE_PARSER_VERSION = 3;
export const CAPTURE_METRIC_VERSION = 1;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function index(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function json(value: unknown): string { return value === undefined ? '' : JSON.stringify(value); }
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return array(value).map(block => string(record(block)?.text) ?? '').join('');
}

export interface ProtocolAnalysisInput {
  format: RequestContextFormat;
  requestBody: string;
  responseBody: string | null;
  streaming: boolean;
  transport?: CaptureTransportResult;
}

/** Offline projection only: never forwards traffic, runs tools or invents execution. */
export async function analyzeProtocol(input: ProtocolAnalysisInput): Promise<ProxyProtocolAnalysis> {
  const result: ProxyProtocolAnalysis = {
    parserVersion: CAPTURE_PARSER_VERSION, requestFormat: input.format, model: null, responseId: null,
    state: input.streaming ? 'incomplete' : 'unknown', stopReason: null, system: null,
    declarations: [], items: [], errors: [], unknownEvents: 0,
    usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting:
        input.format === 'anthropic_messages' ? 'anthropic_additive_input'
          : input.format === 'unknown' ? 'unknown' : 'openai_subsets', snapshots: [] },
    completeness: { complete: true, omittedCount: 0, reasons: [] },
  };
  if (input.transport?.websocket !== undefined) {
    result.requestFormat = 'unknown'; result.state = 'unknown'; result.usage.accounting = 'unknown';
    result.completeness = { complete: false, omittedCount: 1, reasons: ['websocket_connection_not_model_call'] };
    return result;
  }
  const items = new Map<string, ProxyProtocolItem>();
  const choiceFinished = new Map<number, boolean>();
  let observedNestedChat = false;
  let incompleteNestedEvidence = false;
  let remainingChars = 262_144;
  let records = 0;
  const omitted = (reason: string): void => {
    result.completeness.complete = false;
    result.completeness.omittedCount += 1;
    if (!result.completeness.reasons.includes(reason)) result.completeness.reasons.push(reason);
  };
  const clip = (value: string): string => {
    const length = Math.min(32_768, remainingChars);
    if (value.length > length) omitted(length < 32_768 ? 'content_limit' : 'value_limit');
    // Do not split a UTF-16 surrogate pair in a displayed projection.
    let end = Math.min(value.length, length);
    if (end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1]!) && end < value.length) end -= 1;
    const clipped = value.slice(0, end);
    remainingChars -= clipped.length;
    return clipped;
  };
  const reserveRecord = (): boolean => {
    if (records >= 1024) { omitted('record_limit'); return false; }
    records += 1;
    return true;
  };
  const item = (key: string, kind: ProxyProtocolItem['kind'], path: string,
    phase: ProxyProtocolItem['phase'] = 'response', itemIndex: number | null = null,
    choiceIndex: number | null = null): ProxyProtocolItem | null => {
    const existing = items.get(key);
    if (existing !== undefined) return existing;
    if (!reserveRecord()) return null;
    // Fixed grammar + bounded numeric indices, never user text. Structural
    // locators stay exact when the separate display-content budget is spent;
    // record and serialized-response caps still account for this metadata.
    const value: ProxyProtocolItem = { phase, kind, id: null, callId: null, name: null,
      index: itemIndex, choiceIndex, content: '', toolResultIsError: null, complete: false, sourcePath: path };
    items.set(key, value);
    return value;
  };
  const setContent = (target: ProxyProtocolItem | null, value: string, replace = false): void => {
    if (target === null) return;
    if (!replace && target.content.length >= 32_768 && value.length > 0) { omitted('value_limit'); return; }
    remainingChars += target.content.length;
    target.content = clip(replace ? value : target.content + value);
  };
  const setField = (target: ProxyProtocolItem, key: 'id' | 'callId' | 'name', value: string | null): void => {
    remainingChars += target[key]?.length ?? 0;
    target[key] = value === null ? null : clip(value);
  };
  const parse = (body: string): unknown => {
    try { return JSON.parse(body) as unknown; } catch { return null; }
  };
  const seenErrors = new WeakSet<object>();
  const error = (value: unknown, path: string): void => {
    const err = record(value);
    if (err === null || seenErrors.has(err)) return;
    seenErrors.add(err);
    result.state = 'failed';
    if (!reserveRecord()) return;
    const code = string(err.code) ?? string(err.type);
    result.errors.push({ code: code === null ? null : clip(code),
      message: clip(string(err.message) ?? json(err)), sourcePath: path });
  };
  const usage = (frame: RecordValue, eventIndex: number | null): void => {
    const native = record(frame.usage) ?? record(record(frame.message)?.usage) ?? record(record(frame.response)?.usage);
    if (native === null) return;
    const fields = result.usage;
    const assign = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens' | 'nativeTotalTokens', value: unknown): void => {
      const count = index(value);
      if (count !== null) fields[key] = count;
    };
    assign('inputTokens', native.prompt_tokens ?? native.input_tokens);
    assign('outputTokens', native.completion_tokens ?? native.output_tokens);
    assign('nativeTotalTokens', native.total_tokens);
    const inDetails = record(native.prompt_tokens_details) ?? record(native.input_tokens_details);
    const outDetails = record(native.completion_tokens_details) ?? record(native.output_tokens_details);
    assign('cacheReadTokens', native.cache_read_input_tokens ?? inDetails?.cached_tokens);
    assign('cacheWriteTokens', native.cache_creation_input_tokens ?? inDetails?.cache_write_tokens);
    assign('reasoningTokens', outDetails?.reasoning_tokens);
    if (fields.snapshots.length < 32) fields.snapshots.push({ eventIndex, value: clip(json(native)) });
    else omitted('usage_snapshot_limit');
  };
  const metadata = (frame: RecordValue, path: string): void => {
    for (const [key, source] of [['model', 'model'], ['responseId', 'id']] as const) {
      const value = string(frame[source]);
      if (value !== null) {
        remainingChars += result[key]?.length ?? 0;
        result[key] = clip(value);
      }
    }
    error(frame.error, path + '.error');
  };

  const request = Buffer.byteLength(input.requestBody) <= 2 * 1024 * 1024 ? record(parse(input.requestBody)) : null;
  if (request === null) omitted('request_unavailable_or_invalid');
  else {
    const normalized = normalizeRequestContext({ format: input.format, desensitizedBody: input.requestBody });
    if (normalized.ok) {
      result.model = normalized.normalized.model === null ? null : clip(normalized.normalized.model);
      result.system = clip(normalized.normalized.system.map(block => block.text).join('\n'));
      if (!normalized.normalized.completeness.complete) omitted('request_normalization_limit');
    } else omitted(normalized.reason);
    const declarations = Array.isArray(request.tools) ? request.tools : array(request.functions);
    declarations.forEach((value, i) => {
      const tool = record(value);
      if (tool === null || !reserveRecord()) return;
      const name = string(record(tool.function)?.name) ?? string(tool.name);
      result.declarations.push({ name: name === null ? null : clip(name),
        type: clip(string(tool.type) ?? 'function'), definition: clip(json(tool)),
        sourcePath: (Array.isArray(request.tools) ? 'tools' : 'functions') + '[' + i + ']' });
    });
    const history = input.format === 'openai_responses' ? array(request.input) : array(request.messages);
    history.forEach((value, i) => {
      const message = record(value);
      if (message === null) return;
      const path = (input.format === 'openai_responses' ? 'input' : 'messages') + '[' + i + ']';
      if (message.role === 'tool' || message.role === 'function' || message.type === 'function_call_output') {
        const target = item('request-result-' + i, 'tool_result', path, 'request', i);
        if (target !== null) {
          setField(target, 'callId', string(message.tool_call_id) ?? string(message.call_id));
          setField(target, 'name', string(message.name));
          target.complete = true;
          setContent(target, text(message.content) || string(message.output) || json(message.output), true);
        }
      }
      if (message.type === 'function_call') {
        const target = item('request-call-' + i, 'tool_call', path, 'request', i);
        if (target !== null) {
          setField(target, 'id', string(message.id)); setField(target, 'callId', string(message.call_id)); setField(target, 'name', string(message.name));
          target.complete = true; setContent(target, string(message.arguments) ?? json(message.arguments), true);
        }
      }
      array(message.tool_calls ?? (message.function_call ? [message.function_call] : [])).forEach((value, j) => {
        const call = record(value);
        if (call === null) return;
        const fn = record(call.function) ?? call;
        const target = item('request-call-' + i + '-' + j, 'tool_call', path + '.tool_calls[' + j + ']', 'request', j);
        if (target !== null) {
          setField(target, 'id', string(call.id)); setField(target, 'callId', string(call.id)); setField(target, 'name', string(fn.name));
          target.complete = true; setContent(target, string(fn.arguments) ?? json(fn.arguments), true);
        }
      });
      array(message.content).forEach((value, j) => {
        const block = record(value);
        if (block === null || (block.type !== 'tool_use' && block.type !== 'tool_result')) return;
        const target = item('request-block-' + i + '-' + j, block.type === 'tool_use' ? 'tool_call' : 'tool_result', path + '.content[' + j + ']', 'request', j);
        if (target !== null) {
          setField(target, 'id', string(block.id)); setField(target, 'callId', string(block.tool_use_id) ?? string(block.id)); setField(target, 'name', string(block.name));
          // This flag belongs to the Messages request block, not its content,
          // protocol completion or independently observed network outcome.
          target.toolResultIsError = input.format === 'anthropic_messages' && block.type === 'tool_result' && typeof block.is_error === 'boolean' ? block.is_error : null;
          target.complete = true; setContent(target, block.type === 'tool_use' ? json(block.input) : text(block.content) || json(block.content), true);
        }
      });
    });
  }

  const chat = (frame: RecordValue, path: string): boolean => {
    if (!Array.isArray(frame.choices)) return frame.usage !== undefined || frame.error !== undefined;
    frame.choices.forEach((value, position) => {
      const choice = record(value);
      if (choice === null) return;
      const ci = index(choice.index) ?? position;
      if (!choiceFinished.has(ci)) choiceFinished.set(ci, false);
      const message = record(choice.delta) ?? record(choice.message);
      const replace = choice.message !== undefined;
      if (message !== null) {
        for (const [kind, content] of [['text', text(message.content)], ['reasoning', string(message.reasoning_content) ?? string(message.reasoning) ?? '']] as const) {
          if (content !== '') setContent(item('chat-' + ci + '-' + kind, kind, path + '.choices[' + position + ']', 'response', null, ci), content, replace);
        }
        array(message.tool_calls ?? (message.function_call ? [message.function_call] : [])).forEach((value, position) => {
          const call = record(value);
          if (call === null) return;
          const ti = index(call.index) ?? position;
          const fn = record(call.function) ?? call;
          const target = item('chat-' + ci + '-tool-' + ti, 'tool_call', path + '.choices[' + ci + '].tool_calls[' + ti + ']', 'response', ti, ci);
          if (target !== null) {
            setField(target, 'id', string(call.id) ?? target.id); setField(target, 'callId', target.id);
            if (fn.name !== undefined) setField(target, 'name', replace ? string(fn.name) : (target.name ?? '') + (string(fn.name) ?? ''));
            setContent(target, string(fn.arguments) ?? '', replace);
          }
        });
      }
      const stop = string(choice.finish_reason);
      if (stop !== null) {
        result.stopReason = clip(stop);
        choiceFinished.set(ci, true);
        for (const value of items.values()) if (value.phase === 'response' && value.choiceIndex === ci) value.complete = true;
      }
    });
    if (choiceFinished.size > 0 && result.state !== 'failed') {
      result.state = [...choiceFinished.values()].every(Boolean) ? 'completed' : 'incomplete';
    }
    return true;
  };

  const responseItem = (value: unknown, oi: number, path: string, complete: boolean): boolean => {
    const output = record(value);
    if (output === null) return false;
    if (output.type === 'function_call' || output.type === 'function_call_output') {
      const target = item('response-' + oi + '-call', output.type === 'function_call' ? 'tool_call' : 'tool_result', path, 'response', oi);
      if (target !== null) {
        setField(target, 'id', string(output.id) ?? target.id); setField(target, 'callId', string(output.call_id) ?? target.callId); setField(target, 'name', string(output.name) ?? target.name);
        target.complete = complete; setContent(target, string(output.arguments ?? output.output) ?? json(output.arguments ?? output.output), true);
      }
      return true;
    }
    const isReasoning = output.type === 'reasoning';
    if (output.type !== 'message' && !isReasoning) return false;
    array(isReasoning ? output.summary : output.content).forEach((value, ci) => {
      const block = record(value);
      if (block === null) return;
      const content = string(block.text) ?? string(block.refusal);
      if (content === null) return;
      const target = item('response-' + oi + '-' + (isReasoning ? 'reasoning-' : 'text-') + ci, isReasoning ? 'reasoning' : 'text', path, 'response', oi);
      if (target !== null) { setField(target, 'id', string(output.id)); target.complete = complete; setContent(target, content, true); }
    });
    return true;
  };
  const responses = (frame: RecordValue, path: string): boolean => {
    const type = string(frame.type);
    const response = record(frame.response) ?? (type === null || type === 'response' ? frame : null);
    if (response !== null) {
      metadata(response, path + (response === frame ? '' : '.response'));
      array(response.output).forEach((value, oi) => {
        if (!responseItem(value, oi, path + '.output[' + oi + ']', response.status === 'completed')) result.unknownEvents += 1;
      });
      const status = string(response.status) ?? type?.slice('response.'.length);
      if (status === 'completed' || status === 'incomplete' || status === 'failed') {
        if (result.state !== 'failed' || status === 'failed') result.state = status;
        const reason = string(record(response.incomplete_details)?.reason);
        if (reason !== null) result.stopReason = clip(reason);
      }
    }
    const oi = index(frame.output_index) ?? 0;
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      return responseItem(frame.item, oi, path + '.item', type.endsWith('.done'));
    }
    if (type?.startsWith('response.function_call_arguments.')) {
      const target = item('response-' + oi + '-call', 'tool_call', path, 'response', oi);
      if (target !== null) {
        setField(target, 'id', string(frame.item_id) ?? target.id);
        setContent(target, string(frame.arguments ?? frame.delta) ?? '', type.endsWith('.done'));
        if (type.endsWith('.done')) target.complete = true;
      }
      return true;
    }
    const reasoning = type?.startsWith('response.reasoning_summary_text.') === true;
    if (reasoning || type?.startsWith('response.output_text.') || type?.startsWith('response.refusal.')) {
      const ci = index(reasoning ? frame.summary_index : frame.content_index) ?? 0;
      const target = item('response-' + oi + '-' + (reasoning ? 'reasoning-' : 'text-') + ci, reasoning ? 'reasoning' : 'text', path, 'response', oi);
      if (target !== null) {
        setField(target, 'id', string(frame.item_id) ?? target.id);
        setContent(target, string(frame.text ?? frame.refusal ?? frame.delta) ?? '', type?.endsWith('.done') === true);
        if (type?.endsWith('.done')) target.complete = true;
      }
      return true;
    }
    if (type === 'error') { error(frame, path); return true; }
    return response !== null || ['response.created', 'response.in_progress', 'response.queued', 'response.content_part.added', 'response.content_part.done', 'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done'].includes(type ?? '');
  };

  const anthropicBlock = (value: unknown, bi: number, path: string, complete: boolean): boolean => {
    const block = record(value);
    if (block === null) return false;
    const kind = block.type === 'text' ? 'text' : block.type === 'thinking' ? 'reasoning' : block.type === 'tool_use' ? 'tool_call' : block.type === 'tool_result' ? 'tool_result' : null;
    if (kind === null) return false;
    const target = item('anthropic-' + bi, kind, path, 'response', bi);
    if (target !== null) {
      setField(target, 'id', string(block.id)); setField(target, 'callId', string(block.tool_use_id) ?? string(block.id)); setField(target, 'name', string(block.name)); target.complete = complete;
      const content = kind === 'tool_call' ? (!complete && json(block.input) === '{}' ? '' : json(block.input)) : kind === 'reasoning' ? string(block.thinking) ?? '' : text(block.text ?? block.content);
      setContent(target, content, true);
    }
    return true;
  };
  const anthropic = (frame: RecordValue, path: string): boolean => {
    const type = string(frame.type);
    const message = record(frame.message) ?? (type === 'message' || (!input.streaming && frame.content !== undefined) ? frame : null);
    if (message !== null) {
      metadata(message, path + (message === frame ? '' : '.message'));
      array(message.content).forEach((value, bi) => {
        if (!anthropicBlock(value, bi, path + '.content[' + bi + ']', !input.streaming)) result.unknownEvents += 1;
      });
      const stop = string(message.stop_reason);
      if (stop !== null) result.stopReason = clip(stop);
      if (!input.streaming && result.stopReason !== null && result.state !== 'failed') result.state = 'completed';
      return true;
    }
    const bi = index(frame.index) ?? 0;
    if (type === 'content_block_start') return anthropicBlock(frame.content_block, bi, path, false);
    if (type === 'content_block_delta') {
      const delta = record(frame.delta);
      if (delta === null) return false;
      const kind = delta.type === 'text_delta' ? 'text' : delta.type === 'thinking_delta' ? 'reasoning' : delta.type === 'input_json_delta' ? 'tool_call' : null;
      if (kind === null) return delta.type === 'signature_delta';
      setContent(item('anthropic-' + bi, kind, path, 'response', bi), string(delta.text ?? delta.thinking ?? delta.partial_json) ?? '');
      return true;
    }
    if (type === 'content_block_stop') { const target = items.get('anthropic-' + bi); if (target !== undefined) target.complete = true; return true; }
    if (type === 'message_delta') { const stop = string(record(frame.delta)?.stop_reason); if (stop !== null) result.stopReason = clip(stop); return true; }
    if (type === 'message_stop') { if (result.state !== 'failed') result.state = 'completed'; return true; }
    if (type === 'error') { error(frame.error, path); return true; }
    return type === 'ping';
  };

  if (input.responseBody !== null && Buffer.byteLength(input.responseBody) > 2 * 1024 * 1024) omitted('response_source_too_large');
  else if (input.responseBody !== null) {
    const consumeFrame = (data: string | undefined, eventIndex: number | null): void => {
      if (data === '[DONE]') {
        if ((input.format === 'openai_chat' || observedNestedChat) && result.state !== 'failed') result.state = 'completed';
        return;
      }
      let frame = data === undefined ? null : record(parse(data));
      if (frame === null) { result.unknownEvents += 1; return; }
      let path = eventIndex === null ? 'response' : 'events[' + eventIndex + ']';
      let responseFormat = input.format;
      const nested = input.streaming ? unwrapQoderSseFrame(frame) : null;
      if (nested !== null) {
        path += nested.sourcePathSuffix;
        if (nested.kind === 'invalid' || (input.format !== 'unknown' && input.format !== 'openai_chat')) {
          const reason = nested.kind === 'invalid' ? nested.reason : 'qoder_protocol_conflict';
          const message = nested.kind === 'invalid' && nested.reason === 'qoder_status'
            ? 'Qoder gateway status: ' + nested.statusCode : 'Unparsed Qoder SSE evidence: ' + reason;
          omitted(reason);
          result.unknownEvents += 1;
          incompleteNestedEvidence = true;
          if (reason === 'qoder_status') error({ code: reason, message }, path);
          else if (reserveRecord()) result.errors.push({ code: reason, message: clip(message), sourcePath: clip(path) });
          return;
        }
        frame = nested.frame;
        responseFormat = 'openai_chat';
        observedNestedChat = true;
        result.usage.accounting = 'openai_subsets';
      }
      usage(frame, eventIndex);
      metadata(frame, path);
      const handled = responseFormat === 'openai_chat' ? chat(frame, path)
        : responseFormat === 'openai_responses' ? responses(frame, path)
          : responseFormat === 'anthropic_messages' ? anthropic(frame, path) : false;
      if (!handled) result.unknownEvents += 1;
    };
    if (input.streaming) {
      const decoder = new SseDecoder();
      let eventIndex = 0;
      // Decode and consume bounded batches; never allocate an entire SSE event array.
      for (let offset = 0; offset < input.responseBody.length; offset += 8192) {
        for (const event of decoder.push(input.responseBody.slice(offset, offset + 8192))) consumeFrame(event.data, eventIndex++);
        await yieldTurn();
      }
      for (const event of decoder.finish()) consumeFrame(event.data, eventIndex++);
      if (decoder.droppedEvents > 0) omitted('sse_event_limit');
      if (decoder.incompleteEvents > 0) omitted('sse_incomplete_frame');
      if (observedNestedChat && (decoder.droppedEvents > 0 || decoder.incompleteEvents > 0)) incompleteNestedEvidence = true;
    } else {
      consumeFrame(input.responseBody, null);
    }
  } else omitted('response_missing');

  if (incompleteNestedEvidence && result.state === 'completed') result.state = 'incomplete';

  if (input.transport !== undefined && input.transport.state !== 'completed') {
    const outcome = input.transport;
    result.errors.push({ code: outcome.error, message: 'Observed network outcome: ' + outcome.state, sourcePath: 'capture.transport' });
    if (outcome.state === 'http_error') result.state = 'failed';
    else { omitted('transport:' + outcome.state); if (result.state === 'completed') result.state = 'incomplete'; }
  }
  for (const target of items.values()) {
    if (target.phase === 'response' && result.state === 'completed') target.complete = true;
    if (target.phase === 'response' && incompleteNestedEvidence) target.complete = false;
    if (target.kind === 'tool_call' && target.complete && parse(target.content) === null) {
      target.complete = false;
      omitted('invalid_tool_arguments');
    }
    result.items.push(target);
  }
  const native = result.usage;
  native.totalTokens = native.nativeTotalTokens;
  if (native.totalTokens === null && native.inputTokens !== null && native.outputTokens !== null) {
    if (native.accounting === 'openai_subsets') native.totalTokens = native.inputTokens + native.outputTokens;
    else if (native.accounting === 'anthropic_additive_input' && native.cacheReadTokens !== null && native.cacheWriteTokens !== null) {
      native.totalTokens = native.inputTokens + native.outputTokens + native.cacheReadTokens + native.cacheWriteTokens;
    }
    if (native.totalTokens !== null && !Number.isSafeInteger(native.totalTokens)) native.totalTokens = null;
  }
  // Leave bounded room for original-source completeness reasons at the API layer.
  while (Buffer.byteLength(JSON.stringify(result)) > 1_000_000) {
    omitted('response_budget');
    const collection = [result.items, result.declarations, result.errors, result.usage.snapshots].sort((a, b) => b.length - a.length)[0]!;
    if (collection.length === 0) break;
    const count = Math.max(1, Math.ceil(collection.length / 4));
    collection.splice(-count);
    result.completeness.omittedCount += count;
  }
  return result;
}
