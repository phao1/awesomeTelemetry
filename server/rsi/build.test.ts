import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dependencyInputs, isCandidateCompileFailure } from './build.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('networked dependency context', () => {
  it('excludes source and registry configs and invalidates cache for manifests/patches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deps-')); dirs.push(root);
    await mkdir(join(root, 'source/patches'), { recursive: true }); await mkdir(join(root, 'source/packages/core'), { recursive: true }); await mkdir(join(root, 'source/examples/demo'), { recursive: true });
    const put = (name: string, value: string): Promise<void> => writeFile(join(root, 'source', name), value);
    await put('package.json', JSON.stringify({ workspaces: ['packages/*'], patchedDependencies: { dep: 'patches/dep.patch' } }));
    await put('examples/demo/package.json', '{"name":"not-a-workspace"}'); await put('patches/other.patch', 'lock-only'); await put('bun.lock', '{"patchedDependencies":{"other":"patches/other.patch"}}'); await put('packages/core/package.json', '{"name":"core"}'); await put('patches/dep.patch', 'before');
    await put('.npmrc', 'registry=https://evil.invalid'); await put('bunfig.toml', 'registry="https://evil.invalid"'); await put('agent.ts', 'source');
    const first = await dependencyInputs(join(root, 'source'), join(root, 'deps1'));
    expect((await readdir(join(root, 'deps1'))).sort()).toEqual(['bun.lock', 'package.json', 'packages', 'patches']);
    expect((await readdir(join(root, 'deps1/patches'))).sort()).toEqual(['dep.patch', 'other.patch']);
    await put('agent.ts', 'changed'); await put('.npmrc', 'different');
    expect(await dependencyInputs(join(root, 'source'), join(root, 'deps2'))).toBe(first);
    await put('patches/dep.patch', 'after'); expect(await dependencyInputs(join(root, 'source'), join(root, 'deps3'))).not.toBe(first);
  });
});

it.skipIf(!process.env.OPENCODE_SRC)('extracts the real fixed P0 archive including inherited links, without reading any host link target', async () => {
  const { git } = await import('./build.js'), { extractFiles } = await import('./artifacts.js');
  const root = await mkdtemp(join(tmpdir(), 'source-')); dirs.push(root);
  const archive = await git(['-C', process.env.OPENCODE_SRC!, 'archive', '4d30794bcf4dccdcadbcb1f62bb35b4943a96426'], { maxOutputBytes: 256 * 1024 * 1024 });
  await extractFiles(archive, join(root, 'source'), true);
  expect(await dependencyInputs(join(root, 'source'), join(root, 'deps'))).toMatch(/^[a-f0-9]{64}$/);
  expect(await readdir(join(root, 'deps'))).not.toContain('.npmrc'); expect(await readdir(join(root, 'deps'))).not.toContain('bunfig.toml');
}, 30000);

it('only identifies recognizable source compilation errors as L0 candidate failures', () => {
  const r = { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('SyntaxError: unexpected token'), timedOut: false, cancelled: false, overflow: false };
  expect(isCandidateCompileFailure(r)).toBe(true);
  expect(isCandidateCompileFailure({ ...r, timedOut: true })).toBe(false);
  expect(isCandidateCompileFailure({ ...r, stderr: Buffer.from('ENOSPC SyntaxError') })).toBe(false);
  expect(isCandidateCompileFailure({ ...r, stderr: Buffer.from('Unknown daemon error') })).toBe(false);
});

it('globs copies only matching dependency inputs, always excluding registry configs; none needs no manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'glob-deps-')); dirs.push(root);
  const source = join(root, 'source'); await mkdir(join(source, 'nested'), { recursive: true });
  for (const [name, content] of Object.entries({ 'a.lock': 'lock', 'nested/dep.json': '{}', '.npmrc': 'secret', 'bunfig.toml': 'registry', 'nested/.npmrc': 'secret', 'nested/bunfig.toml': 'registry', 'agent.js': 'candidate' })) await writeFile(join(source, name), content);
  const hash = await dependencyInputs(source, join(root, 'deps'), { kind: 'globs', include: ['**/*'] });
  expect((await readdir(join(root, 'deps'))).sort()).toEqual(['a.lock', 'agent.js', 'nested']);
  expect(await readdir(join(root, 'deps/nested'))).toEqual(['dep.json']);
  const selected = await dependencyInputs(source, join(root, 'selected'), { kind: 'globs', include: ['**/*.json', '*.lock'] });
  expect((await readdir(join(root, 'selected'))).sort()).toEqual(['a.lock', 'nested']); expect(selected).not.toBe(hash);
  await writeFile(join(source, 'nested/.npmrc'), 'different');
  expect(await dependencyInputs(source, join(root, 'selected2'), { kind: 'globs', include: ['**/*.json', '*.lock'] })).toBe(selected);
  expect(await dependencyInputs(source, join(root, 'none'), { kind: 'none' })).toMatch(/^[a-f0-9]{64}$/);
  expect(await readdir(join(root, 'none'))).toEqual([]);
});
