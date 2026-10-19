import type { NativeIdentityKind, NativeIdentitySet, ProviderKey, TraceEventSlim } from '../core/trace-types.js';

const EVENT_SOURCES = Symbol('native-event-sources');
type SourceEvent = TraceEventSlim & { [EVENT_SOURCES]?: object[] };
export type NativeEventBindings = ReadonlyMap<object, readonly string[]>;

/** Internal provenance survives the existing event clones, never the public DTO. */
export function trackNativeEvent<T extends TraceEventSlim>(event: T, ...sources: object[]): T {
  Object.defineProperty(event, EVENT_SOURCES, { value: [...((event as SourceEvent)[EVENT_SOURCES] ?? []), ...sources], enumerable: true, configurable: true });
  return event;
}

/** Call after ordering/deduplication so evidence references the actual stored ID. */
export function collectNativeEventBindings(events: readonly TraceEventSlim[]): NativeEventBindings {
  const bindings = new Map<object, string[]>();
  for (const event of events) {
    const owned = event as SourceEvent;
    for (const source of owned[EVENT_SOURCES] ?? []) {
      const ids = bindings.get(source) ?? [];
      if (!ids.includes(event.id)) ids.push(event.id);
      bindings.set(source, ids);
    }
    delete owned[EVENT_SOURCES];
  }
  return bindings;
}

function addBound(collector: ReturnType<typeof createIdentityCollector>, bindings: NativeEventBindings | undefined,
  source: object, namespace: string, kind: NativeIdentityKind, value: unknown, sourcePath: string, scope: string | null): void {
  const ids = bindings?.get(source);
  if (ids === undefined || ids.length === 0) collector.add(namespace, kind, value, sourcePath, scope);
  else for (const eventId of ids) collector.add(namespace, kind, value, sourcePath, scope, eventId);
}

export function identityRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

/** Never truncates an opaque matching key. Duplicate fields keep their first locator. */
export function createIdentityCollector(limit = 50_000) {
  const output: NativeIdentitySet = { parserVersion: 1, items: [], completeness: { complete: true, omittedCount: 0, reasons: [] } };
  const seen = new Set<string>();
  const omit = (reason: string): void => {
    output.completeness.complete = false;
    output.completeness.omittedCount += 1;
    if (!output.completeness.reasons.includes(reason)) output.completeness.reasons.push(reason);
  };
  const add = (namespace: string, kind: NativeIdentityKind, value: unknown, sourcePath: string, scope: string | null = null, eventId: string | null = null): void => {
    if (typeof value !== 'string' || value.length === 0) return;
    if (value.length > 1024 || (scope?.length ?? 0) > 1024 || namespace.length > 128 || sourcePath.length > 512) {
      omit('identifier_limit'); return;
    }
    const key = JSON.stringify([namespace, kind, value, scope, eventId]);
    if (seen.has(key)) return;
    if (output.items.length >= limit) { omit('identity_limit'); return; }
    seen.add(key);
    output.items.push({ namespace, kind, value, scope, eventId, sourcePath });
  };
  return { add, omit, finish: (): NativeIdentitySet => {
    if (output.items.length === 0 && output.completeness.complete) {
      output.completeness.complete = false;
      output.completeness.reasons.push('no_native_identifiers');
    }
    return output;
  } };
}

function uniqueSession(values: Array<string | null>): string | null {
  const ids = new Set(values.filter((value): value is string => value !== null));
  return ids.size === 1 ? [...ids][0]! : null;
}

export function collectClaudeIdentities(rows: readonly unknown[], provider: 'claude' | 'codeagent' = 'claude', bindings?: NativeEventBindings): NativeIdentitySet {
  const collector = createIdentityCollector();
  const namespace = 'agent:' + provider;
  const scope = uniqueSession(rows.map(row => string(identityRecord(row)?.sessionId)));
  rows.forEach((value, i) => {
    const row = identityRecord(value);
    if (row === null) return;
    const path = 'events[' + i + ']';
    const nativeScope = string(row.sessionId) ?? scope;
    collector.add(namespace, 'session', row.sessionId, path + '.sessionId');
    addBound(collector, bindings, row, namespace, 'message', row.uuid, path + '.uuid', nativeScope);
    addBound(collector, bindings, row, 'protocol:anthropic', 'request', row.requestId, path + '.requestId', nativeScope);
    const message = identityRecord(row.message);
    addBound(collector, bindings, row, 'protocol:anthropic', row.type === 'assistant' ? 'response' : 'message', message?.id, path + '.message.id', nativeScope);
    array(message?.content).forEach((value, j) => {
      const block = identityRecord(value);
      if (block?.type === 'tool_use') addBound(collector, bindings, block, 'protocol:anthropic', 'tool_call', block.id, path + '.message.content[' + j + '].id', nativeScope);
      if (block?.type === 'tool_result') addBound(collector, bindings, block, 'protocol:anthropic', 'tool_call', block.tool_use_id, path + '.message.content[' + j + '].tool_use_id', nativeScope);
    });
  });
  return { ...collector.finish(), parserVersion: 2 };
}

export function collectCodexIdentities(rows: readonly unknown[], bindings?: NativeEventBindings): NativeIdentitySet {
  const collector = createIdentityCollector();
  const nativeSessions = (value: unknown): Array<string | null> => {
    const row = identityRecord(value);
    const payload = identityRecord(row?.payload);
    return [string(payload?.session_id), row?.type === 'session_meta' ? string(payload?.id) : null];
  };
  // Some exported metadata carries a parent session_id alongside a child id.
  // Keep both pieces of evidence; neither may silently become a file-wide scope.
  const scope = uniqueSession(rows.flatMap(nativeSessions));
  rows.forEach((value, i) => {
    const row = identityRecord(value);
    const payload = identityRecord(row?.payload);
    if (row === null || payload === null) return;
    const path = 'events[' + i + '].payload';
    const nativeScope = (row.type === 'session_meta' ? string(payload.id) : null) ?? string(payload.session_id) ?? scope;
    collector.add('agent:codex', 'session', payload.session_id, path + '.session_id');
    if (row.type === 'session_meta') {
      collector.add('agent:codex', 'session', payload.id, path + '.id');
      for (const field of ['forked_from_id', 'parent_thread_id']) collector.add('agent:codex', 'parent_session', payload[field], path + '.' + field, nativeScope);
      const parent = identityRecord(identityRecord(identityRecord(payload.source)?.subagent)?.thread_spawn);
      collector.add('agent:codex', 'parent_session', parent?.parent_thread_id, path + '.source.subagent.thread_spawn.parent_thread_id', nativeScope);
    }
    addBound(collector, bindings, row, 'agent:codex', 'turn', payload.turn_id, path + '.turn_id', nativeScope);
    if (row.type === 'response_item') {
      addBound(collector, bindings, row, 'protocol:openai', 'message', payload.id, path + '.id', nativeScope);
    }
    if (row.type === 'response_item' || row.type === 'event_msg') {
      addBound(collector, bindings, row, 'protocol:openai', 'tool_call', payload.call_id, path + '.call_id', nativeScope);
    }
    addBound(collector, bindings, row, 'protocol:openai', 'response', payload.response_id, path + '.response_id', nativeScope);
  });
  return { ...collector.finish(), parserVersion: 3 };
}

export function collectOpencodeIdentities(session: unknown, messages: readonly unknown[], provider: ProviderKey, bindings?: NativeEventBindings): NativeIdentitySet {
  const collector = createIdentityCollector();
  const native = identityRecord(session);
  const namespace = 'agent:' + provider;
  const scope = uniqueSession([string(native?.id), ...messages.map(message => string(identityRecord(message)?.sessionID))]);
  collector.add(namespace, 'session', native?.id, 'session.id');
  collector.add(namespace, 'parent_session', native?.parentID, 'session.parentID', string(native?.id) ?? scope);
  messages.forEach((value, i) => {
    const message = identityRecord(value);
    if (message === null) return;
    const path = 'messages[' + i + ']';
    collector.add(namespace, 'session', message.sessionID, path + '.sessionID');
    addBound(collector, bindings, message, namespace, 'message', message.id, path + '.id', string(message.sessionID) ?? scope);
    array(message.content).forEach((value, j) => {
      const part = identityRecord(value);
      if (part?.type === 'tool') addBound(collector, bindings, part, namespace, 'tool_call', part.callID, path + '.content[' + j + '].callID', string(message.sessionID) ?? scope);
    });
  });
  return { ...collector.finish(), parserVersion: 3 };
}
