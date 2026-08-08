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
  'session_annotations',
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
  'idx_session_annotations_updated',
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
    // fix-adapter-turn-semantics A10：v3 走完整迁移链到 v7，末尾的 v6→v7 是
    // **破坏性**重分类重扫——metrics 等四个派生表被显式清空，旧行不再保留。
    // v3→v4 的 ADD COLUMN 本身仍是非破坏性的；「旧行保留」的旧期望被 v7 的
    // 设计取代（本 change 的 5.10：期望值按新口径重算）。
    const row = db
      .prepare('SELECT session_id, total_steps, calc_version, llm_call_count FROM metrics WHERE session_id = ?')
      .get('s1');
    expect(row).toBeUndefined();
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

describe('REQ-003 v6 → v7 破坏性重分类迁移（fix-adapter-turn-semantics A10）', () => {
  /** 把 v7 新库降级成 v6 形态：events 去掉 turn_key，_meta 置 6。 */
  function downgradeToV6(db: Db): void {
    db.exec(`
      ALTER TABLE events RENAME TO events_v7;
      CREATE TABLE events (
        session_id     TEXT    NOT NULL,
        id             TEXT    NOT NULL,
        sequence       INTEGER NOT NULL,
        kind           TEXT    NOT NULL,
        phase          TEXT    NOT NULL,
        title          TEXT    NOT NULL DEFAULT '',
        started_at     TEXT    NOT NULL,
        duration_ms    INTEGER NOT NULL DEFAULT 0,
        status         TEXT    NOT NULL DEFAULT 'unknown',
        actor          TEXT    NOT NULL DEFAULT '',
        tool           TEXT,
        input_summary  TEXT,
        output_summary TEXT,
        tokens_json    TEXT,
        error          TEXT,
        model          TEXT,
        content_hash   TEXT    NOT NULL DEFAULT '',
        input_len      INTEGER NOT NULL DEFAULT 0,
        output_len     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, id)
      ) WITHOUT ROWID;
      INSERT INTO events
        (session_id, id, sequence, kind, phase, title, started_at, duration_ms,
         status, actor, tool, input_summary, output_summary, tokens_json, error,
         model, content_hash, input_len, output_len)
        SELECT session_id, id, sequence, kind, phase, title, started_at, duration_ms,
               status, actor, tool, input_summary, output_summary, tokens_json, error,
               model, content_hash, input_len, output_len
          FROM events_v7;
      DROP TABLE events_v7;
    `);
    db.prepare("UPDATE _meta SET value = '6' WHERE key = 'schema_version'").run();
  }

  function countRows(db: Db, table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  }

  it('v7 新库直建 turn_key 列，schema_version = 7', () => {
    const db = createDb(join(tempDir(), 'fresh-v7.sqlite'));
    initSchema(db);

    const cols = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'turn_key')).toBe(true);
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as {
      value: string;
    };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('v6 升级：只清空四个派生表、保留四个表、重置 detail_loaded、重复 init 为 no-op', () => {
    const db = createDb(join(tempDir(), 'migrate-v6-to-v7.sqlite'));
    initSchema(db);
    downgradeToV6(db);

    // 四个派生表与四个保留表各写 1 行；会话 detail_loaded = 1
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path, detail_loaded)
       VALUES ('s1', 'codex', 'Codex', 't', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z', '/tmp/x.jsonl', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, status, actor, tool, content_hash)
       VALUES ('s1', 'e1', 1, 'llm', 'implement', 't', '2026-08-01T00:00:00.000Z', 'success', 'assistant', NULL, '')`,
    ).run();
    db.prepare(
      `INSERT INTO event_raw (session_id, event_id, raw) VALUES ('s1', 'e1', 'raw')`,
    ).run();
    db.prepare(
      `INSERT INTO metrics (session_id, total_steps, calc_version) VALUES ('s1', 3, 4)`,
    ).run();
    db.prepare(
      `INSERT INTO scan_state (source_path, provider, session_id, file_size, file_mtime_ms, content_hash, byte_offset, last_scan_at, event_count)
       VALUES ('/tmp/x.jsonl', 'codex', 's1', 100, 1000, 'h', 0, '2026-08-01T00:00:00.000Z', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at)
       VALUES ('r1', 'POST', 'https://h', 'h', '2026-08-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO frida_captures (pid, captured_at, capture_type, json_data)
       VALUES (1, '2026-08-01T00:00:00.000Z', 'x', '{}')`,
    ).run();
    db.prepare(
      `INSERT INTO session_prompt_context (session_id, provider, source, completeness, captured_at)
       VALUES ('s1', 'trae', 'trae_db', 'dynamic_only', '2026-08-01T00:00:00.000Z')`,
    ).run();

    initSchema(db); // 触发 v6→v7 迁移

    // 5.3：被清空的表逐一具名——四个派生表必须为空
    for (const table of ['events', 'event_raw', 'metrics', 'scan_state']) {
      expect(countRows(db, table), `${table} 应被迁移清空`).toBe(0);
    }
    // 保留表原样保留
    for (const table of ['sessions', 'proxy_requests', 'frida_captures', 'session_prompt_context']) {
      expect(countRows(db, table), `${table} 应保留`).toBe(1);
    }
    // 每个会话 detail_loaded 重置为 0 → 下次打开触发重扫
    const detail = db
      .prepare('SELECT detail_loaded FROM sessions WHERE id = ?')
      .get('s1') as { detail_loaded: number };
    expect(detail.detail_loaded).toBe(0);
    // 版本与列到位
    const meta = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as {
      value: string;
    };
    expect(meta.value).toBe(String(SCHEMA_VERSION));
    const cols = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'turn_key')).toBe(true);

    // 重复 init：no-op，不再清第二次（detail_loaded 不被重置、保留表不被再清）
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at)
       VALUES ('r2', 'POST', 'https://h', 'h', '2026-08-01T00:00:00.000Z')`,
    ).run();
    db.prepare("UPDATE sessions SET detail_loaded = 1 WHERE id = 's1'").run();
    expect(() => initSchema(db)).not.toThrow();
    const preserved = db
      .prepare('SELECT detail_loaded FROM sessions WHERE id = ?')
      .get('s1') as { detail_loaded: number };
    expect(preserved.detail_loaded).toBe(1);
    expect(countRows(db, 'proxy_requests')).toBe(2);
    db.close();
  });

  it('v6 迁移失败：抛带重建指引的错误，不静默吞掉', () => {
    const db = createDb(join(tempDir(), 'migrate-fail.sqlite'));
    initSchema(db);
    downgradeToV6(db);
    db.prepare(
      `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, status, actor, tool, content_hash)
       VALUES ('s1', 'e1', 1, 'llm', 'implement', 't', '2026-08-01T00:00:00.000Z', 'success', 'assistant', NULL, '')`,
    ).run();
    // 用触发器让 DELETE FROM events 失败，模拟迁移中断
    db.exec(
      "CREATE TRIGGER forbid_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'blocked-by-test'); END;",
    );

    let message = '';
    try {
      initSchema(db);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('blocked-by-test'); // 原错误未被静默吞掉
    expect(message).toContain('delete it and rescan'); // 重建指引
    db.close();
  });
});

describe('REQ-003 schema v8 —— session_annotations（add-trajectory-inspector D15）', () => {
  function countRows(db: Db, table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  }

  function metaVersion(db: Db): string {
    return (db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string }).value;
  }

  /** 把 v8 新库降级成 v7 形态：去掉 session_annotations 表（依赖索引一并消失），_meta 置 7。 */
  function downgradeToV7(db: Db): void {
    db.exec('DROP TABLE IF EXISTS session_annotations');
    db.prepare("UPDATE _meta SET value = '7' WHERE key = 'schema_version'").run();
  }

  /** 把 v8 新库降级成 v6 形态：去掉 turn_key 与注解表，_meta 置 6。 */
  function downgradeToV6(db: Db): void {
    db.exec(`
      ALTER TABLE events RENAME TO events_v7;
      CREATE TABLE events (
        session_id     TEXT    NOT NULL,
        id             TEXT    NOT NULL,
        sequence       INTEGER NOT NULL,
        kind           TEXT    NOT NULL,
        phase          TEXT    NOT NULL,
        title          TEXT    NOT NULL DEFAULT '',
        started_at     TEXT    NOT NULL,
        duration_ms    INTEGER NOT NULL DEFAULT 0,
        status         TEXT    NOT NULL DEFAULT 'unknown',
        actor          TEXT    NOT NULL DEFAULT '',
        tool           TEXT,
        input_summary  TEXT,
        output_summary TEXT,
        tokens_json    TEXT,
        error          TEXT,
        model          TEXT,
        content_hash   TEXT    NOT NULL DEFAULT '',
        input_len      INTEGER NOT NULL DEFAULT 0,
        output_len     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, id)
      ) WITHOUT ROWID;
      INSERT INTO events
        (session_id, id, sequence, kind, phase, title, started_at, duration_ms,
         status, actor, tool, input_summary, output_summary, tokens_json, error,
         model, content_hash, input_len, output_len)
        SELECT session_id, id, sequence, kind, phase, title, started_at, duration_ms,
               status, actor, tool, input_summary, output_summary, tokens_json, error,
               model, content_hash, input_len, output_len
          FROM events_v7;
      DROP TABLE events_v7;
    `);
    db.exec('DROP TABLE IF EXISTS session_annotations');
    db.prepare("UPDATE _meta SET value = '6' WHERE key = 'schema_version'").run();
  }

  it('v8 新库直建 session_annotations 表与索引，schema_version = 8', () => {
    const db = createDb(join(tempDir(), 'fresh-v8.sqlite'));
    initSchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_annotations'")
      .get();
    expect(table).toBeTruthy();
    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_annotations_updated'")
      .get();
    expect(index).toBeTruthy();
    // 表结构逐字采用 D15
    const cols = db.prepare('PRAGMA table_info(session_annotations)').all() as Array<{
      name: string;
      notnull: number;
      pk: number;
      dflt_value: string | null;
    }>;
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('session_id')?.pk).toBe(1);
    expect(byName.get('tags_json')?.notnull).toBe(1);
    expect(byName.get('tags_json')?.dflt_value).toBe("'[]'");
    expect(byName.get('updated_at')?.notnull).toBe(1);
    expect(metaVersion(db)).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('v7 升级：只增表与索引、旧行保留、重复 init 为 no-op', () => {
    const db = createDb(join(tempDir(), 'migrate-v7-to-v8.sqlite'));
    initSchema(db);
    downgradeToV7(db);
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, source_path)
       VALUES ('s1', 'codex', 'Codex', 'old', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z', 'success', '/tmp/x.jsonl')`,
    ).run();
    db.prepare(
      `INSERT INTO proxy_requests (request_id, method, url, hostname, started_at)
       VALUES ('r1', 'POST', 'https://h', 'h', '2026-08-01T00:00:00.000Z')`,
    ).run();

    initSchema(db); // 触发 v7→v8 迁移

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_annotations'")
      .get();
    expect(table).toBeTruthy();
    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_annotations_updated'")
      .get();
    expect(index).toBeTruthy();
    expect(metaVersion(db)).toBe(String(SCHEMA_VERSION));
    // 旧行保留（只增不改）
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get('s1');
    expect(session).toBeTruthy();
    expect(countRows(db, 'proxy_requests')).toBe(1);
    // 幂等：重复 init 不报错、版本不变、注解表仍在
    expect(() => initSchema(db)).not.toThrow();
    expect(metaVersion(db)).toBe(String(SCHEMA_VERSION));
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_annotations'")
        .get(),
    ).toBeTruthy();
    db.close();
  });

  it('任务 2.4：Change A 的 v6→v7 破坏性迁移在已含注解行的库上运行，注解行保留', () => {
    const db = createDb(join(tempDir(), 'preserve-annotations.sqlite'));
    initSchema(db);
    downgradeToV6(db);
    // 模拟“已加了注解表”的库：Change A 的删除清单按名枚举
    // （events / event_raw / metrics / scan_state），清单外的表默认保留。
    db.exec(`
      CREATE TABLE session_annotations (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        tags_json  TEXT NOT NULL DEFAULT '[]',
        note       TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_annotations_updated
        ON session_annotations(updated_at);
    `);
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, source_path, detail_loaded)
       VALUES ('s1', 'codex', 'Codex', 't', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z', 'success', '/tmp/x.jsonl', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, status, actor, tool, content_hash)
       VALUES ('s1', 'e1', 1, 'llm', 'implement', 't', '2026-08-01T00:00:00.000Z', 'success', 'assistant', NULL, '')`,
    ).run();
    db.prepare(
      `INSERT INTO session_annotations (session_id, tags_json, note, updated_at)
       VALUES ('s1', ?, 'note-1', '2026-08-08T00:00:00.000Z')`,
    ).run(JSON.stringify(['perf', 'refactor']));

    initSchema(db); // 触发 v6→v7 破坏性迁移 + v7→v8 幂等迁移

    // 注解行原样保留 —— Change A 的删除清单没有误伤本表
    const rows = db
      .prepare('SELECT session_id, tags_json, note, updated_at FROM session_annotations')
      .all() as Array<{ session_id: string; tags_json: string; note: string; updated_at: string }>;
    expect(rows).toEqual([
      {
        session_id: 's1',
        tags_json: JSON.stringify(['perf', 'refactor']),
        note: 'note-1',
        updated_at: '2026-08-08T00:00:00.000Z',
      },
    ]);
    // 迁移语义未被削弱：四个派生表仍被清空
    for (const table of ['events', 'event_raw', 'metrics', 'scan_state']) {
      expect(countRows(db, table), `${table} 应被迁移清空`).toBe(0);
    }
    expect(metaVersion(db)).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('v7→v8 迁移失败：抛带重建指引的错误，不静默吞掉', () => {
    const db = createDb(join(tempDir(), 'migrate-v8-fail.sqlite'));
    initSchema(db);
    downgradeToV7(db);
    // 用同名 VIEW 占住 session_annotations：CREATE TABLE IF NOT EXISTS 变 no-op，
    // 迁移循环里的 CREATE INDEX 必然失败（views may not be indexed），
    // 模拟迁移中断且验证失败不被静默吞掉。
    db.exec(
      'CREATE VIEW session_annotations AS SELECT 1 AS x',
    );

    let message = '';
    try {
      initSchema(db);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('v7→v8 migration failed');
    expect(message).toContain('views may not be indexed'); // 原错误未被静默吞掉
    expect(message).toContain('delete it and rescan'); // 重建指引
    db.close();
  });
});
