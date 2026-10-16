import type { NativeIdentityKind, NativeIdentitySet, ProviderKey } from '../core/trace-types.js';

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

export function collectClaudeIdentities(rows: readonly unknown[], provider: 'claude' | 'codeagent' = 'claude'): NativeIdentitySet {
  const collector = createIdentityCollector();
  const namespace = 'agent:' + provider;
  const scope = uniqueSession(rows.map(row => string(identityRecord(row)?.sessionId)));
  rows.forEach((value, i) => {
    const row = identityRecord(value);
    if (row === null) return;
    const path = 'events[' + i + ']';
    const nativeScope = string(row.sessionId) ?? scope;
    collector.add(namespace, 'session', row.sessionId, path + '.sessionId');
    collector.add(namespace, 'message', row.uuid, path + '.uuid', nativeScope);
    collector.add('protocol:anthropic', 'request', row.requestId, path + '.requestId', nativeScope);
    const message = identityRecord(row.message);
    collector.add('protocol:anthropic', row.type === 'assistant' ? 'response' : 'message', message?.id, path + '.message.id', nativeScope);
    array(message?.content).forEach((value, j) => {
      const block = identityRecord(value);
      if (block?.type === 'tool_use') collector.add('protocol:anthropic', 'tool_call', block.id, path + '.message.content[' + j + '].id', nativeScope);
      if (block?.type === 'tool_result') collector.add('protocol:anthropic', 'tool_call', block.tool_use_id, path + '.message.content[' + j + '].tool_use_id', nativeScope);
    });
  });
  return collector.finish();
}

export function collectCodexIdentities(rows: readonly unknown[]): NativeIdentitySet {
  const collector = createIdentityCollector();
  const nativeSession = (value: unknown): string | null => {
    const row = identityRecord(value);
    const payload = identityRecord(row?.payload);
    return string(payload?.session_id) ?? (row?.type === 'session_meta' ? string(payload?.id) : null);
  };
  const scope = uniqueSession(rows.map(nativeSession));
  rows.forEach((value, i) => {
    const row = identityRecord(value);
    const payload = identityRecord(row?.payload);
    if (row === null || payload === null) return;
    const path = 'events[' + i + '].payload';
    collector.add('agent:codex', 'session', payload.session_id, path + '.session_id');
    if (row.type === 'session_meta') {
      collector.add('agent:codex', 'session', payload.id, path + '.id');
      for (const field of ['forked_from_id', 'parent_thread_id']) collector.add('agent:codex', 'parent_session', payload[field], path + '.' + field);
      const parent = identityRecord(identityRecord(identityRecord(payload.source)?.subagent)?.thread_spawn);
      collector.add('agent:codex', 'parent_session', parent?.parent_thread_id, path + '.source.subagent.thread_spawn.parent_thread_id');
    }
    collector.add('agent:codex', 'turn', payload.turn_id, path + '.turn_id', scope);
    if (row.type === 'response_item') {
      collector.add('protocol:openai', 'message', payload.id, path + '.id', scope);
      collector.add('protocol:openai', 'tool_call', payload.call_id, path + '.call_id', scope);
    }
    collector.add('protocol:openai', 'response', payload.response_id, path + '.response_id', scope);
  });
  return collector.finish();
}

export function collectOpencodeIdentities(session: unknown, messages: readonly unknown[], provider: ProviderKey): NativeIdentitySet {
  const collector = createIdentityCollector();
  const native = identityRecord(session);
  const namespace = 'agent:' + provider;
  const scope = uniqueSession([string(native?.id), ...messages.map(message => string(identityRecord(message)?.sessionID))]);
  collector.add(namespace, 'session', native?.id, 'session.id');
  collector.add(namespace, 'parent_session', native?.parentID, 'session.parentID');
  messages.forEach((value, i) => {
    const message = identityRecord(value);
    if (message === null) return;
    const path = 'messages[' + i + ']';
    collector.add(namespace, 'session', message.sessionID, path + '.sessionID');
    collector.add(namespace, 'message', message.id, path + '.id', string(message.sessionID) ?? scope);
    array(message.content).forEach((value, j) => {
      const part = identityRecord(value);
      if (part?.type === 'tool') collector.add(namespace, 'tool_call', part.callID, path + '.content[' + j + '].callID', string(message.sessionID) ?? scope);
    });
  });
  return collector.finish();
}
