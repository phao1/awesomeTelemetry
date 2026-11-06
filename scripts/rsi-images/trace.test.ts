import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
const { createTraceWriter, responseTranscript, TRACE_LIMIT } = await import(pathToFileURL(resolve('scripts/rsi-images/trace.mjs')).href);
const { observer } = await import(pathToFileURL(resolve('scripts/rsi-images/protocol.mjs')).href);
it('assembles assistant text and tool deltas across fragmented SSE frames', () => {
  const transcript = responseTranscript(), parser = observer(true, transcript.choice);
  const frames = [
    { choices: [{ index: 0, delta: { content: 'hello ', tool_calls: [{ index: 0, id: 'call_a', function: { name: 'sh', arguments: '{"com' } }] } }] },
    { choices: [{ index: 0, delta: { content: '世界', tool_calls: [{ index: 0, function: { name: 'ell', arguments: 'mand":"true"}' } }] }, finish_reason: 'tool_calls' }] },
  ].map(v => `data: ${JSON.stringify(v)}\n\n`).join('') + 'data: [DONE]\n\n';
  for (const byte of Buffer.from(frames)) parser.push(Buffer.from([byte]));
  expect(parser.finish().complete).toBe(true);
  expect(transcript.finish()).toEqual([{ index: 0, text: 'hello 世界', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'shell', arguments: '{"command":"true"}' } }] }]);
});
it('retains the last cumulative messages independently of responses and bounds each UTF8 file at 8MiB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'traces-'));
  try {
    const trace = createTraceWriter(root);
    await trace('request', { messages: [{ role: 'user', content: 'first' }] });
    const messages = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' }, { role: 'tool', content: 'result' }];
    await trace('request', { messages, authorization: 'never capture headers' });
    expect(JSON.parse(await readFile(join(root, 'last-request.json'), 'utf8'))).toEqual({ messages, truncated: false });
    await trace('response', { requestId: 'a', assistant: [{ text: 'reply', tool_calls: [] }] });
    await trace('response', { requestId: 'b', assistant: [{ text: '世"\\'.repeat(TRACE_LIMIT), tool_calls: [] }] });
    const capped = await readFile(join(root, 'responses.jsonl'), 'utf8');
    expect(capped).toContain('"requestId":"a"'); expect(capped.endsWith('{"truncated":true}\n')).toBe(true);
    const size = (await stat(join(root, 'responses.jsonl'))).size; expect(size).toBeLessThanOrEqual(TRACE_LIMIT);
    await trace('response', { requestId: 'c' }); expect((await stat(join(root, 'responses.jsonl'))).size).toBe(size);
    await trace('request', { messages: [{ role: 'user', content: '\\"世'.repeat(TRACE_LIMIT) }] });
    const last = JSON.parse(await readFile(join(root, 'last-request.json'), 'utf8'));
    expect(last.truncated).toBe(true); expect(last.omittedMessagePrefix.length).toBeGreaterThan(0);
    expect((await stat(join(root, 'last-request.json'))).size).toBeLessThanOrEqual(TRACE_LIMIT);
  } finally { await rm(root, { recursive: true, force: true }); }
});
