import type { Database } from 'better-sqlite3';

import type {
  AgentOverviewRow,
  DataSource,
  ProviderKey,
  TracePhase,
} from '../../src/core/trace-types.js';
import { TRACE_PHASES } from '../../src/core/trace-types.js';
import { cachedStmt } from './stmt-cache.js';

/** #14/#15：与 src/core/metrics.ts STEP_KINDS 保持一致（errorRate 分母、verificationCoverage 分子/分母）。 */
const STEP_KINDS_SQL =
  `'llm','tool','file_read','file_write','bash','test','agent'`;

const SESSION_AGG_SQL =
  `SELECT provider, source_agent, COUNT(*) AS session_count, SUM(event_count) AS event_count, ` +
  `SUM(token_input) AS token_input, SUM(token_output) AS token_output, SUM(token_total) AS token_total, ` +
  `SUM(cost_usd) AS cost_usd, ` +
  // 未收录价格的模型 costSource='unknown'，其成本恒为 0；
  // 若一个 provider 全部会话都未定价，UI 必须显示 — 而不是 $0.000
  `SUM(CASE WHEN cost_source <> 'unknown' THEN 1 ELSE 0 END) AS priced_session_count, ` +
  `AVG(total_duration_ms) AS avg_wall_clock_ms, ` +
  `MAX(updated_at) AS latest_updated_at ` +
  `FROM sessions WHERE data_source = ? GROUP BY provider, source_agent`;

const EVENT_AGG_SQL =
  // REQ-011 口径一致：先按会话算单会话指标（verificationCoverage / enteredDebug 为 0|1，
  // errorRate 为步骤失败占比，verificationCoverage 为 verify 事件/步骤数比例，
  // avgToolDurationMs 为会话内均值），再对会话求平均。
  // fix-adapter-turn-semantics 5.9：compact 是基础设施事件，与 computeMetrics 同口径，
  // 从 avgToolDurationMs 与 errorRate（分子分母）显式排除。
  `SELECT provider, source_agent, ` +
  `AVG(error_rate) AS error_rate, AVG(verification_coverage) AS verification_coverage, ` +
  `AVG(debug_entry_rate) AS debug_entry_rate, AVG(avg_tool_duration_ms) AS avg_tool_duration_ms, ` +
  `SUM(error_count) AS error_count, SUM(event_count) AS event_count ` +
  `FROM ( ` +
  `  SELECT s.provider AS provider, s.source_agent AS source_agent, s.id AS session_id, ` +
  `    COUNT(*) AS event_count, ` +
   `    SUM(CASE WHEN e.status = 'error' AND e.kind IN (${STEP_KINDS_SQL}) THEN 1 ELSE 0 END) AS error_count, ` +
   `    SUM(CASE WHEN e.phase = 'verify' THEN 1 ELSE 0 END) * 1.0 / ` +
   `      NULLIF(SUM(CASE WHEN e.kind IN (${STEP_KINDS_SQL}) THEN 1 ELSE 0 END), 0) AS verification_coverage, ` +
   `    MAX(CASE WHEN e.phase = 'debug' THEN 1 ELSE 0 END) AS debug_entry_rate, ` +
   `    SUM(CASE WHEN e.status = 'error' AND e.kind IN (${STEP_KINDS_SQL}) THEN 1 ELSE 0 END) * 1.0 / ` +
   `      NULLIF(SUM(CASE WHEN e.kind IN (${STEP_KINDS_SQL}) THEN 1 ELSE 0 END), 0) AS error_rate, ` +
   `    COALESCE(AVG(CASE WHEN e.tool IS NOT NULL AND e.kind <> 'compact' THEN e.duration_ms END), 0) AS avg_tool_duration_ms ` +
  `  FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `  WHERE s.data_source = ? ` +
  `  GROUP BY s.provider, s.source_agent, s.id ` +
  `) GROUP BY provider, source_agent`;

/** 阶段累计耗时聚合：SUM(events.duration_ms) 按 phase 分组（口径同 PhaseRibbon）。
 * 6 列全量生成，缺失 phase 为 0；禁止用 wall-clock 代替（G4.6 不适用）。 */
const PHASE_AGG_SQL =
  `SELECT provider, source_agent, ` +
  TRACE_PHASES.map(
    (phase) => `SUM(CASE WHEN e.phase = '${phase}' THEN e.duration_ms ELSE 0 END) AS d_${phase}`,
  ).join(', ') +
  ` FROM events e JOIN sessions s ON s.id = e.session_id ` +
  ` WHERE s.data_source = ? GROUP BY s.provider, s.source_agent`;

const EMPTY_STAMP = '1970-01-01T00:00:00.000Z';

interface CachedOverview {
  stamp: string;
  rows: AgentOverviewRow[];
}

// 按 db 实例隔离：同一进程可能打开多个库（测试/多实例），
// 跨库共享 stamp 会导致脏缓存命中。
const cacheByDb = new WeakMap<Database, Map<DataSource, CachedOverview>>();

function cacheFor(db: Database): Map<DataSource, CachedOverview> {
  let map = cacheByDb.get(db);
  if (map === undefined) {
    map = new Map();
    cacheByDb.set(db, map);
  }
  return map;
}

export interface AgentOverviewResult {
  rows: AgentOverviewRow[];
  stamp: string;
  cached: boolean;
}

/**
 * REQ-009：两条 SQL（会话级 + event 级）服务端聚合。
 * stamp = MAX(sessions.updated_at)，由会话级 SQL 的组内 MAX 推导，不额外发第三条 SQL；
 * stamp 未变时直接返回缓存。
 */
export function getAgentOverview(db: Database, dataSource: DataSource): AgentOverviewResult {
  const sessionRows = cachedStmt(db, SESSION_AGG_SQL).all(dataSource) as Array<
    Record<string, unknown>
  >;
  const stamp = sessionRows.reduce<string>(
    (max, row) => {
      const ts = row.latest_updated_at as string;
      return ts > max ? ts : max;
    },
    EMPTY_STAMP,
  );

  const hit = cacheFor(db).get(dataSource);
  if (hit !== undefined && hit.stamp === stamp) {
    return { rows: hit.rows, stamp, cached: true };
  }

  const eventRows = cachedStmt(db, EVENT_AGG_SQL).all(dataSource) as Array<
    Record<string, unknown>
  >;
  const eventByGroup = new Map<string, Record<string, unknown>>();
  for (const row of eventRows) {
    eventByGroup.set(`${row.provider as string}\u0000${row.source_agent as string}`, row);
  }
  const phaseRows = cachedStmt(db, PHASE_AGG_SQL).all(dataSource) as Array<
    Record<string, unknown>
  >;
  const phaseByGroup = new Map<string, Record<TracePhase, number>>();
  for (const row of phaseRows) {
    const key = `${row.provider as string}\u0000${row.source_agent as string}`;
    const durations = {} as Record<TracePhase, number>;
    for (const phase of TRACE_PHASES) {
      durations[phase] = (row[`d_${phase}`] as number | null) ?? 0;
    }
    phaseByGroup.set(key, durations);
  }

  const rows: AgentOverviewRow[] = sessionRows.map((row) => {
    const key = `${row.provider as string}\u0000${row.source_agent as string}`;
    const ev = eventByGroup.get(key);
    const durations =
      phaseByGroup.get(key) ??
      Object.fromEntries(TRACE_PHASES.map((phase) => [phase, 0])) as Record<TracePhase, number>;
    return {
      provider: row.provider as ProviderKey,
      sourceAgent: row.source_agent as string,
      sessionCount: row.session_count as number,
      eventCount: row.event_count as number,
      tokenInput: row.token_input as number,
      tokenOutput: row.token_output as number,
      tokenTotal: row.token_total as number,
      pricedSessionCount: row.priced_session_count as number,
      costUsd: row.cost_usd as number,
      avgWallClockMs: row.avg_wall_clock_ms as number,
      latestUpdatedAt: row.latest_updated_at as string,
      avgToolDurationMs: (ev?.avg_tool_duration_ms as number | null | undefined) ?? null,
      errorRate: ev?.error_rate as number | null | undefined ?? null,
      verificationCoverage: ev?.verification_coverage as number | null | undefined ?? null,
      debugEntryRate: ev?.debug_entry_rate as number | null | undefined ?? null,
      durationByPhase: durations,
    };
  });

  cacheFor(db).set(dataSource, { stamp, rows });
  return { rows, stamp, cached: false };
}

/** 供测试与外部失效使用：清空 overview 缓存。 */
export function clearOverviewCache(db?: Database): void {
  if (db === undefined) {
    return;
  }
  cacheByDb.delete(db);
}
