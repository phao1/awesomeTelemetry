import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import forge from 'node-forge';

export interface CaManagerOptions {
  caDir: string;
}

export interface CaBundle {
  caCertPem: string;
  caKeyPem: string;
}

const CA_CERT_FILE = 'proxy-ca-cert.pem';
const CA_KEY_FILE = 'proxy-ca-key.pem';

const memoryCache = new Map<string, CaBundle>();
const domainCertCache = new Map<string, string>();

function randomSerial(): string {
  return `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
}

function generateRootCa(): CaBundle {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [{ name: 'commonName', value: 'Agent Observability Root CA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, keyEncipherment: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    caCertPem: forge.pki.certificateToPem(cert),
    caKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** REQ-002/G3.3：首次生成自签名 root CA；node-forge 兜底（v5 补全 v4 缺口）。 */
export function ensureRootCa(opts: CaManagerOptions): CaBundle {
  const cached = memoryCache.get(opts.caDir);
  if (cached !== undefined) {
    return cached;
  }
  mkdirSync(opts.caDir, { recursive: true });
  const certPath = join(opts.caDir, CA_CERT_FILE);
  const keyPath = join(opts.caDir, CA_KEY_FILE);
  if (existsSync(certPath) && existsSync(keyPath)) {
    const bundle: CaBundle = {
      caCertPem: readFileSync(certPath, 'utf8'),
      caKeyPem: readFileSync(keyPath, 'utf8'),
    };
    memoryCache.set(opts.caDir, bundle);
    return bundle;
  }
  const bundle = generateRootCa();
  writeFileSync(certPath, bundle.caCertPem, 'utf8');
  writeFileSync(keyPath, bundle.caKeyPem, 'utf8');
  memoryCache.set(opts.caDir, bundle);
  return bundle;
}

/** REQ-002：按需生成 per-domain 证书（SAN），内存缓存 + 持久化。 */
export function getOrCreateDomainCert(opts: CaManagerOptions, domain: string): string {
  const cacheKey = `${opts.caDir}:${domain}`;
  const cached = domainCertCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const ca = ensureRootCa(opts);
  const certPath = join(opts.caDir, `${domain}.pem`);
  if (existsSync(certPath)) {
    const pem = readFileSync(certPath, 'utf8');
    domainCertCache.set(cacheKey, pem);
    return pem;
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.certificateFromPem(ca.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  cert.setSubject([{ name: 'commonName', value: domain }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: domain }] },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  writeFileSync(certPath, pem, 'utf8');
  domainCertCache.set(cacheKey, pem);
  return pem;
}
