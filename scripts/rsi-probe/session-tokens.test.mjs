import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionTokens } from './session-tokens.mjs';

test('reads pinned SQLite schema and sums exclusive components across sessions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rsi-db-test-'));
  try {
    const file = path.join(directory, 'session.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE session_v2 (id TEXT, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER)');
    const insert = db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('one', 90, 20, 0, 10, 0); insert.run('two', 70, 10, 10, 30, 5); db.close();
    assert.deepEqual(sessionTokens(file), { input: 160, output: 30, reasoning: 10, cached: 40, cacheWrite: 5, total: 245, sessions: 2 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
