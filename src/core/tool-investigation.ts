import type { LinkedExecutionPage, ToolInspectionGroup, TraceSourceIdentity } from './trace-types.js';

const tuple = (identity: TraceSourceIdentity): string => JSON.stringify([identity.namespace, identity.scope, identity.value]);

/** Organizes observations only; never synthesizes a call/result lifecycle. */
export function buildToolInvestigation(page: LinkedExecutionPage): ToolInspectionGroup[] {
  const byEvent = new Map<string, TraceSourceIdentity[]>();
  const invalid = new Set<string>();
  const turns = new Map<string, Set<string>>();
  const events = new Map(page.events.map(event => [event.id, event]));
  for (const identity of page.identities) {
    if (identity.source !== 'scan' || identity.sourceKey !== page.sessionKey || identity.kind !== 'tool_call') continue;
    const key = tuple(identity);
    if (identity.eventId === null) { invalid.add(key); continue; }
    const list = byEvent.get(identity.eventId) ?? [];
    list.push(identity); byEvent.set(identity.eventId, list);
    const event = events.get(identity.eventId);
    if (event?.turnKey !== null && event?.turnKey !== undefined) {
      const values = turns.get(key) ?? new Set<string>();
      values.add(event.turnKey); turns.set(key, values);
    }
  }
  const groups = new Map<string, ToolInspectionGroup>();
  for (const event of page.events) {
    if (event.kind !== 'tool') continue;
    const identities = byEvent.get(event.id) ?? [];
    const keys = new Set(identities.map(tuple));
    const native = identities[0];
    let reason: ToolInspectionGroup['reason'] = 'native_id';
    if (!page.identityCompleteness.complete) reason = 'incomplete';
    else if (identities.length === 0 || native?.scope === null || native?.scope === '') reason = 'missing_identity';
    else if (keys.size !== 1 || invalid.has(tuple(native!)) || (turns.get(tuple(native!))?.size ?? 0) > 1) reason = 'ambiguous_identity';
    const key = reason === 'native_id' ? tuple(native!) : JSON.stringify(['event', event.id]);
    const group = groups.get(key) ?? { key, reason, identities: [], events: [] };
    group.events.push(event);
    for (const identity of identities) if (!group.identities.some(value => value.id === identity.id)) group.identities.push(identity);
    groups.set(key, group);
  }
  return [...groups.values()];
}
