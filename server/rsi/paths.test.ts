import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { rsiCliInfo, rsiPackageRoot } from './paths.js';

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
});
