import { appendFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const TRACE_LIMIT = 8 * 1024 * 1024;
const marker = `${JSON.stringify({ truncated: true })}\n`;
// Slice UTF8 by bytes without retaining a partial code point.
const prefix = (text, bytes) => Buffer.from(text).subarray(0, Math.max(0, bytes)).toString('utf8').replace(/\uFFFD$/, '');
export function responseTranscript() {
  const choices = new Map();
  return {
    choice(choice) {
      const index = choice.index ?? 0;
      const value = choices.get(index) ?? { index, text: '', tool_calls: [] };
      const delta = choice.delta ?? choice.message ?? {};
      if (typeof delta.content === 'string') value.text += delta.content;
      for (const [i, call] of (delta.tool_calls ?? []).entries()) {
        const at = call.index ?? i;
        const target = value.tool_calls[at] ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (call.id) target.id += call.id;
        if (call.type) target.type = call.type;
        if (call.function?.name) target.function.name += call.function.name;
        if (call.function?.arguments) target.function.arguments += call.function.arguments;
        value.tool_calls[at] = target;
      }
      choices.set(index, value);
    },
    finish() { return [...choices.values()].map(v => ({ ...v, tool_calls: v.tool_calls.filter(Boolean) })); },
  };
}
/** Files are bounded independently; this writer is shared by all run requests. */
export function createTraceWriter(directory, limit = TRACE_LIMIT) {
  let stopped = false;
  return async (kind, value) => {
    if (kind === 'request') {
      let record = { messages: value.messages, truncated: false };
      if (Buffer.byteLength(JSON.stringify(record)) > limit) {
        record = { messages: [], truncated: true };
        for (const message of value.messages) {
          const trial = { ...record, messages: [...record.messages, message] };
          if (Buffer.byteLength(JSON.stringify(trial)) > limit) {
            // Keep a bounded textual prefix of the first omitted message, with
            // enough headroom for JSON escaping even in worst-case input.
            const room = limit - Buffer.byteLength(JSON.stringify(record)) - 64;
            if (room > 6) record.omittedMessagePrefix = prefix(JSON.stringify(message), Math.floor(room / 6));
            break;
          }
          record = trial;
        }
      }
      await writeFile(join(directory, 'last-request.json'), JSON.stringify(record), { mode: 0o600 });
      return;
    }
    if (stopped) return;
    const file = join(directory, 'responses.jsonl');
    let size = 0;
    try { size = (await stat(file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const line = `${JSON.stringify(value)}\n`;
    if (size + Buffer.byteLength(line) + Buffer.byteLength(marker) > limit) {
      const room = limit - size - Buffer.byteLength(marker) - 64;
      if (room > 6) {
        const truncated = `${JSON.stringify({ prefix: prefix(line, Math.floor(room / 6)), truncated: true })}\n`;
        await appendFile(file, truncated, { mode: 0o600 });
      }
      await appendFile(file, marker, { mode: 0o600 }); stopped = true;
    } else await appendFile(file, line, { mode: 0o600 });
  };
}
