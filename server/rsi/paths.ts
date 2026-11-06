import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** The package root is where bin/ lives, so RSI works when started from any directory. */
export function rsiPackageRoot(entry: string | undefined = process.argv[1]): string {
  if (!entry) return process.cwd();
  let file: string;
  try { file = realpathSync(entry); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return process.cwd(); throw error; }
  return basename(dirname(file)) === 'bin' ? dirname(dirname(file)) : process.cwd();
}
export function rsiPackagePath(...parts: string[]): string { return join(rsiPackageRoot(), ...parts); }
/** How a person starts the CLI for the data this server is showing. dataRoot is <configRoot>/awesome-telemetry-data/rsi. */
export function rsiCliInfo(dataRoot: string): { bin: string; root: string } {
  return { bin: `node ${rsiPackagePath('bin', 'rsi.js')}`, root: resolve(dataRoot, '..', '..') };
}
