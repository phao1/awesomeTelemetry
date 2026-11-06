/* global process, fetch, console, Buffer, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const tool = (name, description, properties, required) => ({ type: 'function', function: {
  name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
} });
const text = { type: 'string' };
export const tools = [
  tool('shell', 'Run a shell command in the current repository', { command: text }, ['command']),
  tool('read_file', 'Read a UTF8 file', { path: text }, ['path']),
  tool('write_file', 'Write a UTF8 file', { path: text, content: text }, ['path', 'content']),
];
const bounded = value => Buffer.from(value).subarray(0, 65536).toString();
export async function executeTool(name, args) {
  if (name === 'read_file') return bounded(await readFile(args.path));
  if (name === 'write_file') {
    await mkdir(dirname(args.path), { recursive: true }); await writeFile(args.path, args.content); return 'written';
  }
  if (name !== 'shell') throw new Error(`Unknown tool: ${name}`);
  if (typeof args.command !== 'string') throw new Error('shell.command required');
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', args.command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const collect = chunk => { size += chunk.length; if (size <= 65536) output += chunk; else child.kill('SIGKILL'); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(`exit=${code}\n${output}`); });
  });
}
export async function main(statement) {
  for (const key of ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL']) if (!process.env[key]) throw new Error(`Missing ${key}`);
  if (!statement) throw new Error('Statement required');
  const messages = [
    { role: 'system', content: 'You are a coding Agent. Inspect and repair the repository to satisfy the task. Use tools to edit files, then summarize.' },
    { role: 'user', content: statement },
  ];
  for (let turn = 0; turn < 24; turn++) {
    const response = await fetch(`${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL, messages, tools, stream: false }),
    });
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
    const body = await response.json(), message = body.choices?.[0]?.message;
    if (!message || message.role !== 'assistant') throw new Error('Missing assistant message');
    messages.push(message); // Preserve provider fields such as reasoning_content.
    if (!message.tool_calls?.length) { console.log(message.content ?? ''); return; }
    for (const call of message.tool_calls) {
      let content;
      try { content = await executeTool(call.function.name, JSON.parse(call.function.arguments)); }
      catch (error) { content = `Tool error: ${error.message}`; }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  throw new Error('Agent turn limit exceeded');
}
if (process.argv[1]?.endsWith('/agent.mjs')) await main(process.argv[2]);
