// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { RsiIteration } from '../../src/core/rsi-types.js';
import type { HealthModelClient } from '../task-health/model-client.js';
import { runProcessMonitor } from './process-monitor.js';
const iteration = { id: 'it', prd: { observation: 'slow', hypothesis: 'general fix', changes: ['agent.js'], expectedImpact: 'faster' } } as RsiIteration;
const client = (text: string): HealthModelClient => ({ create: vi.fn(async () => ({ text, inputTokens: 20, outputTokens: 3 })) });
it('uses only the injected optimizer reader and returns informational evidence', async () => {
  const c = client('{"evidence":["special case fixture-a"]}');
  const result = await runProcessMonitor(iteration, 'const answer = 1;', { read: async () => ({ prd: iteration.prd, trajectory: 'special case fixture-a' }) }, { client: c, model: 'test' });
  expect(result).toMatchObject({ status: 'suspicious', evidence: ['special case fixture-a'] });
  const prompt = vi.mocked(c.create).mock.calls[0]![0];
  expect(prompt.system).toContain('cannot approve, suspend, score or reward');
  expect(prompt.user).toContain('general fix'); expect(prompt.user).toContain('special case fixture-a');
  expect(result).not.toHaveProperty('holdReasons'); expect(result).not.toHaveProperty('verdict');
});
it('unavailable optimizer artifacts remain missing without a model call', async () => {
  const c = client('{}');
  expect(await runProcessMonitor(iteration, '', { read: async () => null }, { client: c, model: 'test' })).toMatchObject({ status: 'missing', reason: 'session_missing' });
  expect(c.create).not.toHaveBeenCalled();
});
it('malformed or invented process evidence is missing', async () => {
  const reader = { read: async () => ({ prd: iteration.prd, trajectory: 'only real text' }) };
  for (const text of ['bad JSON', '{"evidence":["invented"]}']) expect((await runProcessMonitor(iteration, 'diff', reader, { client: client(text), model: 'test' })).status).toBe('missing');
});
it('a stuck or cancelled optimizer reader cannot block mandatory reviews', async () => {
  const c = client('{}'), reader = { read: () => new Promise<never>(() => {}) };
  expect(await runProcessMonitor(iteration, '', reader, { client: c, model: 'test', timeoutMs: 10 })).toMatchObject({ status: 'missing', reason: 'session_missing' });
  expect(await runProcessMonitor(iteration, '', reader, { client: c, model: 'test' }, AbortSignal.abort())).toMatchObject({ status: 'missing', reason: 'session_missing' });
  expect(c.create).not.toHaveBeenCalled();
});
