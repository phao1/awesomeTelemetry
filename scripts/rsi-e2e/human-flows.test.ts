import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const { flagsFor, OPTIMIZER_SCRIPT } = await import(pathToFileURL(resolve('scripts/rsi-e2e/human-flows.mjs')).href);

describe('human flow scenario', () => {
  it('requires a root and a Docker context, and rejects anything else', () => {
    expect(flagsFor(['--root', '/tmp/x', '--docker-context', 'colima-rsi'])).toMatchObject({ '--root': '/tmp/x', '--port': '4192', '--stage': 'all' });
    expect(() => flagsFor(['--root', '/tmp/x'])).toThrow('required');
    expect(() => flagsFor(['--root', '/tmp/x', '--docker-context', 'c', '--stage', 'other'])).toThrow('--stage');
    expect(() => flagsFor(['--unknown', 'x'])).toThrow('Usage');
  });
  it('gives the optimizer a script the container shell can parse, whose submissions change real code', async () => {
    await expect(promisify(execFile)('sh', ['-n', '-c', OPTIMIZER_SCRIPT])).resolves.toBeDefined();
    expect(OPTIMIZER_SCRIPT).toContain('globalThis.roundHypothesis');
  });
});
