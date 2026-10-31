import type { ArchitectureContextSample, ArchitectureToolDefinition, ArchitectureToolProposal, ArchitectureToolOutcome } from '../../src/core/architecture-diagnosis-types.js';
import type { ProxyProtocolAnalysis } from '../../src/core/trace-types.js';
import { canonicalSha256, normalizeRequestContext } from '../proxy/context-normalizer.js';
import { explicitError, hash, jsonObject, object, text, type ActualToolCall, type EvidenceWriter } from './native.js';

export interface CaptureSource {
  id: number; callSequence: number | null; streamId: string; agentId: string | null; sessionKey: string | null; order: number;
  analysis: ProxyProtocolAnalysis; requestBody: string | null; requestComplete: boolean;
}
export interface CaptureResult { scope: string; id: string; value: string; refId: string; complete: boolean; order: number; error: boolean | null }
export interface CaptureFacts { context: ArchitectureContextSample | null; calls: ActualToolCall[]; results: CaptureResult[]; reasons: string[] }
function toolChoice(value: unknown): ArchitectureContextSample['toolChoice'] {
  if (value === undefined || value === 'auto') return { mode: 'auto', name: null };
  if (value === 'none' || value === 'required') return { mode: value, name: null };
  const unknown = { mode: 'unknown', name: null } as const, obj = object(value);
  if (!obj || typeof obj.type !== 'string'
    || (obj.disable_parallel_tool_use !== undefined && typeof obj.disable_parallel_tool_use !== 'boolean')) return unknown;
  const allowed = (keys: string[]) => Object.keys(obj).every(key => keys.includes(key));
  if (['auto', 'none', 'any'].includes(obj.type)) {
    if (!allowed(['type', 'disable_parallel_tool_use'])) return unknown;
    return { mode: obj.type === 'any' ? 'required' : obj.type as 'auto' | 'none', name: null };
  }
  if (obj.type === 'function' && obj.function !== undefined) {
    const fn = object(obj.function), name = text(fn?.name);
    return allowed(['type', 'function']) && fn && Object.keys(fn).length === 1 && name
      ? { mode: 'named', name } : unknown;
  }
  if (['function', 'custom', 'tool'].includes(obj.type) && allowed(['type', 'name', 'disable_parallel_tool_use'])) {
    const name = text(obj.name); if (name) return { mode: 'named', name };
  }
  return unknown;
}
/** Converts verified original-backed facts; never reads a body or invents membership. */
export function extractCaptureFacts(source: CaptureSource, evidence: EvidenceWriter): CaptureFacts {
  const result: CaptureFacts = { context: null, calls: [], results: [], reasons: [] };
  const add = (path: string, excerpt: string | null = null): string | null => evidence.add({ source: source.callSequence === null ? 'http_capture' : 'codex_call',
    sessionKey: source.sessionKey, eventId: null, captureId: source.id, callSequence: source.callSequence, path, excerpt: excerpt?.slice(0, 240) ?? null });
  const usage = source.analysis.usage;
  const measuredInput = usage.inputTokens === null ? null : usage.accounting === 'anthropic_additive_input'
    ? usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) : usage.inputTokens;
  const inputTokens = measuredInput !== null && Number.isSafeInteger(measuredInput) ? measuredInput : null;
  const refId = inputTokens === null ? add('request', source.analysis.model) : add(source.callSequence === null ? 'analysis.usage' : 'call.usage',
    `inputTokens=${usage.inputTokens}; cacheReadTokens=${usage.cacheReadTokens}; cacheWriteTokens=${usage.cacheWriteTokens}; accounting=${usage.accounting}; contextInputTokens=${inputTokens}`);
  if (!refId) { result.reasons.push('evidence_limit'); return result; }
  const request = jsonObject(source.requestBody), normalized = normalizeRequestContext({ format: source.analysis.requestFormat, desensitizedBody: source.requestBody ?? '' });
  const complete = source.requestComplete && normalized.ok && normalized.normalized.completeness.complete;
  const parts: ArchitectureContextSample['parts'] = [], tools: ArchitectureToolDefinition[] = [];
  const part = (kind: 'system' | 'message' | 'tool', path: string, value: string, digest = hash(value)): void => {
    if (parts.length >= 128) { result.reasons.push('context_part_limit'); return; }
    const partRef = add(path); if (partRef) parts.push({ kind, hash: digest, chars: value.length, refId: partRef });
  };
  if (normalized.ok) {
    for (const value of normalized.normalized.system) part('system', value.sourcePath, value.text);
    for (const value of normalized.normalized.messages) part('message', value.sourcePath, typeof value.content === 'string' ? value.content : JSON.stringify(value.content), value.contentSha256);
  } else result.reasons.push('context_normalization_unavailable');
  let catalogComplete = complete;
  const declarations = Array.isArray(request?.tools) ? request.tools : Array.isArray(request?.functions) ? request.functions : [];
  const declaredFunctionList = !Array.isArray(request?.tools) && Array.isArray(request?.functions);
  const append = (value: unknown, path: string, namespace = '', depth = 0): void => {
    if (depth > 1) { catalogComplete = false; result.reasons.push('tool_namespace_depth'); return; }
    if (tools.length >= 256) { catalogComplete = false; result.reasons.push('tool_definition_limit'); return; }
    const item = object(value); if (!item) { catalogComplete = false; return; }
    if (item.type === 'namespace') {
      if (!text(item.name) || !Array.isArray(item.tools)) { catalogComplete = false; return; }
      for (const [i, tool] of item.tools.slice(0, 256).entries()) append(tool, `${path}.tools[${i}]`, namespace + (item.name as string) + '.', depth + 1);
      if (item.tools.length > 256) { catalogComplete = false; result.reasons.push('tool_definition_limit'); }
      return;
    }
    const fn = object(item.function) ?? item, name = text(fn.name);
    const supported = declaredFunctionList || item.type === 'function' || item.type === 'custom' || item.input_schema !== undefined;
    if (!name || !supported) { catalogComplete = false; return; }
    const schema = object(fn.parameters ?? fn.input_schema);
    const definition = { type: text(item.type) ?? 'function', schema, format: item.format ?? null };
    const required = Array.isArray(schema?.required) ? schema.required.filter((key): key is string => typeof key === 'string').slice(0, 64) : [];
    const toolRef = add(path, namespace + name);
    if (toolRef) tools.push({ name: namespace + name, signature: canonicalSha256(definition as Parameters<typeof canonicalSha256>[0]), requiredArguments: required, refId: toolRef });
    part('tool', path, JSON.stringify(value));
  };
  for (const [i, value] of declarations.slice(0, 256).entries()) append(value, `${declaredFunctionList ? 'functions' : 'tools'}[${i}]`);
  if (declarations.length > 256) { catalogComplete = false; result.reasons.push('tool_definition_limit'); }
  const proposals: ArchitectureToolProposal[] = [];
  for (const item of source.analysis.items) {
    if (item.kind === 'tool_call' && item.phase === 'response' && item.callId && item.name) {
      if (proposals.length >= 128) { result.reasons.push('tool_proposal_limit'); continue; }
      const proposalRef = add(item.sourcePath, item.name); if (!proposalRef) continue;
      const args = jsonObject(item.content), parsedComplete = item.complete && source.analysis.completeness.complete && args !== null;
      proposals.push({ id: item.callId, name: item.name, argumentKeys: args ? Object.keys(args).slice(0, 128) : null, argumentsComplete: parsedComplete, refId: proposalRef });
      result.calls.push({ id: item.callId, name: item.name, agentId: source.agentId, sessionKey: source.sessionKey, order: source.order,
        arguments: args, complete: item.complete, refId: proposalRef, result: null, resultRefId: null, resultComplete: false, resultIsError: null });
    } else if (item.kind === 'tool_result' && item.phase === 'request' && item.callId) {
      const resultRef = add(item.sourcePath); if (resultRef) result.results.push({ scope: source.streamId, id: item.callId, value: item.content, refId: resultRef,
        complete: source.requestComplete && item.complete, order: source.order, error: item.toolResultIsError });
    }
  }
  result.context = { id: `${source.callSequence === null ? 'http' : 'codex'}:${source.id}:${source.callSequence ?? 0}`, streamId: source.streamId,
    agentId: source.agentId, order: source.order, refId, contextTokens: inputTokens,
    tokenBasis: inputTokens === null ? 'unavailable' : 'request_usage', contextChars: normalized.ok ? normalized.normalized.stats.totalChars : null,
    contextComplete: complete && !text(request?.previous_response_id), parts, tools, toolCatalogComplete: catalogComplete,
    toolChoice: toolChoice(request?.tool_choice), proposals };
  if (!complete) result.reasons.push('capture_context_incomplete');
  if (text(request?.previous_response_id)) result.reasons.push('incremental_request_context');
  return result;
}
export function pairCaptureResults(calls: Array<{ scope: string; call: ActualToolCall }>, results: CaptureResult[]): ArchitectureToolOutcome[] {
  const outcomes: ArchitectureToolOutcome[] = [];
  for (const { scope, call } of calls) {
    const matched = results.filter(value => value.scope === scope && value.id === call.id && value.order >= call.order);
    if (matched.length !== 1 || calls.filter(value => value.scope === scope && value.call.id === call.id).length !== 1) continue;
    const result = matched[0]!; call.result = result.value; call.resultComplete = result.complete; call.resultRefId = result.refId; call.resultIsError = result.error;
    const errorClass = explicitError(result.value);
    outcomes.push({ id: `capture:${scope}:${call.id}`, agentId: call.agentId, order: result.order, name: call.name, callId: call.id,
      decisionKey: `${scope}:${call.order}`, status: result.error === true || errorClass ? 'error' : result.error === false ? 'ok' : 'unknown', errorClass,
      refId: result.refId, proposalRefId: call.refId });
  }
  return outcomes;
}
