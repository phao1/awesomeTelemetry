/**
 * Provider-neutral request-context normalization (add-request-context-diff).
 *
 * T04 scope (§4.1-§4.10): this module is a pure transformation from a *stored
 * desensitized* request body into a bounded, provider-neutral context snapshot.
 * It never reads raw bodies, headers, or cookies, never touches the proxy
 * forwarding path, and never runs a semantic diff (that is T05). Everything
 * below is derived from design D5/D6/D9 and the request-context-diff spec.
 */

import { createHash } from 'node:crypto';

import type {
  ContextCompleteness,
  RequestContextFormat,
} from '../../src/core/trace-types.js';

// ── design D9: contractual hard bounds (single exported backend module) ─────

/** Each stored request body is capped at 2 MiB; partial JSON parsing is forbidden. */
export const MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_MESSAGES = 2_000;
export const MAX_TOOLS = 256;
export const MAX_PARAMETERS = 64;
export const MAX_CHANGE_ENTRIES = 1_000; // total response (diff/response stage)
export const MAX_INLINE_TEXT_CHARS = 32_768; // each side (diff stage)
export const MAX_EVIDENCE_EXCERPT_CHARS = 4_096; // each side (diff stage)
export const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // uncompressed response
export const HISTORY_SHRINK_RATIO = 0.3;

// ── design D5: internal normalized model (never persisted, never returned) ──

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface NormalizedTextBlock {
  text: string;
  sourcePath: string;
}

export interface NormalizedMessage {
  /** Provider role (user/assistant/...) or typed item kind for Responses. */
  role: string;
  /** Coarse content kind used for identity hashing: text/content/empty/json or a typed item kind. */
  contentKind: string;
  /** Canonicalized content value (string or content-block array) or null. */
  content: JsonValue | null;
  /** Explicit provider item/message/call id when present. */
  stableId: string | null;
  /** design D5 identity hash: SHA-256 of { role, contentKind, content }. */
  contentSha256: string;
  /** Dotted source path, e.g. "messages[0]" or "input[2]". */
  sourcePath: string;
  /** Ordinal among identical (role, contentSha256) occurrences. */
  occurrence: number;
}

export interface NormalizedTool {
  name: string;
  type: string;
  description: string | null;
  /** Canonicalized parameters/schema object or null. */
  schema: JsonValue | null;
  /** design D5 tool identity (Anthropic name / function name / type+id). */
  identity: string;
  /** Ordinal among identical tool identities. */
  occurrence: number;
  sourcePath: string;
}

export interface NormalizedRequestContext {
  format: Exclude<RequestContextFormat, 'unknown'>;
  model: string | null;
  system: NormalizedTextBlock[];
  messages: NormalizedMessage[];
  tools: NormalizedTool[];
  parameters: Record<string, JsonValue>;
  stats: {
    systemChars: number;
    messageChars: number;
    toolChars: number;
    parameterChars: number;
    totalChars: number;
  };
  completeness: ContextCompleteness;
}

// ── design D5: stable reasons, not "best effort success" ─────────────────────

export type NormalizeErrorReason =
  | 'desensitized_body_missing'
  | 'source_too_large'
  | 'invalid_json'
  | 'not_an_object'
  | 'unknown_format'
  | 'classification_mismatch';

export type NormalizeResult =
  | { ok: true; normalized: NormalizedRequestContext }
  | { ok: false; reason: NormalizeErrorReason };

// ── design D5: fixed allowlist + secret-key exclusion (D5/D6, spec 4.6) ──────

const PARAMETER_ALLOWLIST: ReadonlySet<string> = new Set([
  'model',
  'temperature',
  'top_p',
  'top_k',
  'max_tokens',
  'max_output_tokens',
  'stop',
  'stream',
  'tool_choice',
  'parallel_tool_calls',
  'response_format',
  'reasoning',
  'reasoning_effort',
  'service_tier',
  'metadata',
  'cache_control',
]);

/** Any metadata key matching a secret/token/auth/cookie family is excluded. */
const SECRET_KEY_RE =
  /secret|token|auth|cookie|password|api[_-]?key|private[_-]?key|credential/i;

// ── value helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (t === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

// ── design D6: canonical equality ────────────────────────────────────────────

/** Recursively sort object keys, preserve array order and JSON types. */
export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined && isJsonValue(v)) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Serialize canonical JSON without whitespace to UTF-8 bytes. */
export function canonicalBytes(value: JsonValue): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(value)), 'utf8');
}

/** Canonical SHA-256 (hex) over the design-D6 canonical UTF-8 bytes. */
export function canonicalSha256(value: JsonValue): string {
  return createHash('sha256').update(canonicalBytes(value)).digest('hex');
}

function jsonLength(value: JsonValue): number {
  if (value === null) return 0;
  return canonicalBytes(value).length;
}

// ── content helpers (Anthropic blocks, Chat strings, Responses typed items) ──

function contentToJsonValue(content: unknown): JsonValue | null {
  if (content === null || content === undefined) return null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const out: JsonValue[] = [];
    for (const block of content) {
      if (isJsonValue(block)) out.push(block);
    }
    return out;
  }
  return isJsonValue(content) ? content : null;
}

function contentKindOf(content: JsonValue | null): string {
  if (content === null) return 'empty';
  if (typeof content === 'string') return 'text';
  if (Array.isArray(content)) return 'content';
  return 'json';
}

/** Plain-text projection used for system blocks and message text. */
function contentText(content: JsonValue | null): string {
  if (content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        isRecord(block) && typeof block.text === 'string'
          ? block.text
          : isJsonValue(block)
            ? JSON.stringify(canonicalize(block))
            : '',
      )
      .join('');
  }
  return JSON.stringify(canonicalize(content));
}

// ── source validation (task 4.2) ─────────────────────────────────────────────

/**
 * design D5/EC-5 structural agreement. The stored format is authoritative
 * (it was produced by the host/path-aware classifier at capture time), so this
 * is a weaker compatibility check that catches corruption or a clearly
 * different shape without rejecting a valid messages-only Anthropic/Chat body.
 */
function bodyAgreesWithFormat(
  format: Exclude<RequestContextFormat, 'unknown'>,
  body: Record<string, unknown>,
): boolean {
  switch (format) {
    case 'anthropic_messages':
      return Array.isArray(body.messages);
    case 'openai_chat':
      // Chat always carries a messages array and is not Responses-shaped.
      return Array.isArray(body.messages) && !('input' in body) && !('instructions' in body);
    case 'openai_responses':
      return body.input !== undefined || body.instructions !== undefined;
    default:
      return false;
  }
}

export function validateSource(input: {
  format: RequestContextFormat;
  desensitizedBody: string;
}):
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; reason: NormalizeErrorReason } {
  const body = input.desensitizedBody;
  if (body === undefined || body === null || body.trim() === '') {
    return { ok: false, reason: 'desensitized_body_missing' };
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_SOURCE_BODY_BYTES) {
    return { ok: false, reason: 'source_too_large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'not_an_object' };
  }
  if (input.format === 'unknown') {
    return { ok: false, reason: 'unknown_format' };
  }
  if (!bodyAgreesWithFormat(input.format as Exclude<RequestContextFormat, 'unknown'>, parsed)) {
    return { ok: false, reason: 'classification_mismatch' };
  }
  return { ok: true, parsed };
}

// ── per-format builders ──────────────────────────────────────────────────────

function buildAnthropicSystem(systemValue: unknown, system: NormalizedTextBlock[]): void {
  if (typeof systemValue === 'string') {
    system.push({ text: systemValue, sourcePath: 'system' });
  } else if (Array.isArray(systemValue)) {
    systemValue.forEach((block, i) => {
      const path = `system[${i}]`;
      if (isRecord(block) && typeof block.text === 'string') {
        system.push({ text: block.text, sourcePath: path });
      } else if (isJsonValue(block)) {
        system.push({ text: JSON.stringify(canonicalize(block)), sourcePath: path });
      }
    });
  }
}

function messageFromRecord(
  msg: Record<string, unknown>,
  sourcePath: string,
): NormalizedMessage | null {
  const role = typeof msg.role === 'string' ? msg.role : 'unknown';
  const content = contentToJsonValue(msg.content);
  const contentKind = contentKindOf(content);
  const stableId =
    typeof msg.id === 'string'
      ? msg.id
      : typeof msg.call_id === 'string'
        ? msg.call_id
        : null;
  const contentSha256 = canonicalSha256({ role, contentKind, content });
  return { role, contentKind, content, stableId, contentSha256, sourcePath, occurrence: 0 };
}

function buildAnthropicMessages(items: unknown, messages: NormalizedMessage[]): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, i) => {
    if (isRecord(item)) {
      const m = messageFromRecord(item, `messages[${i}]`);
      if (m) messages.push(m);
    }
  });
}

function buildAnthropicTools(items: unknown, tools: NormalizedTool[]): void {
  if (!Array.isArray(items)) return;
  items.forEach((tool, i) => {
    if (!isRecord(tool)) return;
    const name = typeof tool.name === 'string' ? tool.name : 'unnamed';
    const description = typeof tool.description === 'string' ? tool.description : null;
    const schema = isJsonValue(tool.input_schema) ? canonicalize(tool.input_schema) : null;
    tools.push({
      name,
      type: 'function',
      description,
      schema,
      identity: name,
      occurrence: 0,
      sourcePath: `tools[${i}]`,
    });
  });
}

function buildChatSystemAndMessages(
  items: unknown,
  messages: NormalizedMessage[],
  system: NormalizedTextBlock[],
): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, i) => {
    if (!isRecord(item)) return;
    const role = typeof item.role === 'string' ? item.role : 'unknown';
    const path = `messages[${i}]`;
    if (role === 'system' || role === 'developer') {
      const content = contentToJsonValue(item.content);
      system.push({ text: contentText(content), sourcePath: path });
      return;
    }
    const m = messageFromRecord(item, path);
    if (m) messages.push(m);
  });
}

function buildChatTools(
  toolsValue: unknown,
  functionsValue: unknown,
  tools: NormalizedTool[],
): void {
  if (Array.isArray(toolsValue)) {
    toolsValue.forEach((tool, i) => {
      if (!isRecord(tool)) return;
      const fn = isRecord(tool.function) ? tool.function : null;
      const name = fn !== null && typeof fn.name === 'string' ? fn.name : 'unnamed';
      const description =
        fn !== null && typeof fn.description === 'string' ? fn.description : null;
      const schema = fn !== null && isJsonValue(fn.parameters) ? canonicalize(fn.parameters) : null;
      tools.push({
        name,
        type: 'function',
        description,
        schema,
        identity: name,
        occurrence: 0,
        sourcePath: `tools[${i}]`,
      });
    });
  }
  if (Array.isArray(functionsValue)) {
    functionsValue.forEach((fnRaw, i) => {
      if (!isRecord(fnRaw)) return;
      const name = typeof fnRaw.name === 'string' ? fnRaw.name : 'unnamed';
      const description = typeof fnRaw.description === 'string' ? fnRaw.description : null;
      const schema = isJsonValue(fnRaw.parameters) ? canonicalize(fnRaw.parameters) : null;
      tools.push({
        name,
        type: 'function',
        description,
        schema,
        identity: name,
        occurrence: 0,
        sourcePath: `functions[${i}]`,
      });
    });
  }
}

function buildResponsesSystem(instructions: unknown, system: NormalizedTextBlock[]): void {
  if (typeof instructions === 'string') {
    system.push({ text: instructions, sourcePath: 'instructions' });
  }
}

function buildResponsesInput(items: unknown, messages: NormalizedMessage[]): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, i) => {
    if (!isRecord(item)) return;
    const path = `input[${i}]`;
    const type = typeof item.type === 'string' ? item.type : 'unknown';
    const stableId =
      typeof item.id === 'string'
        ? item.id
        : typeof item.call_id === 'string'
          ? item.call_id
          : null;
    if (type === 'message') {
      const role = typeof item.role === 'string' ? item.role : 'unknown';
      const content = contentToJsonValue(item.content);
      const contentKind = contentKindOf(content);
      const contentSha256 = canonicalSha256({ role, contentKind, content });
      messages.push({ role, contentKind, content, stableId, contentSha256, sourcePath: path, occurrence: 0 });
      return;
    }
    let content: JsonValue | null = null;
    if (type === 'function_call') {
      content = {
        name: typeof item.name === 'string' ? item.name : null,
        arguments: typeof item.arguments === 'string' ? item.arguments : null,
      };
    } else if (typeof item.output === 'string') {
      content = item.output;
    } else if (isJsonValue(item)) {
      content = canonicalize(item);
    }
    const contentSha256 = canonicalSha256({ role: type, contentKind: type, content });
    messages.push({ role: type, contentKind: type, content, stableId, contentSha256, sourcePath: path, occurrence: 0 });
  });
}

function buildResponsesTools(items: unknown, tools: NormalizedTool[]): void {
  if (!Array.isArray(items)) return;
  items.forEach((tool, i) => {
    if (!isRecord(tool)) return;
    const type = typeof tool.type === 'string' ? tool.type : 'unknown';
    const fn = isRecord(tool.function) ? tool.function : null;
    const name = typeof tool.name === 'string'
      ? tool.name
      : fn !== null && typeof fn.name === 'string'
        ? fn.name
        : null;
    const id = typeof tool.id === 'string' ? tool.id : null;
    const description =
      typeof tool.description === 'string'
        ? tool.description
        : fn !== null && typeof fn.description === 'string'
          ? fn.description
          : null;
    const schemaValue = isJsonValue(tool.parameters) ? tool.parameters : null;
    const schema = schemaValue === null ? null : canonicalize(schemaValue);
    const identity = name ?? (id !== null ? `${type}:${id}` : type);
    tools.push({
      name: name ?? (id !== null ? id : type),
      type,
      description,
      schema,
      identity,
      occurrence: 0,
      sourcePath: `tools[${i}]`,
    });
  });
}

// ── parameters (task 4.6) ────────────────────────────────────────────────────

function buildParameters(body: Record<string, unknown>, parameters: Record<string, JsonValue>): void {
  for (const key of PARAMETER_ALLOWLIST) {
    if (!(key in body)) continue;
    const value = body[key];
    if (key === 'metadata') {
      if (!isRecord(value)) continue;
      for (const subKey of Object.keys(value)) {
        if (SECRET_KEY_RE.test(subKey)) continue;
        const subValue = value[subKey];
        if (isScalar(subValue)) parameters[`metadata.${subKey}`] = subValue as JsonValue;
      }
    } else if (isJsonValue(value)) {
      parameters[key] = value;
    }
  }
}

// ── occurrence ordinals (task 4.7) ───────────────────────────────────────────

function assignOccurrences<T extends { occurrence: number }>(
  items: T[],
  keyOf: (item: T) => string,
): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    const n = seen.get(key) ?? 0;
    item.occurrence = n;
    seen.set(key, n + 1);
  }
}

// ── bounds (task 4.8) ────────────────────────────────────────────────────────

function applyMessageBounds(messages: NormalizedMessage[], state: { omittedCount: number; anyBound: boolean }): void {
  if (messages.length > MAX_MESSAGES) {
    const originalLen = messages.length;
    const half = MAX_MESSAGES / 2;
    const retained = messages.slice(0, half).concat(messages.slice(originalLen - half));
    state.omittedCount += originalLen - MAX_MESSAGES;
    messages.splice(0, messages.length, ...retained);
    state.anyBound = true;
  }
}

function applyToolBounds(tools: NormalizedTool[], state: { omittedCount: number; anyBound: boolean }): void {
  if (tools.length > MAX_TOOLS) {
    state.omittedCount += tools.length - MAX_TOOLS;
    tools.splice(MAX_TOOLS);
    state.anyBound = true;
  }
}

function applyParameterBounds(parameters: Record<string, JsonValue>, state: { omittedCount: number; anyBound: boolean }): void {
  const keys = Object.keys(parameters);
  if (keys.length > MAX_PARAMETERS) {
    const sorted = [...keys].sort();
    state.omittedCount += keys.length - MAX_PARAMETERS;
    for (const key of sorted.slice(MAX_PARAMETERS)) {
      delete parameters[key];
    }
    state.anyBound = true;
  }
}

// ── entry point (task 4.1) ───────────────────────────────────────────────────

export function normalizeRequestContext(input: {
  format: RequestContextFormat;
  desensitizedBody: string;
}): NormalizeResult {
  const validation = validateSource(input);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const format = input.format as Exclude<RequestContextFormat, 'unknown'>;
  const body = validation.parsed;
  const model = typeof body.model === 'string' ? body.model : null;

  const system: NormalizedTextBlock[] = [];
  const messages: NormalizedMessage[] = [];
  const tools: NormalizedTool[] = [];
  const parameters: Record<string, JsonValue> = {};

  switch (format) {
    case 'anthropic_messages':
      buildAnthropicSystem(body.system, system);
      buildAnthropicMessages(body.messages, messages);
      buildAnthropicTools(body.tools, tools);
      break;
    case 'openai_chat':
      buildChatSystemAndMessages(body.messages, messages, system);
      buildChatTools(body.tools, body.functions, tools);
      break;
    case 'openai_responses':
      buildResponsesSystem(body.instructions, system);
      buildResponsesInput(body.input, messages);
      buildResponsesTools(body.tools, tools);
      break;
  }

  buildParameters(body, parameters);

  assignOccurrences(messages, (m) => `${m.role}\u0000${m.contentSha256}`);
  assignOccurrences(tools, (t) => t.identity);

  const state = { omittedCount: 0, anyBound: false };
  applyMessageBounds(messages, state);
  applyToolBounds(tools, state);
  applyParameterBounds(parameters, state);

  const completeness: ContextCompleteness = state.anyBound
    ? { complete: false, omittedCount: state.omittedCount, reasons: ['item_limit'] }
    : { complete: true, omittedCount: 0, reasons: [] };

  const systemChars = system.reduce((sum, block) => sum + block.text.length, 0);
  const messageChars = messages.reduce((sum, m) => sum + jsonLength(m.content ?? '') , 0);
  const toolChars = tools.reduce(
    (sum, t) => sum + t.name.length + (t.description?.length ?? 0) + jsonLength(t.schema ?? null),
    0,
  );
  const parameterChars = jsonLength(parameters);
  const totalChars = systemChars + messageChars + toolChars + parameterChars;

  return {
    ok: true,
    normalized: {
      format,
      model,
      system,
      messages,
      tools,
      parameters,
      stats: { systemChars, messageChars, toolChars, parameterChars, totalChars },
      completeness,
    },
  };
}
