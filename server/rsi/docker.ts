import { spawn } from 'node:child_process';

export interface CommandOptions {
  input?: Buffer | string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}
export interface CommandResult {
  code: number | null; stdout: Buffer; stderr: Buffer;
  timedOut: boolean; cancelled: boolean; overflow: boolean;
}
export interface DockerClient {
  run(argv: string[], options?: CommandOptions): Promise<CommandResult>;
}

/** No shell, bounded combined output, deadline and cancellation for every process. */
export async function runProcess(executable: string, argv: string[], options: CommandOptions = {}): Promise<CommandResult> {
  const timeout = options.timeoutMs ?? 120_000, limit = options.maxOutputBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid process limits');
  if (options.signal?.aborted) return { code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, cancelled: true, overflow: false };
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { shell: false, detached: process.platform !== 'win32', cwd: options.cwd,
      env: options.env ?? { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, DOCKER_CONFIG: process.env.DOCKER_CONFIG }, stdio: ['pipe', 'pipe', 'pipe'] });
    let timedOut = false, cancelled = false, overflow = false, size = 0;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const kill = (): void => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const abort = (): void => { cancelled = true; kill(); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    options.signal?.addEventListener('abort', abort, { once: true });
    const clean = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    const collect = (chunks: Buffer[]) => (raw: Buffer): void => {
      size += raw.length;
      if (size > limit) { overflow = true; kill(); return; }
      chunks.push(raw);
    };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') kill(); });
    child.on('error', () => { clean(); reject(new Error(`Cannot start ${executable}`)); });
    child.on('close', code => { clean(); resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut, cancelled, overflow }); });
    child.stdin.end(options.input);
  });
}

export class CliDockerClient implements DockerClient {
  readonly context: string | null;
  constructor(context: string | null = null) { this.context = context; }
  run(argv: string[], options?: CommandOptions): Promise<CommandResult> {
    return runProcess('docker', [...(this.context ? ['--context', this.context] : []), ...argv], options);
  }
}
export function successful(result: CommandResult): boolean {
  return result.code === 0 && !result.timedOut && !result.cancelled && !result.overflow;
}
export async function mustDocker(client: DockerClient, argv: string[], options?: CommandOptions): Promise<Buffer> {
  const result = await client.run(argv, options);
  if (!successful(result)) {
    const detail = result.stderr.toString('utf8').trim().slice(-400);
    throw new Error(`Docker ${argv[0]} failed (${result.timedOut ? 'timeout' : result.cancelled ? 'cancelled' : result.overflow ? 'output_limit' : result.code})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

export const RSI_LABEL = 'awesome-telemetry.rsi';
export function isolationArgs(network: string, taskId: string, name: string, memory = '1100m'): string[] {
  return ['--name', name, '--label', `${RSI_LABEL}=${taskId}`, '--network', network,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', memory,
    '--cpus', '1', '--pids-limit', '256'];
}
