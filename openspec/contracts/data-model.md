# Contract: Data Model

> **Authoritative source.** All adapters, storage, API, and frontend component
> types must adopt this file's definitions verbatim. This file cross-references
> `contracts/database.md` and `contracts/api.md`; on conflict, this file wins.
> Corresponding source file: `src/core/trace-types.ts`

## 0. General conventions

- All timestamps are **ISO 8601 UTC strings** (`2026-08-03T02:38:49.000Z`), not
  millisecond numbers. The only exception is `contracts/database.md` §5 (Trae's
  second-level timestamps are converted inside the adapter; everything leaving
  the adapter is ISO).
- All optional fields use `?:`, **not `| undefined`**, and `undefined` must be
  converted to `null` before writing to the DB.
- All amounts are USD, `number`, preserving original precision without rounding.
- All token counts are `number`, non-negative integers.
- Field naming: camelCase on the TypeScript side, snake_case on the SQLite
  side; the mapping happens in the storage layer and never leaks to the API.

---

## 1. Enums (full set, must not be extended)

> fix-adapter-turn-semantics deliberately amended `TraceKind` exactly once,
> adding `reasoning` and `compact` (rationale below). After this amendment the
> enum is closed again; no further member may be added.

```ts
/** Six phases. Classification algorithm: specs/metrics-analysis REQ-001. */
export type TracePhase =
  | 'understand'
  | 'plan'
  | 'implement'
  | 'debug'
  | 'verify'
  | 'report';

export const TRACE_PHASES: readonly TracePhase[] = [
  'understand', 'plan', 'implement', 'debug', 'verify', 'report',
] as const;

/** Event kinds. */
export type TraceKind =
  | 'llm'
  | 'tool'
  | 'file_read'
  | 'file_write'
  | 'bash'
  | 'test'
  | 'agent'
  | 'system'
  | 'message'
  | 'user_prompt'
  | 'subagent_prompt'
  | 'reasoning'
  | 'compact';

export const TRACE_KINDS: readonly TraceKind[] = [
  'llm', 'tool', 'file_read', 'file_write', 'bash', 'test',
  'agent', 'system', 'message', 'user_prompt', 'subagent_prompt',
  'reasoning', 'compact',
] as const;

/**
 * 新增两个成员的依据（fix-adapter-turn-semantics A2）。
 * - `reasoning` — 模型思考与用户可见回复分开输出的记录。并入 `llm` 会让
 *   回合卡片无法区分「推演」与「作答」，而这是阅读轨迹时最有用的区分。
 * - `compact` — 客户端执行的上下文压缩 / 自动摘要。它既不是模型消息也不是
 *   工具；轨迹带需要它作为独立的一条 band。
 * 本 change 只新增这两个成员；其后枚举仍保持封闭，不得再扩展。
 */

/**
 * Unified status. Provider-native statuses are normalized by adapters:
 *   completed → success | paused → running | canceled → cancelled
 * Normalization table: specs/adapters REQ-010.
 */
export type TraceStatus = 'success' | 'error' | 'running' | 'cancelled' | 'unknown';

/** Session-list time-range filter (`GET /api/sessions?range=...`). */
export type SessionRange = 'today' | '7d' | '30d' | 'all';

export const SESSION_RANGES: readonly SessionRange[] = ['today', '7d', '30d', 'all'] as const;

export const TRACE_STATUSES: readonly TraceStatus[] = [
  'success', 'error', 'running', 'cancelled', 'unknown',
] as const;

/** 9 providers. Adding a provider must update this enum, the scanner, the
 * adapter, and both i18n locales at the same time. */
export type ProviderKey =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'codearts'
  | 'codeagent'
  | 'codeagent2'
  | 'trae'
  | 'qoder'
  | 'workbuddy';

export const PROVIDER_KEYS: readonly ProviderKey[] = [
  'claude', 'codex', 'opencode', 'codearts',
  'codeagent', 'codeagent2', 'trae', 'qoder', 'workbuddy',
] as const;

/** Data source. scan and proxy are shown separately in the UI (G7.4),
 * never mixed. */
export type DataSource = 'scan' | 'proxy';

/** Proxy capture method. */
export type CaptureMethod = 'mitm' | 'cdp' | 'frida';

/**
 * Detail response tier. Default slim. See specs/storage REQ-006 and
 * contracts/nfr.md §2.
 *   slim — fields needed to render the Gantt tree only, no body text
 *   full — slim + inputSummary + outputSummary
 *   raw  — full + raw (single-event drill-down endpoint only)
 */
export type EventMode = 'slim' | 'full' | 'raw';

/** Source file type; decides the watch strategy (chokidar vs 30s poll, G5.2). */
export type SourceKind = 'jsonl' | 'json' | 'sqlite' | 'sqlcipher' | 'otel';
```

### 1.1 Cost & duration provenance (add-mission-control)

```ts
/**
 * 成本来源。add-mission-control §1 P0-C：
 * - reported：厂商直接给出金额（workbuddy credit）
 * - estimated：由 pricing.ts 按 model 定价表估算
 * - unknown：模型未知或定价表无此模型 → UI 必须渲染 `—`，禁止显示 $0.0000
 */
export type CostSource = 'reported' | 'estimated' | 'unknown';

/**
 * 事件时长来源。add-mission-control §1 P0-A：
 * - measured：源数据自带真实起止（opencode OTel span / trae / workbuddy）
 * - derived：由相邻时间戳推导，**含调度间隙**，消费方必须在口径行标注
 * - unknown：既无测量也无推导
 * ⚠️ 与 G4.1 同类风险：把推导值当测量值用会系统性高估。
 */
export type DurationSource = 'measured' | 'derived' | 'unknown';

/**
 * turn key 的来源声明（fix-adapter-turn-semantics A5）。adapter 必须声明它如何
 * 产出 turn key；UI 读取它以写口径行，且**永远不得**从「key 恰好非 null」推断
 * 可信度。
 * - native_boundary：源格式显式标注了决策周期的起止
 * - stream_structure：周期由源自身 item 流的形状推导（边界真实但非显式标记）
 * - message_identity：按源自身的消息标识分组
 * - unavailable：源中无边界信号，turnKey 为 null
 */
export type TurnKeySource =
  | 'native_boundary'
  | 'stream_structure'
  | 'message_identity'
  | 'unavailable';
```

---

## 2. Tokens & cost

```ts
export interface TokenUsage {
  /** Prompt tokens. Incremental semantics; summed across events. */
  input: number;
  /** Generated tokens. Incremental semantics; summed across events. */
  output: number;
  /** Reasoning tokens. Incremental semantics; summed across events (G4.4). */
  reasoning: number;
  /**
   * Cache read tokens.
   * ⚠️ OpenCode / CodeArts / CodeAgent2 family is **incremental per step**
   * (measured calibration 2026-08-03: DeepSeek billing input =
   * SUM(input) + SUM(cache.read); three steps 6016/4000/2000 should total
   * 12016). Cross-event aggregation must use sum, never Math.max() (the old
   * G4.4 cumulative assumption has been overturned). Other providers are
   * incremental too, use sum. Semantics declared by the adapter's
   * tokenSemantics.
   */
  cacheRead: number;
  /** Cache write tokens. Incremental semantics. */
  cacheWrite: number;
  /**
   * Net input = max(0, input − cacheRead). cacheRead tokens hit the prompt
   * cache and are not billed as input; the 0 floor is real semantics (no cache
   * hit), never a stand-in for "unknown". Produced only by the session-level
   * aggregation (aggregateTokenUsage); never enters a billing formula.
   */
  netInput: number;
  /**
   * total = input + output + reasoning + cacheRead + cacheWrite.
   * ⚠️ Whether reasoning counts is declared by the adapter's
   * `reasoningInTotal` (#6, calibrated with real data 2026-08-04):
   * OpenCode's total includes reasoning (output excludes it);
   * CodeArts/DeepSeek's total excludes reasoning (reasoning is a subset of
   * output).
   */
  total: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  netInput: 0, total: 0,
};

/** Adapters must declare their provider's token aggregation semantics so the
 * storage layer aggregates correctly. */
export interface TokenSemantics {
  cacheRead: 'cumulative' | 'incremental';
  reasoning: 'cumulative' | 'incremental';
  /**
   * #6 (calibrated with real data 2026-08-04):
   * - OpenCode: tokens.total = input+output+reasoning+cache → true
   * - CodeArts/CodeAgent2 (DeepSeek): tokens.total = input+output+cache,
   *   reasoning is a subset of output → false
   * Default true (other providers usually have reasoning 0 or unverified).
   */
  reasoningInTotal?: boolean;
}
```

---

## 3. Sessions

```ts
/**
 * Session index entry. List endpoints return this shape and **never include
 * the systemPrompt body**. Measured basis: 524 index entries at 447.8KB /
 * 5.33ms is acceptable; including systemPrompt would blow up.
 */
export interface SessionIndexEntry {
  /**
   * = deriveSessionKey(provider, sourcePath, innerId?) result,
   * see specs/session-scanning REQ-007 (index/detail share one derivation, T-02).
   */
  id: string;
  provider: ProviderKey;
  /** Display name of the provider; may differ from provider
   * (e.g. CodeArts SDD subagents). */
  sourceAgent: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  status: TraceStatus;
  cwd: string | null;
  eventCount: number;
  messageCount: number;
  tokenTotal: number;
  costUsd: number;
  dataSource: DataSource;
  /** Desensitized path (home dir replaced with ~). */
  sourcePath: string;
  /** Whether detail was already loaded. false means opening triggers a lazy scan. */
  detailLoaded: boolean;
  /** Merge-group primary key. Non-null means this entry represents a merge
   * group, see specs/session-merge. */
  mergeGroupId: string | null;
  /** Whether a systemPrompt exists. Body is not returned here; use the detail
   * endpoint. */
  hasSystemPrompt: boolean;
  /** Session annotations tags (add-trajectory-inspector D14). Empty when the
   * session has no annotation row; the list query returns it via a single
   * join, never a per-row query, and never a body column. */
  tags: string[];
}

export interface TraceSession {
  id: string;
  provider: ProviderKey;
  sourceAgent: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  status: TraceStatus;
  cwd: string | null;
  messageCount: number;
  eventCount: number;
  tokenUsage: TokenUsage;
  costUsd: number;
  /** Associated from proxy captures by time window; scan data itself has none
   * (G5.4). */
  systemPrompt: string | null;
  dataSource: DataSource;
  sourcePath: string;
  /** wall-clock total duration = last event.startedAt − first event.startedAt
   * (G4.6, not a sum). */
  totalDurationMs: number;
  /** OpenCode-family subagent session flag, title matches /\(@.*\bsubagent\)/i
   * (G9.3). */
  isSubagent: boolean;
  /** Highest-token-share model of this session; null when the source data
   * has no model (add-mission-control §1 P0-B, produced by the adapter's
   * pickPrimaryModel). */
  primaryModel?: string | null;
  /** Trustworthiness of costUsd, see CostSource (add-mission-control §1
   * P0-C). */
  costSource?: CostSource;
  /** Provenance of per-event durationMs, see DurationSource
   * (add-mission-control §1 P0-A). When 'derived', every duration panel's
   * criteria line MUST state "durations derived from adjacent timestamps,
   * includes scheduling gaps". */
  durationSource?: DurationSource;
}
```

### 3.1 On-demand Prompt Context (show-trae-prompt-context)

Prompt Context is independent from `TraceSession.systemPrompt` and is returned
only by `GET /api/sessions/:key/prompt-context`.

```ts
export type PromptContextCompleteness = 'dynamic_only' | 'complete';
export type PromptContextSource = 'trae_db' | 'proxy' | 'frida';
export type PromptContextCategory =
  | 'terminal' | 'workspace_rules' | 'environment' | 'instructions'
  | 'skills' | 'language' | 'other';

export interface PromptContextSection {
  id: string;
  category: PromptContextCategory;
  title: string;
  /** Desensitized before persistence. */
  content: string;
  chars: number;
  estimatedTokens: number;
  duplicateOf: string | null;
}

export interface PromptModelConfig {
  modelName: string | null;
  configName: string | null;
  promptMaxTokens: number | null;
  maxOutputTokens: number | null;
  maxTurns: number | null;
  isPreset: boolean | null;
  locale: string | null;
  agentType: string | null;
  agentName: string | null;
  enabledFeatures: string[];
}

export interface PromptContextAnalysis {
  totalChars: number;
  estimatedTokens: number;
  sectionCount: number;
  uniqueSectionCount: number;
  duplicateSectionCount: number;
  duplicateChars: number;
  contextWindowPercent: number | null;
}

export interface SessionPromptContext {
  sessionId: string;
  provider: ProviderKey;
  source: PromptContextSource;
  completeness: PromptContextCompleteness;
  capturedAt: string;
  dynamicSections: PromptContextSection[];
  modelConfig: PromptModelConfig;
  analysis: PromptContextAnalysis;
  fullSystemPrompt: string | null;
}
```

### 3.2 Session annotations (add-trajectory-inspector)

Persisted per-session tags and a free-text note (design D13). Served by
`GET` / `PUT /api/sessions/:key/annotations` and aggregated by
`GET /api/annotations/tags` (contracts/api.md §1.7).

```ts
export interface SessionAnnotations {
  sessionKey: string;
  tags: string[];
  note: string | null;
  updatedAt: string | null;
}
export interface SessionAnnotationsUpdate {
  tags?: string[];
  note?: string | null;
}
```

| Rule | Value |
|---|---|
| `ANNOTATION_MAX_TAGS` | 32 |
| `ANNOTATION_TAG_MAX_CHARS` | 64 |
| `ANNOTATION_TAG_PATTERN` | `/^[\p{L}\p{N}_-]{1,64}$/u` |
| `ANNOTATION_NOTE_MAX_CHARS` | 8192 |

- Tags normalise: trim, lowercase, de-duplicate, sort ascending; stored as a
  JSON array.
- A violated bound returns `400 BAD_REQUEST` via the unified `ApiError`
  envelope. Silent truncation is prohibited.
- `GET` on an unannotated session returns `200` with `tags: []`, `note: null`,
  `updatedAt: null` — not `404`.
- `PUT` on an unknown key returns `404 SESSION_NOT_FOUND`.
- `PUT` replaces per present key: an absent key leaves that field untouched,
  `tags: []` clears tags, `note: null` clears the note.
- `DELETE /api/sessions/:key` cascades via the FK.

---

## 4. Events

```ts
/** slim tier: all fields needed to render the Gantt tree, no body text. */
export interface TraceEventSlim {
  id: string;
  sessionId: string;
  /** 1-based, unique and continuous within a session. Must be re-sequenced
   * after merging (G10.3). */
  sequence: number;
  /**
   * Decision-cycle identity. All events produced by one model inference and the
   * tool activity it triggered share one key. Null means the source format carries
   * no boundary signal; consumers then fall back to their own segmentation and must
   * disclose that they did. (fix-adapter-turn-semantics A3)
   *
   * Normative rules:
   * 1. `turnKey` is **opaque**. No consumer parses it, sorts by it, or derives an
   *    index from it. Turn ordering comes from `sequence`.
   * 2. `turnKey` is stable across rescans of unchanged source data.
   * 3. `turnKey` is unique within a session and MUST NOT be reused across
   *    sessions; prefix it with a session-scoped value when the source identifier
   *    is not globally unique.
   * 4. `null` is a first-class value, not an error. An adapter that cannot find a
   *    boundary signal in its real source data returns `null` for every event,
   *    and the reason is recorded in the adapter's provenance declaration.
   * 5. A tool event and the `llm` / `reasoning` events of the inference that
   *    requested it share one `turnKey`. Turn 0 material (system prompt, first
   *    user message) carries the key of the cycle it precedes, or `null` when no
   *    cycle follows.
   */
  turnKey: string | null;
  kind: TraceKind;
  phase: TracePhase;
  /** Single-line summary, shown directly in the UI. Max 200 chars; adapters
   * truncate beyond that. */
  title: string;
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  /** Actor: user / assistant / subagent name / tool name. */
  actor: string;
  /** Tool name, null for non-tool events. */
  tool: string | null;
  tokens: TokenUsage | null;
  /** Error summary, max 500 chars. Full error lives in the full tier. */
  error: string | null;
  /** Whether body text exists; lets the UI decide whether to show an
   * "expand" button. */
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
  /** Model id for llm events; null for non-llm events or when the source has
   * no model (add-mission-control §1 P0-B). */
  model?: string | null;
}

/** full tier: slim + body. Only for export, report generation, and
 * single-event drill-down. */
export interface TraceEvent extends TraceEventSlim {
  inputSummary: string | null;
  outputSummary: string | null;
}

/** raw tier: only GET /api/sessions/:key/events/:eventId?include=raw returns
 * this. */
export interface TraceEventRaw extends TraceEvent {
  raw: string | null;
}
```

### 4.1 Derived turn model (add-trajectory-inspector)

> Types copied verbatim from `specs/trace-model/spec.md` (derived turn model).
> Derivation is a pure function of the ordered event stream, the session, and
> the adapter's declared turn-key provenance; it runs in a single pass and is
> **never persisted and never computed on the server** (design D2/D3). A turn's
> tool-call identity is the member event's `id` — there is **no `toolCallId`
> field** and none is generated (deviation C7, design D5).

```ts
export type TurnSegmentationSource =
  | 'turn_key'
  | 'llm_boundary'
  | 'user_prompt_boundary'
  | 'sequence_fallback';

export type TurnKind = 'init' | 'user' | 'cycle';

export type MessageRole =
  | 'system' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'compact' | 'subagent';

export interface TurnMessage {
  eventId: string;
  sequence: number;
  role: MessageRole;
  kind: TraceKind;
  title: string;
  tool: string | null;
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  tokens: TokenUsage | null;
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
  error: string | null;
}

export type TurnBadge =
  | 'init' | 'user' | 'tools' | 'stop' | 'error' | 'subagent' | 'compact' | 'running';

export interface TraceTurn {
  index: number;
  kind: TurnKind;
  startedAt: string;
  durationMs: number;
  tokens: TokenUsage;
  model: string | null;
  messageCount: number;
  toolCount: number;
  status: TraceStatus;
  badges: TurnBadge[];
  messages: TurnMessage[];
}

export interface TurnModel {
  turns: TraceTurn[];
  segmentationSource: TurnSegmentationSource;
  complete: boolean;
  omittedEventCount: number;
}
```

---

## 5. Aggregation units

```ts
/** Adapter output; the complete unit consumed by the UI. */
export interface TraceRecord {
  session: TraceSession;
  events: TraceEvent[];
  metrics?: TraceMetrics;
  tokenSemantics: TokenSemantics;
  /**
   * turn key 的来源声明（fix-adapter-turn-semantics A5），与
   * `tokenSemantics` 并列，adapter 必须声明。
   */
  turnKeySource: TurnKeySource;
}

/** Detail shape returned by the API. The events tier is decided by mode. */
export interface SessionDetailResponse {
  session: TraceSession;
  events: TraceEventSlim[] | TraceEvent[];
  mode: EventMode;
  /** Pagination info. Enabled when event count > 2000, see
   * specs/storage REQ-007. */
  eventTotal: number;
  eventOffset: number;
  eventLimit: number;
  hasMore: boolean;
  /** true when providers requiring async decryption (e.g. Trae) don't have
   * detail ready yet; SSE pushes later. */
  pending: boolean;
}
```

### 5.1 Mission aggregation (add-mission-control)

> Mission 视图的 widget 统一信封与完整响应。每个 widget 必带服务端下发的
> `criteria` 口径行；`available=false` 时 `data` 必须为 `null` 且
> `unavailableReason` 非空，前端渲染 EmptyState —— **禁止用 0 冒充**
> （design.md §7.2，落实 frontend REQ-017/018）。

```ts
export type MissionRange = '7d' | '30d' | 'all';

/** widget 统一信封 —— 这是本设计的核心机制。 */
export interface MissionWidget<T> {
  id: string;
  /** 数据口径：表名 / 字段 / 计算方式 / 覆盖范围。服务端下发，前端不得自撰。 */
  criteria: string;
  /** false 时 data 为 null，前端渲染 EmptyState + reason，禁止渲染 0。 */
  available: boolean;
  /** available=false 时必填，如 'NO_PRICING_TABLE' / 'DURATION_NOT_MEASURED'。 */
  unavailableReason: string | null;
  data: T | null;
}

export interface NamedCount {
  name: string;
  count: number;
  /** 该项中失败的次数（工具榜用）。 */
  errorCount?: number;
}

export interface MissionToolRow {
  tool: string;
  calls: number;
  errors: number;
  /** MCP 工具（名字以 mcp__ 开头）。 */
  isMcp: boolean;
  p50Ms: number | null;
  p95Ms: number | null;
  inBytes: number;
  outBytes: number;
}

export interface MissionModelRow {
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  costSource: CostSource;
}

export interface MissionDayPoint {
  day: string;
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  errorEvents: number;
  successRate: number | null;
  /** B11 漂移专用：当日 E2E p95（wall-clock 分位数）。 */
  e2eP95Ms?: number | null;
  /** B11 漂移专用：当日工具失败数。 */
  toolFails?: number;
}

export interface MissionHourPoint {
  /** 本地时区（按 tz 偏移后）的小时桶，ISO 到小时。 */
  hour: string;
  sessions: number;
  messages: number;
}

export interface MissionUsage {
  toolTop: MissionWidget<MissionToolRow[]>;
  skillTop: MissionWidget<NamedCount[]>;
  subagent: MissionWidget<{ rows: NamedCount[]; avgPerSession: number; sessionsWithSubagent: number }>;
  /** 7×24 网格，heat[weekday][hour]，weekday 0=周一。 */
  heatmap: MissionWidget<{ grid: number[][]; peak: number }>;
  promptHabits: MissionWidget<{ n: number; p50: number; p95: number; max: number }>;
  activity: MissionWidget<MissionHourPoint[]>;
}

export interface MissionQuality {
  closure: MissionWidget<{
    successRate: number | null;
    sessions: number;
    ok: number;
    err: number;
    e2eP50Ms: number | null;
    e2eP90Ms: number | null;
    e2eP99Ms: number | null;
    turnsP50: number;
    repairSessions: number;
  }>;
  costEfficiency: MissionWidget<{
    totalUsd: number;
    perTurnUsd: number | null;
    perOkToolUsd: number | null;
    perSessionUsd: number | null;
    turns: number;
    tools: number;
    pricedSessions: number;
    unpricedSessions: number;
  }>;
  toolFailure: MissionWidget<Array<{ tool: string; rate: number; errors: number; attempts: number }>>;
  tokenTrend: MissionWidget<MissionDayPoint[]>;
  apiQuality: MissionWidget<{
    cacheHitRate: number | null;
    totalIn: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    ttftP50Ms: number | null;
    ttftP95Ms: number | null;
    proxyCalls: number;
    proxyErrorRate: number | null;
  }>;
  errorReasons: MissionWidget<NamedCount[]>;
  riskyCommands: MissionWidget<Array<{ pattern: string; hits: number; sessionId: string; preview: string }>>;
  drift: MissionWidget<MissionDayPoint[]>;
  contextPressure: MissionWidget<{
    windowSource: string;
    peakPct: number | null;
    p50Pct: number | null;
    p95Pct: number | null;
    over80Pct: number;
    over95Pct: number;
    samples: number;
    histogram: NamedCount[];
    compactions: number;
    savedTokens: number;
  }>;
  models: MissionWidget<MissionModelRow[]>;
  depth: MissionWidget<NamedCount[]>;
  /** B15 工具生态：耗时/IO 维度（P0-A 时长 + input_len/output_len 冗余列）。 */
  toolEcology: MissionWidget<MissionToolRow[]>;
  /** B7 场景分布：只返回 {scene,count,tokenSum}，正文绝不出服务端。 */
  scenes: MissionWidget<{
    total: number;
    rows: Array<{ scene: string; count: number; tokenSum: number }>;
  }>;
  /** B8 重任务场景分布：B7 + token 阈值切换。 */
  heavyScenes: MissionWidget<{
    threshold: number;
    rows: Array<{ scene: string; count: number; tokenSum: number }>;
  }>;
  parallelism: MissionWidget<{
    sessions: number;
    avgRatio: number | null;
    maxRatio: number | null;
    parallelSessions: number;
  }>;
}

export interface MissionHealth {
  collectors: MissionWidget<{
    scanStateRows: number;
    /** 0 行 = 增量扫描可能失效，前端红色告警（G11.5 正向断言）。 */
    providers: Array<{
      key: ProviderKey;
      enabled: boolean;
      sessionCount: number;
      lastScanAt: string | null;
      ready: boolean;
      blockedBy: string | null;
    }>;
    proxy: { running: boolean; starting: boolean; port: number | null };
    frida: { running: boolean; pid: number | null };
    dbSizeBytes: number;
    walSizeBytes: number;
    schemaVersion: number;
    uptimeMs: number;
  }>;
  dualChannel: MissionWidget<{
    scanSessions: number;
    proxyRequests: number;
    linkedSessions: number;
    scanOnly: number;
    proxyOnly: number;
    hints: string[];
  }>;
  calendar: MissionWidget<Array<{ day: string; sessions: number; hasError: boolean }>>;
  hotSessions: MissionWidget<Array<{
    id: string;
    title: string;
    provider: ProviderKey;
    tokenTotal: number;
    costUsd: number;
    costSource: CostSource;
  }>>;
}

/** GET /api/mission 完整响应（contracts/api.md §2.4）。 */
export interface MissionResponse {
  meta: {
    range: MissionRange;
    generatedAt: string;
    tz: number;
    widgetCount: number;
    durationMs: number;
    stamp: string;
    cached: boolean;
  };
  usage: MissionUsage;
  quality: MissionQuality;
  health: MissionHealth;
}
```

---

## 6. Metrics

```ts
/** Persisted base metrics. See the metrics table in contracts/database.md. */
export interface TraceMetricsBase {
  totalSteps: number;
  /** Cumulative duration per phase; keys are the full TracePhase set, missing
   * phases are 0. */
  durationByPhase: Record<TracePhase, number>;
  toolCallCount: number;
  verificationPresent: boolean;
  /** Algorithm version. Bump on algorithm changes to trigger recompute.
   * See specs/metrics-analysis REQ-011. */
  calcVersion: number;
}

/** Four-dimension metrics. **Persisted since v5** (overturns v4's G5.3 design
 * choice). */
export interface TraceDimensionMetrics {
  /** Speed */
  avgToolDurationMs: number;
  /** Accuracy: verify-phase event count / step event count (#15, no longer
   * always 0|1). */
  verificationCoverage: number;
  /** Stability: error step count / step event count (#14; denominator
   * excludes non-step events like user_prompt/message). */
  errorRate: number;
  enteredDebug: boolean;
  /** Cost */
  tokensPerStep: number;
  costUsd: number;
}

export interface TraceMetrics extends TraceMetricsBase, TraceDimensionMetrics {
  /** 持久化的速度指标（add-mission-control §4 B6，G11.11）：不持久化 →
   * 跨会话聚合触发 N+1（G11.9）。改算法必须 bump METRICS_CALC_VERSION（当前 3）。 */
  ttftMs?: number | null;
  e2eMs?: number;
  /** 修复循环命中（W-F-W-F-W ≥2 轮，与 session-findings repairLoop 同口径）。
   * v3：扫描时预计算（design.md §7.3 R1），Mission closure 直接读 rollup。 */
  repairLoop?: boolean;
  /**
   * v4 (calibrate-tokens-and-compare-report §4): sum of durationMs over
   * events where tool !== null.
   */
  totalToolDurationMs: number;
  /** v4: number of events with kind === 'llm'. */
  llmCallCount: number;
  /** v4: number of events with kind === 'user_prompt'. */
  userInteractionRounds: number;
  /** v4: true when an event has phase === 'verify' and its command/title
   * matches the TEST_CMD regex (npm test|vitest|jest|pytest|cargo test|go
   * test|tsc|eslint). */
  hasUnitTests: boolean;
  /**
   * v4: count of events with status === 'error' and kind in
   * {bash, test, tool, file_write, file_read, agent}. Intentionally excludes
   * llm (a model error is not a command failure) — different denominator from
   * errorRate on purpose.
   */
  failedCommandCount: number;
}

/** Speed metrics, computed at runtime, not persisted. */
export interface SpeedMetrics {
  /** Time to first token (ms). */
  ttftMs: number | null;
  /** Tokens per second. */
  tps: number | null;
  /** Time per output token (ms). */
  tpotMs: number | null;
  /** End-to-end wall-clock (ms). */
  e2eMs: number;
  /** Median gap between adjacent turns (ms). */
  turnGapMedianMs: number | null;
  /**
   * ⚠️ Pure LLM inference time must come from InferHub.inference_duration.
   * Kernel-Inference duration includes tool execution time (G4.1).
   */
  pureInferenceMs: number | null;
  /**
   * Avg model response latency (ms): mean of the difference between each
   * user_prompt and the next llm event's startedAt in time order (#12).
   * turnGapMedianMs stays as the median "gap between two user inputs".
   */
  avgLlmResponseLatencyMs: number | null;
  /**
   * Avg single-inference duration (ms) = pureInferenceMs / llmCallCount.
   * null when llmCallCount is 0 (never 0 as a stand-in).
   */
  avgLlmDurationMs: number | null;
  /**
   * Cache hit rate = cacheRead / (input + cacheRead), aggregated over
   * attributed llm-event tokens. null when the denominator is 0 (no tokens);
   * 0 is real when input > 0 and cacheRead = 0.
   */
  cacheHitRate: number | null;
  /**
   * Avg tokens per LLM call = sum of attributed llm token totals / llmCallCount.
   * null when llmCallCount is 0.
   */
  avgTokensPerCall: number | null;
  /**
   * Trae systemPrompt token estimate (chars ÷ 4). Display-only; MUST NOT enter
   * TokenUsage.input (billing semantics). null when session.systemPrompt is
   * null.
   */
  systemPromptTokensEstimate: number | null;
}

/** Agent Overview aggregation row, produced directly by server SQL,
 * see specs/storage REQ-009. */
export interface AgentOverviewRow {
  provider: ProviderKey;
  sourceAgent: string;
  sessionCount: number;
  eventCount: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  costUsd: number;
  avgWallClockMs: number;
  latestUpdatedAt: string;
  avgToolDurationMs: number | null;
  errorRate: number | null;
  verificationCoverage: number | null;
  debugEntryRate: number | null;
  /**
   * 各阶段累计耗时（SUM(events.duration_ms) 按 phase 分组，6 键全量、缺失为 0）。
   * 供 Agent Overview 堆叠 Phase 条使用；口径与单会话 PhaseRibbon 一致
   * （按事件 duration 求和，不是 wall-clock，G4.6 的 totalDuration 语义不适用）。
   */
  durationByPhase: Record<TracePhase, number>;
}
```

---

## 7. Proxy & Frida

```ts
export interface ProxyRequest {
  id: number;
  /** req-{timestamp}-{counter} */
  requestId: string;
  method: string;
  url: string;
  hostname: string;
  requestHeaders: Record<string, string>;
  /** Desensitized. Original in rawRequestBody. List endpoints do not return
   * this field. */
  requestBody: string | null;
  responseStatus: number | null;
  /** Desensitized. List endpoints do not return this field. */
  responseBody: string | null;
  contentType: string | null;
  isStreaming: boolean;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  captureMethod: CaptureMethod;
  /** true when x-tt-encrypt-* headers are present. TTNet bodies cannot be
   * MITM-decrypted (G6.2). */
  ttnetEncrypted: boolean;
  systemPrompt: string | null;
  /** Redundant length column, avoids LENGTH() sorting for
   * getSystemPromptForSession. */
  systemPromptLen: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  parsedSessionId: string | null;
  parserRoute: string | null;
  /** One opaque UUID per successful proxy run (add-request-context-diff D2).
   * Correlation evidence only; MUST NOT be presented as an agent session. */
  captureGroupId: string | null;
  /** Closed phase-1 request-format classification (add-request-context-diff
   * D3). Historical rows captured before the classification landed are
   * `unknown`. */
  requestFormat: RequestContextFormat;
  /** Un-desensitized original. Filled only when desensitization is enabled
   * (G8.3). List endpoints do not return it. */
  rawRequestBody: string | null;
  rawResponseBody: string | null;
}

/** List endpoint shape. Explicitly excludes the 4 body columns + the
 * systemPrompt body + request headers; carries only the lightweight
 * capture-group/request-format metadata. */
export type ProxyRequestListItem = Omit<
  ProxyRequest,
  'requestBody' | 'responseBody' | 'rawRequestBody' | 'rawResponseBody' | 'systemPrompt' | 'requestHeaders'
> & { hasSystemPrompt: boolean };

export interface FridaCapture {
  id: number;
  pid: number;
  capturedAt: string;
  captureType: string;
  jsonData: string;
  model: string | null;
  sessionId: string | null;
  captureSessionId: string | null;
  messageCount: number | null;
  tokens: TokenUsage | null;
}
```

### 7.1 Request-context diff (add-request-context-diff)

> Types copied verbatim from `design.md` D10 into `contracts/data-model.md`
> and `src/core/trace-types.ts`. The full nested interfaces and enum values
> below are contractual; the implementation MUST adopt them verbatim.

```ts
/** Closed phase-1 request-format set (design D3). Everything else is
 * `unknown`; there is no generic best-effort success. */
export type RequestContextFormat =
  | 'anthropic_messages'
  | 'openai_chat'
  | 'openai_responses'
  | 'unknown';

export type ContextPairingConfidence = 'exact' | 'capture_group' | 'manual';
export type ContextDiffCategory = 'system' | 'messages' | 'tools' | 'parameters';
export type ContextChangeKind = 'added' | 'removed' | 'modified';
export type ContextDiffSegmentKind = 'equal' | 'added' | 'removed';

export interface ContextCompleteness {
  complete: boolean;
  omittedCount: number;
  reasons: Array<
    | 'item_limit'
    | 'entry_limit'
    | 'inline_limit'
    | 'response_limit'
    | 'source_incomplete'
  >;
}

export interface ContextRequestRef {
  id: number;
  requestId: string;
  startedAt: string;
  hostname: string;
  model: string | null;
  captureMethod: CaptureMethod;
  parserRoute: string | null;
  requestFormat: Exclude<RequestContextFormat, 'unknown'>;
  parsedSessionId: string | null;
  captureGroupId: string | null;
  bodySha256: string;
  bodyBytes: number;
}

export interface ContextDiffSegment {
  kind: ContextDiffSegmentKind;
  text: string;
}

export interface ContextEvidenceValue {
  jsonType: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
  sha256: string;
  charLength: number;
  excerptStart: string;
  excerptEnd: string;
  truncated: boolean;
}

export interface ContextChangeEntry {
  category: ContextDiffCategory;
  kind: ContextChangeKind;
  identity: string;
  label: string;
  beforePath: string | null;
  afterPath: string | null;
  beforeIndex: number | null;
  afterIndex: number | null;
  changedPaths: string[];
  before: ContextEvidenceValue | null;
  after: ContextEvidenceValue | null;
  segments: ContextDiffSegment[] | null;
  truncatedReason: 'inline_limit' | 'response_limit' | null;
}

export interface ContextCategoryDiff {
  category: ContextDiffCategory;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  completeness: ContextCompleteness;
  entries: ContextChangeEntry[];
}

export interface ContextGrowth {
  baseChars: number;
  targetChars: number;
  deltaChars: number;
  messageDelta: number;
  toolDelta: number;
  inputTokenDelta: number | null;
  inputTokenDeltaReason: 'captured_usage' | 'usage_missing';
}

export interface ContextIndicator {
  code: 'history_shrink' | 'system_loss' | 'tool_loss' | 'source_incomplete';
  classification: 'observation' | 'suspected_compaction';
  severity: 'info' | 'warning';
  before: number | null;
  after: number | null;
  message: string;
}

export interface RequestContextDiffResponse {
  base: ContextRequestRef;
  target: ContextRequestRef;
  pairing: {
    confidence: ContextPairingConfidence;
    reason: string;
    warnings: string[];
  };
  noChange: boolean;
  growth: ContextGrowth;
  indicators: ContextIndicator[];
  categories: ContextCategoryDiff[];
  completeness: ContextCompleteness;
  generatedAt: string;
  durationMs: number;
}
```

> `unchanged` is an exact summary count. The `entries` array contains changed
> items only (added/removed/modified); unchanged evidence is not repeated in
> the response. Incomplete/truncated evidence can never return
> `noChange=true`; unknown/unavailable numbers render `—`, never `0`.

---

## 8. Scan state

```ts
/**
 * Incremental scan state. **In v4 this table was empty (measured 0 rows),
 * causing every round to rescan 800MB of sources.** Since v5 it is a
 * mandatory path; write failures must throw, never fail silently.
 */
export interface ScanState {
  /** Primary key. The real path before desensitization. */
  sourcePath: string;
  provider: ProviderKey;
  sessionId: string | null;
  fileSize: number;
  fileMtimeMs: number;
  /** SHA1(size + first 4KB + last 4KB), constant-cost fingerprint. */
  contentHash: string;
  /** Resume position for JSONL tail incremental reads. Always fileSize for
   * non-JSONL sources. */
  byteOffset: number;
  lastScanAt: string;
  eventCount: number;
}

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
  hash: string;
}
```

---

## 9. Config

```ts
export interface ProviderConfig {
  key: ProviderKey;
  enabled: boolean;
  /** Supports ~, ~\, %VAR% expansion syntaxes (G2.2). */
  path: string;
  sourceKind: SourceKind;
  /**
   * Watch strategy. sqlite / sqlcipher must be poll (chokidar unreliable in
   * WAL mode, G5.2). poll fingerprints must also cover the -wal file, or
   * changes still go undetected.
   */
  watchStrategy: 'chokidar' | 'poll';
  pollIntervalMs: number;
  label: string;
}

export interface LocalSessionConfig {
  providers: Record<ProviderKey, ProviderConfig>;
  /** Trae SQLCipher key file path. */
  traeKeyPath: string | null;
  /** Prewarm the most recent N sessions on startup. Default 0 (fully on
   * demand). See contracts/nfr.md §3. */
  prewarmRecent: number;
}
```

---

## 10. Event bus

```ts
export interface BusEvents {
  /** Single session created. Low frequency, not coalesced. */
  session_created: { key: string; provider: ProviderKey };
  /**
   * ⚠️ Since v5, **per-session emission is forbidden**. Use the
   * sessions_changed coalesced event instead. Measured: per-event emission
   * caused 508 requests / 151.2MB in 30s on the frontend.
   */
  sessions_changed: { keys: string[]; count: number };
  session_deleted: { key: string };
  scan_started: { provider: ProviderKey | 'all' };
  scan_completed: { provider: ProviderKey | 'all'; count: number };
  proxy_request: { id: number; hostname: string };
  /** Proxy async start/stop status (D4: starting → running / idle); readiness
   * is signaled by this event. */
  proxy_status: { running: boolean; starting: boolean; port?: number | null; error?: string | null };
  /** Server already concatenates on a 100ms window; frontend needs no further
   * throttling. */
  proxy_stream_chunk: { requestId: string; chunk: string };
  frida_capture: { id: number; model?: string; sessionId?: string };
  frida_status: { running: boolean; pid?: number };
}
```

---

## 11. Type-level acceptance

The following assertions must exist in `src/core/trace-types.test.ts` and fail
at compile time:

```ts
import { expectTypeOf } from 'vitest';

// The full enum set must not lose entries
expectTypeOf<TracePhase>().toEqualTypeOf<
  'understand' | 'plan' | 'implement' | 'debug' | 'verify' | 'report'
>();

// slim tier must never contain body fields
expectTypeOf<TraceEventSlim>().not.toHaveProperty('inputSummary');
expectTypeOf<TraceEventSlim>().not.toHaveProperty('raw');

// Index entries must never contain the systemPrompt body
expectTypeOf<SessionIndexEntry>().not.toHaveProperty('systemPrompt');

// Proxy list items must never contain any body
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
```

Additional exclusions added by add-request-context-diff §1.2 — the list item
must still omit every body/header/system-prompt field while carrying the two
new lightweight metadata fields:

```ts
// Proxy list items must still exclude ALL body + header + system-prompt fields
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('responseBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawRequestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('systemPrompt');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestHeaders');

// Proxy list items carry only the lightweight correlation metadata
expectTypeOf<ProxyRequestListItem>().toHaveProperty('captureGroupId');
expectTypeOf<ProxyRequestListItem>().toHaveProperty('requestFormat');

// The closed request-format enum must not gain or lose entries
expectTypeOf<RequestContextFormat>().toEqualTypeOf<
  'anthropic_messages' | 'openai_chat' | 'openai_responses' | 'unknown'
>();

// The response shape compiles verbatim from design D10
expectTypeOf<ContextPairingConfidence>().toEqualTypeOf<
  'exact' | 'capture_group' | 'manual'
>();
expectTypeOf<ContextDiffCategory>().toEqualTypeOf<
  'system' | 'messages' | 'tools' | 'parameters'
>();
expectTypeOf<ContextChangeKind>().toEqualTypeOf<
  'added' | 'removed' | 'modified'
>();
expectTypeOf<ContextDiffSegmentKind>().toEqualTypeOf<
  'equal' | 'added' | 'removed'
>();
```

Additional assertions added by fix-adapter-turn-semantics §1.7 — the two new
kinds are closed members of `TraceKind`, `turnKey` exists on the slim tier with
`null` as a valid value, and the provenance enum is closed:

```ts
// The two new kinds are first-class members
expectTypeOf<TraceKind>().toEqualTypeOf<
  'llm' | 'tool' | 'file_read' | 'file_write' | 'bash' | 'test'
  | 'agent' | 'system' | 'message' | 'user_prompt' | 'subagent_prompt'
  | 'reasoning' | 'compact'
>();

// turnKey exists and null is a valid value
expectTypeOf<Pick<TraceEventSlim, 'turnKey'>>().toEqualTypeOf<{
  turnKey: string | null;
}>();

// The provenance enum is closed
expectTypeOf<TurnKeySource>().toEqualTypeOf<
  'native_boundary' | 'stream_structure' | 'message_identity' | 'unavailable'
>();
```

Additional assertions added by add-trajectory-inspector §1.3/§1.4/§1.9 — the
derived turn enums are closed, every derived type compiles verbatim from the
trace-model delta spec, the index entry carries `tags`, and **no `toolCallId`
field exists** (identity comes from `event.id`, deviation C7 / design D5):

```ts
// The three derived turn enums are closed
expectTypeOf<TurnSegmentationSource>().toEqualTypeOf<
  'turn_key' | 'llm_boundary' | 'user_prompt_boundary' | 'sequence_fallback'
>();
expectTypeOf<TurnKind>().toEqualTypeOf<'init' | 'user' | 'cycle'>();
expectTypeOf<MessageRole>().toEqualTypeOf<
  'system' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'compact' | 'subagent'
>();
expectTypeOf<TurnBadge>().toEqualTypeOf<
  'init' | 'user' | 'tools' | 'stop' | 'error' | 'subagent' | 'compact' | 'running'
>();

// Turn identity comes from the member event id — never a toolCallId field
expectTypeOf<Pick<TurnMessage, 'eventId'>>().toEqualTypeOf<{ eventId: string }>();
expectTypeOf<TurnMessage>().not.toHaveProperty('toolCallId');
expectTypeOf<TraceTurn>().not.toHaveProperty('toolCallId');

// Turn model carries completeness explicitly
expectTypeOf<Pick<TurnModel, 'complete' | 'omittedEventCount'>>().toEqualTypeOf<{
  complete: boolean;
  omittedEventCount: number;
}>();

// Index entries carry the tags array
expectTypeOf<Pick<SessionIndexEntry, 'tags'>>().toEqualTypeOf<{ tags: string[] }>();

// Annotation shapes compile verbatim from design D13
expectTypeOf<Pick<SessionAnnotations, 'sessionKey' | 'tags' | 'note' | 'updatedAt'>>()
  .toEqualTypeOf<{
    sessionKey: string;
    tags: string[];
    note: string | null;
    updatedAt: string | null;
  }>();
expectTypeOf<SessionAnnotationsUpdate>().toHaveProperty('tags');
expectTypeOf<SessionAnnotationsUpdate>().toHaveProperty('note');
```
