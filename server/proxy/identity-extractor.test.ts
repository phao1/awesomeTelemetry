import { describe, expect, it } from 'vitest';
import { extractNetworkIdentities } from './identity-extractor.js';

describe('network identity extraction', () => {
  it('retains explicit provider/session declarations without changing headers or body', () => {
    const input = { requestHeaders: { 'X-Agent-Provider': 'claude', 'X-Agent-Session-Id': 'native-session', authorization: 'Bearer synthetic' }, requestBody: '{"messages":[]}', format: 'anthropic_messages' as const };
    const before = JSON.stringify(input);
    expect(extractNetworkIdentities(input).items[0]).toMatchObject({ namespace: 'agent:claude', kind: 'session', value: 'native-session', sourcePath: 'request.headers.x-agent-session-id' });
    expect(JSON.stringify(input)).toBe(before);
  });
  it('never guesses a provider/session from model, host, generic ids or user_id', () => {
    const result = extractNetworkIdentities({ requestHeaders: { 'x-session-id': 'generic', 'user-agent': 'claude-sounding-agent' }, requestBody: '{"model":"claude","metadata":{"session_id":"generic","user_id":"user-1"}}', format: 'anthropic_messages' });
    expect(result.items.some(item => item.kind === 'session')).toBe(false);
  });
  it('retains conflicting declarations instead of picking one', () => {
    const result = extractNetworkIdentities({ requestHeaders: { 'x-agent-provider': 'codex', 'x-agent-session-id': 'a' }, requestBody: '{"metadata":{"agent_provider":"codex","session_id":"b"}}', format: 'openai_responses' });
    expect(result.items.filter(item => item.kind === 'session').map(item => item.value)).toEqual(['a', 'b']);
  });
  it('retains nested Response IDs and tool call IDs with source locators', () => {
    const result = extractNetworkIdentities({ requestHeaders: {}, requestBody: '{"input":[]}', format: 'openai_responses',
      sseEvents: [{ data: '{"type":"response.completed","response":{"id":"response-1","output":[{"type":"function_call","call_id":"call-1"}]}}' }] });
    expect(result.items.find(item => item.kind === 'response')).toMatchObject({ value: 'response-1', sourcePath: 'events[0].response.id' });
    expect(result.items.find(item => item.kind === 'tool_call')?.value).toBe('call-1');
    expect(result.items.some(item => item.kind === 'session')).toBe(false);
  });
  it('does not convert a W3C parent span into a current span or Agent session', () => {
    const result = extractNetworkIdentities({ requestHeaders: { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' }, requestBody: '', format: 'unknown' });
    expect(result.items.map(item => [item.kind, item.value])).toEqual([['trace', '11111111111111111111111111111111'], ['parent_span', '2222222222222222']]);
  });
  it('reports invalid trace context and truncated previews explicitly', () => {
    const result = extractNetworkIdentities({ requestHeaders: { traceparent: '00-00000000000000000000000000000000-2222222222222222-01' }, requestBody: '', format: 'unknown', previewTruncated: true });
    expect(result.items).toEqual([]);
    expect(result.completeness.reasons).toEqual(['traceparent_unsupported_or_invalid', 'source_preview_truncated']);
  });
});
