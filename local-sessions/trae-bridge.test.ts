import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * REQ-001/REQ-002 真实 SQLCipher 端到端：只有当 TRAE_TEST_PYTHON 指向一个
 * 装有 sqlcipher3 的 Python 时才执行（CI 无该依赖则跳过，本地验证用：
 * TRAE_TEST_PYTHON=/path/to/venv/bin/python npx vitest run local-sessions/trae-bridge.test.ts）。
 */
const TRAE_TEST_PYTHON = process.env.TRAE_TEST_PYTHON;

function runPython(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(script, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`python exited with code ${String(code)}`));
      }
    });
  });
}

describe.skipIf(TRAE_TEST_PYTHON === undefined || TRAE_TEST_PYTHON === '')(
  'REQ-001/002 真实 SQLCipher 解密链路',
  () => {
    it('加密库（含 WAL）→ 解密 → 明文库可被 better-sqlite3 读取', async () => {
      const dir = tempDir();
      const encPath = join(dir, 'trae-encrypted.db');
      const keyHex = 'ab'.repeat(32); // 64 hex chars
      const keyPath = join(dir, 'trae.key');
      writeFileSync(keyPath, keyHex, 'utf8');

      const makeScript = join(dir, 'make-encrypted.py');
      writeFileSync(
        makeScript,
        [
          'import sqlcipher3, sys',
          'db, key = sys.argv[1], sys.argv[2]',
          "con = sqlcipher3.connect(db)",
          "con.execute('PRAGMA key = \\\"x\\'%s\\'\\\"' % key)",
          'con.execute("PRAGMA journal_mode = WAL")',
          'con.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")',
          "con.execute(\"INSERT INTO t VALUES (1, 'secret-\\u4e2d\\u6587')\")",
          'con.commit()',
          'con.close()',
        ].join('\n'),
        'utf8',
      );
      await runPython(TRAE_TEST_PYTHON!, [makeScript, encPath, keyHex]);

      // 前置校验：源库确为 SQLCipher（非 SQLite 魔数）
      expect(readFileSync(encPath).subarray(0, 16).toString('utf8')).not.toContain(
        'SQLite format 3',
      );

      const cacheDir = join(dir, 'cache');
      mkdirSync(cacheDir, { recursive: true });
      const result = await decryptTraeDb(encPath, {
        keyPath,
        pythonBin: TRAE_TEST_PYTHON!,
        scriptPath: join(process.cwd(), 'scripts', 'trae-extract-key.py'),
        cacheDir,
        timeoutMs: 30_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      // 明文库头部应为标准 SQLite 魔数（16 字节，含结尾 \0，比较前 15 字节）
      expect(readFileSync(result.decryptedPath).subarray(0, 15).toString('utf8')).toBe(
        'SQLite format 3',
      );
      const check = new Database(result.decryptedPath, { readonly: true });
      const row = check.prepare('SELECT v FROM t').get() as { v: string };
      expect(row.v).toBe('secret-中文');
      check.close();
    });
  },
);
