import test from 'node:test';
import assert from 'node:assert/strict';
import { answer } from './answer.mjs';
test('check_result', () => assert.equal(answer(), 3));
