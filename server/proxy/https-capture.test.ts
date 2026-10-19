import { request } from 'node:http';
import { Agent, createServer } from 'node:https';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:tls';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';

import { ensureInterceptCa } from './ca-manager.js';
import { createMitmProxy } from './mitm-proxy.js';
import { initSchema } from '../storage/schema.js';

describe('real HTTPS CONNECT capture', () => {
  it('trusts the downloaded proxy CA, validates upstream TLS, and captures Messages usage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-https-capture-'));
    const db = new Database(':memory:'); initSchema(db);
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86400000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    const subject = [{ name: 'commonName', value: '127.0.0.1' }];
    cert.setSubject(subject); cert.setIssuer(subject);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const upstreamCert = forge.pki.certificateToPem(cert);
    const origin = createServer({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: upstreamCert }, (req, res) => {
      req.resume();
      req.once('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"usage":{"input_tokens":12,"output_tokens":7},"content":[{"type":"text","text":"original"}]}');
      });
    });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
    const originPort = (origin.address() as AddressInfo).port;
    const upstreamAgent = new Agent({ ca: upstreamCert });
    const proxyCa = await ensureInterceptCa(directory);
    let captured = false;
    const options = { db, port: 0, caDirectory: directory, httpsAgent: upstreamAgent, notify: () => { captured = true; } };
    let proxy = await createMitmProxy(options);
    let proxyPort = ((proxy as unknown as { httpServer: Server }).httpServer.address() as AddressInfo).port;
    try {
      const body = '{"model":"test-model","system":"original system","messages":[]}';
      const throughProxy = (ca: string, servername?: string): Promise<{ text: string; san: string }> => new Promise((resolve, reject) => {
        const tunnel = request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `127.0.0.1:${originPort}` });
        tunnel.on('error', reject);
        tunnel.on('connect', (message, socket, head) => {
          if (message.statusCode !== 200) { socket.destroy(); reject(new Error('CONNECT failed')); return; }
          if (head.length > 0) socket.unshift(head);
          const secure = connect({ socket, host: '127.0.0.1', ca, servername, rejectUnauthorized: true });
          let text = '';
          let san = '';
          secure.setTimeout(5000, () => secure.destroy(new Error('TLS request timed out')));
          secure.on('error', reject);
          secure.on('secureConnect', () => {
            expect(secure.authorized).toBe(true);
            san = secure.getPeerCertificate().subjectaltname ?? '';
            secure.write(`POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
          });
          secure.on('data', (data: Buffer) => { text += data.toString('utf8'); });
          secure.on('end', () => resolve({ text, san }));
        });
        tunnel.end();
      });
      // No system trust is installed: an unrelated CA must reject this leaf.
      await expect(throughProxy(upstreamCert)).rejects.toThrow(/self.signed|unable to verify|issuer certificate/i);
      await expect(throughProxy(proxyCa, 'wrong.synthetic.test')).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      const response = await throughProxy(proxyCa);
      expect(response.text).toContain('200 OK');
      expect(response.text).toContain('original');
      expect(response.san).toContain('127.0.0.1');
      const deadline = Date.now() + 3000;
      while (!captured && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      expect(captured).toBe(true);
      expect(db.prepare('SELECT response_status, input_tokens, output_tokens, system_prompt FROM proxy_requests').get()).toEqual({ response_status: 200, input_tokens: 12, output_tokens: 7, system_prompt: 'original system' });
      expect(await ensureInterceptCa(directory)).toBe(proxyCa);
      const tlsPorts = [...new Set(Object.values((proxy as unknown as { sslServers: Record<string, { port: number }> }).sslServers).map(server => server.port))];
      expect(tlsPorts.length).toBeGreaterThan(0);
      await proxy.shutdown();
      expect(proxy.captureActivity()).toMatchObject({ listening: false, activeRequests: 0, pendingWrites: 0 });
      // Every internal CONNECT acceptor has really closed, not merely the root.
      for (const port of tlsPorts) {
        await new Promise<void>((resolve, reject) => {
          const probe = request({ host: '127.0.0.1', port, path: '/' });
          probe.once('error', error => { expect((error as NodeJS.ErrnoException).code).toBe('ECONNREFUSED'); resolve(); });
          probe.once('response', () => reject(new Error('TLS acceptor survived shutdown')));
          probe.end();
        });
      }
      proxy = await createMitmProxy(options);
      proxyPort = ((proxy as unknown as { httpServer: Server }).httpServer.address() as AddressInfo).port;
      expect((await throughProxy(proxyCa)).text).toContain('200 OK');
      expect(await ensureInterceptCa(directory)).toBe(proxyCa);
    } finally {
      await proxy.shutdown(); upstreamAgent.destroy();
      await new Promise<void>(resolve => origin.close(() => resolve()));
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  });
});
