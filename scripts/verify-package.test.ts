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
      await copyFile(join(process.cwd(), 'scripts/rsi-package-assets.mjs'), join(root, 'scripts/rsi-package-assets.mjs'));
      await expect(exec(process.execPath, [join(root, 'scripts/verify-package.mjs')], { cwd: root })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Packing never rebuilds') });
      expect(await readdir(root)).toEqual(['scripts']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform === 'win32')('packs the runtime assets into the actual npm tarball and excludes local data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telemetry-pack-tarball-'));
    try {
      await exec('npm', ['pack', '--offline', '--cache', join(root, 'cache'), '--pack-destination', root], { cwd: process.cwd() });
      const archive = (await readdir(root)).find(file => file.endsWith('.tgz'));
      expect(archive).toBeDefined();
      const paths = (await exec('tar', ['-tzf', join(root, archive!)])).stdout.trim().split('\n');
      expect(paths).toEqual(expect.arrayContaining([
        'package/bin/rsi.js',
        'package/bin/task-health.js',
        'package/server-dist/rsi.js',
        'package/server-dist/task-health/cli.js',
        'package/server-dist/telemetry-worker.js',
        'package/scripts/rsi-images/model-proxy.mjs',
        'package/server/rsi/reporters/unittest.py',
        'package/rsi-agents/optimizers/opencode-deepseek/Dockerfile',
        'package/scripts/codex-health-proxy.mjs',
        'package/scripts/claude-monitor-proxy.mjs',
      ]));
      expect(paths.filter(path => /(?:^|\/)(?:rsi-bank(?:-hard)?|hidden_tests|node_modules|awesome-telemetry-data|\.env)(?:\/|$)|\.(?:db|sqlite|pem|key|map)$/.test(path))).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
