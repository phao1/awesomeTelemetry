// 镜像 server/storage/schema.ts 的 SCHEMA_SQL / INDEX_SQL（Node 原生 TS 无法解析 .js 相对导入）。
// 若 schema.ts 变更，这里必须同步；M12 的 perf 校验脚本可对比两份 DDL。

// v6（add-request-context-diff）：与 server/storage/schema.ts 对齐。
export const SCHEMA_VERSION = 6;

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
  capture_group_id  TEXT,
  request_format    TEXT NOT NULL DEFAULT 'unknown',
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

CREATE TABLE IF NOT EXISTS session_prompt_context (
  session_id         TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  source             TEXT NOT NULL,
  completeness       TEXT NOT NULL,
  captured_at        TEXT NOT NULL,
  sections_json      TEXT NOT NULL DEFAULT '[]',
  model_config_json  TEXT NOT NULL DEFAULT '{}',
  analysis_json      TEXT NOT NULL DEFAULT '{}',
  full_system_prompt TEXT
) WITHOUT ROWID;
`;

export const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_events_session_seq    ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_session_phase  ON events(session_id, phase);
CREATE INDEX IF NOT EXISTS idx_events_kind           ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_phase          ON events(phase);
CREATE INDEX IF NOT EXISTS idx_events_tool           ON events(tool);
CREATE INDEX IF NOT EXISTS idx_events_session_kind   ON events(session_id, kind);

CREATE INDEX IF NOT EXISTS idx_sessions_ds_started   ON sessions(data_source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at   ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_provider     ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_source_agent ON sessions(source_agent);
CREATE INDEX IF NOT EXISTS idx_sessions_started_prov ON sessions(started_at DESC, provider);

CREATE INDEX IF NOT EXISTS idx_scan_state_provider   ON scan_state(provider);
CREATE INDEX IF NOT EXISTS idx_scan_state_session    ON scan_state(session_id);

CREATE INDEX IF NOT EXISTS idx_proxy_started_len     ON proxy_requests(system_prompt_len DESC, started_at);
CREATE INDEX IF NOT EXISTS idx_proxy_hostname        ON proxy_requests(hostname);
CREATE INDEX IF NOT EXISTS idx_proxy_parsed_session  ON proxy_requests(parsed_session_id);

CREATE INDEX IF NOT EXISTS idx_frida_captured_at     ON frida_captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_frida_session         ON frida_captures(session_id);
CREATE INDEX IF NOT EXISTS idx_frida_capture_session ON frida_captures(capture_session_id);
`;

export function initSchema(db) {
  db.exec(SCHEMA_SQL);
  db.exec(INDEX_SQL);
  db.prepare(
    "INSERT INTO _meta(key, value) VALUES('schema_version', ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(String(SCHEMA_VERSION));
  db.exec('ANALYZE');
}
