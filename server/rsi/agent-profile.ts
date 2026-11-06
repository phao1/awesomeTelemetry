import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { privateWrite } from './artifacts.js';

export interface RsiAgentProfile {
  version: 1;
  id: string; name: string;
  dockerfile: string;
  dependencyInputs: { kind: 'bun-workspace' } | { kind: 'globs'; include: string[] } | { kind: 'none' };
  run: {
    argv: string[];
    env: Record<string, string>;
    files: { path: string; content: string }[];
  };
  session: { format: 'opencode-db' | 'none'; dir: string };
  l1?: { allowPaths?: string[] };
}
export interface AgentPins { profileSha256: string; dockerfileSha256: string }
const fail = (field: string): never => { throw new Error(`Invalid agent profile: ${field}`); };
function object(v: unknown, field: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(field);
  const o = v as Record<string, unknown>;
  for (const key of required) if (!Object.hasOwn(o, key)) fail(`${field}.${key}`);
  for (const key of Object.keys(o)) if (![...required, ...optional].includes(key)) fail(`${field}.${key}`);
  return o;
}
function string(v: unknown, field: string, empty = false): string {
  if (typeof v !== 'string' || (!empty && !v) || v.includes('\0') || Buffer.byteLength(v) > 1024 * 1024) return fail(field);
  return v;
}
function relative(v: unknown, field: string): string {
  const s = string(v, field);
  if (s.startsWith('/') || /[\\:{}]/.test(s) || s.split('/').some(p => !p || p === '.' || p === '..')) fail(field);
  return s;
}
function absolute(v: unknown, field: string): string {
  const s = string(v, field);
  if (!s.startsWith('/') || s === '/' || s !== posix.normalize(s) || /[\\{}]/.test(s)) fail(field);
  return s;
}
function array(v: unknown, field: string): unknown[] { if (!Array.isArray(v) || v.length > 4096) return fail(field); return v; }
export function globMatcher(pattern: string): RegExp {
  relative(pattern, 'glob');
  if (/[[\]()!+]/.test(pattern)) fail('glob');
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${re}$`);
}
function globs(v: unknown, field: string): void {
  for (const [i, p] of array(v, field).entries()) {
    relative(p, `${field}[${i}]`);
    if (/[[\]()!+]/.test(p as string)) fail(`${field}[${i}]`);
  }
}
const argvKeys = ['statement', 'model'], configKeys = ['baseUrl', 'apiKey', 'model', 'sessionDir'];
function placeholders(value: string, allowed: string[], field: string): void {
  const rest = value.replace(/\{\{([^{}]+)\}\}/g, (_match, key: string) => {
    if (!allowed.includes(key)) fail(`${field}: unknown placeholder ${key}`); return '';
  });
  if (rest.includes('{{')) fail(`${field}: malformed placeholder`);
}
function credentials(value: string, field: string): void {
  if (/\b(?:sk-[a-zA-Z0-9_-]{12,}|Bearer\s+(?!\{\{)[a-zA-Z0-9._-]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)
    || /["']?(?:api[_-]?key|access[_-]?token|secret|password)["']?\s*[:=]\s*["']?(?!\{\{apiKey\}\})([^\s"',}\n]+)/i.test(value.replaceAll('{{apiKey}}', ''))) fail(`${field}: literal credential`);
}
export function validateAgentProfile(value: unknown): RsiAgentProfile {
  const p = object(value, 'profile', ['version', 'id', 'name', 'dockerfile', 'dependencyInputs', 'run', 'session'], ['l1']);
  if (p.version !== 1) fail('version');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(string(p.id, 'id'))) fail('id');
  string(p.name, 'name'); relative(p.dockerfile, 'dockerfile');
  if (p.dockerfile === 'profile.json') fail('dockerfile');
  const d = object(p.dependencyInputs, 'dependencyInputs', ['kind'], ['include']);
  if (!['bun-workspace', 'globs', 'none'].includes(d.kind as string)) fail('dependencyInputs.kind');
  if (d.kind === 'globs') globs(d.include, 'dependencyInputs.include');
  else if (Object.hasOwn(d, 'include')) fail('dependencyInputs.include');
  const r = object(p.run, 'run', ['argv', 'env', 'files']);
  const argv = array(r.argv, 'run.argv'); if (!argv.length) fail('run.argv');
  for (const [i, arg] of argv.entries()) {
    const text = string(arg, `run.argv[${i}]`, i > 0);
    placeholders(text, argvKeys, `run.argv[${i}]`); credentials(text, `run.argv[${i}]`);
    if (i > 0 && /(?:api[-_]?key|token|secret|password)$/i.test(String(argv[i - 1]))) fail(`run.argv[${i}]: credential must use env/files`);
  }
  if (!r.env || typeof r.env !== 'object' || Array.isArray(r.env)) fail('run.env');
  for (const [key, val] of Object.entries(r.env as Record<string, unknown>)) {
    const field = `run.env.${key}`, text = string(val, field, true);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(field);
    placeholders(text, configKeys, field);
    if (/(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(key) && text !== '{{apiKey}}' && text !== '') fail(`${field}: literal credential`);
    credentials(text, field);
  }
  const paths = new Set<string>();
  for (const [i, file] of array(r.files, 'run.files').entries()) {
    const field = `run.files[${i}]`, f = object(file, field, ['path', 'content']);
    const path = absolute(f.path, `${field}.path`); if (paths.has(path)) fail(`${field}.path`); paths.add(path);
    const text = string(f.content, `${field}.content`, true); placeholders(text, configKeys, `${field}.content`); credentials(text, `${field}.content`);
  }
  const s = object(p.session, 'session', ['format', 'dir']);
  if (!['opencode-db', 'none'].includes(s.format as string)) fail('session.format');
  absolute(s.dir, 'session.dir');
  if (p.l1 !== undefined) { const l1 = object(p.l1, 'l1', [], ['allowPaths']); if (l1.allowPaths !== undefined) globs(l1.allowPaths, 'l1.allowPaths'); }
  const scan = (v: unknown, field: string): void => {
    if (typeof v === 'string') credentials(v, field);
    else if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) scan(child, `${field}.${key}`);
  };
  scan(value, 'profile');
  return structuredClone(value) as RsiAgentProfile;
}
export function renderAgentRun(profile: RsiAgentProfile, values: { statement: string; model: string; apiKey: string }): RsiAgentProfile['run'] {
  validateAgentProfile(profile);
  const vars: Record<string, string> = { ...values, baseUrl: 'http://rsi-proxy:8080/v1', sessionDir: profile.session.dir };
  const replace = (s: string): string => s.replace(/\{\{([^{}]+)\}\}/g, (_match, key: string) => vars[key]!);
  return { argv: profile.run.argv.map(replace), env: Object.fromEntries(Object.entries(profile.run.env).map(([k, v]) => [k, replace(v)])),
    files: profile.run.files.map(f => ({ path: f.path, content: replace(f.content) })) };
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export async function readAgentProfile(file: string): Promise<{ profile: RsiAgentProfile; bytes: Buffer; dockerfile: Buffer }> {
  if ((await lstat(file)).isSymbolicLink()) fail('profile file: symbolic link');
  const bytes = await readFile(file); if (bytes.length > 1024 * 1024) fail('profile file: size');
  let value: unknown; try { value = JSON.parse(bytes.toString()); } catch { return fail('profile file: JSON'); }
  const profile = validateAgentProfile(value), root = dirname(resolve(file));
  let path = root;
  for (const part of profile.dockerfile.split('/')) { path = join(path, part); if ((await lstat(path)).isSymbolicLink()) fail('dockerfile: symbolic link'); }
  const dockerfile = await readFile(path); if (dockerfile.length > 1024 * 1024) fail('dockerfile: size');
  const text = dockerfile.toString();
  for (const stage of ['target-node', 'target-python', 'target-go']) if (!new RegExp(`^FROM\\s+.+\\s+AS\\s+${stage}\\s*$`, 'im').test(text)) fail(`dockerfile: missing ${stage}`);
  return { profile, bytes, dockerfile };
}
export async function freezeAgentProfile(file: string, directory: string): Promise<AgentPins> {
  const { profile, bytes, dockerfile } = await readAgentProfile(file);
  await privateWrite(join(directory, 'profile.json'), bytes); await privateWrite(join(directory, profile.dockerfile), dockerfile);
  return { profileSha256: sha(bytes), dockerfileSha256: sha(dockerfile) };
}
export async function readFrozenAgent(directory: string, pins: AgentPins | undefined): Promise<RsiAgentProfile> {
  if (!pins || !/^[a-f0-9]{64}$/.test(pins.profileSha256) || !/^[a-f0-9]{64}$/.test(pins.dockerfileSha256)) throw new Error('Missing/invalid frozen agent hashes');
  const data = await readAgentProfile(join(directory, 'profile.json'));
  if (sha(data.bytes) !== pins.profileSha256 || sha(data.dockerfile) !== pins.dockerfileSha256) throw new Error('Frozen agent hash changed');
  return data.profile;
}
