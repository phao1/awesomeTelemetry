import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type ExperimentLabel = 'pass' | 'fail' | 'mixed' | 'unrated';
export interface ExperimentRun { sessionKey: string; label: ExperimentLabel; note: string | null }
export interface ExperimentInput {
  name: string; task: string | null; inputVersion: string | null;
  modelParameters: string | null; toolSet: string | null;
  mode: 'controlled' | 'natural'; runs: ExperimentRun[];
}
export interface ExperimentRecord extends ExperimentInput { id: string; createdAt: string; updatedAt: string }
export interface ExperimentSnapshot { version: 1; revision: number; records: ExperimentRecord[] }
export type ExperimentReason = 'INVALID' | 'NOT_FOUND' | 'CONFLICT' | 'BUSY' | 'LIMIT' | 'UNAVAILABLE' | 'SESSION_UNAVAILABLE';
export class ExperimentError extends Error {
  readonly reason: ExperimentReason;
  readonly status: number;
  constructor(reason: ExperimentReason, status = 400) { super(`Experiment records: ${reason}`); this.reason = reason; this.status = status; }
}
const MAX_FILE = 1024 * 1024;
const FIELDS = ['name', 'task', 'inputVersion', 'modelParameters', 'toolSet', 'mode', 'runs'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(reason: ExperimentReason = 'INVALID', status = 400): never { throw new ExperimentError(reason, status); }
export function objectFields(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== fields.length || Object.keys(obj).some(k => !fields.includes(k))) fail();
  return obj;
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail();
  return value;
}
function optional(value: unknown, max: number): string | null { return value === null ? null : bounded(value, max); }
export function validateExperimentInput(value: unknown): ExperimentInput {
  const v = objectFields(value, FIELDS);
  if (v.mode !== 'controlled' && v.mode !== 'natural') fail();
  if (!Array.isArray(v.runs) || v.runs.length > 16) fail();
  const runs = v.runs.map((entry: unknown): ExperimentRun => {
    const r = objectFields(entry, ['sessionKey', 'label', 'note']);
    if (!['pass', 'fail', 'mixed', 'unrated'].includes(String(r.label))) fail();
    return { sessionKey: bounded(r.sessionKey, 256), label: r.label as ExperimentLabel, note: optional(r.note, 2000) };
  });
  if (new Set(runs.map(r => r.sessionKey)).size !== runs.length) fail();
  const result: ExperimentInput = { name: bounded(v.name, 120), task: optional(v.task, 2000), inputVersion: optional(v.inputVersion, 256), modelParameters: optional(v.modelParameters, 2000), toolSet: optional(v.toolSet, 2000), mode: v.mode, runs };
  if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) fail('LIMIT', 413);
  return result;
}
function revision(v: unknown): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(); return v; }
function storedRecord(value: unknown): ExperimentRecord {
  const v = objectFields(value, [...FIELDS, 'id', 'createdAt', 'updatedAt']);
  if (typeof v.id !== 'string' || !UUID.test(v.id)) fail();
  for (const k of ['createdAt', 'updatedAt']) {
    if (typeof v[k] !== 'string' || !Number.isFinite(Date.parse(v[k])) || new Date(v[k]).toISOString() !== v[k]) fail();
  }
  return { ...validateExperimentInput(Object.fromEntries(FIELDS.map(k => [k, v[k]]))), id: v.id, createdAt: v.createdAt as string, updatedAt: v.updatedAt as string };
}
function isCode(error: unknown, code: string): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === code; }

/** Independent manual declarations only; no original-session IO or execution. */
export class ExperimentRegistry {
  readonly path: string;
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; this.path = join(directory, 'experiment-records.json'); }
  async list(): Promise<ExperimentSnapshot> {
    let file;
    try {
      let info;
      try { info = await lstat(this.path); } catch (e) { if (isCode(e, 'ENOENT')) return { version: 1, revision: 0, records: [] }; throw e; }
      if (!info.isFile() || info.isSymbolicLink()) fail();
      file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_FILE) fail();
      const buffer = Buffer.alloc(MAX_FILE + 1); let size = 0;
      while (size < buffer.length) { const r = await file.read(buffer, size, buffer.length - size, size); if (!r.bytesRead) break; size += r.bytesRead; }
      if (size > MAX_FILE) fail();
      const v = objectFields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown, ['version', 'revision', 'records']);
      if (v.version !== 1 || !Array.isArray(v.records) || v.records.length > 100) fail();
      const records = v.records.map(storedRecord);
      if (new Set(records.map(r => r.id)).size !== records.length) fail();
      return { version: 1, revision: revision(v.revision), records };
    } catch { throw new ExperimentError('UNAVAILABLE', 503); }
    finally { await file?.close(); }
  }
  async mutate(action: 'create' | 'update' | 'delete', id: string | null, expectedRevision: unknown, input: unknown,
    existingScanKeys: (keys: string[]) => Promise<string[]> | string[]): Promise<ExperimentSnapshot> {
    const expected = revision(expectedRevision);
    if (action !== 'create' && (id === null || !UUID.test(id))) fail('NOT_FOUND', 404);
    const validated = action === 'delete' ? null : validateExperimentInput(input);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let lock;
    try { lock = await open(`${this.path}.lock`, 'wx', 0o600); }
    catch (e) { throw new ExperimentError(isCode(e, 'EEXIST') ? 'BUSY' : 'UNAVAILABLE', isCode(e, 'EEXIST') ? 409 : 503); }
    const temp = `${this.path}.${randomUUID()}.tmp`;
    let owner: { dev: number; ino: number } | undefined, output, tempOwned = false;
    try {
      owner = await lock.stat();
      const snapshot = await this.list();
      if (snapshot.revision !== expected) fail('CONFLICT', 409);
      if (expected === Number.MAX_SAFE_INTEGER) fail('LIMIT', 413);
      const old = snapshot.records.find(r => r.id === id);
      if (action !== 'create' && !old) fail('NOT_FOUND', 404);
      if (action === 'create' && snapshot.records.length >= 100) fail('LIMIT', 413);
      if (validated) {
        const oldKeys = new Set(old?.runs.map(r => r.sessionKey));
        const added = validated.runs.map(r => r.sessionKey).filter(key => !oldKeys.has(key));
        if (added.length) {
          const existing = new Set(await existingScanKeys(added));
          if (added.some(key => !existing.has(key))) fail('SESSION_UNAVAILABLE');
        }
        const stamp = new Date().toISOString();
        const record = { ...validated, id: old?.id ?? randomUUID(), createdAt: old?.createdAt ?? stamp, updatedAt: stamp };
        if (old) snapshot.records[snapshot.records.indexOf(old)] = record; else snapshot.records.push(record);
      } else snapshot.records = snapshot.records.filter(r => r.id !== id);
      snapshot.revision++;
      const bytes = JSON.stringify(snapshot);
      if (Buffer.byteLength(bytes) > MAX_FILE) fail('LIMIT', 413);
      output = await open(temp, 'wx', 0o600); tempOwned = true;
      await output.writeFile(bytes, 'utf8'); await output.sync(); await output.close(); output = undefined;
      await rename(temp, this.path); tempOwned = false;
      return snapshot;
    } finally {
      let cleanupFailed = false;
      try { await output?.close(); } catch { cleanupFailed = true; }
      try { if (tempOwned) await unlink(temp); } catch { cleanupFailed = true; }
      try { await lock.close(); } catch { cleanupFailed = true; }
      try {
        const current = await lstat(`${this.path}.lock`);
        if (owner && owner.dev === current.dev && owner.ino === current.ino && !current.isSymbolicLink()) await unlink(`${this.path}.lock`); else cleanupFailed = true;
      } catch { cleanupFailed = true; }
      if (cleanupFailed) fail('UNAVAILABLE', 503);
    }
  }
}
