import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { calibrateCommand, monitorCommand, serveCommand, workerCommand } from './data.js';

const cli = { bin: "node '/package space/bin/rsi.js'", root: "/config ' $(printf expanded)", scripts: "/pkg ' $(printf expanded)/scripts" };
async function argumentsOf(command: string): Promise<string[]> {
  const { stdout } = await promisify(execFile)('/bin/sh', ['-c', 'node() { printf "%s\\0" "$PROXY_TOKEN" "$@"; }; ' + command],
    { env: { ...process.env, RSI_MONITOR_API_KEY: 'literal $token with spaces', PROXY_TOKEN: '' } });
  return stdout.split('\0').slice(0, -1);
}
it('preserves task and configuration paths as single arguments without shell expansion', async () => {
  const task = "task ' $(printf expanded)";
  expect(await argumentsOf(workerCommand(cli, task))).toEqual(['', '/package space/bin/rsi.js', 'worker', '--execute', '--watch', '--task', task, '--root', cli.root, '--docker-context', 'colima-rsi']);
  expect(await argumentsOf(calibrateCommand(cli, task))).toEqual(['', '/package space/bin/rsi.js', 'calibrate', '--task', task, '--root', cli.root]);
  expect(await argumentsOf(serveCommand(cli, task, 4188))).toEqual(['', '/package space/bin/rsi.js', 'serve', '--task', task, '--execute', '--root', cli.root, '--port', '4188', '--docker-context', 'colima-rsi']);
});
it.each([['openai', 'claude-monitor-proxy.mjs'], ['deepseek', 'codex-health-proxy.mjs']] as const)('quotes %s monitor paths and passes the bearer literally through the environment', async (family, script) => {
  expect(await argumentsOf(monitorCommand(cli, family))).toEqual(['literal $token with spaces', cli.scripts + '/' + script]);
});
