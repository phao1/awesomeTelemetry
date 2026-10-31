import { PROVIDER_KEYS, type NativeIdentitySet, type RequestContextFormat } from '../../src/core/trace-types.js';
import { createIdentityCollector, identityRecord as record } from '../../src/adapters/native-identities.js';
import type { SseEvent } from './sse-accumulator.js';

export interface NetworkIdentityInput {
  requestHeaders: Record<string, string | string[]>;
  responseHeaders?: Record<string, string | string[]>;
  requestBody: string;
  responseBody?: string | null;
  format: RequestContextFormat;
  sseEvents?: SseEvent[];
  previewTruncated?: boolean;
}

export function extractNetworkIdentities(input: NetworkIdentityInput): NativeIdentitySet {
  const collector = createIdentityCollector(2048);
  const header = (headers: NetworkIdentityInput['requestHeaders'], name: string): string | null => {
    const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    return typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 ? value[0] ?? null : null;
  };
  const parse = (body: string, reason: string): Record<string, unknown> | null => {
    if (body === '') return null;
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) { collector.omit(reason); return null; }
    try { return record(JSON.parse(body) as unknown); } catch { collector.omit(reason); return null; }
  };
  const request = parse(input.requestBody, 'request_identity_unparsed');
  const metadata = record(request?.metadata);
  const declared: Array<{ provider: unknown; id: unknown; path: string }> = [
    { provider: header(input.requestHeaders, 'x-agent-provider'), id: header(input.requestHeaders, 'x-agent-session-id'), path: 'request.headers.x-agent-session-id' },
    { provider: metadata?.agent_provider, id: metadata?.session_id, path: 'request.metadata.session_id' },
  ];
  const sessionIds = new Set<string>();
  for (const declaration of declared) {
    if (typeof declaration.provider !== 'string' || !PROVIDER_KEYS.some(provider => provider === declaration.provider)) continue;
    if (typeof declaration.id === 'string' && declaration.id !== '') {
      collector.add('agent:' + declaration.provider, 'session', declaration.id, declaration.path);
      sessionIds.add(declaration.id);
    }
  }
  const scope = sessionIds.size === 1 ? [...sessionIds][0]! : null;
  for (const [direction, headers] of [['request', input.requestHeaders], ['response', input.responseHeaders ?? {}]] as const) {
    for (const name of ['request-id', 'x-request-id', 'x-client-request-id']) {
      collector.add('http:' + name, 'request', header(headers, name), direction + '.headers.' + name, scope);
    }
  }
  const traceparent = header(input.requestHeaders, 'traceparent');
  if (traceparent !== null) {
    // W3C v00: lower-case nonzero trace and parent IDs. No new span is fabricated.
    const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(traceparent);
    if (match !== null && !/^0+$/.test(match[1]!) && !/^0+$/.test(match[2]!)) {
      collector.add('w3c', 'trace', match[1], 'request.headers.traceparent.trace-id');
      collector.add('w3c', 'parent_span', match[2], 'request.headers.traceparent.parent-id');
    } else collector.omit('traceparent_unsupported_or_invalid');
  }
  const namespace = input.format === 'anthropic_messages' ? 'protocol:anthropic' : 'protocol:openai';
  const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
  const content = (value: unknown, path: string): void => {
    const block = record(value);
    if (block === null) return;
    if (block.type === 'tool_use') collector.add(namespace, 'tool_call', block.id, path + '.id', scope);
    if (block.type === 'tool_result') collector.add(namespace, 'tool_call', block.tool_use_id, path + '.tool_use_id', scope);
    collector.add(namespace, 'tool_call', block.call_id ?? block.tool_call_id, path + (block.call_id !== undefined ? '.call_id' : '.tool_call_id'), scope);
    array(block.tool_calls).forEach((value, index) => collector.add(namespace, 'tool_call', record(value)?.id, path + '.tool_calls[' + index + '].id', scope));
  };
  const frame = (value: Record<string, unknown>, path: string, response: boolean): void => {
    if (response) collector.add(namespace, 'response', value.id, path + '.id', scope);
    const historyField = value.messages !== undefined ? 'messages' : 'input';
    array(value[historyField]).forEach((item, i) => {
      const message = record(item);
      content(message, path + '.' + historyField + '[' + i + ']');
      array(message?.content).forEach((block, j) => content(block, path + '.' + historyField + '[' + i + '].content[' + j + ']'));
    });
    const outputField = value.content !== undefined ? 'content' : 'output';
    array(value[outputField]).forEach((block, i) => content(block, path + '.' + outputField + '[' + i + ']'));
    const message = record(value.message);
    if (message !== null) {
      if (response) collector.add(namespace, 'response', message.id, path + '.message.id', scope);
      content(message, path + '.message');
    }
    content(value.content_block, path + '.content_block');
    array(value.choices).forEach((item, i) => {
      const choice = record(item);
      const field = choice?.delta !== undefined ? 'delta' : 'message';
      content(choice?.[field], path + '.choices[' + i + '].' + field);
    });
    const nested = record(value.response);
    if (nested !== null) {
      collector.add(namespace, 'response', nested.id, path + '.response.id', scope);
      array(nested.output).forEach((block, i) => content(block, path + '.response.output[' + i + ']'));
    }
    content(value.item, path + '.item');
  };
  if (input.format !== 'unknown') {
    if (request !== null) frame(request, 'request', false);
    if (input.sseEvents !== undefined) input.sseEvents.forEach((event, i) => {
      if (event.data === undefined || event.data === '[DONE]') return;
      const value = parse(event.data, 'response_identity_unparsed');
      if (value !== null) frame(value, 'events[' + i + ']', true);
    });
    else if (input.responseBody) {
      const value = parse(input.responseBody, 'response_identity_unparsed');
      if (value !== null) frame(value, 'response', true);
    }
  }
  if (input.previewTruncated) collector.omit('source_preview_truncated');
  return collector.finish();
}
