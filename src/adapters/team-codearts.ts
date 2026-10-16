import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import type {
  EvidenceConfidence,
  EvidenceDimension,
  EvidenceRef,
  PriceCurrency,
  ProviderKey,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamAgentState,
  TeamArtifact,
  TeamAssignment,
  TeamCommunication,
  TeamCompleteness,
  TeamRound,
  TeamRunStatus,
  TeamTask,
  TeamTaskDependency,
  TeamTaskStatus,
  TokenUsage,
  TraceStatus,
} from '../core/trace-types.js';
import { normalizeStatus } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// §4.1 共享 team-dialect adapter 边界（design D16）。
//
// 本文件是 CodeArts 方言实现，同时导出两个 team 方言共用的 adapter 边界、
// 规范化类型与规范化 helpers（tasks.md §4.1–§4.2）。Codex 方言
// （`team-codex.ts`）与 scanner（`local-sessions/team-scanner.ts`）从这里
// import 共享边界。依赖方向保持 src/adapters → src/core，不反向。
//
// 分层：本文件是**纯解析层**（不读文件系统、不碰 DB）。discover / fingerprint
// 与磁盘读取由 `local-sessions/team-scanner.ts` 组合实现（design D16 的四方法
// 边界作为类型在此冻结）。
// ══════════════════════════════════════════════════════════════════════════

/** team parser 版本。解析语义变更必须 bump（design D12 parser-version invalidation）。 */
export const TEAM_PARSER_VERSION = 'team-v1';

/** EvidenceRef.sourceKind 的冻结取值集合（contracts/data-model.md §12.2）。 */
export const TEAM_SOURCE_KIND_CODEARTS = 'agent-team-directory';
export const TEAM_SOURCE_KIND_CODEX = 'codex-jsonl';

/** 每个 dialect adapter 需要枚举/读取的源集合（由 scanner 组装）。 */
export interface TeamSource {
  /** 源根目录（已展开绝对路径，如 ~/.codeartsdoer/agent-team）。 */
  root: string;
  /** 方言相关的附加源路径（如 CodeArts 的 opencode.db）。 */
  auxiliary: string[];
}

/** discover 阶段产出的 run 候选（身份 + 构成该 run 的源文件，不读正文）。 */
export interface TeamRunCandidate {
  provider: ProviderKey;
  /** canonical run id（确定性，跨 run 分离）。 */
  runId: string;
  /** provider-native run 身份（CodeArts = leader sessionID；Codex = 根线程 id）。 */
  nativeRunId: string;
  /** run 身份置信度（CodeArts native / Codex correlated）。 */
  runIdentityConfidence: EvidenceConfidence;
  /** 脱敏源定位器。 */
  sourceLocator: string;
  /** 参与该 run 的源文件路径（fingerprint / no-change 用）。 */
  sourcePaths: string[];
}

/**
 * run 级事实（adapter 产出，不含 storage/纯核心派生的 topologyKind/counts/stamp/updatedAt）。
 * 与 `TeamRunSummary` 对应，但只含 adapter 能从源里拿到的字段。
 */
export interface TeamRunFacts {
  provider: ProviderKey;
  runId: string;
  nativeRunId: string;
  runIdentityConfidence: EvidenceConfidence;
  title: string;
  goalFingerprint: string | null;
  status: TeamRunStatus;
  startedAt: string | null;
  endedAt: string | null;
  tokenAvailable: boolean;
  costAvailable: boolean;
  costCurrency: PriceCurrency | null;
}

/** adapter 产出的完整规范化证据（canonical 实体 + evidence + completeness）。 */
export interface NormalizedTeamEvidence {
  run: TeamRunFacts;
  agents: TeamAgent[];
  agentEdges: TeamAgentEdge[];
  tasks: TeamTask[];
  taskDependencies: TeamTaskDependency[];
  assignments: TeamAssignment[];
  communications: TeamCommunication[];
  activities: TeamActivitySlim[];
  rounds: TeamRound[];
  artifacts: TeamArtifact[];
  evidence: EvidenceRef[];
  completeness: TeamCompleteness;
}

/**
 * team dialect adapter 边界（design D16 四方法）。文件系统相关方法的**组合实现**
 * 位于 scanner 层；此处只冻结签名，纯解析函数（parseCodeArtsTeam / parseCodexTeam）
 * 是每个 dialect 的核心、可直接单测。
 */
export interface TeamDialectAdapter {
  readonly provider: ProviderKey;
  discoverTeamRuns(source: TeamSource): TeamRunCandidate[];
  parseTeamRun(candidate: TeamRunCandidate, source: TeamSource): NormalizedTeamEvidence;
  capabilities(): TeamCompleteness;
  fingerprint(source: TeamSource): string;
}

// ══════════════════════════════════════════════════════════════════════════
// §4.2 规范化 helpers（id / 时间戳 / 源序 / confidence / redaction / completeness）
// ══════════════════════════════════════════════════════════════════════════

/** 确定性 canonical id 拼接（design D4 优先级 2：native id 由 run id 作用域化）。 */
export function canonicalId(parts: ReadonlyArray<string | number>): string {
  return ['team', ...parts.map(String)].join(':');
}

/** canonical run id。 */
export function canonicalRunId(provider: ProviderKey, nativeRunId: string): string {
  return canonicalId([provider, 'run', nativeRunId]);
}

/**
 * canonical 实体 id。`nativeId` 为 null 时用 kind 自身 + ordinal 定位（无原生 id 的
 * edge/dependency/assignment/activity/evidence）。`ordinal` 用于同 native id 的重复
 * occurrence（design D4 / tasks §4.2：未变重扫稳定、跨 run 分离）。
 */
export function canonicalEntityId(
  provider: ProviderKey,
  nativeRunId: string,
  entityKind: string,
  nativeId: string | number | null,
  ordinal = 0,
): string {
  const idPart = nativeId === null ? 'n' : String(nativeId);
  const ord = ordinal > 0 ? `#${ordinal}` : '';
  return canonicalId([provider, 'run', nativeRunId, entityKind, `${idPart}${ord}`]);
}

/** 确定性 SHA-256（design D4 优先级 3：evidence id / goal fingerprint）。 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 证据引用 id（SHA-256 覆盖 provider/locator/run/entity/native id/sequence/ordinal）。 */
export function evidenceId(input: string): string {
  return `team:ev:${sha256Hex(input).slice(0, 32)}`;
}

/** 脱敏源定位器：绝对 home 前缀替换为 `~`（design D18；真实路径留服务端）。 */
export function redactLocator(path: string): string {
  const home = homedir();
  if (home !== '' && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

// ── 时间戳归一化（evidence §7 决策 1：三套/两套格式统一为 ISO 8601 UTC） ──

/** 已是 ISO 8601 的字符串：校验通过则原样返回，否则 null。 */
export function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** epoch 毫秒 → ISO。 */
export function normalizeMs(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value).toISOString();
}

/** epoch 秒 → ISO（Codex task_* 用 unix s）。 */
export function normalizeSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(Math.round(value * 1000)).toISOString();
}

/**
 * `team-task.json.startedAt` 本地串（`"8/17/2026, 11:31:52 PM"`）按 UTC+8 解析
 * （evidence §7 决策 1：`15:31:52Z == 23:31:52 +08:00`，同刻异表示）。
 */
export function normalizeLocalStringUtc8(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const m =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(
      value.trim(),
    );
  if (m === null) {
    return null;
  }
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const ampm = m[7]!.toUpperCase();
  if (ampm === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm === 'AM' && hour === 12) {
    hour = 0;
  }
  // UTC+8 → UTC：本地时刻减 8 小时。
  const utc = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  return Number.isNaN(utc) ? null : new Date(utc).toISOString();
}

// ── 状态归一化（provider 原生状态 → 闭合 team 枚举） ──

const TEAM_RUN_STATUS_MAP: Record<string, TeamRunStatus> = {
  running: 'running',
  in_progress: 'running',
  planned: 'planned',
  blocked: 'blocked',
  completed: 'success',
  done: 'success',
  finished: 'success',
  success: 'success',
  failed: 'error',
  error: 'error',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function normalizeTeamRunStatus(raw: unknown): TeamRunStatus {
  if (typeof raw !== 'string') {
    return 'unknown';
  }
  return TEAM_RUN_STATUS_MAP[raw.trim().toLowerCase()] ?? 'unknown';
}

const TEAM_AGENT_STATE_MAP: Record<string, TeamAgentState> = {
  created: 'created',
  ready: 'ready',
  running: 'busy',
  in_progress: 'busy',
  busy: 'busy',
  blocked: 'blocked',
  idle: 'idle',
  failed: 'failed',
  error: 'failed',
  replaced: 'replaced',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  completed: 'completed',
  done: 'completed',
};

export function normalizeTeamAgentState(raw: unknown): TeamAgentState {
  if (typeof raw !== 'string') {
    return 'unknown';
  }
  return TEAM_AGENT_STATE_MAP[raw.trim().toLowerCase()] ?? 'unknown';
}

const TEAM_TASK_STATUS_MAP: Record<string, TeamTaskStatus> = {
  pending: 'pending',
  ready: 'ready',
  claimed: 'claimed',
  running: 'running',
  in_progress: 'running',
  blocked: 'blocked',
  completed: 'completed',
  done: 'completed',
  finished: 'completed',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function normalizeTeamTaskStatus(raw: unknown): TeamTaskStatus {
  if (typeof raw !== 'string') {
    return 'unknown';
  }
  return TEAM_TASK_STATUS_MAP[raw.trim().toLowerCase()] ?? 'unknown';
}

/** 归一化 TraceStatus（活动自身执行结果，复用 helpers.normalizeStatus）。 */
export function normalizeActivityStatus(raw: unknown): TraceStatus {
  return normalizeStatus(raw as string | null | undefined);
}

/** 空九维 completeness（全部 unavailable）。 */
export function emptyCompleteness(): TeamCompleteness {
  const dims: EvidenceDimension[] = [
    'topology',
    'tasks',
    'communication',
    'timing',
    'tools',
    'outputs',
    'tokens',
    'cost',
    'verification',
  ];
  const out = {} as TeamCompleteness;
  for (const dim of dims) {
    out[dim] = 'unavailable';
  }
  return out;
}

/** 合并 provider 能力基线 + per-run 覆盖（覆盖层可把 unavailable 升为 complete/partial）。 */
export function mergeCompleteness(
  base: TeamCompleteness,
  overlay: Partial<TeamCompleteness>,
): TeamCompleteness {
  return { ...base, ...overlay };
}

/** 构造 EvidenceRef（绝不内嵌源正文，design D4/D18）。 */
export function makeEvidenceRef(input: {
  provider: ProviderKey;
  nativeRunId: string;
  sourceKind: string;
  sourceLocator: string;
  nativeId: string | null;
  nativeSequence: number | null;
  confidence: EvidenceConfidence;
  ordinal?: number;
}): EvidenceRef {
  const { provider, nativeRunId, sourceKind, sourceLocator, nativeId, nativeSequence, confidence } =
    input;
  const id = evidenceId(
    [
      provider,
      nativeRunId,
      sourceKind,
      sourceLocator,
      nativeId ?? '',
      nativeSequence ?? '',
      input.ordinal ?? 0,
    ].join(':'),
  );
  return {
    id,
    sourceKind,
    sourceLocator,
    nativeId,
    nativeSequence,
    capturedAt: new Date().toISOString(),
    confidence,
    parserVersion: TEAM_PARSER_VERSION,
  };
}

/** 目标采集器：同 native id 的重复 occurrence 赋予稳定 ordinal（§4.2）。 */
export function makeOccurrenceCounter(): { next(nativeKey: string): number } {
  const seen = new Map<string, number>();
  return {
    next(nativeKey: string): number {
      const count = seen.get(nativeKey) ?? 0;
      seen.set(nativeKey, count + 1);
      return count;
    },
  };
}

/** goal 指纹：脱敏归一化 SHA-256（design D18，正文只进 detail）。 */
export function goalFingerprintOf(title: string | null | undefined): string | null {
  if (title === null || title === undefined) {
    return null;
  }
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === '') {
    return null;
  }
  return sha256Hex(normalized).slice(0, 24);
}

// ══════════════════════════════════════════════════════════════════════════
// CodeArts raw 源形状（对齐 openspec/research/fixtures/ 的脱敏 fixture）
// ══════════════════════════════════════════════════════════════════════════

/** contact.json 单个成员条目。 */
export interface CodeArtsContactMember {
  sessionID: string;
  parentSessionID?: string;
  modelInfo?: { providerID?: string; modelID?: string };
  agent_type?: string;
  description?: string;
  agent_name?: string;
  status?: string;
  startedAt?: string;
  lastUpdated?: string;
}

/** team-task.json 单个任务条目。 */
export interface CodeArtsTeamTaskEntry {
  id: number;
  blocked_by?: number[];
  content?: string;
  target_files?: string[];
  status?: string;
  owner?: string;
  owner_name?: string;
  publisher?: string;
  publisher_name?: string;
  createdAt?: number;
  startedAt?: string;
}

/** opencode.db session 行（父链/标题/时间戳）。 */
export interface CodeArtsSessionRow {
  id: string;
  parent_id?: string | null;
  type?: string | null;
  title?: string | null;
  directory?: string | null;
  time_created?: number | null;
  time_updated?: number | null;
}

/** opencode.db message 行（时间戳）。 */
export interface CodeArtsMessageRow {
  id: string;
  session_id: string;
  time_created?: number | null;
  data?: Record<string, unknown> | null;
}

/** opencode.db part 行（工具调用 / step-finish token/cost）。 */
export interface CodeArtsPartRow {
  id: string;
  message_id: string;
  session_id: string;
  data?: Record<string, unknown> | null;
}

/** opencode.db cag_session_extra 行（type="claw" 辅助标记，correlated）。 */
export interface CodeArtsCagSessionExtraRow {
  session_id: string;
  type?: string | null;
  extra_info?: unknown;
}

/** CodeArts 方言合并后的 raw 输入。 */
export interface CodeArtsTeamRaw {
  contact: Record<string, CodeArtsContactMember>;
  teamTask: CodeArtsTeamTaskEntry[];
  sessions?: CodeArtsSessionRow[];
  messages?: CodeArtsMessageRow[];
  parts?: CodeArtsPartRow[];
  cagSessionExtra?: CodeArtsCagSessionExtraRow[];
  sourceLocator: string;
}

const ROLE_CLASS_LEADER = 'leader';
const ROLE_CLASS_TEAMMATE = 'teammate';
const ROLE_CLASS_UNKNOWN = 'unknown';

function codeArtsRoleClass(agentType: string | undefined): string {
  if (agentType === 'team-leader') {
    return ROLE_CLASS_LEADER;
  }
  if (agentType === 'team-mate') {
    return ROLE_CLASS_TEAMMATE;
  }
  return ROLE_CLASS_UNKNOWN;
}

function codeArtsModel(modelInfo?: { providerID?: string; modelID?: string }): string | null {
  if (modelInfo === undefined) {
    return null;
  }
  const parts = [modelInfo.providerID, modelInfo.modelID].filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  return parts.length === 0 ? null : parts.join('/');
}

/** 从 contact.json 判定 leader（agent_type === 'team-leader'）。 */
function findLeader(contact: Record<string, CodeArtsContactMember>): CodeArtsContactMember | null {
  for (const member of Object.values(contact)) {
    if (member.agent_type === 'team-leader') {
      return member;
    }
  }
  return null;
}

/** 从 sessions 找根（parent_id 为 null/空，且 cag_session_extra.type === 'claw' 辅助）。 */
function findRootSession(
  sessions: CodeArtsSessionRow[] | undefined,
  clawIds: ReadonlySet<string>,
): CodeArtsSessionRow | null {
  if (sessions === undefined || sessions.length === 0) {
    return null;
  }
  const roots = sessions.filter(
    (s) => s.parent_id === null || s.parent_id === undefined || s.parent_id === '',
  );
  if (roots.length === 1) {
    return roots[0]!;
  }
  const clawRoot = roots.find((s) => clawIds.has(s.id));
  return clawRoot ?? roots[0] ?? null;
}

/** step-finish part 的 token 数据 → TokenUsage。 */
function codeArtsTokenUsage(tokens: unknown): TokenUsage | null {
  if (typeof tokens !== 'object' || tokens === null) {
    return null;
  }
  const t = tokens as {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { write?: number; read?: number };
  };
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const input = num(t.input);
  const output = num(t.output);
  const reasoning = num(t.reasoning);
  const cacheRead = num(t.cache?.read);
  const cacheWrite = num(t.cache?.write);
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    netInput: Math.max(0, input - cacheRead),
    total: num(t.total) || input + output + reasoning + cacheRead + cacheWrite,
  };
}

/** step-finish part 的 cost（USD，native）。 */
function codeArtsCost(cost: unknown): number | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) {
    return null;
  }
  return cost;
}

/** 从 parts 的 message_id 反查 message time_created（ms）。 */
function findMessageTime(raw: CodeArtsTeamRaw, messageId: string | undefined): number | null {
  if (messageId === undefined || messageId === '') {
    return null;
  }
  const message = (raw.messages ?? []).find((m) => m.id === messageId);
  return message?.time_created ?? null;
}

/** 从 parts 收集 get-my-task 认领的 task id（输出里的 `id` 字段）。 */
function collectClaimedTaskIds(raw: CodeArtsTeamRaw): ReadonlySet<number> {
  const claimed = new Set<number>();
  for (const part of raw.parts ?? []) {
    const data = part.data ?? {};
    if (data.type !== 'tool' || data.tool !== 'get-my-task') {
      continue;
    }
    const output = (data.state as { output?: unknown } | undefined)?.output;
    if (typeof output !== 'string') {
      continue;
    }
    // get-my-task 输出形如 `[... {"id": 1, ...}]`；只提取 id 数字，绝不当作正文外发。
    for (const m of output.matchAll(/"id"\s*:\s*(\d+)/g)) {
      const id = Number(m[1]);
      if (Number.isInteger(id)) {
        claimed.add(id);
      }
    }
  }
  return claimed;
}

// ══════════════════════════════════════════════════════════════════════════
// parseCodeArtsTeam（纯解析，核心逻辑，测试直接调用）
// ══════════════════════════════════════════════════════════════════════════

/**
 * CodeArts 规范化（§4.3–§4.7）。严格只采 D1 证实的源字段：
 * - run 身份 = leader sessionID（contact["team-leader"].sessionID；三源一致 native）
 * - agent 身份 = 各成员 sessionID（native）
 * - leader→member 边 = contact[member].parentSessionID == leader id（native）
 * - 模板意图（get-team-setup 输出）≠ 运行时成员（design D16 / G12.6）
 * - Task List = team-task.json；To-Do（opencode.db.todo）≠ Task List（G12.7）
 * - 通信 dimension 恒 unavailable（无 sender/recipient，G12.2）
 * - cost = step-finish.cost USD（native）；tokens = step-finish.tokens（native）
 */
export function parseCodeArtsTeam(raw: CodeArtsTeamRaw): NormalizedTeamEvidence {
  const provider: ProviderKey = 'codearts';
  const evidence: EvidenceRef[] = [];
  const sourceLocator = raw.sourceLocator;

  const leader = findLeader(raw.contact);
  const clawIds = new Set(
    (raw.cagSessionExtra ?? []).filter((r) => r.type === 'claw').map((r) => r.session_id),
  );
  const rootSession = leader === null ? findRootSession(raw.sessions, clawIds) : null;
  const nativeRunId = leader?.sessionID ?? rootSession?.id ?? null;
  if (nativeRunId === null) {
    throw new Error('CodeArts team run 无稳定 run 身份（contact 无 team-leader 且 sessions 无根）');
  }
  const runId = canonicalRunId(provider, nativeRunId);
  const occurrence = makeOccurrenceCounter();

  const ref = (
    nativeId: string | null,
    sequence: number | null,
    confidence: EvidenceConfidence,
  ): string => {
    const r = makeEvidenceRef({
      provider,
      nativeRunId,
      sourceKind: TEAM_SOURCE_KIND_CODEARTS,
      sourceLocator,
      nativeId,
      nativeSequence: sequence,
      confidence,
      ordinal: occurrence.next(nativeId ?? ''),
    });
    evidence.push(r);
    return r.id;
  };

  // ── agents（§4.4：Leader/Teammate；模板意图不计入成员） ──
  const agents: TeamAgent[] = [];
  const agentByNative = new Map<string, string>();
  let contactIndex = 0;
  for (const [memberName, member] of Object.entries(raw.contact)) {
    const sessionId = member.sessionID;
    if (sessionId === undefined || sessionId === '') {
      contactIndex += 1;
      continue;
    }
    const agentId = canonicalEntityId(provider, nativeRunId, 'agent', sessionId);
    const evId = ref(sessionId, contactIndex, 'native');
    agents.push({
      id: agentId,
      runId,
      nativeId: sessionId,
      displayName: member.agent_name ?? memberName,
      role: member.agent_type ?? 'unknown',
      roleClass: codeArtsRoleClass(member.agent_type),
      model: codeArtsModel(member.modelInfo),
      state: normalizeTeamAgentState(member.status),
      createdAt: normalizeIso(member.startedAt),
      endedAt: null,
      sessionKeys: [],
      evidenceIds: [evId],
    });
    agentByNative.set(sessionId, agentId);
    contactIndex += 1;
  }

  // ── agent edges（leader→member 结构边，native；§4.11 拓扑只来自 edges） ──
  const agentEdges: TeamAgentEdge[] = [];
  let edgeIndex = 0;
  for (const member of Object.values(raw.contact)) {
    if (member.parentSessionID === undefined || member.parentSessionID === '') {
      edgeIndex += 1;
      continue;
    }
    const fromId = agentByNative.get(member.parentSessionID);
    const toId = agentByNative.get(member.sessionID);
    if (fromId === undefined || toId === undefined || fromId === toId) {
      edgeIndex += 1;
      continue;
    }
    const memberSession = (raw.sessions ?? []).find((s) => s.id === member.sessionID);
    const evId = ref(`${member.parentSessionID}->${member.sessionID}`, edgeIndex, 'native');
    agentEdges.push({
      id: canonicalEntityId(
        provider,
        nativeRunId,
        'edge',
        `${member.parentSessionID}:${member.sessionID}:supervises`,
      ),
      runId,
      fromAgentId: fromId,
      toAgentId: toId,
      kind: 'supervises',
      validFrom: normalizeIso(member.startedAt) ?? normalizeMs(memberSession?.time_created),
      validTo: null,
      confidence: 'native',
      evidenceIds: [evId],
    });
    edgeIndex += 1;
  }

  // ── tasks（§4.5：Task List；team-task.json） ──
  const tasks: TeamTask[] = [];
  const taskByNative = new Map<number, string>();
  let taskIndex = 0;
  for (const entry of raw.teamTask) {
    const taskId = canonicalEntityId(provider, nativeRunId, 'task', entry.id);
    const evId = ref(`task:${entry.id}`, taskIndex, 'native');
    tasks.push({
      id: taskId,
      runId,
      nativeId: String(entry.id),
      title: entry.content ?? '',
      descriptionAvailable: typeof entry.content === 'string' && entry.content !== '',
      priority: null,
      status: normalizeTeamTaskStatus(entry.status),
      createdAt:
        normalizeMs(entry.createdAt) ??
        normalizeIso(entry.startedAt) ??
        normalizeLocalStringUtc8(entry.startedAt),
      startedAt: normalizeIso(entry.startedAt) ?? normalizeLocalStringUtc8(entry.startedAt),
      completedAt: null,
      cancelledAt: null,
      failedAt: null,
      resultAvailable: false,
      evidenceIds: [evId],
    });
    taskByNative.set(entry.id, taskId);
    taskIndex += 1;
  }

  // ── task dependencies（§4.5：blocked_by → upstream→downstream） ──
  const taskDependencies: TeamTaskDependency[] = [];
  let depIndex = 0;
  for (const entry of raw.teamTask) {
    for (const upstream of entry.blocked_by ?? []) {
      const upId = taskByNative.get(upstream);
      const downId = taskByNative.get(entry.id);
      if (upId === undefined || downId === undefined || upId === downId) {
        depIndex += 1;
        continue;
      }
      const evId = ref(`dep:${upstream}->${entry.id}`, depIndex, 'native');
      taskDependencies.push({
        id: canonicalEntityId(provider, nativeRunId, 'dep', `${upstream}:${entry.id}`),
        runId,
        upstreamTaskId: upId,
        downstreamTaskId: downId,
        validFrom: null,
        validTo: null,
        confidence: 'native',
        evidenceIds: [evId],
      });
      depIndex += 1;
    }
  }

  // ── assignments（§4.5：owner sessionID → 指派；get-my-task → claimed） ──
  const assignments: TeamAssignment[] = [];
  const claimedTaskIds = collectClaimedTaskIds(raw);
  let assignIndex = 0;
  for (const entry of raw.teamTask) {
    if (typeof entry.owner !== 'string' || entry.owner === '') {
      assignIndex += 1;
      continue;
    }
    const agentId = agentByNative.get(entry.owner);
    const taskId = taskByNative.get(entry.id);
    if (agentId === undefined || taskId === undefined) {
      assignIndex += 1;
      continue;
    }
    const kind = claimedTaskIds.has(entry.id) ? 'claimed' : 'assigned';
    const evId = ref(`assign:${entry.id}->${entry.owner}`, assignIndex, 'native');
    assignments.push({
      id: canonicalEntityId(provider, nativeRunId, 'assign', `${entry.id}:${entry.owner}`),
      runId,
      taskId,
      agentId,
      assignedAt: normalizeIso(entry.startedAt) ?? normalizeLocalStringUtc8(entry.startedAt),
      unassignedAt: null,
      assignmentKind: kind,
      evidenceIds: [evId],
    });
    assignIndex += 1;
  }

  // ── activities（§4.7：工具调用 tool_call + step-finish round；同源 parts 序） ──
  const activities: TeamActivitySlim[] = [];
  let activityIndex = 0;
  for (const part of raw.parts ?? []) {
    const data = part.data ?? {};
    const type = data.type;
    const agentId = agentByNative.get(part.session_id) ?? null;
    if (type === 'tool') {
      const state = (data.state ?? {}) as { status?: unknown; input?: unknown; output?: unknown };
      const evId = ref(part.id ?? null, activityIndex, 'native');
      activities.push({
        id: canonicalEntityId(provider, nativeRunId, 'act', part.id ?? `tool-${activityIndex}`),
        runId,
        agentId,
        taskId: null,
        roundId: null,
        kind: 'tool_call',
        status: normalizeActivityStatus(state.status),
        startedAt: normalizeMs(findMessageTime(raw, part.message_id)),
        endedAt: null,
        nativeSequence: activityIndex,
        sessionKey: null,
        eventId: part.id ?? null,
        turnKey: null,
        messageId: null,
        artifactId: null,
        tokenUsage: null,
        costUsd: null,
        costSource: null,
        costCurrency: null,
        hasInput: state.input !== undefined && state.input !== null,
        hasOutput: state.output !== undefined && state.output !== null,
        hasRaw: false,
        evidenceIds: [evId],
        orderConfidence: 'native',
      });
    } else if (type === 'step-finish') {
      const tokenUsage = codeArtsTokenUsage(data.tokens);
      const costUsd = codeArtsCost(data.cost);
      const evId = ref(part.id ?? null, activityIndex, 'native');
      activities.push({
        id: canonicalEntityId(provider, nativeRunId, 'act', part.id ?? `step-${activityIndex}`),
        runId,
        agentId,
        taskId: null,
        roundId: null,
        kind: 'round',
        status: 'success',
        startedAt: normalizeMs(findMessageTime(raw, part.message_id)),
        endedAt: null,
        nativeSequence: activityIndex,
        sessionKey: null,
        eventId: part.id ?? null,
        turnKey: null,
        messageId: null,
        artifactId: null,
        tokenUsage,
        costUsd,
        costSource: costUsd !== null ? 'reported' : null,
        costCurrency: costUsd !== null ? 'USD' : null,
        hasInput: false,
        hasOutput: false,
        hasRaw: false,
        evidenceIds: [evId],
        orderConfidence: 'native',
      });
    }
    activityIndex += 1;
  }

  // ── communications：unavailable（§4.6 / G12.2，无 sender/recipient 不构造） ──
  const communications: TeamCommunication[] = [];

  // ── run facts ──
  const leaderTitle =
    rootSession?.title ??
    (raw.sessions ?? []).find((s) => s.id === nativeRunId)?.title ??
    leader?.description ??
    '';
  const leaderStartedAt = leader?.startedAt;
  const hasTokens = activities.some((a) => a.tokenUsage !== null);
  const hasCost = activities.some((a) => a.costUsd !== null);

  const completeness = mergeCompleteness(codeArtsTeamCapabilities(), {
    topology: agents.length > 0 && agentEdges.length > 0 ? 'complete' : 'partial',
    tasks: tasks.length > 0 ? 'complete' : 'unavailable',
    communication: 'unavailable',
    timing: 'partial',
    tools: activities.some((a) => a.kind === 'tool_call') ? 'complete' : 'unavailable',
    outputs: 'partial',
    tokens: hasTokens ? 'complete' : 'unavailable',
    cost: hasCost ? 'complete' : 'unavailable',
    verification: 'unavailable',
  });

  return {
    run: {
      provider,
      runId,
      nativeRunId,
      runIdentityConfidence: 'native',
      title: leaderTitle,
      goalFingerprint: goalFingerprintOf(leaderTitle),
      status: normalizeTeamRunStatus(leader?.status),
      startedAt: normalizeIso(leaderStartedAt),
      endedAt: null,
      tokenAvailable: hasTokens,
      costAvailable: hasCost,
      costCurrency: hasCost ? 'USD' : null,
    },
    agents,
    agentEdges,
    tasks,
    taskDependencies,
    assignments,
    communications,
    activities,
    rounds: [],
    artifacts: [],
    evidence,
    completeness,
  };
}

/** CodeArts provider 级能力基线（evidence §6 completeness matrix）。 */
export function codeArtsTeamCapabilities(): TeamCompleteness {
  return mergeCompleteness(emptyCompleteness(), {
    topology: 'complete',
    tasks: 'complete',
    communication: 'unavailable',
    timing: 'partial',
    tools: 'complete',
    outputs: 'partial',
    tokens: 'complete',
    cost: 'complete',
    verification: 'unavailable',
  });
}
