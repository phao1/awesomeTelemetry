import { createHash } from 'node:crypto';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { ArchitectureContextSample, ArchitectureEvidence, ArchitectureHandoff, ArchitectureToolOutcome } from '../../src/core/architecture-diagnosis-types.js';

type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
export const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export function jsonObject(value: unknown): ObjectValue | null {
  if (typeof value !== 'string') return object(value);
  try { return object(JSON.parse(value) as unknown); } catch { return null; }
}
export interface EvidenceWriter {
  add(value: Omit<ArchitectureEvidence, 'id' | 'taskId'>): string | null;
}
export interface NativeBody {
  sessionKey: string; eventId: string; agentId: string; order: number;
  raw: string | null; input: string | null; output: string | null;
  rawComplete: boolean; inputComplete: boolean; outputComplete: boolean;
  status: string;
  initialInput?: boolean;
}
export interface NativeTarget { nativeId: string; agentId: string; sessionKey: string; parentId: string | null }
export interface ActualToolCall {
  id: string; name: string; agentId: string | null; sessionKey: string | null; order: number;
  arguments: ObjectValue | null; complete: boolean; refId: string;
  result: unknown; resultRefId: string | null; resultComplete: boolean;
  resultIsError: boolean | null;
}
export interface RecordedInput { agentId: string; order: number; text: string; complete: boolean; refId: string; initial: boolean }
export interface NativeFacts { contexts: ArchitectureContextSample[]; outcomes: ArchitectureToolOutcome[]; calls: ActualToolCall[]; inputs: RecordedInput[]; reasons: string[] }
function contentText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(block => contentText(object(block)?.text ?? object(block)?.content)).filter(v => v !== null).join('\n');
  return null;
}
function count(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export function explicitError(value: unknown): ArchitectureToolOutcome['errorClass'] {
  const record = jsonObject(value), error = object(record?.error), code = text(error?.code ?? record?.error_code)?.toLowerCase();
  if (!code) return record && (record.error !== null && record.error !== undefined || record.success === false || record.status === 'failed') ? 'other' : null;
  if (['unknown_tool', 'tool_not_found', 'unknown_function'].includes(code)) return 'unknown_tool';
  if (['invalid_arguments', 'invalid_tool_arguments', 'invalid_parameters'].includes(code)) return 'invalid_arguments';
  if (['permission_denied', 'forbidden', 'unauthorized'].includes(code)) return 'permission';
  return 'other';
}
/** Retained native shapes only. A tools/schema declaration never enters calls. */
export async function extractNativeFacts(rows: NativeBody[], evidence: EvidenceWriter, signal?: AbortSignal): Promise<NativeFacts> {
  const facts: NativeFacts = { contexts: [], outcomes: [], calls: [], inputs: [], reasons: [] };
  const usageIndices = new Map<string, number>();
  const results: Array<{ id: string; agentId: string; value: unknown; error: boolean | null; complete: boolean; refId: string; order: number }> = [];
  for (const [index, row] of rows.entries()) {
    signal?.throwIfAborted(); if (index % 8 === 0) await yieldImmediate();
    if (!row.rawComplete || !row.inputComplete || !row.outputComplete) facts.reasons.push('native_body_limit');
    const raw = row.rawComplete ? jsonObject(row.raw) : null;
    if (!raw) { facts.reasons.push('native_raw_unavailable'); continue; }
    const ref = (path: string, excerpt: string | null = null): string | null => evidence.add({ source: 'native_event', sessionKey: row.sessionKey, eventId: row.eventId, captureId: null, callSequence: null, path, excerpt: excerpt?.slice(0, 240) ?? null });
    const payload = object(raw.payload), message = object(raw.message);
    const item = payload ?? raw;
    const itemPath = payload ? 'payload' : '';
    const path = (key: string): string => itemPath ? itemPath + '.' + key : key;
    // Explicit per-call usage only. Generic event.tokens and cumulative usage are intentionally ignored.
    const last = item.type === 'token_count' ? object(object(item.info)?.last_token_usage) : null;
    const assistantUsage = raw.type === 'assistant' && message ? object(message.usage) : null;
    const messageId = assistantUsage ? text(message?.id) : null;
    if (assistantUsage && messageId === null) facts.reasons.push('native_call_identity_missing');
    const usage = last ?? assistantUsage;
    let inputTokens = count(usage?.input_tokens);
    if (inputTokens !== null && last === null) {
      const cacheRead = count(usage?.cache_read_input_tokens) ?? 0, cacheWrite = count(usage?.cache_creation_input_tokens) ?? 0;
      inputTokens += cacheRead + cacheWrite;
      if (!Number.isSafeInteger(inputTokens)) inputTokens = null;
    }
    if (inputTokens !== null && (last !== null || messageId !== null)) {
      const refId = ref(last ? path('info.last_token_usage.input_tokens') : 'message.usage', String(inputTokens));
      if (refId) {
        const key = messageId === null ? null : JSON.stringify([row.sessionKey, messageId]);
        const sample: ArchitectureContextSample = { id: key === null ? `native:${row.sessionKey}:${row.eventId}` : `native:message:${key}`, streamId: `native:${row.sessionKey}`, agentId: row.agentId, order: row.order, refId,
        contextTokens: inputTokens, tokenBasis: last ? 'last_call_usage' : 'request_usage', contextChars: null, contextComplete: false,
        parts: [], tools: [], toolCatalogComplete: false, toolChoice: { mode: 'unknown', name: null }, proposals: [] };
        const previous = key === null ? undefined : usageIndices.get(key);
        if (previous === undefined) { if (key !== null) usageIndices.set(key, facts.contexts.length); facts.contexts.push(sample); }
        else facts.contexts[previous] = sample;
      }
    }
    const parts: Array<{ value: ObjectValue; path: string }> = [{ value: item, path: itemPath }];
    if (message && Array.isArray(message.content)) for (const [i, value] of message.content.entries()) { const record = object(value); if (record) parts.push({ value: record, path: `message.content[${i}]` }); }
    for (const part of parts) {
      const value = part.value, type = value.type;
      const prefix = part.path ? part.path + '.' : '';
      const proposal = type === 'function_call' || type === 'custom_tool_call' || type === 'tool_use';
      const result = type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'tool_result';
      if (proposal) {
        const id = text(type === 'tool_use' ? value.id : value.call_id), name = text(value.name);
        if (id && name) {
          const refId = ref(prefix + (type === 'tool_use' ? 'input' : type === 'custom_tool_call' ? 'input' : 'arguments'), name);
          if (refId) facts.calls.push({ id, name, agentId: row.agentId, sessionKey: row.sessionKey, order: row.order,
            arguments: jsonObject(type === 'tool_use' || type === 'custom_tool_call' ? value.input : value.arguments), complete: row.rawComplete,
            refId, result: null, resultRefId: null, resultComplete: false, resultIsError: null });
        }
      } else if (result) {
        const id = text(type === 'tool_result' ? value.tool_use_id : value.call_id), output = type === 'tool_result' ? value.content : value.output;
        if (id) { const refId = ref(prefix + (type === 'tool_result' ? 'content' : 'output')); if (refId) results.push({ id, agentId: row.agentId, value: output,
          error: typeof value.is_error === 'boolean' ? value.is_error : explicitError(output) !== null || row.status === 'error' ? true : null, complete: row.rawComplete, refId, order: row.order }); }
      }
    }
    const hasToolResults = Array.isArray(message?.content) && message.content.some(value => object(value)?.type === 'tool_result');
    const isInput = !hasToolResults && (raw.type === 'user' || item.type === 'message' && item.role === 'user' || raw.type === 'event_msg' && item.type === 'user_message');
    if (isInput) {
      const input = contentText(message?.content ?? item.content ?? item.message);
      if (input !== null && input !== '') {
        const refId = ref(message ? 'message.content' : path(item.message === undefined ? 'content' : 'message'), input);
        if (refId) facts.inputs.push({ agentId: row.agentId, order: row.order, text: input, complete: row.rawComplete, refId, initial: row.initialInput === true });
      }
    }
  }
  for (const call of facts.calls) {
    const matched = results.filter(result => result.agentId === call.agentId && result.id === call.id);
    const proposals = facts.calls.filter(candidate => candidate.agentId === call.agentId && candidate.id === call.id);
    if (matched.length !== 1 || proposals.length !== 1 || matched[0]!.order < call.order) { if (matched.length > 1 || proposals.length > 1) facts.reasons.push('native_tool_identity_ambiguous'); continue; }
    const result = matched[0]!; call.result = result.value; call.resultRefId = result.refId; call.resultComplete = result.complete; call.resultIsError = result.error;
    const errorClass = explicitError(result.value);
    facts.outcomes.push({ id: `native:${call.sessionKey}:${call.id}`, agentId: call.agentId, order: result.order, name: call.name, callId: call.id,
      decisionKey: `native:${call.sessionKey}:${call.order}`, status: result.error === true ? 'error' : result.error === false ? 'ok' : 'unknown', errorClass,
      refId: result.refId, proposalRefId: call.refId });
  }
  return facts;
}

function requiredFacts(args: ObjectValue | null, refId: string): ArchitectureHandoff['requiredFacts'] {
  const result: ArchitectureHandoff['requiredFacts'] = [];
  for (const key of ['required_references', 'requirements']) {
    const value = args?.[key];
    if (Array.isArray(value)) for (const [index, item] of value.slice(0, 16).entries()) if (typeof item === 'string' && item.length <= 1024) result.push({ key: `${key}[${index}]`, value: item, refId });
  }
  return result;
}
/** Only an actual spawn result without recorded failure can authorize the child's initial input. */
export function linkNativeHandoffs(calls: ActualToolCall[], inputs: RecordedInput[], targets: NativeTarget[]): ArchitectureHandoff[] {
  const handoffs: ArchitectureHandoff[] = [];
  for (const call of calls) {
    if (call.agentId === null || handoffs.length >= 32) continue;
    const name = call.name.split('.').at(-1), spawn = name === 'spawn_agent';
    if (!spawn && !['send_message', 'send_input', 'send_message_to_agent'].includes(name ?? '')) continue;
    const args = call.arguments;
    const sentText = text(args?.message ?? args?.text ?? args?.prompt);
    if (sentText === null) continue;
    const result = jsonObject(call.result), target = spawn ? text(result?.agent_id) : text(args?.id ?? args?.agent_id ?? args?.recipient_agent_id ?? args?.target);
    const matches = target ? targets.filter(value => value.nativeId === target) : [];
    const recipient = matches.length === 1 ? matches[0]! : null;
    const initial = spawn && recipient && recipient.parentId === call.agentId && call.resultComplete && call.resultIsError !== true && explicitError(call.result) === null
      ? inputs.filter(input => input.agentId === recipient.agentId && input.initial && input.complete) : [];
    const received = initial.length === 1 ? initial[0]! : null;
    handoffs.push({ id: `handoff:${call.refId}`, senderAgentId: call.agentId, recipientAgentId: recipient?.agentId ?? null,
      sentRefId: call.refId, receivedRefId: received?.refId ?? null, linkage: matches.length > 1 ? 'ambiguous' : received ? 'explicit' : 'unresolved',
      sentText, receivedText: received?.text ?? null, sentComplete: call.complete && args !== null, receivedComplete: received?.complete ?? false,
      requiredFacts: requiredFacts(args, call.refId) });
  }
  return handoffs;
}
