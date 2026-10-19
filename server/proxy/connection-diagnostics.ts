import { createHash, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { MonitorConnectionDiagnostics, MonitorConnectionProfile, MonitorDiagnosticCode, ProxyRuntimeStatus } from '../../src/core/trace-types.js';

type Finding = MonitorConnectionDiagnostics['issues'][number];
const guidance: Record<MonitorDiagnosticCode, Omit<Finding, 'code'>> = {
  listener_idle: { severity: 'warning', message: 'The monitor listener is not running.', nextStep: 'Start the saved listener explicitly, then run the reviewed terminal launch command. Existing Agent processes are unchanged.' },
  listener_starting: { severity: 'info', message: 'Listener startup is still in progress.', nextStep: 'Wait for the Web status event and check again. After a readiness timeout inspect the error; do not start another listener or assume an Agent was launched.' },
  port_conflict: { severity: 'error', message: 'The active listener uses another port.', nextStep: 'Review the actual and expected ports. Explicitly stop the shared listener before switching, or edit/save the recipe to use the intended port; connected Agents may be interrupted.' },
  cleanup_pending: { severity: 'warning', message: 'The previous listener still owns cleanup resources.', nextStep: 'Wait for cleanup or retry Stop after a failed deadline. Do not launch a replacement or close storage while writes remain.' },
  listener_failed: { severity: 'error', message: 'The listener failed; no connection readiness is established.', nextStep: 'Inspect lastError in Web/status. For EADDRINUSE choose a free port or explicitly stop the known owner; for startup timeout inspect CA/storage permissions, then retry.' },
  ca_missing: { severity: 'warning', message: 'The canonical monitor public CA is missing.', nextStep: 'Generate a reviewed connection plan or explicitly start the listener to initialize its actual CA, then check again. Do not install global trust or disable TLS verification.' },
  ca_invalid: { severity: 'error', message: 'The monitor public CA cannot be validated safely.', nextStep: 'Preserve the CA directory and inspect file permissions, PEM validity, expiry and symlinks. Do not delete old trust or disable verification; repair/select a valid explicit CA configuration before launch.' },
  trust_unverified: { severity: 'warning', message: 'The target CLI runtime trust is not verified by this server snapshot; OS trust is not inspected.', nextStep: 'Use the reviewed process launcher in a new terminal process. Check its CA digest/bundle errors and the actual Agent TLS result; configure other tool runtimes separately. Public CA availability is not trust.' },
  traffic_waiting: { severity: 'warning', message: 'The expected listener has not observed a request in this run.', nextStep: 'Run the saved terminal command and make a deliberate Agent request. Check inherited NO_PROXY, process/daemon attachment, target port, CA errors and transport support; do not assume a listening socket means connection.' },
  traffic_unavailable: { severity: 'info', message: 'Current traffic evidence is unavailable for this recipe.', nextStep: 'Use the expected live listener with current-run activity diagnostics, then check again. Historical request totals and stopped/different-port runs cannot establish a current connection.' },
  capture_errors: { severity: 'error', message: 'Transport or capture/storage failures have been observed.', nextStep: 'Inspect lastError and each original body completeness status. Check target TLS/network, quota, pending writes and disk permissions; traffic arrival does not imply a saved complete trace.' },
  bypass_review: { severity: 'warning', message: 'Bypass rules may exclude the intended model endpoint.', nextStep: 'Inspect NO_PROXY/no_proxy in the launching terminal and the saved recipe. The server cannot see inherited terminal settings. OpenCode needs loopback bypass, which can also exclude a local gateway.' },
  transport_unverified: { severity: 'warning', message: 'Exact Agent/version/transport support remains unverified.', nextStep: 'Verify the installed Agent against the support matrix with real traffic. HTTP/SSE fixture success does not certify WebSocket, HTTP/2, pinning, mTLS, remote services or Windows.' },
  shared_traffic: { severity: 'info', message: 'Observed traffic belongs to the shared listener, not a proven Agent/profile identity.', nextStep: 'Inspect each request and explicit native identity evidence before linking a session. Other local clients can use the port; HTTP arrival alone does not prove HTTPS trust or tool/subagent coverage.' },
};

/** Public cert only: no generation, signing-key read, trust install or network probe. */
async function inspectPublicCa(directory: string): Promise<MonitorConnectionDiagnostics['ca']> {
  let file;
  let result: MonitorConnectionDiagnostics['ca'];
  try {
    const path = join(directory, 'certs', 'ca.pem');
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 64 * 1024) throw new Error('Invalid public CA file');
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size > 64 * 1024) throw new Error('Changed public CA file');
    const buffer = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, size);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size > 64 * 1024) throw new Error('Oversized public CA');
    const bytes = buffer.subarray(0, size);
    const pem = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    if (pem.includes('PRIVATE KEY') || [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].length !== 1) throw new Error('Not a single public CA');
    const ca = new X509Certificate(pem);
    if (!ca.ca || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) < Date.now()) throw new Error('Invalid CA validity');
    result = { state: 'available', sha256: createHash('sha256').update(bytes).digest('hex'), validUntil: new Date(ca.validTo).toISOString() };
  } catch (error) {
    const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    result = { state: missing ? 'missing' : 'invalid', sha256: null, validUntil: null };
  } finally {
    try { await file?.close(); }
    catch { result = { state: 'invalid', sha256: null, validUntil: null }; }
  }
  return result;
}

export async function inspectConnection(profile: MonitorConnectionProfile, caDirectory: string, getStatus: () => ProxyRuntimeStatus): Promise<MonitorConnectionDiagnostics> {
  const ca = await inspectPublicCa(caDirectory);
  // Read runtime after async CA IO; do not reuse a status from before a stop/restart.
  const status = structuredClone(getStatus());
  const activity = status.diagnostics;
  const listener: MonitorConnectionDiagnostics['listener'] = activity?.cleanupPending ? 'stopping'
    : (status.running || status.starting) && status.port !== profile.proxyPort ? 'port_conflict'
    : status.starting ? 'starting' : status.running ? 'listening' : activity?.phase === 'failed' ? 'failed' : 'idle';
  const traffic: MonitorConnectionDiagnostics['traffic'] = { scope: 'shared_listener', state: listener !== 'listening' || activity === undefined ? 'unavailable' : activity.observedRequests > 0 ? 'observed' : 'waiting' };
  const codes: MonitorDiagnosticCode[] = [];
  const listenerCode = { idle: 'listener_idle', starting: 'listener_starting', stopping: 'cleanup_pending', failed: 'listener_failed', port_conflict: 'port_conflict' } as const;
  if (listener !== 'listening') codes.push(listenerCode[listener]);
  if (ca.state !== 'available') codes.push(ca.state === 'missing' ? 'ca_missing' : 'ca_invalid');
  codes.push('trust_unverified');
  codes.push(traffic.state === 'waiting' ? 'traffic_waiting' : traffic.state === 'unavailable' ? 'traffic_unavailable' : 'shared_traffic');
  if ((activity?.captureErrors ?? 0) > 0) codes.push('capture_errors');
  if (profile.noProxy !== '') codes.push('bypass_review');
  codes.push('transport_unverified');
  return {
    profileId: profile.id, profileRevision: profile.revision, checkedAt: new Date().toISOString(), expectedPort: profile.proxyPort,
    listener, ca, trust: { scope: 'selected_child_runtime', variable: profile.agent === 'codex' ? 'CODEX_CA_CERTIFICATE' : 'NODE_EXTRA_CA_CERTS', runtimeVerified: false, osTrust: 'not_checked' },
    traffic, status, issues: codes.map(code => ({ code, ...guidance[code] })),
  };
}
