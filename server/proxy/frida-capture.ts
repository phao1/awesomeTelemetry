import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { runtimeResourcePath } from '../runtime-paths.js';

export interface FridaCaptureData { pid: number; model: string | null; sessionId: string | null; jsonData: string }
export const FRIDA_JSON_BYTES = 256 * 1024;
export const FRIDA_FRAME_BYTES = 1024 * 1024;
export class FridaDecodeError extends Error {
  readonly code: 'FRIDA_FRAME_INVALID' | 'FRIDA_FRAME_INCOMPLETE' | 'FRIDA_FRAME_LIMIT' | 'FRIDA_SCRIPT_UNIMPLEMENTED';
  constructor(code: FridaDecodeError['code']) { super(code); this.code = code; }
}
const START = '[NEW CHAT DATA]', END = '[END]';
function encoding(bytes: Uint8Array): 'utf-8' | 'utf-16le' {
  return (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[1] === 0 && bytes[0] !== undefined && bytes[0] < 128) ? 'utf-16le' : 'utf-8';
}
function decodeFrame(body: string): FridaCaptureData {
  if (Buffer.byteLength(body) > FRIDA_FRAME_BYTES) throw new FridaDecodeError('FRIDA_FRAME_LIMIT');
  let jsonData = body.trim();
  if (jsonData.startsWith('[HEX]')) {
    const hex = jsonData.slice(5).replace(/\s/g, '');
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[\da-f]+$/i.test(hex)) throw new FridaDecodeError('FRIDA_FRAME_INVALID');
    const bytes = Buffer.from(hex, 'hex');
    try { jsonData = new TextDecoder(encoding(bytes), { fatal: true }).decode(bytes).trim(); }
    catch { throw new FridaDecodeError('FRIDA_FRAME_INVALID'); }
  }
  if (Buffer.byteLength(jsonData) > FRIDA_JSON_BYTES) throw new FridaDecodeError('FRIDA_FRAME_LIMIT');
  let value: unknown;
  try { value = JSON.parse(jsonData); } catch { throw new FridaDecodeError('FRIDA_FRAME_INVALID'); }
  if (typeof value !== 'object' || value === null) throw new FridaDecodeError('FRIDA_FRAME_INVALID');
  if ('note' in value && value.note === 'monitor skeleton') throw new FridaDecodeError('FRIDA_SCRIPT_UNIMPLEMENTED');
  return { pid: 0, model: null, sessionId: null, jsonData };
}

/** FC-001: retained tail and streaming Unicode, no successful partial frames. */
export class FridaOutputDecoder {
  private decoder: TextDecoder | null = null;
  private prefix = Buffer.alloc(0);
  private buffer = '';
  private active = false;
  private scan = 0;
  private quoted = false;
  private escaped = false;
  private ended = false;
  private readonly onData: (capture: FridaCaptureData) => void;
  private readonly onError: (error: FridaDecodeError) => void;
  constructor(onData: (capture: FridaCaptureData) => void, onError: (error: FridaDecodeError) => void) { this.onData = onData; this.onError = onError; }
  get bufferedCharacters(): number { return this.buffer.length + this.prefix.length; }
  push(chunk: Uint8Array): void {
    if (this.ended) return;
    try {
      if (this.decoder === null) {
        const need = Math.min(2 - this.prefix.length, chunk.length);
        this.prefix = Buffer.concat([this.prefix, chunk.subarray(0, need)]);
        chunk = chunk.subarray(need);
        if (this.prefix.length < 2) return;
        this.decoder = new TextDecoder(encoding(this.prefix), { fatal: true });
        this.text(this.decoder.decode(this.prefix, { stream: true }));
        this.prefix = Buffer.alloc(0);
      }
      for (let offset = 0; offset < chunk.length; offset += 4096) this.text(this.decoder.decode(chunk.subarray(offset, offset + 4096), { stream: true }));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      this.ended = true; this.buffer = ''; this.onError(new FridaDecodeError('FRIDA_FRAME_INVALID'));
    }
  }
  finish(): void {
    if (this.ended) return;
    try {
      if (this.decoder !== null) this.text(this.decoder.decode());
      else if (this.prefix.length > 0) this.text(new TextDecoder('utf-8', { fatal: true }).decode(this.prefix));
    }
    catch { this.onError(new FridaDecodeError('FRIDA_FRAME_INVALID')); }
    if (this.active || (this.buffer.length > 0 && START.startsWith(this.buffer))) this.onError(new FridaDecodeError('FRIDA_FRAME_INCOMPLETE'));
    this.ended = true; this.buffer = ''; this.prefix = Buffer.alloc(0);
  }
  private reset(): void { this.scan = 0; this.quoted = false; this.escaped = false; }
  private text(text: string): void {
    this.buffer += text;
    while (true) {
      if (!this.active) {
        const start = this.buffer.indexOf(START);
        if (start < 0) {
          let keep = Math.min(this.buffer.length, START.length - 1);
          while (keep > 0 && !START.startsWith(this.buffer.slice(-keep))) keep--;
          this.buffer = keep === 0 ? '' : this.buffer.slice(-keep); return;
        }
        this.buffer = this.buffer.slice(start + START.length); this.active = true; this.reset();
      }
      let dispatched = false;
      for (; this.scan < this.buffer.length; this.scan++) {
        const c = this.buffer[this.scan];
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (c === '\\') this.escaped = true;
          else if (c === '"') this.quoted = false;
          continue;
        }
        if (c === '"') { this.quoted = true; continue; }
        if (c !== '[') continue;
        const rest = this.buffer.slice(this.scan, this.scan + START.length);
        if ((rest.length < END.length && END.startsWith(rest)) || (rest.length < START.length && START.startsWith(rest))) break;
        if (this.buffer.startsWith(START, this.scan)) {
          this.onError(new FridaDecodeError('FRIDA_FRAME_INCOMPLETE'));
          this.buffer = this.buffer.slice(this.scan + START.length); this.reset(); dispatched = true; break;
        }
        if (this.buffer.startsWith(END, this.scan)) {
          const body = this.buffer.slice(0, this.scan);
          this.buffer = this.buffer.slice(this.scan + END.length); this.active = false; this.reset();
          let capture: FridaCaptureData | null = null;
          try { capture = decodeFrame(body); } catch (error) { this.onError(error instanceof FridaDecodeError ? error : new FridaDecodeError('FRIDA_FRAME_INVALID')); }
          if (capture !== null) this.onData(capture);
          dispatched = true; break;
        }
      }
      if (dispatched) continue;
      if (Buffer.byteLength(this.buffer) > FRIDA_FRAME_BYTES) {
        this.onError(new FridaDecodeError('FRIDA_FRAME_LIMIT')); this.buffer = ''; this.active = false; this.reset();
      }
      return;
    }
  }
}

export function parseFridaOutput(stdout: string): FridaCaptureData[] {
  const captures: FridaCaptureData[] = [];
  const errors: FridaDecodeError[] = [];
  const decoder = new FridaOutputDecoder(capture => captures.push(capture), error => errors.push(error));
  decoder.push(Buffer.from(stdout)); decoder.finish();
  if (errors.length > 0) throw errors[0];
  return captures;
}

export type FridaSpawn = (command: string, args: string[]) => ChildProcess;
const spawnChild: FridaSpawn = (command, args) => spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
export async function validateFridaMonitorScript(scriptPath: string): Promise<void> {
  const source = await readFile(scriptPath, 'utf8');
  if (source.includes('monitor skeleton') || source.includes('TODO(P-3)')) throw new FridaDecodeError('FRIDA_SCRIPT_UNIMPLEMENTED');
}
export function runFridaMonitor(pid: number, scriptPath: string, onData: (capture: FridaCaptureData) => void,
  onError: (error: Error) => void = error => console.error(error.message), spawnProcess: FridaSpawn = spawnChild): { child: ChildProcess } {
  const child = spawnProcess('frida', ['-p', String(pid), '-l', scriptPath]);
  const decoder = new FridaOutputDecoder(capture => onData({ ...capture, pid }), onError);
  child.stdout?.on('data', (chunk: Buffer) => decoder.push(chunk));
  child.stderr?.resume(); // drain without retaining unbounded/sensitive diagnostics
  child.once('close', () => decoder.finish());
  return { child };
}

/** Only exact probe marker establishes the module; bounded async subprocesses. */
export async function discoverFridaTarget(deps: { platform?: string; spawnProcess?: FridaSpawn; timeoutMs?: number } = {}): Promise<number> {
  if ((deps.platform ?? process.platform) !== 'win32') throw new Error('FRIDA_TARGET_NOT_FOUND: Windows is required');
  const spawnProcess = deps.spawnProcess ?? spawnChild;
  const execute = (command: string, args: string[], probe = false): Promise<string> => new Promise((resolve, reject) => {
    const child = spawnProcess(command, args);
    let output = '', failed = false, settled = false, markerSeen = false;
    const finish = (error?: Error): void => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(output); };
    const fail = (): void => { failed = true; child.kill(); };
    const timer = setTimeout(fail, deps.timeoutMs ?? 5000);
    timer.unref();
    child.stdout?.on('data', (chunk: Buffer) => {
      if (failed || markerSeen) return;
      if (Buffer.byteLength(output) + chunk.length > 65536) { fail(); return; }
      output += chunk.toString('utf8');
      if (probe && /(?:^|\r?\n)\[AI_AGENT_(?:FOUND|NOT_FOUND)\]\r?\n/.test(output)) { markerSeen = true; clearTimeout(timer); child.kill(); }
    });
    child.stderr?.resume();
    child.once('error', () => { failed = true; });
    child.once('close', code => finish(failed || (!markerSeen && code !== 0) ? new Error('FRIDA_TARGET_NOT_FOUND: probe failed') : undefined));
  });
  const output = await execute('tasklist', ['/FI', 'IMAGENAME eq Trae CN.exe', '/FO', 'CSV', '/NH']);
  const pids = [...output.matchAll(/^"Trae CN\.exe","(\d+)"/gmi)].map(match => Number(match[1])).filter(pid => Number.isSafeInteger(pid) && pid > 0);
  if (pids.length > 32) throw new Error('FRIDA_TARGET_NOT_FOUND: target limit');
  for (const pid of pids) {
    const probe = await execute('frida', ['-p', String(pid), '-l', runtimeResourcePath('scripts/frida-check-module.js')], true);
    if (probe.split(/\r?\n/).some(line => line.trim() === '[AI_AGENT_FOUND]')) return pid;
  }
  throw new Error('FRIDA_TARGET_NOT_FOUND: ai_agent.dll not detected');
}
