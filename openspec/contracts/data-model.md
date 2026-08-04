# Contract: 数据模型

> **权威来源。** 所有 adapter、storage、API、前端组件的类型必须逐字采用本文件定义。
> 本文件与 `contracts/database.md`、`contracts/api.md` 三者互相引用，冲突时以本文件为准。
> 对应源文件：`src/core/trace-types.ts`

## 0. 通用约定

- 所有时间戳为 **ISO 8601 UTC 字符串**（`2026-08-03T02:38:49.000Z`），不用毫秒数。唯一例外见 `contracts/database.md` §5（Trae 秒级时间戳的转换发生在 adapter 内部，出了 adapter 一律 ISO）。
- 所有可选字段用 `?:`，**不用 `| undefined`**，且写库时 `undefined` 必须转 `null`。
- 所有金额单位为 USD，`number`，保留原始精度不做四舍五入。
- 所有 token 计数为 `number`，非负整数。
- 字段命名：TypeScript 侧 camelCase，SQLite 侧 snake_case，映射在 storage 层完成，不泄漏到 API。

---

## 1. 枚举（全集，不得扩展）

```ts
/** 六阶段。分类算法见 specs/metrics-analysis REQ-001。 */
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

/** 事件类型。 */
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
 * 统一状态。各 provider 的原生状态由 adapter 归一化：
 *   completed → success | paused → running | canceled → cancelled
 * 归一化表见 specs/adapters REQ-010。
 */
export type TraceStatus = 'success' | 'error' | 'running' | 'cancelled' | 'unknown';

/** 9 个 provider。新增 provider 必须同时更新此枚举、扫描器、适配器、i18n 两个 locale。 */
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

/** 数据来源。scan 与 proxy 在 UI 上分开展示（G7.4），不得混合。 */
export type DataSource = 'scan' | 'proxy';

/** 代理捕获方式。 */
export type CaptureMethod = 'mitm' | 'cdp' | 'frida';

/**
 * 详情返回档位。默认 slim。见 specs/storage REQ-006 与 contracts/nfr.md §2。
 *   slim — 仅渲染 Gantt 树所需字段，不含任何正文
 *   full — slim + inputSummary + outputSummary
 *   raw  — full + raw（仅单 event 下钻端点支持）
 */
export type EventMode = 'slim' | 'full' | 'raw';

/** 源文件类型，决定文件监视策略（chokidar vs 30s 轮询，见 G5.2）。 */
export type SourceKind = 'jsonl' | 'json' | 'sqlite' | 'sqlcipher' | 'otel';
```

---

## 2. Token 与成本

```ts
export interface TokenUsage {
  /** 提示词 token。增量语义，跨 event 求和。 */
  input: number;
  /** 生成 token。增量语义，跨 event 求和。 */
  output: number;
  /** 推理 token。增量语义，跨 event 求和（G4.4）。 */
  reasoning: number;
  /**
   * 缓存读取 token。
   * ⚠️ OpenCode / CodeArts / CodeAgent2 系为 session 级**累积值**，
   * 跨 event 聚合必须用 Math.max()，不得 sum（G4.4，最易踩坑）。
   * 其余 provider 为增量，用 sum。语义由 adapter 的 tokenSemantics 声明。
   */
  cacheRead: number;
  /** 缓存写入 token。增量语义。 */
  cacheWrite: number;
  /** total = input + output + reasoning + cacheRead（G4.5，不要漏 reasoning）。 */
  total: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0,
};

/** adapter 必须声明其 provider 的 token 聚合语义，供 storage 层正确汇总。 */
export interface TokenSemantics {
  cacheRead: 'cumulative' | 'incremental';
  reasoning: 'cumulative' | 'incremental';
}
```

---

## 3. 会话

```ts
/**
 * 会话索引条目。列表接口返回此形状，**绝不包含 systemPrompt 正文**。
 * 实测依据：524 条索引 447.8KB / 5.33ms，是可接受的；带上 systemPrompt 会失控。
 */
export interface SessionIndexEntry {
  /**
   * = deriveSessionKey(provider, sourcePath, innerId?) 的产物，
   * 见 specs/session-scanning REQ-007（索引/详情同一口径，T-02）。
   */
  id: string;
  provider: ProviderKey;
  /** provider 的展示名，可与 provider 不同（如 CodeArts SDD 子 agent）。 */
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
  /** 脱敏后的路径（home 目录已替换为 ~）。 */
  sourcePath: string;
  /** 是否已加载过详情。false 表示点开时会触发惰性扫描。 */
  detailLoaded: boolean;
  /** 合并组主键。非 null 时该条目代表一个合并组，见 specs/session-merge。 */
  mergeGroupId: string | null;
  /** systemPrompt 是否存在。正文不在此返回，需走详情接口。 */
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
  /** 由 proxy 捕获时间窗口关联而来，scan 数据本身没有（G5.4）。 */
  systemPrompt: string | null;
  dataSource: DataSource;
  sourcePath: string;
  /** wall-clock 总时长 = 末 event.startedAt − 首 event.startedAt（G4.6，不是 sum）。 */
  totalDurationMs: number;
  /** OpenCode 系子 agent 会话标记，标题匹配 /\(@.*\bsubagent\)/i（G9.3）。 */
  isSubagent: boolean;
}
```

---

## 4. 事件

```ts
/** slim 档：Gantt 树渲染所需的全部字段，不含任何正文。 */
export interface TraceEventSlim {
  id: string;
  sessionId: string;
  /** 1-based，同 session 内唯一且连续。合并后必须重排（G10.3）。 */
  sequence: number;
  kind: TraceKind;
  phase: TracePhase;
  /** 单行摘要，UI 直接展示。长度上限 200 字符，超出由 adapter 截断。 */
  title: string;
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  /** 执行者：user / assistant / subagent 名 / 工具名。 */
  actor: string;
  /** 工具名，非工具事件为 null。 */
  tool: string | null;
  tokens: TokenUsage | null;
  /** 错误摘要，上限 500 字符。完整错误在 full 档。 */
  error: string | null;
  /** 正文是否存在，供 UI 决定是否显示"展开"按钮。 */
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
}

/** full 档：slim + 正文。仅导出、报告生成、单 event 下钻使用。 */
export interface TraceEvent extends TraceEventSlim {
  inputSummary: string | null;
  outputSummary: string | null;
}

/** raw 档：仅 GET /api/sessions/:key/events/:eventId?include=raw 返回。 */
export interface TraceEventRaw extends TraceEvent {
  raw: string | null;
}
```

---

## 5. 聚合单元

```ts
/** adapter 的输出、UI 消费的完整单元。 */
export interface TraceRecord {
  session: TraceSession;
  events: TraceEvent[];
  metrics?: TraceMetrics;
  tokenSemantics: TokenSemantics;
}

/** API 返回的详情形状。events 的档位由 mode 决定。 */
export interface SessionDetailResponse {
  session: TraceSession;
  events: TraceEventSlim[] | TraceEvent[];
  mode: EventMode;
  /** 分页信息。event 数 > 2000 时启用，见 specs/storage REQ-007。 */
  eventTotal: number;
  eventOffset: number;
  eventLimit: number;
  hasMore: boolean;
  /** Trae 等需异步解密的 provider，详情尚未就绪时为 true，由 SSE 后续推送。 */
  pending: boolean;
}
```

---

## 6. 指标

```ts
/** 持久化的基础指标。见 contracts/database.md 的 metrics 表。 */
export interface TraceMetricsBase {
  totalSteps: number;
  /** 每个 phase 的累计时长，键为 TracePhase 全集，缺失阶段值为 0。 */
  durationByPhase: Record<TracePhase, number>;
  toolCallCount: number;
  verificationPresent: boolean;
  /** 算法版本。算法变更时 bump，触发重算。见 specs/metrics-analysis REQ-011。 */
  calcVersion: number;
}

/** 四维度指标。v5 起**持久化**（推翻 v4 的 G5.3 设计选择）。 */
export interface TraceDimensionMetrics {
  /** 快 */
  avgToolDurationMs: number;
  /** 准：有 verify phase 事件的比例，单会话为 0 或 1 */
  verificationCoverage: number;
  /** 稳 */
  errorRate: number;
  enteredDebug: boolean;
  /** 省 */
  tokensPerStep: number;
  costUsd: number;
}

export interface TraceMetrics extends TraceMetricsBase, TraceDimensionMetrics {}

/** 速度指标，运行时计算，不持久化。 */
export interface SpeedMetrics {
  /** 首 token 时延 (ms)。 */
  ttftMs: number | null;
  /** 每秒 token 数。 */
  tps: number | null;
  /** 每输出 token 时延 (ms)。 */
  tpotMs: number | null;
  /** 端到端 wall-clock (ms)。 */
  e2eMs: number;
  /** 相邻 turn 间隔中位数 (ms)。 */
  turnGapMedianMs: number | null;
  /**
   * ⚠️ 纯 LLM 推理时长必须取自 InferHub.inference_duration。
   * Kernel-Inference 的 duration 包含 Tool 执行时间（G4.1）。
   */
  pureInferenceMs: number | null;
}

/** Agent Overview 聚合行，由服务端 SQL 直接产出，见 specs/storage REQ-009。 */
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

## 7. 代理与 Frida

```ts
export interface ProxyRequest {
  id: number;
  /** req-{timestamp}-{counter} */
  requestId: string;
  method: string;
  url: string;
  hostname: string;
  requestHeaders: Record<string, string>;
  /** 已脱敏。原文见 rawRequestBody。列表接口不返回本字段。 */
  requestBody: string | null;
  responseStatus: number | null;
  /** 已脱敏。列表接口不返回本字段。 */
  responseBody: string | null;
  contentType: string | null;
  isStreaming: boolean;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  captureMethod: CaptureMethod;
  /** x-tt-encrypt-* 头存在时为 true。TTNet body 无法 MITM 解密（G6.2）。 */
  ttnetEncrypted: boolean;
  systemPrompt: string | null;
  /** 冗余长度列，为 getSystemPromptForSession 避免 LENGTH() 排序。 */
  systemPromptLen: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  parsedSessionId: string | null;
  parserRoute: string | null;
  /** 未脱敏原文。仅在脱敏开启时填充（G8.3）。列表接口不返回。 */
  rawRequestBody: string | null;
  rawResponseBody: string | null;
}

/** 列表接口返回形状。显式排除 4 个 body 列 + systemPrompt 正文。 */
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

## 8. 扫描状态

```ts
/**
 * 增量扫描状态。**v4 中此表为空（实测 0 行）导致每轮重扫 800MB 源文件。**
 * v5 起为必填路径，写入失败必须抛错，不得静默跳过。
 */
export interface ScanState {
  /** 主键。脱敏前的真实路径。 */
  sourcePath: string;
  provider: ProviderKey;
  sessionId: string | null;
  fileSize: number;
  fileMtimeMs: number;
  /** SHA1(size + 首 4KB + 尾 4KB)，恒定成本指纹。 */
  contentHash: string;
  /** JSONL 尾部增量读的续读位置。非 JSONL 源恒为 fileSize。 */
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

## 9. 配置

```ts
export interface ProviderConfig {
  key: ProviderKey;
  enabled: boolean;
  /** 支持 ~、~\、%VAR% 三种展开语法（G2.2）。 */
  path: string;
  sourceKind: SourceKind;
  /**
   * 监视策略。sqlite / sqlcipher 必须为 poll（WAL 模式下 chokidar 不可靠，G5.2）。
   * poll 的指纹必须同时覆盖 -wal 文件，否则仍然检测不到变更。
   */
  watchStrategy: 'chokidar' | 'poll';
  pollIntervalMs: number;
  label: string;
}

export interface LocalSessionConfig {
  providers: Record<ProviderKey, ProviderConfig>;
  /** Trae SQLCipher 密钥文件路径。 */
  traeKeyPath: string | null;
  /** 启动预热最近 N 个会话。默认 0（完全按需）。见 contracts/nfr.md §3。 */
  prewarmRecent: number;
}
```

---

## 10. 事件总线

```ts
export interface BusEvents {
  /** 单条会话新建。低频，不合并。 */
  session_created: { key: string; provider: ProviderKey };
  /**
   * ⚠️ v5 起**禁止**逐 session 发射。改用 sessions_changed 合并事件。
   * 实测：逐条发射导致前端 30s 内 508 请求 / 151.2MB。
   */
  sessions_changed: { keys: string[]; count: number };
  session_deleted: { key: string };
  scan_started: { provider: ProviderKey | 'all' };
  scan_completed: { provider: ProviderKey | 'all'; count: number };
  proxy_request: { id: number; hostname: string };
  /** proxy 异步启动/停止状态（D4：starting → running / idle），就绪由该事件通知。 */
  proxy_status: { running: boolean; starting: boolean; port?: number | null; error?: string | null };
  /** 服务端已按 100ms 窗口拼接，前端无需再节流。 */
  proxy_stream_chunk: { requestId: string; chunk: string };
  frida_capture: { id: number; model?: string; sessionId?: string };
  frida_status: { running: boolean; pid?: number };
}
```

---

## 11. 类型级验收

以下断言必须存在于 `src/core/trace-types.test.ts`，编译期即失败：

```ts
import { expectTypeOf } from 'vitest';

// 枚举全集不得遗漏
expectTypeOf<TracePhase>().toEqualTypeOf<
  'understand' | 'plan' | 'implement' | 'debug' | 'verify' | 'report'
>();

// slim 档绝不含正文字段
expectTypeOf<TraceEventSlim>().not.toHaveProperty('inputSummary');
expectTypeOf<TraceEventSlim>().not.toHaveProperty('raw');

// 索引条目绝不含 systemPrompt 正文
expectTypeOf<SessionIndexEntry>().not.toHaveProperty('systemPrompt');

// 代理列表项绝不含任何 body
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
```
