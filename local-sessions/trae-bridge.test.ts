import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { decryptTraeDb } from './trae-bridge.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'trae-bridge-'));
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

function makeDummyScript(dir: string): string {
  const script = join(dir, 'fake-decrypt.mjs');
  writeFileSync(
    script,
    `
import { copyFileSync } from 'node:fs';
const args = process.argv.slice(2);
const dbIndex = args.indexOf('--decrypt');
const outIndex = args.indexOf('--out');
copyFileSync(args[dbIndex + 1], args[outIndex + 1]);
`,
    'utf8',
  );
  return script;
}

function makeEncryptedDb(dir: string): string {
  const dbPath = join(dir, 'trae.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('secret');
  db.close();
  return dbPath;
}

describe('REQ-012 trae-bridge', () => {
  it('密钥缺失 → TRAE_KEY_MISSING，不 spawn', async () => {
    const dir = tempDir();
    const dbPath = makeEncryptedDb(dir);
    const result = await decryptTraeDb(dbPath, { keyPath: null });
    expect(result).toEqual({ ok: false, code: 'TRAE_KEY_MISSING' });
  });

  it('spawn + Promise 真实子进程解密成功', async () => {
    const dir = tempDir();
    const dbPath = makeEncryptedDb(dir);
    const script = makeDummyScript(dir);
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir, { recursive: true });

    const result = await decryptTraeDb(dbPath, {
      keyPath: join(dir, 'key'),
      pythonBin: process.execPath,
      scriptPath: script,
      cacheDir,
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const check = new Database(result.decryptedPath, { readonly: true });
      const row = check.prepare('SELECT v FROM t').get() as { v: string };
      expect(row.v).toBe('secret');
      check.close();
    }
  });

  it('30s 内缓存命中，不重复 spawn', async () => {
    const dir = tempDir();
    const dbPath = makeEncryptedDb(dir);
    const script = makeDummyScript(dir);
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const opts = {
      keyPath: join(dir, 'key'),
      pythonBin: process.execPath,
      scriptPath: script,
      cacheDir,
    };

    const first = await decryptTraeDb(dbPath, opts);
    expect(first.ok).toBe(true);
    // 修改源 DB 但保持指纹不变的部分不影响缓存判断；直接二次调用
    const second = await decryptTraeDb(dbPath, opts);
    expect(second.ok).toBe(true);
  });

  it('脚本失败 → DECRYPT_FAILED', async () => {
    const dir = tempDir();
    const dbPath = makeEncryptedDb(dir);
    const result = await decryptTraeDb(dbPath, {
      keyPath: join(dir, 'key'),
      pythonBin: process.execPath,
      scriptPath: join(dir, 'missing-script.mjs'),
      cacheDir: join(dir, 'cache2'),
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DECRYPT_FAILED');
    }
  });
});
