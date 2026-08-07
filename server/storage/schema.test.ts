import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { EVENT_SLIM_COLS, SESSION_LIST_COLS } from './columns.js';
import { openWritable } from './db.js';
import {
  CAPTURE_GROUP_PREDECESSOR_SQL,
  EXACT_SESSION_PREDECESSOR_SQL,
} from './query-engine.js';
import { SCHEMA_VERSION, initSchema } from './schema.js';

type Db = InstanceType<typeof Database>;

const EXPECTED_TABLES = [
  '_meta',
  'sessions',
  'events',
  'event_raw',
  'metrics',
  'scan_state',
  'proxy_requests',
  'frida_captures',
  'session_prompt_context',
];

const EXPECTED_INDEXES = [
  'idx_events_session_seq',
  'idx_events_session_phase',
  'idx_events_kind',
  'idx_events_phase',
  'idx_events_tool',
  'idx_events_session_kind',
  'idx_sessions_ds_started',
  'idx_sessions_started_at',
  'idx_sessions_provider',
  'idx_sessions_source_agent',
  'idx_sessions_started_prov',
  'idx_scan_state_provider',
  'idx_scan_state_session',
  'idx_proxy_started_len',
  'idx_proxy_hostname',
  'idx_proxy_parsed_session',
  'idx_proxy_session_format_id',
  'idx_proxy_group_format_model_id',
  'idx_frida_captured_at',
  'idx_frida_session',
  'idx_frida_capture_session',
];

/** v5 的 proxy_requests DDL（v6 迁移前形态，无 capture_group_id / request_format）。 */
const V5_PROXY_REQUESTS_DDL = `
CREATE TABLE proxy_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id        TEXT    NOT NULL UNIQUE,
  method            TEXT    NOT NULL,
  url               TEXT    NOT NULL,
  hostname          TEXT    NOT NULL,
  request_headers   TEXT,
  request_body      TEXT,
  response_status   INTEGER,
  response_body     TEXT,
  content_type      TEXT,
  is_streaming      INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT    NOT NULL,
  completed_at      TEXT,
  duration_ms       INTEGER,
  capture_method    TEXT    NOT NULL DEFAULT 'mitm',
  ttnet_encrypted   INTEGER NOT NULL DEFAULT 0,
  system_prompt     TEXT,
  system_prompt_len INTEGER NOT NULL DEFAULT 0,
  model             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  parsed_session_id TEXT,
  parser_route      TEXT,
  raw_request_body  TEXT,
  raw_response_body TEXT
);`;

function proxyRequestColumns(db: Db): string[] {
  const cols = db.prepare('PRAGMA table_info(proxy_requests)').all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'storage-schema-'));
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

function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return db;
}

function explain(db: Db, sql: string, params: unknown[]): string {
  const rows = db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join('\n');
}

describe('REQ-003 建库幂等', () => {
  it('REQ-003 连续三次 initSchema 无副作用无报错', () => {
    const db = createDb(join(tempDir(), 'schema.sqlite'));

    expect(() => {
      initSchema(db);
      initSchema(db);
      initSchema(db);
    }).not.toThrow();

    const meta = db
      .prepare('SELECT key, value FROM _meta')
      .all() as Array<{ key: string; value: string }>;
    expect(meta).toEqual([{ key: 'schema_version', value: String(SCHEMA_VERSION) }]);

    for (const table of EXPECTED_TABLES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      expect(row, `表 ${table} 应存在`).toBeTruthy();
    }
    for (const index of EXPECTED_INDEXES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index);
      expect(row, `索引 ${index} 应存在`).toBeTruthy();
    }

    db.close();
  });

  it('v6 新库直建两列：capture_group_id 可空、request_format 默认 unknown', () => {
    const db = createDb(join(tempDir(), 'fresh-v6.sqlite'));
    initSchema(db);

    const cols = proxyRequestColumns(db);
    expect(cols).toContain('capture_group_id');
    expect(cols).toContain('request_format');

    // 未显式给出 request_format 的行默认 'unknown'，capture_group_id 为 NULL
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at)
       VALUES ('req-1', 'POST', 'https://h', 'h', '2026-08-01T00:00:00.000Z')`,
    ).run();
    const row = db
      .prepare(
        `SELECT capture_group_id, request_format FROM proxy_requests WHERE request_id = 'req-1'`,
      )
      .get() as { capture_group_id: string | null; request_format: string };
    expect(row.capture_group_id).toBeNull();
    expect(row.request_format).toBe('unknown');

    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as {
      value: string;
    };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('REQ-003 三条核心查询 EXPLAIN QUERY PLAN 不含 USE TEMP B-TREE', () => {
    const db = createDb(join(tempDir(), 'plan.sqlite'));
    initSchema(db);

    const plans = [
      explain(
        db,
        `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT ?`,
        ['scan', 50],
      ),
      explain(
        db,
        `SELECT ${EVENT_SLIM_COLS} FROM events WHERE session_id = ? ORDER BY sequence LIMIT ? OFFSET ?`,
        ['s1', 2000, 0],
      ),
      explain(
        db,
        `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1`,
        ['2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'],
      ),
    ];

    expect(plans.join('\n')).not.toContain('USE TEMP B-TREE');
    expect(plans[0]).toContain('idx_sessions_ds_started');
    expect(plans[1]).toContain('idx_events_session_seq');
    expect(plans[2]).toContain('idx_proxy_started_len');

    db.close();
  });

  it('design D4 前驱查询 EXPLAIN：使用复合索引且无 USE TEMP B-TREE（含 null-safe model）', () => {
    const db = createDb(join(tempDir(), 'pred-plan.sqlite'));
    initSchema(db);

    const plans = [
      explain(db, EXACT_SESSION_PREDECESSOR_SQL, ['s1', 'anthropic_messages', 2]),
      explain(db, CAPTURE_GROUP_PREDECESSOR_SQL, ['g1', 'anthropic_messages', null, 2]),
      explain(db, CAPTURE_GROUP_PREDECESSOR_SQL, ['g1', 'anthropic_messages', 'claude-3', 2]),
    ];

    expect(plans.join('\n')).not.toContain('USE TEMP B-TREE');
    expect(plans[0]).toContain('idx_proxy_session_format_id');
    expect(plans[1]).toContain('idx_proxy_group_format_model_id');
    expect(plans[2]).toContain('idx_proxy_group_format_model_id');

    db.close();
  });

  it('v2 → v3 迁移：metrics.repair_loop 补列 + schema_version 升到 3（幂等）', () => {
    const db = createDb(join(tempDir(), 'migrate.sqlite'));
    // 构造一个 v2 库（无 repair_loop）
    db.exec(`
      CREATE TABLE metrics (
        session_id TEXT PRIMARY KEY,
        total_steps INTEGER NOT NULL DEFAULT 0,
        duration_by_phase TEXT NOT NULL DEFAULT '{}',
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        verification_present INTEGER NOT NULL DEFAULT 0,
        avg_tool_duration_ms REAL NOT NULL DEFAULT 0,
        verification_coverage REAL NOT NULL DEFAULT 0,
        error_rate REAL NOT NULL DEFAULT 0,
        entered_debug INTEGER NOT NULL DEFAULT 0,
        tokens_per_step REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        calc_version INTEGER NOT NULL DEFAULT 0,
        ttft_ms REAL,
        e2e_ms REAL
      ) WITHOUT ROWID;
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      INSERT INTO _meta VALUES ('schema_version', '2');
    `);
    initSchema(db);
    const cols = db.prepare('PRAGMA table_info(metrics)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'repair_loop')).toBe(true);
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    // 幂等：重复 initSchema 不报错
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });

  it('v3 → v4 迁移：metrics 五新列补上 + 旧行保留（calibrate-tokens §4）', () => {
    const db = createDb(join(tempDir(), 'migrate-v3.sqlite'));
    // 构造一个 v3 库（无五个新列），并写入一行旧 metrics
    db.exec(`
      CREATE TABLE metrics (
        session_id TEXT PRIMARY KEY,
        total_steps INTEGER NOT NULL DEFAULT 0,
        duration_by_phase TEXT NOT NULL DEFAULT '{}',
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        verification_present INTEGER NOT NULL DEFAULT 0,
        avg_tool_duration_ms REAL NOT NULL DEFAULT 0,
        verification_coverage REAL NOT NULL DEFAULT 0,
        error_rate REAL NOT NULL DEFAULT 0,
        entered_debug INTEGER NOT NULL DEFAULT 0,
        tokens_per_step REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        calc_version INTEGER NOT NULL DEFAULT 0,
        ttft_ms REAL,
        e2e_ms REAL,
        repair_loop INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      INSERT INTO _meta VALUES ('schema_version', '3');
    `);
    db.prepare(
      `INSERT INTO metrics (session_id, total_steps, calc_version) VALUES ('s1', 10, 3)`,
    ).run();
    initSchema(db);
    const cols = db.prepare('PRAGMA table_info(metrics)').all() as Array<{ name: string }>;
    for (const col of [
      'total_tool_duration_ms',
      'llm_call_count',
      'user_interaction_rounds',
      'has_unit_tests',
      'failed_command_count',
    ]) {
      expect(cols.some((c) => c.name === col), `metrics.${col}`).toBe(true);
    }
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    // 非破坏性：旧行仍在，calc_version 保持 3（由读取侧触发重算回填）
    const row = db
      .prepare('SELECT session_id, total_steps, calc_version, llm_call_count FROM metrics WHERE session_id = ?')
      .get('s1') as { session_id: string; total_steps: number; calc_version: number; llm_call_count: number };
    expect(row).toEqual({ session_id: 's1', total_steps: 10, calc_version: 3, llm_call_count: 0 });
    // 幂等：重复 initSchema 不报错
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });

  it('v4 → v5 迁移：新增 Prompt Context 表且旧 session 保留', () => {
    const db = createDb(join(tempDir(), 'migrate-v4.sqlite'));
    initSchema(db);
    db.prepare("UPDATE _meta SET value = '4' WHERE key = 'schema_version'").run();
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES ('s-v4', 'trae', 'Trae', 'old', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z', '/tmp/trae.db')`,
    ).run();

    initSchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_prompt_context'")
      .get();
    expect(table).toBeTruthy();
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get('s-v4');
    expect(session).toBeTruthy();
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('v5 → v6 迁移：两列幂等补列 + 两条复合索引 + 历史行 null/unknown（2.2/2.3）', () => {
    const db = createDb(join(tempDir(), 'migrate-v5.sqlite'));
    // 构造 v5 库：proxy_requests 无两新列，含一条历史行（带 raw 原文，用于验证非破坏性）
    db.exec(`
      ${V5_PROXY_REQUESTS_DDL}
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      INSERT INTO _meta VALUES ('schema_version', '5');
    `);
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at,
         model, parsed_session_id, request_body, raw_request_body)
       VALUES ('hist-1', 'POST', 'https://h', 'h', '2026-08-01T00:00:00.000Z',
         'claude-3', 's-old', '{"messages":[]}', 'RAW-SECRET-ONLY')`,
    ).run();

    initSchema(db);

    // 两列已补上
    const cols = proxyRequestColumns(db);
    expect(cols).toContain('capture_group_id');
    expect(cols).toContain('request_format');
    // 两条复合索引已建
    for (const index of ['idx_proxy_session_format_id', 'idx_proxy_group_format_model_id']) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index);
      expect(row, `索引 ${index} 应存在`).toBeTruthy();
    }
    // schema_version 升到 6
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as {
      value: string;
    };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    // 历史行非破坏：capture_group_id NULL、request_format 'unknown'、raw 原文保留
    const row = db
      .prepare(
        `SELECT request_id, capture_group_id, request_format, raw_request_body FROM proxy_requests
         WHERE request_id = 'hist-1'`,
      )
      .get() as {
        request_id: string;
        capture_group_id: string | null;
        request_format: string;
        raw_request_body: string;
      };
    expect(row.request_id).toBe('hist-1');
    expect(row.capture_group_id).toBeNull();
    expect(row.request_format).toBe('unknown');
    expect(row.raw_request_body).toBe('RAW-SECRET-ONLY');
    // 幂等：重复 initSchema 不报错、版本不变、列不重复
    expect(() => initSchema(db)).not.toThrow();
    expect(proxyRequestColumns(db).filter((c) => c === 'request_format')).toHaveLength(1);
    db.close();
  });

  it('REQ-003 更新版本库拒绝启动且不改写（schema.test 侧覆盖，2.3）', () => {
    const path = join(tempDir(), 'future-schema.sqlite');
    const seed = createDb(path);
    seed.exec('CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
    seed
      .prepare('INSERT INTO _meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION + 1));
    seed.close();

    expect(() => openWritable(path)).toThrow('Database was created by a newer version');

    const check = new Database(path, { readonly: true });
    const value = (check
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string }).value;
    expect(value).toBe(String(SCHEMA_VERSION + 1));
    check.close();
  });

  it('v1 → v3 全链迁移：8 个 v2 列 + repair_loop 全部补上（9.7）', () => {
    const db = createDb(join(tempDir(), 'migrate-v1.sqlite'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_agent TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown', cwd TEXT, message_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0, token_input INTEGER NOT NULL DEFAULT 0,
        token_output INTEGER NOT NULL DEFAULT 0, token_reasoning INTEGER NOT NULL DEFAULT 0,
        token_cache_read INTEGER NOT NULL DEFAULT 0, token_cache_write INTEGER NOT NULL DEFAULT 0,
        token_total INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        system_prompt TEXT, source_path TEXT NOT NULL, data_source TEXT NOT NULL DEFAULT 'scan',
        total_duration_ms INTEGER NOT NULL DEFAULT 0, is_subagent INTEGER NOT NULL DEFAULT 0,
        detail_loaded INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;
      CREATE TABLE events (
        session_id TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL,
        kind TEXT NOT NULL, phase TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unknown', actor TEXT NOT NULL DEFAULT '',
        tool TEXT, input_summary TEXT, output_summary TEXT, tokens_json TEXT, error TEXT,
        PRIMARY KEY (session_id, id)
      ) WITHOUT ROWID;
      CREATE TABLE metrics (
        session_id TEXT PRIMARY KEY, total_steps INTEGER NOT NULL DEFAULT 0,
        duration_by_phase TEXT NOT NULL DEFAULT '{}', tool_call_count INTEGER NOT NULL DEFAULT 0,
        verification_present INTEGER NOT NULL DEFAULT 0, avg_tool_duration_ms REAL NOT NULL DEFAULT 0,
        verification_coverage REAL NOT NULL DEFAULT 0, error_rate REAL NOT NULL DEFAULT 0,
        entered_debug INTEGER NOT NULL DEFAULT 0, tokens_per_step REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0, calc_version INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      INSERT INTO _meta VALUES ('schema_version', '1');
    `);
    initSchema(db);
    const sessions = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    const events = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    const metrics = db.prepare('PRAGMA table_info(metrics)').all() as Array<{ name: string }>;
    for (const col of ['primary_model', 'cost_source', 'duration_source']) {
      expect(sessions.some((c) => c.name === col), `sessions.${col}`).toBe(true);
    }
    for (const col of ['model', 'input_len', 'output_len']) {
      expect(events.some((c) => c.name === col), `events.${col}`).toBe(true);
    }
    for (const col of ['ttft_ms', 'e2e_ms', 'repair_loop']) {
      expect(metrics.some((c) => c.name === col), `metrics.${col}`).toBe(true);
    }
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    // 原 v1 数据行保留（ADD COLUMN 非破坏性）
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES ('s1', 'claude', 'Claude', 't', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z', '/tmp/x')`,
    ).run();
    const row = db.prepare('SELECT id, cost_source, duration_source FROM sessions WHERE id = ?').get('s1') as {
      id: string;
      cost_source: string;
      duration_source: string;
    };
    expect(row).toEqual({ id: 's1', cost_source: 'unknown', duration_source: 'unknown' });
    db.close();
  });
});
