import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client.js';

afterEach(() => vi.unstubAllGlobals());
it('preserves profile routes, payloads and expectedRevision while passing each caller-owned signal', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  const settings = { label: 'Synthetic', agent: 'codex' as const, projectDirectory: '/synthetic', executable: null, proxyPort: 7793, noProxy: null };
  await api.monitorProfiles(signal);await api.monitorCreateProfile(settings, signal);await api.monitorUpdateProfile('recipe', settings, 3, signal);
  await api.monitorDeleteProfile('recipe', 3, signal);await api.monitorConnectionPlan('recipe', signal);await api.monitorStartProfile('recipe', 3, signal);
  const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(([path]) => path)).toEqual(['/api/proxy/profiles', '/api/proxy/profiles', '/api/proxy/profiles/recipe', '/api/proxy/profiles/recipe', '/api/proxy/profiles/recipe/plan', '/api/proxy/profiles/recipe/start']);
  expect(calls.every(([, init]) => init.signal === signal)).toBe(true);
  expect(calls.filter(([, init]) => init.method === undefined).every(([, init]) => init.cache === 'no-store')).toBe(true);
  expect(JSON.parse(String(calls[2]![1].body))).toEqual({ settings, expectedRevision: 3 });expect(JSON.parse(String(calls[5]![1].body))).toEqual({ expectedRevision: 3 });
});

it('always reads fresh listener recovery and diagnostic snapshots without browser cache reuse', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));vi.stubGlobal('fetch', fetcher);const signal = new AbortController().signal;
  await api.proxyStatus(signal);await api.monitorConnectionDiagnostics('recipe', signal);
  const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(([path]) => path)).toEqual(['/api/proxy/status', '/api/proxy/profiles/recipe/diagnostics']);
  expect(calls.every(([, init]) => init.signal === signal && init.cache === 'no-store')).toBe(true);
});
