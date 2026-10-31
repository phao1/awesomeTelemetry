import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { MonitorConnectionPlan, MonitorConnectionProfile, MonitorConnectionSettings, ProxyRuntimeStatus } from '../../src/core/trace-types.js';

const MAX_DOCUMENT = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTINGS = ['label', 'agent', 'projectDirectory', 'executable', 'proxyPort', 'noProxy'];
const PROFILE = [...SETTINGS, 'id', 'revision', 'createdAt', 'updatedAt'];

export class ConnectionProfileError extends Error {
  readonly code: 'MONITOR_PROFILE_NOT_FOUND' | 'MONITOR_PROFILE_CONFLICT' | 'MONITOR_PROFILE_BUSY' | 'MONITOR_PROFILE_INVALID' | 'MONITOR_NOT_READY';
  readonly status: number;
  constructor(code: ConnectionProfileError['code'], message: string, status = 400) {
    super(message); this.name = 'ConnectionProfileError'; this.code = code; this.status = status;
  }
}

function invalid(message: string): never { throw new ConnectionProfileError('MONITOR_PROFILE_INVALID', message); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number, empty = false): value is string { return typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max && !value.includes('\0'); }

export function validateConnectionSettings(value: unknown): MonitorConnectionSettings {
  if (!record(value) || Object.keys(value).length !== SETTINGS.length || Object.keys(value).some(key => !SETTINGS.includes(key))) invalid('Only connection settings fields are accepted; credentials and environment maps are not stored');
  if (!text(value.label, 80) || !['claude', 'codex', 'opencode'].includes(String(value.agent))) invalid('A label and supported terminal CLI agent are required');
  if (!text(value.projectDirectory, 4096) || !isAbsolute(value.projectDirectory)) invalid('projectDirectory must be an absolute path');
  if (value.executable !== null && (!text(value.executable, 4096) || !isAbsolute(value.executable))) invalid('executable must be null or an absolute executable path');
  if (typeof value.proxyPort !== 'number' || !Number.isInteger(value.proxyPort) || value.proxyPort < 1 || value.proxyPort > 65535) invalid('proxyPort must be an integer from 1 to 65535');
  if (value.noProxy !== null && !text(value.noProxy, 2048, true)) invalid('noProxy must be null or a bounded string');
  return { label: value.label, agent: value.agent as MonitorConnectionSettings['agent'], projectDirectory: value.projectDirectory, executable: value.executable as string | null, proxyPort: value.proxyPort, noProxy: value.noProxy as string | null };
}

export function validateProfileId(id: string): void {
  if (!UUID.test(id)) throw new ConnectionProfileError('MONITOR_PROFILE_NOT_FOUND', 'Connection profile not found', 404);
}

export function validateExpectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid('expectedRevision must be a positive safe integer');
  return value;
}

export function validateConnectionProfile(value: unknown): MonitorConnectionProfile {
  if (!record(value) || Object.keys(value).length !== PROFILE.length || Object.keys(value).some(key => !PROFILE.includes(key))) invalid('Invalid stored connection profile fields');
  const settings = Object.fromEntries(SETTINGS.map(key => [key, value[key]]));
  const validated = validateConnectionSettings(settings);
  if (typeof value.id !== 'string' || !UUID.test(value.id)) invalid('Invalid stored connection profile id');
  const revision = validateExpectedRevision(value.revision);
  for (const field of ['createdAt', 'updatedAt']) {
    const stamp = value[field];
    if (typeof stamp !== 'string' || !stamp.endsWith('Z') || !Number.isFinite(Date.parse(stamp))) invalid('Stored profile timestamps must be ISO UTC');
  }
  return { ...validated, id: value.id, revision, createdAt: value.createdAt as string, updatedAt: value.updatedAt as string };
}

/** App recipes only. Never reads or edits ~/.claude, ~/.codex or Agent configs. */
export class ConnectionProfileStore {
  readonly path: string;
  private pending: Promise<void> = Promise.resolve();
  constructor(path: string) { this.path = path; }

  async list(): Promise<MonitorConnectionProfile[]> {
    let file;
    try {
      if ((await lstat(this.path)).isSymbolicLink()) invalid('Stored profiles must not be a symlink');
      file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_DOCUMENT) invalid('Stored profile document exceeds its size/type limit');
      const bytes = Buffer.alloc(MAX_DOCUMENT + 1);
      let size = 0;
      while (size < bytes.length) {
        const read = await file.read(bytes, size, bytes.length - size, size);
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      if (size > MAX_DOCUMENT) invalid('Stored profile document exceeds its size limit');
      const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
      if (!record(document) || document.version !== 1 || !Array.isArray(document.profiles) || document.profiles.length > 32 || Object.keys(document).length !== 2) invalid('Unsupported connection profile document');
      const profiles = document.profiles.map(validateConnectionProfile);
      if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) invalid('Duplicate stored connection profile ids');
      return profiles;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
      throw new ConnectionProfileError('MONITOR_PROFILE_INVALID', 'Stored connection profiles cannot be read safely; preserve the file and repair it before writing', 500);
    } finally { await file?.close(); }
  }

  async get(id: string): Promise<MonitorConnectionProfile> {
    validateProfileId(id);
    const profile = (await this.list()).find(item => item.id === id);
    if (profile === undefined) throw new ConnectionProfileError('MONITOR_PROFILE_NOT_FOUND', 'Connection profile not found', 404);
    return profile;
  }

  create(settings: unknown): Promise<MonitorConnectionProfile> {
    return this.mutate(async profiles => {
      const validated = validateConnectionSettings(settings);
      if (profiles.length >= 32) invalid('At most 32 connection profiles are supported');
      const stamp = new Date().toISOString();
      const profile = { ...validated, id: randomUUID(), revision: 1, createdAt: stamp, updatedAt: stamp };
      profiles.push(profile);
      return profile;
    });
  }

  update(id: string, settings: unknown, expectedRevision: unknown): Promise<MonitorConnectionProfile> {
    return this.mutate(async profiles => {
      const profile = this.match(profiles, id, expectedRevision);
      const changed = { ...validateConnectionSettings(settings), id, revision: profile.revision + 1, createdAt: profile.createdAt, updatedAt: new Date().toISOString() };
      profiles[profiles.indexOf(profile)] = changed;
      return changed;
    });
  }

  remove(id: string, expectedRevision: unknown): Promise<void> {
    return this.mutate(async profiles => {
      const profile = this.match(profiles, id, expectedRevision);
      profiles.splice(profiles.indexOf(profile), 1);
    });
  }

  private match(profiles: MonitorConnectionProfile[], id: string, expectedRevision: unknown): MonitorConnectionProfile {
    validateProfileId(id);
    const revision = validateExpectedRevision(expectedRevision);
    const profile = profiles.find(item => item.id === id);
    if (profile === undefined) throw new ConnectionProfileError('MONITOR_PROFILE_NOT_FOUND', 'Connection profile not found', 404);
    if (profile.revision !== revision) throw new ConnectionProfileError('MONITOR_PROFILE_CONFLICT', 'Connection profile changed; reload before editing or launching', 409);
    return profile;
  }

  private mutate<T>(change: (profiles: MonitorConnectionProfile[]) => Promise<T>): Promise<T> {
    const task = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      let lock;
      try { lock = await open(`${this.path}.lock`, 'wx', 0o600); }
      catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') throw new ConnectionProfileError('MONITOR_PROFILE_BUSY', 'Connection profiles have an active writer; retry. A crash lock needs explicit owner inspection before removal', 409);
        throw error;
      }
      let ownedLock: { dev: number; ino: number } | null = null;
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      let output;
      let temporaryOwned = false;
      let operationError: unknown = null;
      let result: T | undefined;
      try {
        ownedLock = await lock.stat();
        const profiles = await this.list();
        result = await change(profiles);
        profiles.forEach(validateConnectionProfile);
        const document = JSON.stringify({ version: 1, profiles });
        if (Buffer.byteLength(document) > MAX_DOCUMENT) invalid('Connection profiles exceed the 256KiB document limit');
        output = await open(temporary, 'wx', 0o600);
        temporaryOwned = true;
        await output.writeFile(document, 'utf8');
        await output.sync();
        await output.close(); output = undefined;
        await rename(temporary, this.path);
        temporaryOwned = false;
      } catch (error) { operationError = error; }
      let cleanupFailed = false;
      try { await output?.close(); } catch { cleanupFailed = true; }
      try { if (temporaryOwned) await unlink(temporary); } catch { cleanupFailed = true; }
      try { await lock.close(); } catch { cleanupFailed = true; }
      try {
        const currentLock = await lstat(`${this.path}.lock`);
        if (ownedLock !== null && currentLock.dev === ownedLock.dev && currentLock.ino === ownedLock.ino && !currentLock.isSymbolicLink()) await unlink(`${this.path}.lock`);
        else cleanupFailed = true;
      } catch { cleanupFailed = true; }
      if (cleanupFailed) throw new ConnectionProfileError('MONITOR_PROFILE_INVALID', 'Profile write cleanup incomplete; inspect only application-owned temporary/lock files before retrying', 500);
      if (operationError !== null) throw operationError;
      return result as T;
    });
    this.pending = task.then(() => undefined, () => undefined);
    return task;
  }
}

export function buildConnectionPlan(profile: MonitorConnectionProfile, options: { controlUrl: string; nodePath: string; cliPath: string; caSha256: string; status: ProxyRuntimeStatus }): MonitorConnectionPlan {
  const control = new URL(options.controlUrl);
  if (control.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(control.hostname) || control.username !== '' || control.password !== '' || control.pathname !== '/' || control.search !== '' || control.hash !== '') invalid('Control URL must be a local HTTP origin');
  const controlUrl = control.origin;
  const args = [options.nodePath, options.cliPath, 'launch', '--server', controlUrl, '--profile', profile.id, '--revision', String(profile.revision), '--'];
  const posix = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;
  const powershell = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const warnings: MonitorConnectionPlan['warnings'] = ['process_and_descendants', 'existing_process_unchanged', 'shared_listener', 'no_proxy_bypass', 'transport_unverified', 'stop_affects_connected_processes'];
  if (profile.agent === 'codex') warnings.push('codex_standalone_required');
  if (profile.agent === 'opencode') warnings.push('opencode_loopback_bypass');
  return { profile, controlUrl, proxyUrl: `http://127.0.0.1:${profile.proxyPort}`, caCertUrl: `${controlUrl}/api/ca-cert`, caSha256: options.caSha256, commands: { posix: args.map(posix).join(' '), powershell: '& ' + args.map(powershell).join(' ') }, warnings, status: options.status };
}
