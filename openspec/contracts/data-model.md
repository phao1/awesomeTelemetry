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
  | 'subagent_prompt';

export const TRACE_KINDS: readonly TraceKind[] = [
  'llm', 'tool', 'file_read', 'file_write', 'bash', 'test',
  'agent', 'system', 'message', 'user_prompt', 'subagent_prompt',
] as const;

/**
 * Unified status. Provider-native statuses are normalized by adapters:
 *   completed → success | paused → running | canceled → cancelled
 * Normalization table: specs/adapters REQ-010.
 */
export type TraceStatus = 'success' | 'error' | 'running' | 'cancelled' | 'unknown';

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
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0,
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

---

## 5. Aggregation units

```ts
/** Adapter output; the complete unit consumed by the UI. */
export interface TraceRecord {
  session: TraceSession;
  events: TraceEvent[];
  metrics?: TraceMetrics;
  tokenSemantics: TokenSemantics;
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
    providers: Array<{
      key: ProviderKey;
      enabled: boolean;
      sessionCount: number;
      lastScanAt: string | null;
      ready: boolean;
      blockedBy: string | null;
    }>;
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

export interface TraceMetrics extends TraceMetricsBase, TraceDimensionMetrics {}

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
  /** Un-desensitized original. Filled only when desensitization is enabled
   * (G8.3). List endpoints do not return it. */
  rawRequestBody: string | null;
  rawResponseBody: string | null;
}

/** List endpoint shape. Explicitly excludes the 4 body columns + the
 * systemPrompt body. */
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
