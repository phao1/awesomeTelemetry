import http from 'node:http';
import { createSidecar } from './sidecar.mjs';
import https from 'node:https';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createMockHandler } from './mock-model.mjs';
import { createTraceWriter, responseTranscript } from './trace.mjs';
import { errorResponse, observer, readBody } from './protocol.mjs';

export function nodeTransport(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, options, resolve);
    req.on('error', reject);
    req.setTimeout(120_000, () => req.destroy(new Error('upstream_timeout')));
    req.end(body);
  });
}

export function redactModelValue(value, secrets, hashes=[], depth=0) {
  if(depth>64)throw new Error('request_depth');
  if(typeof value==='string'){
    let text=value;
    for(const secret of secrets)if(secret)text=text.replaceAll(secret,'[REDACTED]');
    return text.replace(/[a-f0-9]{64}/g,token=>hashes.includes(createHash('sha256').update(token).digest('hex'))?'[REDACTED]':token);
  }
  if(Array.isArray(value))return value.map(v=>redactModelValue(v,secrets,hashes,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[redactModelValue(key,secrets,hashes,depth+1),redactModelValue(v,secrets,hashes,depth+1)]));
  return value;
}
export function createProxyHandler({ runs, baseURL, apiKey, model, maxTokens = 4096, inputTokensPerByte = 0.35,
  redactionHashes = [], transport = nodeTransport, log, trace = async () => {}, now = () => performance.now() }) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || !Number.isFinite(inputTokensPerByte) || inputTokensPerByte <= 0) throw new Error('Invalid proxy calibration');
  const states = new Map(runs.map(r => [r.token, { ...r, used: 0, blocked: false, tail: Promise.resolve(), ratio: inputTokensPerByte }]));
  const upstream = new URL(`${baseURL.replace(/\/$/, '')}/chat/completions`);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search) {
    throw new Error('Invalid upstream URL');
  }
  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
    const state = states.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!state || req.headers.authorization !== `Bearer ${state.token}`) {
      errorResponse(res, 401, 'UNAUTHORIZED', 'Invalid run token'); return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      errorResponse(res, 404, 'NOT_FOUND', 'Unknown endpoint'); return;
    }
    let release;
    const previous = state.tail;
    state.tail = new Promise(resolve => { release = resolve; });
    await previous;
    if (state.blocked || state.used >= state.budget) {
      release(); errorResponse(res, 429, 'TOKEN_BUDGET', 'Run budget exhausted'); return;
    }
    const started = now();
    let reservation = 0;
    let inputBytes;
    let response;
    let settled = false;
    const transcript = responseTranscript();
    const controller = new AbortController();
    const deadline = setTimeout(() => { controller.abort(); response?.destroy?.(); req.destroy?.(); res.destroy(); }, 120000);
    // An Agent often exits on the final text, before the usage chunk that follows it. The tokens are billed anyway,
    // so keep reading to the end, up to the deadline, and record them.
    let clientGone = false;
    const disconnect = () => { if (!res.writableFinished) clientGone = true; };
    res.once('close', disconnect);
    const entry = { requestId: randomUUID(), stage: 'settled', runId: state.runId, startedAt: new Date().toISOString(), status: null,
      firstByteMs: null, durationMs: null, usage: null, cacheHitRate: null, toolCalls: 0,
      complete: false, error: null, chargedTokens: 0 };
    try {
      const body = redactModelValue(await readBody(req),[state.token,...(apiKey==='mock'?[]:[apiKey])],redactionHashes);
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) throw new Error('invalid_request');
      await trace('request', { messages: body.messages });
      body.model = model;
      delete body.user;
      const requested = body.max_completion_tokens ?? body.max_tokens ?? maxTokens;
      if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error('invalid_token_limit');
      delete body.max_completion_tokens;
      body.max_tokens = Math.min(requested, maxTokens);
      body.n = 1;
      if (body.stream) body.stream_options = { include_usage: true };
      // Calibration includes messages and tools, excludes wire/JSON overhead. Never charge
      // a token per UTF8 byte merely because a request contains large tool schemas.
      inputBytes = Buffer.byteLength(JSON.stringify({ messages: body.messages, tools: body.tools ?? [] }));
      const estimatedInput = Math.ceil(inputBytes * state.ratio);
      body.max_tokens = Math.min(body.max_tokens, state.budget - state.used - estimatedInput);
      reservation = estimatedInput + Math.max(0, body.max_tokens);
      if (body.max_tokens <= 0 || state.used + reservation > state.budget) {
        entry.status = 429;
        errorResponse(res, 429, 'TOKEN_BUDGET', 'Insufficient budget for request reservation'); return;
      }
      state.used += reservation;
      // Write-ahead admission evidence survives a worker crash before upstream usage.
      await log({ ...entry, stage: 'reserved', chargedTokens: reservation });
      response = await transport(upstream, { method: 'POST', signal: controller.signal, headers: {
        'content-type': 'application/json', authorization: `Bearer ${apiKey}`,
        'accept-encoding': 'identity', ...(baseURL.startsWith('http://127.0.0.1:8081') ? { 'x-rsi-run': state.runId } : {}),
      } }, JSON.stringify(body));
      entry.status = response.statusCode;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy?.();
        entry.error = 'upstream_rejected';
        errorResponse(res, 502, 'UPSTREAM_ERROR', 'Upstream rejected request'); return;
      }
      const parser = observer(Boolean(body.stream), transcript.choice);
      res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json', 'cache-control': 'no-store' });
      let responseBytes = 0;
      for await (const chunk of response) {
        responseBytes += chunk.length;
        if (responseBytes > 8 * 1024 * 1024) throw new Error('response_limit');
        if (entry.firstByteMs === null) entry.firstByteMs = now() - started;
        parser.push(chunk);
        if (!clientGone && !res.write(chunk)) await new Promise(resume => { const done = () => { res.off('drain', done); res.off('close', done); resume(); }; res.once('drain', done); res.once('close', done); });
      }
      Object.assign(entry, parser.finish());
      if (entry.usage && entry.complete) {
        state.used += entry.usage.total - reservation;
        entry.chargedTokens = entry.usage.total;
        settled = true;
        state.ratio = Math.max(state.ratio, entry.usage.input / Math.max(1, inputBytes) * 1.1);
        if (state.used >= state.budget) state.blocked = true;
        entry.cacheHitRate = entry.usage.input ? entry.usage.cached / entry.usage.input : 0;
      } else entry.error = 'incomplete_or_missing_usage';
      if (!clientGone) res.end();
    } catch (error) {
      entry.error = ['body_limit', 'invalid_request', 'invalid_token_limit'].includes(error.message) ? error.message : 'upstream_or_stream_error';
      if (!res.headersSent) errorResponse(res, entry.error === 'upstream_or_stream_error' ? 502 : 400, 'PROXY_ERROR', entry.error);
      else res.destroy();
    } finally {
      if (!settled) entry.chargedTokens = reservation && entry.status !== 429 ? reservation : 0;
      entry.durationMs = now() - started;
      try { await trace('response', { requestId: entry.requestId, assistant: redactModelValue(transcript.finish(),[state.token,...(apiKey==='mock'?[]:[apiKey])],redactionHashes) }); await log(entry); } catch { state.blocked = true; res.destroy(); }
      clearTimeout(deadline); res.off('close', disconnect); release();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = process.env.RSI_MODEL === 'mock';
  if (mock) {
    const server = http.createServer(createMockHandler({ runs: JSON.parse(process.env.RSI_RUNS ?? '[]'), table: JSON.parse(process.env.RSI_MOCK_TABLE ?? '{}') })).listen(8081, '127.0.0.1');
    await once(server, 'listening');
  }
  const runs = JSON.parse(process.env.RSI_RUNS ?? '[]');
  if (!runs.length) throw new Error('RSI_RUNS required');
  if (!mock) {
    const missing = ['RSI_UPSTREAM_BASE_URL', 'RSI_UPSTREAM_MODEL', 'RSI_UPSTREAM_API_KEY'].filter(k => !process.env[k]?.trim());
    if (missing.length) throw new Error(`Missing upstream environment: ${missing.join(', ')}`);
  }
  if (!mock && !process.env.RSI_UPSTREAM_BASE_URL?.startsWith('https://')) throw new Error('Real upstream requires HTTPS');
  const handler = createProxyHandler({ runs,
    baseURL: mock ? 'http://127.0.0.1:8081/v1' : process.env.RSI_UPSTREAM_BASE_URL,
    apiKey: mock ? 'mock' : process.env.RSI_UPSTREAM_API_KEY,
    model: mock ? 'mock-fixed' : process.env.RSI_UPSTREAM_MODEL,
    maxTokens: Number(process.env.RSI_MAX_TOKENS ?? 4096),
    inputTokensPerByte: Number(process.env.RSI_INPUT_TOKENS_PER_BYTE ?? 0.35),
    redactionHashes: JSON.parse(process.env.RSI_REDACTION_HASHES ?? '[]'),
    trace: createTraceWriter('/out'),
    log: entry => appendFile('/out/usage.jsonl', `${JSON.stringify(entry)}\n`, { mode: 0o600 }),
  });
  createSidecar({ modelHandler: handler, agentBase: process.env.RSI_AGENT_UPSTREAM, domains: JSON.parse(process.env.RSI_EGRESS_DOMAINS ?? '[]') }).listen(8080, '0.0.0.0');
}
