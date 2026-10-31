import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProviderConfig, ProviderKey } from '../../src/core/trace-types.js';
import { startFileWatcher, type FileWatcherHandle } from './file-watcher.js';

const dirs: string[] = [];
const watchers: FileWatcherHandle[] = [];

afterEach(async () => {
  // A failed assertion must not leave native handles observing later tests.
  await Promise.all(watchers.splice(0).map(watcher => watcher.close()));
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitFor(fn: () => boolean, timeoutMs = 2500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timeout');
}

function provider(over: Partial<ProviderConfig>): ProviderConfig {
  return {
    key: 'trae',
    enabled: true,
    path: '/none',
    sourceKind: 'sqlcipher',
    watchStrategy: 'poll',
    pollIntervalMs: 30_000,
    label: 'Trae',
    ...over,
  };
}

describe('file watcher（session-scanning REQ-017）', () => {
  it('poll provider 按配置间隔触发并可关闭', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'watch-poll-'));
    dirs.push(dir);
    const changes: ProviderKey[] = [];
    const watcher = startFileWatcher(
      [provider({ path: dir, pollIntervalMs: 15 })],
      (key) => { changes.push(key); },
    );
    watchers.push(watcher);
    await watcher.ready;
    await waitFor(() => changes.length > 0);
    await watcher.close();
    expect(changes[0]).toBe('trae');
  });

  it('poll provider 在注册前展开默认 ~ 路径', async () => {
    const dir = mkdtempSync(join(homedir(), '.watch-poll-home-'));
    dirs.push(dir);
    const changes: ProviderKey[] = [];
    const watcher = startFileWatcher(
      [provider({
        key: 'codearts',
        path: `~/${basename(dir)}`,
        sourceKind: 'sqlite',
        pollIntervalMs: 15,
      })],
      (key) => { changes.push(key); },
    );
    watchers.push(watcher);
    await watcher.ready;
    await waitFor(() => changes.length > 0);
    await watcher.close();
    expect(changes[0]).toBe('codearts');
  });

  it('chokidar provider 忽略初始文件，并在变化稳定后防抖触发', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'watch-chokidar-'));
    dirs.push(dir);
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, '{}\n');
    const changes: ProviderKey[] = [];
    const watcher = startFileWatcher(
      [provider({
        key: 'codex',
        path: dir,
        sourceKind: 'jsonl',
        watchStrategy: 'chokidar',
        pollIntervalMs: 0,
      })],
      (key) => { changes.push(key); },
    );
    watchers.push(watcher);
    await watcher.ready;
    expect(changes).toHaveLength(0);
    writeFileSync(path, '{}\n{}\n');
    await waitFor(() => changes.length > 0);
    await watcher.close();
    expect(changes).toEqual(['codex']);
  });

  it('watches a hidden Agent root while ignoring hidden descendants', async () => {
    const dir = mkdtempSync(join(tmpdir(), '.watch-agent-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.cache'));
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, '{}\n');
    const changes: ProviderKey[] = [];
    const watcher = startFileWatcher([provider({ key: 'codex', path: dir, watchStrategy: 'chokidar', sourceKind: 'jsonl' })], key => { changes.push(key); });
    watchers.push(watcher);
    await watcher.ready;
    expect(changes).toEqual([]);
    writeFileSync(join(dir, '.ignored.jsonl'), '{}\n');
    writeFileSync(join(dir, '.cache', 'hidden.jsonl'), '{}\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(changes).toEqual([]);
    writeFileSync(path, '{}\n{}\n');
    await waitFor(() => changes.length > 0);
    expect(changes).toEqual(['codex']);
  });
});
