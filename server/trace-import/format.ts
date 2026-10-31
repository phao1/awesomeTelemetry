import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { TraceLogSession, TraceLogTurn } from '../../src/core/trace-types.js';

export class TraceImportError extends Error {
  readonly code: 'TRACE_IMPORT_INVALID' | 'TRACE_IMPORT_LIMIT' | 'TRACE_IMPORT_BUSY' | 'TRACE_IMPORT_NOT_FOUND' | 'TRACE_IMPORT_FAILED';
  constructor(code: TraceImportError['code']) { super(code); this.name = 'TraceImportError'; this.code = code; }
}
export function invalid(): never { throw new TraceImportError('TRACE_IMPORT_INVALID'); }
export function limit(): never { throw new TraceImportError('TRACE_IMPORT_LIMIT'); }
export const REPORTED_KEYS = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'thoughts_token_count',
  'total_tokens', 'ttft_ms', 'tpot_ms', 'tps', 'e2e_latency_ms', 'model_inference_ms', 'tool_time_ms', 'tool_call_count'] as const;
export interface IndexedTurn { metadata: TraceLogTurn; offset: number; length: number; sha256: string }
export interface ParsedTrace {
  path: string;
  member: string | null;
  bytes: number;
  sha256: string;
  sessionOffset: number;
  sessionLength: number;
  sessionSha256: string;
  metadata: Pick<TraceLogSession, 'nativeSessionId' | 'ideType' | 'model' | 'title' | 'startedAt' | 'endedAt'>;
  turns: IndexedTurn[];
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 512) invalid();
  return value;
}
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function utc(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const calendar = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function projectTurn(raw: Record<string, unknown>, sequence: number): TraceLogTurn {
  const metadata: TraceLogTurn = { sequence, turnId: text(raw.turn_id), turnNumber: number(raw.turn_number), model: text(raw.model_name),
    requestTime: utc(raw.request_time), responseTime: utc(raw.response_time), isError: typeof raw.is_error === 'boolean' ? raw.is_error : null,
    reported: Object.fromEntries(REPORTED_KEYS.map(key => [key, number(raw[key])])), hasOutput: typeof raw.output_text === 'string' && raw.output_text.length > 0 };
  if (Buffer.byteLength(JSON.stringify(metadata)) > 2048) limit(); return metadata;
}

/** Byte framing only; JSON.parse sees one bounded object, never an entire trace. */
export class TraceJsonFramer {
  private state: 'root' | 'key' | 'keyText' | 'colon' | 'value' | 'array' | 'turn' | 'turnAfter' | 'after' | 'done' = 'root';
  private key = '';
  private keyText = '';
  private keyEscape = false;
  private seen = new Set<string>();
  private capture: { offset: number; parts: Buffer[]; length: number; depth: number; quoted: boolean; escaped: boolean } | null = null;
  private position = 0;
  private allowEnd = true;
  private turnEnd = true;

  feed(chunk: Buffer): { kind: 'session' | 'turn'; offset: number; bytes: Buffer }[] {
    const output: { kind: 'session' | 'turn'; offset: number; bytes: Buffer }[] = [];
    let start = this.capture === null ? -1 : 0;
    for (let i = 0; i < chunk.length; i += 1, this.position += 1) {
      const byte = chunk[i]!;
      if (this.capture !== null) {
        const capture = this.capture;
        if (capture.quoted) {
          if (capture.escaped) capture.escaped = false;
          else if (byte === 92) capture.escaped = true;
          else if (byte === 34) capture.quoted = false;
        } else if (byte === 34) capture.quoted = true;
        else if (byte === 123 || byte === 91) { capture.depth += 1; if (capture.depth > 128) limit(); }
        else if (byte === 125 || byte === 93) capture.depth -= 1;
        const size = capture.length + i - start + 1;
        if (size > (this.key === 'session' ? 64 * 1024 : 2 * 1024 * 1024)) limit();
        if (capture.depth === 0) {
          capture.parts.push(chunk.subarray(start, i + 1));
          output.push({ kind: this.key === 'session' ? 'session' : 'turn', offset: capture.offset, bytes: Buffer.concat(capture.parts, size) });
          this.capture = null; start = -1;
          this.state = this.key === 'session' ? 'after' : 'turnAfter';
        }
        continue;
      }
      if (this.state === 'keyText') {
        this.keyText += String.fromCharCode(byte);
        if (this.keyText.length > 128) invalid();
        if (this.keyEscape) this.keyEscape = false;
        else if (byte === 92) this.keyEscape = true;
        else if (byte === 34) {
          let key: unknown;
          try { key = JSON.parse(this.keyText) as unknown; } catch { invalid(); }
          if (key !== 'session' && key !== 'turns' || this.seen.has(key)) invalid();
          this.key = key; this.seen.add(key); this.state = 'colon';
        }
        continue;
      }
      if (byte === 32 || byte === 10 || byte === 13 || byte === 9) continue;
      switch (this.state) {
        case 'root': if (byte !== 123) invalid(); this.state = 'key'; break;
        case 'key':
          if (byte === 125 && this.allowEnd) this.state = 'done';
          else if (byte === 34) { this.keyText = '"'; this.keyEscape = false; this.state = 'keyText'; }
          else invalid(); break;
        case 'colon': if (byte !== 58) invalid(); this.state = 'value'; break;
        case 'value':
          if (this.key === 'turns') { if (byte !== 91) invalid(); this.state = 'array'; this.turnEnd = true; break; }
          if (byte !== 123) invalid();
          this.capture = { offset: this.position, parts: [], length: 0, depth: 1, quoted: false, escaped: false }; start = i; break;
        case 'array': case 'turn':
          if (byte === 93 && this.turnEnd) { this.state = 'after'; break; }
          if (byte !== 123) invalid();
          this.capture = { offset: this.position, parts: [], length: 0, depth: 1, quoted: false, escaped: false }; start = i; break;
        case 'turnAfter':
          if (byte === 44) { this.state = 'turn'; this.turnEnd = false; }
          else if (byte === 93) this.state = 'after'; else invalid(); break;
        case 'after':
          if (byte === 44) { this.state = 'key'; this.allowEnd = false; }
          else if (byte === 125) this.state = 'done'; else invalid(); break;
        case 'done': invalid();
      }
    }
    if (this.capture !== null) { const rest = Buffer.from(chunk.subarray(start)); this.capture.parts.push(rest); this.capture.length += rest.length; }
    return output;
  }
  finish(): void { if (this.state !== 'done' || this.capture !== null || this.seen.size !== 2) invalid(); }
}
export async function parseTrace(path: string, member: string | null): Promise<ParsedTrace> {
  const framer = new TraceJsonFramer(), hash = createHash('sha256'), turns: IndexedTurn[] = [];
  let bytes = 0, sessionOffset = 0, sessionLength = 0, sessionSha256 = '', metadata: ParsedTrace['metadata'] | null = null;
  for await (const part of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    const chunk = part as Buffer; bytes += chunk.length; if (bytes > 100 * 1024 * 1024) limit(); hash.update(chunk);
    for (const item of framer.feed(chunk)) {
      let raw: Record<string, unknown>;
      try { raw = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(item.bytes)) as unknown); } catch (error) { if (error instanceof TraceImportError) throw error; invalid(); }
      if (item.kind === 'session') {
        sessionOffset = item.offset; sessionLength = item.bytes.length;
        sessionSha256 = createHash('sha256').update(item.bytes).digest('hex');
        const nativeSessionId = text(raw.session_id), ideType = text(raw.ide_type);
        if (nativeSessionId === null || ideType === null) invalid();
        metadata = { nativeSessionId, ideType, model: text(raw.model_name), title: typeof raw.title === 'string' ? (raw.title.length > 512 ? raw.title.slice(0, 511) + '…' : raw.title) : null,
          startedAt: utc(raw.start_time), endedAt: utc(raw.end_time) };
      } else {
        if (turns.length >= 2000) limit();
        turns.push({ metadata: projectTurn(raw, turns.length), offset: item.offset, length: item.bytes.length, sha256: createHash('sha256').update(item.bytes).digest('hex') });
      }
    }
  }
  framer.finish(); if (metadata === null) invalid();
  return { path, member, bytes, sha256: hash.digest('hex'), sessionOffset, sessionLength, sessionSha256, metadata, turns };
}
