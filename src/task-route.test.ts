import { describe, expect, it } from 'vitest';
import { parseTaskRoute, serializeTaskRoute } from './task-route.js';
describe('task location', () => {
  it('round-trips an imported event without mixing source identities', () => {
    const route = { task: 'imported:abc', origin: 'imported' as const, member: 'main', mode: 'raw' as const, event: 'import:42' };
    expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  });
  it('retains legacy native session and team member identities', () => {
    expect(parseTaskRoute('#/session?key=codex-x').task).toBe('collected:codex-x');
    const route = parseTaskRoute('#/team?runId=team%3Acodex%3Arun%3Ax&replayAgent=member-x&panel=ledger');
    expect(parseTaskRoute('#/team?runId=x&sel=agent%3Ateam%3Acodex%3Aagent%3Ay').member).toBe('team:codex:agent:y');
    expect(route).toMatchObject({ task: 'run:team:codex:run:x', member: 'member-x', mode: 'raw' });
  });
});

it('restores evidence filters and an explicit UTC time interval', () => {
  const route = { task: 'collected:root', origin: 'collected' as const, member: 'all', mode: 'trajectory' as const, event: null, q: 'Read', errors: true, from: '2026-10-25T00:00:00.000Z', to: '2026-10-25T01:00:00.000Z' };
  expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  expect(parseTaskRoute('#/task?from=bad&to=bad').from).toBeUndefined();
});
