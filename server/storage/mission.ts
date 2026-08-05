import { existsSync, statSync } from 'node:fs';

import type { Database } from 'better-sqlite3';

import type {
  DataSource,
  MissionHealth,
  MissionQuality,
  MissionRange,
  MissionResponse,
  MissionUsage,
  MissionWidget,
} from '../../src/core/trace-types.js';
import { extractSubagentType } from '../../src/core/subagent-type.js';
import { computeCostUsd, lookupContextWindow } from '../../src/core/pricing.js';
import { classifyErrorText } from '../../src/core/error-classifier.js';
import { classifyScene } from '../../src/core/scene-classifier.js';
import { isGenuineUserPrompt } from '../../src/core/metrics.js';
import { desensitize } from '../desensitization/engine.js';
import { SCHEMA_VERSION } from './schema.js';
import { cachedStmt } from './stmt-cache.js';

/**
 * add-mission-control §4 P0-D：Mission 聚合端点。
 *
 * 硬约束（design.md §7.3 / contracts/nfr.md §2）：
 * 1. 单 widget SQL < 30ms（tier B）；超了必须加索引或降级为日粒度 rollup，
 *    不要靠加索引硬撑（design.md §7.3 R1）。
 * 2. A / B / C 三区之间 `await setTimeout(0)` 让出一整轮事件循环，
 *    否则 better-sqlite3 同步 SQL 会把事件循环 p99 顶穿 50ms。
 * 3. stamp = MAX(sessions.updated_at)（同 overview.ts），stamp 未变直接返回
 *    缓存；复用 `cacheByDb` WeakMap 模式，不新造一套。
 * 4. 每个 widget 必带 `criteria` / `available` / `unavailableReason`；
 *    算不出来的 widget 返回 { available:false, data:null, reason }，
 *    **禁止用 0 冒充**（frontend REQ-017/018）。
 */

export interface MissionOptions {
  range: MissionRange;
  dataSource: DataSource;
  /** 本地时区偏移分钟数，A4/A7/C3 分桶前在 SQL 里偏移。 */
  tz: number;
  /** C1 采集健康的外部状态（providers/proxy/frida/health），由路由层注入。 */
  ctx?: MissionHealthContext;
}

export interface MissionHealthContext {
  providers: NonNullable<MissionHealth['collectors']['data']>['providers'];
  proxy: { running: boolean; starting: boolean; port: number | null };
  frida: { running: boolean; pid: number | null };
  dbPath?: string;
  startedAt: number;
}

const EMPTY_STAMP = '1970-01-01T00:00:00.000Z';

interface CachedMission {
  stamp: string;
  response: MissionResponse;
}

// 按 db 实例隔离（同 overview.ts）：同一进程可能打开多个库（测试/多实例）。
const cacheByDb = new WeakMap<Database, Map<string, CachedMission>>();

function cacheFor(db: Database): Map<string, CachedMission> {
  let map = cacheByDb.get(db);
  if (map === undefined) {
    map = new Map();
    cacheByDb.set(db, map);
  }
  return map;
}

function cacheKey(opts: MissionOptions): string {
  return `${opts.dataSource}:${opts.range}:${opts.tz}`;
}

/** 让出一整轮事件循环（design.md §7.3 R1）。 */
function yieldLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function unavailableWidget<T>(
  id: string,
  criteria: string,
  unavailableReason: string,
): MissionWidget<T> {
  return { id, criteria, available: false, unavailableReason, data: null };
}

export function availableWidget<T>(id: string, criteria: string, data: T): MissionWidget<T> {
  return { id, criteria, available: true, unavailableReason: null, data };
}

/** p 分位数（0-100）；输入需已升序。 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** range → started_at 过滤。cutoff 在 JS 侧算（ISO 字符串，字典序即时间序）。 */
function rangeClause(range: MissionRange): { sql: string; cutoff: string | null } {
  if (range === 'all') {
    return { sql: '', cutoff: null };
  }
  const days = range === '7d' ? 7 : 30;
  return {
    sql: ' AND started_at >= ?',
    cutoff: new Date(Date.now() - days * 86_400_000).toISOString(),
  };
}

function sessionWhere(opts: MissionOptions): { sql: string; params: unknown[] } {
  const { sql, cutoff } = rangeClause(opts.range);
  const params: unknown[] = [opts.dataSource];
  if (cutoff !== null) {
    params.push(cutoff);
  }
  return { sql: `data_source = ?${sql}`, params };
}

/** stamp = 当前过滤下的 MAX(sessions.updated_at)。 */
function missionStamp(db: Database, opts: MissionOptions): string {
  const where = sessionWhere(opts);
  const row = cachedStmt(
    db,
    `SELECT MAX(updated_at) AS stamp FROM sessions WHERE ${where.sql}`,
  ).get(...where.params) as { stamp: string | null };
  return row.stamp ?? EMPTY_STAMP;
}

function widgetCount(response: MissionResponse): number {
  return (
    Object.keys(response.usage).length +
    Object.keys(response.quality).length +
    Object.keys(response.health).length
  );
}

// ── A 区：使用行为 ──────────────────────────────────────────

const TOOL_TOP_SQL =
  `SELECT e.tool AS tool, COUNT(*) AS calls, ` +
  `SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS errors ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ? AND e.tool IS NOT NULL AND e.tool != ''{{RANGE}} ` +
  `GROUP BY e.tool ORDER BY calls DESC LIMIT 10`;

const TOOL_FAILURE_SQL =
  `SELECT e.tool AS tool, COUNT(*) AS attempts, ` +
  `SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS errors ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ? AND e.tool IS NOT NULL AND e.tool != ''{{RANGE}} ` +
  `GROUP BY e.tool ORDER BY errors * 1.0 / attempts DESC, attempts DESC LIMIT 10`;

function toolSql(sqlTemplate: string, db: Database, opts: MissionOptions): Array<Record<string, unknown>> {
  const { sql, params } = sessionWhere(opts);
  const rendered = sqlTemplate.replace('{{RANGE}}', sql.replace('data_source = ?', ''));
  const allParams: unknown[] = [opts.dataSource, ...params.slice(1)];
  return cachedStmt(db, rendered).all(...allParams) as Array<Record<string, unknown>>;
}

/** A1 工具调用 TOP 榜：全部失败（errors === calls）由前端标红。 */
function widgetToolTop(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['toolTop']['data']>> {
  const rows = toolSql(TOOL_TOP_SQL, db, opts);
  return availableWidget(
    'toolTop',
    'mission.criteria.toolTop',
    rows.map((row) => ({
      tool: row.tool as string,
      calls: row.calls as number,
      errors: row.errors as number,
      isMcp: (row.tool as string).startsWith('mcp__'),
      p50Ms: null,
      p95Ms: null,
      inBytes: 0,
      outBytes: 0,
    })),
  );
}

const SKILL_TOP_SQL =
  `SELECT e.input_summary AS input_summary ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.tool IN ('Skill','SlashCommand')`;

/** A2 Skill 调用频率：只统计调用（砍掉 loaded 分支与「近 7 天新见」标记）。 */
function widgetSkillTop(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['skillTop']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, SKILL_TOP_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ input_summary: string | null }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = skillNameFromSummary(row.input_summary);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return availableWidget(
    'skillTop',
    'mission.criteria.skillTop',
    [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  );
}

function skillNameFromSummary(inputSummary: string | null): string {
  const text = (inputSummary ?? '').trim();
  if (text === '') {
    return 'unknown';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const firstLine = text.split('\n')[0]?.trim() ?? '';
    return firstLine === '' ? 'unknown' : firstLine.slice(0, 80);
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['skill', 'name', 'title', 'tool'] as const) {
      const value = obj[key];
      if (typeof value === 'string' && value !== '') {
        return value;
      }
    }
  }
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine === '' ? 'unknown' : firstLine.slice(0, 80);
}

const SUBAGENT_SQL =
  `SELECT e.session_id AS session_id, e.input_summary AS input_summary ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ? AND e.kind = 'agent'{{RANGE}}`;

/** A3 Subagent 分布：kind='agent' 事件按 extractSubagentType(input_summary) 聚合。 */
function widgetSubagent(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['subagent']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rendered = SUBAGENT_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', ''));
  const rows = cachedStmt(db, rendered).all(opts.dataSource, ...params.slice(1)) as Array<{
    session_id: string;
    input_summary: string | null;
  }>;
  const counts = new Map<string, number>();
  const sessions = new Set<string>();
  for (const row of rows) {
    const type = extractSubagentType(row.input_summary);
    counts.set(type, (counts.get(type) ?? 0) + 1);
    sessions.add(row.session_id);
  }
  const totalSessions =
    (cachedStmt(db, `SELECT COUNT(*) AS c FROM sessions WHERE ${sql}`).get(...params) as { c: number }).c;
  return availableWidget(
    'subagent',
    'mission.criteria.subagent',
    {
      rows: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      avgPerSession: totalSessions > 0 ? sessions.size / totalSessions : 0,
      sessionsWithSubagent: sessions.size,
    },
  );
}

const HEATMAP_SQL =
  // julianday 从正午起算且 1970-01-01T00:00Z = 2440587.5：
  // minutesSinceEpoch = (JD - 2440587.5) * 1440 + tz；
  // weekday = (floor(minutes/1440) + 3) % 7（1970-01-01 周四 → days=0 → 3=周一基准）
  `SELECT (((CAST((julianday(started_at) - 2440587.5) * 1440 + ? AS INTEGER) / 1440) % 7 + 3) % 7) AS weekday, ` +
  `(CAST((julianday(started_at) - 2440587.5) * 1440 + ? AS INTEGER) / 60) % 24 AS hour, COUNT(*) AS n ` +
  `FROM sessions WHERE data_source = ?{{RANGE}} GROUP BY weekday, hour`;

/** A4 活跃热力图：⚠️ tz 偏移在 SQL 里做（分桶后无法再转换）。weekday 0=周一。 */
function widgetHeatmap(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['heatmap']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rendered = HEATMAP_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', ''));
  const rows = cachedStmt(db, rendered).all(opts.tz, opts.tz, opts.dataSource, ...params.slice(1)) as Array<{
    weekday: number;
    hour: number;
    n: number;
  }>;
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let peak = 0;
  for (const row of rows) {
    const weekday = ((row.weekday % 7) + 7) % 7;
    const hour = ((row.hour % 24) + 24) % 24;
    grid[weekday]![hour] = row.n;
    if (row.n > peak) {
      peak = row.n;
    }
  }
  return availableWidget(
    'heatmap',
    'mission.criteria.heatmap',
    { grid, peak },
  );
}

const PROMPT_LENGTH_SQL =
  `SELECT e.input_summary AS input_summary ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.kind = 'user_prompt'`;

/** A6 Prompt 长度分布：先过 isGenuineUserPrompt 过滤注入；砍掉 effort/source 维度。 */
function widgetPromptHabits(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['promptHabits']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, PROMPT_LENGTH_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ input_summary: string | null }>;
  const lengths: number[] = [];
  for (const row of rows) {
    const text = row.input_summary ?? '';
    if (!isGenuineUserPrompt(text)) {
      continue; // 过滤 <system-reminder> 等注入
    }
    lengths.push(text.length);
  }
  const sorted = lengths.slice().sort((a, b) => a - b);
  return availableWidget(
    'promptHabits',
    'mission.criteria.promptHabits',
    {
      n: sorted.length,
      p50: percentile(sorted, 50) ?? 0,
      p95: percentile(sorted, 95) ?? 0,
      max: sorted.length > 0 ? sorted.at(-1)! : 0,
    },
  );
}

const ACTIVITY_SQL =
  `SELECT substr(datetime(s.started_at, ?), 1, 13) AS hour, ` +
  `COUNT(DISTINCT s.id) AS sessions, SUM(s.message_count) AS messages ` +
  `FROM sessions s WHERE s.data_source = ?{{RANGE}} GROUP BY hour ORDER BY hour`;

/** A7 会话活跃曲线：柱 = 会话数，折线 = 消息数；tz 偏移在 SQL 里做。 */
function widgetActivity(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['activity']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rendered = ACTIVITY_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', ''));
  const rows = cachedStmt(db, rendered).all(`+${opts.tz} minutes`, opts.dataSource, ...params.slice(1)) as Array<{
    hour: string;
    sessions: number;
    messages: number;
  }>;
  return availableWidget(
    'activity',
    'mission.criteria.activity',
    rows.map((row) => ({
      hour: `${row.hour.replace(' ', 'T')}:00:00`,
      sessions: row.sessions,
      messages: row.messages,
    })),
  );
}

async function computeUsage(db: Database, opts: MissionOptions): Promise<MissionUsage> {
  return {
    toolTop: widgetToolTop(db, opts),
    skillTop: widgetSkillTop(db, opts),
    subagent: widgetSubagent(db, opts),
    heatmap: widgetHeatmap(db, opts),
    promptHabits: widgetPromptHabits(db, opts),
    activity: widgetActivity(db, opts),
  };
}

// ── B 区：效能质量 ──────────────────────────────────────────

const CLOSURE_SESSIONS_SQL =
  `SELECT total_duration_ms AS dur, message_count AS turns, status AS status ` +
  `FROM sessions WHERE data_source = ?{{RANGE}}`;

// repair_loop 已由扫描时预计算落库（metrics.repair_loop，schema v3）——
// 逐请求全表窗口扫描实测 40ms 超 §7.3 R1 预算，升级为 rollup 读取。
const CLOSURE_REPAIR_SQL =
  `SELECT COUNT(*) AS n FROM metrics m JOIN sessions s ON s.id = m.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND m.repair_loop = 1`;

/** B1 会话完成度：success 占比 + E2E 分位数 + turns p50 + repair 命中数。 */
function widgetClosure(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['closure']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, CLOSURE_SESSIONS_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ dur: number; turns: number; status: string }>;
  const repairRow = cachedStmt(db, CLOSURE_REPAIR_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .get(opts.dataSource, ...params.slice(1)) as { n: number };
  const ok = rows.filter((r) => r.status === 'success').length;
  const err = rows.filter((r) => r.status === 'error').length;
  const known = ok + err;
  // 索引阶段 total_duration_ms 为 0（详情未加载）：全 0 时 E2E 分位数返回 null，
  // 不把「未测量」冒充成 0（红线 #3）。
  const durs = rows.map((r) => r.dur).filter((d) => d > 0).sort((a, b) => a - b);
  const turns = rows.map((r) => r.turns).sort((a, b) => a - b);
  return availableWidget(
    'closure',
    'mission.criteria.closure',
    {
      successRate: known > 0 ? ok / known : null,
      sessions: rows.length,
      ok,
      err,
      e2eP50Ms: percentile(durs, 50),
      e2eP90Ms: percentile(durs, 90),
      e2eP99Ms: percentile(durs, 99),
      turnsP50: percentile(turns, 50) ?? 0,
      repairSessions: repairRow.n,
    },
  );
}

const COST_EFF_SQL =
  `SELECT s.id AS id, s.cost_source AS cost_source, s.cost_usd AS cost_usd, ` +
  `  s.message_count AS turns, ` +
  `  SUM(CASE WHEN e.tool IS NOT NULL AND e.status = 'success' THEN 1 ELSE 0 END) AS ok_tools ` +
  `FROM sessions s LEFT JOIN events e ON e.session_id = s.id ` +
  `WHERE s.data_source = ?{{RANGE}} GROUP BY s.id`;

/** B3 成本效率：unknown 成本的会话从分子分母同时剔除并公示剔除数。 */
function widgetCostEfficiency(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['costEfficiency']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, COST_EFF_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{
    id: string;
    cost_source: string;
    cost_usd: number;
    turns: number;
    ok_tools: number;
  }>;
  const priced = rows.filter((r) => r.cost_source !== 'unknown');
  const totalUsd = priced.reduce((sum, r) => sum + r.cost_usd, 0);
  const turns = priced.reduce((sum, r) => sum + r.turns, 0);
  const tools = priced.reduce((sum, r) => sum + r.ok_tools, 0);
  return availableWidget(
    'costEfficiency',
    'mission.criteria.costEfficiency',
    {
      totalUsd,
      perTurnUsd: turns > 0 ? totalUsd / turns : null,
      perOkToolUsd: tools > 0 ? totalUsd / tools : null,
      perSessionUsd: priced.length > 0 ? totalUsd / priced.length : null,
      turns,
      tools,
      pricedSessions: priced.length,
      unpricedSessions: rows.length - priced.length,
    },
  );
}

/** B4 工具失败率榜：分子只含 error，不含 permission reject。 */
function widgetToolFailure(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['toolFailure']['data']>> {
  const rows = toolSql(TOOL_FAILURE_SQL, db, opts);
  return availableWidget(
    'toolFailure',
    'mission.criteria.toolFailure',
    rows.map((row) => {
      const attempts = row.attempts as number;
      const errors = row.errors as number;
      return {
        tool: row.tool as string,
        rate: attempts > 0 ? errors / attempts : 0,
        errors,
        attempts,
      };
    }),
  );
}

const TOKEN_TREND_SQL =
  // G4.4：cacheRead 是增量语义，用 SUM 不用 MAX（2026-08-03 实测推翻旧假设）
  // G4.5：total 含 cacheWrite；reasoning 是否入 total 由 adapter 的 reasoningInTotal 决定（sessions.token_total 已含）
  `SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS sessions, ` +
  `SUM(token_input) AS input, SUM(token_output) AS output, ` +
  `SUM(token_cache_read) AS cache_read, SUM(token_cache_write) AS cache_write, ` +
  `SUM(token_total) AS total, ` +
  `SUM(CASE WHEN cost_source != 'unknown' THEN cost_usd ELSE 0 END) AS cost, ` +
  `SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_events, ` +
  `SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS success_rate ` +
  `FROM sessions WHERE data_source = ?{{RANGE}} GROUP BY day ORDER BY day`;

/** B5 Token 日趋势：按日 token 汇总（堆叠面积）。 */
function widgetTokenTrend(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['tokenTrend']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, TOKEN_TREND_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<Record<string, unknown>>;
  return availableWidget(
    'tokenTrend',
    'mission.criteria.tokenTrend',
    rows.map((row) => ({
      day: row.day as string,
      sessions: row.sessions as number,
      input: row.input as number,
      output: row.output as number,
      cacheRead: row.cache_read as number,
      cacheWrite: row.cache_write as number,
      costUsd: row.cost as number,
      errorEvents: row.error_events as number,
      successRate: row.success_rate as number | null,
    })),
  );
}

const API_CACHE_SQL =
  `SELECT SUM(token_input) AS input, SUM(token_cache_read) AS cache_read, ` +
  `SUM(token_cache_write) AS cache_write FROM sessions WHERE data_source = ?{{RANGE}}`;

const API_TTFT_SQL =
  `SELECT m.ttft_ms AS ttft_ms FROM metrics m JOIN sessions s ON s.id = m.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND m.ttft_ms IS NOT NULL ORDER BY m.ttft_ms`;

const API_PROXY_SQL =
  `SELECT COUNT(*) AS calls, ` +
  `SUM(CASE WHEN response_status >= 500 OR response_status = 429 THEN 1 ELSE 0 END) AS errors ` +
  `FROM proxy_requests`;

/** B6 API 质量：cache hit（纯 SQL）+ TTFT（metrics 持久化）+ proxy 通道计数。 */
function widgetApiQuality(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['apiQuality']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const cacheRow = cachedStmt(db, API_CACHE_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .get(opts.dataSource, ...params.slice(1)) as { input: number; cache_read: number; cache_write: number };
  const ttftRows = cachedStmt(db, API_TTFT_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ ttft_ms: number }>;
  const proxyRow = cachedStmt(db, API_PROXY_SQL).get() as { calls: number; errors: number };
  const ttfts = ttftRows.map((r) => r.ttft_ms);
  const denominator = cacheRow.input + cacheRow.cache_read + cacheRow.cache_write;
  return availableWidget(
    'apiQuality',
    'mission.criteria.apiQuality',
    {
      cacheHitRate: denominator > 0 ? cacheRow.cache_read / denominator : null,
      totalIn: cacheRow.input,
      totalCacheRead: cacheRow.cache_read,
      totalCacheWrite: cacheRow.cache_write,
      ttftP50Ms: percentile(ttfts, 50),
      ttftP95Ms: percentile(ttfts, 95),
      proxyCalls: proxyRow.calls,
      proxyErrorRate: proxyRow.calls > 0 ? proxyRow.errors / proxyRow.calls : null,
    },
  );
}

const ERROR_TEXT_SQL =
  `SELECT e.error AS error FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.error IS NOT NULL AND e.error != ''`;

/** B9 错误归类：classifyErrorText 归一到有限类。 */
function widgetErrorReasons(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['errorReasons']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, ERROR_TEXT_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ error: string }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cls = classifyErrorText(row.error);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return availableWidget(
    'errorReasons',
    'mission.criteria.errorReasons',
    [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  );
}

const RISKY_CMD_SQL =
  `SELECT e.session_id AS session_id, e.input_summary AS input_summary ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.kind = 'bash' AND e.input_summary IS NOT NULL`;

// ⚠️ 正则禁嵌套量词（G11.13）：全部为简单字面量/单层模式。
const RISKY_PATTERNS: Array<{ pattern: string; re: RegExp }> = [
  { pattern: 'rm -rf', re: /rm\s+-rf/i },
  { pattern: 'curl|sh', re: /curl[^\n]*\|\s*(ba)?sh/i },
  { pattern: 'chmod 777', re: /chmod\s+777/i },
  { pattern: 'sudo', re: /\bsudo\b/i },
  { pattern: 'git push --force', re: /git\s+push\s+(-f|--force)/i },
  { pattern: 'drop database', re: /drop\s+database/i },
  { pattern: 'format/wipe', re: /\bformat\b|\bwipe\b|\bmkfs/i },
  { pattern: 'send keys/env leak', re: /export\s+\w*key|sendkeys/i },
];

/** B10 高风险命令审计：脱敏预览限长 200 字符；只返回聚合 + 预览，不出未脱敏正文。 */
function widgetRiskyCommands(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['riskyCommands']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, RISKY_CMD_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ session_id: string; input_summary: string }>;
  const hits: Array<{ pattern: string; hits: number; sessionId: string; preview: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cmd = row.input_summary;
    for (const rule of RISKY_PATTERNS) {
      if (!rule.re.test(cmd)) {
        continue;
      }
      const key = `${rule.pattern}:${row.session_id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const preview = desensitize(cmd).replace(/\s+/g, ' ').slice(0, 200);
      hits.push({ pattern: rule.pattern, hits: 1, sessionId: row.session_id, preview });
    }
  }
  // 按 pattern 聚合，保留最新一条脱敏预览（上限 20 条，控响应预算）
  const byPattern = new Map<string, { pattern: string; hits: number; sessionId: string; preview: string }>();
  for (const hit of hits) {
    const agg = byPattern.get(hit.pattern) ?? { pattern: hit.pattern, hits: 0, sessionId: hit.sessionId, preview: hit.preview };
    agg.hits += 1;
    agg.sessionId = hit.sessionId;
    agg.preview = hit.preview;
    byPattern.set(hit.pattern, agg);
  }
  return availableWidget(
    'riskyCommands',
    'mission.criteria.riskyCommands',
    [...byPattern.values()].sort((a, b) => b.hits - a.hits).slice(0, 20),
  );
}

const DRIFT_SQL =
  `SELECT substr(s.started_at, 1, 10) AS day, s.total_duration_ms AS dur, ` +
  `s.status AS status, s.cost_usd AS cost, s.message_count AS turns, s.cost_source AS cost_source, ` +
  `SUM(CASE WHEN e.tool IS NOT NULL AND e.status = 'error' THEN 1 ELSE 0 END) AS tool_fails ` +
  `FROM sessions s LEFT JOIN events e ON e.session_id = s.id ` +
  `WHERE s.data_source = ?{{RANGE}} GROUP BY s.id ORDER BY day`;

/** B11 性能漂移日序列：按日成功率 / E2E p95 / tool fail / $ per turn。 */
function widgetDrift(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['drift']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, DRIFT_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{
    day: string;
    dur: number;
    status: string;
    cost: number;
    turns: number;
    cost_source: string;
    tool_fails: number;
  }>;
  const byDay = new Map<string, Array<typeof rows[number]>>();
  for (const row of rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  const points = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, list]) => {
      const ok = list.filter((r) => r.status === 'success').length;
      const durs = list.map((r) => r.dur).sort((a, b) => a - b);
      const priced = list.filter((r) => r.cost_source !== 'unknown');
      const cost = priced.reduce((sum, r) => sum + r.cost, 0);
      return {
        day,
        sessions: list.length,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: cost,
        errorEvents: list.filter((r) => r.status === 'error').length,
        successRate: list.length > 0 ? ok / list.length : null,
        e2eP95Ms: percentile(durs, 95),
        toolFails: list.reduce((sum, r) => sum + r.tool_fails, 0),
      };
    });
  return availableWidget(
    'drift',
    'mission.criteria.drift',
    points,
  );
}

const CONTEXT_SQL =
  `SELECT e.session_id AS session_id, e.sequence AS sequence, e.model AS model, e.tokens_json AS tokens_json ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.kind = 'llm' AND e.model IS NOT NULL AND e.tokens_json IS NOT NULL ` +
  `ORDER BY e.session_id, e.sequence`;

function contextTokens(tokensJson: string): { input: number; output: number; cacheRead: number; cacheWrite: number } | null {
  try {
    const t = JSON.parse(tokensJson) as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    if (typeof t.input !== 'number' && typeof t.cacheRead !== 'number' && typeof t.cacheWrite !== 'number') {
      return null;
    }
    return {
      input: t.input ?? 0,
      output: t.output ?? 0,
      cacheRead: t.cacheRead ?? 0,
      cacheWrite: t.cacheWrite ?? 0,
    };
  } catch {
    return null;
  }
}

/** B12 上下文压力：窗口取 pricing 表 contextWindow；压缩 = 相邻 LLM 请求上下文骤降 >50%。 */
function widgetContextPressure(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['contextPressure']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, CONTEXT_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{
    session_id: string;
    sequence: number;
    model: string;
    tokens_json: string;
  }>;
  const ratios: number[] = [];
  const histogram = new Map<string, number>();
  const bySession = new Map<string, number[]>();
  let samples = 0;
  for (const row of rows) {
    const tokens = contextTokens(row.tokens_json);
    if (tokens === null) {
      continue;
    }
    const context = tokens.input + tokens.cacheRead + tokens.cacheWrite;
    const window = lookupContextWindow(row.model);
    if (window === null || window <= 0) {
      continue;
    }
    samples += 1;
    const ratio = context / window;
    ratios.push(ratio);
    const bucket =
      ratio >= 1 ? '100%+' : ratio >= 0.9 ? '90-100%' : ratio >= 0.75 ? '75-90%' : ratio >= 0.5 ? '50-75%' : ratio >= 0.25 ? '25-50%' : '0-25%';
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    const list = bySession.get(row.session_id) ?? [];
    list.push(context);
    bySession.set(row.session_id, list);
  }
  // 压缩启发式：同一会话相邻两次 LLM 请求 context 从 X 掉到 Y 且 Y < X*0.5
  let compactions = 0;
  let savedTokens = 0;
  for (const list of bySession.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]!;
      const curr = list[i]!;
      if (curr < prev * 0.5) {
        compactions += 1;
        savedTokens += prev - curr;
      }
    }
  }
  const sorted = ratios.slice().sort((a, b) => a - b);
  return availableWidget(
    'contextPressure',
    'mission.criteria.contextPressure',
    {
      windowSource: 'pricing table (contextWindow)',
      peakPct: sorted.length > 0 ? sorted.at(-1)! * 100 : null,
      p50Pct: percentile(sorted, 50) === null ? null : percentile(sorted, 50)! * 100,
      p95Pct: percentile(sorted, 95) === null ? null : percentile(sorted, 95)! * 100,
      over80Pct: sorted.filter((r) => r >= 0.8).length,
      over95Pct: sorted.filter((r) => r >= 0.95).length,
      samples,
      histogram: [...histogram.entries()].map(([name, count]) => ({ name, count })),
      compactions,
      savedTokens,
    },
  );
}

const MODELS_SQL =
  `SELECT e.model AS model, e.tokens_json AS tokens_json ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.kind = 'llm' AND e.model IS NOT NULL AND e.model != ''`;

/** B13 模型分布 · 成本：跨厂商核心表。 */
function widgetModels(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['models']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, MODELS_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ model: string; tokens_json: string | null }>;
  const byModel = new Map<
    string,
    { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
  >();
  for (const row of rows) {
    const agg = byModel.get(row.model) ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    agg.calls += 1;
    if (row.tokens_json !== null) {
      const tokens = contextTokens(row.tokens_json);
      if (tokens !== null) {
        agg.input += tokens.input;
        agg.output += tokens.output;
        agg.cacheRead += tokens.cacheRead;
        agg.cacheWrite += tokens.cacheWrite;
      }
    }
    byModel.set(row.model, agg);
  }
  const out = [...byModel.entries()].map(([model, agg]) => {
    const cost = computeCostUsd(
      { input: agg.input, output: agg.output, reasoning: 0, cacheRead: agg.cacheRead, cacheWrite: agg.cacheWrite, total: 0 },
      model,
    );
    return {
      model,
      calls: agg.calls,
      input: agg.input,
      output: agg.output,
      cacheRead: agg.cacheRead,
      cacheWrite: agg.cacheWrite,
      costUsd: cost.costUsd,
      costSource: cost.costSource,
    };
  }).sort((a, b) => b.calls - a.calls);
  return availableWidget(
    'models',
    'mission.criteria.models',
    out,
  );
}

const DEPTH_SQL =
  `SELECT CASE WHEN m.tool_call_count = 0 THEN '0' ` +
  `WHEN m.tool_call_count <= 5 THEN '1-5' ` +
  `WHEN m.tool_call_count <= 15 THEN '6-15' ` +
  `WHEN m.tool_call_count <= 40 THEN '16-40' ` +
  `ELSE '41+' END AS bucket, COUNT(*) AS n, MIN(m.tool_call_count) AS sort_key ` +
  `FROM metrics m JOIN sessions s ON s.id = m.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} GROUP BY bucket ORDER BY sort_key`;

/** B14 任务纵深直方图：metrics.tool_call_count 分桶。 */
function widgetDepth(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['depth']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rendered = DEPTH_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', ''));
  const rows = cachedStmt(db, rendered).all(opts.dataSource, ...params.slice(1)) as Array<{
    bucket: string;
    n: number;
  }>;
  return availableWidget(
    'depth',
    'mission.criteria.depth',
    rows.map((row) => ({ name: row.bucket, count: row.n })),
  );
}

const PARALLELISM_SQL =
  `SELECT s.id AS id, s.total_duration_ms AS wall, ` +
  `SUM(e.duration_ms) AS sum_dur ` +
  `FROM sessions s JOIN events e ON e.session_id = s.id ` +
  `WHERE s.data_source = ?{{RANGE}} AND s.total_duration_ms > 0 ` +
  `GROUP BY s.id`;

/** F1-3+ 并行度：Σdurations / wallMs，>1.2 判定并行（两个数分开存分开算）。 */
function widgetParallelism(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['parallelism']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, PARALLELISM_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{ id: string; wall: number; sum_dur: number }>;
  const ratios = rows.map((r) => r.sum_dur / r.wall).filter((v) => Number.isFinite(v));
  const parallel = ratios.filter((r) => r > 1.2).length;
  return availableWidget(
    'parallelism',
    'mission.criteria.parallelism',
    {
      sessions: rows.length,
      avgRatio: ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
      maxRatio: ratios.length > 0 ? Math.max(...ratios) : null,
      parallelSessions: parallel,
    },
  );
}

const TOOL_ECOLOGY_SQL =
  `SELECT e.tool AS tool, e.duration_ms AS duration_ms, e.input_len AS input_len, e.output_len AS output_len, ` +
  `CASE WHEN e.status = 'error' THEN 1 ELSE 0 END AS is_error ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.tool IS NOT NULL AND e.tool != '' AND e.duration_ms > 0`;

/** B15 工具生态耗时/IO：p50/p95 + bytes 冗余列 + MCP 前缀。 */
function widgetToolEcology(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['toolEcology']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, TOOL_ECOLOGY_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{
    tool: string;
    duration_ms: number;
    input_len: number;
    output_len: number;
    is_error: number;
  }>;
  const byTool = new Map<string, { durs: number[]; errors: number; inBytes: number; outBytes: number }>();
  for (const row of rows) {
    const agg = byTool.get(row.tool) ?? { durs: [], errors: 0, inBytes: 0, outBytes: 0 };
    agg.durs.push(row.duration_ms);
    agg.errors += row.is_error;
    agg.inBytes += row.input_len;
    agg.outBytes += row.output_len;
    byTool.set(row.tool, agg);
  }
  const out = [...byTool.entries()]
    .map(([tool, agg]) => {
      const sorted = agg.durs.slice().sort((a, b) => a - b);
      return {
        tool,
        calls: agg.durs.length,
        errors: agg.errors,
        isMcp: tool.startsWith('mcp__'),
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        inBytes: agg.inBytes,
        outBytes: agg.outBytes,
      };
    })
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 20);
  return availableWidget(
    'toolEcology',
    'mission.criteria.toolEcology',
    out,
  );
}

const SCENE_SQL =
  `SELECT s.id AS session_id, s.token_total AS token_total, e.input_summary AS input_summary, e.sequence AS sequence ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id ` +
  `WHERE s.data_source = ?{{RANGE}} AND e.kind = 'user_prompt' AND e.input_summary IS NOT NULL ` +
  `ORDER BY s.id, e.sequence`;

interface SceneRow {
  session_id: string;
  token_total: number;
  input_summary: string;
}

function sceneRows(db: Database, opts: MissionOptions): Map<string, { scene: string; tokenTotal: number }> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, SCENE_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as SceneRow[];
  const perSession = new Map<string, { scene: string; tokenTotal: number }>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.session_id)) {
      continue; // 每个会话取第一条 genuine prompt
    }
    if (!isGenuineUserPrompt(row.input_summary)) {
      continue;
    }
    seen.add(row.session_id);
    perSession.set(row.session_id, { scene: classifyScene(row.input_summary), tokenTotal: row.token_total });
  }
  return perSession;
}

/** B7 场景分布：端点只返回 {scene,count,tokenSum}，正文绝不出服务端。 */
function widgetScenes(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['scenes']['data']>> {
  const perSession = sceneRows(db, opts);
  const agg = new Map<string, { count: number; tokenSum: number }>();
  for (const { scene, tokenTotal } of perSession.values()) {
    const entry = agg.get(scene) ?? { count: 0, tokenSum: 0 };
    entry.count += 1;
    entry.tokenSum += tokenTotal;
    agg.set(scene, entry);
  }
  return availableWidget(
    'scenes',
    'mission.criteria.scenes',
    {
      total: perSession.size,
      rows: [...agg.entries()]
        .map(([scene, entry]) => ({ scene, count: entry.count, tokenSum: entry.tokenSum }))
        .sort((a, b) => b.count - a.count),
    },
  );
}

/** B8 重任务场景分布：B7 + token 阈值（默认 ≥10 万）。 */
function widgetHeavyScenes(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['heavyScenes']['data']>> {
  const threshold = 100_000;
  const perSession = sceneRows(db, opts);
  const agg = new Map<string, { count: number; tokenSum: number }>();
  for (const { scene, tokenTotal } of perSession.values()) {
    if (tokenTotal < threshold) {
      continue;
    }
    const entry = agg.get(scene) ?? { count: 0, tokenSum: 0 };
    entry.count += 1;
    entry.tokenSum += tokenTotal;
    agg.set(scene, entry);
  }
  return availableWidget(
    'heavyScenes',
    'mission.criteria.heavyScenes',
    {
      threshold,
      rows: [...agg.entries()]
        .map(([scene, entry]) => ({ scene, count: entry.count, tokenSum: entry.tokenSum }))
        .sort((a, b) => b.count - a.count),
    },
  );
}

async function computeQuality(db: Database, opts: MissionOptions): Promise<MissionQuality> {
  return {
    closure: widgetClosure(db, opts),
    costEfficiency: widgetCostEfficiency(db, opts),
    toolFailure: widgetToolFailure(db, opts),
    tokenTrend: widgetTokenTrend(db, opts),
    apiQuality: widgetApiQuality(db, opts),
    errorReasons: widgetErrorReasons(db, opts),
    riskyCommands: widgetRiskyCommands(db, opts),
    drift: widgetDrift(db, opts),
    contextPressure: widgetContextPressure(db, opts),
    models: widgetModels(db, opts),
    depth: widgetDepth(db, opts),
    parallelism: widgetParallelism(db, opts),
    toolEcology: widgetToolEcology(db, opts),
    scenes: widgetScenes(db, opts),
    heavyScenes: widgetHeavyScenes(db, opts),
  };
}

// ── C 区：采集健康 ──────────────────────────────────────────

const SCAN_STATE_COUNT_SQL = 'SELECT COUNT(*) AS c FROM scan_state';

/** C1 采集健康：providers/proxy/frida/health + scan_state 正向断言（0 行红色告警，G11.5）。 */
function widgetCollectors(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['collectors']['data']>> {
  const scanStateRows = (cachedStmt(db, SCAN_STATE_COUNT_SQL).get() as { c: number }).c;
  const ctx = opts.ctx;
  if (ctx === undefined) {
    return unavailableWidget(
      'collectors',
      'mission.criteria.collectors',
      'HEALTH_CONTEXT_MISSING',
    );
  }
  const dbPath = ctx.dbPath ?? '';
  return availableWidget(
    'collectors',
    'mission.criteria.collectors',
    {
      scanStateRows,
      providers: ctx.providers,
      proxy: ctx.proxy,
      frida: ctx.frida,
      dbSizeBytes: dbPath !== '' && existsSync(dbPath) ? statSync(dbPath).size : 0,
      walSizeBytes:
        dbPath !== '' && existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0,
      schemaVersion: SCHEMA_VERSION,
      uptimeMs: Date.now() - ctx.startedAt,
    },
  );
}

/** C2 双通道覆盖（P2，B6 填数据）。 */
const DUAL_CHANNEL_SQL =
  `SELECT ` +
  `(SELECT COUNT(*) FROM sessions WHERE data_source = 'scan') AS scan_sessions, ` +
  `(SELECT COUNT(*) FROM proxy_requests) AS proxy_requests, ` +
  `(SELECT COUNT(*) FROM sessions s WHERE s.data_source = 'scan' AND EXISTS ` +
  `  (SELECT 1 FROM proxy_requests p WHERE p.parsed_session_id = s.id)) AS linked_sessions, ` +
  `(SELECT COUNT(DISTINCT p.parsed_session_id) FROM proxy_requests p ` +
  `  WHERE p.parsed_session_id IS NOT NULL AND NOT EXISTS ` +
  `  (SELECT 1 FROM sessions s WHERE s.id = p.parsed_session_id)) AS proxy_only`;

/** C2 双通道覆盖：scan ∩ proxy 计数 + 成因提示 tag；只对比计数，不混列会话行（D-011）。 */
function widgetDualChannel(db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['dualChannel']['data']>> {
  const row = cachedStmt(db, DUAL_CHANNEL_SQL).get() as {
    scan_sessions: number;
    proxy_requests: number;
    linked_sessions: number;
    proxy_only: number;
  };
  const scanOnly = row.scan_sessions - row.linked_sessions;
  const hints: string[] = [];
  if (scanOnly > 0) {
    hints.push('仅 scan × N —— 检查 MITM 是否在跑 / CA 证书是否已信任');
  }
  if (row.proxy_only > 0) {
    hints.push('仅 proxy × N —— 检查该 provider 是否 enabled / 路径是否配对');
  }
  return availableWidget(
    'dualChannel',
    'mission.criteria.dualChannel',
    {
      scanSessions: row.scan_sessions,
      proxyRequests: row.proxy_requests,
      linkedSessions: row.linked_sessions,
      scanOnly,
      proxyOnly: row.proxy_only,
      hints,
    },
  );
}

const CALENDAR_SQL =
  `SELECT substr(datetime(s.started_at, ?), 1, 10) AS day, ` +
  `COUNT(DISTINCT s.id) AS sessions, ` +
  `MAX(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS has_error ` +
  `FROM sessions s WHERE s.data_source = ?{{RANGE}} GROUP BY day ORDER BY day`;

/** C3 任务日历：按日会话数 + 有错标红；tz 偏移在 SQL 里做。 */
function widgetCalendar(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['calendar']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rendered = CALENDAR_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', ''));
  const rows = cachedStmt(db, rendered).all(`+${opts.tz} minutes`, opts.dataSource, ...params.slice(1)) as Array<{
    day: string;
    sessions: number;
    has_error: number;
  }>;
  return availableWidget(
    'calendar',
    'mission.criteria.calendar',
    rows.map((row) => ({
      day: row.day,
      sessions: row.sessions,
      hasError: row.has_error === 1,
    })),
  );
}

/** C4 热会话（P2，B6 填数据）。 */
const HOT_SESSIONS_SQL =
  `SELECT id, title, provider, token_total, cost_usd, cost_source ` +
  `FROM sessions WHERE data_source = ?{{RANGE}} ` +
  `ORDER BY cost_usd DESC, token_total DESC LIMIT 10`;

/** C4 热会话：按 $ 排序 TOP 10（P0-C 后按 $；下钻复用 #/sessions?key=）。 */
function widgetHotSessions(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['hotSessions']['data']>> {
  const { sql, params } = sessionWhere(opts);
  const rows = cachedStmt(db, HOT_SESSIONS_SQL.replace('{{RANGE}}', sql.replace('data_source = ?', '')))
    .all(opts.dataSource, ...params.slice(1)) as Array<{
    id: string;
    title: string;
    provider: string;
    token_total: number;
    cost_usd: number;
    cost_source: string;
  }>;
  return availableWidget(
    'hotSessions',
    'mission.criteria.hotSessions',
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      provider: row.provider as NonNullable<MissionHealth['hotSessions']['data']>[number]['provider'],
      tokenTotal: row.token_total,
      costUsd: row.cost_usd,
      costSource: row.cost_source as NonNullable<MissionHealth['hotSessions']['data']>[number]['costSource'],
    })),
  );
}

async function computeHealth(db: Database, opts: MissionOptions): Promise<MissionHealth> {
  return {
    collectors: widgetCollectors(db, opts),
    dualChannel: widgetDualChannel(db, opts),
    calendar: widgetCalendar(db, opts),
    hotSessions: widgetHotSessions(db, opts),
  };
}

/**
 * §4 P0-D：Mission 聚合入口。
 * stamp 未变 → 直接返回缓存（cached:true）；否则按 A→B→C 计算，
 * 区之间 await setTimeout(0) 让出事件循环。
 */
export async function getMission(db: Database, opts: MissionOptions): Promise<MissionResponse> {
  const stamp = missionStamp(db, opts);
  const key = cacheKey(opts);
  const hit = cacheFor(db).get(key);
  if (hit !== undefined && hit.stamp === stamp) {
    return {
      ...hit.response,
      meta: { ...hit.response.meta, cached: true, durationMs: 0 },
    };
  }

  const started = performance.now();
  const usage = await computeUsage(db, opts);
  await yieldLoop(); // A → B
  const quality = await computeQuality(db, opts);
  await yieldLoop(); // B → C
  const health = await computeHealth(db, opts);
  const response: MissionResponse = {
    meta: {
      range: opts.range,
      generatedAt: new Date().toISOString(),
      tz: opts.tz,
      widgetCount: 0,
      durationMs: Math.round(performance.now() - started),
      stamp,
      cached: false,
    },
    usage,
    quality,
    health,
  };
  response.meta.widgetCount = widgetCount(response);
  cacheFor(db).set(key, { stamp, response });
  return response;
}

/** 供测试与外部失效使用：清空 mission 缓存。 */
export function clearMissionCache(db?: Database): void {
  if (db === undefined) {
    return;
  }
  cacheByDb.delete(db);
}
