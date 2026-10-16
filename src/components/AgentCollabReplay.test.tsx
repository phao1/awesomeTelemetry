/**
 * agent-collaboration-replay §2.1.3 / §7.1 — AgentCollabReplay 主组件测试（8 场景）。
 *
 * mock `getTeamRunBySessionKey` 与 `teamApi`（网络层），不 mock 被测编排逻辑、
 * 不放松断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamAssignment,
  TeamArtifact,
  TeamMetrics,
  TeamRunSnapshot,
  TeamRunSummary,
  TeamTask,
  TeamTaskDependency,
} from '../core/trace-types.js';
import type { EvidenceDimension, CompletenessLevel } from '../core/trace-types.js';
import type { SessionTeamRunResponse } from '../api/team-run-by-session.js';

// ── mock 网络层（hoisted，避免 vi.mock factory 引用外部变量报错） ──

const { mockGetTeamRunBySessionKey, mockRunSnapshot, mockListActivities } = vi.hoisted(() => ({
  mockGetTeamRunBySessionKey: vi.fn(),
  mockRunSnapshot: vi.fn(),
  mockListActivities: vi.fn(),
}));

vi.mock('../api/team-run-by-session.js', () => ({
  getTeamRunBySessionKey: mockGetTeamRunBySessionKey,
}));

vi.mock('./team/team-client.js', () => ({
  teamApi: {
    runSnapshot: mockRunSnapshot,
    listActivities: mockListActivities,
  },
}));

import { AgentCollabReplay } from './AgentCollabReplay.js';

// ── fixture helpers ──────────────────────────────────────────

const FULL_COMPLETENESS: Record<EvidenceDimension, CompletenessLevel> = {
  topology: 'complete',
  tasks: 'complete',
  communication: 'partial',
  timing: 'complete',
  tools: 'complete',
  outputs: 'complete',
  tokens: 'complete',
  cost: 'unavailable',
  verification: 'partial',
};

function makeRun(id: string, over: Partial<TeamRunSummary> = {}): TeamRunSummary {
  return {
    id,
    provider: 'codex',
    nativeRunId: `native-${id}`,
    runIdentityConfidence: 'native',
    title: `run ${id}`,
    goalFingerprint: null,
    status: 'success',
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: '2024-01-01T01:00:00Z',
    topologyKind: 'two_level',
    counts: { agents: 2, tasks: 2, communications: 1, activities: 4, rounds: 2, artifacts: 1 },
    tokenAvailable: true,
    costAvailable: false,
    costCurrency: null,
    completeness: FULL_COMPLETENESS,
    updatedAt: '2024-01-01T01:00:00Z',
    stamp: `stamp-${id}`,
    ...over,
  };
}

function makeAgent(id: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id,
    runId: 'r1',
    nativeId: `n-${id}`,
    displayName: `Agent ${id}`,
    role: 'team-mate',
    roleClass: 'teammate',
    model: 'gpt-4',
    state: 'completed',
    createdAt: null,
    endedAt: null,
    sessionKeys: [],
    evidenceIds: [],
    ...over,
  };
}

function makeEdge(id: string, from: string, to: string, over: Partial<TeamAgentEdge> = {}): TeamAgentEdge {
  return {
    id,
    runId: 'r1',
    fromAgentId: from,
    toAgentId: to,
    kind: 'supervises',
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
    ...over,
  };
}

function makeTask(id: string, over: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    runId: 'r1',
    nativeId: `n-${id}`,
    title: `Task ${id}`,
    descriptionAvailable: false,
    priority: 1,
    status: 'completed',
    createdAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    resultAvailable: false,
    evidenceIds: [],
    ...over,
  };
}

function makeDependency(id: string, upstream: string, downstream: string): TeamTaskDependency {
  return {
    id,
    runId: 'r1',
    upstreamTaskId: upstream,
    downstreamTaskId: downstream,
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
  };
}

function makeAssignment(id: string, taskId: string, agentId: string): TeamAssignment {
  return {
    id,
    runId: 'r1',
    taskId,
    agentId,
    assignedAt: null,
    unassignedAt: null,
    assignmentKind: 'assigned',
    evidenceIds: [],
  };
}

function makeArtifact(id: string): TeamArtifact {
  return {
    id,
    runId: 'r1',
    nativeId: null,
    name: `artifact ${id}`,
    kind: 'file',
    pathRedacted: null,
    contentHash: null,
    producerAgentIds: [],
    taskIds: [],
    createdAt: null,
    acceptedAt: null,
    hasContent: false,
    evidenceIds: [],
  };
}

function makeMetrics(): TeamMetrics {
  const v = {
    value: null,
    available: false,
    complete: false,
    criteria: '',
    evidenceIds: [],
    numerator: null,
    denominator: null,
  };
  return {
    calcVersion: 1,
    generatedAt: '2024-01-01T01:00:00Z',
    scheduling: {
      wallClockMs: v, agentActiveMs: v, totalWorkMs: v, observedWaitMs: v,
      maxConcurrency: v, avgConcurrency: v, serialWorkEstimateMs: v,
      observedSpeedup: v, peakCapacityUtilization: v, criticalPathMs: v,
      delegationDelayMs: v, handoffLatencyMs: v,
    },
    quality: {
      taskCompletion: v, verificationCoverage: v, acceptanceCoverage: v,
      reviewRework: v, acceptedArtifactRate: v,
    },
    stability: {
      failures: v, retries: v, replacements: v, recoveryLatencyMs: v,
      blockedOrphanTimeMs: v, unresolvedErrors: v, dagAnomalies: v,
      incompleteTerminalStates: v,
    },
    cost: {
      totalInputTokens: v, totalOutputTokens: v, totalReasoningTokens: v,
      totalCacheReadTokens: v, totalCacheWriteTokens: v, totalCostUsd: v,
      costCurrency: null, coordinationTokens: v, costGini: v,
    },
    collaboration: {
      directRatio: v, leaderMediatedRatio: v, responseLatencyMedianMs: v,
      responseLatencyP95Ms: v, taskBalanceGini: v, leaderWorkConcentration: v,
      criticalAgentConcentration: v, crossAgentReview: v, duplicateWorkSignal: v,
    },
  };
}

function makeSnapshot(over: Partial<TeamRunSnapshot> = {}): TeamRunSnapshot {
  return {
    summary: makeRun('r1'),
    agents: [makeAgent('a1', { role: 'team-leader', roleClass: 'leader' }), makeAgent('a2')],
    agentEdges: [makeEdge('e1', 'a1', 'a2')],
    tasks: [
      makeTask('t1', { startedAt: '2024-01-01T00:00:00Z' }),
      makeTask('t2', { startedAt: '2024-01-01T00:10:00Z' }),
    ],
    taskDependencies: [makeDependency('d1', 't1', 't2')],
    assignments: [makeAssignment('as1', 't1', 'a1')],
    artifacts: [makeArtifact('ar1')],
    completeness: FULL_COMPLETENESS,
    anomalies: [],
    metrics: makeMetrics(),
    ...over,
  };
}

function makeActivity(id: string, over: Partial<TeamActivitySlim> = {}): TeamActivitySlim {
  return {
    id,
    runId: 'r1',
    agentId: 'a1',
    taskId: 't1',
    roundId: null,
    kind: 'agent_lifecycle',
    status: 'running',
    startedAt: '2024-01-01T00:00:30Z',
    endedAt: null,
    nativeSequence: 1,
    sessionKey: null,
    eventId: null,
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
    evidenceIds: [],
    orderConfidence: 'native',
    ...over,
  };
}

// ── render + flush helpers ───────────────────────────────────

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

/** flush 微任务 + setTimeout(0)，让 useEffect 中的 Promise resolve 生效。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ── setup / teardown ─────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ── 8 个测试场景 ─────────────────────────────────────────────

describe('AgentCollabReplay §7.1', () => {
  it('1. runIds 加载中 → 显示 loading spinner', () => {
    // mock 返回永不 resolve 的 Promise，保持 runIds === null
    mockGetTeamRunBySessionKey.mockReturnValue(new Promise<SessionTeamRunResponse>(() => {}));
    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    const loading = container.querySelector('.agent-collab-replay-loading');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain('正在加载协作数据');
  });

  it('2. runIds = [] → 返回 null，DOM 中无章节容器（spec §5.1.1 规则 2）', async () => {
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: [] });
    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();
    // AgentCollabReplay 返回 null → 容器内无任何内容
    expect(container.querySelector('.agent-collab-replay')).toBeNull();
    expect(container.querySelector('.agent-collab-replay-loading')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('3. runIds 非空 + snapshot + activities 正常 → 渲染三面板', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [makeActivity('act1', { taskId: 't1' })],
      nextCursor: null,
      hasMore: false,
      total: 1,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 主容器
    expect(container.querySelector('.agent-collab-replay')).not.toBeNull();
    // 拓扑图（SVG）
    expect(container.querySelector('.collab-topology-graph')).not.toBeNull();
    // 回放控制条
    expect(container.querySelector('.collab-replay-controls')).not.toBeNull();
    // 活动面板
    expect(container.querySelector('.collab-activity-panel')).not.toBeNull();
  });

  it('4. 点击「前进」→ taskCursor +1，活动面板更新（spec §5.4.1 规则 3）', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        // t1 有 2 个活动，t2 有 1 个活动（都是 a1）
        makeActivity('act1', { taskId: 't1', startedAt: '2024-01-01T00:00:30Z' }),
        makeActivity('act1b', { taskId: 't1', startedAt: '2024-01-01T00:00:40Z' }),
        makeActivity('act2', { taskId: 't2', startedAt: '2024-01-01T00:10:30Z' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 3,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 初始 cursor=0 → t1 有 2 个活动 → a1 聚合行显示 "2 条"
    const groupsBefore = container.querySelectorAll('.collab-activity-group');
    const a1GroupBefore = groupsBefore[0] as HTMLDetailsElement;
    expect(a1GroupBefore.textContent).toContain('2 条');

    // 点击前进
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // cursor=1 → t2 有 1 个活动 → a1 聚合行显示 "1 条"
    const groupsAfter = container.querySelectorAll('.collab-activity-group');
    const a1GroupAfter = groupsAfter[0] as HTMLDetailsElement;
    expect(a1GroupAfter.textContent).toContain('1 条');
  });

  it('5. 点击「后退」→ taskCursor -1（spec §5.4.1 规则 4）', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        // t1 有 1 个活动，t2 有 2 个活动
        makeActivity('act1', { taskId: 't1', startedAt: '2024-01-01T00:00:30Z' }),
        makeActivity('act2', { taskId: 't2', startedAt: '2024-01-01T00:10:30Z' }),
        makeActivity('act2b', { taskId: 't2', startedAt: '2024-01-01T00:10:40Z' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 3,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 先前进到 cursor=1 → t2 有 2 个活动
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const groupsMid = container.querySelectorAll('.collab-activity-group');
    expect(groupsMid[0]?.textContent).toContain('2 条');

    // 后退到 cursor=0 → t1 有 1 个活动
    const prevBtn = container.querySelector('.collab-replay-prev') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);
    act(() => {
      prevBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const groupsAfter = container.querySelectorAll('.collab-activity-group');
    expect(groupsAfter[0]?.textContent).toContain('1 条');
  });

  it('6. 当前为最后一个 task → 前进按钮 disabled（spec §5.4.1 规则 5）', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        makeActivity('act1', { taskId: 't1' }),
        makeActivity('act2', { taskId: 't2' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 2,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 前进到最后一个 task
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 此时 cursor=1（最后一个），前进按钮 disabled
    const nextBtnAfter = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    expect(nextBtnAfter.disabled).toBe(true);
  });

  it('7. 当前为第一个 task → 后退按钮 disabled（spec §5.4.1 规则 6）', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        makeActivity('act1', { taskId: 't1' }),
        makeActivity('act2', { taskId: 't2' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 2,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 初始 cursor=0（第一个），后退按钮 disabled
    const prevBtn = container.querySelector('.collab-replay-prev') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it('8. getTeamRunBySessionKey 抛错 → 隐藏章节（spec §5.1.3 异常 1）', async () => {
    mockGetTeamRunBySessionKey.mockRejectedValue(new Error('net down'));
    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 章节隐藏：无主容器、无 loading、无错误提示
    expect(container.querySelector('.agent-collab-replay')).toBeNull();
    expect(container.querySelector('.agent-collab-replay-loading')).toBeNull();
    expect(container.querySelector('.ui-error')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('9. 点击进度条第 K 段 → taskCursor 变为 K，活动面板同步更新（spec §8.2.1 规则 5）', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        // t1 有 1 个活动，t2 有 2 个活动
        makeActivity('act1', { taskId: 't1', startedAt: '2024-01-01T00:00:30Z' }),
        makeActivity('act2', { taskId: 't2', startedAt: '2024-01-01T00:10:30Z' }),
        makeActivity('act2b', { taskId: 't2', startedAt: '2024-01-01T00:10:40Z' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 3,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 初始 cursor=0 → t1 有 1 个活动
    const groupsBefore = container.querySelectorAll('.collab-activity-group');
    expect(groupsBefore[0]?.textContent).toContain('1 条');

    // 点击第 2 段（index=1）→ onJump(1)
    const segs = container.querySelectorAll('.collab-replay-seg');
    expect(segs.length).toBe(2);
    act(() => {
      segs[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // cursor=1 → t2 有 2 个活动
    const groupsAfter = container.querySelectorAll('.collab-activity-group');
    expect(groupsAfter[0]?.textContent).toContain('2 条');
  });

  it('10. 点击「跳过空 task」→ 跳到下一个有活动的 task（spec §8.2.1 规则 3）', async () => {
    // 3 个 task：t1 有活动，t2 空，t3 有活动
    const snapshot = makeSnapshot({
      tasks: [
        makeTask('t1', { startedAt: '2024-01-01T00:00:00Z' }),
        makeTask('t2', { startedAt: '2024-01-01T00:10:00Z' }),
        makeTask('t3', { startedAt: '2024-01-01T00:20:00Z' }),
      ],
    });
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        makeActivity('act1', { taskId: 't1', startedAt: '2024-01-01T00:00:30Z' }),
        makeActivity('act3', { taskId: 't3', startedAt: '2024-01-01T00:20:30Z' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 2,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 前进到 cursor=1（t2，空 task）
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 此时 cursor=1，t2 无活动 → 显示「跳过空 task」按钮
    const skipBtn = container.querySelector('.collab-replay-skip-empty') as HTMLButtonElement;
    expect(skipBtn).not.toBeNull();
    act(() => {
      skipBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 跳到 t3（cursor=2）→ t3 有 1 个活动
    const groupsAfter = container.querySelectorAll('.collab-activity-group');
    expect(groupsAfter[0]?.textContent).toContain('1 条');
    // 进度条第 3 段为当前
    const segs = container.querySelectorAll('.collab-replay-seg');
    expect(segs[2]?.classList.contains('collab-replay-seg-current')).toBe(true);
  });

  it('11. 切换 task → AgentActivityPanel 重挂，所有 <details> 回到默认折叠态（spec §8.5.1 规则 5）', async () => {
    const snapshot = makeSnapshot();
    mockGetTeamRunBySessionKey.mockResolvedValue({ runIds: ['r1'] });
    mockRunSnapshot.mockResolvedValue({ snapshot, stamp: 's1', cached: false });
    mockListActivities.mockResolvedValue({
      items: [
        makeActivity('act1', { taskId: 't1', startedAt: '2024-01-01T00:00:30Z' }),
        makeActivity('act2', { taskId: 't2', startedAt: '2024-01-01T00:10:30Z' }),
      ],
      nextCursor: null,
      hasMore: false,
      total: 2,
      hasAmbiguousOrder: false,
    });

    const container = render(<AgentCollabReplay sessionKey="s1" locale="zh" />);
    await flush();

    // 展开 a1 的 details
    const detailsBefore = container.querySelector('.collab-activity-group') as HTMLDetailsElement;
    act(() => {
      detailsBefore.querySelector('summary')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(detailsBefore.open).toBe(true);

    // 前进到 cursor=1（切换 task）→ AgentActivityPanel key 重挂
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 重挂后所有 <details> 回到默认折叠态
    const detailsAfter = container.querySelector('.collab-activity-group') as HTMLDetailsElement;
    expect(detailsAfter.open).toBe(false);
  });
});
