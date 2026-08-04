import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { initSchema } from '../server/storage/schema.js';
import { codeagent2Scanner } from './codeagent2.js';
import { codeartsScanner } from './codearts.js';
import { opencodeScanner } from './opencode.js';
import type { ScannerContext } from './scanner-utils.js';

type Db = InstanceType<typeof Database>;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-sqlite-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function config(key: string, path: string): ProviderConfig {
  return {
    key: key as ProviderConfig['key'],
    enabled: true,
    path,
    sourceKind: 'sqlite',
    watchStrategy: 'poll',
    pollIntervalMs: 30000,
    label: key,
  };
}

function createOpenCodeDb(dir: string): string {
  const dbPath = join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, version INTEGER, time TEXT, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, sessionID TEXT, role TEXT, time TEXT, model TEXT, tokens TEXT, error TEXT, parentID TEXT, info TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, messageID TEXT, sessionID TEXT, type TEXT, text TEXT, tool TEXT, state TEXT, time TEXT);
  `);
  db.prepare('INSERT INTO session (id, title, version, time, directory) VALUES (?, ?, ?, ?, ?)').run(
    'oc-s1',
    'fix build',
    3,
    JSON.stringify({ created: 1754000000000, updated: 1754000060000 }),
    '/tmp/proj',
  );
  db.prepare(
    'INSERT INTO message (id, sessionID, role, time, model, tokens, error, parentID, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'm1', 'oc-s1', 'user', JSON.stringify({ created: 1754000000000 }), null, null, null, null, null,
  );
  db.prepare(
    'INSERT INTO message (id, sessionID, role, time, model, tokens, error, parentID, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'm2', 'oc-s1', 'assistant', JSON.stringify({ created: 1754000010000, completed: 1754000030000 }),
    'gpt-4o', JSON.stringify({ input: 10, output: 5, cache: { read: 100, write: 0 } }), null, 'm1', null,
  );
  db.prepare(
    'INSERT INTO part (id, messageID, sessionID, type, text, tool, state, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('p1', 'm1', 'oc-s1', 'text', 'fix the build', null, null, null);
  db.prepare(
    'INSERT INTO part (id, messageID, sessionID, type, text, tool, state, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'p2', 'm2', 'oc-s1', 'tool', null, 'Bash',
    JSON.stringify({ status: 'completed', title: 'npm test' }), null,
  );
  db.close();
  return dbPath;
}

describe('REQ-010 OpenCode 系 scanner（sqlite）', () => {
  it('opencode scanner：读 message join part 并入库', async () => {
    const dir = tempDir();
    createOpenCodeDb(dir);
    const db = newDb();
    const result = await opencodeScanner.scanProvider(config('opencode', dir), {
      db,
      traeKeyPath: null,
    } satisfies ScannerContext);

    expect(result.files).toBe(1);
    expect(result.eventCount).toBe(2);
    const row = db.prepare('SELECT provider, token_cache_read FROM sessions').get() as {
      provider: string;
      token_cache_read: number;
    };
    expect(row.provider).toBe('opencode');
    expect(row.token_cache_read).toBe(100); // cumulative max
    db.close();
  });

  it('codearts / codeagent2 thin wrapper scanner', async () => {
    const dir = tempDir();
    createOpenCodeDb(dir);
    const db = newDb();
    const arts = await codeartsScanner.scanProvider(config('codearts', dir), { db, traeKeyPath: null });
    const mate = await codeagent2Scanner.scanProvider(config('codeagent2', dir), { db, traeKeyPath: null });
    expect(arts.eventCount).toBe(2);
    expect(mate.eventCount).toBe(2);
    const rows = db
      .prepare('SELECT provider FROM sessions ORDER BY provider')
      .all() as Array<{ provider: string }>;
    expect(rows.map((r) => r.provider).sort()).toEqual(['codeagent2', 'codearts']);
    db.close();
  });
});
