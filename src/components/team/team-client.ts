/**
 * add-agent-team-observability §7.2 — typed team API client.
 *
 * 七条 team 路由的 typed 客户端方法（contracts/api.md §7.1–7.7）。
 * slim 类型直接复用 `src/core/trace-types.ts` §12 的 canonical 定义，
 * **绝不**在此重声明或扩展字段（AGENTS.md 五必做 1）。
 *
 * body 字段（input/output/message/result/raw）只出现在 `TeamActivityBody`
 * 与 `TeamActivityDetailResponse`，且必须由调用方显式 `include=body|raw` 触发；
 * slim 列表/快照/账本/比较方法返回类型里编译期就无 body 字段（§12.5 验收）。
 */

import type {
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamArtifact,
  TeamAssignment,
  TeamCommunication,
  TeamComparison,
  TeamMetrics,
  TeamRunSummary,
  TeamRunSnapshot,
  TeamTask,
  TeamTaskDependency,
  CompletenessLevel,
  ProviderKey,
  TeamRunStatus,
  TeamTopologyKind,
  TeamActivityKind,
  TraceStatus,
} from '../../core/trace-types.js';
import { fetchJson } from '../../api/client.js';

// ── §7.1 GET /api/team-runs ───────────────────────────────────

export interface TeamRunListResponse {
  items: TeamRunSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface TeamRunListParams {
  provider?: ProviderKey[];
  status?: TeamRunStatus[];
  topology?: TeamTopologyKind[];
  q?: string;
  range?: 'today' | '7d' | '30d' | 'all';
  completeness?: CompletenessLevel[];
  limit?: number;
  cursor?: string;
}

// ── §7.2 GET /api/team-runs/:runId ────────────────────────────

export interface TeamRunSnapshotResponse {
  snapshot: TeamRunSnapshot;
  stamp: string;
  cached: boolean;
}

// ── §7.3 GET /api/team-runs/:runId/activities ────────────────

export interface TeamActivityListResponse {
  items: TeamActivitySlim[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  hasAmbiguousOrder: boolean;
}

export interface TeamActivityListParams {
  agent?: string;
  task?: string;
  kind?: TeamActivityKind[];
  status?: TraceStatus[];
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

// ── §7.4 GET /api/team-runs/:runId/activities/:activityId ────

/** body tier，仅在 include=body 时存在（contracts/api.md §7.4）。 */
export interface TeamActivityBody {
  input: string | null;
  output: string | null;
  message: string | null;
  result: string | null;
}

export interface TeamActivityDetailResponse {
  activity: TeamActivitySlim;
  /** present only when include=body. */
  body: TeamActivityBody | null;
  /** present only when include=raw. */
  raw: string | null;
}

// ── §7.5 GET /api/team-runs/:runId/patch ─────────────────────

export interface TeamPatchResponse {
  runId: string;
  stamp: string;
  agents: TeamAgent[];
  tasks: TeamTask[];
  agentEdges: TeamAgentEdge[];
  taskDependencies: TeamTaskDependency[];
  assignments: TeamAssignment[];
  messages: TeamCommunication[];
  artifacts: TeamArtifact[];
  metrics: TeamMetrics | null;
  deletedAgentIds: string[];
  deletedTaskIds: string[];
  deletedMessageIds: string[];
  deletedActivityIds: string[];
  truncated: boolean;
}

// ── §7.6 POST /api/team-compare ──────────────────────────────

export interface TeamCompareRequest {
  leftRunId: string;
  rightRunId: string;
  manualBasis?: boolean;
}

// ── §7.7 DELETE /api/team-runs/:runId ────────────────────────

export interface TeamRunDeleteResponse {
  deleted: boolean;
  runId: string;
}

// ── SSE payload（BusEvents.team_runs_changed，contracts/data-model.md §10） ──

export interface TeamRunsChangedPayload {
  runIds: string[];
  agentIds: string[];
  taskIds: string[];
  truncated: boolean;
  stamp: string;
}

function qs(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  const raw = search.toString();
  return raw === '' ? '' : `?${raw}`;
}

/**
 * 七条 team 路由的 typed 客户端。所有方法复用 `fetchJson`，因此统一 `ApiError`
 * 信封、gzip、foreground marking 都自动继承（§0.3 / §0.2 / §0.6）。
 *
 * **slim 类型不含 body**：list/snapshot/ledger/compare 的返回类型里编译期就无
 * `input`/`output`/`raw`/`message`/`toolArguments`/`toolResult`/`reasoning`
 * 等字段（§12.5 已有 type-level 验收）。body 只在 `activityDetail(_, _, 'body'|'raw')`
 * 显式请求时出现。
 */
export const teamApi = {
  /** §7.1 keyset-paginated slim run list. */
  listRuns(params: TeamRunListParams = {}): Promise<TeamRunListResponse> {
    return fetchJson<TeamRunListResponse>(
      `/team-runs${qs({
        provider: params.provider,
        status: params.status,
        topology: params.topology,
        q: params.q,
        range: params.range,
        completeness: params.completeness,
        limit: params.limit ?? 50,
        cursor: params.cursor,
      })}`,
    );
  },

  /** §7.2 bounded snapshot, stamp-cached. */
  runSnapshot(runId: string): Promise<TeamRunSnapshotResponse> {
    return fetchJson<TeamRunSnapshotResponse>(`/team-runs/${encodeURIComponent(runId)}`);
  },

  /** §7.3 keyset-paginated slim activity ledger. */
  listActivities(runId: string, params: TeamActivityListParams = {}): Promise<TeamActivityListResponse> {
    return fetchJson<TeamActivityListResponse>(
      `/team-runs/${encodeURIComponent(runId)}/activities${qs({
        agent: params.agent,
        task: params.task,
        kind: params.kind,
        status: params.status,
        from: params.from,
        to: params.to,
        limit: params.limit ?? 200,
        cursor: params.cursor,
      })}`,
    );
  },

  /**
   * §7.4 single activity detail. **默认 slim**（无 body/raw）；
   * `include='body'` / `'raw'` 显式触发 body/raw tier，且服务端在不可用时
   * 返回 409 `TEAM_BODY_UNAVAILABLE`（由 fetchJson 抛出 ApiError）。
   */
  activityDetail(
    runId: string,
    activityId: string,
    include?: 'body' | 'raw',
  ): Promise<TeamActivityDetailResponse> {
    return fetchJson<TeamActivityDetailResponse>(
      `/team-runs/${encodeURIComponent(runId)}/activities/${encodeURIComponent(activityId)}${qs({ include })}`,
    );
  },

  /** §7.5 bounded SSE-patch payload. */
  patch(runId: string, stamp: string): Promise<TeamPatchResponse> {
    return fetchJson<TeamPatchResponse>(
      `/team-runs/${encodeURIComponent(runId)}/patch${qs({ stamp })}`,
    );
  },

  /** §7.6 two-run comparison. unmatched/unknown 仍是成功响应。 */
  compare(request: TeamCompareRequest): Promise<TeamComparison> {
    return fetchJson<TeamComparison>('/team-compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
  },

  /** §7.7 explicit derived-team deletion; linked sessions/sources untouched. */
  deleteRun(runId: string): Promise<TeamRunDeleteResponse> {
    return fetchJson<TeamRunDeleteResponse>(`/team-runs/${encodeURIComponent(runId)}`, {
      method: 'DELETE',
    });
  },
};

// ════════════════════════════════════════════════════════════════════
// §7.1 team hash-state 扩展
// ════════════════════════════════════════════════════════════════════

/**
 * team 视图的七个子面板（design D15）。`compare` 是 team-compare，与既有
 * session Compare（hash-router.ts 的 `view='compare'`）分开，避免两个比较
 * 契约过载同一个 hash 路由。
 */
export const TEAM_PANELS = [
  'topology',
  'tasks',
  'timeline',
  'communication',
  'ledger',
  'inspector',
  'compare',
] as const;

export type TeamPanel = (typeof TEAM_PANELS)[number];

/**
 * tagged-union selection model（design D15 / §7.7）。一个选择是一个 tagged union
 * `agent | task | round | activity | message | artifact | edge`；每个子视图把它
 * 映射到自己的高亮，**不发请求**（zero-request cross-highlighting）。
 */
export type TeamSelection =
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'round'; id: string }
  | { kind: 'activity'; id: string }
  | { kind: 'message'; id: string }
  | { kind: 'artifact'; id: string }
  | { kind: 'edge'; id: string };

/**
 * team hash-state（§7.1）。与既有 `HashState`（hash-router.ts）平行：
 * 既有 `view='session'|'agent'|'compare'|'proxy'|'frida'|'mission'` 不动，
 * team 视图用独立的 `team` 视图标识 + 这份子状态。`App.tsx` 在 `view==='team'`
 * 时把这份状态合并进 URL hash。
 *
 * 字段覆盖 §7.1 全部需求：team run、team compare、panel、agent、task、activity、
 * filters、invalid/deleted ids。invalid/deleted ids 由 `deletedRunId` /
 * `invalidRunId` 标记，App 在打开时检测到 404 `TEAM_RUN_NOT_FOUND` 后写入，
 * URL 保留以便用户复制反馈。
 */
export interface TeamHashState {
  /** 当前打开的 team run id（null = 未打开，列表态）。 */
  runId: string | null;
  /** 七视图子面板（缺省 topology）。 */
  panel: TeamPanel;
  /** tagged-union selection（跨子面板共享，zero-request 高亮）。 */
  selection: TeamSelection | null;
  /** team-compare 左右 run id。 */
  compareLeft: string | null;
  compareRight: string | null;
  /** 用户声明基准（team-compare）。 */
  compareManualBasis: boolean;
  /** 列表过滤：provider 多选。 */
  provider: ProviderKey[];
  /** 列表过滤：status 多选。 */
  status: TeamRunStatus[];
  /** 列表过滤：topology 多选。 */
  topology: TeamTopologyKind[];
  /** 列表过滤：completeness 多选。 */
  completeness: CompletenessLevel[];
  /** 列表过滤：标题/nativeRunId 子串（服务端 LIKE）。 */
  q: string;
  /** 列表过滤：时间窗。 */
  range: 'today' | '7d' | '30d' | 'all';
  /** body tier 显式展开的 activity id（inspector 单条，bounded cache）。 */
  bodyActivityId: string | null;
  /** raw tier 显式展开的 activity id。 */
  rawActivityId: string | null;
  /** URL 中存在但服务端 404 的 run id（保留以供反馈，App 显示 invalid 提示）。 */
  invalidRunId: string | null;
  /** 刚被 DELETE 删除的 run id（App 显示删除确认，列表已剔除）。 */
  deletedRunId: string | null;
}

export const DEFAULT_TEAM_HASH: TeamHashState = {
  runId: null,
  panel: 'topology',
  selection: null,
  compareLeft: null,
  compareRight: null,
  compareManualBasis: false,
  provider: [],
  status: [],
  topology: [],
  completeness: [],
  q: '',
  range: 'today',
  bodyActivityId: null,
  rawActivityId: null,
  invalidRunId: null,
  deletedRunId: null,
};

const TEAM_PANEL_SET: ReadonlySet<string> = new Set(TEAM_PANELS);
const SELECTION_KINDS = ['agent', 'task', 'round', 'activity', 'message', 'artifact', 'edge'] as const;
const SELECTION_KIND_SET: ReadonlySet<string> = new Set(SELECTION_KINDS);

/**
 * 解析 team hash 子串（`?` 之后的 query）。与 `parseHash` 同风格：
 * 脏值整体丢弃，不抛错；非法 enum 回落缺省。
 *
 * 仅读 team 专属键，非 team 键忽略。返回的 `TeamHashState` 永远是完整对象
 * （缺省值填充），调用方无需再做 null 合并。
 */
export function parseTeamHash(query: string): TeamHashState {
  const params = new URLSearchParams(query);
  const list = (key: string): string[] => {
    const value = params.get(key);
    return value === null ? [] : value.split(',').filter(Boolean);
  };
  const runId = params.get('runId');
  const panelRaw = params.get('panel');
  const panel: TeamPanel = panelRaw !== null && TEAM_PANEL_SET.has(panelRaw)
    ? (panelRaw as TeamPanel)
    : 'topology';

  // tagged-union selection：sel=kind:id（如 `sel=task:t-3`）
  const selRaw = params.get('sel');
  let selection: TeamSelection | null = null;
  if (selRaw !== null) {
    const idx = selRaw.indexOf(':');
    if (idx > 0) {
      const kind = selRaw.slice(0, idx);
      const id = selRaw.slice(idx + 1);
      if (SELECTION_KIND_SET.has(kind) && id !== '') {
        selection = { kind: kind as TeamSelection['kind'], id };
      }
    }
  }

  const compareLeft = params.get('cmpLeft');
  const compareRight = params.get('cmpRight');
  const compareManualBasis = params.get('cmpManual') === '1';

  const bodyActivityId = params.get('body');
  const rawActivityId = params.get('raw');
  const invalidRunId = params.get('invalid');
  const deletedRunId = params.get('deleted');

  const rangeRaw = params.get('range');
  const range: TeamHashState['range'] =
    rangeRaw === 'today' || rangeRaw === '7d' || rangeRaw === '30d' || rangeRaw === 'all'
      ? rangeRaw
      : 'today';

  return {
    runId: runId !== null ? runId : null,
    panel,
    selection,
    compareLeft: compareLeft !== null ? compareLeft : null,
    compareRight: compareRight !== null ? compareRight : null,
    compareManualBasis,
    provider: list('provider') as ProviderKey[],
    status: list('status') as TeamRunStatus[],
    topology: list('topology') as TeamTopologyKind[],
    completeness: list('completeness') as CompletenessLevel[],
    q: params.get('q') ?? '',
    range,
    bodyActivityId: bodyActivityId !== null ? bodyActivityId : null,
    rawActivityId: rawActivityId !== null ? rawActivityId : null,
    invalidRunId: invalidRunId !== null ? invalidRunId : null,
    deletedRunId: deletedRunId !== null ? deletedRunId : null,
  };
}

/**
 * 序列化 team hash-state 为 query 字符串（不含 `?` 前缀，空串表示无参数）。
 * 与 `serializeHash` 同风格：空值/缺省值省略，保持 URL 简洁。
 */
export function serializeTeamHash(state: TeamHashState): string {
  const params = new URLSearchParams();
  if (state.runId !== null) {
    params.set('runId', state.runId);
  }
  if (state.panel !== 'topology') {
    params.set('panel', state.panel);
  }
  if (state.selection !== null) {
    params.set('sel', `${state.selection.kind}:${state.selection.id}`);
  }
  if (state.compareLeft !== null) {
    params.set('cmpLeft', state.compareLeft);
  }
  if (state.compareRight !== null) {
    params.set('cmpRight', state.compareRight);
  }
  if (state.compareManualBasis) {
    params.set('cmpManual', '1');
  }
  if (state.provider.length > 0) {
    params.set('provider', state.provider.join(','));
  }
  if (state.status.length > 0) {
    params.set('status', state.status.join(','));
  }
  if (state.topology.length > 0) {
    params.set('topology', state.topology.join(','));
  }
  if (state.completeness.length > 0) {
    params.set('completeness', state.completeness.join(','));
  }
  if (state.q !== '') {
    params.set('q', state.q);
  }
  if (state.range !== 'today') {
    params.set('range', state.range);
  }
  if (state.bodyActivityId !== null) {
    params.set('body', state.bodyActivityId);
  }
  if (state.rawActivityId !== null) {
    params.set('raw', state.rawActivityId);
  }
  if (state.invalidRunId !== null) {
    params.set('invalid', state.invalidRunId);
  }
  if (state.deletedRunId !== null) {
    params.set('deleted', state.deletedRunId);
  }
  return params.toString();
}

/**
 * 把 team hash-state 合并成完整 hash（`#/team?...`）。
 * App.tsx 在 `view==='team'` 时调用此函数写 URL。
 */
export function serializeTeamViewHash(state: TeamHashState): string {
  const query = serializeTeamHash(state);
  return `#/team${query === '' ? '' : `?${query}`}`;
}
