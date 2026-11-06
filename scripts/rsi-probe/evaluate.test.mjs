import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from './evaluate.mjs';
const good = () => [...Array.from({ length: 5 }, () => ({ type: 'test:pass', data: { nesting: 0 } })),
  { type: 'test:summary', data: { tests: 5, passed: 5, failed: 0, skipped: 0, todo: 0, cancelled: 0 } }];
test('complete structured inventory passes', () => assert.equal(judge(good(), 0).verdict, 'pass'));
test('real test assertion failure fails', () => {
  const events = good(); events[0].type = 'test:fail'; events[5].data.passed = 4; events[5].data.failed = 1;
  assert.equal(judge(events, 1).verdict, 'fail');
});
test('exit zero with no structured tests is infrastructure error', () => assert.equal(judge([], 0).verdict, 'infra_error'));
test('skipped/todo/cancelled tests cannot pass', () => {
  for (const key of ['skipped', 'todo', 'cancelled']) {
    const events = good(); events[5].data[key] = 1;
    assert.equal(judge(events, 0).verdict, 'infra_error');
  }
});
test('missing/extra tests are infrastructure errors', () => {
  const fewer = good(); fewer.shift();
  const more = good(); more.unshift({ type: 'test:pass', data: { nesting: 0 } });
  assert.equal(judge(fewer, 0).verdict, 'infra_error');
  assert.equal(judge(more, 0).verdict, 'infra_error');
});
