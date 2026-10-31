import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectionProfileStore, buildConnectionPlan } from './connection-profiles.js';
import type { MonitorConnectionSettings } from '../../src/core/trace-types.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'monitor-profiles-'));
  const path = join(directory, 'profiles.json');
  const settings: MonitorConnectionSettings = { label: 'Synthetic project', agent: 'claude', projectDirectory: directory, executable: null, proxyPort: 7779, noProxy: null };
  return { directory, path, settings, store: new ConnectionProfileStore(path), close: () => rm(directory, { recursive: true, force: true }) };
}

describe('application-owned connection profiles', () => {
  it('persists metadata with UTC timestamps, reloads it and compare-and-swaps edits/deletion', async () => {
    const f = await fixture();
    try {
      expect(await f.store.list()).toEqual([]);
      const original = await f.store.create(f.settings);
      expect(original).toMatchObject({ ...f.settings, revision: 1 });
      expect(new Date(original.createdAt).toISOString()).toBe(original.createdAt);
      expect(await new ConnectionProfileStore(f.path).get(original.id)).toEqual(original);
      const edited = await f.store.update(original.id, { ...f.settings, label: 'Edited' }, 1);
      expect(edited).toMatchObject({ label: 'Edited', revision: 2, createdAt: original.createdAt });
      await expect(f.store.update(original.id, f.settings, 1)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_CONFLICT' });
      await expect(f.store.remove(original.id, 1)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_CONFLICT' });
      await f.store.remove(original.id, 2);
      expect(await f.store.list()).toEqual([]);
      await expect(f.store.get(original.id)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_NOT_FOUND' });
    } finally { await f.close(); }
  });

  it('serializes concurrent mutations and never writes Agent configuration', async () => {
    const f = await fixture();
    try {
      const nativeConfig = join(f.directory, 'settings.json');
      const sentinel = '{"env":{"HTTPS_PROXY":"http://user-proxy.invalid:8080"},"permissions":{"mode":"default"}}';
      await writeFile(nativeConfig, sentinel);
      const profiles = await Promise.all(Array.from({ length: 8 }, (_, i) => f.store.create({ ...f.settings, label: `Project ${i}` })));
      expect(new Set(profiles.map(profile => profile.id)).size).toBe(8);
      expect(await f.store.list()).toHaveLength(8);
      expect(await readFile(nativeConfig, 'utf8')).toBe(sentinel);
      if (process.platform !== 'win32') expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    } finally { await f.close(); }
  });

  it('refuses a writer lock without deleting it and recovers after its owner releases it', async () => {
    const f = await fixture();
    try {
      await writeFile(`${f.path}.lock`, 'other owner');
      await expect(f.store.create(f.settings)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_BUSY' });
      expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('other owner');
      await rm(`${f.path}.lock`);
      expect((await f.store.create(f.settings)).revision).toBe(1);
    } finally { await f.close(); }
  });

  it('does not overwrite malformed, unknown-version, oversized or symlinked profile documents', async () => {
    const f = await fixture();
    try {
      for (const text of ['{bad', '{"version":99,"profiles":[]}', 'x'.repeat(262145)]) {
        await writeFile(f.path, text);
        await expect(f.store.create(f.settings)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_INVALID' });
        expect(await readFile(f.path, 'utf8')).toBe(text);
      }
      const target = join(f.directory, 'external.json');
      await writeFile(target, '{"untouched":true}');
      await rm(f.path);
      await symlink(target, f.path);
      await expect(f.store.create(f.settings)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_INVALID' });
      expect(await readFile(target, 'utf8')).toBe('{"untouched":true}');
    } finally { await f.close(); }
  });

  it('bounds records and refuses secret/environment/relative-path fields', async () => {
    const f = await fixture();
    try {
      for (const invalid of [{ ...f.settings, projectDirectory: 'relative' }, { ...f.settings, executable: 'claude' }, { ...f.settings, proxyPort: 0 }, { ...f.settings, env: { API_KEY: 'synthetic' } }, { ...f.settings, agent: 'unknown' }]) {
        await expect(f.store.create(invalid)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_INVALID' });
      }
      for (let i = 0; i < 32; i += 1) await f.store.create({ ...f.settings, label: String(i) });
      await expect(f.store.create(f.settings)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_INVALID' });
      expect(await f.store.list()).toHaveLength(32);
    } finally { await f.close(); }
  });

  it('does not persist an overflowing revision after an otherwise valid stored maximum', async () => {
    const f = await fixture();
    try {
      const profile = await f.store.create(f.settings);
      const maximum = JSON.stringify({ version: 1, profiles: [{ ...profile, revision: Number.MAX_SAFE_INTEGER }] });
      await writeFile(f.path, maximum);
      await expect(f.store.update(profile.id, f.settings, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ code: 'MONITOR_PROFILE_INVALID' });
      expect(await readFile(f.path, 'utf8')).toBe(maximum);
    } finally { await f.close(); }
  });
});

describe('connection recipe', () => {
  it('quotes launcher paths and preserves scope/transport uncertainty, not fabricated Agent readiness', async () => {
    const f = await fixture();
    try {
      const profile = await f.store.create({ ...f.settings, agent: 'codex' });
      const status = { running: false, starting: false, port: null, requestCount: 0, startedAt: null };
      const plan = buildConnectionPlan(profile, { controlUrl: 'http://127.0.0.1:4173', nodePath: "/tmp/a'b/node", cliPath: '/tmp/中文 path/agent-observe.js', caSha256: 'a'.repeat(64), status });
      expect(plan.commands.posix).toContain("'/tmp/a'\"'\"'b/node'");
      expect(plan.commands.posix).toContain("'\"'\"'");
      expect(plan.commands.powershell).toContain("a''b");
      expect(plan.warnings).toEqual(expect.arrayContaining(['process_and_descendants', 'existing_process_unchanged', 'codex_standalone_required', 'transport_unverified']));
      expect(plan.status.running).toBe(false);
      expect(plan.profile).toEqual(profile);
      expect(plan.caCertUrl).toBe('http://127.0.0.1:4173/api/ca-cert');
    } finally { await f.close(); }
  });
});
