import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { fingerprintFile, fingerprintSqliteWithWal } from './fingerprint.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'watch-fp-'));
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

describe('REQ-002 文件指纹', () => {
  it('REQ-002 返回 size / mtimeMs / hash，且稳定', () => {
    const path = join(tempDir(), 'a.jsonl');
    writeFileSync(path, 'line1\nline2\nline3\n');

    const a = fingerprintFile(path);
    const b = fingerprintFile(path);

    expect(a.size).toBe('line1\nline2\nline3\n'.length);
    expect(a.mtimeMs).toBe(Math.floor(statSync(path).mtimeMs));
    expect(a.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(b).toEqual(a);
  });

  it('REQ-002 只读首尾各 4KB：改动中间字节 hash 不变', () => {
    const path = join(tempDir(), 'big.jsonl');
    const content = Buffer.alloc(16 * 1024, 0x61); // 16KB，head/tail 不重叠
    writeFileSync(path, content);

    const before = fingerprintFile(path);
    content[8 * 1024] = 0x62; // 中间
    writeFileSync(path, content);
    const after = fingerprintFile(path);

    expect(after.hash).toBe(before.hash);
    expect(after.size).toBe(before.size);
  });

  it('REQ-002 头部变化与追加都会改变 hash', () => {
    const path = join(tempDir(), 'b.jsonl');
    writeFileSync(path, 'aaaa\nbbbb\n');
    const before = fingerprintFile(path);

    writeFileSync(path, 'xxxx\nbbbb\n');
    const headChanged = fingerprintFile(path);
    expect(headChanged.hash).not.toBe(before.hash);

    writeFileSync(path, 'xxxx\nbbbb\ncccc\n');
    const appended = fingerprintFile(path);
    expect(appended.hash).not.toBe(headChanged.hash);
  });
});

describe('REQ-002 WAL 型双文件指纹', () => {
  it('REQ-002 只改 -wal 文件也能检测到变更', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'sessions.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('one');

    const before = fingerprintSqliteWithWal(dbPath);
    const mainOnlyBefore = fingerprintFile(dbPath);

    db.prepare('INSERT INTO t (v) VALUES (?)').run('two');
    const after = fingerprintSqliteWithWal(dbPath);
    const mainOnlyAfter = fingerprintFile(dbPath);

    // 主文件指纹未变（WAL 模式下写入走 -wal）
    expect(mainOnlyAfter).toEqual(mainOnlyBefore);
    // 合并指纹必须变化
    expect(after.hash).not.toBe(before.hash);
    expect(after.hash).toContain(':');
    db.close();
  });
});
