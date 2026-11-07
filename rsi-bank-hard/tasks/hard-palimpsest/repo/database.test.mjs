import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from './database.mjs';
test('basic point transaction', () => { const d = new Database(); const t = d.begin(); t.put('a', 1); assert.equal(t.get('a'), 1); assert.equal(t.commit().ok, true); });
