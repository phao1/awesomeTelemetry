import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runProcess } from '../../server/rsi/docker.js';
const { argumentsFor } = await import(pathToFileURL(resolve('scripts/rsi-e2e/p2-smoke.mjs')).href);
describe('external Docker e2e harness', () => {
  it('requires a repository and rejects unknown arguments', () => {
    expect(() => argumentsFor([])).toThrow('--repository');
    expect(() => argumentsFor(['--unknown', 'x'])).toThrow('Usage');
    expect(argumentsFor(['--repository', '/source', '--docker-context', 'colima-rsi'])).toEqual({ repository: '/source', 'docker-context': 'colima-rsi' });
  });
  it.skipIf(process.env.RSI_DOCKER_E2E !== '1')('executes the actual container workflow outside the sandbox', async () => {
    if (!process.env.OPENCODE_SRC) throw new Error('OPENCODE_SRC required');
    const r = await runProcess(process.execPath, ['scripts/rsi-e2e/p2-smoke.mjs', '--repository', process.env.OPENCODE_SRC], { timeoutMs: 3600000, maxOutputBytes: 16 * 1024 * 1024 });
    expect(r.code, r.stderr.toString()).toBe(0);
  }, 3600000);
});
