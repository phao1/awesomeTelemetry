import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { initSchema } from '../server/storage/schema.js';
import { traeScanner } from './trae.js';
import type { ScannerContext } from './scanner-utils.js';

type Db = InstanceType<typeof Database>;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-trae-'));
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

function config(path: string): ProviderConfig {
  return {
    key: 'trae',
    enabled: true,
    path,
    sourceKind: 'sqlcipher',
    watchStrategy: 'poll',
    pollIntervalMs: 30000,
    label: 'Trae CN',
  };
}

function makeTraeSourceDb(dir: string): void {
  const db = new Database(join(dir, 'trae-s1.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE server_history_info (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      status TEXT,
      type TEXT,
      start_time INTEGER,
      end_time INTEGER,
      content_source TEXT,
      token_usage INTEGER,
      content TEXT
    );
  `);
  db.prepare(
    `INSERT INTO server_history_info (id, session_id, status, type, start_time, end_time, content_source, token_usage, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('t1', 'trae-s1', 'completed', 'user', 1754000000, 1754000001, null, null, 'login broken');
  db.prepare(
    `INSERT INTO server_history_info (id, session_id, status, type, start_time, end_time, content_source, token_usage, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('t2', 'trae-s1', 'completed', 'llm', 1754000002, 1754000004, 'llm_default', 200, 'found it');
  db.close();
}

function makeDummyDecryptScript(dir: string): string {
  const script = join(dir, 'fake-decrypt.mjs');
  writeFileSync(
    script,
    `
import { copyFileSync } from 'node:fs';
const args = process.argv.slice(2);
copyFileSync(args[args.indexOf('--decrypt') + 1], args[args.indexOf('--out') + 1]);
`,
    'utf8',
  );
  return script;
}

describe('REQ-010/012 Trae scanner', () => {
  it('密钥缺失时返回 TRAE_KEY_MISSING，不静默跳过', async () => {
    const dir = tempDir();
    makeTraeSourceDb(dir);
    const db = newDb();
    const result = await traeScanner.scanProvider(config(dir), { db, traeKeyPath: null });
    expect(result.blocked).toBe('TRAE_KEY_MISSING');
    expect(result.eventCount).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });

  it('密钥就绪时 spawn 解密并入库（真实子进程）', async () => {
    const dir = tempDir();
    makeTraeSourceDb(dir);
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const script = makeDummyDecryptScript(dir);
    const db = newDb();

    const result = await traeScanner.scanProvider(config(dir), {
      db,
      traeKeyPath: join(dir, 'trae.key'),
      traeBridge: { pythonBin: process.execPath, scriptPath: script, cacheDir, timeoutMs: 10_000 },
    } satisfies ScannerContext);

    expect(result.blocked).toBeUndefined();
    expect(result.eventCount).toBe(2);
    const session = db
      .prepare('SELECT provider, token_output FROM sessions')
      .get() as { provider: string; token_output: number };
    expect(session.provider).toBe('trae');
    expect(session.token_output).toBe(100); // 200 / 2 校准
    db.close();
  });
});
