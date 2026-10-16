import type {
  EvidenceConfidence,
  EvidenceRef,
  ProviderKey,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamCommunication,
  TeamCompleteness,
  TeamRound,
  TokenUsage,
} from '../core/trace-types.js';
import {
  TEAM_SOURCE_KIND_CODEX,
  canonicalEntityId,
  canonicalRunId,
  emptyCompleteness,
  goalFingerprintOf,
  makeEvidenceRef,
  makeOccurrenceCounter,
  mergeCompleteness,
  normalizeIso,
  normalizeMs,
  normalizeSeconds,
  normalizeTeamAgentState,
  type NormalizedTeamEvidence,
  type TeamRunFacts,
} from './team-codearts.js';

// ══════════════════════════════════════════════════════════════════════════
// Codex collaboration team 方言（§4.8–§4.10）。
//
// 严格只采 D1 证实的持久化协作源（evidence §1.2/§3.2）：
// - run 身份 = 根线程 id（correlated：根 id 本身 native，但「当作 team run 锚点」
//   是关联推导，不是源显式声明的 run 记录）
// - agent 身份 = thread id（native）
// - parent→child 边 = forked_from_id / parent_thread_id / thread_spawn.parent_thread_id
//   （native，有则）；老代际缺父链接时靠 sub_agent_activity.agent_thread_id 关联
//   （correlated），否则 topology 降级（G12.5）
// - 深度只来自 normalized edges（§4.11）；provider 名绝不推导三层（G12.1）
// - 通信 dimension 恒 unavailable（send_message 仅 schema 声明、0 次调用；agent_message
//   无 recipient，G12.2）
// - cost unavailable（无金额，rate_limits.credits.balance 恒 "0"，G12.3）
// - token native（token_count.info）
// ══════════════════════════════════════════════════════════════════════════

/** 每个 Codex thread 一个 JSONL 文件（scanner 分组后传入）。 */
export interface CodexThreadFile {
  /** 源文件路径（sessionKey 推导用）。 */
  sourcePath: string;
  /** 该文件逐行解析后的 JSON 事件。 */
  rows: unknown[];
}

/** session_meta 提取出的线程身份与父链接。 */
interface CodexThreadMeta {
  threadId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  spawnParentThreadId: string | null;
  threadSource: string | null;
  depth: number | null;
  nickname: string | null;
  path: string | null;
  role: string | null;
  modelProvider: string | null;
  timestamp: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 从一行事件提取 session_meta 线程身份。 */
function extractThreadMeta(row: unknown): CodexThreadMeta | null {
  const record = asRecord(row);
  if (record === null || record.type !== 'session_meta') {
    return null;
  }
  const payload = asRecord(record.payload);
  if (payload === null) {
    return null;
  }
  const id = str(payload.id);
  if (id === null) {
    return null;
  }
  const source = asRecord(payload.source);
  const subagent = source === null ? null : asRecord(source.subagent);
  const threadSpawn = subagent === null ? null : asRecord(subagent.thread_spawn);
  const forkedFromId = str(payload.forked_from_id) ?? str(payload.parent_thread_id);
  const spawnParent = threadSpawn === null ? null : str(threadSpawn.parent_thread_id);
  return {
    threadId: id,
    forkedFromId,
    parentThreadId: str(payload.parent_thread_id),
    spawnParentThreadId: spawnParent,
    threadSource: str(payload.thread_source),
    depth: threadSpawn === null ? null : num(threadSpawn.depth),
    nickname: str(payload.agent_nickname) ?? (threadSpawn === null ? null : str(threadSpawn.agent_nickname)),
    path: str(payload.agent_path) ?? (threadSpawn === null ? null : str(threadSpawn.agent_path)),
    role: (threadSpawn === null ? null : str(threadSpawn.agent_role)) ?? str(payload.agent_role),
    modelProvider: str(payload.model_provider),
    timestamp: str(payload.timestamp) ?? str(record.timestamp),
  };
}

/** 从 session_meta 提取 turn 模型名（turn_context.payload.model）。 */
function extractTurnModel(row: unknown): string | null {
  const record = asRecord(row);
  if (record === null || record.type !== 'turn_context') {
    return null;
  }
  const payload = asRecord(record.payload);
  return payload === null ? null : str(payload.model);
}

/** Codex token_count.info → TokenUsage（last_token_usage 优先，增量语义）。 */
function codexTokenUsage(row: unknown): TokenUsage | null {
  const record = asRecord(row);
  if (record === null || record.type !== 'event_msg') {
    return null;
  }
  const payload = asRecord(record.payload);
  if (payload === null || payload.type !== 'token_count') {
    return null;
  }
  const info = asRecord(payload.info);
  if (info === null) {
    return null;
  }
  const pick = asRecord(info.last_token_usage) ?? asRecord(info.total_token_usage);
  if (pick === null) {
    return null;
  }
  const n = (v: unknown): number => (num(v) ?? 0);
  const input = n(pick.input_tokens);
  const output = n(pick.output_tokens);
  const reasoning = n(pick.reasoning_output_tokens);
  const cacheRead = n(pick.cached_input_tokens);
  const cacheWrite = n(pick.cache_write_input_tokens);
  const total = n(pick.total_tokens) || input + output + reasoning + cacheRead + cacheWrite;
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    netInput: Math.max(0, input - cacheRead),
    total,
  };
}

/** 事件行所属线程（该文件第一个 session_meta 的 payload.id）。 */
function fileThreadId(rows: unknown[]): string | null {
  for (const row of rows) {
    const meta = extractThreadMeta(row);
    if (meta !== null) {
      return meta.threadId;
    }
  }
  return null;
}

/** 收集所有线程身份（跨文件去重，首个 session_meta 为身份锚点，后续幂等重复）。 */
function collectThreads(files: CodexThreadFile[]): Map<string, CodexThreadMeta> {
  const threads = new Map<string, CodexThreadMeta>();
  for (const file of files) {
    for (const row of file.rows) {
      const meta = extractThreadMeta(row);
      if (meta !== null && !threads.has(meta.threadId)) {
        threads.set(meta.threadId, meta);
      }
    }
  }
  return threads;
}

/** sub_agent_activity 记录：event_id/agent_thread_id/kind/occurred_at_ms + 宿主文件。 */
interface SubAgentActivity {
  eventId: string | null;
  agentThreadId: string | null;
  kind: string | null;
  occurredAtMs: number | null;
  hostThreadId: string | null;
}

function collectSubAgentActivities(files: CodexThreadFile[]): SubAgentActivity[] {
  const out: SubAgentActivity[] = [];
  for (const file of files) {
    const host = fileThreadId(file.rows);
    for (const row of file.rows) {
      const record = asRecord(row);
      if (record === null || record.type !== 'event_msg') {
        continue;
      }
      const payload = asRecord(record.payload);
      if (payload === null || payload.type !== 'sub_agent_activity') {
        continue;
      }
      out.push({
        eventId: str(payload.event_id),
        agentThreadId: str(payload.agent_thread_id),
        kind: str(payload.kind),
        occurredAtMs: num(payload.occurred_at_ms),
        hostThreadId: host,
      });
    }
  }
  return out;
}

/** 判定根线程（thread_source=user 优先，其次无父链接的线程）。 */
function findRootThread(
  threads: Map<string, CodexThreadMeta>,
  activities: SubAgentActivity[],
): string | null {
  const ids = [...threads.keys()];
  const userRoot = ids.find((id) => threads.get(id)!.threadSource === 'user');
  if (userRoot !== undefined) {
    return userRoot;
  }
  const childIds = new Set(activities.map((a) => a.agentThreadId).filter((v): v is string => v !== null));
  const parentIds = new Set(
    [...threads.values()]
      .map((t) => t.forkedFromId ?? t.parentThreadId ?? t.spawnParentThreadId)
      .filter((v): v is string => v !== null),
  );
  const root = ids.find((id) => !parentIds.has(id) && !childIds.has(id));
  return root ?? ids[0] ?? null;
}

const ROLE_CLASS_LEADER = 'leader';
const ROLE_CLASS_SUBAGENT = 'subagent';
const ROLE_CLASS_UNKNOWN = 'unknown';

function codexRoleClass(meta: CodexThreadMeta, isRoot: boolean): string {
  if (isRoot) {
    return ROLE_CLASS_LEADER;
  }
  if (meta.threadSource === 'subagent' || meta.forkedFromId !== null || meta.depth !== null) {
    return ROLE_CLASS_SUBAGENT;
  }
  return ROLE_CLASS_UNKNOWN;
}

function codexDisplayName(meta: CodexThreadMeta, isRoot: boolean): string {
  if (!isRoot) {
    return meta.nickname ?? meta.path ?? meta.threadId;
  }
  return meta.nickname ?? 'root';
}

/**
 * 父边来源：forked_from_id / parent_thread_id / thread_spawn.parent_thread_id（native）；
 * 三者皆缺时用 sub_agent_activity.agent_thread_id 关联到宿主线程（correlated，G12.5）。
 */
function resolveParent(
  meta: CodexThreadMeta,
  activities: SubAgentActivity[],
): { parentThreadId: string | null; confidence: EvidenceConfidence } {
  const native = meta.forkedFromId ?? meta.parentThreadId ?? meta.spawnParentThreadId;
  if (native !== null) {
    return { parentThreadId: native, confidence: 'native' };
  }
  const activity = activities.find((a) => a.agentThreadId === meta.threadId && a.hostThreadId !== null);
  if (activity !== undefined && activity.hostThreadId !== meta.threadId) {
    return { parentThreadId: activity.hostThreadId, confidence: 'correlated' };
  }
  return { parentThreadId: null, confidence: 'unavailable' };
}

// ══════════════════════════════════════════════════════════════════════════
// parseCodexTeam（纯解析，核心逻辑，测试直接调用）
// ══════════════════════════════════════════════════════════════════════════

export function parseCodexTeam(
  files: CodexThreadFile[],
  sourceLocator: string,
  resolveSessionKey?: (nativeId: string) => string | null,
): NormalizedTeamEvidence {
  const provider: ProviderKey = 'codex';
  const evidence: EvidenceRef[] = [];
  const threads = collectThreads(files);
  const activities_ = collectSubAgentActivities(files);
  const rootThreadId = findRootThread(threads, activities_);
  if (rootThreadId === null) {
    throw new Error('Codex team run 无稳定 run 身份（无 session_meta 线程）');
  }
  const runId = canonicalRunId(provider, rootThreadId);
  const occurrence = makeOccurrenceCounter();

  const ref = (
    nativeId: string | null,
    sequence: number | null,
    confidence: EvidenceConfidence,
  ): string => {
    const r = makeEvidenceRef({
      provider,
      nativeRunId: rootThreadId,
      sourceKind: TEAM_SOURCE_KIND_CODEX,
      sourceLocator,
      nativeId,
      nativeSequence: sequence,
      confidence,
      ordinal: occurrence.next(nativeId ?? ''),
    });
    evidence.push(r);
    return r.id;
  };

  const sessionKeyOf = resolveSessionKey ?? ((): string | null => null);

  // ── agents（每个 thread id 一个；root→leader，depth-1 subagent→subagent） ──
  const agents: TeamAgent[] = [];
  const agentByNative = new Map<string, string>();
  let agentIndex = 0;
  for (const [threadId, meta] of threads) {
    const isRoot = threadId === rootThreadId;
    const agentId = canonicalEntityId(provider, rootThreadId, 'agent', threadId);
    const evId = ref(threadId, agentIndex, 'native');
    const sessionKey = sessionKeyOf(threadId);
    agents.push({
      id: agentId,
      runId,
      nativeId: threadId,
      displayName: codexDisplayName(meta, isRoot),
      role: meta.role ?? meta.nickname ?? (isRoot ? 'root' : meta.threadSource ?? 'unknown'),
      roleClass: codexRoleClass(meta, isRoot),
      model: meta.modelProvider,
      state: normalizeTeamAgentState(isRoot ? 'running' : 'created'),
      createdAt: normalizeIso(meta.timestamp),
      endedAt: null,
      sessionKeys: sessionKey === null ? [] : [sessionKey],
      evidenceIds: [evId],
    });
    agentByNative.set(threadId, agentId);
    agentIndex += 1;
  }

  // ── agent edges（parent→child 结构边；§4.11 拓扑只来自 edges） ──
  const agentEdges: TeamAgentEdge[] = [];
  let edgeIndex = 0;
  for (const [threadId, meta] of threads) {
    if (threadId === rootThreadId) {
      continue;
    }
    const { parentThreadId, confidence } = resolveParent(meta, activities_);
    if (parentThreadId === null) {
      continue;
    }
    const fromId = agentByNative.get(parentThreadId);
    const toId = agentByNative.get(threadId);
    if (fromId === undefined || toId === undefined || fromId === toId) {
      edgeIndex += 1;
      continue;
    }
    const evId = ref(`${parentThreadId}->${threadId}`, edgeIndex, confidence);
    agentEdges.push({
      id: canonicalEntityId(provider, rootThreadId, 'edge', `${parentThreadId}:${threadId}:supervises`),
      runId,
      fromAgentId: fromId,
      toAgentId: toId,
      kind: 'supervises',
      validFrom: normalizeIso(meta.timestamp),
      validTo: null,
      confidence,
      evidenceIds: [evId],
    });
    edgeIndex += 1;
  }

  // ── activities（sub_agent_activity / task_started / task_complete / token_count） ──
  const activities: TeamActivitySlim[] = [];
  const rounds: TeamRound[] = [];
  let activityIndex = 0;
  for (const file of files) {
    const hostThreadId = fileThreadId(file.rows);
    const hostAgentId = hostThreadId === null ? null : (agentByNative.get(hostThreadId) ?? null);
    for (const row of file.rows) {
      const record = asRecord(row);
      if (record === null) {
        continue;
      }
      if (record.type === 'event_msg') {
        const payload = asRecord(record.payload);
        if (payload === null) {
          continue;
        }
        if (payload.type === 'sub_agent_activity') {
          const targetAgentId =
            str(payload.agent_thread_id) === null
              ? null
              : (agentByNative.get(str(payload.agent_thread_id)!) ?? null);
          const evId = ref(str(payload.event_id), activityIndex, 'native');
          activities.push({
            id: canonicalEntityId(provider, rootThreadId, 'act', str(payload.event_id) ?? `sa-${activityIndex}`),
            runId,
            agentId: targetAgentId ?? hostAgentId,
            taskId: null,
            roundId: null,
            kind: 'agent_lifecycle',
            status: str(payload.kind) === 'started' ? 'running' : 'success',
            startedAt: normalizeMs(num(payload.occurred_at_ms)),
            endedAt: null,
            nativeSequence: activityIndex,
            sessionKey: hostThreadId === null ? null : sessionKeyOf(hostThreadId),
            eventId: str(payload.event_id),
            turnKey: null,
            messageId: null,
            artifactId: null,
            tokenUsage: null,
            costUsd: null,
            costSource: null,
            costCurrency: null,
            hasInput: false,
            hasOutput: false,
            hasRaw: false,
            evidenceIds: [evId],
            orderConfidence: 'ambiguous',
          });
        } else if (payload.type === 'task_started' || payload.type === 'task_complete') {
          const turnId = str(payload.turn_id);
          const completed = payload.type === 'task_complete';
          const evId = ref(turnId, activityIndex, 'native');
          activities.push({
            id: canonicalEntityId(provider, rootThreadId, 'act', turnId ?? `${payload.type}-${activityIndex}`),
            runId,
            agentId: hostAgentId,
            taskId: null,
            roundId: null,
            kind: 'round',
            status: completed ? 'success' : 'running',
            startedAt: completed
              ? normalizeSeconds(num(payload.started_at))
              : normalizeSeconds(num(payload.started_at)),
            endedAt: completed ? normalizeSeconds(num(payload.completed_at)) : null,
            nativeSequence: activityIndex,
            sessionKey: hostThreadId === null ? null : sessionKeyOf(hostThreadId),
            eventId: null,
            turnKey: turnId,
            messageId: null,
            artifactId: null,
            tokenUsage: null,
            costUsd: null,
            costSource: null,
            costCurrency: null,
            hasInput: false,
            hasOutput: completed,
            hasRaw: false,
            evidenceIds: [evId],
            orderConfidence: 'ambiguous',
          });
        } else if (payload.type === 'token_count') {
          const tokenUsage = codexTokenUsage(row);
          const evId = ref('token_count', activityIndex, 'native');
          activities.push({
            id: canonicalEntityId(provider, rootThreadId, 'act', `token-${activityIndex}`),
            runId,
            agentId: hostAgentId,
            taskId: null,
            roundId: null,
            kind: 'round',
            status: 'success',
            startedAt: normalizeIso(str(record.timestamp)),
            endedAt: null,
            nativeSequence: activityIndex,
            sessionKey: hostThreadId === null ? null : sessionKeyOf(hostThreadId),
            eventId: null,
            turnKey: null,
            messageId: null,
            artifactId: null,
            tokenUsage,
            costUsd: null,
            costSource: null,
            costCurrency: null,
            hasInput: false,
            hasOutput: false,
            hasRaw: false,
            evidenceIds: [evId],
            orderConfidence: 'ambiguous',
          });
        }
      }
      activityIndex += 1;
    }
  }

  // ── communications：unavailable（§G12.2，send_message 未调用、agent_message 无 recipient） ──
  const communications: TeamCommunication[] = [];

  // ── run facts ──
  const rootMeta = threads.get(rootThreadId);
  const turnModel = files
    .flatMap((f) => f.rows)
    .map(extractTurnModel)
    .find((m): m is string => m !== null);
  const title = rootMeta?.nickname ?? rootMeta?.threadId ?? '';
  const hasTokens = activities.some((a) => a.tokenUsage !== null);
  const hasCost = false;

  const runFacts: TeamRunFacts = {
    provider,
    runId,
    nativeRunId: rootThreadId,
    runIdentityConfidence: 'correlated',
    title,
    goalFingerprint: goalFingerprintOf(title),
    status: 'running',
    startedAt: normalizeIso(rootMeta?.timestamp),
    endedAt: null,
    tokenAvailable: hasTokens,
    costAvailable: hasCost,
    costCurrency: null,
  };
  void turnModel;

  const completeness = mergeCompleteness(codexTeamCapabilities(), {
    topology: agentEdges.length > 0 ? 'complete' : 'partial',
    tasks: 'unavailable',
    communication: 'unavailable',
    timing: 'partial',
    tools: activities.some((a) => a.kind === 'tool_call') ? 'complete' : 'partial',
    outputs: 'partial',
    tokens: hasTokens ? 'complete' : 'unavailable',
    cost: 'unavailable',
    verification: 'unavailable',
  });

  return {
    run: runFacts,
    agents,
    agentEdges,
    tasks: [],
    taskDependencies: [],
    assignments: [],
    communications,
    activities,
    rounds,
    artifacts: [],
    evidence,
    completeness,
  };
}

/** Codex provider 级能力基线（evidence §6 completeness matrix）。 */
export function codexTeamCapabilities(): TeamCompleteness {
  return mergeCompleteness(emptyCompleteness(), {
    topology: 'partial',
    tasks: 'partial',
    communication: 'unavailable',
    timing: 'partial',
    tools: 'complete',
    outputs: 'partial',
    tokens: 'complete',
    cost: 'unavailable',
    verification: 'unavailable',
  });
}
