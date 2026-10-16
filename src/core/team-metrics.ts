/**
 * Team metrics core (add-agent-team-observability §5.7–5.13, design D8/D9).
 *
 * 纯函数模块：只接收规范输入、输出规范类型，不读 DB、不发请求、不写文件。
 * 每个指标携带 availability / completeness / criteria / numerator / denominator /
 * evidence ids（§5.13，design D9）；cost/token 未知时保持 unavailable（禁止 0 冒充）。
 * 账本排序按 native sequence / time / source priority / id + 显式歧义标记（D8）；
 * 轮次映射优先级 native round → 显式 session turn → 既有 TurnModel → unavailable，
 * 禁止用时间/计数切分伪造轮次。
 */
import type {

  PriceCurrency,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamArtifact,
  TeamAssignment,
  TeamCollaborationMetrics,
  TeamCommunication,
  TeamCompleteness,
  TeamCostMetrics,
  TeamMetricDirection,
  TeamMetrics,
  TeamMetricValue,
  TeamOrderConfidence,
  TeamQualityMetrics,
  TeamRound,
  TeamRoundAggregates,
  TeamRoundSegmentationSource,
  TeamRunStatus,
  TeamSchedulingMetrics,
  TeamStabilityMetrics,
  TeamTask,
  TeamTaskDependency,
  TokenUsage,
  TraceStatus,
  TurnModel,
} from './trace-types.js';
import { validateTaskDag } from './team-dag.js';
import { classifyTopology } from './team-topology.js';

/**
 * 团队指标计算版本（metrics-analysis REQ-019）：算法/证据语义变更必须 bump，
 * 触发 metrics 重算回写。v1 为 add-agent-team-observability 的冻结算法。
 */
export const TEAM_METRICS_CALC_VERSION = 1;

// ── 指标方向性（design D9 / metrics-analysis REQ-018） ───────

/** 每个指标的确定性方向；比较算法据此做方向感知 delta（§6.7）。 */
export const TEAM_METRIC_DIRECTIONS: Readonly<Record<string, TeamMetricDirection>> = {
  // scheduling
  wallClockMs: 'lower_better',
  agentActiveMs: 'descriptive',
  totalWorkMs: 'descriptive',
  observedWaitMs: 'lower_better',
  maxConcurrency: 'descriptive',
  avgConcurrency: 'descriptive',
  serialWorkEstimateMs: 'descriptive',
  observedSpeedup: 'higher_better',
  peakCapacityUtilization: 'higher_better',
  criticalPathMs: 'lower_better',
  delegationDelayMs: 'lower_better',
  handoffLatencyMs: 'lower_better',
  // quality
  taskCompletion: 'higher_better',
  verificationCoverage: 'higher_better',
  acceptanceCoverage: 'higher_better',
  reviewRework: 'lower_better',
  acceptedArtifactRate: 'higher_better',
  // stability
  failures: 'lower_better',
  retries: 'lower_better',
  replacements: 'lower_better',
  recoveryLatencyMs: 'lower_better',
  blockedOrphanTimeMs: 'lower_better',
  unresolvedErrors: 'lower_better',
  dagAnomalies: 'lower_better',
  incompleteTerminalStates: 'lower_better',
  // cost
  totalInputTokens: 'descriptive',
  totalOutputTokens: 'descriptive',
  totalReasoningTokens: 'descriptive',
  totalCacheReadTokens: 'descriptive',
  totalCacheWriteTokens: 'descriptive',
  totalCostUsd: 'lower_better',
  coordinationTokens: 'descriptive',
  costGini: 'descriptive',
  // collaboration
  directRatio: 'descriptive',
  leaderMediatedRatio: 'descriptive',
  responseLatencyMedianMs: 'lower_better',
  responseLatencyP95Ms: 'lower_better',
  taskBalanceGini: 'descriptive',
  leaderWorkConcentration: 'descriptive',
  criticalAgentConcentration: 'descriptive',
  crossAgentReview: 'higher_better',
  duplicateWorkSignal: 'lower_better',
} as const;

// ── 指标信封 helper（§5.13） ─────────────────────────────────

function metric(
  value: number | null,
  criteria: string,
  evidenceIds: string[],
  complete: boolean,
  numerator: number | null = null,
  denominator: number | null = null,
): TeamMetricValue {
  return {
    value,
    available: value !== null,
    complete,
    criteria,
    evidenceIds,
    numerator,
    denominator,
  };
}

/** 时间解析：ISO 8601 → epoch ms；无效返回 null。 */
function parseMs(iso: string | null): number | null {
  if (iso === null) {
    return null;
  }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

type Interval = [number, number];

/** 区间并集总时长（ms）。忽略非法（start>end）与无界区间。 */
function unionDuration(intervals: readonly Interval[]): number {
  const valid = intervals.filter(
    ([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e >= s,
  );
  if (valid.length === 0) {
    return 0;
  }
  valid.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = valid[0]![0];
  let curEnd = valid[0]![1];
  for (let i = 1; i < valid.length; i += 1) {
    const [s, e] = valid[i]!;
    if (s <= curEnd) {
      if (e > curEnd) {
        curEnd = e;
      }
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total;
}

/** 区间峰值重叠数（maxConcurrency 用）。 */
function maxOverlap(intervals: readonly Interval[]): number {
  const points: { t: number; d: number }[] = [];
  for (const [s, e] of intervals) {
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) {
      continue;
    }
    points.push({ t: s, d: 1 }, { t: e, d: -1 });
  }
  points.sort((a, b) => (a.t - b.t) || (a.d - b.d));
  let current = 0;
  let peak = 0;
  for (const point of points) {
    current += point.d;
    if (current > peak) {
      peak = current;
    }
  }
  return peak;
}


/** Gini 系数（升序法）；空/零总量返回 null（禁止 0/0）。 */
function gini(values: readonly number[]): number | null {
  const filtered = values.filter((v) => Number.isFinite(v) && v >= 0);
  const n = filtered.length;
  if (n === 0) {
    return null;
  }
  const sorted = [...filtered].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  if (sum <= 0) {
    return null;
  }
  let weighted = 0;
  for (let i = 0; i < n; i += 1) {
    weighted += (2 * (i + 1) - n - 1) * sorted[i]!;
  }
  return weighted / (n * sum);
}

/** 最近秩百分位；空返回 null。 */
function percentile(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(Math.ceil(p * sortedAsc.length) - 1, sortedAsc.length - 1));
  return sortedAsc[index]!;
}

/** token 增量语义求和（data-model §2：跨活动必须 sum，非 max）。 */
function sumTokenUsage(list: readonly (TokenUsage | null)[]): TokenUsage | null {
  const acc: TokenUsage = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    netInput: 0,
    total: 0,
  };
  let any = false;
  for (const usage of list) {
    if (!usage) {
      continue;
    }
    any = true;
    acc.input += usage.input;
    acc.output += usage.output;
    acc.reasoning += usage.reasoning;
    acc.cacheRead += usage.cacheRead;
    acc.cacheWrite += usage.cacheWrite;
    acc.netInput += usage.netInput;
    acc.total += usage.total;
  }
  return any ? acc : null;
}

// ── §5.7 账本排序（design D8） ───────────────────────────────

export interface LedgerSourceResolver {
  (activity: TeamActivitySlim): { sourceKey: string; priority: number };
}

/**
 * 统一账本排序：native sequence（同源）→ 归一化 startedAt（跨源）→ source
 * priority → 规范 id（确定性 tie-break）。凡靠后三条规则决定相对顺序的活动，
 * orderConfidence 标记为 `ambiguous`（design D8 / G12.4）。
 */
export function orderLedger(
  activities: readonly TeamActivitySlim[],
  resolveSource: LedgerSourceResolver = () => ({ sourceKey: '', priority: 0 }),
): TeamActivitySlim[] {
  const sourceMap = new Map<string, { sourceKey: string; priority: number }>();
  for (const activity of activities) {
    sourceMap.set(activity.id, resolveSource(activity));
  }
  const ambiguous = new Set<string>();
  const compare = (a: TeamActivitySlim, b: TeamActivitySlim): number => {
    const sa = sourceMap.get(a.id)!;
    const sb = sourceMap.get(b.id)!;
    if (
      sa.sourceKey === sb.sourceKey &&
      a.nativeSequence !== null &&
      b.nativeSequence !== null
    ) {
      return a.nativeSequence - b.nativeSequence;
    }
    const ta = parseMs(a.startedAt);
    const tb = parseMs(b.startedAt);
    if (ta !== null && tb !== null && ta !== tb) {
      ambiguous.add(a.id);
      ambiguous.add(b.id);
      return ta - tb;
    }
    if (sa.priority !== sb.priority) {
      ambiguous.add(a.id);
      ambiguous.add(b.id);
      return sa.priority - sb.priority;
    }
    if (a.id !== b.id) {
      ambiguous.add(a.id);
      ambiguous.add(b.id);
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  };
  const sorted = [...activities].sort(compare);
  return sorted.map((activity) =>
    ambiguous.has(activity.id)
      ? ({ ...activity, orderConfidence: 'ambiguous' as TeamOrderConfidence })
      : activity,
  );
}

// ── §5.8 per-agent 轮次映射（design D8） ─────────────────────

export interface RoundMappingInput {
  runId: string;
  agents: readonly TeamAgent[];
  activities: readonly TeamActivitySlim[];
  /** sessionKey → 既有 TurnModel（用于 turn_model 回退，第三级优先级）。 */
  turnModels?: ReadonlyMap<string, TurnModel>;
}

/**
 * per-agent 轮次映射。边界优先级：
 * 1. native round（activity.roundId）→ `native_round`；
 * 2. 显式 session turn（activity.turnKey）→ `session_turn`；
 * 3. 既有 TurnModel（turnModels[activity.sessionKey]）→ `turn_model`；
 * 4. 否则 `unavailable` —— 渲染无轮次账本，禁止用时间/计数切分伪造轮次。
 */
export function mapAgentRounds(input: RoundMappingInput): TeamRound[] {
  const turnModels = input.turnModels ?? new Map<string, TurnModel>();
  const rounds: TeamRound[] = [];
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));

  for (const agent of input.agents) {
    const activities = input.activities
      .filter((activity) => activity.agentId === agent.id)
      .slice()
      .sort((a, b) => {
        const ta = parseMs(a.startedAt) ?? 0;
        const tb = parseMs(b.startedAt) ?? 0;
        return ta - tb;
      });

    const grouping = groupActivities(activities, turnModels);
    let index = 1;
    for (const group of grouping) {
      const { source, key, members } = group;
      if (source === 'unavailable') {
        continue;
      }
      const first = members[0]!;
      const last = members[members.length - 1]!;
      const startedAt = first.startedAt;
      const endedAt = last.endedAt;
      const tokenUsage = sumTokenUsage(members.map((activity) => activity.tokenUsage));
      const costUsd = sumNullable(members.map((activity) => activity.costUsd));
      const toolCallCount = members.filter((activity) => activity.kind === 'tool_call').length;
      const messageCount = members.filter(
        (activity) => activity.kind === 'message_sent' || activity.kind === 'message_received',
      ).length;
      const wallClockMs = diffMs(startedAt, endedAt);
      const intervals = members
        .map((activity) => [parseMs(activity.startedAt), parseMs(activity.endedAt)] as Interval)
        .filter(([s, e]) => s !== null && e !== null) as Interval[];
      const activeMs = unionDuration(intervals);
      const status = aggregateStatus(members.map((activity) => activity.status));
      const aggregates: TeamRoundAggregates = {
        wallClockMs,
        activeMs,
        tokenUsage,
        costUsd,
        toolCallCount,
        messageCount,
      };
      rounds.push({
        id: `${input.runId}:${agent.id}:round:${key}`,
        runId: input.runId,
        agentId: agent.id,
        nativeId: source === 'native_round' || source === 'session_turn' ? key : null,
        index,
        segmentationSource: source as TeamRoundSegmentationSource,
        startedAt,
        endedAt,
        status,
        taskIds: dedupe(members.map((activity) => activity.taskId).filter((id): id is string => id !== null)),
        outputArtifactIds: dedupe(
          members.map((activity) => activity.artifactId).filter((id): id is string => id !== null),
        ),
        aggregates,
        completeness: startedAt !== null && endedAt !== null ? 'complete' : 'partial',
      });
      index += 1;
    }
  }
  void agentById;
  return rounds;
}

function sumNullable(values: readonly (number | null)[]): number | null {
  let any = false;
  let total = 0;
  for (const value of values) {
    if (value === null) {
      continue;
    }
    any = true;
    total += value;
  }
  return any ? total : null;
}

function diffMs(startIso: string | null, endIso: string | null): number | null {
  const start = parseMs(startIso);
  const end = parseMs(endIso);
  if (start === null || end === null) {
    return null;
  }
  return end - start;
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function aggregateStatus(statuses: readonly TraceStatus[]): TraceStatus {
  if (statuses.length === 0) {
    return 'unknown';
  }
  if (statuses.includes('error')) {
    return 'error';
  }
  if (statuses.includes('running')) {
    return 'running';
  }
  if (statuses.includes('cancelled')) {
    return 'cancelled';
  }
  return 'success';
}

interface RoundGroup {
  source: TeamRoundSegmentationSource;
  key: string;
  members: TeamActivitySlim[];
}

/** 按四级优先级把单个 agent 的活动分组成轮次；不可用时整组标记 unavailable。 */
function groupActivities(
  activities: readonly TeamActivitySlim[],
  turnModels: ReadonlyMap<string, TurnModel>,
): RoundGroup[] {
  const withRoundId = activities.filter((activity) => activity.roundId !== null);
  if (withRoundId.length > 0) {
    return groupByKey(withRoundId, (activity) => activity.roundId!, 'native_round');
  }
  const withTurnKey = activities.filter((activity) => activity.turnKey !== null);
  if (withTurnKey.length > 0) {
    return groupByKey(withTurnKey, (activity) => activity.turnKey!, 'session_turn');
  }
  // turn_model：按 sessionKey 关联既有 TurnModel，按 turn index 分组。
  const turnModelRounds: RoundGroup[] = [];
  for (const activity of activities) {
    const sessionKey = activity.sessionKey;
    if (sessionKey === null) {
      continue;
    }
    const model = turnModels.get(sessionKey);
    if (!model) {
      continue;
    }
    // 该 activity 归属的 turn index：从 turnKey（若存在）或按 sessionKey 全量归入一个 turn。
    // 简化：turn_model 回退下，同 session 的全部活动归为一个 round（无更细边界）。
    const key = sessionKey;
    let existing = turnModelRounds.find((group) => group.key === key);
    if (!existing) {
      existing = { source: 'turn_model', key, members: [] };
      turnModelRounds.push(existing);
    }
    existing.members.push(activity);
  }
  if (turnModelRounds.length > 0) {
    return turnModelRounds;
  }
  return [];
}

function groupByKey(
  activities: readonly TeamActivitySlim[],
  keyOf: (activity: TeamActivitySlim) => string,
  source: TeamRoundSegmentationSource,
): RoundGroup[] {
  const map = new Map<string, TeamActivitySlim[]>();
  for (const activity of activities) {
    const key = keyOf(activity);
    const list = map.get(key) ?? [];
    list.push(activity);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, members]) => ({ source, key, members }));
}

// ── §5.9–5.13 run 级指标 ─────────────────────────────────────

export interface TeamMetricsInput {
  runId: string;
  runStatus: TeamRunStatus;
  startedAt: string | null;
  endedAt: string | null;
  costCurrency: PriceCurrency | null;
  agents: readonly TeamAgent[];
  /** 可选：用于 leader 回退判定（roleClass 缺失时取拓扑根）。 */
  agentEdges?: readonly TeamAgentEdge[];
  tasks: readonly TeamTask[];
  dependencies: readonly TeamTaskDependency[];
  assignments: readonly TeamAssignment[];
  activities: readonly TeamActivitySlim[];
  communications: readonly TeamCommunication[];
  artifacts: readonly TeamArtifact[];
  rounds: readonly TeamRound[];
  completeness: TeamCompleteness;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function collectEvidence(entities: readonly { evidenceIds: string[] }[]): string[] {
  return dedupe(entities.flatMap((entity) => entity.evidenceIds));
}

/** 解析 leader agent id（roleClass 优先，回退拓扑根）。 */
function resolveLeaderId(input: TeamMetricsInput): string | null {
  const byRole = input.agents.find((agent) => agent.roleClass === 'leader');
  if (byRole) {
    return byRole.id;
  }
  if (input.agentEdges && input.agentEdges.length > 0) {
    const topo = classifyTopology({ agents: input.agents, edges: input.agentEdges });
    const root = topo.roots[0];
    if (root) {
      return root;
    }
  }
  return input.agents[0]?.id ?? null;
}

/** agent 活跃区间：该 agent 的活动 [startedAt, endedAt]。 */
function agentActiveIntervals(
  agentId: string,
  activities: readonly TeamActivitySlim[],
): Interval[] {
  const intervals: Interval[] = [];
  for (const activity of activities) {
    if (activity.agentId !== agentId) {
      continue;
    }
    const start = parseMs(activity.startedAt);
    const end = parseMs(activity.endedAt);
    if (start !== null && end !== null) {
      intervals.push([start, end]);
    }
  }
  return intervals;
}

/** 每个 agent 的活跃区间并集时长（person-time）。 */
function perAgentActiveMs(input: TeamMetricsInput): Map<string, number> {
  const result = new Map<string, number>();
  for (const agent of input.agents) {
    result.set(agent.id, unionDuration(agentActiveIntervals(agent.id, input.activities)));
  }
  return result;
}

function computeScheduling(input: TeamMetricsInput, criticalPathMs: number | null): TeamSchedulingMetrics {
  const complete = input.completeness.timing === 'complete';
  const runStart = parseMs(input.startedAt);
  const runEnd = parseMs(input.endedAt);
  const wallClockMs = runStart !== null && runEnd !== null ? runEnd - runStart : null;

  const perAgent = perAgentActiveMs(input);
  const allIntervals = input.agents.flatMap((agent) => agentActiveIntervals(agent.id, input.activities));
  const totalWorkMs = [...perAgent.values()].reduce((acc, v) => acc + v, 0);
  const agentActiveMs = totalWorkMs; // Σ per-agent active union（design D9：totalWork = sum of agentActive）

  // 显式 wait/blocked 区间（仅 blocked task 记录，design D8）。
  const waitIntervals: Interval[] = [];
  for (const task of input.tasks) {
    if (task.status !== 'blocked') {
      continue;
    }
    const start = parseMs(task.startedAt) ?? parseMs(task.createdAt);
    const end =
      parseMs(task.completedAt) ??
      parseMs(task.failedAt) ??
      parseMs(task.cancelledAt) ??
      runEnd;
    if (start !== null && end !== null) {
      waitIntervals.push([start, end]);
    }
  }
  const observedWaitMs = waitIntervals.length > 0 ? unionDuration(waitIntervals) : complete ? 0 : null;

  const maxConcurrency = maxOverlap(allIntervals);
  const avgConcurrency =
    wallClockMs !== null && wallClockMs > 0 ? totalWorkMs / wallClockMs : null;

  // serial-work estimate = Σ task active durations。
  const taskDurations: number[] = [];
  for (const task of input.tasks) {
    const start = parseMs(task.startedAt);
    const end = parseMs(task.completedAt);
    if (start !== null && end !== null && end >= start) {
      taskDurations.push(end - start);
    }
  }
  const serialWorkEstimateMs = taskDurations.length > 0 ? taskDurations.reduce((a, b) => a + b, 0) : null;
  const observedSpeedup =
    serialWorkEstimateMs !== null && wallClockMs !== null && wallClockMs > 0
      ? serialWorkEstimateMs / wallClockMs
      : null;
  const peakCapacityUtilization =
    wallClockMs !== null && wallClockMs > 0 && maxConcurrency > 0
      ? totalWorkMs / (wallClockMs * maxConcurrency)
      : null;

  // delegation delay = 首个 child 创建 / 首次指派 − run start。
  const leaderId = resolveLeaderId(input);
  let firstChildAt: number | null = null;
  for (const agent of input.agents) {
    if (agent.id === leaderId) {
      continue;
    }
    const created = parseMs(agent.createdAt);
    if (created !== null && (firstChildAt === null || created < firstChildAt)) {
      firstChildAt = created;
    }
  }
  let firstAssignAt: number | null = null;
  for (const assignment of input.assignments) {
    const at = parseMs(assignment.assignedAt);
    if (at !== null && (firstAssignAt === null || at < firstAssignAt)) {
      firstAssignAt = at;
    }
  }
  const earliestDelegation = Math.min(
    firstChildAt ?? Number.POSITIVE_INFINITY,
    firstAssignAt ?? Number.POSITIVE_INFINITY,
  );
  const delegationDelayMs =
    runStart !== null && Number.isFinite(earliestDelegation)
      ? earliestDelegation - runStart
      : null;

  // handoff latency = 下一 owner 首个相关活动 − 显式 handoff 时间。
  const handoffLatencies: number[] = [];
  for (const handoff of input.activities) {
    if (handoff.kind !== 'handoff') {
      continue;
    }
    const handoffTime = parseMs(handoff.startedAt) ?? parseMs(handoff.endedAt);
    if (handoffTime === null) {
      continue;
    }
    const next = input.activities
      .filter(
        (activity) =>
          activity.taskId !== null &&
          activity.taskId === handoff.taskId &&
          activity.agentId !== handoff.agentId &&
          activity.id !== handoff.id,
      )
      .map((activity) => ({ activity, at: parseMs(activity.startedAt) }))
      .filter((entry) => entry.at !== null && entry.at >= handoffTime)
      .sort((a, b) => a.at! - b.at!)[0];
    if (next) {
      handoffLatencies.push(next.at! - handoffTime);
    }
  }
  const handoffLatencyMs = mean(handoffLatencies);

  const evidence = collectEvidence(input.activities);
  return {
    wallClockMs: metric(wallClockMs, 'run end minus run start; null while running', evidence, complete),
    agentActiveMs: metric(agentActiveMs, 'sum of per-agent active-interval unions (person-ms)', evidence, complete),
    totalWorkMs: metric(totalWorkMs, 'sum of per-agent active time; measured, not wall-clock', evidence, complete),
    observedWaitMs: metric(observedWaitMs, 'union of explicit wait/blocked intervals only', evidence, complete),
    maxConcurrency: metric(maxConcurrency, 'maximum simultaneous agents with active intervals', evidence, complete),
    avgConcurrency: metric(avgConcurrency, 'integral of active-agent count divided by wall-clock', evidence, complete),
    serialWorkEstimateMs: metric(serialWorkEstimateMs, 'sum of measured task active durations; estimate', evidence, complete),
    observedSpeedup: metric(observedSpeedup, 'serial-work estimate / wall-clock', evidence, complete),
    peakCapacityUtilization: metric(
      peakCapacityUtilization,
      'totalWork / (wallClock × maxConcurrency)',
      evidence,
      complete,
    ),
    criticalPathMs: metric(criticalPathMs, 'longest weighted path over complete acyclic Task DAG', evidence, complete),
    delegationDelayMs: metric(delegationDelayMs, 'first child creation/assignment minus run start', evidence, complete),
    handoffLatencyMs: metric(handoffLatencyMs, 'next owner first related activity minus explicit handoff time', evidence, complete),
  };
}

function computeQuality(input: TeamMetricsInput): TeamQualityMetrics {
  const complete = input.completeness.tasks === 'complete';
  const terminal = input.tasks.filter(
    (task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled',
  );
  const completed = input.tasks.filter((task) => task.status === 'completed');
  const taskCompletion = terminal.length > 0 ? completed.length / terminal.length : null;

  // 生产者（claimed/assigned）映射。
  const producerByTask = new Map<string, string>();
  for (const assignment of input.assignments) {
    if (assignment.assignmentKind === 'claimed' || assignment.assignmentKind === 'assigned') {
      if (!producerByTask.has(assignment.taskId)) {
        producerByTask.set(assignment.taskId, assignment.agentId);
      }
    }
  }
  const reviewedTasks = new Set<string>();
  for (const assignment of input.assignments) {
    if (assignment.assignmentKind === 'review') {
      const producer = producerByTask.get(assignment.taskId);
      if (producer !== undefined && producer !== assignment.agentId) {
        reviewedTasks.add(assignment.taskId);
      }
    }
  }
  for (const activity of input.activities) {
    if (activity.kind === 'verification' && activity.taskId !== null) {
      const producer = producerByTask.get(activity.taskId);
      if (producer !== undefined && producer !== activity.agentId) {
        reviewedTasks.add(activity.taskId);
      }
    }
  }
  const verifiedCompleted = completed.filter((task) => reviewedTasks.has(task.id));
  const verificationCoverage =
    completed.length > 0 ? verifiedCompleted.length / completed.length : null;

  // acceptance：有实际产出（hasContent）的 artifact 中，显式接受（acceptedAt）的占比。
  const producedArtifacts = input.artifacts.filter((artifact) => artifact.hasContent);
  const acceptedArtifacts = input.artifacts.filter((artifact) => artifact.acceptedAt !== null);
  const acceptanceCoverage =
    producedArtifacts.length > 0 ? acceptedArtifacts.length / producedArtifacts.length : null;
  const acceptedArtifactRate =
    input.artifacts.length > 0 ? acceptedArtifacts.length / input.artifacts.length : null;

  // review rework：review 后重开/纠正的 task（recovery 活动 + reassigned 指派）。
  const reworkTasks = new Set<string>();
  for (const activity of input.activities) {
    if (activity.kind === 'recovery' && activity.taskId !== null) {
      reworkTasks.add(activity.taskId);
    }
  }
  for (const assignment of input.assignments) {
    if (assignment.assignmentKind === 'reassigned') {
      reworkTasks.add(assignment.taskId);
    }
  }
  const reviewRework = complete || reworkTasks.size > 0 ? reworkTasks.size : null;

  const evidence = collectEvidence([...input.tasks, ...input.assignments, ...input.artifacts]);
  return {
    taskCompletion: metric(
      taskCompletion,
      'completed tasks / terminal tasks (cancelled counted in denominator, reported separately)',
      evidence,
      complete,
      completed.length,
      terminal.length,
    ),
    verificationCoverage: metric(
      verificationCoverage,
      'completed tasks with independent (non-producer) verification / completed tasks',
      evidence,
      complete,
      verifiedCompleted.length,
      completed.length,
    ),
    acceptanceCoverage: metric(
      acceptanceCoverage,
      'accepted artifacts / artifacts with known outcome (hasContent)',
      evidence,
      complete,
      acceptedArtifacts.length,
      producedArtifacts.length,
    ),
    reviewRework: metric(reviewRework, 'correction/reopened tasks after review', evidence, complete),
    acceptedArtifactRate: metric(
      acceptedArtifactRate,
      'accepted artifacts / all artifacts (explicit acceptance only)',
      evidence,
      complete,
      acceptedArtifacts.length,
      input.artifacts.length,
    ),
  };
}

function computeStability(input: TeamMetricsInput, dagAnomalyCount: number): TeamStabilityMetrics {
  const complete = input.completeness.tasks === 'complete';
  const errorActivities = input.activities.filter((activity) => activity.kind === 'error');
  const recoveryActivities = input.activities.filter((activity) => activity.kind === 'recovery');
  const failures = errorActivities.length;
  const retries = recoveryActivities.length;
  const replacements = input.agents.filter((agent) => agent.state === 'replaced').length;

  // recovery latency：每个 recovery 找其最近的未解决 error（同 agent+task）。
  const errorsByKey = new Map<string, TeamActivitySlim[]>();
  for (const error of errorActivities) {
    const key = `${error.agentId ?? ''}:${error.taskId ?? ''}`;
    const list = errorsByKey.get(key) ?? [];
    list.push(error);
    errorsByKey.set(key, list);
  }
  const latencies: number[] = [];
  const resolvedErrors = new Set<TeamActivitySlim>();
  for (const recovery of recoveryActivities) {
    const key = `${recovery.agentId ?? ''}:${recovery.taskId ?? ''}`;
    const recTime = parseMs(recovery.startedAt);
    if (recTime === null) {
      continue;
    }
    let bestError: TeamActivitySlim | null = null;
    let bestEnd: number | null = null;
    for (const error of errorsByKey.get(key) ?? []) {
      const errEnd = parseMs(error.endedAt) ?? parseMs(error.startedAt);
      if (errEnd === null || errEnd > recTime) {
        continue;
      }
      if (bestEnd === null || errEnd > bestEnd) {
        bestEnd = errEnd;
        bestError = error;
      }
    }
    if (bestError && bestEnd !== null) {
      latencies.push(recTime - bestEnd);
      resolvedErrors.add(bestError);
    }
  }
  const recoveryLatencyMs = mean(latencies);

  // blocked / orphan 区间。
  const blockedIntervals: Interval[] = [];
  for (const task of input.tasks) {
    if (task.status !== 'blocked') {
      continue;
    }
    const start = parseMs(task.startedAt) ?? parseMs(task.createdAt);
    const end =
      parseMs(task.completedAt) ??
      parseMs(task.failedAt) ??
      parseMs(task.cancelledAt) ??
      parseMs(input.endedAt);
    if (start !== null && end !== null) {
      blockedIntervals.push([start, end]);
    }
  }
  const activeOwners = new Set(
    input.assignments.filter((assignment) => assignment.unassignedAt === null).map((assignment) => assignment.taskId),
  );
  const orphanIntervals: Interval[] = [];
  for (const task of input.tasks) {
    if (task.status !== 'running' || activeOwners.has(task.id)) {
      continue;
    }
    const start = parseMs(task.startedAt) ?? parseMs(task.createdAt);
    const end = parseMs(input.endedAt);
    if (start !== null && end !== null) {
      orphanIntervals.push([start, end]);
    }
  }
  const blockedOrphanValue =
    blockedIntervals.length + orphanIntervals.length > 0
      ? unionDuration([...blockedIntervals, ...orphanIntervals])
      : complete
        ? 0
        : null;

  const unresolvedErrors = errorActivities.filter((error) => !resolvedErrors.has(error)).length;
  const incompleteTerminalStates = input.tasks.filter(
    (task) => task.status === 'completed' && !task.resultAvailable,
  ).length;

  const evidence = collectEvidence(input.activities);
  return {
    failures: metric(failures, 'count of explicit error activities; later success does not erase preceding failure', evidence, complete),
    retries: metric(retries, 'count of recovery activities', evidence, complete),
    replacements: metric(replacements, 'count of agents in replaced state', evidence, complete),
    recoveryLatencyMs: metric(recoveryLatencyMs, 'mean error→recovery latency (same agent+task)', evidence, complete),
    blockedOrphanTimeMs: metric(blockedOrphanValue, 'union of blocked-task and orphan-task intervals', evidence, complete),
    unresolvedErrors: metric(unresolvedErrors, 'error activities without a following recovery', evidence, complete),
    dagAnomalies: metric(dagAnomalyCount, 'count of task-DAG validation anomalies', evidence, complete),
    incompleteTerminalStates: metric(incompleteTerminalStates, 'completed tasks missing result evidence', evidence, complete),
  };
}

function computeCost(input: TeamMetricsInput): TeamCostMetrics {
  const tokensAvailable = input.completeness.tokens !== 'unavailable';
  const tokensComplete = input.completeness.tokens === 'complete';
  const costAvailable = input.completeness.cost !== 'unavailable' && input.costCurrency !== null;
  const costComplete = input.completeness.cost === 'complete';
  const communicationComplete = input.completeness.communication === 'complete';

  const totalTokens = sumTokenUsage(input.activities.map((activity) => activity.tokenUsage));
  const totalInputTokens = tokensAvailable ? (totalTokens?.input ?? 0) : null;
  const totalOutputTokens = tokensAvailable ? (totalTokens?.output ?? 0) : null;
  const totalReasoningTokens = tokensAvailable ? (totalTokens?.reasoning ?? 0) : null;
  const totalCacheReadTokens = tokensAvailable ? (totalTokens?.cacheRead ?? 0) : null;
  const totalCacheWriteTokens = tokensAvailable ? (totalTokens?.cacheWrite ?? 0) : null;

  const totalCostUsdRaw = sumNullable(input.activities.map((activity) => activity.costUsd));
  const totalCostUsd = costAvailable ? totalCostUsdRaw : null;

  const coordinationKinds = new Set([
    'message_sent',
    'message_received',
    'handoff',
    'integration',
    'task_assignment',
  ]);
  const coordinationActivities = input.activities.filter((activity) => coordinationKinds.has(activity.kind));
  const coordinationTotal = sumTokenUsage(coordinationActivities.map((activity) => activity.tokenUsage));
  const coordinationTokens =
    coordinationTotal !== null
      ? coordinationTotal.total
      : communicationComplete
        ? 0
        : null;

  const costByAgent = new Map<string, number>();
  for (const activity of input.activities) {
    if (activity.agentId === null || activity.costUsd === null) {
      continue;
    }
    costByAgent.set(activity.agentId, (costByAgent.get(activity.agentId) ?? 0) + activity.costUsd);
  }
  const costGini = gini([...costByAgent.values()]);

  const evidence = collectEvidence(input.activities);
  return {
    totalInputTokens: metric(totalInputTokens, 'sum of incremental input tokens across activities', evidence, tokensComplete),
    totalOutputTokens: metric(totalOutputTokens, 'sum of incremental output tokens across activities', evidence, tokensComplete),
    totalReasoningTokens: metric(totalReasoningTokens, 'sum of incremental reasoning tokens across activities', evidence, tokensComplete),
    totalCacheReadTokens: metric(totalCacheReadTokens, 'sum of incremental cache-read tokens across activities', evidence, tokensComplete),
    totalCacheWriteTokens: metric(totalCacheWriteTokens, 'sum of incremental cache-write tokens across activities', evidence, tokensComplete),
    totalCostUsd: metric(totalCostUsd, 'sum of reported activity costs; unavailable when cost not observable', evidence, costComplete),
    costCurrency: input.costCurrency,
    coordinationTokens: metric(coordinationTokens, 'tokens of message/orchestration activities only', evidence, communicationComplete),
    costGini: metric(costGini, 'Gini of per-agent cost distribution', evidence, costComplete),
  };
}

function computeCollaboration(input: TeamMetricsInput): TeamCollaborationMetrics {
  const communicationComplete = input.completeness.communication === 'complete';
  const tasksComplete = input.completeness.tasks === 'complete';
  const outputsComplete = input.completeness.outputs === 'complete';

  const knownMessages = input.communications.filter((communication) => communication.mode !== 'unknown');
  const direct = input.communications.filter((communication) => communication.mode === 'direct');
  const leaderMediated = input.communications.filter((communication) => communication.mode === 'leader_mediated');
  const directRatio = knownMessages.length > 0 ? direct.length / knownMessages.length : null;
  const leaderMediatedRatio = knownMessages.length > 0 ? leaderMediated.length / knownMessages.length : null;

  // correlated request/reply latency（replyToId / correlationId）。
  const latencies: number[] = [];
  const byId = new Map(input.communications.map((communication) => [communication.id, communication]));
  for (const reply of input.communications) {
    if (reply.replyToId === null) {
      continue;
    }
    const request = byId.get(reply.replyToId);
    if (!request) {
      continue;
    }
    const reqTime = parseMs(request.sentAt);
    const repTime = parseMs(reply.sentAt) ?? parseMs(reply.receivedAt);
    if (reqTime !== null && repTime !== null && repTime >= reqTime) {
      latencies.push(repTime - reqTime);
    }
  }
  const sortedLatencies = latencies.slice().sort((a, b) => a - b);
  const responseLatencyMedianMs = percentile(sortedLatencies, 0.5);
  const responseLatencyP95Ms = percentile(sortedLatencies, 0.95);

  // task-balance Gini：completed task active duration by producer agent。
  const durationByAgent = new Map<string, number>();
  for (const task of input.tasks) {
    if (task.status !== 'completed') {
      continue;
    }
    const start = parseMs(task.startedAt);
    const end = parseMs(task.completedAt);
    if (start === null || end === null || end < start) {
      continue;
    }
    const assignment = input.assignments.find(
      (a) => a.taskId === task.id && (a.assignmentKind === 'claimed' || a.assignmentKind === 'assigned'),
    );
    if (!assignment) {
      continue;
    }
    durationByAgent.set(assignment.agentId, (durationByAgent.get(assignment.agentId) ?? 0) + (end - start));
  }
  const taskBalanceGini = gini([...durationByAgent.values()]);

  const leaderId = resolveLeaderId(input);
  const perAgent = perAgentActiveMs(input);
  const totalWork = [...perAgent.values()].reduce((acc, v) => acc + v, 0);
  const leaderWorkConcentration =
    leaderId !== null && totalWork > 0 ? (perAgent.get(leaderId) ?? 0) / totalWork : null;

  const dag = validateTaskDag(input.tasks, input.dependencies);
  const criticalPath = dag.criticalPath;
  let criticalAgentConcentration: number | null = null;
  if (criticalPath.available && criticalPath.totalMs !== null && criticalPath.totalMs > 0) {
    const agentDurations = new Map<string, number>();
    for (const taskId of criticalPath.taskIds) {
      const task = input.tasks.find((t) => t.id === taskId);
      if (!task) {
        continue;
      }
      const start = parseMs(task.startedAt);
      const end = parseMs(task.completedAt);
      if (start === null || end === null || end < start) {
        continue;
      }
      const assignment = input.assignments.find((a) => a.taskId === taskId);
      const agentId = assignment?.agentId ?? 'unassigned';
      agentDurations.set(agentId, (agentDurations.get(agentId) ?? 0) + (end - start));
    }
    let maxAgentDuration = 0;
    for (const duration of agentDurations.values()) {
      if (duration > maxAgentDuration) {
        maxAgentDuration = duration;
      }
    }
    criticalAgentConcentration = maxAgentDuration / criticalPath.totalMs;
  }

  // cross-agent review。
  const completed = input.tasks.filter((task) => task.status === 'completed');
  const producerByTask = new Map<string, string>();
  for (const assignment of input.assignments) {
    if (assignment.assignmentKind === 'claimed' || assignment.assignmentKind === 'assigned') {
      if (!producerByTask.has(assignment.taskId)) {
        producerByTask.set(assignment.taskId, assignment.agentId);
      }
    }
  }
  const reviewedTasks = new Set<string>();
  for (const assignment of input.assignments) {
    if (assignment.assignmentKind === 'review') {
      const producer = producerByTask.get(assignment.taskId);
      if (producer !== undefined && producer !== assignment.agentId) {
        reviewedTasks.add(assignment.taskId);
      }
    }
  }
  const crossAgentReviewed = completed.filter((task) => reviewedTasks.has(task.id));
  const crossAgentReview =
    completed.length > 0 ? crossAgentReviewed.length / completed.length : null;

  // duplicate-work signal（inferred heuristic：重复 contentHash）。
  const hashCount = new Map<string, number>();
  for (const artifact of input.artifacts) {
    if (artifact.contentHash === null) {
      continue;
    }
    hashCount.set(artifact.contentHash, (hashCount.get(artifact.contentHash) ?? 0) + 1);
  }
  let duplicateWorkSignal = 0;
  for (const count of hashCount.values()) {
    if (count > 1) {
      duplicateWorkSignal += count - 1;
    }
  }
  const duplicateWorkValue =
    input.artifacts.length > 0 ? duplicateWorkSignal : null;

  const evidence = collectEvidence([...input.communications, ...input.artifacts]);
  return {
    directRatio: metric(directRatio, 'direct messages / messages with known delivery mode', evidence, communicationComplete, direct.length, knownMessages.length),
    leaderMediatedRatio: metric(leaderMediatedRatio, 'leader-mediated messages / messages with known delivery mode', evidence, communicationComplete, leaderMediated.length, knownMessages.length),
    responseLatencyMedianMs: metric(responseLatencyMedianMs, 'median correlated request/reply latency', evidence, communicationComplete),
    responseLatencyP95Ms: metric(responseLatencyP95Ms, 'P95 correlated request/reply latency', evidence, communicationComplete),
    taskBalanceGini: metric(taskBalanceGini, 'Gini of completed-task active duration by agent', evidence, tasksComplete),
    leaderWorkConcentration: metric(leaderWorkConcentration, 'leader active time / total work (descriptive)', evidence, tasksComplete),
    criticalAgentConcentration: metric(criticalAgentConcentration, 'top-agent critical-path time / critical path', evidence, tasksComplete),
    crossAgentReview: metric(crossAgentReview, 'tasks verified by non-producer / completed tasks', evidence, tasksComplete, crossAgentReviewed.length, completed.length),
    duplicateWorkSignal: metric(duplicateWorkValue, 'duplicate contentHash artifacts (inferred heuristic)', evidence, outputsComplete),
  };
}

/**
 * run 级指标计算（design D9）。返回按计算版本持久化的 TeamMetrics；
 * 每个指标携带 availability / completeness / criteria / numerator / denominator /
 * evidence ids（§5.13）。
 */
export function computeTeamMetrics(input: TeamMetricsInput, generatedAt: string): TeamMetrics {
  const dag = validateTaskDag(input.tasks, input.dependencies);
  const criticalPathMs = dag.criticalPath.available ? dag.criticalPath.totalMs : null;
  return {
    calcVersion: TEAM_METRICS_CALC_VERSION,
    generatedAt,
    scheduling: computeScheduling(input, criticalPathMs),
    quality: computeQuality(input),
    stability: computeStability(input, dag.anomalies.length),
    cost: computeCost(input),
    collaboration: computeCollaboration(input),
  };
}
