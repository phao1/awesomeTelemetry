import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockHandler, replay, MOCK_USAGE } from './mock-model.mjs';
import { observer } from './protocol.mjs';
import { request, response } from './test-support.mjs';
const tools = [{ type: 'function', function: { name: 'bash' } }];

test('first completion calls bash to modify sample', () => {
  const result = replay({ messages: [], tools, model: 'fixed' });
  const call = result.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, 'bash');
  assert.match(JSON.parse(call.function.arguments).command, /Math.min\(max, Math.max\(min, value\)\)/);
  assert.deepEqual(result.usage, MOCK_USAGE);
});
test('tool result ends replay without another tool', () => {
  const result = replay({ messages: [{ role: 'tool', content: 'ok' }], tools });
  assert.equal(result.choices[0].finish_reason, 'stop');
  assert.equal(result.choices[0].message.tool_calls, undefined);
});
test('nonstream HTTP handler returns deterministic usage', async () => {
  const res = response();
  await createMockHandler()(request({ tools, model: 'fixed' }, { stream: false }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body()).usage, MOCK_USAGE);
});
test('stream is valid even when UTF8 and SSE frames are split into bytes', async () => {
  const res = response();
  await createMockHandler()(request({ tools }), res);
  const parser = observer(true);
  for (const byte of Buffer.from(res.body())) parser.push(Buffer.from([byte]));
  assert.deepEqual(parser.finish(), { usage: { input: 100, output: 20, cached: 10, reasoning: 0, total: 120 }, toolCalls: 1, complete: true });
});
test('invalid request returns explicit envelope', async () => {
  const res = response();
  await createMockHandler()(request({ messages: 'invalid' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body()).error.code, 'MOCK_INVALID_REQUEST');
});
test('socket integration outside sandbox', { skip: 'Sandbox forbids binding ports; run Docker mock workflow in runbook' }, () => {});

test('auxiliary title requests are metered without tools', () => {
  const result = replay({ messages: [{ role: 'user', content: 'title' }], model: 'fixed' });
  assert.equal(result.choices[0].finish_reason, 'stop');
  assert.equal(result.choices[0].message.content, 'Clamp repair');
  assert.deepEqual(result.usage, MOCK_USAGE);
});

test('pinned OpenCode shell name and exact input schema are used', () => {
  const result = replay({ messages: [], tools: [{ type: 'function', function: { name: 'shell' } }] });
  const call = result.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, 'shell');
  assert.deepEqual(Object.keys(JSON.parse(call.function.arguments)), ['command']);
});
