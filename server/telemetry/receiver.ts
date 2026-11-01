import type { ErrorCode } from '../http/error-envelope.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { createGunzip } from 'node:zlib';
import type { IncomingMessage } from 'node:http';
import type { Database } from 'better-sqlite3';
import type { TelemetryImportResult, TelemetrySource, TelemetrySpan, TelemetryStatus } from '../../src/core/telemetry-types.js';
import { defaultUserConfigPath } from '../../local-sessions/config.js';
import { storeTelemetry } from '../storage/telemetry.js';
import { withWalCapacity, CaptureCapacityError } from '../proxy/capture-capacity.js';
import { obj, limit, TelemetryError } from './mapping.js';

const MAX = 8 * 1024 * 1024;
const protocol = 'Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json; binary protobuf is not supported';
export class TelemetryReceiver {
  private enabled = false;
  private requireToken = false;
  private token = '';
  private busy = false;
  private closed = false;
  private worker: Worker | null = null;
  private task: Promise<TelemetryImportResult> | null = null;
  private configTask: Promise<unknown> = Promise.resolve();
  private configLoaded: Promise<void> | null = null;
  private readonly configPath: string;
  private readonly db: Database;
  private readonly notify: (key: string) => void;
  private readonly stats = { spanCount: 0, traceCount: 0, rejectedCount: 0, reasons: {} as Record<string, number>, lastReceivedAt: null as string | null };
  constructor(db: Database, userConfigPath: string | undefined, notify: (key: string) => void) { this.db = db; this.configPath = join(dirname(userConfigPath ?? defaultUserConfigPath()), 'opentelemetry.json'); this.notify = notify; }
  reject(code: string) { this.stats.rejectedCount++; this.stats.reasons[code] = (this.stats.reasons[code] ?? 0) + 1; }
  private ready() { return this.configLoaded ??= (async () => {
    try {
      const file=await open(this.configPath,'r');
      let value:Record<string,unknown>;
      try {if((await file.stat()).size>4096)throw new Error('Config limit');value=obj(JSON.parse(await file.readFile('utf8')) as unknown);}finally{await file.close();}
      if (typeof value.token === 'string' && /^[a-f\d]{64}$/.test(value.token)) this.token = value.token;
      this.requireToken = value.requireToken === true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new TelemetryError(503, 'TELEMETRY_CONFIG', 'Cannot read local OpenTelemetry configuration'); }
  })(); }
  async status(port: number): Promise<TelemetryStatus> { await this.ready(); return { enabled: this.enabled, requireToken: this.requireToken, endpoint: `http://127.0.0.1:${port}/v1/traces`, ...structuredClone(this.stats) }; }
  configure(value: unknown, port: number): Promise<TelemetryStatus & { token?: string }> {
    const run = this.configTask.then(async () => {
      await this.ready(); const v = obj(value);
      if (Object.keys(v).length !== 2 || typeof v.enabled !== 'boolean' || typeof v.requireToken !== 'boolean') throw new TelemetryError(400, 'TELEMETRY_INVALID', 'Expected enabled and requireToken booleans');
      if (this.busy) throw new TelemetryError(429, 'TELEMETRY_BUSY', 'Telemetry intake is busy; retry configuration');
      const token = v.enabled && v.requireToken ? randomBytes(32).toString('hex') : this.token;
      const tmp = this.configPath + '.' + randomBytes(8).toString('hex') + '.tmp';
      await mkdir(dirname(this.configPath), { recursive: true });
      try { await writeFile(tmp, JSON.stringify({ enabled: v.enabled, requireToken: v.requireToken, token }), { mode: 0o600, flag: 'wx' }); await rename(tmp, this.configPath); }
      finally { await unlink(tmp).catch(e => { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new TelemetryError(503, 'TELEMETRY_CONFIG', 'Cannot clean up local telemetry configuration'); }); }
      this.token = token; this.requireToken = v.requireToken; this.enabled = v.enabled;
      return { ...await this.status(port), ...(v.enabled && v.requireToken ? { token } : {}) };
    });
    this.configTask = run.then(() => undefined, () => undefined); return run;
  }
  ingest(req: IncomingMessage, file = false): Promise<TelemetryImportResult> {
    if (this.closed || this.busy) return Promise.reject(new TelemetryError(429, 'TELEMETRY_BUSY', 'Telemetry intake busy; retry later'));
    this.busy = true;
    const task = this.run(req, file).finally(() => { this.busy = false; this.task = null; }); this.task = task; return task;
  }
  private async run(req: IncomingMessage, file: boolean): Promise<TelemetryImportResult> {
    await this.configTask; await this.ready();
    if (!file) {
      if (!this.enabled) throw new TelemetryError(403, 'TELEMETRY_DISABLED', 'Enable OpenTelemetry in Data intake first');
      if (this.requireToken) {
        const expected = Buffer.from('Bearer ' + this.token), actual = Buffer.from(req.headers.authorization ?? '');
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new TelemetryError(401, 'TELEMETRY_UNAUTHORIZED', 'Valid Bearer token required');
      }
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json' && !(file && type === 'application/x-ndjson')) throw new TelemetryError(415, 'TELEMETRY_MEDIA_TYPE', protocol);
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'gzip' && req.headers['content-encoding'] !== 'identity') throw new TelemetryError(415, 'TELEMETRY_MEDIA_TYPE', 'Supported Content-Encoding: gzip or identity; ' + protocol);
    if (Number(req.headers['content-length'] ?? 0) > MAX) limit();
    let wire = 0, size = 0;
    const parts: Buffer[] = [], gzip = req.headers['content-encoding'] === 'gzip' ? createGunzip() : null;
    const onData = (chunk: Buffer) => { wire += chunk.length; if (wire > MAX) stream.destroy(new TelemetryError(413, 'TELEMETRY_LIMIT', 'Compressed request exceeds 8 MiB')); };
    req.on('data', onData);
    const stream = req.pipe(gzip ?? new PassThrough());
    const aborted = () => stream.destroy(new TelemetryError(400, 'TELEMETRY_INVALID', 'Incomplete telemetry body'));
    req.once('aborted', aborted);
    req.once('error', aborted);
    const timeout = setTimeout(() => stream.destroy(new TelemetryError(408, 'TELEMETRY_TIMEOUT', 'Telemetry upload deadline exceeded')), 30000); timeout.unref();
    try {
      for await (const chunk of stream) { const b = Buffer.from(chunk as Uint8Array); size += b.length; if (size > MAX || wire > MAX) limit(); parts.push(b); }
    } catch (error) { if (error instanceof TelemetryError) throw error; throw new TelemetryError(400, 'TELEMETRY_INVALID', 'Malformed gzip or incomplete telemetry request'); }
    finally { clearTimeout(timeout); req.removeListener('data', onData); req.removeListener('aborted', aborted); req.unpipe(stream); stream.destroy(); }
    const workerPath = import.meta.url.startsWith('file:') && !import.meta.url.endsWith('.ts') ? fileURLToPath(new URL('./telemetry-worker.js', import.meta.url)) : join(process.cwd(), 'server-dist', 'telemetry-worker.js');
    const worker = new Worker(workerPath, { workerData: { bytes: Buffer.concat(parts), mode: file ? type === 'application/x-ndjson' ? 'jsonl' : 'json' : 'otlp' }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 } });
    this.worker = worker;
    let parsed: { format: TelemetrySource; spans: TelemetrySpan[] };
    try {
      parsed = await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new TelemetryError(408, 'TELEMETRY_TIMEOUT', 'Telemetry parsing deadline exceeded')), 30000); deadline.unref();
        const finish = () => clearTimeout(deadline);
        worker.once('message', (v: { ok: boolean; result: typeof parsed; status: number; code: ErrorCode; message: string }) => { finish(); if (v.ok) resolve(v.result); else reject(new TelemetryError(v.status, v.code, v.message)); });
        worker.once('error', () => { finish(); reject(new TelemetryError(503, 'TELEMETRY_WORKER', 'Telemetry parser unavailable; build worker entries first')); });
        worker.once('exit', () => { finish(); reject(new TelemetryError(503, 'TELEMETRY_WORKER', 'Telemetry parser stopped')); });
      });
    } finally { await worker.terminate(); this.worker = null; }
    if (this.closed) throw new TelemetryError(503, 'TELEMETRY_CLOSED', 'Telemetry intake stopped');
    try {
      const stored = await withWalCapacity(this.db, () => storeTelemetry(this.db, parsed.spans, file ? 'imported' : 'collected'));
      for (const key of stored.changed) this.notify(key);
      if (!file) { this.stats.spanCount += new Set(parsed.spans.map(s=>JSON.stringify([s.traceId,s.spanId]))).size; this.stats.traceCount += new Set(parsed.spans.map(s => s.traceId)).size; this.stats.lastReceivedAt = new Date().toISOString(); }
      return { format: parsed.format, spanCount: parsed.spans.length, taskIds: stored.taskIds };
    } catch (error) { if (error instanceof CaptureCapacityError) {
        if (error.code === 'CAPTURE_METADATA_LIMIT') throw new TelemetryError(413, 'TELEMETRY_WAL_LIMIT', 'Telemetry WAL too large: still at or above 8000000 bytes after a nonblocking checkpoint; release long-lived readers and retry');
        throw new TelemetryError(503, 'TELEMETRY_CAPACITY', 'Telemetry WAL admission unavailable; retry after current database activity settles');
      }
      throw error; }
  }
  async close() { this.closed = true; if (this.worker) await this.worker.terminate(); await this.task?.then(() => undefined, () => undefined); await this.configTask; }
}
