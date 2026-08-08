import type { Database } from 'better-sqlite3';

import { cachedStmt } from './stmt-cache.js';

/**
 * v2（add-mission-control）：新增 model / 长度冗余列 / 成本与时长来源 / ttft·e2e。
 * v3（add-mission-control 性能升级）：metrics.repair_loop —— Mission closure 的
 * repair 检测改为扫描时预计算（design.md §7.3 R1：逐请求全表扫描 40ms 超预算，
 * 升级为扫描后写 rollup，不要靠加索引硬撑）。
 * v4（calibrate-tokens-and-compare-report §4）：metrics 新增
 * total_tool_duration_ms / llm_call_count / user_interaction_rounds /
 * has_unit_tests / failed_command_count（TraceMetrics 五新字段）。
 * v4+（fix-session-detail-display §1）：events 增 content_hash —— 差分写入的
 * 内容判等列。保持 SCHEMA_VERSION=4（版本号已被 calibrate-tokens 占用），
 * 以幂等 ADD COLUMN 补列（见 initSchema 的 ensureEventsContentHash），
 * 新库由 SCHEMA_SQL 直接建出。
 * v5（show-trae-prompt-context）：新增一对一 session_prompt_context 表。
 * 迁移见 §migrateSchema —— 全部是 ADD COLUMN，非破坏性，新列随下一轮扫描回填。
 * v6（add-request-context-diff，design D2/D3/D4）：proxy_requests 增
 * capture_group_id（一次成功代理运行的关联证据，可空）与
 * request_format（封闭 phase-1 格式分类，NOT NULL DEFAULT 'unknown'），
 * 并新增两条复合 predecessor 索引（exact-session / capture-group 最近前驱查询）。
 * 历史行保持 capture_group_id = NULL、request_format = 'unknown'，不做启动回填。
 * v7（fix-adapter-turn-semantics A10）：events 增 turn_key（决策周期标识，
 * nullable；null 是一等值），并执行**破坏性重分类重扫**迁移：
 * 清空四个派生表（events / event_raw / metrics / scan_state）并重置全部会话的
 * detail_loaded，强制下一轮打开时按新分类与 turnKey 重扫。sessions /
 * proxy_requests / frida_captures / session_prompt_context 保留不动。
 */
export const SCHEMA_VERSION = 7;

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
  content_hash   TEXT    NOT NULL DEFAULT '',
  input_len      INTEGER NOT NULL DEFAULT 0,
  output_len     INTEGER NOT NULL DEFAULT 0,
  turn_key       TEXT,
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
  repair_loop           INTEGER NOT NULL DEFAULT 0,
  total_tool_duration_ms INTEGER NOT NULL DEFAULT 0,
  llm_call_count         INTEGER NOT NULL DEFAULT 0,
  user_interaction_rounds INTEGER NOT NULL DEFAULT 0,
  has_unit_tests         INTEGER NOT NULL DEFAULT 0,
  failed_command_count   INTEGER NOT NULL DEFAULT 0
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
  request_format    TEXT    NOT NULL DEFAULT 'unknown',
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
-- v6（add-request-context-diff，design D4）：最近更早前驱查询的两条复合索引
CREATE INDEX IF NOT EXISTS idx_proxy_session_format_id
  ON proxy_requests(parsed_session_id, request_format, id DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_group_format_model_id
  ON proxy_requests(capture_group_id, request_format, model, id DESC);

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
  // TODO(D-012): repair 检测按 design §7.3 R1 升级为扫描时预计算（metrics.repair_loop），
  // schema v2→v3 —— 逐请求全表窗口扫描 40ms 超预算，待人工确认升级符合预期。
  'ALTER TABLE metrics ADD COLUMN repair_loop INTEGER NOT NULL DEFAULT 0',
];

const V4_ADD_COLUMNS = [
  // calibrate-tokens-and-compare-report §4：TraceMetrics 五新字段
  'ALTER TABLE metrics ADD COLUMN total_tool_duration_ms INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE metrics ADD COLUMN llm_call_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE metrics ADD COLUMN user_interaction_rounds INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE metrics ADD COLUMN has_unit_tests INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE metrics ADD COLUMN failed_command_count INTEGER NOT NULL DEFAULT 0',
];

/**
 * v5 → v6 迁移（add-request-context-diff，contracts/database.md §2 逐字采用）：
 * proxy_requests 仅两个幂等 ADD COLUMN，外加 design D4 的两条复合前驱索引。
 * 历史行不解析 body、不回填格式 —— capture_group_id 保持 NULL、
 * request_format 保持 'unknown'；新索引由 INDEX_SQL 对旧库幂等补建，
 * 此处重复 CREATE INDEX IF NOT EXISTS 仅为满足“迁移本身建索引”的契约表述，
 * 幂等且无副作用。
 */
const V6_ADD_COLUMNS = [
  'ALTER TABLE proxy_requests ADD COLUMN capture_group_id TEXT',
  "ALTER TABLE proxy_requests ADD COLUMN request_format TEXT NOT NULL DEFAULT 'unknown'",
  'CREATE INDEX IF NOT EXISTS idx_proxy_session_format_id ' +
    'ON proxy_requests(parsed_session_id, request_format, id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_proxy_group_format_model_id ' +
    'ON proxy_requests(capture_group_id, request_format, model, id DESC)',
];

function isDuplicateColumn(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}

/**
 * v6 → v7 迁移（fix-adapter-turn-semantics A10，contracts/database.md §2 逐字采用）。
 *
 * 破坏性重分类重扫，严格按序：
 *   1. ALTER TABLE events ADD COLUMN turn_key TEXT —— 幂等；重复列失败容忍，
 *      其它失败抛错（带重建指引）。
 *   2. 显式枚举清空四个派生表，**绝不用「除…以外全清」的排除式写法**：
 *      后续 change 新增的表（如 add-trajectory-inspector 的
 *      session_annotations）默认保留，不会被这条更早的迁移误删。
 *   3. sessions / proxy_requests / frida_captures / session_prompt_context
 *      保留，不做任何操作。
 *   4. 全部会话 detail_loaded = 0 → 下次打开触发重扫。
 *   5. 完成记录由 migrateSchema 结尾的 schema_version upsert 承担（写入 7），
 *      第二次初始化时 current === SCHEMA_VERSION，不再进入本函数（no-op）。
 *
 * 失败一律抛带「删除 DB 后重扫」指引的错误：半迁移状态比重扫更危险，
 * 禁止静默 catch（任务 5.2 / 禁令 8 / G11.5 教训）。
 */
function migrateV6ToV7(db: Database): void {
  const rebuildHint =
    'The database is a rebuildable cache of local session files - delete it and rescan.';
  try {
    db.exec('ALTER TABLE events ADD COLUMN turn_key TEXT');
  } catch (error) {
    if (!isDuplicateColumn(error)) {
      throw new Error(
        'schema v6→v7 migration failed on "ALTER TABLE events ADD COLUMN turn_key TEXT": ' +
          `${error instanceof Error ? error.message : String(error)}. ${rebuildHint}`,
        { cause: error },
      );
    }
  }
  // 5.3：被清空的四个派生表**逐一具名**（不是「除以下保留表外全清」的排除式写法）。
  for (const sql of [
    'DELETE FROM events',
    'DELETE FROM event_raw',
    'DELETE FROM metrics',
    'DELETE FROM scan_state',
  ]) {
    try {
      db.exec(sql);
    } catch (error) {
      throw new Error(
        `schema v6→v7 migration failed on "${sql}": ` +
          `${error instanceof Error ? error.message : String(error)}. ${rebuildHint}`,
        { cause: error },
      );
    }
  }
  try {
    db.exec('UPDATE sessions SET detail_loaded = 0');
  } catch (error) {
    throw new Error(
      'schema v6→v7 migration failed on "UPDATE sessions SET detail_loaded = 0": ' +
        `${error instanceof Error ? error.message : String(error)}. ${rebuildHint}`,
      { cause: error },
    );
  }
}

/** v4+（fix-session-detail-display §1.1）：events.content_hash 幂等补列。 */
function ensureEventsContentHash(db: Database): void {
  try {
    db.exec("ALTER TABLE events ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!isDuplicateColumn(error)) {
      throw new Error(
        `schema ensure events.content_hash failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

export function migrateSchema(db: Database, fromVersion: number): void {
  const steps: Array<{ from: number; sql: string[] }> = [
    { from: 1, sql: V2_ADD_COLUMNS },
    { from: 2, sql: V3_ADD_COLUMNS },
    { from: 3, sql: V4_ADD_COLUMNS },
    // v4 → v5 的新表已由上方 SCHEMA_SQL 幂等创建，无 ALTER 语句。
    { from: 4, sql: [] },
    { from: 5, sql: V6_ADD_COLUMNS },
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
  if (fromVersion < 7) {
    migrateV6ToV7(db);
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
  ensureEventsContentHash(db);
  db.exec(INDEX_SQL); // §4 全部 CREATE INDEX IF NOT EXISTS
  cachedStmt(db, SET_SCHEMA_VERSION_SQL).run(String(SCHEMA_VERSION));
  db.exec('ANALYZE');
}
