import type { Database } from 'better-sqlite3';

import { cachedStmt } from './stmt-cache.js';

/**
 * v2（add-mission-control）：新增 model / 长度冗余列 / 成本与时长来源 / ttft·e2e。
 * v3（add-mission-control 性能升级）：metrics.repair_loop —— Mission closure 的
 * repair 检测改为扫描时预计算（design.md §7.3 R1：逐请求全表扫描 40ms 超预算，
 * 升级为扫描后写 rollup，不要靠加索引硬撑）。
 * 迁移见 §migrateSchema —— 全部是 ADD COLUMN，非破坏性，新列随下一轮扫描回填。
 */
export const SCHEMA_VERSION = 3;

// contracts/database.md §3 表定义，逐字采用。
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT    PRIMARY KEY,
  provider          TEXT    NOT NULL,
  source_agent      TEXT    NOT NULL,
  title             TEXT    NOT NULL DEFAULT '',
  started_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'unknown',
  cwd               TEXT,
  message_count     INTEGER NOT NULL DEFAULT 0,
  event_count       INTEGER NOT NULL DEFAULT 0,
  token_input       INTEGER NOT NULL DEFAULT 0,
  token_output      INTEGER NOT NULL DEFAULT 0,
  token_reasoning   INTEGER NOT NULL DEFAULT 0,
  token_cache_read  INTEGER NOT NULL DEFAULT 0,
  token_cache_write INTEGER NOT NULL DEFAULT 0,
  token_total       INTEGER NOT NULL DEFAULT 0,
  cost_usd          REAL    NOT NULL DEFAULT 0,
  system_prompt     TEXT,
  source_path       TEXT    NOT NULL,
  data_source       TEXT    NOT NULL DEFAULT 'scan',
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  is_subagent       INTEGER NOT NULL DEFAULT 0,
  detail_loaded     INTEGER NOT NULL DEFAULT 0,
  primary_model     TEXT,
  cost_source       TEXT    NOT NULL DEFAULT 'unknown',
  duration_source   TEXT    NOT NULL DEFAULT 'unknown'
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
  session_id     TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
  input_len      INTEGER NOT NULL DEFAULT 0,
  output_len     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS event_raw (
  session_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  raw        TEXT,
  PRIMARY KEY (session_id, event_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS metrics (
  session_id            TEXT    PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  total_steps           INTEGER NOT NULL DEFAULT 0,
  duration_by_phase     TEXT    NOT NULL DEFAULT '{}',
  tool_call_count       INTEGER NOT NULL DEFAULT 0,
  verification_present  INTEGER NOT NULL DEFAULT 0,
  avg_tool_duration_ms  REAL    NOT NULL DEFAULT 0,
  verification_coverage REAL    NOT NULL DEFAULT 0,
  error_rate            REAL    NOT NULL DEFAULT 0,
  entered_debug         INTEGER NOT NULL DEFAULT 0,
  tokens_per_step       REAL    NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0,
  calc_version          INTEGER NOT NULL DEFAULT 0,
  ttft_ms               REAL,
  e2e_ms                REAL,
  repair_loop           INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS scan_state (
  source_path   TEXT    PRIMARY KEY,
  provider      TEXT    NOT NULL,
  session_id    TEXT,
  file_size     INTEGER NOT NULL,
  file_mtime_ms INTEGER NOT NULL,
  content_hash  TEXT    NOT NULL,
  byte_offset   INTEGER NOT NULL DEFAULT 0,
  last_scan_at  TEXT    NOT NULL,
  event_count   INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS proxy_requests (
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
);

CREATE TABLE IF NOT EXISTS frida_captures (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  pid                INTEGER NOT NULL,
  captured_at        TEXT    NOT NULL,
  capture_type       TEXT    NOT NULL,
  json_data          TEXT    NOT NULL,
  model              TEXT,
  session_id         TEXT,
  capture_session_id TEXT,
  message_count      INTEGER,
  tokens_json        TEXT
);
`;

// contracts/database.md §4 索引（全集），逐字采用。
// 注意：不建单列 idx_events_session_id / idx_sessions_data_source，复合索引已覆盖。
export const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_events_session_seq    ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_session_phase  ON events(session_id, phase);
CREATE INDEX IF NOT EXISTS idx_events_kind           ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_phase          ON events(phase);
-- v2：Mission A1/B4/B15 按 tool 聚合；idx_events_kind 不是 (tool) 的前缀，不重复
CREATE INDEX IF NOT EXISTS idx_events_tool           ON events(tool);
-- v2：Mission 按 (session, kind) 过滤（A1/A7/B1 等）；不是 idx_events_session_seq 的前缀
CREATE INDEX IF NOT EXISTS idx_events_session_kind   ON events(session_id, kind);

CREATE INDEX IF NOT EXISTS idx_sessions_ds_started   ON sessions(data_source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at   ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_provider     ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_source_agent ON sessions(source_agent);
-- v2：Mission 按 provider 过滤 + started_at 排序的复合索引
CREATE INDEX IF NOT EXISTS idx_sessions_started_prov ON sessions(started_at DESC, provider);

CREATE INDEX IF NOT EXISTS idx_scan_state_provider   ON scan_state(provider);
CREATE INDEX IF NOT EXISTS idx_scan_state_session    ON scan_state(session_id);

CREATE INDEX IF NOT EXISTS idx_proxy_started_len     ON proxy_requests(system_prompt_len DESC, started_at); -- TODO(D-002): §4 原为 (started_at, system_prompt_len DESC)，与 §5.3 期望计划矛盾，按期望计划调整列序
CREATE INDEX IF NOT EXISTS idx_proxy_hostname        ON proxy_requests(hostname);
CREATE INDEX IF NOT EXISTS idx_proxy_parsed_session  ON proxy_requests(parsed_session_id);

CREATE INDEX IF NOT EXISTS idx_frida_captured_at     ON frida_captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_frida_session         ON frida_captures(session_id);
CREATE INDEX IF NOT EXISTS idx_frida_capture_session ON frida_captures(capture_session_id);
`;

const SET_SCHEMA_VERSION_SQL =
  "INSERT INTO _meta(key, value) VALUES('schema_version', ?) " +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value';

/**
 * v1 → v2 迁移（add-mission-control）。
 *
 * 全部是 `ALTER TABLE ADD COLUMN`：非破坏性，不重写既有行，新列取默认值后
 * **随下一轮扫描自然回填**，无需全量重建库。
 *
 * 已经是 v2 的新库由 SCHEMA_SQL 直接建出这些列，此处 ADD COLUMN 会报
 * "duplicate column name" —— 逐条捕获跳过即可（幂等）。
 *
 * 迁移失败的处置（决策：DB 是本地会话文件的派生缓存，可重建）：
 * 不静默吞掉，抛给调用方，由启动自检打印"请删除 <db> 后重新扫描"。
 * 半迁移状态比重扫一次危险得多。
 */
const V2_ADD_COLUMNS = [
  "ALTER TABLE sessions ADD COLUMN primary_model TEXT",
  "ALTER TABLE sessions ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown'",
  "ALTER TABLE sessions ADD COLUMN duration_source TEXT NOT NULL DEFAULT 'unknown'",
  'ALTER TABLE events ADD COLUMN model TEXT',
  'ALTER TABLE events ADD COLUMN input_len INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE events ADD COLUMN output_len INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE metrics ADD COLUMN ttft_ms REAL',
  'ALTER TABLE metrics ADD COLUMN e2e_ms REAL',
];

const V3_ADD_COLUMNS = [
  'ALTER TABLE metrics ADD COLUMN repair_loop INTEGER NOT NULL DEFAULT 0',
];

function isDuplicateColumn(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}

export function migrateSchema(db: Database, fromVersion: number): void {
  const steps: Array<{ from: number; sql: string[] }> = [
    { from: 1, sql: V2_ADD_COLUMNS },
    { from: 2, sql: V3_ADD_COLUMNS },
  ];
  for (const step of steps) {
    if (fromVersion >= step.from + 1) {
      continue;
    }
    for (const sql of step.sql) {
      try {
        db.exec(sql);
      } catch (error) {
        if (!isDuplicateColumn(error)) {
          throw new Error(
            `schema v${fromVersion}→v${SCHEMA_VERSION} migration failed on "${sql}": ` +
              `${error instanceof Error ? error.message : String(error)}. ` +
              'The database is a rebuildable cache — delete it and rescan.',
            { cause: error },
          );
        }
      }
    }
  }
  cachedStmt(db, SET_SCHEMA_VERSION_SQL).run(String(SCHEMA_VERSION));
}

export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL); // §3 全部 CREATE TABLE IF NOT EXISTS
  // 既有 v1 库：表已存在，CREATE TABLE IF NOT EXISTS 不会补列，必须走迁移
  const existing = db
    .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
    .get() as { value?: string } | undefined;
  const current = Number(existing?.value ?? SCHEMA_VERSION);
  if (Number.isFinite(current) && current < SCHEMA_VERSION) {
    migrateSchema(db, current);
  }
  db.exec(INDEX_SQL); // §4 全部 CREATE INDEX IF NOT EXISTS
  cachedStmt(db, SET_SCHEMA_VERSION_SQL).run(String(SCHEMA_VERSION));
  db.exec('ANALYZE');
}
