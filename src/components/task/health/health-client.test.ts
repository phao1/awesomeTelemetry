import { afterEach, expect, it, vi } from 'vitest';
import { healthApi } from './health-client.js';
import input from '../../../core/__fixtures__/task-health/g1-serial.input.json';
import type { HealthInput } from '../../../core/task-health/types.js';
import { analyzeTaskHealth } from '../../../core/task-health/report.js';
const report = () => analyzeTaskHealth(input as HealthInput, undefined, { id: 'saved', generatedAt: input.snapshotAt });
afterEach(() => vi.unstubAllGlobals());
it('sends explicit UTC scope and standard mode to the existing API with owned cancellation', async () => {
  const r = report(), scope = { member: 'all', from: '2026-10-30T00:00:00.000Z', to: '2026-10-30T01:00:00.000Z' }; r.scope = scope;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(r))));
  const controller = new AbortController(); await healthApi.generate(r.taskId, scope, controller.signal);
  expect(fetch).toHaveBeenCalledWith(`/api/tasks/${encodeURIComponent(r.taskId)}/health-reports`, expect.objectContaining({ method: 'POST', signal: controller.signal, body: JSON.stringify({ mode: 'standard', ...scope }) }));
});
it('rejects reports belonging to a different task or scope', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(report())))));
  await expect(healthApi.read('saved', 'collected:another', new AbortController().signal)).rejects.toThrow('INVALID_HEALTH_REPORT');
  await expect(healthApi.generate(input.taskId, { member: 'main', from: null, to: null }, new AbortController().signal)).rejects.toThrow('INVALID_HEALTH_SCOPE');
});
it('uses exact report IDs for direct server exports', () => {
  expect(healthApi.exportUrl('r:id', 'md')).toBe('/api/health-reports/r%3Aid/export?format=md');
});
it('rejects malformed history and a different report returned for the same task', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify(report()))));
  await expect(healthApi.list(input.taskId, new AbortController().signal)).rejects.toThrow('INVALID_HEALTH_HISTORY');
  await expect(healthApi.read('another-id', input.taskId, new AbortController().signal)).rejects.toThrow('INVALID_HEALTH_REPORT');
});
