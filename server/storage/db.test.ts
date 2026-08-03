import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { checkpointWal, openReadonly, openWritable } from './db.js';
import { SCHEMA_VERSION, initSchema } from './schema.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'storage-db-'));
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

describe('REQ-001 连接初始化', () => {
  it('REQ-001 openWritable 自动创建父目录', () => {
    const dir = tempDir();
    const path = join(dir, 'nested', 'deep', 'db.sqlite');

    const db = openWritable(path);
    expect(existsSync(join(dir, 'nested', 'deep'))).toBe(true);
    expect(db.open).toBe(true);
    db.close();
  });

  it('REQ-001 八项 PRAGMA 全部生效（真实文件库）', () => {
    const path = join(tempDir(), 'pragma.sqlite');
    const db = openWritable(path);
    initSchema(db);

    const simple = true as const;
    expect(db.pragma('journal_mode', { simple })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple })).toBe(1);
    expect(db.pragma('synchronous', { simple })).toBe(1); // NORMAL
    expect(db.pragma('wal_autocheckpoint', { simple })).toBe(2000);
    expect(db.pragma('cache_size', { simple })).toBe(-65536);
    expect(db.pragma('mmap_size', { simple })).toBe(268435456);
    expect(db.pragma('temp_store', { simple })).toBe(2); // MEMORY
    expect(db.pragma('busy_timeout', { simple })).toBe(5000);

    db.close();
  });

  it('REQ-001 openReadonly 文件不存在时报错', () => {
    expect(() => openReadonly(join(tempDir(), 'missing.sqlite'))).toThrow();
  });

  it('REQ-001 openReadonly 为只读连接，写入报错', () => {
    const path = join(tempDir(), 'ro.sqlite');
    const writable = openWritable(path);
    initSchema(writable);
    writable.close();

    const db = openReadonly(path);
    expect(db.readonly).toBe(true);
    expect(() => db.exec('CREATE TABLE forbidden (a INTEGER)')).toThrow();
    db.close();
  });
});

describe('REQ-002 checkpoint 不得阻塞', () => {
  it('REQ-002 checkpointWal 空闲库上不抛错，journal 保持 wal', () => {
    const path = join(tempDir(), 'ckpt.sqlite');
    const db = openWritable(path);
    initSchema(db);

    expect(() => checkpointWal(db)).not.toThrow();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');

    db.close();
  });
});

describe('REQ-003 数据库版本高于代码', () => {
  it('REQ-003 高版本库中止且不改写版本', () => {
    const path = join(tempDir(), 'future.sqlite');
    const seed = new Database(path);
    seed.exec(
      'CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
    );
    seed
      .prepare('INSERT INTO _meta (key, value) VALUES (?, ?)')
      .run('schema_version', '99');
    seed.close();

    expect(() => openWritable(path)).toThrow('数据库由更新版本创建');

    const check = new Database(path, { readonly: true });
    const row = check
      .prepare('SELECT value FROM _meta WHERE key = ?')
      .get('schema_version') as { value: string };
    expect(row.value).toBe('99');
    expect(Number(row.value)).toBeGreaterThan(SCHEMA_VERSION);
    check.close();
  });
});
