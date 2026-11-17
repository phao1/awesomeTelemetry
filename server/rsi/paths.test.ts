import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { rsiBankRoot, rsiCalibrationRoot, rsiCliInfo, rsiPackageRoot } from './paths.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('finds the package root from a bin entry, including through a global symlink', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rsi-paths-'))); roots.push(root);
  await mkdir(join(root, 'pkg/bin'), { recursive: true }); await writeFile(join(root, 'pkg/bin/rsi.js'), '');
  await symlink(join(root, 'pkg/bin/rsi.js'), join(root, 'global-rsi'));
  expect(rsiPackageRoot(join(root, 'pkg/bin/rsi.js'))).toBe(join(root, 'pkg'));
  expect(rsiPackageRoot(join(root, 'global-rsi'))).toBe(join(root, 'pkg'));
});
it('falls back to the working directory for other entries', () => {
  expect(rsiPackageRoot('/nonexistent/entry.js')).toBe(process.cwd());
  expect(rsiPackageRoot(undefined)).toBe(process.cwd());
});
it('derives the config root the worker expects from the data root', () => {
  expect(rsiCliInfo('/config/awesome-telemetry-data/rsi').root).toBe('/config');
  expect(rsiCliInfo('/config/awesome-telemetry-data/rsi').scripts.endsWith('scripts')).toBe(true);
});
it('produces a working CLI prefix for an installed path with spaces and apostrophes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rsi ' $(printf expanded) "))); roots.push(root);
  await mkdir(join(root, 'bin'));
  const entry = join(root, 'bin/rsi.js'); await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const previous = process.argv[1];
  let command: string;
  try { process.argv[1] = entry; command = rsiCliInfo('/config/awesome-telemetry-data/rsi').bin; }
  finally { process.argv[1] = previous!; }
  const { stdout } = await promisify(execFile)('/bin/sh', ['-c', command + ' --help']);
  expect(JSON.parse(stdout)).toEqual(['--help']);
});
it('keeps source defaults and resolves external banks independently', () => {
  expect(rsiBankRoot('standard', {})).toBe(join(process.cwd(), 'rsi-bank'));
  expect(rsiBankRoot('hard', {})).toBe(join(process.cwd(), 'rsi-bank-hard'));
  const env = { RSI_BANK_ROOT: '/banks/standard with spaces', RSI_HARD_BANK_ROOT: '/banks/hard' };
  expect(rsiBankRoot('standard', env)).toBe('/banks/standard with spaces');
  expect(rsiBankRoot('hard', env)).toBe('/banks/hard');
  expect(rsiCalibrationRoot(env)).toBe('/banks/standard with spaces/calibration');
  expect(rsiCalibrationRoot({ RSI_BANK_ROOT: 'unused-relative', RSI_CALIBRATION_ROOT: '/corpus' })).toBe('/corpus');
});
it.each(['', 'relative/bank', '/bank\0invalid'])('rejects invalid explicit bank paths: %j', value => {
  expect(() => rsiBankRoot('standard', { RSI_BANK_ROOT: value })).toThrow('RSI_BANK_ROOT must be an absolute directory path');
  expect(() => rsiBankRoot('hard', { RSI_HARD_BANK_ROOT: value })).toThrow('RSI_HARD_BANK_ROOT must be an absolute directory path');
  expect(() => rsiCalibrationRoot({ RSI_CALIBRATION_ROOT: value })).toThrow('RSI_CALIBRATION_ROOT must be an absolute directory path');
});
