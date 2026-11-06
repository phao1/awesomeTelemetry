import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../clamp.mjs';

test('preserves interior', () => assert.equal(clamp(4, 1, 9), 4));
test('lower bound', () => assert.equal(clamp(-4, 1, 9), 1));
test('upper bound', () => assert.equal(clamp(14, 1, 9), 9));
test('negative interval', () => assert.equal(clamp(-5, -8, -2), -5));
test('equal bounds and decimals', () => {
  assert.equal(clamp(4, 2, 2), 2);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});
