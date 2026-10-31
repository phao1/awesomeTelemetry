import type { CodexCallDetail, CodexCallPage, CodexCallSummary, ProxyNativeUsage, ProxyProtocolAnalysis } from '../../src/core/trace-types.js';
import { analyzeProtocol } from '../proxy/protocol-analysis.js';
import { normalizeRequestContext } from '../proxy/context-normalizer.js';
import { diffContexts } from '../proxy/context-diff.js';
import { CodexInspectionError, MAX_FRAME, readCodexArchive, type DirectedRecord } from './archive.js';
import { codexIdentity, identifier, object, type CodexSource } from './source.js';

type Usage = Omit<ProxyNativeUsage, 'snapshots'>;
function emptyUsage(): Usage { return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
  reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'openai_subsets' }; }
function updateUsage(target: Usage, value: unknown): void {
  const usage = object(value); if (usage === null) return;
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  for (const [key, value] of [
    ['inputTokens', usage.input_tokens], ['outputTokens', usage.output_tokens],
    ['cacheReadTokens', object(usage.input_tokens_details)?.cached_tokens],
    ['reasoningTokens', object(usage.output_tokens_details)?.reasoning_tokens],
    ['nativeTotalTokens', usage.total_tokens],
  ] as const) {
    const parsed = count(value); if (parsed !== null) target[key] = parsed;
  }
  const total = target.inputTokens !== null && target.outputTokens !== null ? target.inputTokens + target.outputTokens : null;
  target.totalTokens = total !== null && Number.isSafeInteger(total) ? total : null;
}
interface Call { summary: CodexCallSummary; reasons: Set<string>; request: string | null; events: string[]; eventBytes: number; indexBytes: number }
export const MAX_CODEX_CALLS = 4096;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
export interface CodexProjectionWindow { offset?: number; limit?: number; detailOnly?: boolean; diagnosis?: boolean }
export interface CodexDiagnosisCall { call: CodexCallSummary; analysis: ProxyProtocolAnalysis; requestBody: string | null; requestComplete: boolean }
export interface CodexDiagnosisBatch { requestId: string; fingerprint: string; calls: CodexDiagnosisCall[]; total: number; complete: boolean; reasons: string[] }
function semanticItem(value: unknown): unknown {
  const item = object(value); if (item === null) return value;
  if (item.type === 'custom_tool_call') return { ...item, type: 'function_call', arguments: item.input };
  if (item.type === 'custom_tool_call_output') return { ...item, type: 'function_call_output' };
  return value;
}
function semanticFrame(value: Record<string, unknown>): Record<string, unknown> {
  const response = object(value.response);
  return { ...value, ...(Array.isArray(value.input) ? { input: value.input.map(semanticItem) } : {}),
    ...(value.item === undefined ? {} : { item: semanticItem(value.item) }),
    ...(response === null ? {} : { response: { ...response, ...(Array.isArray(response.output) ? { output: response.output.map(semanticItem) } : {}) } }),
    ...(typeof value.type === 'string' && value.type.startsWith('response.custom_tool_call_input.')
      ? { type: value.type.replace('response.custom_tool_call_input.', 'response.function_call_arguments.'), ...(value.input === undefined ? {} : { arguments: value.input }) } : {}) };
}
function carriesContent(value: Record<string, unknown>): boolean {
  const type = value.type, delta = typeof value.delta === 'string' ? value.delta : '';
  if (delta !== '' && typeof type === 'string' && /^response\.(?:output_text|reasoning_summary_text|function_call_arguments|custom_tool_call_input)\.delta$/.test(type)) return true;
  const output = object(value.response)?.output;
  const items = [...(value.item === undefined ? [] : [value.item]), ...(Array.isArray(output) ? output : [])];
  return items.some(item => {
    const record = object(item); if (record === null) return false;
    if (record.type === 'function_call') return typeof record.arguments === 'string' && record.arguments !== '';
    if (record.type === 'custom_tool_call') return typeof record.input === 'string' && record.input !== '';
    const blocks = record.type === 'reasoning' ? record.summary : record.type === 'message' ? record.content : null;
    return Array.isArray(blocks) && blocks.some(block => { const content = object(block); return typeof content?.text === 'string' && content.text !== '' || typeof content?.refusal === 'string' && content.refusal !== ''; });
  });
}
export interface CodexProjection { page: Omit<CodexCallPage, 'fingerprint' | 'offset' | 'limit' | 'hasMore'>; detail: Omit<CodexCallDetail, 'fingerprint' | 'native'> | null; diagnosis?: Omit<CodexDiagnosisBatch, 'fingerprint'> }

/** Only explicit source fields and ordered lanes. No network calls or SQL. */
export async function projectCodex(source: CodexSource, selected?: number, records?: AsyncIterable<DirectedRecord>, window: CodexProjectionWindow = {}): Promise<CodexProjection> {
  const reasons = new Set<string>(), calls: Call[] = [], lanes = new Map<string, Call[]>(), active = new Map<string, Call>();
  const responses = new Map<string, Call[]>(); let unassigned = 0;
  const previousInputs = new Map<number, string>(); let previousBytes = 0, baseRequest: string | null = null;
  let indexBytes = 0, limited = false;
  const charge = (call: Call): void => {
    const bytes = Buffer.byteLength(JSON.stringify({ ...call.summary, reasons: [...call.reasons] }));
    indexBytes += bytes - call.indexBytes; call.indexBytes = bytes;
    if (indexBytes > MAX_INDEX_BYTES) limited = true;
  };
  const warn = (call: Call, reason: string): void => { call.reasons.add(reason); charge(call); };
  const boundedId = (value: unknown, call: Call): string | null => {
    const id = identifier(value); if (value !== undefined && value !== null && id === null) warn(call, 'invalid_identifier'); return id;
  };
  const tools = (call: Call, values: unknown, output: boolean): void => {
    if (!Array.isArray(values)) return;
    for (const item of values) {
      const value = object(item); if (value === null) continue;
      const proposal = value.type === 'function_call' || value.type === 'custom_tool_call';
      const result = value.type === 'function_call_output' || value.type === 'custom_tool_call_output';
      if (!proposal && !result) continue;
      const id = boundedId(value.call_id, call); if (id === null) continue;
      const list = output && proposal ? call.summary.proposedToolIds : !output && result ? call.summary.returnedToolIds : null;
      if (list !== null && !list.includes(id)) { if (list.length >= 64) warn(call, 'tool_identity_limit'); else list.push(id); }
    }
  };
  const bind = (call: Call, id: string): void => {
    call.summary.responseId = id;
    const owners = responses.get(id) ?? [];
    if (!owners.includes(call)) owners.push(call); responses.set(id, owners);
    if (owners.length > 1) for (const owner of owners) warn(owner, 'response_id_reused');
  };
  const laneOf = (value: Record<string, unknown>): string | null => {
    if (value.stream_id === undefined) return '';
    return typeof value.stream_id === 'string' && /^[A-Za-z0-9_.-]{1,256}$/.test(value.stream_id) ? value.stream_id : null;
  };
  for await (const frame of records ?? readCodexArchive(source, reasons)) {
    // Keep consuming the two cursors so a limit cannot hide a corrupt tail.
    if (limited) continue;
    if (frame.kind !== 'message') continue;
    if (frame.binary) { reasons.add('binary_message_unparsed'); unassigned += 1; continue; }
    let text: string, value: Record<string, unknown> | null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(frame.payload); value = object(JSON.parse(text) as unknown); }
    catch { reasons.add('message_unparsed'); unassigned += 1; continue; }
    if (value === null) { reasons.add('message_not_object'); unassigned += 1; continue; }
    const lane = laneOf(value), type = value.type;
    if (lane === null) { reasons.add('invalid_stream_id'); unassigned += 1; continue; }
    if (frame.direction === 'request') {
      if (type !== 'response.create') continue;
      if (calls.length >= MAX_CODEX_CALLS) { limited = true; continue; }
      const ms = Math.round(frame.elapsedMs), epoch = Date.parse(source.startedAt) + ms;
      if (!Number.isSafeInteger(ms) || !Number.isFinite(epoch) || Math.abs(epoch) > 8.64e15) throw new CodexInspectionError('CODEX_SOURCE_UNAVAILABLE');
      const identity = codexIdentity(source.headers, value);
      const diagnosisSelected = window.diagnosis === true && calls.length < 32;
      const call: Call = { reasons: new Set(), request: selected === calls.length || diagnosisSelected && Buffer.byteLength(text) <= 64 * 1024 ? text : null, events: [], eventBytes: 0, indexBytes: 0,
        summary: { sequence: calls.length, streamId: lane === '' ? null : lane, responseId: null,
          previousResponseId: identifier(value.previous_response_id), predecessorSequence: null, model: identifier(value.model),
          warmup: value.generate === false, nativeSessionId: identity.sessionId, nativeTurnId: identity.turnId,
          startedAt: new Date(epoch).toISOString(), startedMs: ms, firstContentMs: null, durationMs: null, state: 'pending',
          usage: emptyUsage(), proposedToolIds: [], returnedToolIds: [], reasons: [] } };
      if (identity.conflict) warn(call, 'native_session_conflict');
      if (diagnosisSelected && call.request === null) warn(call, 'diagnosis_request_limit');
      if (value.previous_response_id !== undefined && call.summary.previousResponseId === null) warn(call, 'invalid_previous_response_id');
      if (call.summary.previousResponseId !== null) {
        const parents = responses.get(call.summary.previousResponseId);
        if (parents?.length === 1) call.summary.predecessorSequence = parents[0]!.summary.sequence;
        else warn(call, parents === undefined ? 'previous_response_outside_capture' : 'previous_response_ambiguous');
      }
      if (selected !== undefined) {
        if (call.summary.sequence === selected && call.summary.predecessorSequence !== null) baseRequest = previousInputs.get(call.summary.predecessorSequence) ?? null;
        if (call.summary.sequence < selected) {
          const bytes = Buffer.byteLength(text);
          while (previousBytes + bytes > MAX_FRAME && previousInputs.size > 0) {
            const first = previousInputs.entries().next().value!;
            previousBytes -= Buffer.byteLength(first[1]); previousInputs.delete(first[0]);
          }
          if (bytes <= MAX_FRAME) { previousInputs.set(call.summary.sequence, text); previousBytes += bytes; }
        }
      }
      tools(call, value.input, false); calls.push(call); charge(call);
      const queue = lanes.get(lane) ?? []; queue.push(call); lanes.set(lane, queue);
      if (lanes.size > 33) limited = true;
      continue;
    }
    const response = object(value.response), id = identifier(value.response_id ?? response?.id);
    let call: Call | undefined;
    if (type === 'response.created') {
      const current = active.get(lane);
      if (current !== undefined && current.summary.responseId === id && id !== null) call = current;
      else {
        call = lanes.get(lane)?.shift();
        if (call !== undefined && current !== undefined) { warn(current, 'overlapping_lane'); warn(call, 'overlapping_lane'); }
        if (call !== undefined) { active.set(lane, call); if (id !== null) bind(call, id); else warn(call, 'response_id_missing'); }
      }
    } else if (id !== null) {
      const owners = responses.get(id);
      if (owners?.length === 1) call = owners[0];
      else if (owners === undefined && active.get(lane) === undefined) {
        call = lanes.get(lane)?.shift();
        if (call !== undefined) { warn(call, 'response_created_missing'); bind(call, id); active.set(lane, call); }
      }
    } else call = active.get(lane);
    if (call === undefined) { unassigned += 1; reasons.add('unassigned_response_event'); continue; }
    if ((call.summary.streamId ?? '') !== lane) { warn(call, 'response_lane_conflict'); unassigned += 1; continue; }
    if (call.summary.sequence === selected || window.diagnosis === true && call.summary.sequence < 32) {
      const bytes = Buffer.byteLength(text) + 8;
      const semantic = JSON.stringify(semanticFrame(value)), semanticBytes = Buffer.byteLength(semantic) + 8;
      const eventLimit = window.diagnosis ? 64 * 1024 : MAX_FRAME;
      if (call.eventBytes + Math.max(bytes, semanticBytes) <= eventLimit && call.events.length < 8192) { call.events.push('data: ' + semantic + '\n\n'); call.eventBytes += Math.max(bytes, semanticBytes); }
      else warn(call, 'selected_event_limit');
    }
    if (call.summary.firstContentMs === null && carriesContent(value)) {
      call.summary.firstContentMs = Math.max(0, Math.round(frame.elapsedMs) - call.summary.startedMs);
    }
    tools(call, response?.output, true); if (value.item !== undefined) tools(call, [value.item], true);
    updateUsage(call.summary.usage, response?.usage);
    const terminal = type === 'response.completed' ? 'completed' : type === 'response.failed' || type === 'error' ? 'failed'
      : type === 'response.incomplete' || type === 'response.cancelled' ? 'incomplete' : null;
    if (terminal !== null) {
      if (call.summary.state !== 'pending' && call.summary.state !== terminal) warn(call, 'conflicting_terminal');
      call.summary.state = terminal; call.summary.durationMs ??= Math.max(0, Math.round(frame.elapsedMs) - call.summary.startedMs);
      if (active.get(lane) === call) active.delete(lane);
    }
    charge(call);
  }
  if (limited) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
  // Reused parent IDs discovered later invalidate prior lineage conclusions.
  for (const call of calls) {
    const previous = call.summary.previousResponseId;
    if (previous !== null && (responses.get(previous)?.length ?? 0) > 1) { call.summary.predecessorSequence = null; warn(call, 'previous_response_ambiguous'); }
    if (call.reasons.has('response_id_reused') || call.reasons.has('overlapping_lane') || call.reasons.has('response_lane_conflict')) call.summary.usage = emptyUsage();
    if (call.summary.state === 'pending' && !source.active) { call.summary.state = 'incomplete'; warn(call, 'terminal_not_observed'); }
    call.summary.reasons = [...call.reasons];
    charge(call);
  }
  if (limited) throw new CodexInspectionError('CODEX_INSPECTION_LIMIT');
  let detail: CodexProjection['detail'] = null;
  const chosen = selected === undefined ? undefined : calls[selected];
  if (chosen !== undefined) {
    const semanticRequest = JSON.stringify(semanticFrame(object(JSON.parse(chosen.request ?? '{}') as unknown) ?? {}));
    const analysis = await analyzeProtocol({ format: 'openai_responses', requestBody: semanticRequest, responseBody: chosen.events.join(''), streaming: true });
    let contextDiff: CodexCallDetail['contextDiff'] = null;
    let contextDiffUnavailableReason: CodexCallDetail['contextDiffUnavailableReason'] = chosen.summary.predecessorSequence === null ? 'no_predecessor' : 'base_outside_projection';
    if (baseRequest !== null && chosen.summary.predecessorSequence !== null) {
      const base = normalizeRequestContext({ format: 'openai_responses', desensitizedBody: baseRequest });
      const target = normalizeRequestContext({ format: 'openai_responses', desensitizedBody: chosen.request ?? '' });
      if (base.ok && target.ok) {
        const diff = await diffContexts({ base: base.normalized, target: target.normalized,
          baseInputTokens: calls[chosen.summary.predecessorSequence]?.summary.usage.inputTokens ?? null, targetInputTokens: chosen.summary.usage.inputTokens });
        contextDiff = { baseSequence: chosen.summary.predecessorSequence, ...diff, indicators: diff.indicators.filter(value => value.code === 'source_incomplete') };
        contextDiffUnavailableReason = null;
      } else contextDiffUnavailableReason = 'normalization_failed';
    }
    const selectedReasons = [...new Set([...chosen.summary.reasons, ...reasons])];
    if (selectedReasons.length > 0) { analysis.completeness.complete = false; analysis.completeness.reasons.push(...selectedReasons); }
    if (chosen.summary.state === 'pending') analysis.state = 'incomplete';
    if (selectedReasons.some(reason => ['response_id_reused', 'overlapping_lane', 'response_lane_conflict'].includes(reason))) {
      analysis.state = 'unknown'; analysis.usage = { ...emptyUsage(), snapshots: analysis.usage.snapshots };
    }
    const preview = Buffer.from(chosen.request ?? '');
    detail = { requestId: source.requestId, active: source.active, call: chosen.summary, analysis, contextDiff, contextDiffUnavailableReason,
      requestPreview: new TextDecoder().decode(preview.subarray(0, 64 * 1024)), requestPreviewTruncated: preview.length > 64 * 1024,
      toolReferences: chosen.summary.returnedToolIds.map(callId => {
        const proposals = calls.filter(call => call.summary.sequence < chosen.summary.sequence && call.summary.proposedToolIds.includes(callId));
        return { callId, proposalSequence: proposals.length === 1 ? proposals[0]!.summary.sequence : null };
      }) };
  }
  const offset = window.offset ?? 0, limit = window.limit ?? 20;
  let diagnosis: CodexProjection['diagnosis'];
  if (window.diagnosis) {
    const projected: CodexDiagnosisCall[] = [];
    const diagnosisReasons = new Set<string>(); let projectedBytes = 0;
    for (const call of calls.slice(0, 32)) {
      const semanticRequest = call.request === null ? null : JSON.stringify(semanticFrame(object(JSON.parse(call.request) as unknown) ?? {}));
      const requestBody = semanticRequest !== null && Buffer.byteLength(semanticRequest) <= 64 * 1024 ? semanticRequest : null;
      const analysis = await analyzeProtocol({ format: 'openai_responses', requestBody: requestBody ?? '{}', responseBody: call.events.join(''), streaming: true });
      analysis.usage = { ...call.summary.usage, snapshots: [] };
      const callReasons = [...new Set([...reasons, ...call.summary.reasons, ...(requestBody === null ? ['diagnosis_request_limit'] : [])])];
      if (callReasons.length) { analysis.completeness.complete = false; analysis.completeness.reasons.push(...callReasons); }
      if (callReasons.some(reason => ['response_id_reused', 'overlapping_lane', 'response_lane_conflict'].includes(reason))) {
        analysis.state = 'unknown'; analysis.usage = { ...emptyUsage(), snapshots: [] };
      }
      const value = { call: { ...call.summary, reasons: callReasons }, analysis, requestBody, requestComplete: requestBody !== null && callReasons.length === 0 };
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (projectedBytes + bytes > 3 * 1024 * 1024) { diagnosisReasons.add('diagnosis_output_limit'); break; }
      projected.push(value); projectedBytes += bytes;
    }
    diagnosis = { requestId: source.requestId, calls: projected, total: calls.length,
      complete: !source.active && reasons.size === 0 && calls.length <= 32 && projected.length === calls.length && projected.every(call => call.requestComplete && call.call.state === 'completed'),
      reasons: [...reasons, ...diagnosisReasons, ...(calls.length > 32 ? ['diagnosis_call_limit'] : []), ...(source.active ? ['active_source'] : [])] };
  }
  return { page: { requestId: source.requestId, active: source.active, items: window.detailOnly ? [] : calls.slice(offset, offset + limit).map(call => call.summary), total: calls.length,
    complete: !source.active && reasons.size === 0 && calls.every(call => call.reasons.size === 0 && call.summary.state !== 'incomplete'),
    reasons: [...reasons], unassignedEvents: unassigned }, detail, ...(diagnosis ? { diagnosis } : {}) };
}
