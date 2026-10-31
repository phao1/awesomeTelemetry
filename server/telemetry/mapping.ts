import { TRACE_KINDS, TRACE_STATUSES } from '../../src/core/trace-types.js';
import type { ErrorCode } from '../http/error-envelope.js';
import type { TelemetrySource, TelemetrySpan } from '../../src/core/telemetry-types.js';
import type { TraceKind } from '../../src/core/trace-types.js';
import { resolveRules } from '../desensitization/rules.js';

export class TelemetryError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode, message: string) { super(message); this.status = status; this.code = code; }
}
export const invalid = (message = 'Unrecognized format: expected OTLP resourceSpans, Langfuse observations or LangSmith runs'): never => { throw new TelemetryError(400, 'TELEMETRY_INVALID', message); };
export const limit = (): never => { throw new TelemetryError(413, 'TELEMETRY_LIMIT', 'Telemetry quota exceeded (8 MiB / 1000 spans / bounded attributes and retained tasks)'); };
export const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const str = (v: unknown): string | null => typeof v === 'string' && v.length ? v : null;
export const num = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function utc(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const day=new Date(v.slice(0,10)+'T00:00:00.000Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==v.slice(0,10))return null;
  const n = Date.parse(v); return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
/** LangSmith stores naive ISO run times as UTC; other formats retain strict UTC parsing. */
function langSmithUtc(value: unknown): string | null {
  const naive = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?$/.test(value);
  return utc(naive ? value + 'Z' : value);
}
export function nano(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{1,20}$/.test(v)) return null;
  const n = BigInt(v); if (n === 0n || n > (1n << 64n) - 1n) return null;
  const date=new Date(Number(n / 1000000n)).toISOString();
  return n%1000000n===0n?date:date.slice(0,19)+'.'+(n%1000000000n).toString().padStart(9,'0')+'Z';
}
/** Redaction always finishes; unlike the forwarding helper it never falls back to plaintext. */
export function preview(v: unknown, max = 2048): string | null {
  if (v === undefined || v === null) return null;
  let text = typeof v === 'string' ? v : JSON.stringify(v);
  for (const rule of resolveRules({})) if (rule.enabled) { rule.pattern.lastIndex = 0; text = text.replace(rule.pattern, rule.replacement); }
  return Array.from(text).slice(0,max).join('');
}
function bounded(v: unknown, depth = 0): void {
  if (depth > 32) limit();
  if (typeof v === 'string' && v.length > 65536) limit();
  if (Array.isArray(v)) { if (v.length > 1000) limit(); for (const x of v) bounded(x, depth + 1); }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k.length > 256) limit(); bounded(x, depth + 1); }
}
function anyValue(v: unknown): unknown {
  const a = obj(v);
  if ('stringValue' in a) return a.stringValue;
  if ('intValue' in a) return num(a.intValue);
  if ('doubleValue' in a) return a.doubleValue;
  if ('boolValue' in a) return a.boolValue;
  if ('arrayValue' in a) return (Array.isArray(obj(a.arrayValue).values) ? obj(a.arrayValue).values as unknown[] : []).map(anyValue);
  if ('kvlistValue' in a) return attributes(obj(a.kvlistValue).values);
  return null;
}
export function attributes(v: unknown): Record<string, unknown> {
  const list = Array.isArray(v) ? v : []; if (list.length > 128) limit();
  return Object.fromEntries(list.map(x => { const a = obj(x); if (typeof a.key !== 'string' || a.key.length > 256) invalid('Invalid attribute key'); return [a.key, anyValue(a.value)]; }));
}
const kinds: Record<string, TraceKind> = { chat: 'llm', text_completion: 'llm', generate_content: 'llm', embeddings: 'llm', execute_tool: 'tool', invoke_agent: 'agent', create_agent: 'agent', LLM: 'llm', TOOL: 'tool', AGENT: 'agent', CHAIN: 'system', RETRIEVER: 'system', EMBEDDING: 'llm', RERANKER: 'system', GUARDRAIL: 'system' };
/** Pure GenAI/OpenInference mapping; no inferred token inclusion or completion status. */
export function mapOtlpSpan(value: unknown, resource: Record<string, unknown> = {}): TelemetrySpan {
  bounded(value); const s = obj(value), a = { ...resource, ...attributes(s.attributes) };
  const id = (v: unknown, length: number): string => { if (typeof v !== 'string' || v.length !== length || !/^[a-f\d]+$/i.test(v) || /^0+$/.test(v)) invalid('OTLP requires nonzero hex traceId (32) and spanId (16)'); return (v as string).toLowerCase(); };
  const traceId = id(s.traceId, 32), spanId = id(s.spanId, 16);
  const start = nano(s.startTimeUnixNano), end = nano(s.endTimeUnixNano);
  const operation = str(a['gen_ai.operation.name']) ?? str(a['openinference.span.kind']);
  const events = Array.isArray(s.events) ? s.events : []; if (events.length > 128) limit();
  const eventAttrs = events.map(e => ({ name: str(obj(e).name), a: attributes(obj(e).attributes) }));
  const exception = eventAttrs.find(e => e.name === 'exception');
  const eventInput=eventAttrs.find(e=>e.a['gen_ai.input.messages']!==undefined)?.a['gen_ai.input.messages'];
  const eventOutput=eventAttrs.find(e=>e.a['gen_ai.output.messages']!==undefined)?.a['gen_ai.output.messages'];
  const inputEvents = eventAttrs.filter(e => ['gen_ai.user.message', 'gen_ai.system.message', 'gen_ai.input.messages'].includes(e.name ?? ''));
  const outputEvents = eventAttrs.filter(e => ['gen_ai.assistant.message', 'gen_ai.choice', 'gen_ai.output.messages'].includes(e.name ?? ''));
  const error = preview(exception?.a['exception.message'] ?? exception?.a['exception.type'] ?? obj(s.status).message, 500);
  const duration = a['awesome_telemetry.event.time_basis'] === 'scan_observation_point' ? null : start && end && BigInt(String(s.endTimeUnixNano)) >= BigInt(String(s.startTimeUnixNano)) ? Number(BigInt(String(s.endTimeUnixNano)) - BigInt(String(s.startTimeUnixNano))) / 1e6 : null;
  return { source: 'OpenTelemetry', traceId, spanId, parentSpanId: s.parentSpanId && !/^0+$/.test(String(s.parentSpanId)) ? id(s.parentSpanId, 16) : null,
    group: str(a['gen_ai.conversation.id']) ?? str(a['session.id']) ?? str(a['awesome_telemetry.session.key']), name: preview(s.name, 200) ?? 'Span', kind: TRACE_KINDS.includes(a['awesome_telemetry.event.kind'] as TraceKind) ? a['awesome_telemetry.event.kind'] as TraceKind : kinds[operation ?? ''] ?? 'system', operation,
    agentName: preview(a['gen_ai.agent.name'], 200), agentId: str(a['gen_ai.agent.id']), toolName: preview(a['gen_ai.tool.name'] ?? a['tool.name'], 200), toolCallId: str(a['gen_ai.tool.call.id']), userId: str(a['user.id']),
    model: preview(a['gen_ai.response.model'] ?? a['gen_ai.request.model'] ?? a['llm.model_name'], 256), start, end: duration === null ? null : end, durationMs: duration,
    status: TRACE_STATUSES.includes(a['awesome_telemetry.event.status'] as TelemetrySpan['status']) ? a['awesome_telemetry.event.status'] as TelemetrySpan['status'] : obj(s.status).code === 2 || exception ? 'error' : obj(s.status).code === 1 ? 'success' : 'unknown', error,
    input: preview(a['gen_ai.input.messages'] ?? eventInput ?? a['input.value'] ?? (inputEvents.length ? inputEvents.map(e => e.a) : null)),
    output: preview(a['gen_ai.output.messages'] ?? eventOutput ?? a['output.value'] ?? (outputEvents.length ? outputEvents.map(e => e.a) : null)),
    usage: { input: num(a['gen_ai.usage.input_tokens'] ?? a['llm.token_count.prompt']), output: num(a['gen_ai.usage.output_tokens'] ?? a['llm.token_count.completion']), total: num(a['llm.token_count.total']),
      cacheRead: num(a['gen_ai.usage.cache_read.input_tokens'] ?? a['gen_ai.usage.cache_read_input_tokens']), cacheWrite: num(a['gen_ai.usage.cache_creation.input_tokens'] ?? a['gen_ai.usage.cache_creation_input_tokens']), reasoning: num(a['gen_ai.usage.reasoning.output_tokens']) } };
}
export function parseOtlp(value: unknown): TelemetrySpan[] {
  const root = obj(value); if (!Array.isArray(root.resourceSpans)) invalid('OTLP JSON requires resourceSpans array');
  const result: TelemetrySpan[] = [];
  for (const resource of root.resourceSpans as unknown[]) {
    const r = obj(resource); bounded(r.resource); const a = attributes(obj(r.resource).attributes);
    if (!Array.isArray(r.scopeSpans)) invalid('OTLP resource requires scopeSpans array');
    for (const scope of r.scopeSpans as unknown[]) {
      const spans = obj(scope).spans; if (!Array.isArray(spans)) invalid('OTLP scope requires spans array');
      for (const span of spans as unknown[]) { if (result.length >= 1000) limit(); result.push(mapOtlpSpan(span, a)); }
    }
  }
  return result;
}
function vendor(value: unknown, source: TelemetrySource, traces: Map<string, Record<string, unknown>>): TelemetrySpan {
  bounded(value); const r = obj(value), langfuse = source === 'Langfuse';
  const traceId = str(langfuse ? r.traceId ?? r.trace_id : r.trace_id) ?? str(r.id);
  if (!traceId || !str(r.id)) invalid('Export row requires id and trace identity');
  const t = traces.get(traceId!) ?? {}, extra = obj(r.extra), metadata = obj(extra.metadata);
  const usage = obj(r.usageDetails ?? r.usage_details ?? r.usage_metadata ?? metadata.usage_metadata ?? obj(r.outputs).usage_metadata ?? r.usage);
  const start = langfuse ? utc(r.startTime ?? r.start_time) : langSmithUtc(r.start_time), end = langfuse ? utc(r.endTime ?? r.end_time) : langSmithUtc(r.end_time);
  const kind = str(langfuse ? r.type : r.run_type) ?? '';
  const mapped: Record<string, TraceKind> = { GENERATION: 'llm', SPAN: 'system', EVENT: 'system', AGENT: 'agent', TOOL: 'tool', llm: 'llm', tool: 'tool', chain: 'system', retriever: 'system' };
  const failed = langfuse ? r.level === 'ERROR' : Boolean(r.error);
  return { source, traceId: traceId!, spanId: String(r.id), parentSpanId: str(langfuse ? r.parentObservationId ?? r.parent_observation_id : r.parent_run_id),
    group: str(langfuse ? r.sessionId ?? r.session_id ?? t.sessionId ?? t.session_id : metadata.thread_id ?? metadata.session_id), name: preview(r.name, 200) ?? (kind || 'Step'), kind: mapped[kind] ?? 'system', operation: kind || null,
    agentName: kind === 'AGENT' ? preview(r.name, 200) : null, agentId: null, toolName: ['TOOL', 'tool'].includes(kind) ? preview(r.name, 200) : null, toolCallId: null, userId: str(r.userId ?? r.user_id ?? t.userId ?? t.user_id),
    model: preview(r.model ?? metadata.ls_model_name, 256), start, end: start && end && end >= start ? end : null, durationMs: start && end && end >= start ? Date.parse(end) - Date.parse(start) : null,
    status: failed ? 'error' : r.status === 'success' ? 'success' : 'unknown', error: failed ? preview(r.error ?? r.statusMessage ?? r.status_message, 500) : null,
    input: preview(langfuse ? r.input : r.inputs), output: preview(langfuse ? r.output : r.outputs),
    usage: { input: num(usage.input ?? usage.input_tokens ?? usage.prompt_tokens ?? r.prompt_tokens), output: num(usage.output ?? usage.output_tokens ?? usage.completion_tokens ?? r.completion_tokens), total: num(usage.total ?? usage.total_tokens ?? r.total_tokens),
      cacheRead: num(usage.cache_read_input_tokens ?? obj(usage.input_token_details).cache_read), cacheWrite: num(usage.cache_creation_input_tokens ?? obj(usage.input_token_details).cache_creation), reasoning: num(obj(usage.output_token_details).reasoning) } };
}
export function detectImport(value: unknown): { format: TelemetrySource; spans: TelemetrySpan[] } {
  const root = obj(value); if (Array.isArray(root.resourceSpans)) return { format: 'OpenTelemetry', spans: parseOtlp(value) };
  const traces = new Map<string, Record<string, unknown>>();
  if (Array.isArray(root.traces)) for (const t of root.traces) { const row = obj(t); if (str(row.id)) traces.set(String(row.id), row); }
  const rows = Array.isArray(value) ? value : Array.isArray(root.observations) ? root.observations : Array.isArray(root.runs) ? root.runs : [value];
  if (!rows.length || rows.length > 1000) return rows.length ? limit() : invalid('Export contains no observations or runs');
  const formats = rows.map(r => str(obj(r).run_type) ? 'LangSmith' : str(obj(r).type) && (str(obj(r).traceId) || str(obj(r).trace_id)) ? 'Langfuse' : null);
  const format = formats[0]; if (!format || formats.some(f => f !== format)) invalid();
  return { format: format!, spans: rows.map(r => vendor(r, format!, traces)) };
}
