import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/** The package root is where bin/ lives, so RSI works when started from any directory. */
export function rsiPackageRoot(entry: string | undefined = process.argv[1]): string {
  if (!entry) return process.cwd();
  let file: string;
  try { file = realpathSync(entry); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return process.cwd(); throw error; }
  return basename(dirname(file)) === 'bin' ? dirname(dirname(file)) : process.cwd();
}
export function rsiPackagePath(...parts: string[]): string { return join(rsiPackageRoot(), ...parts); }

function configuredDirectory(name: string, fallback: () => string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (value === undefined) return fallback();
  if (!isAbsolute(value) || value.includes('\0')) throw new Error(`${name} must be an absolute directory path`);
  return resolve(value);
}

/** Banks stay outside published packages; source checkouts retain their defaults. */
export function rsiBankRoot(kind: 'standard' | 'hard', env: NodeJS.ProcessEnv = process.env): string {
  const standard = kind === 'standard';
  return configuredDirectory(standard ? 'RSI_BANK_ROOT' : 'RSI_HARD_BANK_ROOT',
    () => rsiPackagePath(standard ? 'rsi-bank' : 'rsi-bank-hard'), env);
}

export function rsiCalibrationRoot(env: NodeJS.ProcessEnv = process.env): string {
  return configuredDirectory('RSI_CALIBRATION_ROOT', () => join(rsiBankRoot('standard', env), 'calibration'), env);
}
/** How a person starts the CLI for the data this server is showing. dataRoot is <configRoot>/awesome-telemetry-data/rsi. */
export function rsiCliInfo(dataRoot: string): { bin: string; root: string; scripts: string } {
  const bin = rsiPackagePath('bin', 'rsi.js').replaceAll("'", "'\\''");
  return { bin: `node '${bin}'`, root: resolve(dataRoot, '..', '..'), scripts: rsiPackagePath('scripts') };
}
