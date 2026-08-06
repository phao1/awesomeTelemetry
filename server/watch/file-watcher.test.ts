import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProviderConfig, ProviderKey } from '../../src/core/trace-types.js';
import { startFileWatcher } from './file-watcher.js';

const dirs: string[] = [];

afterEach(() => {
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
    await watcher.ready;
    await waitFor(() => changes.length > 0);
    await watcher.close();
    expect(changes[0]).toBe('trae');
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
    await watcher.ready;
    expect(changes).toHaveLength(0);
    writeFileSync(path, '{}\n{}\n');
    await waitFor(() => changes.length > 0);
    await watcher.close();
    expect(changes).toEqual(['codex']);
  });
});
