import type { ProviderKey, TraceEventSlim, TraceLogSession, TraceLogTurn, TraceStatus } from './trace-types.js';

/** Task identity is a read projection; native IDs and evidence remain unchanged. */
export type TaskOrigin = 'collected' | 'imported';
export interface TaskSummary {
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
export interface TaskContext {
  task: TaskSummary;
  members: TaskMember[];
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
export interface TaskListQuery { origin?: TaskOrigin; q?: string; provider?: ProviderKey; range?: 'today' | '7d' | '30d' | 'all'; offset?: number; limit?: number }
export interface TaskRecordQuery { member?: string; q?: string; status?: TraceStatus; offset?: number; limit?: number; window?: string; anchor?: string; from?: string; to?: string; structure?: boolean }

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
