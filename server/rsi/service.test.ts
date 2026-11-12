import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultWorkerSettings } from './cli.js';
import { freezeOptimizerProfile } from './optimizer-profile.js';
import { parseServeArgs, serveRsi } from './service.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

interface ServiceEvent { role: string; event: string; argv: string[]; env: string[]; tokenHash: string | null }
const webPort = 42361, monitorPort = 42362;

async function fixture(optimizer = 'opencode-deepseek') {
  const root = await mkdtemp(join(tmpdir(), 'rsi deploy '));
  dirs.push(root);
  const packageRoot = join(root, 'app files'), configRoot = join(root, 'task data');
  const eventLog = join(root, 'events.jsonl');
  for (const dir of ['bin', 'scripts', 'dist', 'server-dist']) await mkdir(join(packageRoot, dir), { recursive: true });
  const childScript = `
const { appendFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const argv = process.argv.slice(2);
const arg = flag => argv[argv.indexOf(flag) + 1];
const token = process.env.PROXY_TOKEN || process.env.RSI_MONITOR_API_KEY;
const event = event => appendFileSync(process.env.RSI_TEST_EVENTS, JSON.stringify({role,event,argv,
  env: ['RSI_UPSTREAM_API_KEY','RSI_MONITOR_API_KEY','PROXY_TOKEN','ANTHROPIC_API_KEY','OPENAI_API_KEY','PROXY_REPLY_DIR','RSI_BANK_ROOT'].filter(key => process.env[key]),
  tokenHash: token ? createHash('sha256').update(token).digest('hex') : null}) + '\\n');
event('start');
if (process.env.RSI_TEST_FAIL === role) process.exit(19);
process.on('SIGTERM', () => { event('stop'); process.exit(0); });
if (role === 'web') console.log('AwesomeTelemetry is running at http://127.0.0.1:' + arg('--port') + '/ (bind 127.0.0.1:' + arg('--port') + ')');
if (role === 'codex') console.log('Codex health proxy: http://127.0.0.1:' + process.env.PROXY_PORT + '/v1 (effort=medium)');
if (role === 'claude') console.log('Claude monitor proxy listening on loopback port ' + process.env.PROXY_PORT);
if (role === 'worker' && token) console.error('fixture key ' + token);
setInterval(() => {}, 1000);
`;
  for (const [role, file] of [['web', 'bin/agent-observe.js'], ['worker', 'bin/rsi.js'],
    ['codex', 'scripts/codex-health-proxy.mjs'], ['claude', 'scripts/claude-monitor-proxy.mjs']] as const) {
    const prelude = file.endsWith('.mjs') ? `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\n` : '';
    await writeFile(join(packageRoot, file), `${prelude}const role = ${JSON.stringify(role)};\n${childScript}`);
  }
  for (const file of ['server-dist/cli.js', 'server-dist/rsi.js', 'dist/index.html']) await writeFile(join(packageRoot, file), '');
  const taskRoot = join(configRoot, 'awesome-telemetry-data/rsi/one/private');
  await mkdir(taskRoot, { recursive: true });
  const settings = defaultWorkerSettings();
  settings.optimizer = await freezeOptimizerProfile(`rsi-agents/optimizers/${optimizer}/profile.json`, join(taskRoot, 'optimizer'));
  await writeFile(join(taskRoot, 'runtime.json'), JSON.stringify(settings));
  const events = async (): Promise<ServiceEvent[]> => {
    try { return (await readFile(eventLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as ServiceEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  const env = { ...process.env, RSI_TEST_EVENTS: eventLog, RSI_TEST_FAIL: undefined, RSI_UPSTREAM_BASE_URL: 'https://upstream.invalid/v1',
    RSI_UPSTREAM_MODEL: 'test-model', RSI_UPSTREAM_API_KEY: 'fixture-upstream-key', RSI_MONITOR_API_KEY: undefined,
    ANTHROPIC_API_KEY: 'fixture-anthropic-key', OPENAI_API_KEY: 'fixture-openai-key', PROXY_TOKEN: 'fixture-old-proxy-key',
    PROXY_REPLY_DIR: join(root, 'unused replies'), RSI_BANK_ROOT: join(root, 'external bank') };
  const network = { probePort: vi.fn(async (_port: number, _flag: string) => {}),
    checkWebHealth: vi.fn(async (_origin: string, _signal: AbortSignal) => { expect(await events()).toMatchObject([{ role: 'web', event: 'start' }]); }) };
  const args = ['--root', configRoot, '--port', String(webPort)];
  const taskArgs = [...args, '--task', 'one', '--execute', '--docker-context', 'colima-rsi'];
  return { packageRoot, configRoot, args, taskArgs, env, network, events };
}

it('starts a page-only service and handles SIGINT without a worker or a monitor', async () => {
  const f = await fixture();
  const info = vi.spyOn(console, 'log').mockImplementation(() => {});
  const running = serveRsi(parseServeArgs(f.args), f.packageRoot, f.env, f.network);
  try { await vi.waitFor(() => expect(info).toHaveBeenCalledWith(`RSI Web is ready at http://127.0.0.1:${webPort}/#/rsi`)); }
  finally { process.emit('SIGINT'); await running; }
  expect(await f.events()).toMatchObject([{ role: 'web', event: 'start', env: ['RSI_BANK_ROOT'] }, { role: 'web', event: 'stop' }]);
  expect(f.network.probePort).toHaveBeenCalledExactlyOnceWith(webPort, '--port');
});

it('starts Codex and a single scoped worker after Web readiness and stops the worker first', async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const running = serveRsi(parseServeArgs([...f.taskArgs, '--monitor-port', String(monitorPort)]), f.packageRoot, f.env, f.network);
  try { await vi.waitFor(() => expect(errors).toHaveBeenCalledWith('fixture key [redacted]')); }
  finally { process.emit('SIGTERM'); await running; }
  const [web, monitor, worker, firstStop] = await f.events();
  expect(web).toMatchObject({ role: 'web', event: 'start', argv: ['web', '--host', '127.0.0.1', '--port', String(webPort), '--config-root', f.configRoot, '--no-open'], env: ['RSI_BANK_ROOT'] });
  expect(monitor).toMatchObject({ role: 'codex', event: 'start', env: ['PROXY_TOKEN', 'RSI_BANK_ROOT'], tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(worker).toMatchObject({ role: 'worker', event: 'start', env: ['RSI_UPSTREAM_API_KEY', 'RSI_MONITOR_API_KEY', 'RSI_BANK_ROOT'], tokenHash: monitor!.tokenHash,
    argv: ['worker', '--execute', '--watch', '--task', 'one', '--root', f.configRoot, '--api-base', `http://127.0.0.1:${webPort}`,
      '--docker-context', 'colima-rsi', '--monitor-base-url', `http://127.0.0.1:${monitorPort}/v1`, '--monitor-family', 'openai', '--monitor-model', 'gpt-6.1-sol'] });
  expect(firstStop).toMatchObject({ role: 'worker', event: 'stop' });
  expect((await f.events()).filter(e => e.event === 'stop').map(e => e.role).sort()).toEqual(['codex', 'web', 'worker']);
  expect(f.network.probePort.mock.calls).toEqual([[webPort, '--port'], [monitorPort, '--monitor-port']]);
});

it('starts the Claude bridge for an OpenAI optimizer with child-only Anthropic credentials', async () => {
  const f = await fixture('codex');
  const running = serveRsi(parseServeArgs(f.taskArgs), f.packageRoot, { ...f.env, RSI_TEST_FAIL: 'worker' }, f.network);
  await expect(running).rejects.toThrow('RSI worker exited (code 19)');
  const events = await f.events();
  expect(events.find(e => e.role === 'claude')).toMatchObject({ event: 'start', env: ['PROXY_TOKEN', 'ANTHROPIC_API_KEY', 'RSI_BANK_ROOT'] });
  expect(events.find(e => e.role === 'worker')).toMatchObject({ env: ['RSI_UPSTREAM_API_KEY', 'RSI_MONITOR_API_KEY', 'RSI_BANK_ROOT'],
    argv: expect.arrayContaining(['http://127.0.0.1:4318/v1', 'anthropic', 'claude-sonnet-4-5']) });
  expect(events.filter(e => e.event === 'stop').map(e => e.role).sort()).toEqual(['claude', 'web']);
});

it('uses an explicit external monitor without starting or probing a bridge', async () => {
  const f = await fixture();
  const args = [...f.taskArgs, '--monitor', 'external', '--monitor-base-url', 'https://reviews.invalid/v1'];
  await expect(serveRsi(parseServeArgs(args), f.packageRoot, f.env, f.network)).rejects.toThrow('RSI_MONITOR_API_KEY');
  await expect(serveRsi(parseServeArgs(args), f.packageRoot, { ...f.env, RSI_MONITOR_API_KEY: 'fixture-external-key', RSI_TEST_FAIL: 'worker' }, f.network)).rejects.toThrow('RSI worker exited');
  expect((await f.events()).map(e => e.role)).toEqual(['web', 'worker', 'web']);
  expect((await f.events())[1]?.argv).toContain('https://reviews.invalid/v1');
  expect(f.network.probePort).toHaveBeenCalledExactlyOnceWith(webPort, '--port');
});

it.each([['web', ['web:start']], ['codex', ['web:start', 'codex:start', 'web:stop']]])('stops startup if %s exits before readiness', async (failed, expected) => {
  const f = await fixture();
  await expect(serveRsi(parseServeArgs(f.taskArgs), f.packageRoot, { ...f.env, RSI_TEST_FAIL: failed }, f.network)).rejects.toThrow('exited (code 19)');
  expect((await f.events()).map(e => `${e.role}:${e.event}`)).toEqual(expected);
});

it('starts nothing when an owned port is occupied', async () => {
  const f = await fixture();
  f.network.probePort.mockRejectedValueOnce(new Error('occupied Web port'));
  await expect(serveRsi(parseServeArgs(f.taskArgs), f.packageRoot, f.env, f.network)).rejects.toThrow('occupied Web port');
  expect(await f.events()).toEqual([]);
});
