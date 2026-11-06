import { StringDecoder } from 'node:string_decoder';

export function errorResponse(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new Error('body_limit');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Incremental SSE decoder: UTF-8 and event boundaries may span arbitrary chunks.
export function observer(streaming) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let data = [];
  let usage = null;
  let done = false;
  const tools = new Set();
  function frame(value) {
    if (value.usage) {
      const u = value.usage;
      const input = u.prompt_tokens;
      const output = u.completion_tokens;
      const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
      const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
      if ([input, output, cached, reasoning].every(n => Number.isSafeInteger(n) && n >= 0)
        && cached <= input && reasoning <= output) {
        usage = { input, output, cached, reasoning, total: input + output };
      }
    }
    for (const choice of value.choices ?? []) {
      if (choice.finish_reason) done = true;
      for (const call of (choice.delta ?? choice.message)?.tool_calls ?? []) {
        tools.add(`${choice.index ?? 0}:${call.index ?? call.id}`);
      }
    }
  }
  function dispatch() {
    const joined = data.join('\n');
    data = [];
    if (!joined) return;
    if (joined === '[DONE]') { done = true; return; }
    frame(JSON.parse(joined));
  }
  return {
    push(chunk) {
      pending += decoder.write(Buffer.from(chunk));
      if (pending.length > 4 * 1024 * 1024) throw new Error('response_frame_limit');
      if (!streaming) return;
      let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at).replace(/\r$/, '');
        pending = pending.slice(at + 1);
        if (!line) dispatch();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        if (data.reduce((n, s) => n + s.length, 0) > 4 * 1024 * 1024) throw new Error('response_frame_limit');
      }
    },
    finish() {
      pending += decoder.end();
      if (!streaming) frame(JSON.parse(pending));
      else { if (pending.startsWith('data:')) data.push(pending.slice(5).trim()); dispatch(); }
      return { usage, toolCalls: tools.size, complete: done };
    },
  };
}
