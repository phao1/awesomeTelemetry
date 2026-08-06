import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { initSchema } from '../server/storage/schema.js';
import { readTraeDb, traeScanner } from './trae.js';
import { normalizeTraeSample } from '../src/adapters/trae.js';
import { upsertIndexEntries, type ScannerContext } from './scanner-utils.js';
import { deriveSessionKey } from './session-key.js';

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

/** 2026-08 Trae CN 当前真实方言：server_history_info 使用 history_id /
 * source / created_at / messages，正文嵌套在 raw_messages。 */
function makeTraeCurrentSchemaDb(dir: string): string {
  const path = join(dir, 'trae-current.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE server_history_info (
      history_id TEXT PRIMARY KEY,
      client_history_id TEXT,
      conversation_id TEXT,
      session_id TEXT,
      agent_run_id TEXT,
      messages TEXT,
      token_usage INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      agent_type TEXT,
      item_token_usage INTEGER
    );
    CREATE TABLE chat_session (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      session_title TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE chat_message (
      message_id TEXT PRIMARY KEY,
      session_id TEXT
    );
    CREATE TABLE chat_turn (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_type TEXT,
      agent_name TEXT,
      context TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE history_v2 (
      history_v2_id TEXT PRIMARY KEY,
      session_id TEXT,
      content_source TEXT,
      messages TEXT,
      created_at INTEGER
    );
  `);
  const payload = (role: string, text: string, toolCalls: unknown[] = []): string =>
    JSON.stringify({
      mode: 'default',
      raw_messages: [{
        role,
        content: [{ type: 'text', text }],
        tool_calls: toolCalls,
      }],
    });
  const insert = db.prepare(`
    INSERT INTO server_history_info (
      history_id, client_history_id, conversation_id, session_id, agent_run_id,
      messages, token_usage, created_at, updated_at, source, agent_type, item_token_usage
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    'h-user', 'c-user', 'conv-1', 'msg-user', 'run-1',
    payload('user', '<system-reminder>Terminal state is ready.</system-reminder><system-reminder>Language: 中文</system-reminder><user_input>修复登录</user_input>'),
    0, 1754000000, 1754000001, 'user_input', 'dev_agent', 8,
  );
  insert.run(
    'h-llm', 'c-llm', 'conv-1', 'msg-llm', 'run-1',
    payload('assistant', '我来检查', [{ function: { name: 'Read', arguments: '{"path":"a.ts"}' } }]),
    200, 1754000002, 1754000003, 'llm_default', 'dev_agent', 120,
  );
  insert.run(
    'h-read', 'c-read', 'conv-1', 'msg-read', 'run-1',
    payload('tool', '文件内容'), 0, 1754000004, 1754000005, 'Read', 'dev_agent', 20,
  );
  db.prepare(
    'INSERT INTO chat_session (id, session_id, session_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('row-s1', 'current-s1', '当前方言会话', 1754000000, 1754000005);
  const insertMessage = db.prepare('INSERT INTO chat_message (message_id, session_id) VALUES (?, ?)');
  insertMessage.run('msg-user', 'current-s1');
  insertMessage.run('msg-llm', 'current-s1');
  insertMessage.run('msg-read', 'current-s1');
  db.prepare(
    'INSERT INTO chat_turn (id, session_id, agent_type, agent_name, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'turn-1', 'current-s1', 'dev_agent', 'Trae CN',
    JSON.stringify({
      locale: 'zh',
      persist_user_message_context: {
        model_info: {
          model_name: 'glm-5.2__dev', config_name: 'glm-5.2', prompt_max_tokens: 100000,
          max_tokens: 16000, max_turn: 70, is_preset: true,
          extra_config: { v3_enable_skill_tool: true, disabled: false },
        },
      },
    }),
    1754000000, 1754000001,
  );
  db.prepare(
    'INSERT INTO history_v2 (history_v2_id, session_id, content_source, messages, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    'v2-llm', 'current-s1', 'llm_default',
    payload('assistant', '', []), 1754000002,
  );
  db.close();
  return path;
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

  it('aggregate-native-sessions：后台扫描展开占位、清理删除会话且未变时跳过', async () => {
    const dir = tempDir();
    const sourceDir = join(dir, 'source');
    mkdirSync(sourceDir, { recursive: true });
    const path = makeTraeCurrentSchemaDb(sourceDir);
    const source = new Database(path);
    source.prepare(
      'INSERT INTO chat_session (id, session_id, session_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('row-second', 'current-s2', '当前方言会话', 1754000100, 1754000105);
    source.close();

    const db = newDb();
    const provider = config(sourceDir);
    const placeholder = traeScanner.buildIndexEntries(provider, path)[0]!;
    upsertIndexEntries(db, [placeholder]);
    const notifications: string[] = [];
    const script = makeDummyDecryptScript(dir);
    const first = await traeScanner.scanProvider(provider, {
      db,
      force: true,
      notify: (key) => notifications.push(key),
      traeKeyPath: join(dir, 'trae.key'),
      traeBridge: {
        pythonBin: process.execPath,
        scriptPath: script,
        cacheDir: join(dir, 'cache-first'),
        timeoutMs: 10_000,
      },
    });

    const firstRows = db.prepare(
      'SELECT id, title, event_count FROM sessions WHERE provider = ? ORDER BY title, id',
    ).all('trae') as Array<{ id: string; title: string; event_count: number }>;
    const firstKeys = [
      deriveSessionKey('trae', path, 'current-s1'),
      deriveSessionKey('trae', path, 'current-s2'),
    ];
    expect(first.scanned).toBe(1);
    expect(firstRows.map((row) => row.id).sort()).toEqual([...firstKeys].sort());
    expect(firstRows).toHaveLength(2);
    expect(firstRows.map((row) => row.title)).toEqual(['当前方言会话', '当前方言会话']);
    const promptRow = db.prepare(
      'SELECT provider, source, completeness, sections_json, model_config_json, full_system_prompt FROM session_prompt_context WHERE session_id = ?',
    ).get(firstKeys[0]) as {
      provider: string; source: string; completeness: string; sections_json: string;
      model_config_json: string; full_system_prompt: string | null;
    };
    expect(promptRow).toMatchObject({
      provider: 'trae', source: 'trae_db', completeness: 'dynamic_only', full_system_prompt: null,
    });
    expect(JSON.parse(promptRow.sections_json)).toHaveLength(2);
    expect(JSON.parse(promptRow.model_config_json)).toMatchObject({ modelName: 'glm-5.2__dev' });
    expect(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(placeholder.id)).toBeUndefined();
    expect(notifications).toEqual(expect.arrayContaining([placeholder.id, ...firstKeys]));

    notifications.length = 0;
    const unchanged = await traeScanner.scanProvider(provider, {
      db,
      notify: (key) => notifications.push(key),
      traeKeyPath: join(dir, 'trae.key'),
      traeBridge: {
        pythonBin: process.execPath,
        scriptPath: script,
        cacheDir: join(dir, 'cache-unchanged'),
        timeoutMs: 10_000,
      },
    });
    expect(unchanged.skipped).toBe(1);
    expect(notifications).toEqual([]);

    const changedSource = new Database(path);
    changedSource.prepare('DELETE FROM chat_session WHERE session_id = ?').run('current-s2');
    changedSource.close();
    const reconciled = await traeScanner.scanProvider(provider, {
      db,
      force: true,
      notify: (key) => notifications.push(key),
      traeKeyPath: join(dir, 'trae.key'),
      traeBridge: {
        pythonBin: process.execPath,
        scriptPath: script,
        cacheDir: join(dir, 'cache-reconciled'),
        timeoutMs: 10_000,
      },
    });
    expect(reconciled.scanned).toBe(1);
    expect(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(firstKeys[1])).toBeUndefined();
    expect(notifications).toContain(firstKeys[1]);
    db.close();
  });

  it('当前真实方言：created_at/source/messages + raw_messages 可解析', () => {
    const dir = tempDir();
    const path = makeTraeCurrentSchemaDb(dir);

    const sample = readTraeDb(path)[0]!;

    expect(sample.session).toMatchObject({
      id: 'current-s1',
      title: '当前方言会话',
      agentType: 'dev_agent',
      agentName: 'Trae CN',
    });
    expect(sample.turns).toHaveLength(3);
    expect(sample.promptContext).toMatchObject({
      source: 'trae_db',
      completeness: 'dynamic_only',
      capturedAt: '2025-07-31T22:13:20.000Z',
      modelConfig: { modelName: 'glm-5.2__dev', promptMaxTokens: 100000 },
      analysis: { sectionCount: 2, duplicateSectionCount: 0 },
      fullSystemPrompt: null,
    });
    expect(sample.turns[0]).toMatchObject({
      id: 'h-user',
      type: 'user',
      startTime: 1754000000,
      endTime: 1754000001,
      contentSource: 'user_input',
      content: '修复登录',
    });
    expect(sample.turns[1]).toMatchObject({
      id: 'h-llm',
      type: 'llm',
      contentSource: 'llm_default',
      tokenUsage: 200,
      itemTokenUsage: 120,
      content: '我来检查',
      toolName: 'Read',
      toolParams: '{"path":"a.ts"}',
    });
    expect(sample.turns[2]).toMatchObject({
      id: 'h-read',
      type: 'read_file',
      contentSource: 'Read',
      content: '文件内容',
      toolName: 'Read',
      toolResult: '文件内容',
    });

    const record = normalizeTraeSample(
      { sourceAgent: 'Trae', session: sample.session, events: sample.turns },
      path,
    );
    expect(record.events.map((event) => event.kind)).toEqual(['user_prompt', 'llm', 'file_read']);
    expect(record.events[1]?.tokens).toMatchObject({ input: 80, output: 120, total: 200 });
    expect(record.events[0]?.startedAt).toBe('2025-07-31T22:13:20.000Z');
  });

  it('aggregate-native-sessions：按原生 session_id 隔离事件，重复标题不合并且保留空会话', () => {
    const dir = tempDir();
    const path = makeTraeCurrentSchemaDb(dir);
    const db = new Database(path);
    const payload = JSON.stringify({
      raw_messages: [{ role: 'user', content: [{ type: 'text', text: '第二个会话' }] }],
    });
    db.prepare(
      'INSERT INTO chat_session (id, session_id, session_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('row-s2', 'current-s2', '当前方言会话', 1754000100, 1754000105);
    db.prepare(
      'INSERT INTO chat_session (id, session_id, session_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('row-s3', 'current-s3', '空会话', 1754000200, 1754000210);
    db.prepare('INSERT INTO chat_message (message_id, session_id) VALUES (?, ?)')
      .run('msg-s2', 'current-s2');
    db.prepare(`
      INSERT INTO server_history_info (
        history_id, client_history_id, conversation_id, session_id, agent_run_id,
        messages, token_usage, created_at, updated_at, source, agent_type, item_token_usage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'h-s2', 'c-s2', 'conv-2', 'msg-s2', 'run-2', payload,
      0, 1754000101, 1754000102, 'user_input', 'dev_agent', 0,
    );
    db.close();

    const samples = readTraeDb(path);
    expect(samples.map((sample) => sample.session.id)).toEqual([
      'current-s1',
      'current-s2',
      'current-s3',
    ]);
    expect(samples.filter((sample) => sample.session.title === '当前方言会话')).toHaveLength(2);
    expect(samples.find((sample) => sample.session.id === 'current-s1')?.turns).toHaveLength(3);
    expect(samples.find((sample) => sample.session.id === 'current-s2')?.turns).toMatchObject([
      { id: 'h-s2', sessionId: 'current-s2', content: '第二个会话' },
    ]);
    const empty = samples.find((sample) => sample.session.id === 'current-s3')!;
    expect(empty.turns).toEqual([]);
    const emptyRecord = normalizeTraeSample(
      { sourceAgent: 'Trae', session: empty.session, events: empty.turns },
      path,
    );
    expect(emptyRecord.session).toMatchObject({
      title: '空会话',
      startedAt: '2025-07-31T22:16:40.000Z',
      updatedAt: '2025-07-31T22:16:50.000Z',
      eventCount: 0,
    });
  });

  it('当前真实方言：user_input 去掉 IDE 注入的 system-reminder', () => {
    const dir = tempDir();
    const path = makeTraeCurrentSchemaDb(dir);
    const db = new Database(path);
    const injected = JSON.stringify({
      raw_messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<system-reminder>check whether a skill matches the <user_input> intent</system-reminder>',
          },
          { type: 'text', text: '<user_input>\n新的消息\n</user_input>' },
          {
            type: 'text',
            text: '<system-reminder>again compare a skill with the <user_input> intent</system-reminder>',
          },
        ],
      }],
    });
    db.prepare("UPDATE server_history_info SET messages = ? WHERE history_id = 'h-user'").run(injected);
    db.close();

    const sample = readTraeDb(path)[0]!;
    expect(sample.turns[0]).toMatchObject({
      id: 'h-user',
      type: 'user',
      content: '新的消息',
    });
  });

  it('B8.4 llmIndex 错位修复：多 session 文件里每行只消费自己 session 的正文', () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'trae-multi-session.db'));
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
    `);
    // 行按 start_time 排序：s2 的 llm 行在前，s1 的 llm 行在后
    db.prepare(
      `INSERT INTO server_history_info VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('r1', 's2', 'completed', 'llm', 1754000000, 1754000001, 'llm_default', 100, 50, null, 'm2');
    db.prepare(
      `INSERT INTO server_history_info VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('r2', 's1', 'completed', 'llm', 1754000002, 1754000003, 'llm_default', 200, 120, null, 'm1');
    db.prepare(`INSERT INTO chat_session VALUES (?, ?, ?, ?, ?)`).run(
      's1', 'main session', 'solo_coder', 'Trae CN', 1754000000,
    );
    // history_v2 按 created_at 排序：s1 的行在前（旧实现会把 M1 配给 s2 的 r1）
    db.prepare(`INSERT INTO history_v2 VALUES (?, ?, ?, ?)`).run(
      's1', 1754000000, 'llm_default',
      JSON.stringify([{ role: 'assistant', reasoning_content: 'M1-s1' }]),
    );
    db.prepare(`INSERT INTO history_v2 VALUES (?, ?, ?, ?)`).run(
      's2', 1754000001, 'llm_default',
      JSON.stringify([{ role: 'assistant', reasoning_content: 'M2-s2' }]),
    );
    db.close();

    const samples = readTraeDb(join(dir, 'trae-multi-session.db'));
    const records = samples.map((sample) => normalizeTraeSample(
      { sourceAgent: 'Trae', session: sample.session, events: sample.turns },
      join(dir, 'trae-multi-session.db'),
    ));
    expect(records.map((record) => record.session.id).sort()).toEqual(['s1', 's2']);
    // r1 属于 s2 → 只拿到 s2 的 M2；r2 属于 s1 → 只拿到 s1 的 M1。
    expect(records.find((record) => record.session.id === 's2')?.events).toHaveLength(1);
    expect(records.find((record) => record.session.id === 's2')?.events[0]?.outputSummary).toBe('M2-s2');
    expect(records.find((record) => record.session.id === 's1')?.events).toHaveLength(1);
    expect(records.find((record) => record.session.id === 's1')?.events[0]?.outputSummary).toBe('M1-s1');
  });

  it('B8 isSubagent：chat_session.agent_type 命中子代理名单时落库 is_subagent=1', () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'trae-subagent.db'));
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
      CREATE TABLE chat_session (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        agent_type TEXT,
        agent_name TEXT,
        created_at INTEGER
      );
    `);
    db.prepare(
      `INSERT INTO server_history_info VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('r1', 'sub-s1', 'completed', 'user', 1754000000, 1754000001, null, null, null, 'do it');
    db.prepare(`INSERT INTO chat_session VALUES (?, ?, ?, ?, ?)`).run(
      'sub-s1', 'refactor scope', 'refactor_scoper', 'Scoper', 1754000000,
    );
    db.close();

    const sample = readTraeDb(join(dir, 'trae-subagent.db'))[0]!;
    const record = normalizeTraeSample(
      { sourceAgent: 'Trae', session: sample.session, events: sample.turns },
      join(dir, 'trae-subagent.db'),
    );
    expect(record.session.isSubagent).toBe(true);
    expect(record.session.sourceAgent).toBe('Scoper'); // agent_name
  });
});
