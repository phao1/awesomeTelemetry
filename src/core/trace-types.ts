// 权威来源：openspec/contracts/data-model.md。逐字采用，不得发明字段、不得省略字段。

// ── §1 枚举（全集，不得扩展） ──────────────────────────────

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

/** 会话列表时间范围（服务端过滤，前端默认 today）。 */
export type SessionRange = 'today' | '7d' | '30d' | 'all';

export const SESSION_RANGES: readonly SessionRange[] = ['today', '7d', '30d', 'all'] as const;

export const TRACE_STATUSES: readonly TraceStatus[] = [
  'success', 'error', 'running', 'cancelled', 'unknown',
] as const;

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

// ── §2 Token 与成本 ────────────────────────────────────────

export interface TokenUsage {
  /** 提示词 token。增量语义，跨 event 求和。 */
  input: number;
  /** 生成 token。增量语义，跨 event 求和。 */
  output: number;
  /** 推理 token。增量语义，跨 event 求和（G4.4）。 */
  reasoning: number;
  /**
   * 缓存读取 token。
   * ⚠️ OpenCode / CodeArts / CodeAgent2 系为**每步增量值**（2026-08-03 实测校准：
   * DeepSeek 计费 input = SUM(input) + SUM(cache.read)，三步 6016/4000/2000 应得 12016）。
   * 跨 event 聚合必须用 sum，不得 Math.max()（旧 G4.4 的 cumulative 假设已被推翻）。
   * 其余 provider 为增量，用 sum。语义由 adapter 的 tokenSemantics 声明。
   */
  cacheRead: number;
  /** 缓存写入 token。增量语义。 */
  cacheWrite: number;
  /**
   * 净输入 = max(0, input - cacheRead)。cacheRead 是提示词命中缓存的 token，
   * 不产生计费输入；「说不清口径的 0」禁止出现，下限 0 是真实语义（真的没缓存）。
   * 仅在会话级聚合（aggregateTokenUsage）产出，不进入任何计费公式。
   */
  netInput: number;
  /**
   * total = input + output + reasoning + cacheRead + cacheWrite。
   * ⚠️ reasoning 是否计入 total 由 adapter 的 `reasoningInTotal` 声明：
   * 真实数据（2026-08-04）OpenCode 的 total 含 reasoning（output 不含）；
   * CodeArts/DeepSeek 的 total 不含 reasoning（reasoning 是 output 子集）。
   */
  total: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  netInput: 0, total: 0,
};

/** adapter 必须声明其 provider 的 token 聚合语义，供 storage 层正确汇总。 */
export interface TokenSemantics {
  cacheRead: 'cumulative' | 'incremental';
  reasoning: 'cumulative' | 'incremental';
  /**
   * #6（2026-08-04 真实数据校准）：
   * - OpenCode：tokens.total = input+output+reasoning+cache，output 不含 reasoning → true
   * - CodeArts/CodeAgent2（DeepSeek）：tokens.total = input+output+cache，reasoning 是 output 子集 → false
   * 缺省 true（其余 provider reasoning 通常为 0 或未验证）。
   */
  reasoningInTotal?: boolean;
}

/**
 * 成本来源。add-mission-control §1 P0-C：
 * - reported：厂商直接给出金额（workbuddy credit）
 * - estimated：由 pricing.ts 按 model 定价表估算
 * - unknown：模型未知或定价表无此模型 → UI 必须渲染 `—`，**禁止显示 $0.0000**
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

// ── §3 会话 ────────────────────────────────────────────────

/**
 * 会话索引条目。列表接口返回此形状，**绝不包含 systemPrompt 正文**。
 * 实测依据：524 条索引 447.8KB / 5.33ms，是可接受的；带上 systemPrompt 会失控。
 */
export interface SessionIndexEntry {
  /** = sessionKey(provider, id, sourcePath)，见 specs/session-scanning REQ-004。 */
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
  /** 该会话 token 占比最高的模型；源数据无 model 时为 null。 */
  primaryModel?: string | null;
  /** costUsd 的可信度，见 CostSource。 */
  costSource?: CostSource;
  /** 逐事件 durationMs 的来源，见 DurationSource。 */
  durationSource?: DurationSource;
}

// ── §3.1 按需 Prompt Context ──────────────────────────────

export type PromptContextCompleteness = 'dynamic_only' | 'complete';
export type PromptContextSource = 'trae_db' | 'proxy' | 'frida';
export type PromptContextCategory =
  | 'terminal'
  | 'workspace_rules'
  | 'environment'
  | 'instructions'
  | 'skills'
  | 'language'
  | 'other';

export interface PromptContextSection {
  id: string;
  category: PromptContextCategory;
  title: string;
  /** 默认脱敏规则处理后的动态正文。 */
  content: string;
  chars: number;
  estimatedTokens: number;
  /** 与此前 section 完全重复时指向首个 section.id。 */
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
  /** model_info.extra_config 中值严格为 true 的布尔开关名（白名单值形态）。 */
  enabledFeatures: string[];
}

export interface PromptContextAnalysis {
  totalChars: number;
  estimatedTokens: number;
  sectionCount: number;
  uniqueSectionCount: number;
  duplicateSectionCount: number;
  duplicateChars: number;
  /** estimatedTokens / promptMaxTokens * 100；未知窗口为 null。 */
  contextWindowPercent: number | null;
}

/** 独立按需接口返回；不得进入 session list 或普通 session detail。 */
export interface SessionPromptContext {
  sessionId: string;
  provider: ProviderKey;
  source: PromptContextSource;
  completeness: PromptContextCompleteness;
  capturedAt: string;
  dynamicSections: PromptContextSection[];
  modelConfig: PromptModelConfig;
  analysis: PromptContextAnalysis;
  /** 数据库动态上下文不能冒充完整静态 System Prompt。 */
  fullSystemPrompt: string | null;
}

// ── §4 事件 ────────────────────────────────────────────────

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
  /** llm 事件的模型标识；非 llm 事件或源数据无 model 时为 null。 */
  model?: string | null;
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

// ── §5 聚合单元 ────────────────────────────────────────────

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

// ── §6 指标 ────────────────────────────────────────────────

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

export interface TraceMetrics extends TraceMetricsBase, TraceDimensionMetrics {
  /**
   * 持久化的速度指标（add-mission-control §4 B6，G11.11）：
   * 不持久化 → 跨会话聚合触发 N+1（G11.9）。改算法必须 bump
   * METRICS_CALC_VERSION（当前 3）。
   */
  ttftMs?: number | null;
  e2eMs?: number;
  /** 修复循环命中（W-F-W-F-W ≥2 轮，与 session-findings repairLoop 同口径）。
   * v3：扫描时预计算，Mission closure 直接读，避免逐请求全表窗口扫描。 */
  repairLoop?: boolean;
  /**
   * v4（calibrate-tokens-and-compare-report §4）：工具事件（tool !== null）的
   * durationMs 求和。
   */
  totalToolDurationMs: number;
  /** v4：kind === 'llm' 的事件数。 */
  llmCallCount: number;
  /** v4：kind === 'user_prompt' 的事件数（用户交互轮次）。 */
  userInteractionRounds: number;
  /** v4：存在 phase === 'verify' 且命令/标题命中 TEST_CMD 正则的事件。 */
  hasUnitTests: boolean;
  /**
   * v4：status === 'error' 且 kind ∈ {bash, test, tool, file_write, file_read,
   * agent} 的事件数。**不含 llm**（llm 的 error 是模型报错不是命令失败），
   * 与 errorRate（分母含 llm 的 STEP_KINDS）口径不同是有意的。
   */
  failedCommandCount: number;
}

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
  /**
   * 模型响应延迟均值 (ms)：每个 user_prompt 到时间序中下一个 llm 事件 startedAt
   * 差值的均值（与主项目 turnGap 语义对齐）。turnGapMedianMs 保留为「用户两次输入
   * 间隔」中位数（用户行为分析），两者测量不同的事物。
   */
  avgLlmResponseLatencyMs: number | null;
  /**
   * 单次推理平均耗时 = pureInferenceMs / llmCallCount（分母为 0 时 null，禁止用 0 冒充）。
   */
  avgLlmDurationMs: number | null;
  /**
   * 缓存命中率 = cacheRead / (input + cacheRead)（对 llm 事件归因后的 token 聚合）。
   * 分母为 0（无任何 token）时 null；input > 0 且 cacheRead = 0 时 0 是真实值。
   */
  cacheHitRate: number | null;
  /**
   * 每次调用平均 token = 归因后 llm token total 总和 / llmCallCount（分母为 0 时 null）。
   */
  avgTokensPerCall: number | null;
  /**
   * Trae systemPrompt 的估算 token（按字符数 ÷ 4）。只作展示，**禁止进入
   * TokenUsage.input**（那是计费口径）。session.systemPrompt 为 null 时保持 null。
   */
  systemPromptTokensEstimate: number | null;
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

// ── §7 代理与 Frida ────────────────────────────────────────

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

// ── §8 扫描状态 ────────────────────────────────────────────

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

// ── §9 配置 ────────────────────────────────────────────────

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

// ── §10 事件总线 ───────────────────────────────────────────

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
  /** D4：proxy 启动/停止的异步状态通知（starting → running / idle）。 */
  proxy_status: { running: boolean; starting: boolean; port?: number | null; error?: string | null };
  /** 服务端已按 100ms 窗口拼接，前端无需再节流。 */
  proxy_stream_chunk: { requestId: string; chunk: string };
  frida_capture: { id: number; model?: string; sessionId?: string };
  frida_status: { running: boolean; pid?: number };
}

// ── §11 Mission Control（add-mission-control） ─────────────

/**
 * widget 统一信封。**这是本设计的核心机制**：一个算不出来的 widget
 * 必须说出它为什么算不出来，而不是渲染 0。
 * 落实 specs/frontend REQ-017/018「null 显示 —，禁止用 0 冒充」。
 */
export interface MissionWidget<T> {
  id: string;
  /**
   * 数据口径：表名 / 字段 / 计算方式 / 覆盖范围。
   * **服务端下发，前端不得自撰** —— 只有服务端下发才能保证 SQL 改了口径行跟着改。
   */
  criteria: string;
  /** false 时 data 为 null，前端渲染 EmptyState + reason。 */
  available: boolean;
  /** available=false 时必填，如 'NO_PRICING_TABLE' / 'DURATION_NOT_MEASURED'。 */
  unavailableReason: string | null;
  data: T | null;
}

export type MissionRange = '7d' | '30d' | 'all';

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
