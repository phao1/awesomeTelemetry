import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, open, rmdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MonitorConnectionDiagnostics, MonitorConnectionPlan, MonitorConnectionProfile } from '../../src/core/trace-types.js';
import { ConnectionProfileError, validateConnectionProfile, validateExpectedRevision, validateProfileId } from './connection-profiles.js';

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const;
const CA_LIMIT = 4 * 1024 * 1024;
const CONTROL_LIMIT = 256 * 1024;

function invalid(message: string): never { throw new ConnectionProfileError('MONITOR_PROFILE_INVALID', message); }
function readyError(message: string): ConnectionProfileError { return new ConnectionProfileError('MONITOR_NOT_READY', message, 503); }

function controlOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) invalid('The monitor server must be an explicit loopback HTTP origin');
  return url.origin;
}

export function parseMonitoredLaunchArgs(argv: readonly string[]): { controlUrl: string; profileId: string; revision: number; args: string[] } {
  const separator = argv.indexOf('--');
  const options = separator < 0 ? [...argv] : argv.slice(0, separator);
  const values = new Map<string, string>();
  for (let i = 0; i < options.length; i += 2) {
    const name = options[i]; const value = options[i + 1];
    if ((name !== '--server' && name !== '--profile' && name !== '--revision') || value === undefined || values.has(name)) invalid('Usage: agent-observe launch --server <loopback-url> --profile <uuid> --revision <n> -- [Agent arguments]');
    values.set(name, value);
  }
  const profileId = values.get('--profile') ?? '';
  validateProfileId(profileId);
  const revision = validateExpectedRevision(Number(values.get('--revision')));
  const controlUrl = controlOrigin(values.get('--server') ?? 'http://127.0.0.1:4173');
  return { controlUrl, profileId, revision, args: separator < 0 ? [] : argv.slice(separator + 1) };
}

/** Direct loopback HTTP, independent of a parent's proxy environment. */
async function controlRequest(url: string, method: 'GET' | 'POST', signal: AbortSignal, body?: unknown, limit = CONTROL_LIMIT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({
      hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port, path: target.pathname,
      method, agent: false, signal,
      headers: bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': bytes.length },
    }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { res.destroy(readyError('Monitor response exceeds the local setup limit')); return; }
        chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => {
        const response = Buffer.concat(chunks);
        if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode > 299) {
          let code = 'MONITOR_CONTROL_FAILED';
          try {
            const error = JSON.parse(response.toString('utf8')) as { error?: { code?: unknown } };
            if (typeof error.error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.error.code)) code = error.error.code;
          } catch { /* The rejection below remains explicit; never print payload. */ }
          reject(readyError(`${code}: monitor returned HTTP ${res.statusCode ?? 0}; inspect the Web monitor before launching`));
        } else resolve(response);
      });
    });
    const timer = setTimeout(() => req.destroy(readyError('Monitor setup timed out. Check the local Web server/status and retry; no Agent was started')), 12_000);
    timer.unref();
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
    req.end(bytes);
  });
}

function readPlan(bytes: Buffer, controlUrl: string, id: string, mustRun: boolean): MonitorConnectionPlan {
  const plan = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) as MonitorConnectionPlan;
  if (plan === null || typeof plan !== 'object' || plan.profile?.id !== id || plan.controlUrl !== controlUrl || plan.caCertUrl !== `${controlUrl}/api/ca-cert` || !/^[a-f0-9]{64}$/.test(plan.caSha256 ?? '')) invalid('The monitor returned an inconsistent connection plan');
  const profile = validateConnectionProfile(plan.profile);
  if (plan.proxyUrl !== `http://127.0.0.1:${profile.proxyPort}`) invalid('The monitor returned invalid process connection settings');
  if (mustRun && (plan.status?.running !== true || plan.status.port !== profile.proxyPort)) throw readyError('The selected proxy listener is not running; no Agent was started');
  return plan;
}

/** Read-only shared backend findings; exit zero certifies retrieval, not an Agent. */
export async function runMonitorDiagnostics(argv: readonly string[]): Promise<number> {
  const jsonFlags = argv.filter(arg => arg === '--json').length;
  if (jsonFlags > 1 || argv.includes('--')) invalid('Usage: agent-observe diagnose --server <loopback-url> --profile <uuid> --revision <n> [--json]');
  const options = parseMonitoredLaunchArgs(argv.filter(arg => arg !== '--json'));
  let report: MonitorConnectionDiagnostics;
  try {
    const bytes = await controlRequest(`${options.controlUrl}/api/proxy/profiles/${options.profileId}/diagnostics`, 'GET', new AbortController().signal, undefined, 16 * 1024);
    report = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) as MonitorConnectionDiagnostics;
    if (report === null || report.profileId !== options.profileId || !Number.isSafeInteger(report.profileRevision) || !Number.isFinite(Date.parse(report.checkedAt)) || report.trust?.runtimeVerified !== false || report.traffic?.scope !== 'shared_listener' || report.status === null || typeof report.status !== 'object' || report.ca === null || typeof report.ca !== 'object' || !Array.isArray(report.issues) || report.issues.length > 14 || report.issues.some(issue => !['info', 'warning', 'error'].includes(issue.severity) || typeof issue.code !== 'string' || !/^[a-z_]{1,64}$/.test(issue.code) || typeof issue.message !== 'string' || issue.message.length > 512 || typeof issue.nextStep !== 'string' || issue.nextStep.length > 512)) invalid('The monitor returned an inconsistent diagnostic report');
  } catch (error) {
    if (error instanceof ConnectionProfileError) throw error;
    throw readyError('Monitor diagnostics unavailable. Start/check the observability Web server at the selected loopback URL and retry; no listener, Agent or configuration was changed.');
  }
  if (report.profileRevision !== options.revision) throw new ConnectionProfileError('MONITOR_PROFILE_CONFLICT', 'The saved profile revision changed; reload and review it before diagnosing this recipe', 409);
  if (jsonFlags === 1) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Agent monitor diagnostic snapshot: ${report.checkedAt}\nListener: ${report.listener}; expected port ${report.expectedPort}, actual ${report.status.port ?? 'none'}\nPublic CA: ${report.ca.state}; SHA-256 ${report.ca.sha256 ?? 'unknown'}; valid until ${report.ca.validUntil ?? 'unknown'}\nRuntime trust: not verified (${report.trust.variable}, selected child only); OS trust: not checked\nShared-listener traffic: ${report.traffic.state}; observed requests ${report.status.diagnostics?.observedRequests ?? 'unknown'}\nRetrieval is not proof of Agent readiness.`);
    for (const issue of report.issues) console.log(`[${issue.severity}] ${issue.code}: ${issue.message}\n  Next: ${issue.nextStep}`);
  }
  return report.issues.some(issue => issue.severity === 'error') ? 2 : 0;
}

function checkCertificates(pem: string, monitor = false): X509Certificate[] {
  if (pem.includes('PRIVATE KEY')) invalid('Only public CA certificates may enter a process trust bundle');
  const certificates = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)];
  if (certificates.length === 0) invalid('The CA bundle contains no PEM certificates');
  const parsed: X509Certificate[] = [];
  for (const match of certificates) {
    let certificate: X509Certificate;
    try { certificate = new X509Certificate(match[0]); }
    catch { invalid('The CA bundle contains an invalid certificate'); }
    if (monitor && (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) < Date.now())) invalid('The monitor CA is expired, not yet valid or not a CA');
    parsed.push(certificate);
  }
  if (monitor && certificates.length !== 1) invalid('The monitor CA endpoint must provide exactly one public root certificate');
  return parsed;
}

async function inheritedCertificates(path: string): Promise<string> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > CA_LIMIT) invalid('Inherited CA bundle must be a regular file no larger than 4MiB');
    const data = Buffer.alloc(CA_LIMIT + 1); let offset = 0;
    while (offset < data.length) {
      const read = await file.read(data, offset, data.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset > CA_LIMIT) invalid('Inherited CA bundle exceeds 4MiB');
    const pem = new TextDecoder('utf8', { fatal: true }).decode(data.subarray(0, offset));
    checkCertificates(pem);
    return pem;
  } finally { await file.close(); }
}

/** No parent environment/global trust/config mutation. Clean only owned files. */
export async function prepareMonitoredEnvironment(profile: MonitorConnectionProfile, proxyUrl: string, monitorPem: string, parent: NodeJS.ProcessEnv = process.env): Promise<{ env: NodeJS.ProcessEnv; dispose: () => Promise<void> }> {
  if (proxyUrl !== `http://127.0.0.1:${profile.proxyPort}`) invalid('Process proxy does not match the selected profile');
  if (parent.NODE_TLS_REJECT_UNAUTHORIZED === '0') invalid('Remove the inherited NODE_TLS_REJECT_UNAUTHORIZED=0 bypass before using monitored CA trust');
  const monitorCertificate = checkCertificates(monitorPem, true)[0]!;
  const env = { ...parent };
  for (const key of PROXY_KEYS) env[key] = proxyUrl;
  if (profile.noProxy !== null) { env.NO_PROXY = profile.noProxy; env.no_proxy = profile.noProxy; }
  if (profile.agent === 'opencode') {
    const bypass = (env.no_proxy ?? env.NO_PROXY ?? '').toLowerCase().split(/[\s,]+/);
    if (!(bypass.includes('*') || (bypass.includes('localhost') && bypass.includes('127.0.0.1')))) invalid('OpenCode needs NO_PROXY entries localhost,127.0.0.1 for its local TUI server. Add them to the profile; local model gateways may then bypass monitoring');
  }
  const key = profile.agent === 'codex' ? 'CODEX_CA_CERTIFICATE' : 'NODE_EXTRA_CA_CERTS';
  const previous = profile.agent === 'codex' ? parent.CODEX_CA_CERTIFICATE ?? parent.SSL_CERT_FILE : parent.NODE_EXTRA_CA_CERTS;
  const inherited = previous ? await inheritedCertificates(previous) : '';
  if (inherited !== '') {
    const monitorKey = monitorCertificate.publicKey.export({ type: 'spki', format: 'der' });
    for (const certificate of checkCertificates(inherited)) {
      if (certificate.subject === monitorCertificate.subject && !certificate.publicKey.export({ type: 'spki', format: 'der' }).equals(monitorKey)) invalid('Inherited CA shares the monitor issuer name but uses a different key; this ambiguous trust bundle can fail verification. Resolve the issuer collision or select a separate explicit trust configuration before launch; no existing CA was removed or replaced');
    }
  }
  const pem = inherited.length === 0 ? monitorPem : `${inherited}\n${monitorPem}`;
  if (Buffer.byteLength(pem) > CA_LIMIT + 64 * 1024) invalid('Combined process CA bundle exceeds its bounded limit');
  const directory = await mkdtemp(join(tmpdir(), 'agent-observe-trust-'));
  const path = join(directory, 'public-ca.pem');
  let file;
  let written = false;
  try {
    file = await open(path, 'wx', 0o600); written = true;
    await file.writeFile(pem, 'utf8');
  } catch (error) {
    if (written) await unlink(path);
    await rmdir(directory);
    throw error;
  } finally { await file?.close(); }
  env[key] = path;
  let disposed = false;
  return { env, dispose: async () => {
    if (disposed) return;
    await unlink(path);
    await rmdir(directory);
    disposed = true;
  } };
}

async function requireStandaloneCodex(executable: string, cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw readyError('Launch cancelled before executable validation');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--help'], { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let help = ''; let size = 0; let failure: Error | null = null;
    const kill = (): void => { child.kill('SIGTERM'); };
    const timer = setTimeout(() => { failure = readyError('Codex help probe timed out; standalone support is unverified'); child.kill('SIGKILL'); }, 2000);
    timer.unref();
    signal.addEventListener('abort', kill, { once: true });
    const data = (bytes: Buffer): void => {
      size += bytes.length;
      if (size > 256 * 1024) { failure = readyError('Codex help exceeds the bounded probe limit'); kill(); }
      else help += bytes.toString('utf8');
    };
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', kill);
      if (failure !== null) reject(failure);
      else if (signal.aborted || code !== 0 || !help.includes('--no-daemon')) reject(readyError('This Codex executable does not establish --no-daemon support; upgrade/select a verified standalone CLI, never attach to a shared daemon silently'));
      else resolve();
    });
  });
}

export async function runMonitoredLaunch(argv: readonly string[]): Promise<number> {
  const options = parseMonitoredLaunchArgs(argv);
  const abort = new AbortController();
  let child: ChildProcess | null = null;
  let receivedSignal: NodeJS.Signals | null = null;
  let environment: Awaited<ReturnType<typeof prepareMonitoredEnvironment>> | null = null;
  const onSignal = (signal: NodeJS.Signals): void => {
    receivedSignal = signal; abort.abort();
    // A POSIX foreground terminal already delivers Ctrl-C to both processes.
    // Do not send a second interrupt to an interactive Agent.
    if (child !== null && !(signal === 'SIGINT' && process.stdin.isTTY && process.platform !== 'win32')) child.kill(signal);
  };
  const interrupt = (): void => onSignal('SIGINT');
  const terminate = (): void => onSignal('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const prefix = `${options.controlUrl}/api/proxy/profiles/${options.profileId}`;
    const preview = readPlan(await controlRequest(`${prefix}/plan`, 'GET', abort.signal), options.controlUrl, options.profileId, false);
    if (preview.profile.revision !== options.revision) throw new ConnectionProfileError('MONITOR_PROFILE_CONFLICT', 'The copied command refers to an older profile revision; inspect the current profile and generate a new command before launching', 409);
    const plan = readPlan(await controlRequest(`${prefix}/start`, 'POST', abort.signal, { expectedRevision: preview.profile.revision }), options.controlUrl, options.profileId, true);
    if (plan.profile.revision !== preview.profile.revision) invalid('The selected profile changed during launch; inspect it and retry');
    const pem = await controlRequest(plan.caCertUrl, 'GET', abort.signal, undefined, 64 * 1024);
    if (createHash('sha256').update(pem).digest('hex') !== plan.caSha256) invalid('Monitor CA changed during setup; no Agent was started');
    const profile = plan.profile;
    if (!(await stat(profile.projectDirectory)).isDirectory()) invalid('The profile project is not an accessible directory');
    if ((profile.agent === 'codex' && options.args.some(arg => arg === '--remote' || arg.startsWith('--remote='))) || (profile.agent === 'opencode' && (options.args[0] === 'attach' || options.args.some(arg => arg === '--attach' || arg.startsWith('--attach=')))) || (profile.agent === 'claude' && options.args.some(arg => arg === '--bg' || arg === '--background'))) invalid('Remote/background attachment is outside this terminal process profile; choose an explicitly configured connection for that runtime');
    environment = await prepareMonitoredEnvironment(profile, plan.proxyUrl, pem.toString('utf8'));
    const executable = profile.executable ?? profile.agent;
    if (profile.agent === 'codex') await requireStandaloneCodex(executable, profile.projectDirectory, environment.env, abort.signal);
    if (abort.signal.aborted) return receivedSignal === 'SIGTERM' ? 143 : 130;
    const separator = options.args.indexOf('--');
    const hasStandalone = options.args.slice(0, separator < 0 ? undefined : separator).includes('--no-daemon');
    const args = profile.agent === 'codex' && !hasStandalone ? ['--no-daemon', ...options.args] : options.args;
    console.error('Agent monitor: child process and descendants only; existing processes/configuration are unchanged. NO_PROXY may bypass capture; stopping the shared proxy can interrupt connected Agents. Agent transport remains unverified.');
    return await new Promise<number>((resolve, reject) => {
      child = spawn(executable, args, { cwd: profile.projectDirectory, env: environment!.env, shell: false, stdio: 'inherit' });
      let failure: Error | null = null;
      child.once('error', error => { failure = error; });
      child.once('close', (code, signal) => {
        child = null;
        if (failure !== null) reject(failure);
        else resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
      });
    });
  } catch (error) {
    if (receivedSignal !== null) return receivedSignal === 'SIGTERM' ? 143 : 130;
    throw error;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    await environment?.dispose();
  }
}
