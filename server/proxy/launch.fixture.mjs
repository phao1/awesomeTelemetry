#!/usr/bin/env node
// Synthetic external CLI dependency for launcher integration tests, not Agent
// capability evidence. Never imports or mocks monitored-launch implementation.
import { request } from 'node:http';
import { connect } from 'node:tls';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setInterval, setTimeout } from 'node:timers';
import console from 'node:console';
import { URL } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Synthetic CLI fixture supports --no-daemon');
  process.exit(0);
}
const value = name => args[args.indexOf(name) + 1];
const caPath = process.env.CODEX_CA_CERTIFICATE ?? process.env.NODE_EXTRA_CA_CERTS;
const ca = caPath ? await readFile(caPath, 'utf8') : '';
const metadata = { args, cwd: process.cwd(), proxy: process.env.HTTPS_PROXY, noProxy: process.env.no_proxy ?? null, caPath, certificates: [...ca.matchAll(/-----BEGIN CERTIFICATE-----/g)].length };
if (args.includes('--hold')) {
  console.log(JSON.stringify({ ...metadata, ready: true }));
  process.on('SIGTERM', () => { console.log('fixture received SIGTERM'); process.exit(0); });
  let interrupts = 0;
  process.on('SIGINT', () => {
    interrupts += 1; console.log(`fixture received SIGINT ${interrupts}`);
    setTimeout(() => process.exit(130), 30);
  });
  setInterval(() => {}, 1000);
} else if (args.includes('--target')) {
  const target = new URL(value('--target'));
  const proxy = new URL(process.env.HTTPS_PROXY);
  const payload = '{"model":"synthetic","messages":[{"role":"user","content":"你好"}]}';
  const response = await new Promise((resolve, reject) => {
    const tunnel = request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: `${target.hostname}:${target.port}` });
    tunnel.once('error', reject);
    tunnel.once('connect', (message, socket) => {
      if (message.statusCode !== 200) { socket.destroy(); reject(new Error('CONNECT failed')); return; }
      const secure = connect({ socket, host: target.hostname, rejectUnauthorized: true });
      let text = '';
      secure.once('error', reject);
      secure.once('secureConnect', () => secure.write(`POST ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`));
      secure.on('data', chunk => { text += String(chunk); });
      secure.once('end', () => resolve({ text, authorized: secure.authorized }));
    });
    tunnel.end();
  });
  console.log(JSON.stringify({ ...metadata, response }));
} else {
  console.log(JSON.stringify(metadata));
}
