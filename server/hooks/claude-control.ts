import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CLAUDE_HOOK_EVENTS } from '../../src/core/claude-hooks.js';
import type { ClaudeHookSettings } from '../../src/core/claude-hooks.js';
import type { ErrorCode } from '../http/error-envelope.js';

export class ClaudeHookError extends Error {
  readonly status: number; readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode) { super(code); this.status = status; this.code = code; }
}
interface State { version: 1; revision: number; enabled: boolean; tokenHash: string | null }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const initial = (): State => ({ version: 1, revision: 0, enabled: false, tokenHash: null });
function state(value: unknown): State {
  const s = value as State;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || typeof s.enabled !== 'boolean' ||
    (s.enabled ? typeof s.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(s.tokenHash) : s.tokenHash !== null) || Object.keys(s).some(key => !['version','revision','enabled','tokenHash'].includes(key))) throw new ClaudeHookError(503, 'HOOK_UNAVAILABLE');
  return s;
}
/** Own app state only. Never reads/writes an Agent's settings or transcript. */
export class ClaudeHookControl {
  private readonly path: string;
  private loaded: Promise<State> | null = null;
  private busy = false;
  constructor(path: string) { this.path = path; }
  private load(): Promise<State> {
    this.loaded ??= (async () => {
      try {
        const info = await lstat(this.path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Invalid control state');
        const handle = await open(this.path, 'r');
        try {
          const current = await handle.stat();
          if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino || current.size > 4096) throw new Error('Invalid control state');
          const buffer = Buffer.alloc(4097); let bytes = 0;
          while (bytes < buffer.length) { const next = await handle.read(buffer, bytes, buffer.length - bytes, null); if (next.bytesRead === 0) break; bytes += next.bytesRead; }
          if (bytes > 4096) throw new Error('Invalid control state');
          return state(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytes))));
        } finally { await handle.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial();
        throw new ClaudeHookError(503, 'HOOK_UNAVAILABLE');
      }
    })().catch(error => { this.loaded = null; throw error; });
    return this.loaded;
  }
  async status(): Promise<{ enabled: boolean; revision: number }> { const s = await this.load(); return { enabled: s.enabled, revision: s.revision }; }
  async authorize(authorization: string | undefined): Promise<void> {
    const s = await this.load();
    if (!s.enabled) throw new ClaudeHookError(409, 'HOOK_DISABLED');
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
    if (!token || !s.tokenHash || !timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(s.tokenHash, 'hex'))) throw new ClaudeHookError(401, 'HOOK_AUTH_REQUIRED');
  }
  async configure(expectedRevision: number, enabled: boolean, port: number, confirmRaw: boolean): Promise<ClaudeHookSettings | null> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof enabled !== 'boolean' || enabled && !confirmRaw || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new ClaudeHookError(400, 'BAD_REQUEST');
    if (this.busy) throw new ClaudeHookError(409, 'HOOK_BUSY');
    this.busy = true;
    let temporary: string | null = null;
    try {
      const current = await this.load();
      if (current.revision !== expectedRevision) throw new ClaudeHookError(409, 'HOOK_CONFLICT');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new ClaudeHookError(503, 'HOOK_LIMIT');
      const token = enabled ? randomBytes(32).toString('base64url') : null;
      const next: State = { version: 1, revision: current.revision + 1, enabled, tokenHash: token ? hash(token) : null };
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      temporary = this.path + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path); temporary = null; this.loaded = Promise.resolve(next);
      if (!token) return null;
      return { hooks: Object.fromEntries(CLAUDE_HOOK_EVENTS.map(event => [event, [{ hooks: [{ type: 'http' as const, url: `http://127.0.0.1:${port}/api/hooks/claude/events`, timeout: 5, headers: { Authorization: 'Bearer ' + token } }] }]])) };
    } catch (error) { if (error instanceof ClaudeHookError) throw error; throw new ClaudeHookError(503, 'HOOK_UNAVAILABLE'); }
    finally { if (temporary) await unlink(temporary).catch(() => undefined); this.busy = false; }
  }
}
