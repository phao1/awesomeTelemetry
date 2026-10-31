import { describe, expect, it } from 'vitest';
import type { LinkedExecutionPage, TraceEventSlim, TraceSourceIdentity } from './trace-types.js';
import { buildToolInvestigation } from './tool-investigation.js';

function event(id: string, sequence: number, extra: Partial<TraceEventSlim> = {}): TraceEventSlim {
  return { id, sessionId: 's', sequence, turnKey: 'turn', kind: 'tool', phase: 'understand', title: 'read_file', startedAt: '2026-10-19T00:00:00.000Z', durationMs: 0, status: 'unknown', actor: 'assistant', tool: 'read_file', tokens: null, error: null, hasInput: true, hasOutput: false, hasRaw: true, ...extra };
}
function identity(eventId: string | null, value = 'call-a', extra: Partial<TraceSourceIdentity> = {}): TraceSourceIdentity {
  return { id: 'identity-' + eventId + value, source: 'scan', sourceKey: 's', namespace: 'protocol:openai', kind: 'tool_call', value, scope: 'native-s', eventId, sourcePath: 'events[0].payload.call_id', ...extra };
}
function page(events: TraceEventSlim[], identities: TraceSourceIdentity[]): LinkedExecutionPage {
  return { sessionKey: 's', sessionDurationSource: 'unknown', events, eventOffset: 0, eventLimit: 100, eventTotal: events.length, eventsHasMore: false, attempts: [], nextCaptureCursor: null, capturesHasMore: false, identities, identityCompleteness: { complete: true, omittedCount: 0, reasons: [] } };
}
describe('tool investigation retained identity grouping', () => {
  it('keeps interleaved same-name calls and out-of-order outputs with their exact IDs', () => {
    const input = page([event('a', 1), event('b', 2), event('bout', 3, { hasInput: false, hasOutput: true }), event('aout', 4, { hasInput: false, hasOutput: true })],
      [identity('a'), identity('b', 'call-b'), identity('bout', 'call-b'), identity('aout')]);
    expect(buildToolInvestigation(input).map(group => group.events.map(value => value.id))).toEqual([['a', 'aout'], ['b', 'bout']]);
    expect(buildToolInvestigation(input).every(group => group.reason === 'native_id')).toBe(true);
  });
  it('does not use same name or event-id shape when native identity is missing', () => {
    expect(buildToolInvestigation(page([event('call-a', 1), event('call-a:2', 2)], [])).map(group => [group.reason, group.events.length])).toEqual([['missing_identity', 1], ['missing_identity', 1]]);
  });
  it('keeps native namespace and scope distinct', () => {
    const result = buildToolInvestigation(page([event('a', 1), event('b', 2), event('c', 3)], [identity('a'), identity('b', 'call-a', { namespace: 'other' }), identity('c', 'call-a', { scope: 'other' })]));
    expect(result).toHaveLength(3);
  });
  it('keeps records independent for incomplete manifests', () => {
    const input = page([event('a', 1), event('b', 2)], [identity('a'), identity('b')]);
    input.identityCompleteness = { complete: false, omittedCount: 1, reasons: ['identity_limit'] };
    expect(buildToolInvestigation(input).map(group => group.reason)).toEqual(['incomplete', 'incomplete']);
  });
  it('does not choose among two different tool identities bound to one event', () => {
    const result = buildToolInvestigation(page([event('a', 1), event('b', 2)], [identity('a'), identity('a', 'call-b'), identity('b')]));
    expect(result[0]!.reason).toBe('ambiguous_identity'); expect(result).toHaveLength(2);
  });
  it('does not group reused call IDs across distinct known turns', () => {
    const result = buildToolInvestigation(page([event('a', 1), event('b', 2, { turnKey: 'other' })], [identity('a'), identity('b')]));
    expect(result.map(group => group.reason)).toEqual(['ambiguous_identity', 'ambiguous_identity']);
  });
  it('retains unbound collision evidence without guessing an owner', () => {
    expect(buildToolInvestigation(page([event('a', 1)], [identity('a'), identity(null)]))[0]!.reason).toBe('ambiguous_identity');
  });
  it.each([null, ''])('treats empty scope %s as unknown', scope => {
    expect(buildToolInvestigation(page([event('a', 1)], [identity('a', 'call-a', { scope })]))[0]!.reason).toBe('missing_identity');
  });
  it('ignores another session and proxy proposals', () => {
    const result = buildToolInvestigation(page([event('a', 1)], [identity('a', 'call-a', { sourceKey: 'other' }), identity('a', 'call-b', { source: 'proxy' })]));
    expect(result[0]!.reason).toBe('missing_identity');
  });
  it('deduplicates a locator while preserving all distinct retained locators and does not mutate input', () => {
    const input = page([event('a', 1), event('out', 3, { status: 'error', error: 'failed', hasOutput: true })], [identity('a'), identity('out'), identity('a', 'call-a', { id: 'second', sourcePath: 'other.locator' }), identity('a')]);
    const before = JSON.stringify(input), result = buildToolInvestigation(input);
    expect(result[0]!.identities).toHaveLength(3); expect(result[0]!.events[1]!.error).toBe('failed'); expect(JSON.stringify(input)).toBe(before);
  });
  it('does not turn llm proposals into tool events or invent absent output', () => {
    const result = buildToolInvestigation(page([event('model', 1, { kind: 'llm' }), event('a', 2)], [identity('model'), identity('a')]));
    expect(result).toHaveLength(1); expect(result[0]!.events[0]!.hasOutput).toBe(false);
  });
});
