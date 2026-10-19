import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
describe('missing build artifacts never trigger a build', () => {
  it('gives useful CLI guidance before importing an absent server, with no data writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telemetry-missing-cli-'));
    try {
      await mkdir(join(root, 'bin'));
      await copyFile(join(process.cwd(), 'bin/agent-observe.js'), join(root, 'bin/agent-observe.mjs'));
      await expect(exec(process.execPath, [join(root, 'bin/agent-observe.mjs'), 'web'], { cwd: root })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('npm install && npm run build') });
      expect(await readdir(root)).toEqual(['bin']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('refuses packing absent output instead of building it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telemetry-missing-pack-'));
    try {
      await mkdir(join(root, 'scripts'));
      await copyFile(join(process.cwd(), 'scripts/verify-package.mjs'), join(root, 'scripts/verify-package.mjs'));
      await expect(exec(process.execPath, [join(root, 'scripts/verify-package.mjs')], { cwd: root })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Packing never rebuilds') });
      expect(await readdir(root)).toEqual(['scripts']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
