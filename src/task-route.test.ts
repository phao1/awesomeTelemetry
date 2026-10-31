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

it('round-trips architecture scope and disjoint repeated comparison groups', () => {
  const route = { task: null, origin: 'collected' as const, member: 'main', mode: 'architecture' as const, event: null, overview: true, compareA: ['collected:a', 'collected:b'], compareB: ['collected:c'] };
  expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  for (const query of ['a=collected:a&b=collected:a', 'a=bogus', 'a=collected:a&a=collected:a', Array.from({ length: 41 }, (_, i) => `a=collected:${i}`).join('&')]) {
    const parsed = parseTaskRoute('#/task?' + query); expect(parsed.compareA).toBeUndefined(); expect(parsed.compareB).toBeUndefined();
  }
  expect(parseTaskRoute('#/task?mode=broken&overview=x')).toMatchObject({ mode: 'trajectory' });
});

it('round-trips a shared health report and its exact evidence record', () => {
  for (const health of ['new', 'e48979c8-1988-47ce-8838-0e1cded73cbb']) {
    const route = { task: 'collected:main', origin: 'collected' as const, member: 'all', mode: 'trajectory' as const, event: 'main:event:e13', health };
    expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  }
  expect(parseTaskRoute('#/task?health=').health).toBeUndefined();
});
