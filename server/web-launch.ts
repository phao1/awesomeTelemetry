import { execFile } from 'node:child_process';
import { isIP } from 'node:net';

/** Accept a hostname/address, never URL syntax or shell fragments. */
export function validateBindHost(host: string): string {
  if (isIP(host) !== 0 || (host.length <= 253 && host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part)))) return host;
  throw new Error('Invalid --host: use a hostname or an unbracketed IP address');
}

export function webUrl(host: string, port: number): string {
  validateBindHost(host);
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}/`;
}

/** Only inherited process environment controls SSH browser suppression. */
export function launchedThroughSsh(env: NodeJS.ProcessEnv = process.env): boolean {
  return Object.entries(env).some(([key, value]) => /^(SSH_CONNECTION|SSH_TTY)$/i.test(key) && Boolean(value?.trim()));
}

export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Browser URL must be a plain HTTP server origin');
  switch (platform) {
    case 'darwin': return { file: '/usr/bin/open', args: [url] };
    case 'win32': return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
    default: return { file: 'xdg-open', args: [url] };
  }
}

/** No shell, no interpolation. Failure leaves the running server usable. */
export async function openBrowser(url: string): Promise<void> {
  const { file, args } = browserCommand(url);
  await new Promise<void>((resolve, reject) => {
    execFile(file, args, { timeout: 10_000, windowsHide: true }, error => error === null ? resolve() : reject(error));
  });
}

/** Called only after the HTTP listener is ready. */
export async function handoffBrowser(url: string, requested: boolean, env: NodeJS.ProcessEnv = process.env,
  opener: (url: string) => Promise<void> = openBrowser, warn: (message: string) => void = console.warn): Promise<void> {
  if (!requested || launchedThroughSsh(env)) return;
  try { await opener(url); }
  catch { warn(`Could not open the default browser. Open ${url} manually; the server is still running.`); }
}
