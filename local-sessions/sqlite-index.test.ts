import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { opencodeScanner } from './opencode.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-index-'));
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

function config(path: string) {
  return {
    key: 'opencode' as const,
    enabled: true,
    path,
    sourceKind: 'sqlite' as const,
    watchStrategy: 'poll' as const,
    pollIntervalMs: 30000,
    label: 'OpenCode',
  };
}

describe('REQ-021 SQLite 类索引标题与事件数（T-10 1.5）', () => {
  it('会话行自带 title 时用 title；eventCount = COUNT(*) 消息数', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'opencode.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, version INTEGER, time TEXT, directory TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, sessionID TEXT, role TEXT, time TEXT, model TEXT, tokens TEXT, error TEXT, parentID TEXT, info TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, messageID TEXT, sessionID TEXT, type TEXT, text TEXT, tool TEXT, state TEXT, time TEXT);
    `);
    db.prepare('INSERT INTO session (id, title, version, time, directory) VALUES (?, ?, ?, ?, ?)').run(
      's1', 'fix build', 3, JSON.stringify({ created: 1754000000000 }), '/tmp',
    );
    db.prepare('INSERT INTO message (id, sessionID, role, time) VALUES (?, ?, ?, ?)').run('m1', 's1', 'user', JSON.stringify({ created: 1754000000000 }));
    db.prepare('INSERT INTO message (id, sessionID, role, time) VALUES (?, ?, ?, ?)').run('m2', 's1', 'assistant', JSON.stringify({ created: 1754000010000 }));
    db.prepare('INSERT INTO part (id, messageID, sessionID, type, text) VALUES (?, ?, ?, ?, ?)').run('p1', 'm1', 's1', 'text', 'fix the build');
    db.close();

    const entries = opencodeScanner.buildIndexEntries(config(dir), dbPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('fix build');
    expect(entries[0]!.eventCount).toBe(2);
  });

  it('会话行 title 为空时取首条 user 消息正文', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'opencode.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, version INTEGER, time TEXT, directory TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, sessionID TEXT, role TEXT, time TEXT, model TEXT, tokens TEXT, error TEXT, parentID TEXT, info TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, messageID TEXT, sessionID TEXT, type TEXT, text TEXT, tool TEXT, state TEXT, time TEXT);
    `);
    db.prepare('INSERT INTO session (id, title, version, time, directory) VALUES (?, ?, ?, ?, ?)').run(
      's1', '', 3, JSON.stringify({ created: 1754000000000 }), '/tmp',
    );
    db.prepare('INSERT INTO message (id, sessionID, role, time) VALUES (?, ?, ?, ?)').run('m1', 's1', 'user', JSON.stringify({ created: 1754000000000 }));
    db.prepare('INSERT INTO message (id, sessionID, role, time) VALUES (?, ?, ?, ?)').run('m2', 's1', 'assistant', JSON.stringify({ created: 1754000010000 }));
    db.prepare('INSERT INTO part (id, messageID, sessionID, type, text) VALUES (?, ?, ?, ?, ?)').run('p1', 'm1', 's1', 'text', '帮我修一下构建');
    db.prepare('INSERT INTO part (id, messageID, sessionID, type, text) VALUES (?, ?, ?, ?, ?)').run('p2', 'm2', 's1', 'text', '好的');
    db.close();

    const entries = opencodeScanner.buildIndexEntries(config(dir), dbPath);
    expect(entries[0]!.title).toBe('帮我修一下构建');
    expect(entries[0]!.eventCount).toBe(2);
  });

  it('无 title 且无 user 消息时回落 `<provider> session · <时间>`，不含 .db', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'opencode.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, version INTEGER, time TEXT, directory TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, sessionID TEXT, role TEXT, time TEXT, model TEXT, tokens TEXT, error TEXT, parentID TEXT, info TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, messageID TEXT, sessionID TEXT, type TEXT, text TEXT, tool TEXT, state TEXT, time TEXT);
    `);
    db.prepare('INSERT INTO session (id, title, version, time, directory) VALUES (?, ?, ?, ?, ?)').run(
      's1', '', 3, JSON.stringify({ created: 1754000000000 }), '/tmp',
    );
    db.close();

    const entries = opencodeScanner.buildIndexEntries(config(dir), dbPath);
    expect(entries[0]!.title).toMatch(/^opencode session · /);
    expect(entries[0]!.title).not.toContain('.db');
    expect(entries[0]!.eventCount).toBe(0);
  });

  it('真实 schema（data 列）：首条 user 消息取 text part 做标题', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'opencode.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT, title TEXT, version INTEGER,
        directory TEXT, time_created INTEGER, time_updated INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
      );
    `);
    db.prepare('INSERT INTO session (id, title, version, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)').run(
      's1', '', 1, '/tmp', 1754000000000, 1754000001000,
    );
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
      'm1', 's1', 1754000000000, 1754000000100,
      JSON.stringify({ role: 'user', time: { created: 1754000000000 } }),
    );
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
      'm2', 's1', 1754000001000, 1754000002000,
      JSON.stringify({ role: 'assistant', time: { created: 1754000001000 } }),
    );
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(
      'p1', 'm1', 's1', 1754000000000, 1754000000100,
      JSON.stringify({ type: 'text', text: '启动项目，看一下当前状态' }),
    );
    db.close();

    const entries = opencodeScanner.buildIndexEntries(config(dir), dbPath);
    expect(entries[0]!.title).toBe('启动项目，看一下当前状态');
    expect(entries[0]!.eventCount).toBe(2);
  });
});
