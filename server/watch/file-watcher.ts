import { existsSync, realpathSync, type Stats } from 'node:fs';
import { relative } from 'node:path';

import { watch, type FSWatcher } from 'chokidar';

import type { ProviderConfig, ProviderKey } from '../../src/core/trace-types.js';
import { expandLocalSessionPath } from '../../local-sessions/config.js';

export interface FileWatcherHandle {
  /** chokidar providers have completed their initial, ignored discovery pass. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * session-scanning REQ-017: JSONL providers use chokidar; WAL-backed providers
 * use timed polling so a change confined to `-wal` still reaches the scanner's
 * dual-file fingerprint gate.
 */
export function startFileWatcher(
  providers: readonly ProviderConfig[],
  onProviderChange: (provider: ProviderKey) => void | Promise<void>,
  onError: (error: unknown) => void = (error) => console.error('[watch]', error),
): FileWatcherHandle {
  const intervals: NodeJS.Timeout[] = [];
  const debounceTimers = new Map<ProviderKey, NodeJS.Timeout>();
  const watchers: FSWatcher[] = [];
  const readyPromises: Promise<void>[] = [];
  const active = new Set<ProviderKey>();
  const queued = new Set<ProviderKey>();
  let closed = false;

  const run = async (provider: ProviderKey): Promise<void> => {
    if (closed) return;
    if (active.has(provider)) {
      queued.add(provider);
      return;
    }
    active.add(provider);
    try {
      do {
        queued.delete(provider);
        await onProviderChange(provider);
      } while (!closed && queued.has(provider));
    } catch (error) {
      onError(error);
    } finally {
      active.delete(provider);
    }
  };

  for (const provider of providers) {
    const providerPath = expandLocalSessionPath(provider.path);
    if (!provider.enabled || !existsSync(providerPath)) continue;
    if (provider.watchStrategy === 'poll') {
      const intervalMs = provider.pollIntervalMs > 0 ? provider.pollIntervalMs : 30_000;
      const timer = setInterval(() => { void run(provider.key); }, intervalMs);
      timer.unref();
      intervals.push(timer);
      continue;
    }

    // Watch the canonical root: macOS /var -> /private/var aliases can lose
    // the first write after discovery. Agent roots such as ~/.codex are
    // intentionally hidden; only descendants are subject to the dotfile rule.
    let watchRoot: string;
    try { watchRoot = realpathSync(providerPath); }
    catch (error) { onError(error); continue; }
    let discovered = false;
    const observed = new Map<string, { size: number; mtimeMs: number; ctimeMs: number }>();
    const watcher = watch(watchRoot, {
      ignoreInitial: true,
      alwaysStat: true,
      ignored: (path, stats) => {
        if (/(^|[/\\])\../.test(relative(watchRoot, path))) return true;
        if (!discovered && stats?.isFile()) observed.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs });
        return false;
      },
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    watchers.push(watcher);
    readyPromises.push(new Promise<void>((resolve) => { watcher.once('ready', () => { discovered = true; resolve(); }); }));
    const schedule = (): void => {
      const previous = debounceTimers.get(provider.key);
      if (previous !== undefined) clearTimeout(previous);
      const timer = setTimeout(() => {
        debounceTimers.delete(provider.key);
        void run(provider.key);
      }, 300);
      timer.unref();
      debounceTimers.set(provider.key, timer);
    };
    const changed = (path: string, stats?: Stats): void => {
      if (stats?.isDirectory()) return;
      const previous = observed.get(path);
      if (stats !== undefined) {
        observed.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs });
        // Native events queued during discovery can arrive after ready. They
        // are not new writes when all observed metadata fields are unchanged.
        // ctime also catches same-size rewrites that restore the old mtime.
        if (previous?.size === stats.size && previous.mtimeMs === stats.mtimeMs && previous.ctimeMs === stats.ctimeMs) return;
      }
      schedule();
    };
    watcher.on('add', changed).on('change', changed).on('unlink', path => { observed.delete(path); schedule(); });
    watcher.on('error', onError);
  }

  return {
    ready: Promise.all(readyPromises).then(() => undefined),
    async close(): Promise<void> {
      closed = true;
      for (const timer of intervals) clearInterval(timer);
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      await Promise.all(watchers.map(async (watcher) => watcher.close()));
    },
  };
}
