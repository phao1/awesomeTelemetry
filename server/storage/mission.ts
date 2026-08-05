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

/** A1 工具调用 TOP 榜（P1，B3 填数据）。 */
function widgetToolTop(db: Database, opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['toolTop']['data']>> {
  void db;
  void opts;
  return unavailableWidget(
    'toolTop',
    'events.tool 按调用数聚合 TOP 10；errors = status=\'error\' 计数，全部失败标红；覆盖当前 dataSource 与 range 内会话',
    'NOT_IMPLEMENTED_YET',
  );
}

/** A2 Skill 调用频率（P3，B7 填数据）。 */
function widgetSkillTop(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['skillTop']['data']>> {
  return unavailableWidget(
    'skillTop',
    'events.tool IN (\'Skill\',\'SlashCommand\') 的调用计数 + input_summary 取 skill 名；砍掉 loaded 分支（REQ-006 数据边界）',
    'NOT_IMPLEMENTED_YET',
  );
}

/** A3 Subagent 分布（P1，B3 填数据）。 */
function widgetSubagent(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['subagent']['data']>> {
  return unavailableWidget(
    'subagent',
    'events.kind=\'agent\' 按 subagent_type 聚合（input_summary JSON 提取）+ avg subagent/session',
    'NOT_IMPLEMENTED_YET',
  );
}

/** A4 活跃热力图（P1，B3 填数据；tz 偏移在 SQL 里做）。 */
function widgetHeatmap(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['heatmap']['data']>> {
  return unavailableWidget(
    'heatmap',
    'sessions.started_at 按 tz 偏移后分桶到 7×24 网格（分桶前在 SQL 里偏移），格子 = 会话数',
    'NOT_IMPLEMENTED_YET',
  );
}

/** A6 Prompt 长度分布（P3，B7 填数据）。 */
function widgetPromptHabits(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['promptHabits']['data']>> {
  return unavailableWidget(
    'promptHabits',
    'user_prompt 的 input_summary 长度 p50/p95/max；必须先过 isGenuineUserPrompt 过滤注入；keep_going/negative 为关键词启发式',
    'NOT_IMPLEMENTED_YET',
  );
}

/** A7 会话活跃曲线（P1，B3 填数据）。 */
function widgetActivity(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionUsage['activity']['data']>> {
  return unavailableWidget(
    'activity',
    '每小时 COUNT(DISTINCT session_id) 柱 + SUM(message_count) 折线；tz 偏移在 SQL 里做',
    'NOT_IMPLEMENTED_YET',
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

/** B1 会话完成度（P2，B6 填数据）。 */
function widgetClosure(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['closure']['data']>> {
  return unavailableWidget(
    'closure',
    'status=\'success\' 会话占比（adapter 已归一化 completed→success）；E2E p50/p90/p99 = total_duration_ms 分位数（wall-clock，G4.6）；repair sess 复用 session-findings repairLoop 口径；⚠️ 与 Tengu tengu_sdk_result 口径不同',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B3 成本效率（P2，B6 填数据）。 */
function widgetCostEfficiency(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['costEfficiency']['data']>> {
  return unavailableWidget(
    'costEfficiency',
    'costUsd / message_count（$/turn）、costUsd / 成功 tool 数、costUsd / 会话数；cost_source=\'unknown\' 的会话从分子分母同时剔除并公示剔除数',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B4 工具失败率榜（P1，B3 填数据）。 */
function widgetToolFailure(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['toolFailure']['data']>> {
  return unavailableWidget(
    'toolFailure',
    'events.tool 分组，分母 = 总尝试，分子 = status=\'error\'（不含 permission reject）；与 Tengu 分子含 reject 的口径差异在 UI 注明',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B5 Token 日趋势（P2，B6 填数据）。 */
function widgetTokenTrend(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['tokenTrend']['data']>> {
  return unavailableWidget(
    'tokenTrend',
    '按日 SUM(token_input/output/cache_read/cache_write)；cacheRead 增量语义用 SUM 不用 MAX（G4.4）；total 含 cacheWrite；reasoning 按 adapter 的 reasoningInTotal（G4.5）',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B6 API 质量（P2，B6 填数据）。 */
function widgetApiQuality(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['apiQuality']['data']>> {
  return unavailableWidget(
    'apiQuality',
    'cacheHit = SUM(cache_read)/SUM(input+cache_read+cache_write)；TTFT p50/p95 来自 metrics.ttft_ms（持久化，非运行时重算）；proxyCalls/errorRate 仅 MITM 通道',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B9 错误归类（P3，B7 填数据）。 */
function widgetErrorReasons(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['errorReasons']['data']>> {
  return unavailableWidget(
    'errorReasons',
    'classifyErrorText(error) 归一到有限类（network/timeout/permission/shell/parse/notfound/other）；派生分类，非厂商原始错误码',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B10 高风险命令审计（P3，B7 填数据）。 */
function widgetRiskyCommands(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['riskyCommands']['data']>> {
  return unavailableWidget(
    'riskyCommands',
    'kind=\'bash\' 或 shell 类工具，正则扫 input_summary；预览走脱敏引擎 + 限长 200 字符；正则禁嵌套量词（G11.13）',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B11 性能漂移日序列（P2，B6 填数据）。 */
function widgetDrift(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['drift']['data']>> {
  return unavailableWidget(
    'drift',
    '按日聚合成功率 / E2E p95 / tool fail / $ per turn；依赖 P0-A + P0-C + ttft/e2e 持久化',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B12 上下文压力（P2，B6 填数据）。 */
function widgetContextPressure(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['contextPressure']['data']>> {
  return unavailableWidget(
    'contextPressure',
    'context ≈ input+cacheRead+cacheWrite，窗口取 pricing 表 contextWindow（禁止硬编码 200k）；压缩检测用上下文骤降 >50% 启发式；manual/auto 维度删除',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B13 模型分布 · 成本（P2，B6 填数据）。 */
function widgetModels(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['models']['data']>> {
  return unavailableWidget(
    'models',
    'events.model 分组聚合调用数/token/成本；cost 来自 pricing 表，未知模型 costSource=\'unknown\' 显示 —',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B14 任务纵深直方图（P1，B3 填数据）。 */
function widgetDepth(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['depth']['data']>> {
  return unavailableWidget(
    'depth',
    'metrics.tool_call_count 直方图，分桶 0 / 1-5 / 6-15 / 16-40 / 41+（G5.3 持久化指标的受益方）',
    'NOT_IMPLEMENTED_YET',
  );
}

/** F1-3+ 并行度（P2，B6 填数据）。 */
function widgetParallelism(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['parallelism']['data']>> {
  return unavailableWidget(
    'parallelism',
    'parallelismRatio = Σevents.duration_ms / total_duration_ms（wall-clock，分开存分开算）；>1.2 判定存在并行执行',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B15 工具生态耗时/IO（P2，B6 填数据）。 */
function widgetToolEcology(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['toolEcology']['data']>> {
  return unavailableWidget(
    'toolEcology',
    'events.tool 分组：duration p50/p95（P0-A 后）；bytes in/out 用 input_len/output_len 冗余列（禁 LENGTH() 全表扫描）；mcp__ 前缀判 MCP',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B7 场景分类（P3，B7 填数据）。 */
function widgetScenes(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['scenes']['data']>> {
  return unavailableWidget(
    'scenes',
    'scene-classifier 对 genuine user prompt 分类；端点只返回 {scene,count,tokenSum}，正文绝不出服务端；保留未分类/其它逃生舱',
    'NOT_IMPLEMENTED_YET',
  );
}

/** B8 重任务场景分布（P3，B7 填数据）。 */
function widgetHeavyScenes(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionQuality['heavyScenes']['data']>> {
  return unavailableWidget(
    'heavyScenes',
    'B7 场景分类 + token 阈值（≥10万/20万/50万）切换',
    'NOT_IMPLEMENTED_YET',
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

/** C1 采集健康（P1，B3 填数据；scan_state 0 行红色告警 = G11.5 正向断言）。 */
function widgetCollectors(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['collectors']['data']>> {
  return unavailableWidget(
    'collectors',
    '汇总 providers/proxy/frida/health 四个已有端点 + SELECT COUNT(*) FROM scan_state（0 行红色告警）+ watcher 最近扫描时间',
    'NOT_IMPLEMENTED_YET',
  );
}

/** C2 双通道覆盖（P2，B6 填数据）。 */
function widgetDualChannel(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['dualChannel']['data']>> {
  return unavailableWidget(
    'dualChannel',
    'scan ∩ proxy 计数（proxy_requests.parsed_session_id + 时间窗关联）；只对比计数不混列会话行（不违反 G7.4，D-011）',
    'NOT_IMPLEMENTED_YET',
  );
}

/** C3 任务日历（P1，B3 填数据）。 */
function widgetCalendar(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['calendar']['data']>> {
  return unavailableWidget(
    'calendar',
    '按日 COUNT(DISTINCT session_id) + MAX(status=\'error\') 标红；tz 偏移在 SQL 里做',
    'NOT_IMPLEMENTED_YET',
  );
}

/** C4 热会话（P2，B6 填数据）。 */
function widgetHotSessions(_db: Database, _opts: MissionOptions): MissionWidget<NonNullable<MissionHealth['hotSessions']['data']>> {
  return unavailableWidget(
    'hotSessions',
    'sessions 按 costUsd 排序 TOP（P0-C 后按 $；此前按 token_total）；下钻复用 #/sessions?key= hash 路由',
    'NOT_IMPLEMENTED_YET',
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
