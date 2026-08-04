import type { Database } from 'better-sqlite3';

import type {
  AgentOverviewRow,
  DataSource,
  ProviderKey,
} from '../../src/core/trace-types.js';
import { cachedStmt } from './stmt-cache.js';

const SESSION_AGG_SQL =
  `SELECT provider, source_agent, COUNT(*) AS session_count, SUM(event_count) AS event_count, ` +
  `SUM(token_input) AS token_input, SUM(token_output) AS token_output, SUM(token_total) AS token_total, ` +
  `SUM(cost_usd) AS cost_usd, AVG(total_duration_ms) AS avg_wall_clock_ms, ` +
  `MAX(updated_at) AS latest_updated_at ` +
  `FROM sessions WHERE data_source = ? GROUP BY provider, source_agent`;

const EVENT_AGG_SQL =
  `SELECT s.provider AS provider, s.source_agent AS source_agent, ` +
  `AVG(CASE WHEN e.tool IS NOT NULL THEN e.duration_ms END) AS avg_tool_duration_ms, ` +
  `SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS error_count, COUNT(*) AS event_count, ` +
  `SUM(CASE WHEN e.phase = 'verify' THEN 1 ELSE 0 END) AS verify_count, ` +
  `SUM(CASE WHEN e.phase = 'debug' THEN 1 ELSE 0 END) AS debug_count ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ? GROUP BY s.provider, s.source_agent`;

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

  const rows: AgentOverviewRow[] = sessionRows.map((row) => {
    const key = `${row.provider as string}\u0000${row.source_agent as string}`;
    const ev = eventByGroup.get(key);
    const eventCount = (ev?.event_count as number | undefined) ?? 0;
    const errorCount = (ev?.error_count as number | undefined) ?? 0;
    const verifyCount = (ev?.verify_count as number | undefined) ?? 0;
    const debugCount = (ev?.debug_count as number | undefined) ?? 0;
    return {
      provider: row.provider as ProviderKey,
      sourceAgent: row.source_agent as string,
      sessionCount: row.session_count as number,
      eventCount: row.event_count as number,
      tokenInput: row.token_input as number,
      tokenOutput: row.token_output as number,
      tokenTotal: row.token_total as number,
      costUsd: row.cost_usd as number,
      avgWallClockMs: row.avg_wall_clock_ms as number,
      latestUpdatedAt: row.latest_updated_at as string,
      avgToolDurationMs: (ev?.avg_tool_duration_ms as number | null | undefined) ?? null,
      errorRate: eventCount > 0 ? errorCount / eventCount : null,
      verificationCoverage: eventCount > 0 ? verifyCount / eventCount : null,
      debugEntryRate: eventCount > 0 ? debugCount / eventCount : null,
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
