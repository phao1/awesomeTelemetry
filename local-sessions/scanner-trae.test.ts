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
      item_token_usage INTEGER,
      content TEXT
    );
  `);
  db.prepare(
    `INSERT INTO server_history_info (id, session_id, status, type, start_time, end_time, content_source, token_usage, item_token_usage, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('t1', 'trae-s1', 'completed', 'user', 1754000000, 1754000001, null, null, null, 'login broken');
  db.prepare(
    `INSERT INTO server_history_info (id, session_id, status, type, start_time, end_time, content_source, token_usage, item_token_usage, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('t2', 'trae-s1', 'completed', 'llm', 1754000002, 1754000004, 'llm_default', 200, 120, 'found it');
  db.close();
}

/** #7：带 chat_session / history_v2 / chat_message_task 的完整 Trae 库。 */
function makeTraeMultiTableDb(dir: string): void {
  const db = new Database(join(dir, 'trae-multi.db'));
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
      item_token_usage INTEGER,
      content TEXT,
      message_id TEXT
    );
    CREATE TABLE chat_session (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      agent_type TEXT,
      agent_name TEXT,
      created_at INTEGER
    );
    CREATE TABLE history_v2 (
      session_id TEXT,
      created_at INTEGER,
      content_source TEXT,
      messages TEXT
    );
    CREATE TABLE chat_message_task (
      message_id TEXT PRIMARY KEY,
      tool_name TEXT,
      tool_params TEXT,
      tool_result TEXT
    );
  `);
  db.prepare(
    `INSERT INTO server_history_info (id, session_id, status, type, start_time, end_time, content_source, token_usage, item_token_usage, content, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    't1', 'trae-m1', 'completed', 'llm', 1754000000, 1754000002,
    'llm_default', 300, 180, null, 'msg-llm-1',
  );
  db.prepare(
    `INSERT INTO chat_session (session_id, title, agent_type, agent_name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('trae-m1', 'trae 标题', 'solo_coder', 'Trae CN', 1754000000);
  db.prepare(
    `INSERT INTO history_v2 (session_id, created_at, content_source, messages)
     VALUES (?, ?, ?, ?)`,
  ).run(
    'trae-m1',
    1754000000,
    'llm_default',
    JSON.stringify([
      { role: 'assistant', reasoning_content: '先读测试文件', content: '' },
    ]),
  );
  db.prepare(
    `INSERT INTO chat_message_task (message_id, tool_name, tool_params, tool_result)
     VALUES (?, ?, ?, ?)`,
  ).run('msg-llm-1', 'Read', '{"path":"a.ts"}', 'file contents');
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
      .prepare('SELECT provider, token_output, token_input FROM sessions')
      .get() as { provider: string; token_output: number; token_input: number };
    expect(session.provider).toBe('trae');
    expect(session.token_output).toBe(120); // item_token_usage
    expect(session.token_input).toBe(80); // token_usage - item_token_usage
    db.close();
  });

  it('#7 多表查询：标题/agent 元数据/reasoning 回退/工具调用', async () => {
    const dir = tempDir();
    makeTraeMultiTableDb(dir);
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const script = makeDummyDecryptScript(dir);
    const db = newDb();

    await traeScanner.scanProvider(config(dir), {
      db,
      traeKeyPath: join(dir, 'trae.key'),
      traeBridge: { pythonBin: process.execPath, scriptPath: script, cacheDir, timeoutMs: 10_000 },
    } satisfies ScannerContext);

    const session = db
      .prepare('SELECT title, source_agent FROM sessions')
      .get() as { title: string; source_agent: string };
    expect(session.title).toBe('trae 标题');
    expect(session.source_agent).toBe('Trae CN'); // agent_name

    const events = db
      .prepare('SELECT output_summary, tool, tokens_json FROM events ORDER BY sequence')
      .all() as Array<{ output_summary: string | null; tool: string | null; tokens_json: string | null }>;
    // reasoning_content 回退为 outputSummary；工具调用挂到 tool；token 正常拆分
    expect(events[0]?.output_summary).toBe('先读测试文件');
    expect(events[0]?.tool).toBe('Read');
    expect(JSON.parse(events[0]?.tokens_json ?? '{}')).toMatchObject({
      input: 120,
      output: 180,
      total: 300,
    });
    db.close();
  });
});
