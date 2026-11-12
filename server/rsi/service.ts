import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { readFrozenOptimizer } from './optimizer-profile.js';
import { upstreamEnvironment } from './proxy-run.js';
import { boundedJson } from './reader.js';
import { resolveReviewSettings } from './review.js';
import type { ReviewSettings } from './review.js';
import { validateWorkerSettings } from './worker.js';
import type { WorkerSettings } from './worker.js';

const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const monitorFlags = {
  '--monitor-base-url': 'monitorBaseUrl', '--monitor-family': 'monitorFamily', '--monitor-model': 'monitorModel',
} as const;

interface ServeOptions {
  root: string;
  port: number;
  taskId: string | null;
  dockerContext: string | null;
  monitor: 'auto' | 'external';
  monitorPort: number | null;
  monitorOverrides: Partial<ReviewSettings>;
}

function parsePort(flag: string, value: string): number {
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65_535) throw new Error(`${flag} must be a port from 1 to 65535`);
  return Number(value);
}

export function parseServeArgs(args: readonly string[]): ServeOptions {
  const allowed = new Set(['--root', '--port', '--task', '--docker-context', '--monitor', '--monitor-port', ...Object.keys(monitorFlags)]);
  const flags = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--execute' && !execute) { execute = true; continue; }
    const value = args[++i];
    if (!allowed.has(flag) || flags.has(flag) || !value?.trim() || value.startsWith('--')) throw new Error('Invalid rsi serve arguments. Use rsi --help.');
    flags.set(flag, value);
  }

  const taskId = flags.get('--task') ?? null;
  if (taskId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw new Error('Invalid task ID');
  if ((taskId !== null) !== execute) throw new Error('rsi serve requires --task and --execute together');
  if (!execute && [...flags.keys()].some(flag => flag !== '--root' && flag !== '--port')) throw new Error('Worker and monitor options require --task and --execute');
  const monitor = flags.get('--monitor') ?? 'auto';
  if (monitor !== 'auto' && monitor !== 'external') throw new Error('--monitor must be auto or external');
  if (monitor === 'external' && flags.has('--monitor-port')) throw new Error('--monitor-port is for an owned bridge. Set --monitor-base-url for an external monitor.');
  const monitorOverrides: Partial<ReviewSettings> = {};
  for (const [flag, key] of Object.entries(monitorFlags)) {
    const value = flags.get(flag);
    if (value === undefined) continue;
    if (monitor !== 'external') throw new Error(`${flag} requires --monitor external`);
    monitorOverrides[key] = value;
  }
  const port = parsePort('--port', flags.get('--port') ?? '4173');
  const rawMonitorPort = flags.get('--monitor-port');
  return { root: resolve(flags.get('--root') ?? process.cwd()), port, taskId,
    dockerContext: flags.get('--docker-context') ?? null, monitor,
    monitorPort: rawMonitorPort === undefined ? null : parsePort('--monitor-port', rawMonitorPort), monitorOverrides };
}

interface ChildSpec {
  name: 'Web' | 'monitor' | 'worker';
  argv: string[];
  env: NodeJS.ProcessEnv;
  readyLine?: (line: string) => boolean;
}

function baseEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of ['RSI_UPSTREAM_BASE_URL', 'RSI_UPSTREAM_MODEL', 'RSI_UPSTREAM_API_KEY', 'RSI_MONITOR_API_KEY',
    'PROXY_TOKEN', 'PROXY_REPLY_DIR', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'HEALTH_MODEL_API_KEY']) delete result[key];
  return result;
}

async function taskChildren(options: ServeOptions, taskId: string, packageRoot: string, origin: string, env: NodeJS.ProcessEnv) {
  const taskRoot = join(options.root, 'awesome-telemetry-data', 'rsi', taskId);
  let settings: WorkerSettings;
  try { settings = validateWorkerSettings(await boundedJson(taskRoot, 'private/runtime.json') as WorkerSettings); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Task ${taskId} was not found under --root ${options.root}. Create it before starting a worker.`, { cause: error });
    throw error;
  }
  if (!settings.optimizer) throw new Error('The task requires a frozen optimizer profile for monitor selection');
  const optimizer = await readFrozenOptimizer(join(taskRoot, 'private/optimizer'), settings.optimizer);
  const reviews = resolveReviewSettings(optimizer.family, { ...settings.reviews, ...options.monitorOverrides });
  const upstream = settings.proxy.mode === 'real' ? upstreamEnvironment(env) : {};
  const childEnv = baseEnvironment(env);
  const token = env.RSI_MONITOR_API_KEY?.trim() || (options.monitor === 'auto' ? randomBytes(32).toString('hex') : '');
  if (!token) throw new Error('Set RSI_MONITOR_API_KEY before starting with --monitor external');

  let monitor: ChildSpec | null = null;
  let monitorPort: number | null = null;
  if (options.monitor === 'auto') {
    const endpoint = new URL(reviews.monitorBaseUrl);
    const claude = reviews.monitorFamily === 'anthropic';
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== HOST || !['/v1', '/v1/'].includes(endpoint.pathname)
      || (!claude && reviews.monitorFamily !== 'openai')) throw new Error('This task uses a custom monitor. Use --monitor external and configure RSI_MONITOR_API_KEY.');
    monitorPort = options.monitorPort ?? Number(endpoint.port || '80');
    if (monitorPort === options.port) throw new Error('--port and the monitor port must differ');
    reviews.monitorBaseUrl = `http://${HOST}:${monitorPort}/v1`;
    if (claude && !env.ANTHROPIC_API_KEY?.trim()) throw new Error('Set ANTHROPIC_API_KEY before starting the Claude monitor bridge');
    const script = claude ? 'claude-monitor-proxy.mjs' : 'codex-health-proxy.mjs';
    const ready = claude ? `Claude monitor proxy listening on loopback port ${monitorPort}` : `Codex health proxy: ${reviews.monitorBaseUrl} (effort=`;
    monitor = { name: 'monitor', argv: [join(packageRoot, 'scripts', script)],
      env: { ...childEnv, PROXY_PORT: String(monitorPort), PROXY_TOKEN: token, ...(claude ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}) },
      readyLine: line => claude ? line === ready : line.startsWith(ready) && line.endsWith(')') };
  }

  const worker: ChildSpec = { name: 'worker', argv: [join(packageRoot, 'bin', 'rsi.js'), 'worker', '--execute', '--watch',
    '--task', taskId, '--root', options.root, '--api-base', origin,
    ...(options.dockerContext === null ? [] : ['--docker-context', options.dockerContext]),
    '--monitor-base-url', reviews.monitorBaseUrl, '--monitor-family', reviews.monitorFamily, '--monitor-model', reviews.monitorModel],
    env: { ...childEnv, ...upstream, RSI_MONITOR_API_KEY: token } };
  return { monitor, monitorPort, worker, token };
}

async function probePort(port: number, flag: string): Promise<void> {
  await new Promise<void>((done, reject) => {
    const socket = createServer();
    socket.once('error', (error: NodeJS.ErrnoException) => reject(new Error(`Cannot bind ${HOST}:${port} (${error.code}). Choose a free ${flag}.`)));
    socket.listen(port, HOST, () => socket.close(error => error ? reject(error) : done()));
  });
}

interface ManagedChild {
  name: ChildSpec['name'];
  process: ChildProcess;
  ready: Promise<void>;
  closed: Promise<void>;
  exited: boolean;
}

function startChild(spec: ChildSpec, reportExit: (message: string) => void, redact: (text: string) => string): ManagedChild {
  const child = spawn(process.execPath, spec.argv, { shell: false, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', windowsHide: true });
  const managed: ManagedChild = { name: spec.name, process: child, ready: Promise.resolve(), closed: Promise.resolve(), exited: false };
  managed.ready = new Promise<void>(done => {
    createInterface({ input: child.stdout }).on('line', line => {
      console.log(redact(line));
      if (spec.readyLine?.(line)) done();
    });
  });
  createInterface({ input: child.stderr }).on('line', line => console.error(redact(line)));
  managed.closed = new Promise<void>(done => child.once('close', () => done()));
  child.once('exit', (code, signal) => {
    managed.exited = true;
    reportExit(`RSI ${spec.name} exited (${signal ?? `code ${code}`}).`);
  });
  child.once('error', error => {
    managed.exited = true;
    reportExit(redact(`Could not start RSI ${spec.name}: ${error.message}`));
  });
  return managed;
}

async function waitForReady(child: ManagedChild, signal: AbortSignal): Promise<void> {
  const timer = new AbortController();
  try {
    await Promise.race([child.ready, delay(START_TIMEOUT_MS, undefined, { signal: AbortSignal.any([timer.signal, signal]) }).then(() => {
      throw new Error(`Timed out waiting for RSI ${child.name} to listen`);
    })]);
    signal.throwIfAborted();
  } finally { timer.abort(); }
}

async function checkWebHealth(origin: string, signal: AbortSignal): Promise<void> {
  await new Promise<void>((done, reject) => {
    const request = get(`${origin}/api/health`, { agent: false, signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) }, response => {
      response.resume();
      if (response.statusCode === 200) done();
      else reject(new Error(`RSI Web health check failed (HTTP ${response.statusCode})`));
    });
    request.once('error', reject);
  });
}

async function waitForClose(child: ManagedChild, timeoutMs: number): Promise<boolean> {
  const timer = new AbortController();
  try { return await Promise.race([child.closed.then(() => true), delay(timeoutMs, false, { signal: timer.signal })]); }
  finally { timer.abort(); }
}

function signalChild(child: ManagedChild, signal: NodeJS.Signals): void {
  const pid = child.process.pid;
  if (!pid) return;
  try {
    if (child.name === 'monitor' && process.platform !== 'win32') process.kill(-pid, signal);
    else if (!child.exited) child.process.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function stopChild(child: ManagedChild | undefined): Promise<void> {
  if (!child) return;
  signalChild(child, 'SIGTERM');
  if (await waitForClose(child, STOP_TIMEOUT_MS)) {
    // The bridge can have a Codex subprocess in its own process group.
    if (child.name === 'monitor') signalChild(child, 'SIGKILL');
    return;
  }
  signalChild(child, 'SIGKILL');
  if (!await waitForClose(child, KILL_TIMEOUT_MS)) throw new Error(`RSI ${child.name} did not stop. Check the owned PID ${child.process.pid}.`);
  throw new Error(`RSI ${child.name} exceeded its shutdown deadline and was stopped by SIGKILL.`);
}

export async function serveRsi(options: ServeOptions, packageRoot: string, env = process.env,
  network = { probePort, checkWebHealth }): Promise<void> {
  const origin = `http://${HOST}:${options.port}`;
  const shutdown = new AbortController();
  const signal = shutdown.signal;
  const interrupt = Symbol('local shutdown');
  const onSignal = (): void => shutdown.abort(interrupt);
  const reportExit = (message: string): void => shutdown.abort(new Error(message));
  let web: ManagedChild | undefined, monitor: ManagedChild | undefined, worker: ManagedChild | undefined;
  const errors: unknown[] = [];
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const task = options.taskId === null ? null : await taskChildren(options, options.taskId, packageRoot, origin, env);
    try {
      await Promise.all(['bin/agent-observe.js', 'server-dist/cli.js', 'dist/index.html', ...(task ? ['bin/rsi.js', 'server-dist/rsi.js'] : [])]
        .map(path => access(join(packageRoot, path))));
    } catch { throw new Error('RSI Web build is missing. Run npm run build from the source checkout or reinstall a complete package.'); }
    if (task?.monitor) {
      try { await access(task.monitor.argv[0]!); }
      catch { throw new Error('RSI monitor bridge is missing from the package. Use a complete checkout or --monitor external.'); }
    }
    await network.probePort(options.port, '--port');
    if (task?.monitorPort != null) await network.probePort(task.monitorPort, '--monitor-port');
    signal.throwIfAborted();
    const secrets = [task?.token, env.RSI_UPSTREAM_API_KEY, env.RSI_MONITOR_API_KEY, env.ANTHROPIC_API_KEY,
      env.OPENAI_API_KEY, env.PROXY_TOKEN, env.HEALTH_MODEL_API_KEY].filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length);
    const redact = (text: string): string => secrets.reduce((line, key) => line.replaceAll(key, '[redacted]'), text);
    web = startChild({ name: 'Web', argv: [join(packageRoot, 'bin', 'agent-observe.js'), 'web', '--host', HOST,
      '--port', String(options.port), '--config-root', options.root, '--no-open'], env: baseEnvironment(env),
      readyLine: line => line === `AwesomeTelemetry is running at ${origin}/ (bind ${HOST}:${options.port})` }, reportExit, redact);
    await waitForReady(web, signal);
    await network.checkWebHealth(origin, signal);
    if (task?.monitor) {
      signal.throwIfAborted();
      monitor = startChild(task.monitor, reportExit, redact);
      await waitForReady(monitor, signal);
    }
    signal.throwIfAborted();
    console.log(`RSI Web is ready at ${origin}/#/rsi`);
    if (task) {
      worker = startChild(task.worker, reportExit, redact);
      console.log(`RSI worker starting for task ${options.taskId}${task.monitor ? '' : ' with an external monitor'}.`);
    }
    if (!signal.aborted) await new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
  } catch (error) { if (!signal.aborted) errors.push(error); }
  finally {
    // Let the worker finish cancellation and accounting while its services are still available.
    if (signal.aborted && signal.reason !== interrupt) errors.push(signal.reason);
    try { await stopChild(worker); } catch (error) { errors.push(error); }
    const remainingStops = await Promise.allSettled([stopChild(monitor), stopChild(web)]);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    for (const result of remainingStops) if (result.status === 'rejected') errors.push(result.reason);
  }
  if (errors.length > 0) throw new Error(errors.map(error => error instanceof Error ? error.message : String(error)).join('\n'));
}
