import { StringDecoder } from 'node:string_decoder';

export interface SseEvent {
  event?: string;
  data?: string;
  id?: string;
}

/** Incremental SSE framing; byte chunks need not align to UTF-8 or event boundaries. */
export class SseDecoder {
  private readonly decoder = new StringDecoder('utf8');
  private readonly maxEventChars: number;
  private line = '';
  private lineHasContent = false;
  private event: SseEvent = {};
  private data: string[] = [];
  private size = 0;
  private discarding = false;
  private skipLf = false;
  private ended = false;
  private atStart = true;
  private lastId: string | undefined;
  droppedEvents = 0;
  incompleteEvents = 0;

  constructor(maxEventChars = 2 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxEventChars) || maxEventChars <= 0) {
      throw new RangeError('maxEventChars must be a positive safe integer');
    }
    this.maxEventChars = maxEventChars;
  }

  push(chunk: Uint8Array | string): SseEvent[] {
    if (this.ended) throw new Error('SSE decoder already finished');
    return this.feed(typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk)));
  }

  finish(): SseEvent[] {
    if (this.ended) return [];
    const events = this.feed(this.decoder.end());
    this.ended = true;
    // WHATWG: EOF is not an empty line and cannot dispatch a pending event.
    if (this.data.length > 0 || /^(?:data)(?::|$)/.test(this.line)) this.incompleteEvents += 1;
    this.line = ''; this.event = {}; this.data = []; this.size = 0;
    return events;
  }

  private feed(input: string): SseEvent[] {
    const events: SseEvent[] = [];
    let text = input;
    if (this.atStart && text !== '') { this.atStart = false; if (text.startsWith('\ufeff')) text = text.slice(1); }
    if (this.skipLf && text.startsWith('\n')) text = text.slice(1);
    if (input !== '') this.skipLf = input.endsWith('\r');
    let start = 0;
    for (const match of text.matchAll(/\r\n|\r|\n/g)) {
      const end = match.index;
      this.append(text.slice(start, end));
      this.endLine(events);
      start = end + match[0].length;
    }
    this.append(text.slice(start));
    return events;
  }

  private append(text: string): void {
    if (text.length > 0) this.lineHasContent = true;
    if (this.discarding) return;
    this.size += text.length;
    if (this.size > this.maxEventChars) {
      this.discarding = true;
      this.droppedEvents += 1;
      this.line = '';
      this.event = {};
      this.data = [];
      return;
    }
    this.line += text;
  }

  private endLine(events: SseEvent[]): void {
    const line = this.line;
    const hadContent = this.lineHasContent;
    this.line = '';
    this.lineHasContent = false;
    if (!hadContent) {
      this.flush(events);
      return;
    }
    if (this.discarding || line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event.event = value;
    else if (field === 'id' && !value.includes('\0')) this.lastId = value;
  }

  private flush(events: SseEvent[]): void {
    if (!this.discarding) {
      if (this.data.length > 0) {
        this.event.data = this.data.join('\n');
        if (this.lastId !== undefined) this.event.id = this.lastId;
        events.push(this.event);
      }
    }
    this.event = {};
    this.data = [];
    this.size = 0;
    this.discarding = false;
  }
}

/** REQ-010：解析 SSE chunk（按空行分块，data 行以 \n 拼接）。 */
export function parseSseChunk(chunk: string): SseEvent[] {
  const decoder = new SseDecoder();
  return [...decoder.push(chunk), ...decoder.finish()];
}

export interface TokenUsageFromSse {
  inputTokens: number | null;
  outputTokens: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Protocol usage can be top-level or nested in message_start/response.completed. */
export function readTokenUsage(value: unknown): TokenUsageFromSse | null {
  const frame = record(value);
  if (frame === null) return null;
  const usage = record(frame.usage) ?? record(record(frame.response)?.usage) ?? record(record(frame.message)?.usage);
  if (usage === null) return null;
  const count = (n: unknown): number | null => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
  const inputTokens = count(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = count(usage.completion_tokens ?? usage.output_tokens);
  return inputTokens === null && outputTokens === null ? null : { inputTokens, outputTokens };
}

/** REQ-010：从 SSE event.data 的 JSON 里扫 usage（prompt/completion 或 input/output）。 */
export function extractTokenUsageFromSse(events: SseEvent[]): TokenUsageFromSse | null {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  for (const event of events) {
    if (event.data === undefined) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      continue;
    }
    const usage = readTokenUsage(parsed);
    if (usage?.inputTokens !== null && usage?.inputTokens !== undefined) inputTokens = usage.inputTokens;
    if (usage?.outputTokens !== null && usage?.outputTokens !== undefined) outputTokens = usage.outputTokens;
  }
  return inputTokens === null && outputTokens === null ? null : { inputTokens, outputTokens };
}
