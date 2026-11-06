import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freezeAgentProfile, globMatcher, readAgentProfile, readFrozenAgent, renderAgentRun, validateAgentProfile } from './agent-profile.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const mini = resolve('rsi-agents/mini-agent/profile.json');
const sample = async () => (await readAgentProfile(mini)).profile;
describe('RSI-013 Agent profiles', () => {
  it.each(['opencode/profile.json', 'opencode/profile.deepseek.json', 'mini-agent/profile.json'])('validates bundled %s and its stages', async path => {
    expect((await readAgentProfile(resolve('rsi-agents', path))).profile.version).toBe(1);
  });
  it.each([
    ['version', (p: Record<string, unknown>) => { p.version = 2; }],
    ['id', (p: Record<string, unknown>) => { p.id = '../bad'; }],
    ['name', (p: Record<string, unknown>) => { delete p.name; }],
    ['dockerfile', (p: Record<string, unknown>) => { p.dockerfile = '../Dockerfile'; }],
    ['dependencyInputs.include', (p: Record<string, unknown>) => { p.dependencyInputs = { kind: 'globs', include: ['../*'] }; }],
    ['session.dir', (p: Record<string, unknown>) => { p.session = { format: 'none', dir: '/data/../etc' }; }],
    ['run.files[0].path', (p: Record<string, unknown>) => { p.run = { argv: ['node'], env: {}, files: [{ path: 'relative', content: '' }] }; }],
    ['profile.network', (p: Record<string, unknown>) => { p.network = 'bridge'; }],
  ])('reports invalid %s', async (field, mutate) => {
    const p = await sample() as unknown as Record<string, unknown>; mutate(p);
    expect(() => validateAgentProfile(p)).toThrow(field);
  });
  it('uses literal single-pass substitution and no shell or recursive expansion', async () => {
    const p = await sample(); p.run.files = [{ path: '/data/config', content: '{{sessionDir}} {{baseUrl}} {{apiKey}} {{model}}' }];
    const run = renderAgentRun(p, { statement: '$(touch /bad); `x` "{{apiKey}}"', model: 'model with spaces', apiKey: 'temporary' });
    expect(run.argv).toEqual(['node', '/opt/mini-agent/agent.mjs', '$(touch /bad); `x` "{{apiKey}}"']);
    expect(run.env).toEqual({ OPENAI_BASE_URL: 'http://rsi-proxy:8080/v1', OPENAI_API_KEY: 'temporary', OPENAI_MODEL: 'model with spaces' });
    expect(run.files[0]!.content).toBe('/data http://rsi-proxy:8080/v1 temporary model with spaces');
  });
  it.each(['{{missing}}', '{{baseUrl}}', '{{statement', '{{model}'])('rejects unknown/malformed argv placeholder %s', async placeholder => {
    const p = await sample(); p.run.argv.push(placeholder);
    expect(() => validateAgentProfile(p)).toThrow('run.argv');
  });
  it('rejects unknown env/content placeholders and literal credentials without echoing them', async () => {
    const p = await sample(); p.run.env.EXTRA = '{{statement}}'; expect(() => validateAgentProfile(p)).toThrow('run.env.EXTRA');
    delete p.run.env.EXTRA; p.run.files = [{ path: '/data/config', content: '{{unknown}}' }]; expect(() => validateAgentProfile(p)).toThrow('run.files[0].content');
    p.run.files = [{ path: '/data/config', content: '{"apiKey":"private-value"}' }]; expect(() => validateAgentProfile(p)).toThrow('literal credential');
    p.run.files = []; p.run.env.OPENAI_API_KEY = 'private-value'; expect(() => validateAgentProfile(p)).toThrow('run.env.OPENAI_API_KEY: literal credential');
  });
  it('freezes exact bytes and detects profile/Dockerfile tampering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'profile-')); dirs.push(root);
    const pins = await freezeAgentProfile(mini, root), profile = await readFrozenAgent(root, pins);
    expect(await readFile(join(root, 'profile.json'))).toEqual(await readFile(mini));
    expect(profile.id).toBe('mini-agent');
    await writeFile(join(root, 'profile.json'), `${await readFile(mini, 'utf8')} `);
    await expect(readFrozenAgent(root, pins)).rejects.toThrow('hash');
    await writeFile(join(root, 'profile.json'), await readFile(mini));
    await writeFile(join(root, 'target.Dockerfile'), `${await readFile(resolve('rsi-agents/mini-agent/target.Dockerfile'), 'utf8')}\n# altered`);
    await expect(readFrozenAgent(root, pins)).rejects.toThrow('hash');
    await expect(readFrozenAgent(root, undefined)).rejects.toThrow('hashes');
  });
  it('rejects missing stages and Dockerfile links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'profile-')); dirs.push(root);
    const p = await sample(); await writeFile(join(root, 'profile.json'), JSON.stringify(p));
    await writeFile(join(root, 'target.Dockerfile'), 'FROM node:24 AS target-node');
    await expect(readAgentProfile(join(root, 'profile.json'))).rejects.toThrow('target-python');
    await rm(join(root, 'target.Dockerfile')); await symlink(resolve('rsi-agents/mini-agent/target.Dockerfile'), join(root, 'target.Dockerfile'));
    await expect(readAgentProfile(join(root, 'profile.json'))).rejects.toThrow('symbolic link');
  });
  it('matches simple globs deterministically across zero or multiple directories', () => {
    expect(['package.json', 'a/package.json', 'a/b/package.json', 'a/x.json'].filter(p => globMatcher('**/package.json').test(p))).toEqual(['package.json', 'a/package.json', 'a/b/package.json']);
    expect(globMatcher('a/*.?s').test('a/file.js')).toBe(true);
    expect(globMatcher('a/*.js').test('a/b/file.js')).toBe(false);
    expect(() => globMatcher('../*')).toThrow();
  });
});

it('frozen verification precedes every Docker invocation on startup', async () => {
  const { runWorker } = await import('./worker.js'), { defaultWorkerSettings } = await import('./cli.js');
  const root = await mkdtemp(join(tmpdir(), 'startup-profile-')); dirs.push(root);
  const pins = await freezeAgentProfile(mini, join(root, 'private/agent'));
  await writeFile(join(root, 'private/agent/profile.json'), `${await readFile(mini, 'utf8')} `);
  const { RsiStore } = await import('./queue.js'), { openWritable } = await import('../storage/db.js');
  const db = openWritable(join(root, 'index.db')), store = new RsiStore(db, root, 'task');
  const calls: string[][] = [];
  const docker = { run: async (argv: string[]) => { calls.push(argv); throw new Error('Docker must not start'); } };
  try {
    await expect(runWorker(store, { ...defaultWorkerSettings(), agent: pins }, docker, true)).rejects.toThrow('Frozen agent hash changed');
    expect(calls).toEqual([]);
  } finally { db.close(); }
});
it('derives the startup family from pinned optimizer bytes and rejects a spoofed same-family config before Docker',async()=>{
 const {freezeOptimizerProfile}=await import('./optimizer-profile.js'),{runWorker}=await import('./worker.js'),{defaultWorkerSettings}=await import('./cli.js'),{RsiStore}=await import('./queue.js'),{openWritable}=await import('../storage/db.js');
 const root=await mkdtemp(join(tmpdir(),'startup-review-family-'));dirs.push(root);const settings=defaultWorkerSettings();
 settings.agent=await freezeAgentProfile(mini,join(root,'private/agent'));settings.optimizer=await freezeOptimizerProfile(resolve('rsi-agents/optimizers/codex/profile.json'),join(root,'private/optimizer'));
 settings.reviews={optimizerFamily:'deepseek',monitorFamily:'openai'};
 const db=openWritable(join(root,'index.db')),store=new RsiStore(db,root,'task');let calls=0;
 try{
  await expect(runWorker(store,settings,{run:async()=>{calls++;throw new Error('Docker must not run');}},true)).rejects.toThrow('scripts/claude-monitor-proxy.mjs');expect(calls).toBe(0);
 }finally{db.close();}
});
