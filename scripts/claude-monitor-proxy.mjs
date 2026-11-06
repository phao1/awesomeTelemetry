#!/usr/bin/env node
// Run outside the sandbox. No CLI login files, filesystem access, tools or retries.
import http from 'node:http';
import https from 'node:https';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 4 * 1024 * 1024, MAX_REPLY = 2 * 1024 * 1024;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const sameToken = (value, token) => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token)
  && timingSafeEqual(Buffer.from(value), Buffer.from(token));

/** Built-in HTTPS only. The entire provider result stays in memory. */
export function requestAnthropic(body, { env, signal }) {
  const endpoint = new URL((env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '') + '/messages');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Anthropic endpoint');
  const payload = JSON.stringify(body);
  return new Promise((resolveRequest, reject) => {
    const req = https.request(endpoint, { method: 'POST', signal, headers: { 'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload), 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('Upstream request failed')); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > MAX_REPLY) res.destroy(new Error('Upstream response limit')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { try { resolveRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid upstream JSON')); } });
    });
    req.on('error', reject); req.end(payload);
  });
}
export function claudeCompletion(model, raw, started, id) {
  if (!raw || raw.stop_reason !== 'end_turn' || !Array.isArray(raw.content) || !raw.content.length
    || raw.content.some(block => !block || block.type !== 'text' || typeof block.text !== 'string')
    || raw.stop_details?.type === 'refusal' || raw.tool_calls || raw.function_call) throw new Error('Non-text Claude response');
  const u = raw.usage;
  if (!u || ![u.input_tokens, u.output_tokens, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0].every(nonnegative)) throw new Error('Missing Claude usage');
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output = u.output_tokens;
  if (!nonnegative(input + output)) throw new Error('Claude usage overflow');
  const text = raw.content.map(block => block.text).join('');
  if (Buffer.byteLength(text) > MAX_REPLY) throw new Error('Claude text limit');
  return { id: `chatcmpl-${id}`, object: 'chat.completion', created: Math.floor(started / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } };
}

/** `transport` is the no-port test seam; logging accepts metadata only. */
export function createClaudeMonitorHandler(env = process.env, transport = requestAnthropic, log = () => {}) {
  if (!env.PROXY_TOKEN || !env.ANTHROPIC_API_KEY) throw new Error('PROXY_TOKEN and ANTHROPIC_API_KEY are required');
  const timeoutMs = Number(env.CLAUDE_TIMEOUT_MS ?? 120000), cap = Number(env.CLAUDE_MAX_TOKENS ?? 4096);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(cap) || cap <= 0) throw new Error('Invalid Claude proxy limits');
  let busy = false;
  return async (req, res) => {
    const send = (status, body) => { if (!res.headersSent && !res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); } };
    const fail = (status, code, message) => send(status, { error: { code, message } });
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return fail(404, 'NOT_FOUND', 'Not found');
    if (!sameToken(req.headers.authorization, `Bearer ${env.PROXY_TOKEN}`)) return fail(401, 'PROXY_AUTH_REQUIRED', 'Invalid proxy token');
    if (busy) return fail(429, 'BUSY', 'One request at a time');
    busy = true;
    let bodyRead = false;
    const controller = new AbortController(), timer = setTimeout(() => { controller.abort(); if (!bodyRead) req.destroy(); }, timeoutMs);
    timer.unref();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect); res.on('close', disconnect);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { fail(413, 'PROXY_SIZE_LIMIT', 'Request body too large'); req.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      }
      bodyRead = true;
      if (controller.signal.aborted || res.destroyed) return;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400, 'BAD_REQUEST', 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.model !== 'string' || !body.model.trim()
        || body.model.length > 512 || [...body.model].some(c => c.charCodeAt(0) < 32) || !Array.isArray(body.messages) || !body.messages.length
        || body.messages.some(m => !m || typeof m.content !== 'string' || !['system', 'user', 'assistant'].includes(m.role) || Object.keys(m).some(k => !['role', 'content'].includes(k)))
        || body.stream || ['tools', 'tool_choice', 'functions', 'function_call'].some(key => Object.hasOwn(body, key))
        || body.max_tokens !== undefined && (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0)) return fail(400, 'BAD_REQUEST', 'Only text messages without tools are accepted');
      const messages = body.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
      if (!messages.length || messages[0].role !== 'user') return fail(400, 'BAD_REQUEST', 'User input is required');
      const model = env.CLAUDE_MODEL ?? body.model, started = Date.now();
      const request = { model, max_tokens: Math.min(cap, body.max_tokens ?? cap),
        system: body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'), messages, stream: false };
      log({ event: 'request', bytes: size });
      let abort;
      const stopped = new Promise((_, reject) => { abort = () => reject(new Error('Request aborted')); controller.signal.addEventListener('abort', abort, { once: true }); });
      let raw;
      try { raw = await Promise.race([transport(request, { env, signal: controller.signal }), stopped]); }
      finally { controller.signal.removeEventListener('abort', abort); }
      if (controller.signal.aborted) throw new Error('Request aborted');
      const completion = claudeCompletion(model, raw, started, randomUUID());
      log({ event: 'completed', durationMs: Date.now() - started, inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens });
      send(200, completion);
    } catch { fail(controller.signal.aborted ? 504 : 502, 'PROXY_MODEL_FAILED', 'Claude request failed'); log({ event: 'failed' }); }
    finally { clearTimeout(timer); req.off('aborted', disconnect); res.off('close', disconnect); busy = false; }
  };
}
export function createClaudeMonitorProxy(env = process.env, log = () => {}, transport = requestAnthropic) {
  const handler = createClaudeMonitorHandler(env, transport, log);
  return http.createServer((req, res) => { void handler(req, res); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const port = Number(process.env.PROXY_PORT ?? 4318);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PROXY_PORT');
    const server = createClaudeMonitorProxy(process.env, metadata => console.log(JSON.stringify(metadata)));
    server.on('error', () => { console.error('Claude monitor proxy failed'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Claude monitor proxy listening on loopback port ${port}`));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Claude monitor proxy failed'); process.exitCode = 1; }
}
