import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { errorResponse, readBody } from './protocol.mjs';

export const MOCK_USAGE = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
  prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 0 } };

export function replay(body, command = "true") {
  if (!Array.isArray(body.messages)) throw new Error('mock_invalid_messages');
  const finished = body.messages.some(m => m.role === 'tool');
  const shell = body.tools?.find(t => t.function?.name === 'shell')
    ?? body.tools?.find(t => t.function?.name === 'bash');
  const auxiliary = !finished && !shell;
  // OpenCode can make title/summary calls without tools. These are metered too.
  return { id: 'chatcmpl-rsi', object: 'chat.completion', created: 1700000000, model: body.model,
    choices: [{ index: 0, finish_reason: finished || auxiliary ? 'stop' : 'tool_calls', message: auxiliary
      ? { role: 'assistant', content: 'Code repair' } : finished
      ? { role: 'assistant', content: 'Repair complete.' }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'call_fix', type: 'function',
        function: { name: shell.function.name, arguments: JSON.stringify({
          command,
          ...(shell.function.name === 'bash' ? { description: 'Fix clamp bounds' } : {}),
        }) } }] } }], usage: MOCK_USAGE };
}

export function selectScript(run, table) {
  const script = table[run.questionId] ?? table['*'];
  if (!script || !['pass', 'fail', 'flaky'].includes(script.outcome) || typeof script.passCommand !== 'string') throw new Error('mock_missing_script');
  const pass = script.outcome === 'pass' || (script.outcome === 'flaky' && (script.repetitions ?? [false, true, false])[run.repetition % (script.repetitions ?? [false, true, false]).length]);
  return pass ? script.passCommand : script.failCommand ?? 'true';
}
export function createMockHandler({ runs = [], table = {} } = {}) {
  const byId = new Map(runs.map(r => [r.runId, r]));
  return async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') { res.writeHead(200); res.end('ok'); return; }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      errorResponse(res, 404, 'NOT_FOUND', 'Unknown endpoint'); return;
    }
    try {
      const body = await readBody(req);
      const run = byId.get(req.headers['x-rsi-run']);
      const result = replay(body, selectScript(run ?? {}, table));
      if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const choice = result.choices[0];
      const delta = { ...choice.message };
      if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map((call, index) => ({ index, ...call }));
      const base = { id: result.id, object: 'chat.completion.chunk', created: result.created, model: result.model };
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: MOCK_USAGE })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch {
      errorResponse(res, 400, 'MOCK_INVALID_REQUEST', 'Invalid JSON or messages');
    }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer(createMockHandler()).listen(8081, '127.0.0.1');
}
