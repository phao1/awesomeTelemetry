#!/usr/bin/env bash
# Run inside target; no secrets or response bodies in output. One JSON per check.
set -euo pipefail
: "${RSI_HOST_PORT:?Set host loopback sentinel port}"
: "${RSI_HOST_CANARY:?Set an absolute host-only canary file path}"
: "${RSI_PROXY_URL:=http://rsi-proxy:8080/health}"
for required in node curl ip; do
  command -v "$required" >/dev/null || { printf '%s\n' '{"name":"tools","expected":"node,curl,ip installed","actual":"missing tool","pass":false}'; exit 1; }
done
export RSI_HOST_PORT RSI_HOST_CANARY RSI_PROXY_URL
node --input-type=module <<'JS'
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
function cmd(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args);
    let out = '';
    child.stdout.on('data', b => { out += b; });
    child.on('error', () => resolve({ code: -1, out: '' }));
    child.on('close', code => resolve({ code, out }));
  });
}
function emit(name, expected, actual) { console.log(JSON.stringify({ name, expected, actual, pass: actual === expected })); }
async function url(name, address, expected = 'blocked') {
  const result = await cmd('curl', ['--noproxy', '*', '-s', '-o', '/dev/null', '--connect-timeout', '2', '--max-time', '3', address]);
  emit(name, expected, result.code === 0 ? 'reachable' : 'blocked');
}
await url('public_ip', 'http://1.1.1.1');
await url('public_dns', 'https://example.com');
const routes = await cmd('ip', ['-j', 'route']);
const gateways = JSON.parse(routes.out || '[]').map(r => r.gateway).filter(Boolean);
const hosts = [...new Set(['host.docker.internal', 'host.lima.internal', '192.168.5.2', ...gateways, process.env.RSI_GATEWAY].filter(Boolean))];
for (const host of hosts) {
  await url(`host_loopback:${host}`, `http://${host}:${process.env.RSI_HOST_PORT}`);
  await url(`telemetry:${host}`, `http://${host}:4173`);
}
const exists = async path => access(path).then(() => true, () => false);
emit('docker_socket', false, await exists('/var/run/docker.sock'));
emit('host_canary', false, await exists(process.env.RSI_HOST_CANARY));
emit('host_mount_home', false, await exists('/host/Users'));
await url('proxy', process.env.RSI_PROXY_URL, 'reachable');
JS
