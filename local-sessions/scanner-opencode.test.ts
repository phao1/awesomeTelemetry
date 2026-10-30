import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { initSchema } from '../server/storage/schema.js';
import { listTraceIdentities } from '../server/storage/trace-links.js';
import { codeagent2Scanner } from './codeagent2.js';
import { codeartsScanner } from './codearts.js';
import { opencodeScanner, readOpenCodeDb } from './opencode.js';
import { opencodeAdapter } from '../src/adapters/opencode.js';
import {
  upsertIndexEntries,
  type ScannerContext,
} from './scanner-utils.js';

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

/** T-03：含 3 个会话的 OpenCode 系 SQLite（真实 DDL）。 */
function createMultiSessionDb(dir: string): string {
  const dbPath = join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, version INTEGER, time TEXT, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, sessionID TEXT, role TEXT, time TEXT, model TEXT, tokens TEXT, error TEXT, parentID TEXT, info TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, messageID TEXT, sessionID TEXT, type TEXT, text TEXT, tool TEXT, state TEXT, time TEXT);
  `);
  const sessions = [
    { id: 'oc-s1', title: 'fix build', created: 1754000000000, updated: 1754000060000 },
    { id: 'oc-s2', title: 'refactor api', created: 1754001000000, updated: 1754001060000 },
    { id: 'oc-s3', title: 'debug login', created: 1754002000000, updated: 1754002060000 },
  ];
  const insertSession = db.prepare(
    'INSERT INTO session (id, title, version, time, directory) VALUES (?, ?, ?, ?, ?)',
  );
  const insertMessage = db.prepare(
    'INSERT INTO message (id, sessionID, role, time, model, tokens, error, parentID, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertPart = db.prepare(
    'INSERT INTO part (id, messageID, sessionID, type, text, tool, state, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const s of sessions) {
    insertSession.run(s.id, s.title, 3, JSON.stringify({ created: s.created, updated: s.updated }), '/tmp/proj');
    insertMessage.run(`u-${s.id}`, s.id, 'user', JSON.stringify({ created: s.created }), null, null, null, null, null);
    insertMessage.run(
      `a-${s.id}`, s.id, 'assistant', JSON.stringify({ created: s.created + 10000, completed: s.created + 30000 }),
      'gpt-4o', JSON.stringify({ input: 10, output: 5, cache: { read: 100, write: 0 } }), null, `u-${s.id}`, null,
    );
    insertPart.run(`p1-${s.id}`, `u-${s.id}`, s.id, 'text', 'hello', null, null, null);
    insertPart.run(
      `p2-${s.id}`, `a-${s.id}`, s.id, 'tool', null, 'Bash',
      JSON.stringify({ status: 'completed', title: 'npm test' }), null,
    );
  }
  db.close();
  return dbPath;
}

/** T-03：真实 OpenCode v2 schema —— message/part 只有 JSON data 列，session 用 epoch 时间列。 */
function createRealSchemaDb(dir: string): string {
  const dbPath = join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT, version INTEGER,
      directory TEXT, time_created INTEGER, time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
      time_created INTEGER, time_updated INTEGER, data TEXT
    );
  `);
  const insertSession = db.prepare(
    'INSERT INTO session (id, title, version, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertMessage = db.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
  );
  const insertPart = db.prepare(
    'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertSession.run('ses-1', 'fix build', 3, '/tmp/a', 1754000000000, 1754000060000);
  insertSession.run('ses-2', 'debug login', 3, '/tmp/b', 1754001000000, 1754001060000);
  insertMessage.run('m1', 'ses-1', 1754000000000, 1754000000000,
    JSON.stringify({ role: 'user', time: { created: 1754000000000 }, agent: 'build' }));
  insertMessage.run('m2', 'ses-1', 1754000010000, 1754000030000,
    JSON.stringify({
      role: 'assistant', time: { created: 1754000010000, completed: 1754000030000 },
      parentID: 'm1', modelID: 'gpt-4o', mode: 'build',
      tokens: { total: 117, input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 0 } },
    }));
  insertMessage.run('m3', 'ses-2', 1754001000000, 1754001000000,
    JSON.stringify({ role: 'user', time: { created: 1754001000000 }, agent: 'build' }));
  insertMessage.run('m4', 'ses-2', 1754001010000, 1754001030000,
    JSON.stringify({
      role: 'assistant', time: { created: 1754001010000, completed: 1754001030000 },
      parentID: 'm3', modelID: 'gpt-4o', mode: 'build',
      tokens: { total: 17, input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 0 } },
    }));
  insertPart.run('p1', 'm1', 'ses-1', 1754000000000, 1754000000000,
    JSON.stringify({ type: 'text', text: 'fix the build' }));
  insertPart.run('p2', 'm2', 'ses-1', 1754000010000, 1754000030000,
    JSON.stringify({ type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } }));
  insertPart.run('p3', 'm3', 'ses-2', 1754001000000, 1754001000000,
    JSON.stringify({ type: 'text', text: 'debug login' }));
  insertPart.run('p4', 'm4', 'ses-2', 1754001010000, 1754001030000,
    JSON.stringify({ type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } }));
  db.close();
  return dbPath;
}

describe('REQ-010 OpenCode 系 scanner（sqlite）', () => {
  it('P1 dataCols preserves only finite numeric part.data.time endpoints', () => {
    const dbPath = createRealSchemaDb(tempDir());
    const source = new Database(dbPath);
    const update = source.prepare('UPDATE part SET data = ? WHERE id = ?');
    try {
      for (const [time, expected] of [
        [{ start: 1754000001000, end: 1754000002000, extra: 42 }, { start: 1754000001000, end: 1754000002000 }],
        [{ start: 0, end: 'bad' }, { start: 0 }],
        [{ start: 'bad', end: 42 }, { end: 42 }],
        [{ start: '1000', end: null }, undefined],
        [null, undefined], [[], undefined], ['bad', undefined],
      ] as const) {
        update.run(JSON.stringify({ type: 'text', text: 'timed', time }), 'p1');
        expect(readOpenCodeDb(dbPath)[0]?.messages[0]?.content?.[0]?.time).toEqual(expected);
      }
      // JSON supports overflowing numeric literals; they parse to Infinity.
      update.run('{"type":"text","time":{"start":1e999,"end":-1e999}}', 'p1');
      expect(readOpenCodeDb(dbPath)[0]?.messages[0]?.content?.[0]?.time).toBeUndefined();
    } finally {
      source.close();
    }
  });

  it('keeps optional legacy session.parentID and part.callID without inventing fields for old schemas', () => {
    const dir = tempDir();
    const dbPath = createOpenCodeDb(dir);
    const before = readOpenCodeDb(dbPath);
    expect(before[0]?.session.parentID).toBeUndefined();
    expect(before[0]?.messages[1]?.content?.[0]?.callID).toBeUndefined();
    const source = new Database(dbPath);
    source.exec('ALTER TABLE session ADD COLUMN parentID TEXT; ALTER TABLE part ADD COLUMN callID TEXT');
    source.prepare('UPDATE session SET parentID = ? WHERE id = ?').run('parent-session', 'oc-s1');
    source.prepare('UPDATE part SET callID = ? WHERE id = ?').run('native-call:9', 'p2');
    source.close();
    const item = readOpenCodeDb(dbPath)[0]!;
    const record = opencodeAdapter.normalize({ sourceAgent: 'OpenCode', session: item.session, events: item.messages }, dbPath);
    expect(record.nativeIdentities?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'parent_session', value: 'parent-session', scope: 'oc-s1' }),
      expect.objectContaining({ kind: 'tool_call', value: 'native-call:9', scope: 'oc-s1' }),
    ]));
  });
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
    expect(row.token_cache_read).toBe(100); // 单条消息：sum == 100
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

describe('T-03 SQLite 类多会话索引', () => {
  it('索引阶段按 session 行展开：3 会话产出 3 条且 title 为真实标题', () => {
    const dir = tempDir();
    const dbPath = createMultiSessionDb(dir);
    const db = newDb();
    const cfg = config('opencode', dir);

    const entries = opencodeScanner.buildIndexEntries(cfg, dbPath);
    expect(entries).toHaveLength(3);
    const titles = entries.map((e) => e.title).sort();
    expect(titles).toEqual(['debug login', 'fix build', 'refactor api']);
    for (const entry of entries) {
      expect(entry.title).not.toBe('opencode.db');
      expect(entry.id).toMatch(/^opencode-[0-9a-f]{14}$/);
      expect(entry.detailLoaded).toBe(false);
    }

    upsertIndexEntries(db, entries);
    const count = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    expect(count.c).toBe(3);
    db.close();
  });

  it('scanProvider 写入 3 个会话，event 分属各会话', async () => {
    const dir = tempDir();
    createMultiSessionDb(dir);
    const db = newDb();
    const result = await opencodeScanner.scanProvider(config('opencode', dir), {
      db,
      traeKeyPath: null,
    } satisfies ScannerContext);

    expect(result.files).toBe(1);
    expect(result.eventCount).toBe(6);
    const rows = db
      .prepare('SELECT provider, title, event_count, detail_loaded FROM sessions ORDER BY title')
      .all() as Array<{ provider: string; title: string; event_count: number; detail_loaded: number }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.title)).toEqual(['debug login', 'fix build', 'refactor api']);
    expect(rows.every((r) => r.provider === 'opencode' && r.event_count === 2 && r.detail_loaded === 1)).toBe(true);
    db.close();
  });

  it('索引后惰性详情：sessions 仍只有 3 行，全部 detail_loaded=1', async () => {
    const dir = tempDir();
    const dbPath = createMultiSessionDb(dir);
    const db = newDb();
    const cfg = config('opencode', dir);
    upsertIndexEntries(db, opencodeScanner.buildIndexEntries(cfg, dbPath));

    await opencodeScanner.scanFile(cfg, dbPath, { db, traeKeyPath: null } satisfies ScannerContext);
    const rows = db
      .prepare('SELECT COUNT(*) AS c, SUM(detail_loaded) AS loaded, SUM(event_count) AS events FROM sessions')
      .get() as { c: number; loaded: number; events: number };
    expect(rows.c).toBe(3);
    expect(rows.loaded).toBe(3);
    expect(rows.events).toBe(6);
    db.close();
  });
});

describe('T-03 真实 OpenCode v2 schema（JSON data 列）', () => {
  it.each([
    ['opencode', opencodeScanner], ['codearts', codeartsScanner], ['codeagent2', codeagent2Scanner],
  ] as const)('preserves native parent/session/call identities from real SQLite to %s storage', async (provider, scanner) => {
    const dir = tempDir();
    const dbPath = createRealSchemaDb(dir);
    const source = new Database(dbPath);
    source.exec('ALTER TABLE session ADD COLUMN parent_id TEXT');
    source.prepare('UPDATE session SET parent_id = ? WHERE id = ?').run('ses-1', 'ses-2');
    source.prepare('UPDATE part SET data = ? WHERE id = ?').run(JSON.stringify({
      type: 'tool', callID: 'native-call:2', tool: 'Bash', state: { status: 'completed', title: 'npm test' },
    }), 'p4');
    source.close();
    const samples = readOpenCodeDb(dbPath);
    const child = samples.find(item => item.session.id === 'ses-2')!;
    const record = opencodeAdapter.normalize({ sourceAgent: 'OpenCode', session: child.session, events: child.messages }, dbPath);
    expect(record.nativeIdentities?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ namespace: 'agent:opencode', kind: 'parent_session', value: 'ses-1', scope: 'ses-2', sourcePath: 'session.parentID' }),
      expect.objectContaining({ namespace: 'agent:opencode', kind: 'tool_call', value: 'native-call:2', scope: 'ses-2', sourcePath: 'messages[1].content[0].callID' }),
    ]));
    expect(record.nativeIdentities?.items.some(item => item.kind === 'parent_session' && item.value === 'm3')).toBe(false);
    expect(record.events).toHaveLength(2);
    expect(record.session.tokenUsage.cacheRead).toBe(100);
    const db = newDb();
    try {
      await scanner.scanProvider(config(provider, dir), { db, traeKeyPath: null });
      const sessions = db.prepare('SELECT id, title FROM sessions ORDER BY title').all() as Array<{ id: string; title: string }>;
      const childKey = sessions.find(item => item.title === 'debug login')!.id;
      const identities = listTraceIdentities(db, { source: 'scan', key: childKey });
      expect(identities.parserVersion).toBe(3);
      expect(identities.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ namespace: 'agent:' + provider, kind: 'parent_session', value: 'ses-1', scope: 'ses-2' }),
        expect.objectContaining({ namespace: 'agent:' + provider, kind: 'tool_call', value: 'native-call:2', scope: 'ses-2', eventId: 'm4-0' }),
      ]));
      expect(identities.items.some(item => item.kind === 'parent_session' && item.value === 'm3')).toBe(false);
    } finally { db.close(); }
  });
  it('索引阶段按 session 行展开，title 为真实标题', () => {
    const dir = tempDir();
    const dbPath = createRealSchemaDb(dir);
    const cfg = config('opencode', dir);
    const entries = opencodeScanner.buildIndexEntries(cfg, dbPath);
    expect(entries.map((e) => e.title).sort()).toEqual(['debug login', 'fix build']);
    expect(entries.every((e) => e.id.startsWith('opencode-'))).toBe(true);
  });

  it('scanProvider 解析 JSON data 列入库，token 聚合语义不变', async () => {
    const dir = tempDir();
    createRealSchemaDb(dir);
    const db = newDb();
    const result = await opencodeScanner.scanProvider(config('opencode', dir), {
      db,
      traeKeyPath: null,
    } satisfies ScannerContext);
    expect(result.eventCount).toBe(4);
    const rows = db
      .prepare('SELECT provider, token_cache_read, detail_loaded FROM sessions ORDER BY title')
      .all() as Array<{ provider: string; token_cache_read: number; detail_loaded: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.provider === 'opencode' && r.token_cache_read === 100 && r.detail_loaded === 1)).toBe(true);
    db.close();
  });
});
