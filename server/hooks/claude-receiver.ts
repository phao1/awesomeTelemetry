import type { IncomingMessage } from 'node:http';
import type { Database } from 'better-sqlite3';
import type { ClaudeHookConfigureResult, ClaudeHookDetail, ClaudeHookPage, ClaudeHookStatus } from '../../src/core/claude-hooks.js';
import type { CaptureBodyStore } from '../proxy/body-store.js';
import { readAnalysisBody } from '../proxy/analysis-source.js';
import { CaptureCapacityError, withCaptureCapacity } from '../proxy/capture-capacity.js';
import { hookTotals, insertClaudeHook, listClaudeHooks, projectClaudeHook, readClaudeHook } from '../storage/claude-hooks.js';
import type { HookQuery } from '../storage/claude-hooks.js';
import type { ClaudeHookControl } from './claude-control.js';
import { ClaudeHookError } from './claude-control.js';

export const HOOK_MAX_BYTES = 256 * 1024;
const unavailable = () => new ClaudeHookError(503, 'HOOK_UNAVAILABLE');

/** Bounded strict UTF8 request read; never follows paths declared in JSON. */
export async function readHookJson(req: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<{ raw: string; value: unknown }> {
  if (signal.aborted) throw unavailable();
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new ClaudeHookError(413, 'HOOK_LIMIT');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0, done = false;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', fail); signal.removeEventListener('abort', fail); };
    const finish = (error?: unknown) => { if (done) return; done = true; cleanup(); if (error) { req.pause(); reject(error); } };
    const fail = () => finish(unavailable());
    const data = (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) finish(new ClaudeHookError(413, 'HOOK_LIMIT')); else chunks.push(chunk); };
    const end = () => {
      if (done) return;
      try {
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes)), value: unknown = JSON.parse(raw);
        finish(); resolve({ raw, value });
      } catch { finish(new ClaudeHookError(400, 'BAD_REQUEST')); }
    };
    const timer = setTimeout(fail, 2000); timer.unref();
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', fail); signal.addEventListener('abort', fail, { once: true });
  });
}

/** One local receiver owns accepted writes, detail reads, control and saved hints. */
export class ClaudeHookReceiver {
  private readonly db: Database;
  private readonly control: ClaudeHookControl;
  private readonly getStore: () => Promise<CaptureBodyStore>;
  private readonly notify: (latestId: number) => void;
  private readonly writes = new Set<Promise<unknown>>();
  private readonly reads = new Set<Promise<unknown>>();
  private readonly controllers = new Set<AbortController>();
  private configuring: Promise<ClaudeHookConfigureResult> | null = null;
  private closing = false;
  private hint?: ReturnType<typeof setTimeout>;
  private latestId = 0;
  constructor(db: Database, control: ClaudeHookControl, getStore: () => Promise<CaptureBodyStore>, notify: (id: number) => void) {
    this.db = db; this.control = control; this.getStore = getStore; this.notify = notify;
  }
  private available(): void { if (this.closing) throw new ClaudeHookError(503, 'SERVER_SHUTTING_DOWN'); }
  async status(): Promise<ClaudeHookStatus> { this.available(); return { ...await this.control.status(), ...hookTotals(this.db) }; }
  configure(expectedRevision: number, enabled: boolean, port: number, confirmRaw: boolean): Promise<ClaudeHookConfigureResult> {
    this.available();
    if (this.configuring) throw new ClaudeHookError(409, 'HOOK_BUSY');
    const task = (async () => {
      const settings = await this.control.configure(expectedRevision, enabled, port, confirmRaw);
      if (!enabled) await Promise.allSettled([...this.writes]);
      return { status: { ...await this.control.status(), ...hookTotals(this.db) }, settings };
    })();
    this.configuring = task;
    void task.then(() => { this.configuring = null; }, () => { this.configuring = null; });
    return task;
  }
  private own<T>(set: Set<Promise<unknown>>, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.available();
    if (set.size >= 4) throw new ClaudeHookError(503, 'HOOK_LIMIT');
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    this.controllers.add(controller);
    const task = Promise.resolve().then(() => action(controller.signal)); set.add(task);
    const cleanup = () => { set.delete(task); this.controllers.delete(controller); signal.removeEventListener('abort', abort); };
    void task.then(cleanup, cleanup); return task;
  }
  receive(req: IncomingMessage, signal: AbortSignal): Promise<void> {
    return this.own(this.writes, signal, async ownedSignal => {
      await this.control.authorize(req.headers.authorization);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new ClaudeHookError(400, 'BAD_REQUEST');
      const receivedAt = new Date().toISOString();
      const { raw, value } = await readHookJson(req, HOOK_MAX_BYTES, ownedSignal), projection = projectClaudeHook(value);
      if (hookTotals(this.db).receivedCount >= 10000) throw new ClaudeHookError(503, 'HOOK_LIMIT');
      try {
        const store = await this.getStore();
        if (ownedSignal.aborted) throw unavailable();
        const writer = store.begin(); writer.append(Buffer.from(raw)); const ref = await writer.finish();
        if (ref.status === 'quota_exceeded') throw new ClaudeHookError(503, 'HOOK_LIMIT');
        if (ref.status !== 'complete' || ownedSignal.aborted) throw unavailable();
        const id = await withCaptureCapacity(this.db, () => {
          if (ownedSignal.aborted) throw unavailable();
          return insertClaudeHook(this.db, projection, ref, receivedAt);
        });
        this.latestId = Math.max(this.latestId, id);
        if (!this.closing && !this.hint) {
          this.hint = setTimeout(() => { this.hint = undefined; if (!this.closing) this.notify(this.latestId); }, 200); this.hint.unref();
        }
      } catch (error) {
        if (error instanceof ClaudeHookError) throw error;
        if (error instanceof CaptureCapacityError && error.code !== 'CAPTURE_METADATA_UNAVAILABLE') throw new ClaudeHookError(503, 'HOOK_LIMIT');
        throw unavailable();
      }
    });
  }
  async page(query: HookQuery): Promise<ClaudeHookPage> {
    const status = await this.status(), page: ClaudeHookPage = { status, ...listClaudeHooks(this.db, query) };
    // Escaped native IDs can make fifty rows exceed the wire budget. Keep the
    // contiguous prefix and cursor so no retained observation is skipped.
    while (Buffer.byteLength(JSON.stringify(page)) > 64 * 1024 && page.items.length > 1) {
      page.items.pop(); page.hasMore = true; page.nextCursor = page.items.at(-1)!.id;
    }
    if (Buffer.byteLength(JSON.stringify(page)) > 64 * 1024) throw new ClaudeHookError(503, 'HOOK_LIMIT');
    return page;
  }
  detail(id: number, signal: AbortSignal): Promise<ClaudeHookDetail> {
    return this.own(this.reads, signal, async ownedSignal => {
      try {
        const row = readClaudeHook(this.db, id);
        if (!row) throw new ClaudeHookError(404, 'HOOK_EVENT_NOT_FOUND');
        const store = await this.getStore(); if (ownedSignal.aborted) throw unavailable();
        const result = await readAnalysisBody({ openRead: refId => {
          const stream = store.openRead(refId), abort = () => stream.destroy(new Error('Cancelled'));
          ownedSignal.addEventListener('abort', abort, { once: true }); stream.once('close', () => ownedSignal.removeEventListener('abort', abort));
          if (ownedSignal.aborted) abort(); return stream;
        } }, row.ref, HOOK_MAX_BYTES);
        if (!result.ok || ownedSignal.aborted) throw unavailable();
        const projection = projectClaudeHook(JSON.parse(result.body));
        if (Object.entries(projection).some(([key, value]) => row.summary[key as keyof typeof row.summary] !== value) || Buffer.byteLength(result.body) !== row.summary.payloadBytes) throw unavailable();
        const detail = { ...row.summary, rawJson: result.body, sha256: row.ref.sha256 };
        if (Buffer.byteLength(JSON.stringify(detail)) > 1024 * 1024) throw new ClaudeHookError(503, 'HOOK_LIMIT');
        return detail;
      } catch (error) { if (error instanceof ClaudeHookError && error.status === 404) throw error; throw unavailable(); }
    });
  }
  async close(): Promise<void> {
    this.closing = true; clearTimeout(this.hint); this.hint = undefined;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.writes, ...this.reads, ...(this.configuring ? [this.configuring] : [])]);
  }
}
