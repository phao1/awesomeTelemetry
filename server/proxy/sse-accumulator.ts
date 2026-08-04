export interface SseEvent {
  event?: string;
  data?: string;
  id?: string;
}

/** REQ-010：解析 SSE chunk（按空行分块，data 行以 \n 拼接）。 */
export function parseSseChunk(chunk: string): SseEvent[] {
  const blocks = chunk.split(/\r?\n\r?\n/);
  const events: SseEvent[] = [];
  for (const block of blocks) {
    const event: SseEvent = {};
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event.event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      } else if (line.startsWith('id:')) {
        event.id = line.slice('id:'.length).trim();
      }
    }
    if (dataLines.length > 0) {
      event.data = dataLines.join('\n');
    }
    if (event.event !== undefined || event.data !== undefined) {
      events.push(event);
    }
  }
  return events;
}

export interface TokenUsageFromSse {
  inputTokens: number | null;
  outputTokens: number | null;
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
    const usage = (parsed as { usage?: Record<string, unknown> })?.usage;
    if (typeof usage !== 'object' || usage === null) {
      continue;
    }
    const input = usage.prompt_tokens ?? usage.input_tokens;
    const output = usage.completion_tokens ?? usage.output_tokens;
    if (typeof input === 'number') {
      inputTokens = input;
    }
    if (typeof output === 'number') {
      outputTokens = output;
    }
  }
  return inputTokens === null && outputTokens === null ? null : { inputTokens, outputTokens };
}
