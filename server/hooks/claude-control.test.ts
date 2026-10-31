import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE_HOOK_EVENTS } from '../../src/core/claude-hooks.js';
import { ClaudeHookControl } from './claude-control.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'claude-control-')); directories.push(dir); return join(dir, 'control.json'); }
describe('CH-002 persistent explicit receiver configuration', () => {
  it('starts disabled, requires raw acknowledgement and persists only a hash with restrictive permissions', async () => {
    const path = await fixture(), control = new ClaudeHookControl(path);
    expect(await control.status()).toEqual({ enabled: false, revision: 0 });
    await expect(control.authorize(undefined)).rejects.toMatchObject({ code: 'HOOK_DISABLED' });
    await expect(control.configure(0, true, 4188, false)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const settings = (await control.configure(0, true, 4188, true))!;
    expect(Object.keys(settings.hooks)).toEqual([...CLAUDE_HOOK_EVENTS]);
    const config = settings.hooks.PreToolUse![0]!.hooks[0]!;
    expect(config).toEqual({ type: 'http', url: 'http://127.0.0.1:4188/api/hooks/claude/events', timeout: 5, headers: { Authorization: expect.stringMatching(/^Bearer [A-Za-z0-9_-]{43}$/) } });
    const persisted = await readFile(path, 'utf8'); expect(persisted).not.toContain(config.headers.Authorization.slice(7));
    expect(JSON.parse(persisted)).toEqual({ version: 1, revision: 1, enabled: true, tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    await new ClaudeHookControl(path).authorize(config.headers.Authorization);
    await expect(control.authorize('Bearer ' + 'a'.repeat(43))).rejects.toMatchObject({ code: 'HOOK_AUTH_REQUIRED' });
    await expect(control.configure(0, false, 4188, false)).rejects.toMatchObject({ code: 'HOOK_CONFLICT' });
    const rotated = (await control.configure(1, true, 5189, true))!.hooks.Stop![0]!.hooks[0]!;
    expect(rotated.url).toContain(':5189/'); await expect(control.authorize(config.headers.Authorization)).rejects.toMatchObject({ code: 'HOOK_AUTH_REQUIRED' });
    await control.authorize(rotated.headers.Authorization);
    expect(await control.configure(2, false, 5189, false)).toBeNull();
    await expect(new ClaudeHookControl(path).authorize(rotated.headers.Authorization)).rejects.toMatchObject({ code: 'HOOK_DISABLED' });
  });
  it('rejects concurrent configuration instead of applying two revisions', async () => {
    const control = new ClaudeHookControl(await fixture());
    const first = control.configure(0, true, 4188, true);
    await expect(control.configure(0, true, 4188, true)).rejects.toMatchObject({ code: 'HOOK_BUSY' });
    await first; expect(await control.status()).toEqual({ enabled: true, revision: 1 });
  });
  it('refuses malformed, oversized, nonregular and symlink control state without revealing paths', async () => {
    const path = await fixture();
    for (const content of ['{', 'x'.repeat(4097), JSON.stringify({ version: 1, enabled: true, revision: 1, tokenHash: null })]) {
      await writeFile(path, content); await expect(new ClaudeHookControl(path).status()).rejects.toMatchObject({ code: 'HOOK_UNAVAILABLE', message: 'HOOK_UNAVAILABLE' });
    }
    await rm(path); await symlink(join(path, '..'), path); await expect(new ClaudeHookControl(path).status()).rejects.toMatchObject({ code: 'HOOK_UNAVAILABLE' });
  });
});
