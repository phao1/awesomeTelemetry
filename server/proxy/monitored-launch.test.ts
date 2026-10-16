import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, stat, copyFile, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Agent as HttpsAgent, createServer as createHttpsServer } from 'node:https';
import forge from 'node-forge';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { ensureInterceptCa } from './ca-manager.js';
import { parseMonitoredLaunchArgs, prepareMonitoredEnvironment } from './monitored-launch.js';
import { buildConnectionPlan, ConnectionProfileStore } from './connection-profiles.js';
import type { MonitorConnectionPlan } from '../../src/core/trace-types.js';
import { initSchema } from '../storage/schema.js';
import { createMitmProxy } from './mitm-proxy.js';
import { CaptureBodyStore } from './body-store.js';
import { readCaptureBodies } from './capture-storage.js';

let directory: string;
let monitorPem: string;
let previousPem: string;
let previousKeyPem: string;
beforeAll(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'monitored-launch-')));
  monitorPem = await ensureInterceptCa(join(directory, 'ca'));
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const root = forge.pki.createCertificate();
  root.publicKey = keys.publicKey; root.serialNumber = '02';
  root.validity.notBefore = new Date(Date.now() - 86400000); root.validity.notAfter = new Date(Date.now() + 86400000);
  const subject = [{ name: 'commonName', value: 'Synthetic enterprise trust root' }];
  root.setSubject(subject); root.setIssuer(subject);
  root.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, digitalSignature: true }]);
  root.sign(keys.privateKey, forge.md.sha256.create());
  previousPem = forge.pki.certificateToPem(root); previousKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('process-only proxy and trust', () => {
  it('parses a local profile launch and forwards every argument literally after the separator', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(parseMonitoredLaunchArgs(['--server', 'http://127.0.0.1:4173', '--profile', id, '--revision', '1', '--', '--model', 'user model', '$(echo literal)'])).toEqual({ controlUrl: 'http://127.0.0.1:4173', profileId: id, revision: 1, args: ['--model', 'user model', '$(echo literal)'] });
    expect(() => parseMonitoredLaunchArgs(['--server', 'https://remote.invalid', '--profile', id, '--revision', '1'])).toThrow();
    expect(() => parseMonitoredLaunchArgs(['--server', 'http://user:secret@127.0.0.1:4173', '--profile', id, '--revision', '1'])).toThrow();
  });

  it.each(['claude', 'codex', 'opencode'] as const)('appends existing %s trust without mutating parent env or original CA files', async agent => {
    const originalPath = join(directory, `inherited-${agent}.pem`);
    await writeFile(originalPath, previousPem);
    const profile = await new ConnectionProfileStore(join(directory, `${agent}-profiles.json`)).create({ label: agent, agent, projectDirectory: directory, executable: null, proxyPort: 7779, noProxy: agent === 'opencode' ? 'localhost,127.0.0.1,::1' : null });
    const parent = { HTTPS_PROXY: 'http://original.invalid:8080', NO_PROXY: 'private.invalid', NODE_EXTRA_CA_CERTS: originalPath, SSL_CERT_FILE: originalPath, SYNTHETIC_AUTH_TOKEN: 'unchanged' };
    const snapshot = { ...parent };
    const prepared = await prepareMonitoredEnvironment(profile, 'http://127.0.0.1:7779', monitorPem, parent);
    const key = agent === 'codex' ? 'CODEX_CA_CERTIFICATE' : 'NODE_EXTRA_CA_CERTS';
    const caPath = prepared.env[key]!;
    try {
      expect(prepared.env.SYNTHETIC_AUTH_TOKEN).toBe(parent.SYNTHETIC_AUTH_TOKEN);
      expect(prepared.env.HTTPS_PROXY).toBe('http://127.0.0.1:7779');
      expect(prepared.env.http_proxy).toBe('http://127.0.0.1:7779');
      expect(prepared.env.no_proxy ?? prepared.env.NO_PROXY).toBe(profile.noProxy ?? parent.NO_PROXY);
      expect(await readFile(caPath, 'utf8')).toBe(`${previousPem}\n${monitorPem}`);
      expect(await readFile(originalPath, 'utf8')).toBe(previousPem);
      expect(parent).toEqual(snapshot);
      expect(prepared.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      if (process.platform !== 'win32') expect((await stat(caPath)).mode & 0o777).toBe(0o600);
    } finally { await prepared.dispose(); }
    await expect(stat(caPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await prepared.dispose();
  });

  it('refuses bypassed TLS, private-key CA data and unsafe OpenCode loopback configuration', async () => {
    const store = new ConnectionProfileStore(join(directory, 'invalid-profiles.json'));
    const profile = await store.create({ label: 'Invalid', agent: 'opencode', projectDirectory: directory, executable: null, proxyPort: 7779, noProxy: '' });
    await expect(prepareMonitoredEnvironment(profile, 'http://127.0.0.1:7779', monitorPem, {})).rejects.toThrow('OpenCode needs NO_PROXY');
    await expect(prepareMonitoredEnvironment(profile, 'http://127.0.0.1:7779', monitorPem, { NODE_TLS_REJECT_UNAUTHORIZED: '0' })).rejects.toThrow('bypass');
    await expect(prepareMonitoredEnvironment(profile, 'http://127.0.0.1:7779', '-----BEGIN PRIVATE KEY-----', {})).rejects.toThrow('Only public CA');
  });

  it('reports equal-issuer/different-key trust collisions instead of removing original CAs or bypassing TLS', async () => {
    const collision = await ensureInterceptCa(join(directory, 'collision-ca'));
    const path = join(directory, 'same-issuer.pem'); await writeFile(path, collision);
    const profile = await new ConnectionProfileStore(join(directory, 'collision-profile.json')).create({ label: 'Collision', agent: 'claude', projectDirectory: directory, executable: null, proxyPort: 7779, noProxy: null });
    const parent = { NODE_EXTRA_CA_CERTS: path };
    await expect(prepareMonitoredEnvironment(profile, 'http://127.0.0.1:7779', monitorPem, parent)).rejects.toThrow('shares the monitor issuer name');
    expect(await readFile(path, 'utf8')).toBe(collision);
    expect(parent.NODE_EXTRA_CA_CERTS).toBe(path);
  });
});

async function launchControl(agent: 'claude' | 'codex', options: { badDigest?: boolean; proxyPort?: number; inheritedCAPath?: string } = {}) {
  const store = new ConnectionProfileStore(join(directory, `${agent}-child-${Date.now()}-${Math.random()}.json`));
  const external = join(process.cwd(), 'server', 'proxy', 'launch.fixture.mjs');
  let executable = process.execPath;
  if (agent === 'codex') {
    executable = join(directory, 'synthetic-codex');
    await copyFile(external, executable); await chmod(executable, 0o700);
  }
  const profile = await store.create({ label: 'Synthetic external child', agent, projectDirectory: directory, executable, proxyPort: options.proxyPort ?? 7779, noProxy: '' });
  let starts = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.once('end', () => {
      if (req.url === '/api/ca-cert') { res.end(monitorPem); return; }
      if (req.method === 'POST') starts += 1;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(plan));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const plan: MonitorConnectionPlan = buildConnectionPlan(profile, { controlUrl: url, nodePath: process.execPath, cliPath: '/unused', caSha256: options.badDigest ? '0'.repeat(64) : createHash('sha256').update(monitorPem).digest('hex'), status: { running: true, starting: false, port: profile.proxyPort, requestCount: 0, startedAt: new Date().toISOString() } });
  const run = (args: string[] = [], revision = 1) => {
    const child = spawn(process.execPath, ['bin/agent-observe.js', 'launch', '--server', url, '--profile', profile.id, '--revision', String(revision), '--', ...(agent === 'claude' ? [external] : []), ...args], { cwd: process.cwd(), env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', HTTPS_PROXY: 'http://unreachable.synthetic.invalid:1', NODE_EXTRA_CA_CERTS: options.inheritedCAPath, CODEX_CA_CERTIFICATE: undefined, SSL_CERT_FILE: undefined }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
    });
    return { child, done, stdout: () => stdout };
  };
  return { run, starts: () => starts, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

describe('built launcher with real external child processes (not Agent certification)', () => {
  it('uses real appended CA trust through HTTPS CONNECT and persists exact original evidence without replay', async () => {
    const upstreamRoot = forge.pki.certificateFromPem(previousPem);
    const upstreamKey = forge.pki.privateKeyFromPem(previousKeyPem);
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const leaf = forge.pki.createCertificate();
    leaf.publicKey = keys.publicKey; leaf.serialNumber = '03';
    leaf.validity.notBefore = new Date(Date.now() - 1000); leaf.validity.notAfter = new Date(Date.now() + 86400000);
    leaf.setSubject([{ name: 'commonName', value: '127.0.0.1' }]); leaf.setIssuer(upstreamRoot.subject.attributes);
    leaf.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
    leaf.sign(upstreamKey, forge.md.sha256.create());
    const responseBody = '{"usage":{"input_tokens":3,"output_tokens":2},"content":[{"type":"text","text":"synthetic response"}]}';
    let requests = 0, requestBody = '';
    const origin = createHttpsServer({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(leaf) }, (req, res) => {
      requests += 1;
      req.on('data', chunk => { requestBody += String(chunk); });
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(responseBody); });
    });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
    const db = new Database(':memory:'); initSchema(db);
    const bodies = await CaptureBodyStore.create(join(directory, 'network-bodies'));
    const upstreamAgent = new HttpsAgent({ ca: previousPem });
    const proxy = await createMitmProxy({ db, port: 0, caDirectory: join(directory, 'ca'), bodyStore: bodies, httpsAgent: upstreamAgent });
    const proxyPort = (proxy as unknown as { httpPort: number }).httpPort;
    const priorPath = join(directory, 'network-original-ca.pem'); await writeFile(priorPath, previousPem);
    const control = await launchControl('claude', { proxyPort, inheritedCAPath: priorPath });
    try {
      const result = await control.run(['--target', `https://127.0.0.1:${(origin.address() as AddressInfo).port}/v1/messages`]).done;
      expect(result.code, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout) as { caPath: string; certificates: number; response: { text: string; authorized: boolean } };
      expect(output.response.authorized).toBe(true);
      expect(output.response.text).toContain('200 OK');
      expect(output.response.text).toContain('synthetic response');
      expect(output.certificates).toBe(2);
      expect(requestBody).toBe('{"model":"synthetic","messages":[{"role":"user","content":"你好"}]}');
      await proxy.shutdown();
      const row = db.prepare('SELECT id, input_tokens, output_tokens FROM proxy_requests').get() as { id: number; input_tokens: number; output_tokens: number };
      expect(row).toMatchObject({ input_tokens: 3, output_tokens: 2 });
      const refs = readCaptureBodies(db, row.id);
      expect(refs.request).toMatchObject({ status: 'complete', sha256: createHash('sha256').update(requestBody).digest('hex') });
      expect(refs.response).toMatchObject({ status: 'complete', sha256: createHash('sha256').update(responseBody).digest('hex') });
      expect(requests).toBe(1);
      expect(await readFile(priorPath, 'utf8')).toBe(previousPem);
      await expect(stat(output.caPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await control.close(); await proxy.shutdown({ graceMs: 0 }); upstreamAgent.destroy();
      origin.closeAllConnections(); await new Promise<void>(resolve => origin.close(() => resolve())); db.close();
    }
  });
  it('preserves literal argv/cwd and cleans child trust after normal exit', async () => {
    const control = await launchControl('claude');
    try {
      const result = await control.run(['--model', 'unchanged model', '$(touch should-not-execute)', '中文 argument']).done;
      expect(result.code, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout) as { args: string[]; cwd: string; caPath: string; proxy: string };
      expect(output.args.slice(0)).toEqual(['--model', 'unchanged model', '$(touch should-not-execute)', '中文 argument']);
      expect(output.cwd).toBe(directory);
      expect(output.proxy).toBe('http://127.0.0.1:7779');
      await expect(stat(join(directory, 'should-not-execute'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(output.caPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(control.starts()).toBe(1);
    } finally { await control.close(); }
  });

  it.skipIf(process.platform === 'win32')('uses verified standalone Codex mode without disabling WebSocket or changing model flags', async () => {
    const control = await launchControl('codex');
    try {
      const result = await control.run(['exec', '--model', 'unchanged']).done;
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).args).toEqual(['--no-daemon', 'exec', '--model', 'unchanged']);
    } finally { await control.close(); }
  });

  it('does not start a child when the CA digest is inconsistent', async () => {
    const control = await launchControl('claude', { badDigest: true });
    try {
      const result = await control.run().done;
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('CA changed');
    } finally { await control.close(); }
  });

  it('refuses a stale copied profile revision before starting the listener or child', async () => {
    const control = await launchControl('claude');
    try {
      const result = await control.run([], 2).done;
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('older profile revision');
      expect(control.starts()).toBe(0);
    } finally { await control.close(); }
  });

  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)('forwards targeted %s and cleans only its own public trust file after child exit', async signal => {
    const control = await launchControl('claude');
    const running = control.run(['--hold']);
    try {
      const deadline = Date.now() + 3000;
      while (!running.stdout().includes('"ready":true')) {
        if (Date.now() > deadline) throw new Error('Synthetic child did not start');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const output = JSON.parse(running.stdout().trim()) as { caPath: string };
      expect((await stat(output.caPath)).isFile()).toBe(true);
      running.child.kill(signal);
      const result = await running.done;
      expect(result.code, result.stderr).toBe(signal === 'SIGINT' ? 130 : 0);
      expect(result.stdout).toContain(`fixture received ${signal}`);
      if (signal === 'SIGINT') expect(result.stdout).not.toContain('fixture received SIGINT 2');
      await expect(stat(output.caPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (running.child.exitCode === null) running.child.kill('SIGKILL');
      await control.close();
    }
  });
});
