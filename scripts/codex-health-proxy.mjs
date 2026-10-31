#!/usr/bin/env node
// Loopback OpenAI bridge. Uses Codex login without reading credential files.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const MAX_BODY = 4 * 1024 * 1024;
const DISABLED = ['shell_tool', 'unified_exec', 'multi_agent', 'image_generation', 'browser_use', 'browser_use_external', 'computer_use', 'apps', 'plugins', 'view_image', 'hooks', 'goals', 'sleep_tool', 'skill_search', 'tool_suggest', 'code_mode_host', 'in_app_browser'];
export function resolveCodexBin(env = process.env) {
  const candidates = env.CODEX_BIN ? [resolve(env.CODEX_BIN)] : [...(env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, 'codex')), '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'];
  for (const file of candidates) {
    try { accessSync(file, constants.X_OK); return file; } catch { /* Try the next executable. */ }
  }
  throw new Error('Codex executable not found; set CODEX_BIN to an executable path.');
}
export function promptFrom(messages) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
  return `# Instructions\n\n${system}\n\n# Input\n\n${user}\n`;
}
export function unfence(text) {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? { text: m[1], unfenced: true } : { text, unfenced: false };
}
export function completionResponse(model, text, usage, started, id) {
  return {
    id: `chatcmpl-${id}`, object: 'chat.completion', created: Math.floor(started / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content: unfence(text).text }, finish_reason: 'stop' }],
    ...(usage ? { usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens } } : {}),
  };
}
async function runCodex(bin, effort, model, prompt, res) {
  // The sandbox needs an empty working directory; no reply/prompt files are written here.
  const cwd = await mkdtemp(join(tmpdir(), 'codex-proxy-'));
  try {
    return await new Promise((resolveRun, reject) => {
      const args = ['exec', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-c', 'web_search="disabled"', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd, '--color', 'never', '--json', ...DISABLED.flatMap(f => ['--disable', f]), '-'];
      const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let text = null, usage = null, aborted = false, killTimer;
      const stop = () => { if (!res.writableEnded && child.exitCode === null) { aborted = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); killTimer.unref(); } };
      res.on('close', stop);
      if (res.destroyed) stop();
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        let ev; try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') text = ev.item.text;
        if (ev.type === 'turn.completed') usage = ev.usage;
      });
      child.stderr.resume(); // Never write stderr or model content to disk/logs.
      child.stdin.on('error', () => {}); // Early process exit is handled by close/error.
      child.on('error', reject);
      child.on('close', code => {
        res.off('close', stop); clearTimeout(killTimer); lines.close();
        if (aborted || code !== 0 || typeof text !== 'string') reject(new Error(aborted ? 'client disconnected; codex stopped' : code !== 0 ? `codex exit ${code}` : 'codex returned no message'));
        else resolveRun({ text, usage });
      });
      child.stdin.end(prompt);
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
/** `log` receives metadata only (sizes, timings, token counts), never prompt or reply text. */
export function createCodexHealthProxy(env = process.env, log = () => {}) {
  if (!env.PROXY_TOKEN) throw new Error('PROXY_TOKEN is required');
  const bin = resolveCodexBin(env), effort = env.CODEX_EFFORT ?? 'medium';
  let busy = false;
  const send = (res, status, body) => { if (!res.headersSent && !res.destroyed) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); } };
  const fail = (res, status, message) => send(res, status, { error: { message, type: 'proxy_error' } });
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return fail(res, 404, 'not found');
    if (req.headers.authorization !== `Bearer ${env.PROXY_TOKEN}`) return fail(res, 401, 'bad token');
    if (busy) return fail(res, 429, 'one request at a time');
    busy = true; // Reserve admission before reading the body, including slow clients.
    const release = () => { busy = false; };
    req.on('aborted', release);
    req.on('error', release);
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { fail(res, 413, 'body too large'); req.destroy(); } else chunks.push(chunk); });
    req.on('end', async () => {
      req.off('aborted', release);
      try {
        if (res.headersSent) return;
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(res, 400, 'invalid json'); }
        if (!body || typeof body.model !== 'string' || !body.model || !Array.isArray(body.messages) || body.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) return fail(res, 400, 'model and text messages required');
        if (body.stream) return fail(res, 400, 'stream not supported');
        const prompt = promptFrom(body.messages), started = Date.now();
        log(`request model=${body.model} effort=${effort} prompt=${Buffer.byteLength(prompt)}B`);
        const result = await runCodex(bin, effort, body.model, prompt, res);
        if (env.PROXY_REPLY_DIR) await writeFile(join(env.PROXY_REPLY_DIR, `reply-${started}-${randomUUID()}.txt`), result.text, { mode: 0o600 });
        const u = result.usage;
        log(`done ${((Date.now() - started) / 1000).toFixed(1)}s input=${u?.input_tokens ?? '?'} (cached ${u?.cached_input_tokens ?? '?'}) output=${u?.output_tokens ?? '?'} (reasoning ${u?.reasoning_output_tokens ?? '?'}) reply=${Buffer.byteLength(result.text)}B`);
        send(res, 200, completionResponse(body.model, result.text, result.usage, started, randomUUID()));
      } catch (error) { log(`failed: ${error instanceof Error ? error.message : 'unknown error'}`); fail(res, 502, 'codex run failed'); }
      finally { release(); }
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const port = Number(process.env.PROXY_PORT ?? 4317);
    const server = createCodexHealthProxy(process.env, line => console.log(new Date().toTimeString().slice(0, 8), line));
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Codex health proxy: http://127.0.0.1:${port}/v1 (effort=${process.env.CODEX_EFFORT ?? 'medium'})`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
