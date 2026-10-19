import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import forge from 'node-forge';

import { ensureInterceptCa, ensureRootCa, getOrCreateDomainCert } from './ca-manager.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('REQ-002/G3.3 ca-manager（node-forge 兜底）', () => {
  it('returns the actual proxy CA certificate and protects its private key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intercept-ca-')); tempDirs.push(dir);
    const [first, second] = await Promise.all([ensureInterceptCa(dir), ensureInterceptCa(dir)]);
    expect(first).toBe(second);
    expect(first).toBe(readFileSync(join(dir, 'certs', 'ca.pem'), 'utf8'));
    const cert = forge.pki.certificateFromPem(first);
    expect(cert.getExtension('basicConstraints')).toMatchObject({ cA: true });
    expect(first).not.toContain('PRIVATE KEY');
    expect(statSync(join(dir, 'keys', 'ca.private.key')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'keys')).mode & 0o777).toBe(0o700);
  });
  it('首次生成并持久化 root CA，二次加载一致', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ca-manager-'));
    tempDirs.push(dir);
    const first = ensureRootCa({ caDir: dir });
    const second = ensureRootCa({ caDir: dir });
    expect(first.caCertPem).toBe(second.caCertPem);
    expect(first.caCertPem).toContain('BEGIN CERTIFICATE');
    const cert = forge.pki.certificateFromPem(first.caCertPem);
    expect(cert.subject.getField('CN')?.value).toBe('Agent Observability Root CA');
  });

  it('per-domain 证书 CN/SAN 正确且缓存命中', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ca-domain-'));
    tempDirs.push(dir);
    const pem = getOrCreateDomainCert({ caDir: dir }, 'api.example.com');
    const again = getOrCreateDomainCert({ caDir: dir }, 'api.example.com');
    expect(pem).toBe(again);
    const cert = forge.pki.certificateFromPem(pem);
    expect(cert.subject.getField('CN')?.value).toBe('api.example.com');
    const san = cert.getExtension('subjectAltName') as { altNames: Array<{ type: number; value: string }> };
    expect(san.altNames.some((n) => n.type === 2 && n.value === 'api.example.com')).toBe(true);
  });
});
