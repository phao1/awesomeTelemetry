import type { Database } from 'better-sqlite3';

import type {
  SessionIndexEntry,
  TraceEvent,
  TraceMetrics,
  TraceSession,
} from '../../src/core/trace-types.js';
import { cachedStmt } from './stmt-cache.js';

function upsertSql(
  table: string,
  conflictCols: string[],
  cols: string[],
  /** #9：这些列在索引阶段可能因源不可读而报 0（如 Trae SQLCipher），
   * 已存非零值时不得用 0 覆盖。仅当 excluded 值 > 0 才更新。 */
  preserveOnZero: string[] = [],
): string {
  const placeholders = cols.map(() => '?').join(', ');
  const conflict = conflictCols.join(', ');
  const excluded = conflictCols.map((col) => `${col} = excluded.${col}`).join(', ');
  const updateSet = cols
    .filter((col) => !conflictCols.includes(col))
    .map((col) =>
      preserveOnZero.includes(col)
        ? `${col} = CASE WHEN excluded.${col} > 0 THEN excluded.${col} ELSE ${table}.${col} END`
        : `${col} = excluded.${col}`,
    )
    .join(', ');
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(${conflict}) DO UPDATE SET ${excluded}, ${updateSet}`;
}

const SESSION_INDEX_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'message_count', 'event_count', 'token_total', 'cost_usd',
  'data_source', 'source_path', 'detail_loaded',
];

const SESSION_TRACE_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'message_count', 'event_count',
  'token_input', 'token_output', 'token_reasoning', 'token_cache_read',
  'token_cache_write', 'token_total', 'cost_usd', 'system_prompt',
  'source_path', 'data_source', 'total_duration_ms', 'is_subagent',
  'primary_model', 'cost_source', 'duration_source',
];

const EVENT_COLS = [
  'session_id', 'id', 'sequence', 'kind', 'phase', 'title', 'started_at',
  'duration_ms', 'status', 'actor', 'tool', 'input_summary', 'output_summary',
  'tokens_json', 'error', 'model', 'input_len', 'output_len',
];

const METRICS_COLS = [
  'session_id', 'total_steps', 'duration_by_phase', 'tool_call_count',
  'verification_present', 'avg_tool_duration_ms', 'verification_coverage',
  'error_rate', 'entered_debug', 'tokens_per_step', 'cost_usd', 'calc_version',
  'ttft_ms', 'e2e_ms', 'repair_loop',
];

// #9（审查 P1）：Trae 索引阶段无法解密读事件，event_count/message_count 报 0；
// 若详情扫描后再触发索引扫描，不得把已存非零计数覆盖为 0。
const INDEX_UPSERT_SQL = upsertSql('sessions', ['id'], SESSION_INDEX_COLS, [
  'event_count',
  'message_count',
]);
const TRACE_UPSERT_SQL = upsertSql('sessions', ['id'], SESSION_TRACE_COLS);
const EVENT_UPSERT_SQL = upsertSql('events', ['session_id', 'id'], EVENT_COLS);
const METRICS_UPSERT_SQL = upsertSql('metrics', ['session_id'], METRICS_COLS);

const SELECT_EXISTING_EVENT_IDS_SQL =
  'SELECT id, sequence FROM events WHERE session_id = ?';
const DELETE_EVENT_BY_ID_SQL = 'DELETE FROM events WHERE session_id = ? AND id = ?';
const DELETE_EVENT_RAW_BY_ID_SQL =
  'DELETE FROM event_raw WHERE session_id = ? AND event_id = ?';
const DELETE_EVENT_RAW_BY_SESSION_SQL =
  'DELETE FROM event_raw WHERE session_id = ?';
const DELETE_EVENTS_BY_SESSION_SQL = 'DELETE FROM events WHERE session_id = ?';
const DELETE_METRICS_BY_SESSION_SQL = 'DELETE FROM metrics WHERE session_id = ?';
const DELETE_SESSION_SQL = 'DELETE FROM sessions WHERE id = ?';
const DELETE_SCAN_STATE_BY_SESSION_SQL =
  'DELETE FROM scan_state WHERE session_id = ?';

/** REQ-010：索引条目 upsert，INSERT ... ON CONFLICT(id) DO UPDATE。 */
export function upsertSessionFromIndex(db: Database, entry: SessionIndexEntry): void {
  cachedStmt(db, INDEX_UPSERT_SQL).run(
    entry.id,
    entry.provider,
    entry.sourceAgent,
    entry.title,
    entry.startedAt,
    entry.updatedAt,
    entry.status,
    entry.cwd ?? null,
    entry.messageCount,
    entry.eventCount,
    entry.tokenTotal,
    entry.costUsd,
    entry.dataSource,
    entry.sourcePath,
    entry.detailLoaded ? 1 : 0,
  );
}

/** REQ-010：完整会话 upsert，写入 token 明细与 systemPrompt。 */
export function upsertSessionFromTrace(db: Database, session: TraceSession): void {
  const tokens = session.tokenUsage;
  cachedStmt(db, TRACE_UPSERT_SQL).run(
    session.id,
    session.provider,
    session.sourceAgent,
    session.title,
    session.startedAt,
    session.updatedAt,
    session.status,
    session.cwd ?? null,
    session.messageCount,
    session.eventCount,
    tokens.input,
    tokens.output,
    tokens.reasoning,
    tokens.cacheRead,
    tokens.cacheWrite,
    tokens.total,
    session.costUsd,
    session.systemPrompt ?? null,
    session.sourcePath,
    session.dataSource,
    session.totalDurationMs,
    session.isSubagent ? 1 : 0,
    session.primaryModel ?? null,
    session.costSource ?? 'unknown',
    session.durationSource ?? 'unknown',
  );
}

/**
 * REQ-011：差分写入。读现有 (id, sequence) → 逐条 INSERT ON CONFLICT DO UPDATE
 * → 删除新数据中不存在的 stale id（含 event_raw 对应行），全部在单个事务内。
 */
export function upsertEvents(
  db: Database,
  sessionId: string,
  events: TraceEvent[],
): void {
  const run = db.transaction(() => {
    const existing = new Map<string, number>();
    const rows = cachedStmt(db, SELECT_EXISTING_EVENT_IDS_SQL).all(sessionId) as Array<{
      id: string;
      sequence: number;
    }>;
    for (const row of rows) {
      existing.set(row.id, row.sequence);
    }

    const newIds = new Set<string>();
    for (const event of events) {
      newIds.add(event.id);
      const existingSequence = existing.get(event.id);
      if (existingSequence !== undefined && existingSequence === event.sequence) {
        continue; // (id, sequence) 未变，跳过；无变更重扫时为 0 条写入
      }
      cachedStmt(db, EVENT_UPSERT_SQL).run(
        sessionId,
        event.id,
        event.sequence,
        event.kind,
        event.phase,
        event.title,
        event.startedAt,
        event.durationMs,
        event.status,
        event.actor,
        event.tool ?? null,
        event.inputSummary ?? null,
        event.outputSummary ?? null,
        event.tokens === null ? null : JSON.stringify(event.tokens),
        event.error ?? null,
        // §2.3：input_len/output_len 冗余列（B15 bytes 用，禁 LENGTH() 全表扫描）
        event.model ?? null,
        Buffer.byteLength(event.inputSummary ?? '', 'utf8'),
        Buffer.byteLength(event.outputSummary ?? '', 'utf8'),
      );
    }

    for (const id of existing.keys()) {
      if (!newIds.has(id)) {
        cachedStmt(db, DELETE_EVENT_BY_ID_SQL).run(sessionId, id);
        cachedStmt(db, DELETE_EVENT_RAW_BY_ID_SQL).run(sessionId, id);
      }
    }
  });
  run();
}

/** REQ-013：metrics 持久化，写入基础指标、四维指标与 calc_version。 */
export function upsertMetrics(
  db: Database,
  sessionId: string,
  metrics: TraceMetrics,
): void {
  cachedStmt(db, METRICS_UPSERT_SQL).run(
    sessionId,
    metrics.totalSteps,
    JSON.stringify(metrics.durationByPhase),
    metrics.toolCallCount,
    metrics.verificationPresent ? 1 : 0,
    metrics.avgToolDurationMs,
    metrics.verificationCoverage,
    metrics.errorRate,
    metrics.enteredDebug ? 1 : 0,
    metrics.tokensPerStep,
    metrics.costUsd,
    metrics.calcVersion,
    metrics.ttftMs ?? null,
    metrics.e2eMs ?? null,
    metrics.repairLoop === true ? 1 : 0,
  );
}

/**
 * REQ-016：级联删除 events + event_raw + metrics + sessions + 该会话的 scan_state 行。
 * event_raw 无外键，必须显式删除。
 */
export function deleteSession(db: Database, key: string): void {
  const run = db.transaction(() => {
    cachedStmt(db, DELETE_EVENT_RAW_BY_SESSION_SQL).run(key);
    cachedStmt(db, DELETE_EVENTS_BY_SESSION_SQL).run(key);
    cachedStmt(db, DELETE_METRICS_BY_SESSION_SQL).run(key);
    cachedStmt(db, DELETE_SESSION_SQL).run(key);
    cachedStmt(db, DELETE_SCAN_STATE_BY_SESSION_SQL).run(key);
  });
  run();
}
