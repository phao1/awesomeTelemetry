import { createHash } from 'node:crypto';
import type { OptimizerSessionReader } from './process-monitor.js';
import type { RsiIteration, RsiPrd } from '../../src/core/rsi-types.js';
import { open, realpath, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { RsiStore } from './queue.js';
import { projectTrajectoryForOptimizer } from '../../src/core/rsi-visibility.js';

export class RsiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export const notFound = (): never => { throw new RsiError(404, 'RSI_NOT_FOUND'); };
export const conflict = (): never => { throw new RsiError(409, 'RSI_CONFLICT'); };
export function validId(id: string): string { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new RsiError(400, 'RSI_INVALID_REQUEST'); return id; }
export function strictObject(v: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  const o = v as Record<string, unknown>;
  if (required.some(k => !Object.hasOwn(o, k)) || Object.keys(o).some(k => ![...required, ...optional].includes(k))) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  return o;
}
export function page<T extends { id: string }>(items: T[], query: URLSearchParams): { items: T[]; nextCursor: string | null } {
  const limitText = query.get('limit') ?? '50', cursor = query.get('cursor');
  if (!/^[1-9]\d*$/.test(limitText) || Number(limitText) > 200 || cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  const sorted = items.filter(i => cursor === null || i.id > cursor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const selected = sorted.slice(0, Number(limitText));
  return { items: selected, nextCursor: sorted.length > selected.length ? selected.at(-1)!.id : null };
}
export async function safeArtifact(root: string, path: string): Promise<string> {
  const base = await realpath(root), file = await realpath(resolve(root, path));
  if (!file.startsWith(base + sep)) throw new RsiError(404, 'RSI_NOT_FOUND');
  return file;
}
export async function boundedJson(root: string, path: string, limit = 1024 * 1024): Promise<unknown> {
  const file = await open(await safeArtifact(root, path), 'r');
  try { const stat = await file.stat(); if (!stat.isFile() || stat.size > limit) throw new RsiError(413, 'RSI_LIMIT'); return JSON.parse(await file.readFile('utf8')); }
  finally { await file.close(); }
}
export interface TrajectoryPage { file: string; content: string; nextOffset: number | null; truncated: boolean }
export async function trajectory(root: string, directory: string, query: URLSearchParams, optimizer: boolean): Promise<TrajectoryPage> {
  const kind = query.get('file') ?? 'responses';
  const start = query.get('offset') ?? '0', count = query.get('limit') ?? '65536';
  if (!['responses', 'last-request'].includes(kind) || !/^\d+$/.test(start) || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(start)) || Number(count) < 1 || Number(count) > 65536) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  const relative = join(directory, 'proxy', kind === 'responses' ? 'responses.jsonl' : 'last-request.json');
  // Project full bounded traces first, then page the sanitized serialized bytes.
  let data: Buffer;
  try {
    if (optimizer) {
      if (kind === 'last-request') data = Buffer.from(JSON.stringify(projectTrajectoryForOptimizer(await boundedJson(root, relative, 8 * 1024 * 1024), kind)));
      else {
        const filename = await safeArtifact(root, relative), file = await open(filename, 'r');
        try { if ((await file.stat()).size > 8 * 1024 * 1024) throw new RsiError(413, 'RSI_LIMIT'); }
        finally { await file.close(); }
        const records: string[] = [];
        for await (const line of createInterface({ input: createReadStream(filename), crlfDelay: Infinity })) {
          if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw new RsiError(413, 'RSI_LIMIT');
          const projected = projectTrajectoryForOptimizer(JSON.parse(line), kind);
          if (projected) records.push(JSON.stringify(projected));
        }
        data = Buffer.from(records.join('\n'));
      }
    } else {
      const filename = await safeArtifact(root, relative), file = await open(filename, 'r');
      try { if ((await file.stat()).size > 8 * 1024 * 1024) throw new RsiError(413, 'RSI_LIMIT'); data = await readFile(filename); }
      finally { await file.close(); }
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') data = Buffer.alloc(0); else throw e; }
  const offset = Number(start); if (offset > data.length || offset < data.length && (data[offset]! & 0xc0) === 0x80) throw new RsiError(400, 'RSI_INVALID_REQUEST');
  let end = Math.min(data.length, offset + Number(count));
  // A tiny page still makes progress through a complete UTF8 codepoint.
  while (end < data.length && (data[end]! & 0xc0) === 0x80) end++;
  const content = data.subarray(offset, end).toString('utf8');
  return { file: kind, content, nextOffset: end < data.length ? end : null, truncated: data.includes(Buffer.from('"truncated":true')) };
}
export async function runTrajectory(store: RsiStore, runId: string, query: URLSearchParams, optimizer: boolean): Promise<TrajectoryPage> {
  const run = store.list('run_put').find(r => r.id === validId(runId)); if (!run) return notFound();
  const evaluation = store.list('evaluation_put').find(e => e.id === run.evaluationId);
  if (!evaluation || optimizer && !['smoke', 'train'].includes(evaluation.phase) || !run.artifactPath) return notFound();
  return trajectory(store.root, run.artifactPath, query, optimizer);
}

/** P5 human-only process evidence, bound through the immutable first submission. */
export class StoredOptimizerSessionReader implements OptimizerSessionReader {
  private readonly store: RsiStore;
  constructor(store:RsiStore){this.store=store;}
  async read(iteration:RsiIteration): Promise<{prd:RsiPrd;trajectory:string}|null>{
    if(iteration.taskId!==this.store.taskId)return null;
    const saved=this.store.list('iteration_put').find(i=>i.id===iteration.id&&i.commit===iteration.commit&&i.parentId===iteration.parentId);
    if(!saved)return null;
    const sessions=this.store.list('session_put').filter(s=>s.state==='submitted'&&s.submissionId!==null).sort((a,b)=>b.seq-a.seq);
    const session=sessions.find(s=>{
      const q=this.store.list('queue_put').find(q=>q.id===s.submissionId);
      return q?.command.action==='submit'&&q.requestedBy==='optimizer'&&q.command.commit===saved.commit&&q.command.parentId===saved.parentId
        &&(q.iterationId===saved.id||createHash('sha256').update(`iteration:${q.id}`).digest('hex')===saved.id);
    });
    if(!session)return null;
    try{
      const filename=await safeArtifact(this.store.root,join(session.artifactPath,'proxy/responses.jsonl')),handle=await open(filename,'r');
      try{if(!(await handle.stat()).isFile()||(await handle.stat()).size>8*1024*1024)return null;}finally{await handle.close();}
      const responses:unknown[]=[];let bytes=0;
      for await(const line of createInterface({input:createReadStream(filename),crlfDelay:Infinity})){
        bytes+=Buffer.byteLength(line)+1;if(bytes>8*1024*1024)return null;responses.push(JSON.parse(line));
      }
      const lastRequest=await boundedJson(this.store.root,join(session.artifactPath,'proxy/last-request.json'),8*1024*1024);
      if(!responses.length||!lastRequest)return null;
      return{prd:{observation:saved.prd.observation,hypothesis:saved.prd.hypothesis,changes:[...saved.prd.changes],expectedImpact:saved.prd.expectedImpact},trajectory:JSON.stringify({responses,lastRequest})};
    }catch{return null;}
  }
}
