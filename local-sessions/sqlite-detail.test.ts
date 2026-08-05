import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { LocalSessionConfig, SessionIndexEntry } from '../src/core/trace-types.js';
import { initSchema } from '../server/storage/schema.js';
import { getSessionDetail } from '../server/storage/query-engine.js';
import { scanAndStoreDetail } from '../server/watch/scan-scheduler.js';
import { opencodeScanner } from './opencode.js';
import { upsertIndexEntries } from './scanner-utils.js';

type Db = InstanceType<typeof Database>;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-detail-'));
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

function config(dir: string): LocalSessionConfig {
  return {
    prewarmRecent: 0,
    traeKeyPath: null,
    providers: {
      claude: { key: 'claude', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude' },
      codex: { key: 'codex', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Codex' },
      opencode: { key: 'opencode', enabled: true, path: dir, sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'OpenCode' },
      codearts: { key: 'codearts', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeArts' },
      codeagent: { key: 'codeagent', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'CodeAgent' },
      codeagent2: { key: 'codeagent2', enabled: false, path: '/none', sourceKind: 'sqlite', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeAgent 2.0' },
      trae: { key: 'trae', enabled: false, path: '/none', sourceKind: 'sqlcipher', watchStrategy: 'poll', pollIntervalMs: 30000, label: 'Trae' },
      qoder: { key: 'qoder', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Qoder' },
      workbuddy: { key: 'workbuddy', enabled: false, path: '/none', sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'WorkBuddy' },
    },
  };
}

/** T-11（2.1）：真实 DDL，含 3 个会话。 */
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
    { id: 'oc-s1', title: 'fix build', created: 1754000000000 },
    { id: 'oc-s2', title: 'refactor api', created: 1754001000000 },
    { id: 'oc-s3', title: 'debug login', created: 1754002000000 },
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
    insertSession.run(s.id, s.title, 3, JSON.stringify({ created: s.created, updated: s.created + 60000 }), '/tmp/proj');
    insertMessage.run(`u-${s.id}`, s.id, 'user', JSON.stringify({ created: s.created }), null, null, null, null, null);
    insertMessage.run(
      `a-${s.id}`, s.id, 'assistant', JSON.stringify({ created: s.created + 10000, completed: s.created + 30000 }),
      'gpt-4o', JSON.stringify({ input: 10, output: 5, reasoning: 3, cache: { read: 100, write: 0 } }), null, `u-${s.id}`, null,
    );
    insertMessage.run(
      `a2-${s.id}`, s.id, 'assistant', JSON.stringify({ created: s.created + 20000, completed: s.created + 40000 }),
      'gpt-4o', JSON.stringify({ input: 10, output: 5, reasoning: 3, cache: { read: 100, write: 0 } }), null, `a-${s.id}`, null,
    );
    insertPart.run(`p1-${s.id}`, `u-${s.id}`, s.id, 'text', `hello ${s.id}`, null, null, null);
    insertPart.run(
      `p2-${s.id}`, `a-${s.id}`, s.id, 'tool', null, 'Bash',
      JSON.stringify({ status: 'completed', title: 'npm test' }), null,
    );
    insertPart.run(`p3-${s.id}`, `a2-${s.id}`, s.id, 'text', 'done', null, null, null);
  }
  db.close();
  return dbPath;
}

function indexAndSeed(db: Db, dbPath: string): SessionIndexEntry[] {
  const entries = opencodeScanner.buildIndexEntries(config(dirnameOf(dbPath)).providers.opencode!, dbPath);
  upsertIndexEntries(db, entries);
  return entries;
}

function dirnameOf(dbPath: string): string {
  return dbPath.slice(0, dbPath.lastIndexOf('/'));
}

describe('REQ-022 SQLite 类详情解析（T-11）', () => {
  it('2.1 含 3 个会话的库逐个定位解析，每个 events.length > 0 且 title 非空', async () => {
    const dir = tempDir();
    const dbPath = createMultiSessionDb(dir);
    const db = newDb();
    const cfg = config(dir);
    const entries = indexAndSeed(db, dbPath);
    expect(entries).toHaveLength(3);

    for (const entry of entries) {
      const result = await scanAndStoreDetail(db, entry.id, { config: cfg });
      expect(result?.skipped).toBe(false);
      const detail = getSessionDetail(db, entry.id, { mode: 'slim' });
      expect(detail).not.toBeNull();
      expect(detail!.events.length).toBeGreaterThan(0);
      expect(detail!.session.title).not.toBe('');
    }
    const rows = db
      .prepare('SELECT id, detail_loaded, event_count FROM sessions ORDER BY title')
      .all() as Array<{ id: string; detail_loaded: number; event_count: number }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.detail_loaded === 1 && r.event_count === 3)).toBe(true);
    db.close();
  });

  it('2.1 按会话定位：打开一个会话只写该会话，不整库落库', async () => {
    const dir = tempDir();
    const dbPath = createMultiSessionDb(dir);
    const db = newDb();
    const cfg = config(dir);
    const entries = indexAndSeed(db, dbPath);
    await scanAndStoreDetail(db, entries[0]!.id, { config: cfg });
    const rows = db
      .prepare('SELECT id, detail_loaded FROM sessions ORDER BY title')
      .all() as Array<{ id: string; detail_loaded: number }>;
    expect(rows.filter((r) => r.detail_loaded === 1)).toHaveLength(1);
    db.close();
  });

  it('2.2 损坏的库返回 SESSION_PARSE_FAILED（非 2xx 语义），不返回 200 + 空', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'corrupt.db');
    writeFileSync(dbPath, Buffer.from('this is not a sqlite database, definitely corrupt bytes'));
    const db = newDb();
    const cfg = config(dir);
    // 索引阶段对损坏库跳过（REQ-013），这里手工播种一行代表「曾经成功索引过」
    const fakeEntry: SessionIndexEntry = {
      id: 'opencode-corrupt000000',
      provider: 'opencode',
      sourceAgent: 'OpenCode',
      title: 'corrupt',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      status: 'unknown',
      cwd: null,
      eventCount: 0,
      messageCount: 0,
      tokenTotal: 0,
      costUsd: 0,
      dataSource: 'scan',
      sourcePath: dbPath,
      detailLoaded: false,
      mergeGroupId: null,
      hasSystemPrompt: false,
    };
    upsertIndexEntries(db, [fakeEntry]);

    await expect(scanAndStoreDetail(db, fakeEntry.id, { config: cfg })).rejects.toMatchObject({
      code: 'SESSION_PARSE_FAILED',
    });
    db.close();
  });

  it('2.5 G4.4（2026-08-03 校准）：cache.read 增量用 sum、reasoning 用 sum', async () => {
    const dir = tempDir();
    const dbPath = createMultiSessionDb(dir);
    const db = newDb();
    const cfg = config(dir);
    const entries = indexAndSeed(db, dbPath);
    for (const entry of entries) {
      await scanAndStoreDetail(db, entry.id, { config: cfg });
    }
    const rows = db
      .prepare('SELECT token_cache_read, token_reasoning FROM sessions')
      .all() as Array<{ token_cache_read: number; token_reasoning: number }>;
    // 每个会话 2 条 assistant 消息各带 cache.read=100 / reasoning=3
    for (const row of rows) {
      expect(row.token_cache_read).toBe(200); // sum(100,100)，不是 max
      expect(row.token_reasoning).toBe(6); // sum(3,3)，不是 3
    }
    db.close();
  });
});
