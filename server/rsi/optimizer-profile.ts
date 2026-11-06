import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve, posix } from 'node:path';
import type { DockerClient } from './docker.js';
import { mustDocker } from './docker.js';
import type { AgentPins, RsiAgentProfile } from './agent-profile.js';
import { validateAgentProfile, renderAgentRun } from './agent-profile.js';
import { privateWrite } from './artifacts.js';

export interface RsiOptimizerProfile {
  version: 1; id: string; name: string; description?: string; verified?: boolean; dockerfile: string; family: string;
  run: RsiAgentProfile['run']; session: RsiAgentProfile['session'];
  egress: { kind: 'model-proxy' } | { kind: 'vendor-allowlist'; domains: string[] };
  login: { kind: 'none' } | { kind: 'volume'; path: string; command: string[] };
}
const invalid = (field='profile'): never => { throw new Error(`Invalid optimizer profile: ${field}`); };
export function validateOptimizerProfile(value: unknown): RsiOptimizerProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const p = value as RsiOptimizerProfile;
  const required=['version','id','name','dockerfile','family','run','session','egress','login'];
  const missing=required.find(key=>!Object.hasOwn(p,key));if(missing)invalid(missing);
  if(Object.keys(p).some(key=>![...required,'description','verified'].includes(key)))invalid('profile');
  validateAgentProfile({ version: p.version, id: p.id, name: p.name, dockerfile: p.dockerfile, dependencyInputs: { kind: 'none' }, run: p.run, session: p.session,...(p.description!==undefined?{description:p.description}:{}),...(p.verified!==undefined?{verified:p.verified}:{}) });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(p.family)) invalid('family');
  if (!p.egress)invalid('egress');if(!p.login)invalid('login');
  if (p.egress.kind === 'model-proxy') { if (Object.keys(p.egress).length !== 1) invalid('egress'); }
  else if (p.egress.kind === 'vendor-allowlist') {
    if (Object.keys(p.egress).length !== 2 || !Array.isArray(p.egress.domains) || p.egress.domains.length > 64) invalid('egress.domains');
    for (const d of p.egress.domains) if (typeof d !== 'string' || d.length > 253 || !/^(?=.+\.[a-z]{2,}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(d)) invalid('egress.domains');
  } else invalid('egress');
  if (p.login.kind === 'none') { if (Object.keys(p.login).length !== 1) invalid('login'); }
  else if (p.login.kind === 'volume') {
    if (Object.keys(p.login).length !== 3 || typeof p.login.path !== 'string' || !p.login.path.startsWith('/') || p.login.path === '/' || posix.normalize(p.login.path) !== p.login.path || /[\0\\{}]/.test(p.login.path)
      || !Array.isArray(p.login.command) || !p.login.command.length || p.login.command.some(v => typeof v !== 'string' || !v || /[\0{}]/.test(v))) invalid();
  } else invalid();
  if (Object.keys(p.run.env).some(k => /^RSI_|^(?:HTTP|HTTPS|ALL|NO)_PROXY$/i.test(k))) invalid('run.env');
  return structuredClone(p);
}
export function renderOptimizerRun(p: RsiOptimizerProfile, prompt: string, model: string, apiKey: string): RsiAgentProfile['run'] {
  return renderAgentRun({ version: 1, id: p.id, name: p.name, dockerfile: p.dockerfile, dependencyInputs: { kind: 'none' }, run: p.run, session: p.session }, { statement: prompt, model, apiKey });
}
export async function readOptimizerProfile(file: string): Promise<{ profile: RsiOptimizerProfile; bytes: Buffer; dockerfile: Buffer }> {
  if ((await lstat(file)).isSymbolicLink()) invalid();
  if ((await lstat(file)).size > 1024 * 1024) invalid();
  const bytes = await readFile(file), profile = validateOptimizerProfile(JSON.parse(bytes.toString()));
  let path = dirname(resolve(file));
  for (const part of profile.dockerfile.split('/')) { path = join(path, part); if ((await lstat(path)).isSymbolicLink()) invalid(); }
  if ((await lstat(path)).size > 1024 * 1024) invalid();
  return { profile, bytes, dockerfile: await readFile(path) };
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export async function freezeOptimizerProfile(file: string, directory: string): Promise<AgentPins> {
  const { profile, bytes, dockerfile } = await readOptimizerProfile(file);
  await privateWrite(join(directory, 'profile.json'), bytes); await privateWrite(join(directory, profile.dockerfile), dockerfile);
  return { profileSha256: sha(bytes), dockerfileSha256: sha(dockerfile) };
}
export async function readFrozenOptimizer(directory: string, pins: AgentPins): Promise<RsiOptimizerProfile> {
  const data = await readOptimizerProfile(join(directory, 'profile.json'));
  if (sha(data.bytes) !== pins.profileSha256 || sha(data.dockerfile) !== pins.dockerfileSha256) throw new Error('Frozen optimizer hashes changed');
  return data.profile;
}
export const optimizerVolume = (id: string): string => `rsi-optimizer-login-${id}`;
export async function buildOptimizer(client: DockerClient, directory: string, profile: RsiOptimizerProfile, signal?: AbortSignal): Promise<string> {
  const image = `rsi-optimizer-${profile.id}:${sha(await readFile(join(directory, profile.dockerfile))).slice(0, 16)}`;
  await mustDocker(client, ['build', '-t', image, '-f', join(directory, profile.dockerfile), directory], { signal, timeoutMs: 900000 });
  return image;
}
