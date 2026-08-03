import { exec } from 'node:child_process';
import type { Server } from 'node:http';
import { promisify } from 'node:util';

import { createAgentObservabilityServer } from './server.js';

const DEFAULT_HOST = '127.0.0.1'; // G3.1：默认 host 必须用 127.0.0.1，不能用 localhost
const DEFAULT_PORT = 4173;

export interface CliOptions {
  host: string;
  port: number;
  open: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let open = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--host') {
      host = argv[i + 1] ?? DEFAULT_HOST;
      i += 1;
    } else if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length);
    } else if (arg === '--port') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new Error('--port requires a value');
      }
      port = parsePort(raw);
      i += 1;
    } else if (arg.startsWith('--port=')) {
      port = parsePort(arg.slice('--port='.length));
    } else if (arg === '--no-open') {
      open = false;
    }
  }

  return { host, port, open };
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const options = parseCliArgs(argv);
  const server: Server = createAgentObservabilityServer({});
  await listen(server, options.port, options.host);

  const url = `http://${options.host}:${options.port}/`;
  console.log(`Agent Observability is running at ${url}`);

  if (options.open) {
    await openBrowser(url);
  }
}

function parsePort(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return value;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

const execAsync = promisify(exec);

async function openBrowser(url: string): Promise<void> {
  const command = openCommand(url);
  try {
    await execAsync(command);
  } catch (err) {
    console.warn(
      `Failed to open browser: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function openCommand(url: string): string {
  switch (process.platform) {
    case 'darwin':
      return `open ${url}`;
    case 'win32':
      return `cmd /c start "" ${url}`;
    default:
      return `xdg-open ${url}`;
  }
}
