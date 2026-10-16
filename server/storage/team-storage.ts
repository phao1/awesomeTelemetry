import type { Database } from 'better-sqlite3';

import type {
  CompletenessLevel,
  CostSource,
  EvidenceConfidence,
  PriceCurrency,
  ProviderKey,
  TeamActivityKind,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamAgentEdgeKind,
  TeamAgentState,
  TeamArtifact,
  TeamAssignment,
  TeamCommunication,
  TeamCompleteness,
  TeamMessageCategory,
  TeamMessageMode,
  TeamMetricValue,
  TeamMetrics,
  TeamOrderConfidence,
  TeamRoundSegmentationSource,
  TeamRunSnapshot,
  TeamRunStatus,
  TeamRunSummary,
  TeamTask,
  TeamTaskDependency,
  TeamTaskStatus,
  TeamTopologyKind,
  TokenUsage,
  TraceStatus,
} from '../../src/core/trace-types.js';
import {
  TEAM_ACTIVITY_SLIM_COLS,
  TEAM_AGENT_COLS,
  TEAM_ARTIFACT_COLS,
  TEAM_ASSIGNMENT_COLS,
  TEAM_DEP_COLS,
  TEAM_EDGE_COLS,
  TEAM_EVIDENCE_COLS,
  TEAM_MESSAGE_COLS,
  TEAM_METRICS_COLS,
  TEAM_ROUND_COLS,
  TEAM_RUN_LIST_COLS,
  TEAM_TASK_COLS,
} from './columns.js';
import { cachedStmt } from './stmt-cache.js';
import type { NormalizedTeamEvidence } from '../../src/adapters/team-codearts.js';
import type { TeamSink } from '../../local-sessions/team-scanner.js';

// ── 写入口类型（snake_case 行 = DB 列） ────────────────────────────────
// adapter（tasks §4）产出规范化证据后映射为这些行交给差分 upsert。
// 读取方向返回 camelCase 的 trace-types 类型（API 形状）。

export interface TeamRunRow {
  id: string;
  provider: string;
  native_run_id: string;
  run_identity_confidence: EvidenceConfidence;
  title: string;
  goal_fingerprint: string | null;
  status: TeamRunStatus;
  started_at: string | null;
  ended_at: string | null;
  topology_kind: TeamTopologyKind;
  agent_count: number;
  task_count: number;
  communication_count: number;
  activity_count: number;
  round_count: number;
  artifact_count: number;
  token_available: number;
  cost_available: number;
  cost_currency: PriceCurrency | null;
  completeness: TeamCompleteness;
  updated_at: string;
  stamp: string;
}

export interface TeamAgentRow {
  id: string;
  run_id: string;
  native_id: string;
  display_name: string;
  role: string;
  role_class: string;
  model: string | null;
  state: string;
  created_at: string | null;
  ended_at: string | null;
  session_keys: string[];
  evidence_ids: string[];
}

export interface TeamAgentEdgeRow {
  id: string;
  run_id: string;
  from_agent_id: string;
  to_agent_id: string;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: EvidenceConfidence;
  evidence_ids: string[];
}

export interface TeamTaskRow {
  id: string;
  run_id: string;
  native_id: string;
  title: string;
  description_available: number;
  priority: number | null;
  status: TeamTaskStatus;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  failed_at: string | null;
  result_available: number;
  evidence_ids: string[];
}

export interface TeamTaskDependencyRow {
  id: string;
  run_id: string;
  upstream_task_id: string;
  downstream_task_id: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: EvidenceConfidence;
  evidence_ids: string[];
}

export interface TeamAssignmentRow {
  id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  assigned_at: string | null;
  unassigned_at: string | null;
  assignment_kind: string;
  evidence_ids: string[];
}

export interface TeamMessageRow {
  id: string;
  run_id: string;
  sender_agent_id: string;
  recipient_ids: string[];
  mode: TeamMessageMode;
  category: TeamMessageCategory;
  task_id: string | null;
  correlation_id: string | null;
  reply_to_id: string | null;
  sent_at: string | null;
  received_at: string | null;
  body_available: number;
  body_chars: number | null;
  body_bytes: number | null;
  content_hash: string | null;
  evidence_ids: string[];
}

export interface TeamActivityRow {
  id: string;
  run_id: string;
  agent_id: string | null;
  task_id: string | null;
  round_id: string | null;
  kind: TeamActivityKind;
  status: TraceStatus;
  started_at: string | null;
  ended_at: string | null;
  native_sequence: number | null;
  session_key: string | null;
  event_id: string | null;
  turn_key: string | null;
  message_id: string | null;
  artifact_id: string | null;
  tokens: TokenUsage | null;
  cost_usd: number | null;
  cost_source: CostSource | null;
  cost_currency: PriceCurrency | null;
  has_input: number;
  has_output: number;
  has_raw: number;
  evidence_ids: string[];
  order_confidence: TeamOrderConfidence;
}

export interface TeamRoundRow {
  id: string;
  run_id: string;
  agent_id: string;
  native_id: string | null;
  idx: number;
  segmentation_source: TeamRoundSegmentationSource;
  started_at: string | null;
  ended_at: string | null;
  status: TraceStatus;
  task_ids: string[];
  output_artifact_ids: string[];
  wall_clock_ms: number | null;
  active_ms: number | null;
  tokens: TokenUsage | null;
  cost_usd: number | null;
  tool_call_count: number;
  message_count: number;
  completeness: CompletenessLevel;
}

export interface TeamArtifactRow {
  id: string;
  run_id: string;
  native_id: string | null;
  name: string;
  kind: string;
  path_redacted: string | null;
  content_hash: string | null;
  producer_agent_ids: string[];
  task_ids: string[];
  created_at: string | null;
  accepted_at: string | null;
  has_content: number;
  evidence_ids: string[];
}

export interface TeamEvidenceRow {
  id: string;
  run_id: string;
  source_kind: string;
  source_locator: string;
  native_id: string | null;
  native_sequence: number | null;
  captured_at: string;
  confidence: EvidenceConfidence;
  parser_version: string;
}

export interface TeamActivityBodyRow {
  activity_id: string;
  input_body: string | null;
  output_body: string | null;
  message_body: string | null;
  result_body: string | null;
  raw_body: string | null;
}

export interface TeamMetricsRow {
  run_id: string;
  calc_version: number;
  generated_at: string;
  metrics: TeamMetrics;
}

/**
 * 一次 run 的差分写入载荷。`complete` 为真表示完整快照（可删除 stale 行）；
 * 为假表示 append/partial（绝不删除既有行，见 design D12 / tasks §3.5）。
 */
export interface TeamRunIngest {
  run: TeamRunRow;
  agents: TeamAgentRow[];
  edges: TeamAgentEdgeRow[];
  tasks: TeamTaskRow[];
  dependencies: TeamTaskDependencyRow[];
  assignments: TeamAssignmentRow[];
  messages: TeamMessageRow[];
  activities: TeamActivityRow[];
  rounds: TeamRoundRow[];
  artifacts: TeamArtifactRow[];
  evidence: TeamEvidenceRow[];
  bodies: TeamActivityBodyRow[];
  metrics: TeamMetricsRow | null;
  session_ids: string[];
  complete: boolean;
}

/** 差分 upsert 的变更结果，供 scanner/coalescer 合并成 team_runs_changed。 */
export interface TeamIngestResult {
  run_id: string;
  stamp: string;
  changed_agent_ids: string[];
  changed_task_ids: string[];
  changed_message_ids: string[];
  changed_activity_ids: string[];
  deleted_agent_ids: string[];
  deleted_task_ids: string[];
  deleted_message_ids: string[];
  deleted_activity_ids: string[];
  changed: boolean;
}

/** 删除日志（进程内；无 tombstone 表契约，patch/reconnect 场景够用）。 */
interface TeamDeletedLogEntry {
  agent_ids: Set<string>;
  task_ids: Set<string>;
  message_ids: Set<string>;
  activity_ids: Set<string>;
}

const deletedLog = new Map<string, TeamDeletedLogEntry>();

/** 写入计数器：差分 upsert 每次实际写（INSERT/UPDATE/DELETE）递增。 */
export const teamWriteCounter = { value: 0 };

function recordWrite(n = 1): void {
  teamWriteCounter.value += n;
}

function logEntry(runId: string): TeamDeletedLogEntry {
  let entry = deletedLog.get(runId);
  if (entry === undefined) {
    entry = { agent_ids: new Set(), task_ids: new Set(), message_ids: new Set(), activity_ids: new Set() };
    deletedLog.set(runId, entry);
  }
  return entry;
}

// ── 辅助 ────────────────────────────────────────────────────────────────

function jsonArray(values: readonly string[]): string {
  return JSON.stringify(values ?? []);
}

function jsonObject(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseStringArray(value: string | null): string[] {
  if (value === null || value === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function parseObject<T>(value: string | null, fallback: T): T {
  if (value === null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseTokens(value: string | null): TokenUsage | null {
  if (value === null || value === '') {
    return null;
  }
  try {
    return JSON.parse(value) as TokenUsage;
  } catch {
    return null;
  }
}

/** 稳定指纹：null → 哨兵，对象 → JSON 序列化，其余 String。 */
function fingerprint(values: readonly unknown[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) {
        return '\u0000';
      }
      if (typeof v === 'object') {
        return JSON.stringify(v);
      }
      return String(v);
    })
    .join('\u0001');
}

/** 把已序列化列常量（逗号分隔）拆成列数组，供 SELECT/INSERT 复用。 */
function splitCols(cols: string): string[] {
  return cols.split(', ');
}

// ── 各表写入列（含 id / run_id，顺序 = INSERT 顺序，与列常量一致） ──────

const RUN_WRITE_COLS = splitCols(TEAM_RUN_LIST_COLS);
const AGENT_WRITE_COLS = splitCols(TEAM_AGENT_COLS);
const EDGE_WRITE_COLS = splitCols(TEAM_EDGE_COLS);
const TASK_WRITE_COLS = splitCols(TEAM_TASK_COLS);
const DEP_WRITE_COLS = splitCols(TEAM_DEP_COLS);
const ASSIGNMENT_WRITE_COLS = splitCols(TEAM_ASSIGNMENT_COLS);
const MESSAGE_WRITE_COLS = splitCols(TEAM_MESSAGE_COLS);
const ACTIVITY_WRITE_COLS = splitCols(TEAM_ACTIVITY_SLIM_COLS);
const ROUND_WRITE_COLS = splitCols(TEAM_ROUND_COLS);
const ARTIFACT_WRITE_COLS = splitCols(TEAM_ARTIFACT_COLS);
const EVIDENCE_WRITE_COLS = splitCols(TEAM_EVIDENCE_COLS);
const METRICS_WRITE_COLS = splitCols(TEAM_METRICS_COLS);

// ── 通用差分 upsert（单 id 主键 + run_id 列的表） ───────────────────────
// 读 existing 全列 → 计算指纹 → 逐条比较；相同跳过（无变化重扫 = 零写入），
// 不同则 INSERT ON CONFLICT(id) DO UPDATE；`complete` 时才删除 stale id。
// 禁止 delete-and-reinsert（design D12 / 禁令 7）。

function upsertSql(table: string, cols: readonly string[]): string {
  const placeholders = cols.map(() => '?').join(', ');
  const updateSet = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return (
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${updateSet}`
  );
}

function diffUpsertById<T>(
  db: Database,
  table: string,
  cols: readonly string[],
  runId: string,
  items: readonly T[],
  idOf: (item: T) => string,
  valuesOf: (item: T) => unknown[],
  complete: boolean,
): { changed: string[]; deleted: string[] } {
  const existing = new Map<string, string>();
  const selectSql = `SELECT ${cols.join(', ')} FROM ${table} WHERE run_id = ?`;
  const existingRows = cachedStmt(db, selectSql).all(runId) as Array<Record<string, unknown>>;
  for (const row of existingRows) {
    const id = String(row.id);
    existing.set(id, fingerprint(cols.map((c) => row[c])));
  }

  const insertSql = upsertSql(table, cols);
  const insertStmt = cachedStmt(db, insertSql);
  const seen = new Set<string>();
  const changed: string[] = [];

  for (const item of items) {
    const id = idOf(item);
    seen.add(id);
    const values = valuesOf(item);
    if (existing.get(id) === fingerprint(values)) {
      continue; // 内容全同，跳过；无变化重扫时为 0 写入
    }
    insertStmt.run(...values);
    recordWrite();
    changed.push(id);
  }

  const deleted: string[] = [];
  if (complete) {
    const deleteSql = `DELETE FROM ${table} WHERE id = ?`;
    const deleteStmt = cachedStmt(db, deleteSql);
    for (const id of existing.keys()) {
      if (!seen.has(id)) {
        deleteStmt.run(id);
        recordWrite();
        deleted.push(id);
      }
    }
  }
  return { changed, deleted };
}

// ── 各表值映射（Row → 与写入列一一对应的值数组） ───────────────────────

function runValues(run: TeamRunRow): unknown[] {
  return [
    run.id, run.provider, run.native_run_id, run.run_identity_confidence,
    run.title, run.goal_fingerprint, run.status, run.started_at, run.ended_at,
    run.topology_kind, run.agent_count, run.task_count, run.communication_count,
    run.activity_count, run.round_count, run.artifact_count, run.token_available,
    run.cost_available, run.cost_currency, jsonObject(run.completeness),
    run.updated_at, run.stamp,
  ];
}

function agentValues(row: TeamAgentRow): unknown[] {
  return [
    row.id, row.run_id, row.native_id, row.display_name, row.role, row.role_class,
    row.model, row.state, row.created_at, row.ended_at, jsonArray(row.session_keys),
    jsonArray(row.evidence_ids),
  ];
}

function edgeValues(row: TeamAgentEdgeRow): unknown[] {
  return [
    row.id, row.run_id, row.from_agent_id, row.to_agent_id, row.kind,
    row.valid_from, row.valid_to, row.confidence, jsonArray(row.evidence_ids),
  ];
}

function taskValues(row: TeamTaskRow): unknown[] {
  return [
    row.id, row.run_id, row.native_id, row.title, row.description_available,
    row.priority, row.status, row.created_at, row.started_at, row.completed_at,
    row.cancelled_at, row.failed_at, row.result_available, jsonArray(row.evidence_ids),
  ];
}

function depValues(row: TeamTaskDependencyRow): unknown[] {
  return [
    row.id, row.run_id, row.upstream_task_id, row.downstream_task_id,
    row.valid_from, row.valid_to, row.confidence, jsonArray(row.evidence_ids),
  ];
}

function assignmentValues(row: TeamAssignmentRow): unknown[] {
  return [
    row.id, row.run_id, row.task_id, row.agent_id, row.assigned_at,
    row.unassigned_at, row.assignment_kind, jsonArray(row.evidence_ids),
  ];
}

function messageValues(row: TeamMessageRow): unknown[] {
  return [
    row.id, row.run_id, row.sender_agent_id, jsonArray(row.recipient_ids),
    row.mode, row.category, row.task_id, row.correlation_id, row.reply_to_id,
    row.sent_at, row.received_at, row.body_available, row.body_chars,
    row.body_bytes, row.content_hash, jsonArray(row.evidence_ids),
  ];
}

function activityValues(row: TeamActivityRow): unknown[] {
  return [
    row.id, row.run_id, row.agent_id, row.task_id, row.round_id, row.kind,
    row.status, row.started_at, row.ended_at, row.native_sequence,
    row.session_key, row.event_id, row.turn_key, row.message_id, row.artifact_id,
    row.tokens === null ? null : JSON.stringify(row.tokens), row.cost_usd,
    row.cost_source, row.cost_currency, row.has_input, row.has_output,
    row.has_raw, jsonArray(row.evidence_ids), row.order_confidence,
  ];
}

function roundValues(row: TeamRoundRow): unknown[] {
  return [
    row.id, row.run_id, row.agent_id, row.native_id, row.idx,
    row.segmentation_source, row.started_at, row.ended_at, row.status,
    jsonArray(row.task_ids), jsonArray(row.output_artifact_ids),
    row.wall_clock_ms, row.active_ms,
    row.tokens === null ? null : JSON.stringify(row.tokens), row.cost_usd,
    row.tool_call_count, row.message_count, row.completeness,
  ];
}

function artifactValues(row: TeamArtifactRow): unknown[] {
  return [
    row.id, row.run_id, row.native_id, row.name, row.kind, row.path_redacted,
    row.content_hash, jsonArray(row.producer_agent_ids), jsonArray(row.task_ids),
    row.created_at, row.accepted_at, row.has_content, jsonArray(row.evidence_ids),
  ];
}

function evidenceValues(row: TeamEvidenceRow): unknown[] {
  return [
    row.id, row.run_id, row.source_kind, row.source_locator, row.native_id,
    row.native_sequence, row.captured_at, row.confidence, row.parser_version,
  ];
}

function metricsValues(row: TeamMetricsRow): unknown[] {
  return [row.run_id, row.calc_version, row.generated_at, JSON.stringify(row.metrics)];
}

// ── 特殊表：team_runs（单行）/ recipients junction / bodies / metrics / run_sessions ──

const UPSERT_RUN_SQL = upsertSql('team_runs', RUN_WRITE_COLS);
const UPSERT_METRICS_SQL = upsertSql('team_metrics', METRICS_WRITE_COLS);
const SELECT_RUN_EXISTING_SQL =
  `SELECT ${RUN_WRITE_COLS.join(', ')} FROM team_runs WHERE id = ?`;
const SELECT_RUN_SESSIONS_SQL =
  'SELECT session_id FROM team_run_sessions WHERE run_id = ?';
const INSERT_RUN_SESSION_SQL =
  'INSERT INTO team_run_sessions (run_id, session_id) VALUES (?, ?)';
const DELETE_RUN_SESSION_SQL =
  'DELETE FROM team_run_sessions WHERE run_id = ? AND session_id = ?';
const SELECT_MESSAGE_RECIPIENTS_SQL =
  'SELECT agent_id FROM team_message_recipients WHERE message_id = ?';
const INSERT_RECIPIENT_SQL =
  'INSERT INTO team_message_recipients (message_id, agent_id) VALUES (?, ?)';
const DELETE_RECIPIENT_SQL =
  'DELETE FROM team_message_recipients WHERE message_id = ? AND agent_id = ?';
const SELECT_BODY_SQL =
  'SELECT activity_id, input_body, output_body, message_body, result_body, raw_body ' +
  'FROM team_activity_bodies WHERE activity_id = ?';
const SELECT_RUN_BODY_IDS_SQL =
  'SELECT b.activity_id FROM team_activity_bodies b ' +
  'JOIN team_activities a ON a.id = b.activity_id WHERE a.run_id = ?';
const UPSERT_BODY_SQL =
  'INSERT INTO team_activity_bodies (activity_id, input_body, output_body, message_body, result_body, raw_body) ' +
  'VALUES (?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT(activity_id) DO UPDATE SET input_body = excluded.input_body, ' +
  'output_body = excluded.output_body, message_body = excluded.message_body, ' +
  'result_body = excluded.result_body, raw_body = excluded.raw_body';
const DELETE_BODY_SQL = 'DELETE FROM team_activity_bodies WHERE activity_id = ?';
const SELECT_METRICS_SQL =
  `SELECT ${METRICS_WRITE_COLS.join(', ')} FROM team_metrics WHERE run_id = ?`;

/** team_runs 业务字段指纹（排除 stamp —— 变更戳不是业务数据，无变化不 bump）。 */
function runBusinessValues(run: TeamRunRow): unknown[] {
  const values = runValues(run);
  return values.slice(0, values.length - 1); // 去掉 stamp
}

function upsertRunRow(db: Database, run: TeamRunRow): boolean {
  const existing = cachedStmt(db, SELECT_RUN_EXISTING_SQL).get(run.id) as
    | Record<string, unknown>
    | undefined;
  if (existing !== undefined) {
    const existingBusiness = fingerprint(RUN_WRITE_COLS.slice(0, -1).map((c) => existing[c]));
    if (existingBusiness === fingerprint(runBusinessValues(run))) {
      return false; // 业务字段全同，无变化
    }
  }
  cachedStmt(db, UPSERT_RUN_SQL).run(...runValues(run));
  recordWrite();
  return true;
}

function upsertRecipients(db: Database, message: TeamMessageRow, complete: boolean): void {
  const recipients = message.recipient_ids ?? [];
  const existing = new Set(
    (cachedStmt(db, SELECT_MESSAGE_RECIPIENTS_SQL).all(message.id) as Array<{ agent_id: string }>)
      .map((r) => r.agent_id),
  );
  const seen = new Set<string>();
  for (const agentId of recipients) {
    seen.add(agentId);
    if (!existing.has(agentId)) {
      cachedStmt(db, INSERT_RECIPIENT_SQL).run(message.id, agentId);
      recordWrite();
    }
  }
  if (complete) {
    for (const agentId of existing) {
      if (!seen.has(agentId)) {
        cachedStmt(db, DELETE_RECIPIENT_SQL).run(message.id, agentId);
        recordWrite();
      }
    }
  }
}

function upsertBodies(
  db: Database,
  runId: string,
  bodies: readonly TeamActivityBodyRow[],
  complete: boolean,
): void {
  const bodyCols = ['input_body', 'output_body', 'message_body', 'result_body', 'raw_body'] as const;
  const seen = new Set<string>();
  // 差分：按 activity_id 读 existing 判等。body 行数远小于活动总数，只对本次
  // 传入的 body 逐条判等，避免全表读。
  for (const body of bodies) {
    seen.add(body.activity_id);
    const existing = cachedStmt(db, SELECT_BODY_SQL).get(body.activity_id) as
      | Record<string, unknown>
      | undefined;
    const values: unknown[] = [
      body.input_body ?? null, body.output_body ?? null, body.message_body ?? null,
      body.result_body ?? null, body.raw_body ?? null,
    ];
    if (
      existing !== undefined &&
      fingerprint(bodyCols.map((c) => existing[c])) === fingerprint(values)
    ) {
      continue; // 内容全同，跳过
    }
    cachedStmt(db, UPSERT_BODY_SQL).run(
      body.activity_id, body.input_body ?? null, body.output_body ?? null,
      body.message_body ?? null, body.result_body ?? null, body.raw_body ?? null,
    );
    recordWrite();
  }
  if (complete) {
    // 完整快照：删除该 run 下本次未传入的 stale body 行。活动本身被删除时
    // 其 body 已由 FK 级联清除；这里处理「活动仍在但 body 消失」的情况。
    const existing = cachedStmt(db, SELECT_RUN_BODY_IDS_SQL).all(runId) as Array<{
      activity_id: string;
    }>;
    for (const row of existing) {
      if (!seen.has(row.activity_id)) {
        cachedStmt(db, DELETE_BODY_SQL).run(row.activity_id);
        recordWrite();
      }
    }
  }
}

function upsertMetrics(db: Database, metrics: TeamMetricsRow | null): void {
  if (metrics === null) {
    return;
  }
  const existing = cachedStmt(db, SELECT_METRICS_SQL).get(metrics.run_id) as
    | Record<string, unknown>
    | undefined;
  const values = metricsValues(metrics);
  if (existing !== undefined && fingerprint(METRICS_WRITE_COLS.map((c) => existing[c])) === fingerprint(values)) {
    return; // 指标全同，跳过
  }
  cachedStmt(db, UPSERT_METRICS_SQL).run(...values);
  recordWrite();
}

function upsertRunSessions(db: Database, runId: string, sessionIds: readonly string[], complete: boolean): void {
  const existing = new Set(
    (cachedStmt(db, SELECT_RUN_SESSIONS_SQL).all(runId) as Array<{ session_id: string }>)
      .map((r) => r.session_id),
  );
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    seen.add(sessionId);
    if (!existing.has(sessionId)) {
      cachedStmt(db, INSERT_RUN_SESSION_SQL).run(runId, sessionId);
      recordWrite();
    }
  }
  if (complete) {
    for (const sessionId of existing) {
      if (!seen.has(sessionId)) {
        cachedStmt(db, DELETE_RUN_SESSION_SQL).run(runId, sessionId);
        recordWrite();
      }
    }
  }
}

/**
 * 差分 upsert 一个受影响 run 的全部派生行，单事务（tasks §3.4）。
 * - 无变化重扫 = 零写入；追加一条 message = 仅受影响 insert/aggregate。
 * - `complete=false`（append/partial）绝不删除既有行（tasks §3.5）。
 * - 写失败一律向上抛（事务回滚），禁止静默 catch（禁令 8）。
 */
export function upsertTeamRun(db: Database, ingest: TeamRunIngest): TeamIngestResult {
  const result: TeamIngestResult = {
    run_id: ingest.run.id,
    stamp: ingest.run.stamp,
    changed_agent_ids: [],
    changed_task_ids: [],
    changed_message_ids: [],
    changed_activity_ids: [],
    deleted_agent_ids: [],
    deleted_task_ids: [],
    deleted_message_ids: [],
    deleted_activity_ids: [],
    changed: false,
  };

  const tx = db.transaction(() => {
    const runChanged = upsertRunRow(db, ingest.run);
    if (runChanged) {
      result.changed = true;
    }

    const agentDiff = diffUpsertById(
      db, 'team_agents', AGENT_WRITE_COLS, ingest.run.id,
      ingest.agents, (a) => a.id, agentValues, ingest.complete,
    );
    result.changed_agent_ids = agentDiff.changed;
    result.deleted_agent_ids = agentDiff.deleted;

    diffUpsertById(
      db, 'team_agent_edges', EDGE_WRITE_COLS, ingest.run.id,
      ingest.edges, (e) => e.id, edgeValues, ingest.complete,
    );

    const taskDiff = diffUpsertById(
      db, 'team_tasks', TASK_WRITE_COLS, ingest.run.id,
      ingest.tasks, (t) => t.id, taskValues, ingest.complete,
    );
    result.changed_task_ids = taskDiff.changed;
    result.deleted_task_ids = taskDiff.deleted;

    diffUpsertById(
      db, 'team_task_dependencies', DEP_WRITE_COLS, ingest.run.id,
      ingest.dependencies, (d) => d.id, depValues, ingest.complete,
    );
    diffUpsertById(
      db, 'team_assignments', ASSIGNMENT_WRITE_COLS, ingest.run.id,
      ingest.assignments, (a) => a.id, assignmentValues, ingest.complete,
    );
    diffUpsertById(
      db, 'team_rounds', ROUND_WRITE_COLS, ingest.run.id,
      ingest.rounds, (r) => r.id, roundValues, ingest.complete,
    );
    diffUpsertById(
      db, 'team_artifacts', ARTIFACT_WRITE_COLS, ingest.run.id,
      ingest.artifacts, (a) => a.id, artifactValues, ingest.complete,
    );
    diffUpsertById(
      db, 'team_evidence', EVIDENCE_WRITE_COLS, ingest.run.id,
      ingest.evidence, (e) => e.id, evidenceValues, ingest.complete,
    );

    const activityDiff = diffUpsertById(
      db, 'team_activities', ACTIVITY_WRITE_COLS, ingest.run.id,
      ingest.activities, (a) => a.id, activityValues, ingest.complete,
    );
    result.changed_activity_ids = activityDiff.changed;
    result.deleted_activity_ids = activityDiff.deleted;

    const messageDiff = diffUpsertById(
      db, 'team_messages', MESSAGE_WRITE_COLS, ingest.run.id,
      ingest.messages, (m) => m.id, messageValues, ingest.complete,
    );
    result.changed_message_ids = messageDiff.changed;
    result.deleted_message_ids = messageDiff.deleted;

    for (const message of ingest.messages) {
      upsertRecipients(db, message, ingest.complete);
    }
    upsertBodies(db, ingest.run.id, ingest.bodies, ingest.complete);
    upsertMetrics(db, ingest.metrics);
    upsertRunSessions(db, ingest.run.id, ingest.session_ids, ingest.complete);

    if (
      result.changed ||
      result.changed_agent_ids.length > 0 ||
      result.changed_task_ids.length > 0 ||
      result.changed_message_ids.length > 0 ||
      result.changed_activity_ids.length > 0 ||
      result.deleted_agent_ids.length > 0 ||
      result.deleted_task_ids.length > 0 ||
      result.deleted_message_ids.length > 0 ||
      result.deleted_activity_ids.length > 0
    ) {
      result.changed = true;
    }

    // 记录删除日志（供 patch 报告 deleted ids）
    const entry = logEntry(ingest.run.id);
    for (const id of result.deleted_agent_ids) entry.agent_ids.add(id);
    for (const id of result.deleted_task_ids) entry.task_ids.add(id);
    for (const id of result.deleted_message_ids) entry.message_ids.add(id);
    for (const id of result.deleted_activity_ids) entry.activity_ids.add(id);
  });

  tx();
  return result;
}

// ── 读取方向：查询选项与结果类型 ──────────────────────────────────────

export interface ListTeamRunsOptions {
  provider?: ProviderKey[];
  status?: TeamRunStatus[];
  topology?: TeamTopologyKind[];
  /** title / native_run_id 大小写不敏感子串（LIKE，ESCAPE '\'）。 */
  q?: string;
  range?: 'today' | '7d' | '30d' | 'all';
  /** 任意证据维度命中给定水平的 run（json_each 包含谓词）。 */
  completeness?: CompletenessLevel[];
  limit?: number;
  cursor?: string;
}

export interface TeamRunListResult {
  items: TeamRunSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface ListTeamActivitiesOptions {
  agent?: string;
  task?: string;
  kind?: TeamActivityKind[];
  status?: TraceStatus[];
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface TeamActivityListResult {
  items: TeamActivitySlim[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  /** 返回行里任一 orderConfidence === 'ambiguous' 时为 true。 */
  hasAmbiguousOrder: boolean;
}

export interface TeamActivityBody {
  input: string | null;
  output: string | null;
  message: string | null;
  result: string | null;
}

export interface TeamActivityDetailResult {
  activity: TeamActivitySlim;
  body: TeamActivityBody | null;
  raw: string | null;
}

export interface TeamPatchResult {
  runId: string;
  stamp: string;
  agents: TeamAgent[];
  tasks: TeamTask[];
  agentEdges: TeamAgentEdge[];
  taskDependencies: TeamTaskDependency[];
  assignments: TeamAssignment[];
  messages: TeamCommunication[];
  artifacts: TeamArtifact[];
  metrics: TeamMetrics | null;
  deletedAgentIds: string[];
  deletedTaskIds: string[];
  deletedMessageIds: string[];
  deletedActivityIds: string[];
  truncated: boolean;
}

/** team 源扫描状态（复用 scan_state 表，source_path 由 adapter 保证唯一）。 */
export interface TeamScanState {
  sourcePath: string;
  provider: ProviderKey;
  runId: string | null;
  fileSize: number;
  fileMtimeMs: number;
  contentHash: string;
  byteOffset: number;
  lastScanAt: string;
  eventCount: number;
}

// ── 读取辅助：cursor 编解码 / 值映射 ──────────────────────────────────

interface TeamRunCursor {
  s: string | null;
  i: string;
}

interface TeamActivityCursor {
  s: string | null;
  n: number | null;
  i: string;
}

function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor<T>(cursor: string): T | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function booleanOf(value: unknown): boolean {
  return Number(value) === 1;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function rangeSince(range: 'today' | '7d' | '30d' | 'all' | undefined): string | undefined {
  if (range === undefined || range === 'all') {
    return undefined;
  }
  const now = new Date();
  if (range === 'today') {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  const days = range === '7d' ? 7 : 30;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

// ── snake_case 行 → camelCase 契约类型（contracts/data-model.md §12） ──

function mapRunSummary(row: Record<string, unknown>): TeamRunSummary {
  return {
    id: String(row.id),
    provider: row.provider as ProviderKey,
    nativeRunId: String(row.native_run_id),
    runIdentityConfidence: row.run_identity_confidence as EvidenceConfidence,
    title: String(row.title),
    goalFingerprint: nullableString(row.goal_fingerprint),
    status: row.status as TeamRunStatus,
    startedAt: nullableString(row.started_at),
    endedAt: nullableString(row.ended_at),
    topologyKind: row.topology_kind as TeamTopologyKind,
    counts: {
      agents: Number(row.agent_count),
      tasks: Number(row.task_count),
      communications: Number(row.communication_count),
      activities: Number(row.activity_count),
      rounds: Number(row.round_count),
      artifacts: Number(row.artifact_count),
    },
    tokenAvailable: booleanOf(row.token_available),
    costAvailable: booleanOf(row.cost_available),
    costCurrency: nullableString(row.cost_currency) as PriceCurrency | null,
    completeness: parseObject<TeamCompleteness>(row.completeness_json as string, {} as TeamCompleteness),
    updatedAt: String(row.updated_at),
    stamp: String(row.stamp),
  };
}

function mapAgent(row: Record<string, unknown>): TeamAgent {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nativeId: String(row.native_id),
    displayName: String(row.display_name),
    role: String(row.role),
    roleClass: String(row.role_class),
    model: nullableString(row.model),
    state: row.state as TeamAgentState,
    createdAt: nullableString(row.created_at),
    endedAt: nullableString(row.ended_at),
    sessionKeys: parseStringArray(row.session_keys_json as string | null),
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

function mapAgentEdge(row: Record<string, unknown>): TeamAgentEdge {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    kind: row.kind as TeamAgentEdgeKind,
    validFrom: nullableString(row.valid_from),
    validTo: nullableString(row.valid_to),
    confidence: row.confidence as EvidenceConfidence,
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

function mapTask(row: Record<string, unknown>): TeamTask {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nativeId: String(row.native_id),
    title: String(row.title),
    descriptionAvailable: booleanOf(row.description_available),
    priority: row.priority === null || row.priority === undefined ? null : Number(row.priority),
    status: row.status as TeamTaskStatus,
    createdAt: nullableString(row.created_at),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at),
    cancelledAt: nullableString(row.cancelled_at),
    failedAt: nullableString(row.failed_at),
    resultAvailable: booleanOf(row.result_available),
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

function mapTaskDependency(row: Record<string, unknown>): TeamTaskDependency {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    upstreamTaskId: String(row.upstream_task_id),
    downstreamTaskId: String(row.downstream_task_id),
    validFrom: nullableString(row.valid_from),
    validTo: nullableString(row.valid_to),
    confidence: row.confidence as EvidenceConfidence,
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

function mapAssignment(row: Record<string, unknown>): TeamAssignment {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    taskId: String(row.task_id),
    agentId: String(row.agent_id),
    assignedAt: nullableString(row.assigned_at),
    unassignedAt: nullableString(row.unassigned_at),
    assignmentKind: String(row.assignment_kind),
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

function mapCommunication(row: Record<string, unknown>): TeamCommunication {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    senderAgentId: String(row.sender_agent_id),
    recipientAgentIds: parseStringArray(row.recipient_ids_json as string | null),
    mode: row.mode as TeamMessageMode,
    category: row.category as TeamMessageCategory,
    taskId: nullableString(row.task_id),
    correlationId: nullableString(row.correlation_id),
    replyToId: nullableString(row.reply_to_id),
    sentAt: nullableString(row.sent_at),
    receivedAt: nullableString(row.received_at),
    bodyAvailable: booleanOf(row.body_available),
    bodyChars: row.body_chars === null || row.body_chars === undefined ? null : Number(row.body_chars),
    bodyBytes: row.body_bytes === null || row.body_bytes === undefined ? null : Number(row.body_bytes),
    contentHash: nullableString(row.content_hash),
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

function mapActivitySlim(row: Record<string, unknown>): TeamActivitySlim {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    agentId: nullableString(row.agent_id),
    taskId: nullableString(row.task_id),
    roundId: nullableString(row.round_id),
    kind: row.kind as TeamActivityKind,
    status: row.status as TraceStatus,
    startedAt: nullableString(row.started_at),
    endedAt: nullableString(row.ended_at),
    nativeSequence: row.native_sequence === null || row.native_sequence === undefined
      ? null
      : Number(row.native_sequence),
    sessionKey: nullableString(row.session_key),
    eventId: nullableString(row.event_id),
    turnKey: nullableString(row.turn_key),
    messageId: nullableString(row.message_id),
    artifactId: nullableString(row.artifact_id),
    tokenUsage: parseTokens(row.tokens_json as string | null),
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    costSource: nullableString(row.cost_source) as CostSource | null,
    costCurrency: nullableString(row.cost_currency) as PriceCurrency | null,
    hasInput: booleanOf(row.has_input),
    hasOutput: booleanOf(row.has_output),
    hasRaw: booleanOf(row.has_raw),
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
    orderConfidence: row.order_confidence as TeamOrderConfidence,
  };
}

function mapArtifact(row: Record<string, unknown>): TeamArtifact {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nativeId: nullableString(row.native_id),
    name: String(row.name),
    kind: String(row.kind),
    pathRedacted: nullableString(row.path_redacted),
    contentHash: nullableString(row.content_hash),
    producerAgentIds: parseStringArray(row.producer_agent_ids_json as string | null),
    taskIds: parseStringArray(row.task_ids_json as string | null),
    createdAt: nullableString(row.created_at),
    acceptedAt: nullableString(row.accepted_at),
    hasContent: booleanOf(row.has_content),
    evidenceIds: parseStringArray(row.evidence_ids_json as string | null),
  };
}

// ── 读取 SQL（全部显式列，禁止 SELECT *） ──────────────────────────────

const RUN_SELECT_SQL = `SELECT ${TEAM_RUN_LIST_COLS} FROM team_runs`;
const RUN_BY_ID_SQL = `SELECT ${TEAM_RUN_LIST_COLS} FROM team_runs WHERE id = ?`;
const RUN_STAMP_SQL = 'SELECT stamp FROM team_runs WHERE id = ?';

const AGENT_BY_RUN_SQL = `SELECT ${TEAM_AGENT_COLS} FROM team_agents WHERE run_id = ?`;
const EDGE_BY_RUN_SQL = `SELECT ${TEAM_EDGE_COLS} FROM team_agent_edges WHERE run_id = ?`;
const TASK_BY_RUN_SQL = `SELECT ${TEAM_TASK_COLS} FROM team_tasks WHERE run_id = ?`;
const DEP_BY_RUN_SQL = `SELECT ${TEAM_DEP_COLS} FROM team_task_dependencies WHERE run_id = ?`;
const ASSIGNMENT_ACTIVE_BY_RUN_SQL =
  `SELECT ${TEAM_ASSIGNMENT_COLS} FROM team_assignments WHERE run_id = ? AND unassigned_at IS NULL`;
const ASSIGNMENT_BY_RUN_SQL = `SELECT ${TEAM_ASSIGNMENT_COLS} FROM team_assignments WHERE run_id = ?`;
const ARTIFACT_BY_RUN_SQL = `SELECT ${TEAM_ARTIFACT_COLS} FROM team_artifacts WHERE run_id = ?`;
const MESSAGE_BY_RUN_SQL = `SELECT ${TEAM_MESSAGE_COLS} FROM team_messages WHERE run_id = ?`;

const ACTIVITY_BY_RUN_SQL = `SELECT ${TEAM_ACTIVITY_SLIM_COLS} FROM team_activities`;
const ACTIVITY_BY_ID_SQL =
  `SELECT ${TEAM_ACTIVITY_SLIM_COLS} FROM team_activities WHERE run_id = ? AND id = ?`;
const BODY_BY_ACTIVITY_SQL =
  'SELECT input_body, output_body, message_body, result_body, raw_body ' +
  'FROM team_activity_bodies WHERE activity_id = ?';

const METRICS_BY_RUN_SQL = `SELECT ${TEAM_METRICS_COLS} FROM team_metrics WHERE run_id = ?`;

const TEAM_SCAN_STATE_GET_SQL =
  'SELECT source_path, provider, session_id, file_size, file_mtime_ms, content_hash, ' +
  'byte_offset, last_scan_at, event_count FROM scan_state WHERE source_path = ?';
const TEAM_SCAN_STATE_PUT_SQL =
  'INSERT INTO scan_state (source_path, provider, session_id, file_size, file_mtime_ms, ' +
  'content_hash, byte_offset, last_scan_at, event_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT(source_path) DO UPDATE SET provider = excluded.provider, ' +
  'session_id = excluded.session_id, file_size = excluded.file_size, ' +
  'file_mtime_ms = excluded.file_mtime_ms, content_hash = excluded.content_hash, ' +
  'byte_offset = excluded.byte_offset, last_scan_at = excluded.last_scan_at, ' +
  'event_count = excluded.event_count';

const DELETE_TEAM_RUN_SQL = 'DELETE FROM team_runs WHERE id = ?';
const TEAM_RUN_IDS_BY_SOURCE_SQL =
  'SELECT DISTINCT run_id FROM team_evidence WHERE source_locator = ?';

// ── 空 metrics（尚未计算时返回全 unavailable，禁止 0 冒充） ──────────────

function unavailableMetric(): TeamMetricValue {
  return {
    value: null,
    available: false,
    complete: false,
    criteria: '',
    evidenceIds: [],
    numerator: null,
    denominator: null,
  };
}

const EMPTY_TEAM_METRICS: TeamMetrics = {
  calcVersion: 0,
  generatedAt: '',
  scheduling: {
    wallClockMs: unavailableMetric(),
    agentActiveMs: unavailableMetric(),
    totalWorkMs: unavailableMetric(),
    observedWaitMs: unavailableMetric(),
    maxConcurrency: unavailableMetric(),
    avgConcurrency: unavailableMetric(),
    serialWorkEstimateMs: unavailableMetric(),
    observedSpeedup: unavailableMetric(),
    peakCapacityUtilization: unavailableMetric(),
    criticalPathMs: unavailableMetric(),
    delegationDelayMs: unavailableMetric(),
    handoffLatencyMs: unavailableMetric(),
  },
  quality: {
    taskCompletion: unavailableMetric(),
    verificationCoverage: unavailableMetric(),
    acceptanceCoverage: unavailableMetric(),
    reviewRework: unavailableMetric(),
    acceptedArtifactRate: unavailableMetric(),
  },
  stability: {
    failures: unavailableMetric(),
    retries: unavailableMetric(),
    replacements: unavailableMetric(),
    recoveryLatencyMs: unavailableMetric(),
    blockedOrphanTimeMs: unavailableMetric(),
    unresolvedErrors: unavailableMetric(),
    dagAnomalies: unavailableMetric(),
    incompleteTerminalStates: unavailableMetric(),
  },
  cost: {
    totalInputTokens: unavailableMetric(),
    totalOutputTokens: unavailableMetric(),
    totalReasoningTokens: unavailableMetric(),
    totalCacheReadTokens: unavailableMetric(),
    totalCacheWriteTokens: unavailableMetric(),
    totalCostUsd: unavailableMetric(),
    costCurrency: null,
    coordinationTokens: unavailableMetric(),
    costGini: unavailableMetric(),
  },
  collaboration: {
    directRatio: unavailableMetric(),
    leaderMediatedRatio: unavailableMetric(),
    responseLatencyMedianMs: unavailableMetric(),
    responseLatencyP95Ms: unavailableMetric(),
    taskBalanceGini: unavailableMetric(),
    leaderWorkConcentration: unavailableMetric(),
    criticalAgentConcentration: unavailableMetric(),
    crossAgentReview: unavailableMetric(),
    duplicateWorkSignal: unavailableMetric(),
  },
};

function readMetrics(db: Database, runId: string): TeamMetrics {
  const row = cachedStmt(db, METRICS_BY_RUN_SQL).get(runId) as Record<string, unknown> | undefined;
  if (row === undefined) {
    return EMPTY_TEAM_METRICS;
  }
  const metrics = parseObject<TeamMetrics>(row.metrics_json as string, EMPTY_TEAM_METRICS);
  if (metrics.calcVersion !== Number(row.calc_version)) {
    metrics.calcVersion = Number(row.calc_version);
  }
  metrics.generatedAt = String(row.generated_at);
  return metrics;
}

// ── 查询函数 ───────────────────────────────────────────────────────────

/**
 * keyset 分页 run 列表（tasks §3.9）。排序 `started_at DESC, id ASC`，
 * cursor = base64url({s: started_at | null, i: id})。slim 投影，绝不含 body。
 */
export function listTeamRuns(db: Database, opts: ListTeamRunsOptions): TeamRunListResult {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const providers = opts.provider !== undefined && opts.provider.length > 0 ? opts.provider : undefined;
  const statuses = opts.status !== undefined && opts.status.length > 0 ? opts.status : undefined;
  const topologies = opts.topology !== undefined && opts.topology.length > 0 ? opts.topology : undefined;
  const q = opts.q !== undefined && opts.q !== '' ? opts.q : undefined;
  const since = rangeSince(opts.range);
  const completeness = opts.completeness !== undefined && opts.completeness.length > 0
    ? opts.completeness
    : undefined;

  const where: string[] = [];
  const params: unknown[] = [];
  if (providers !== undefined) {
    where.push(`provider IN (${providers.map(() => '?').join(', ')})`);
    params.push(...providers);
  }
  if (statuses !== undefined) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  if (topologies !== undefined) {
    where.push(`topology_kind IN (${topologies.map(() => '?').join(', ')})`);
    params.push(...topologies);
  }
  if (q !== undefined) {
    const pattern = `%${escapeLike(q)}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR native_run_id LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (since !== undefined) {
    where.push('started_at >= ?');
    params.push(since);
  }
  if (completeness !== undefined) {
    where.push(
      `EXISTS (SELECT 1 FROM json_each(completeness_json) AS j ` +
      `WHERE j.value IN (${completeness.map(() => '?').join(', ')}))`,
    );
    params.push(...completeness);
  }

  let cursor: TeamRunCursor | null = null;
  if (opts.cursor !== undefined) {
    cursor = decodeCursor<TeamRunCursor>(opts.cursor);
  }
  if (cursor !== null) {
    if (cursor.s === null) {
      where.push('(started_at IS NULL AND id > ?)');
      params.push(cursor.i);
    } else {
      where.push('(started_at < ? OR (started_at = ? AND id > ?))');
      params.push(cursor.s, cursor.s, cursor.i);
    }
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const orderSql = ' ORDER BY started_at DESC, id ASC';
  const listSql = `${RUN_SELECT_SQL}${whereSql}${orderSql} LIMIT ?`;
  const listParams = [...params, limit + 1];
  const rows = cachedStmt(db, listSql).all(...listParams) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(mapRunSummary);

  const last = items.at(-1);
  const nextCursor = hasMore && last !== undefined
    ? encodeCursor({ s: last.startedAt, i: last.id })
    : null;

  const countSql = `SELECT COUNT(*) AS c FROM team_runs${whereSql}`;
  const total = (cachedStmt(db, countSql).get(...params) as { c: number }).c;

  return { items, nextCursor, hasMore, total };
}

function getRunSummary(db: Database, runId: string): TeamRunSummary | null {
  const row = cachedStmt(db, RUN_BY_ID_SQL).get(runId) as Record<string, unknown> | undefined;
  return row === undefined ? null : mapRunSummary(row);
}

/**
 * 有界快照（tasks §3.10）：summary + agents + edges + tasks + deps + 当前
 * active assignments + artifacts + completeness + metrics。固定数量的 SQL 语句，
 * 不随 agent/task/activity 行数增长；绝不含 body。
 * `anomalies` 由 core analysis（§5）在 ingest 后计算并在此组装，storage 层
 * 不重复计算，默认空数组。
 */
export function getTeamRunSnapshot(db: Database, runId: string): TeamRunSnapshot | null {
  const summary = getRunSummary(db, runId);
  if (summary === null) {
    return null;
  }
  const agents = (cachedStmt(db, AGENT_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapAgent);
  const agentEdges = (cachedStmt(db, EDGE_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapAgentEdge);
  const tasks = (cachedStmt(db, TASK_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapTask);
  const taskDependencies = (cachedStmt(db, DEP_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapTaskDependency);
  const assignments = (cachedStmt(db, ASSIGNMENT_ACTIVE_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapAssignment);
  const artifacts = (cachedStmt(db, ARTIFACT_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapArtifact);
  const metrics = readMetrics(db, runId);
  return {
    summary,
    agents,
    agentEdges,
    tasks,
    taskDependencies,
    assignments,
    artifacts,
    completeness: summary.completeness,
    anomalies: [],
    metrics,
  };
}

/**
 * keyset 分页活动账本（tasks §3.11）。排序
 * `started_at DESC, native_sequence DESC, id ASC`，cursor =
 * base64url({s: started_at, n: native_sequence, i: id})。slim 投影，绝不含 body。
 */
export function listTeamActivities(
  db: Database,
  runId: string,
  opts: ListTeamActivitiesOptions,
): TeamActivityListResult {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const kinds = opts.kind !== undefined && opts.kind.length > 0 ? opts.kind : undefined;
  const statuses = opts.status !== undefined && opts.status.length > 0 ? opts.status : undefined;

  const where: string[] = ['run_id = ?'];
  const params: unknown[] = [runId];
  if (opts.agent !== undefined && opts.agent !== '') {
    where.push('agent_id = ?');
    params.push(opts.agent);
  }
  if (opts.task !== undefined && opts.task !== '') {
    where.push('task_id = ?');
    params.push(opts.task);
  }
  if (kinds !== undefined) {
    where.push(`kind IN (${kinds.map(() => '?').join(', ')})`);
    params.push(...kinds);
  }
  if (statuses !== undefined) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  if (opts.from !== undefined) {
    where.push('started_at >= ?');
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push('started_at <= ?');
    params.push(opts.to);
  }

  let cursor: TeamActivityCursor | null = null;
  if (opts.cursor !== undefined) {
    cursor = decodeCursor<TeamActivityCursor>(opts.cursor);
  }
  if (cursor !== null) {
    if (cursor.s === null) {
      where.push('(started_at IS NULL AND id > ?)');
      params.push(cursor.i);
    } else if (cursor.n === null) {
      where.push('(started_at < ? OR (started_at = ? AND native_sequence IS NULL AND id > ?))');
      params.push(cursor.s, cursor.s, cursor.i);
    } else {
      where.push(
        '(started_at < ? OR (started_at = ? AND native_sequence < ?) ' +
        'OR (started_at = ? AND native_sequence = ? AND id > ?))',
      );
      params.push(cursor.s, cursor.s, cursor.n, cursor.s, cursor.n, cursor.i);
    }
  }

  const whereSql = ` WHERE ${where.join(' AND ')}`;
  const orderSql = ' ORDER BY started_at DESC, native_sequence DESC, id ASC';
  const listSql = `${ACTIVITY_BY_RUN_SQL}${whereSql}${orderSql} LIMIT ?`;
  const listParams = [...params, limit + 1];
  const rows = cachedStmt(db, listSql).all(...listParams) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(mapActivitySlim);
  const hasAmbiguousOrder = items.some((a) => a.orderConfidence === 'ambiguous');

  const last = items.at(-1);
  const nextCursor = hasMore && last !== undefined
    ? encodeCursor({ s: last.startedAt, n: last.nativeSequence, i: last.id })
    : null;

  const countSql = `SELECT COUNT(*) AS c FROM team_activities${whereSql}`;
  const total = (cachedStmt(db, countSql).get(...params) as { c: number }).c;

  return { items, nextCursor, hasMore, total, hasAmbiguousOrder };
}

/**
 * 单条活动详情（tasks §3.12）：include=body / include=raw 分层，默认 slim。
 * 返回 null 表示 run 或 activity 不存在（HTTP 层映射 404）；
 * 返回 body 与 raw 均为 null 表示「详情行缺失」→ 映射 TEAM_BODY_UNAVAILABLE。
 */
export function getTeamActivityDetail(
  db: Database,
  runId: string,
  activityId: string,
  include?: 'body' | 'raw',
): TeamActivityDetailResult | null {
  const row = cachedStmt(db, ACTIVITY_BY_ID_SQL).get(runId, activityId) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) {
    return null;
  }
  const activity = mapActivitySlim(row);
  const bodyRow = cachedStmt(db, BODY_BY_ACTIVITY_SQL).get(activityId) as
    | Record<string, unknown>
    | undefined;
  const body: TeamActivityBody | null = bodyRow === undefined
    ? null
    : {
        input: nullableString(bodyRow.input_body),
        output: nullableString(bodyRow.output_body),
        message: nullableString(bodyRow.message_body),
        result: nullableString(bodyRow.result_body),
      };
  const raw = include === 'raw' && bodyRow !== undefined ? nullableString(bodyRow.raw_body) : null;
  const bodyOut = include === 'body' ? body : null;
  return { activity, body: bodyOut, raw };
}

/**
 * 有界补丁（tasks §3.13）：返回当前全部 slim 实体（bounded by cap）+ 进程内
 * deletedLog 的 deleted ids。超出 cap 时 truncated=true，客户端改做一次快照
 * 刷新（design D14）。stamp 未变时返回空补丁。
 */
export function getTeamPatch(
  db: Database,
  runId: string,
  stamp: string,
  cap = 200,
): TeamPatchResult | null {
  const current = cachedStmt(db, RUN_STAMP_SQL).get(runId) as { stamp: string } | undefined;
  if (current === undefined) {
    return null;
  }
  const entry = logEntry(runId);
  const base: TeamPatchResult = {
    runId,
    stamp: current.stamp,
    agents: [],
    tasks: [],
    agentEdges: [],
    taskDependencies: [],
    assignments: [],
    messages: [],
    artifacts: [],
    metrics: null,
    deletedAgentIds: [...entry.agent_ids],
    deletedTaskIds: [...entry.task_ids],
    deletedMessageIds: [...entry.message_ids],
    deletedActivityIds: [...entry.activity_ids],
    truncated: false,
  };

  if (current.stamp === stamp) {
    return base; // 无变化：stamp 相同，空补丁
  }

  const agents = (cachedStmt(db, AGENT_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapAgent);
  const tasks = (cachedStmt(db, TASK_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapTask);
  const agentEdges = (cachedStmt(db, EDGE_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapAgentEdge);
  const taskDependencies = (cachedStmt(db, DEP_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapTaskDependency);
  const assignments = (cachedStmt(db, ASSIGNMENT_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapAssignment);
  const messages = (cachedStmt(db, MESSAGE_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapCommunication);
  const artifacts = (cachedStmt(db, ARTIFACT_BY_RUN_SQL).all(runId) as Array<Record<string, unknown>>)
    .map(mapArtifact);

  base.agents = agents.slice(0, cap);
  base.tasks = tasks.slice(0, cap);
  base.agentEdges = agentEdges.slice(0, cap);
  base.taskDependencies = taskDependencies.slice(0, cap);
  base.assignments = assignments.slice(0, cap);
  base.messages = messages.slice(0, cap);
  base.artifacts = artifacts.slice(0, cap);
  base.metrics = readMetrics(db, runId);
  base.deletedAgentIds = base.deletedAgentIds.slice(0, cap);
  base.deletedTaskIds = base.deletedTaskIds.slice(0, cap);
  base.deletedMessageIds = base.deletedMessageIds.slice(0, cap);
  base.deletedActivityIds = base.deletedActivityIds.slice(0, cap);
  base.truncated =
    agents.length > cap ||
    tasks.length > cap ||
    agentEdges.length > cap ||
    taskDependencies.length > cap ||
    assignments.length > cap ||
    messages.length > cap ||
    artifacts.length > cap ||
    entry.agent_ids.size > cap ||
    entry.task_ids.size > cap ||
    entry.message_ids.size > cap ||
    entry.activity_ids.size > cap;
  return base;
}

/**
 * 两 run 比较输入（tasks §3.14）：复用有界快照，每个 run 固定数量 SQL，
 * 无 per-agent/task/session 循环。缺失的 run 返回 null，由 HTTP 层映射 404。
 */
export function getTeamCompareInputs(
  db: Database,
  leftRunId: string,
  rightRunId: string,
): { left: TeamRunSnapshot | null; right: TeamRunSnapshot | null } {
  return {
    left: getTeamRunSnapshot(db, leftRunId),
    right: getTeamRunSnapshot(db, rightRunId),
  };
}

/**
 * 显式删除派生 team run（tasks §3.8）：仅删 team-owned 行（FK 级联），
 * 不删 sessions / 源文件。返回是否确有删除。
 */
export function deleteTeamRun(db: Database, runId: string): boolean {
  const info = cachedStmt(db, DELETE_TEAM_RUN_SQL).run(runId);
  deletedLog.delete(runId);
  return info.changes > 0;
}

/**
 * team 源扫描状态读取/写入（tasks §3.7，复用 scan_state 表）。写失败必须
 * throw（禁令 8），绝不在静默 catch 中吞掉。
 */
export function getTeamScanState(db: Database, sourcePath: string): TeamScanState | null {
  const row = cachedStmt(db, TEAM_SCAN_STATE_GET_SQL).get(sourcePath) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) {
    return null;
  }
  return {
    sourcePath: String(row.source_path),
    provider: row.provider as ProviderKey,
    runId: nullableString(row.session_id),
    fileSize: Number(row.file_size),
    fileMtimeMs: Number(row.file_mtime_ms),
    contentHash: String(row.content_hash),
    byteOffset: Number(row.byte_offset),
    lastScanAt: String(row.last_scan_at),
    eventCount: Number(row.event_count),
  };
}

export function putTeamScanState(db: Database, state: TeamScanState): void {
  cachedStmt(db, TEAM_SCAN_STATE_PUT_SQL).run(
    state.sourcePath, state.provider, state.runId, state.fileSize, state.fileMtimeMs,
    state.contentHash, state.byteOffset, state.lastScanAt, state.eventCount,
  );
}

/**
 * parser-version 失效（tasks §3.6）：按 source_locator 找出受影响 run 并删除
 * 其 team-owned 派生行（FK 级联），绝不碰 sessions/events/raw 源文件。返回删除
 * 的 run 数量。调用方随后用新 parser version 重扫重建。
 */
export function invalidateTeamBySource(db: Database, sourceLocator: string): number {
  const rows = cachedStmt(db, TEAM_RUN_IDS_BY_SOURCE_SQL).all(sourceLocator) as Array<{
    run_id: string;
  }>;
  let removed = 0;
  for (const row of rows) {
    const info = cachedStmt(db, DELETE_TEAM_RUN_SQL).run(row.run_id);
    removed += info.changes;
    deletedLog.delete(row.run_id);
  }
  return removed;
}

// ══════════════════════════════════════════════════════════════════════════
// §4.15 scanner → storage 桥：NormalizedTeamEvidence → TeamRunIngest + TeamSink
//
// scanner 层（local-sessions/team-scanner.ts）产出 NormalizedTeamEvidence（adapter
// 规范化证据），storage 层差分 upsert 接收 TeamRunIngest（snake_case 行）。本段
// 是两者之间的纯转换函数 + TeamSink 实现（包装 upsertTeamRun/deleteTeamRun）。
//
// 设计约束：
// - 纯函数，无 DB 副作用，便于单测；
// - topology_kind 由 edges 推导（design D5，绝不按 provider 名假设）；
// - bodies/metrics 在 evidence 中不存在 → 空数组/null（由 detail/metrics 路径另填）；
// - complete = true（scanner 总是完整快照，可删除 stale 行）。
// ══════════════════════════════════════════════════════════════════════════

/** 从 agent edges 推导拓扑分类（design D5）。 */
function deriveTopologyKind(
  agents: ReadonlyArray<{ id: string; roleClass: string }>,
  edges: ReadonlyArray<{ fromAgentId: string; toAgentId: string; kind: string }>,
): TeamTopologyKind {
  if (agents.length === 0) {
    return 'unknown';
  }
  if (edges.length === 0) {
    return 'unknown';
  }
  // 统计 leader→teammate 与 teammate→teammate 边数
  const agentRole = new Map<string, string>();
  for (const a of agents) {
    agentRole.set(a.id, a.roleClass);
  }
  let leaderToTeammate = 0;
  let teammateToTeammate = 0;
  let other = 0;
  for (const e of edges) {
    const fromRole = agentRole.get(e.fromAgentId) ?? 'unknown';
    const toRole = agentRole.get(e.toAgentId) ?? 'unknown';
    if (fromRole === 'leader' && toRole === 'teammate') {
      leaderToTeammate += 1;
    } else if (fromRole === 'teammate' && toRole === 'teammate') {
      teammateToTeammate += 1;
    } else {
      other += 1;
    }
  }
  if (teammateToTeammate > 0) {
    return 'peer_graph';
  }
  if (leaderToTeammate > 0 && other === 0) {
    return 'two_level';
  }
  return 'hybrid';
}

/**
 * §4.15 scanner → storage 转换：NormalizedTeamEvidence → TeamRunIngest。
 * 纯函数，无副作用。`complete = true`（scanner 总是完整快照）。
 */
export function evidenceToIngest(evidence: NormalizedTeamEvidence): TeamRunIngest {
  const { run, agents, agentEdges, tasks, taskDependencies, assignments, communications, activities, rounds, artifacts, evidence: evidenceRefs, completeness } = evidence;
  const now = new Date().toISOString();
  const topologyKind = deriveTopologyKind(agents, agentEdges);
  // 收集所有 agent 关联的 session keys（去重）
  const sessionIds = new Set<string>();
  for (const agent of agents) {
    for (const key of agent.sessionKeys) {
      sessionIds.add(key);
    }
  }

  const runRow: TeamRunRow = {
    id: run.runId,
    provider: run.provider,
    native_run_id: run.nativeRunId,
    run_identity_confidence: run.runIdentityConfidence,
    title: run.title,
    goal_fingerprint: run.goalFingerprint,
    status: run.status,
    started_at: run.startedAt,
    ended_at: run.endedAt,
    topology_kind: topologyKind,
    agent_count: agents.length,
    task_count: tasks.length,
    communication_count: communications.length,
    activity_count: activities.length,
    round_count: rounds.length,
    artifact_count: artifacts.length,
    token_available: run.tokenAvailable ? 1 : 0,
    cost_available: run.costAvailable ? 1 : 0,
    cost_currency: run.costCurrency,
    completeness,
    updated_at: now,
    stamp: now,
  };

  const agentRows: TeamAgentRow[] = agents.map((a) => ({
    id: a.id,
    run_id: run.runId,
    native_id: a.nativeId,
    display_name: a.displayName,
    role: a.role,
    role_class: a.roleClass,
    model: a.model,
    state: a.state,
    created_at: a.createdAt,
    ended_at: a.endedAt,
    session_keys: a.sessionKeys,
    evidence_ids: a.evidenceIds,
  }));

  const edgeRows: TeamAgentEdgeRow[] = agentEdges.map((e) => ({
    id: e.id,
    run_id: run.runId,
    from_agent_id: e.fromAgentId,
    to_agent_id: e.toAgentId,
    kind: e.kind,
    valid_from: e.validFrom,
    valid_to: e.validTo,
    confidence: e.confidence,
    evidence_ids: e.evidenceIds,
  }));

  const taskRows: TeamTaskRow[] = tasks.map((t) => ({
    id: t.id,
    run_id: run.runId,
    native_id: t.nativeId,
    title: t.title,
    description_available: t.descriptionAvailable ? 1 : 0,
    priority: t.priority,
    status: t.status,
    created_at: t.createdAt,
    started_at: t.startedAt,
    completed_at: t.completedAt,
    cancelled_at: t.cancelledAt,
    failed_at: t.failedAt,
    result_available: t.resultAvailable ? 1 : 0,
    evidence_ids: t.evidenceIds,
  }));

  const depRows: TeamTaskDependencyRow[] = taskDependencies.map((d) => ({
    id: d.id,
    run_id: run.runId,
    upstream_task_id: d.upstreamTaskId,
    downstream_task_id: d.downstreamTaskId,
    valid_from: d.validFrom,
    valid_to: d.validTo,
    confidence: d.confidence,
    evidence_ids: d.evidenceIds,
  }));

  const assignmentRows: TeamAssignmentRow[] = assignments.map((a) => ({
    id: a.id,
    run_id: run.runId,
    task_id: a.taskId,
    agent_id: a.agentId,
    assigned_at: a.assignedAt,
    unassigned_at: a.unassignedAt,
    assignment_kind: a.assignmentKind,
    evidence_ids: a.evidenceIds,
  }));

  const messageRows: TeamMessageRow[] = communications.map((c) => ({
    id: c.id,
    run_id: run.runId,
    sender_agent_id: c.senderAgentId,
    recipient_ids: c.recipientAgentIds,
    mode: c.mode,
    category: c.category,
    task_id: c.taskId,
    correlation_id: c.correlationId,
    reply_to_id: c.replyToId,
    sent_at: c.sentAt,
    received_at: c.receivedAt,
    body_available: c.bodyAvailable ? 1 : 0,
    body_chars: c.bodyChars,
    body_bytes: c.bodyBytes,
    content_hash: c.contentHash,
    evidence_ids: c.evidenceIds,
  }));

  const activityRows: TeamActivityRow[] = activities.map((a) => ({
    id: a.id,
    run_id: run.runId,
    agent_id: a.agentId,
    task_id: a.taskId,
    round_id: a.roundId,
    kind: a.kind,
    status: a.status,
    started_at: a.startedAt,
    ended_at: a.endedAt,
    native_sequence: a.nativeSequence,
    session_key: a.sessionKey,
    event_id: a.eventId,
    turn_key: a.turnKey,
    message_id: a.messageId,
    artifact_id: a.artifactId,
    tokens: a.tokenUsage,
    cost_usd: a.costUsd,
    cost_source: a.costSource,
    cost_currency: a.costCurrency,
    has_input: a.hasInput ? 1 : 0,
    has_output: a.hasOutput ? 1 : 0,
    has_raw: a.hasRaw ? 1 : 0,
    evidence_ids: a.evidenceIds,
    order_confidence: a.orderConfidence,
  }));

  const roundRows: TeamRoundRow[] = rounds.map((r) => ({
    id: r.id,
    run_id: run.runId,
    agent_id: r.agentId,
    native_id: r.nativeId,
    idx: r.index,
    segmentation_source: r.segmentationSource,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    status: r.status,
    task_ids: r.taskIds,
    output_artifact_ids: r.outputArtifactIds,
    wall_clock_ms: r.aggregates.wallClockMs,
    active_ms: r.aggregates.activeMs,
    tokens: r.aggregates.tokenUsage,
    cost_usd: r.aggregates.costUsd,
    tool_call_count: r.aggregates.toolCallCount,
    message_count: r.aggregates.messageCount,
    completeness: r.completeness,
  }));

  const artifactRows: TeamArtifactRow[] = artifacts.map((a) => ({
    id: a.id,
    run_id: run.runId,
    native_id: a.nativeId,
    name: a.name,
    kind: a.kind,
    path_redacted: a.pathRedacted,
    content_hash: a.contentHash,
    producer_agent_ids: a.producerAgentIds,
    task_ids: a.taskIds,
    created_at: a.createdAt,
    accepted_at: a.acceptedAt,
    has_content: a.hasContent ? 1 : 0,
    evidence_ids: a.evidenceIds,
  }));

  const evidenceRows: TeamEvidenceRow[] = evidenceRefs.map((e) => ({
    id: e.id,
    run_id: run.runId,
    source_kind: e.sourceKind,
    source_locator: e.sourceLocator,
    native_id: e.nativeId,
    native_sequence: e.nativeSequence,
    captured_at: e.capturedAt,
    confidence: e.confidence,
    parser_version: e.parserVersion,
  }));

  return {
    run: runRow,
    agents: agentRows,
    edges: edgeRows,
    tasks: taskRows,
    dependencies: depRows,
    assignments: assignmentRows,
    messages: messageRows,
    activities: activityRows,
    rounds: roundRows,
    artifacts: artifactRows,
    evidence: evidenceRows,
    bodies: [],
    metrics: null,
    session_ids: [...sessionIds],
    complete: true,
  };
}

/**
 * §4.15 TeamSink 的 storage 实现：包装 upsertTeamRun / deleteTeamRun。
 * 供 scanTeamSources 注入（local-sessions/team-scanner.ts TeamScanContext.sink）。
 */
export function createTeamSink(db: Database): TeamSink {
  return {
    ingestRun(evidence) {
      const ingest = evidenceToIngest(evidence);
      const result = upsertTeamRun(db, ingest);
      return { runId: result.run_id, stamp: result.stamp };
    },
    deleteRun(runId) {
      deleteTeamRun(db, runId);
    },
  };
}

// ── session → team run 反查（agent-collaboration-replay） ──────────────

/**
 * 按 session key 反查关联的 team run id 列表（agent-collaboration-replay §2.1）。
 * 利用 `team_run_sessions` junction + `idx_team_run_sessions_session` 索引
 * （database.md §4），JOIN `team_runs` 取 `started_at` 用于排序。
 *
 * 排序：`started_at DESC, id ASC`（与 listTeamRuns 一致，最近优先）。
 * 纯 id 列表，不返回 team run 详情；前端拿 id 后复用 runSnapshot / listActivities。
 *
 * 预算：< 5ms（主键 + 索引查询，nfr.md §2.3）。
 */
const SESSION_TO_RUNS_SQL = `
  SELECT tr.id, tr.started_at
  FROM team_run_sessions trs
  JOIN team_runs tr ON tr.id = trs.run_id
  WHERE trs.session_id = ?
  ORDER BY tr.started_at DESC, tr.id ASC
`;

export function getTeamRunIdsBySessionKey(db: Database, sessionKey: string): string[] {
  const rows = cachedStmt(db, SESSION_TO_RUNS_SQL).all(sessionKey) as
    Array<{ id: string; started_at: string | null }>;
  return rows.map((r) => r.id);
}
