import type { ProviderKey, TraceEventSlim, TraceLogSession, TraceLogTurn, TraceStatus } from './trace-types.js';

/** Task identity is a read projection; native IDs and evidence remain unchanged. */
export type TaskOrigin = 'collected' | 'imported';
export interface TaskSummary {
  /** Genuine root request boundaries; null when details are unavailable. */
  requestCount?: number | null;
  requestId?: string;
  id: string;
  origin: TaskOrigin;
  provenanceKnown: boolean;
  rootSessionKey: string | null;
  runId: string | null;
  title: string;
  provider: string;
  startedAt: string | null;
  updatedAt: string;
  recordedStatus: string;
  memberCount: number;
  eventCount: number;
  loadedMemberCount: number;
  metrics?: TaskMetrics;
  latestHealth?: TaskHealthSummary | null;
  alerts?: TaskAlert[];
}
export interface TaskMember {
  id: string;
  name: string;
  role: string;
  sessionKey: string | null;
  parentId: string | null;
  detailLoaded: boolean;
  eventCount: number;
}
export type TaskMetricKey = 'input' | 'output' | 'cacheRead' | 'correctedTotal' | 'promptInput' | 'cacheHitRate' | 'models';
export interface TaskMetricCoverage {
  known: number;
  total: number;
  missing: Array<{ memberId: string; name: string; reason: 'session_unavailable' | 'detail_not_loaded' | 'not_reported' | 'accounting_unknown' }>;
}
export interface TaskMetrics {
  durationMs: number | null;
  toolCalls: number | null;
  errors: number | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  correctedTotal: number | null;
  promptInput: number | null;
  cacheHitRate: number | null;
  models: string[];
  toolResults?: number | null;
  toolFailures?: number | null;
  contextPressurePct?: number | null;
  coverage?: Record<TaskMetricKey, TaskMetricCoverage>;
}
export interface TaskContext {
  task: TaskSummary;
  members: TaskMember[];
  metrics?: TaskMetrics;
  importSession: TraceLogSession | null;
  warnings: string[];
}
export interface TaskPage {
  items: TaskSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
export interface TaskRecord {
  id: string;
  memberId: string;
  memberName: string;
  sessionKey: string | null;
  event: TraceEventSlim | null;
  importedTurn: TraceLogTurn | null;
  toolInputPreview?: string;
}
export interface TaskRecordPage {
  context: TaskContext;
  items: TaskRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  hasPrevious: boolean;
  /** Session sequence ceilings make subsequent pages independent of live appends. */
  window: string;
  warnings: string[];
  /** Optional indexed native facts; semantic grouping remains client-only. */
  structure?: TaskStructure;
}
export type TaskSort = 'activity' | 'time' | 'duration' | 'errors' | 'tokens' | 'cacheHitRate';
export interface TaskListQuery { failed?: boolean; toolFailures?: boolean; summary?: boolean; sort?: TaskSort; direction?: 'asc' | 'desc'; alerts?: boolean; errors?: boolean; origin?: TaskOrigin; q?: string; provider?: ProviderKey; range?: 'today' | '7d' | '30d' | 'all'; offset?: number; limit?: number }
export interface TaskRecordQuery { request?: string; member?: string; q?: string; status?: TraceStatus; offset?: number; limit?: number; window?: string; anchor?: string; from?: string; to?: string; structure?: boolean }

/** A retained, scoped identity, never an ID inferred from a title or timestamp. */
export interface TaskNativeRef { namespace: string; kind: 'turn' | 'request' | 'response' | 'tool_call'; value: string; scope: string }
export interface TaskRecordStructure {
  recordId: string;
  round: TaskNativeRef | null;
  attempt: TaskNativeRef | null;
  tool: TaskNativeRef | null;
  pairing: 'exact' | 'unavailable' | 'ambiguous' | 'incomplete';
  /** Exact same-ID retained observations, including off-page links; max12. */
  relatedRecordIds: string[];
}
export interface TaskRoundSeed { memberId: string; recordId: string; sequence: number; title: string; startedAt: string }
export interface TaskStructure { records: TaskRecordStructure[]; leading: TaskRoundSeed[]; warnings: string[] }
/** Histogram counts retained event STARTS, not executions or time shares. */
export interface TaskTimeBin { index: number; input: number; model: number; tool: number; other: number; errors: number }
export interface TaskTimeline {
  taskId: string;
  member: string;
  window: string;
  from: string | null;
  to: string | null;
  bins: number;
  total: number;
  untimed: number;
  lanes: Array<{ memberId: string; name: string; total: number; bins: TaskTimeBin[] }>;
  coverage: { loadedMembers: number; totalMembers: number };
}

export interface TaskHealthSummary {
  id: string; generatedAt: string; revision: string;
  conclusion: 'findings' | 'not_observed' | 'insufficient'; issues: number;
  scope?: { member: string; from: string | null; to: string | null };
}
export interface TaskAlert { rule: keyof AlertThresholds; threshold: number; actual: number }
export interface AlertThresholds {
  errors: number | null; toolFailurePct: number | null; durationMs: number | null;
  tokens: number | null; contextPressurePct: number | null;
}
export interface TaskKpis {
  tasks: number; statusKnownTasks: number; toolKnownTasks: number; failedTasks: number; failurePct: number | null;
  toolFailurePct: number | null; tokens: number | null; tokenKnownTasks: number;
  cacheHitRate: number | null; cacheKnownMembers: number; cacheTotalMembers: number; alerts: number;
}

export type TaskHydrationReason = 'source_missing' | 'source_unreadable' | 'parse_failed' | 'member_unavailable' | 'cancelled' | 'request_failed';
export interface TaskHydrationProgress {
  taskId: string;
  pending: number;
  loaded: number;
  reasons: TaskHydrationReason[];
}
export interface TaskHydrationFrame { items: TaskHydrationProgress[]; done: boolean }
export interface LocalSettingsTarget { section: 'alert-thresholds' }

/** TC-002: the same metadata projection as the Phase B task home. */
export interface TaskComparisonSnapshot { a: TaskSummary[]; b: TaskSummary[] }

/** TR-001–003: read-only genuine root-user request projection. */
export interface TaskRequest {
  id: string; ordinal: number; title: string; startedAt: string; endedAt: string;
  nextStartedAt: string | null; eventCount: number; metrics: TaskMetrics; alerts: TaskAlert[];
}
export interface TaskRequestList { taskId: string; revision: string; items: TaskRequest[] }
