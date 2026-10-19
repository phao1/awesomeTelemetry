/**
 * add-agent-team-observability §7.3 / §7.4 / §7.7 / §7.8 / §7.11 / §7.12 —
 * TeamShell 测试。
 *
 * 覆盖：
 * - 七视图切换（topology/tasks/timeline/communication/ledger/inspector/compare）
 * - selection 共享高亮（zero-request cross-highlighting）
 * - SSE patch 行为（invalidateKey 变化 → patch 请求）
 * - cache 行为（切走切回不发请求）
 * - no per-entity fetching（打开 run 只发 1 个 snapshot 请求）
 * - 六状态（snapshot loading/error/empty/success）
 * - snapshot 404 → invalidRunId
 * - 删除 run → deletedRunId
 *
 * 不 mock 被测逻辑、不放宽断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamArtifact,
  TeamAssignment,
  TeamComparison,
  TeamMetrics,
  TeamMetricValue,
  TeamRunSnapshot,
  TeamRunSummary,
  TeamTask,
  TeamTaskDependency,
} from '../../core/trace-types.js';
import { DEFAULT_TEAM_HASH, type TeamHashState } from './team-client.js';
import { TeamShell } from './TeamShell.js';

// ── mock data helpers ────────────────────────────────────────

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

let runIdCounter = 0;
function nextRunId(): string {
  runIdCounter += 1;
  return `r-${runIdCounter}`;
}

function makeRun(id: string, over: Partial<TeamRunSummary> = {}): TeamRunSummary {
  return {
    id,
    provider: 'codex',
    nativeRunId: `native-${id}`,
    runIdentityConfidence: 'native',
    title: `run ${id}`,
    goalFingerprint: null,
    status: 'success',
    startedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    topologyKind: 'two_level',
    counts: { agents: 2, tasks: 2, communications: 1, activities: 4, rounds: 2, artifacts: 1 },
    tokenAvailable: true,
    costAvailable: false,
    costCurrency: null,
    completeness: FULL_COMPLETENESS,
    updatedAt: new Date().toISOString(),
    stamp: `stamp-${id}`,
    ...over,
  };
}

function makeAgent(id: string, runId: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id,
    runId,
    nativeId: `n-${id}`,
    displayName: `Agent ${id}`,
    role: 'team-mate',
    roleClass: 'teammate',
    model: 'gpt-4',
    state: 'completed',
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    sessionKeys: [],
    evidenceIds: [],
    ...over,
  };
}

function makeTask(id: string, runId: string, over: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    runId,
    nativeId: `n-${id}`,
    title: `Task ${id}`,
    descriptionAvailable: false,
    priority: 1,
    status: 'completed',
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    startedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 3400 * 1000).toISOString(),
    cancelledAt: null,
    failedAt: null,
    resultAvailable: false,
    evidenceIds: [],
    ...over,
  };
}

function makeEdge(id: string, runId: string, from: string, to: string): TeamAgentEdge {
  return {
    id,
    runId,
    fromAgentId: from,
    toAgentId: to,
    kind: 'supervises',
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
  };
}

function makeDependency(id: string, runId: string, upstream: string, downstream: string): TeamTaskDependency {
  return {
    id,
    runId,
    upstreamTaskId: upstream,
    downstreamTaskId: downstream,
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
  };
}

function makeAssignment(id: string, runId: string, taskId: string, agentId: string): TeamAssignment {
  return {
    id,
    runId,
    taskId,
    agentId,
    assignedAt: null,
    unassignedAt: null,
    assignmentKind: 'assigned',
    evidenceIds: [],
  };
}

function makeArtifact(id: string, runId: string): TeamArtifact {
  return {
    id,
    runId,
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

function makeMetricValue(over: Partial<TeamMetricValue> = {}): TeamMetricValue {
  return {
    value: null,
    available: false,
    complete: false,
    criteria: '',
    evidenceIds: [],
    numerator: null,
    denominator: null,
    ...over,
  };
}

function makeMetrics(): TeamMetrics {
  const v = makeMetricValue();
  return {
    calcVersion: 1,
    generatedAt: new Date().toISOString(),
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

function makeSnapshot(runId: string, over: Partial<TeamRunSnapshot> = {}): TeamRunSnapshot {
  const agents = [makeAgent('a-1', runId, { role: 'team-leader', roleClass: 'leader' }), makeAgent('a-2', runId)];
  const tasks = [makeTask('t-1', runId), makeTask('t-2', runId)];
  return {
    summary: makeRun(runId),
    agents,
    agentEdges: [makeEdge('e-1', runId, 'a-1', 'a-2')],
    tasks,
    taskDependencies: [makeDependency('d-1', runId, 't-1', 't-2')],
    assignments: [makeAssignment('as-1', runId, 't-1', 'a-1')],
    artifacts: [makeArtifact('ar-1', runId)],
    completeness: FULL_COMPLETENESS,
    anomalies: [],
    metrics: makeMetrics(),
    ...over,
  };
}

function makeActivity(id: string, runId: string, over: Partial<TeamActivitySlim> = {}): TeamActivitySlim {
  return {
    id,
    runId,
    agentId: 'a-1',
    taskId: null,
    roundId: null,
    kind: 'tool_call',
    status: 'success',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
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

// ── fetch mock ───────────────────────────────────────────────

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errJson(code: string, message: string, status: number): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code, message } }),
  } as unknown as Response;
}

interface FetchMockOpts {
  runs?: TeamRunSummary[];
  comparison?: TeamComparison;
  snapshot?: (runId: string) => TeamRunSnapshot;
  activities?: TeamActivitySlim[];
  patch?: Record<string, unknown>;
  snapshotError?: { code: string; message: string; status: number };
}

function teamFetchMock(opts: FetchMockOpts = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.split('?')[0] ?? url;

    // DELETE /api/team-runs/:runId
    if (method === 'DELETE' && path.startsWith('/api/team-runs/')) {
      const runId = path.replace('/api/team-runs/', '');
      return okJson({ deleted: true, runId });
    }

    // POST /api/team-compare
    if (method === 'POST' && path === '/api/team-compare') {
      return okJson(opts.comparison ?? {
        leftRunId: 'a',
        rightRunId: 'b',
        basis: {
          match: 'matched', goalMatch: true, criteriaMatch: null, projectMatch: null,
          revisionMatch: null, environmentMatch: null, modelMatch: null,
          templateMatch: null, completenessDelta: null, userDeclared: false, reasons: [],
        },
        dimensions: [],
        strengths: [], weaknesses: [], tradeoffs: [], caveats: [],
        generatedAt: new Date().toISOString(),
      } satisfies TeamComparison);
    }

    // GET /api/team-runs/:runId/patch
    if (path.endsWith('/patch')) {
      return okJson(opts.patch ?? {
        runId: path.split('/')[3],
        stamp: `stamp-patched-${Date.now()}`,
        agents: [], tasks: [], agentEdges: [], taskDependencies: [],
        assignments: [], messages: [], artifacts: [],
        metrics: null,
        deletedAgentIds: [], deletedTaskIds: [], deletedMessageIds: [], deletedActivityIds: [],
        truncated: false,
      });
    }

    // GET /api/team-runs/:runId/activities/:activityId
    if (path.includes('/activities/') && !path.endsWith('/activities')) {
      return okJson({
        activity: makeActivity('act-1', path.split('/')[3] ?? 'unknown'),
        body: null,
        raw: null,
      });
    }

    // GET /api/team-runs/:runId/activities
    if (path.endsWith('/activities')) {
      const items = opts.activities ?? [];
      return okJson({
        items,
        nextCursor: null,
        hasMore: false,
        total: items.length,
        hasAmbiguousOrder: false,
      });
    }

    // GET /api/team-runs/:runId (snapshot)
    if (path.match(/^\/api\/team-runs\/[^/]+$/)) {
      const runId = path.replace('/api/team-runs/', '');
      if (opts.snapshotError !== undefined) {
        return errJson(opts.snapshotError.code, opts.snapshotError.message, opts.snapshotError.status);
      }
      const snapshot = opts.snapshot?.(runId) ?? makeSnapshot(runId);
      return okJson({ snapshot, stamp: `stamp-${runId}`, cached: false });
    }

    // GET /api/team-runs (list)
    if (path === '/api/team-runs') {
      const items = opts.runs ?? [];
      return okJson({ items, nextCursor: null, hasMore: false, total: items.length });
    }

    return okJson({});
  });
}

// ── render helpers ───────────────────────────────────────────


function render(node: React.JSX.Element): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

function rerender(root: ReturnType<typeof createRoot>, node: React.JSX.Element): void {
  act(() => root.render(node));
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** TeamShell 受控 harness：内部维护 teamHash state，外部控制 invalidateKey。 */
function TeamShellHarness({
  initialHash,
  invalidateKey,
  onHashChange,
}: {
  initialHash?: TeamHashState;
  invalidateKey: number;
  onHashChange?: (hash: TeamHashState) => void;
}): React.JSX.Element {
  // 用 useState 但通过 key 重新挂载来重置
  return <TeamShellHarnessInner initialHash={initialHash ?? DEFAULT_TEAM_HASH} invalidateKey={invalidateKey} onHashChange={onHashChange} />;
}

import { useState } from 'react';

function TeamShellHarnessInner({
  initialHash,
  invalidateKey,
  onHashChange,
}: {
  initialHash: TeamHashState;
  invalidateKey: number;
  onHashChange?: (hash: TeamHashState) => void;
}): React.JSX.Element {
  const [teamHash, setTeamHash] = useState<TeamHashState>(initialHash);
  const handle = (next: TeamHashState): void => {
    setTeamHash(next);
    onHashChange?.(next);
  };
  return <TeamShell locale="zh" teamHash={teamHash} onTeamHashChange={handle} invalidateKey={invalidateKey} />;
}

// ── setup ────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof teamFetchMock>;

beforeEach(() => {
  fetchMock = teamFetchMock();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.3 首帧 + run list
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell 首帧 + run list', () => {
  it('首帧加载 run list（防抖后）', async () => {
    const r1 = nextRunId();
    const r2 = nextRunId();
    vi.stubGlobal('fetch', teamFetchMock({ runs: [makeRun(r1), makeRun(r2)] }));
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    const rows = container.querySelectorAll('.team-row');
    expect(rows.length).toBe(2);
  });

  it('run list 空态', async () => {
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    expect(container.querySelector('.ui-empty')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.3 打开 run → snapshot + summary header
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell 打开 run', () => {
  it('点击 run 行 → 加载 snapshot + 渲染 summary header', async () => {
    const r1 = nextRunId();
    vi.stubGlobal('fetch', teamFetchMock({
      runs: [makeRun(r1, { title: 'fix build' })],
      snapshot: () => makeSnapshot(r1, { summary: makeRun(r1, { title: 'fix build' }) }),
    }));
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    const row = container.querySelector('.team-row') as HTMLElement;
    expect(row).not.toBeNull();
    act(() => row.click());
    await wait(50);
    // summary header 渲染
    expect(container.querySelector('.team-summary-header')).not.toBeNull();
    expect(container.querySelector('.team-summary-title')?.textContent).toBe('fix build');
  });

  it('未选 run 时渲染选择提示', async () => {
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    expect(container.textContent).toContain('从左侧选择一个团队运行');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.3 七视图切换
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell 七视图切换', () => {
  it('removes money from the reachable inline comparison while retaining Tokens and unchanged API evidence', async () => {
    const id = nextRunId();
    const comparison: TeamComparison = {
      leftRunId: id,
      rightRunId: `${id}-right`,
      basis: {
        match: 'matched', goalMatch: true, criteriaMatch: null, projectMatch: null,
        revisionMatch: null, environmentMatch: null, modelMatch: null,
        templateMatch: null, completenessDelta: null, userDeclared: false, reasons: [],
      },
      dimensions: [{
        dimension: 'cost',
        rows: ['totalCostUsd', 'costGini', 'totalInputTokens'].map((metricId, index) => ({
          metricId, dimension: 'cost', criteria: 'native evidence', direction: 'descriptive',
          left: makeMetricValue({ value: index === 2 ? 12345 : 456789.1234, available: true, complete: true }),
          right: makeMetricValue({ value: index === 2 ? 23456 : 987654.5678, available: true, complete: true }),
          delta: null, relativeDelta: null, material: false, completeness: 'complete', evidenceIds: [],
        })),
      }],
      strengths: ['totalCostUsd decreased 20%', 'wallClockMs decreased 10%'],
      weaknesses: ['费用增加 30%'], tradeoffs: ['更快但更贵'],
      caveats: ['cost dimension unavailable in at least one run', 'timing is partial'],
      generatedAt: '2026-10-18T00:00:00.000Z',
    };
    const before = JSON.stringify(comparison);
    const fetchMock = teamFetchMock({ runs: [makeRun(id)], comparison });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<TeamShellHarness invalidateKey={0} initialHash={{
      ...DEFAULT_TEAM_HASH, runId: id, panel: 'compare',
      compareLeft: id, compareRight: comparison.rightRunId,
    }} />);
    await wait(350);
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.team-compare-panel button'))
      .find(candidate => candidate.textContent === '运行对比');
    expect(button).toBeDefined();
    act(() => button!.click());
    await wait(50);
    const panel = container.querySelector('.team-compare-result');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('Token 用量');
    expect(panel!.textContent).toContain('totalInputTokens');
    expect(panel!.textContent).toContain('12345');
    expect(panel!.textContent).toContain('23456');
    expect(panel!.textContent).toContain('wallClockMs decreased 10%');
    expect(panel!.textContent).toContain('timing is partial');
    for (const excluded of ['totalCostUsd', 'costGini', '456789.1234', '987654.5678', '费用增加', '更贵', 'cost dimension']) {
      expect(panel!.textContent).not.toContain(excluded);
    }
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/team-compare' && init?.method === 'POST')).toHaveLength(1);
    expect(JSON.stringify(comparison)).toBe(before);
  });

  it('keeps unavailable communication distinct from measured zero in the summary and retains folded source metadata', async () => {
    const id = nextRunId();
    const summary = makeRun(id);
    summary.completeness = { ...summary.completeness, communication: 'unavailable' };
    summary.counts.communications = 0;
    vi.stubGlobal('fetch', teamFetchMock({ runs: [summary], snapshot: () => makeSnapshot(id, { summary, completeness: summary.completeness }) }));
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    expect(container.querySelector('.team-summary-meta')!.textContent).toContain('通信: 不可用');
    expect(container.querySelector('.team-summary-meta')!.textContent).not.toContain('0 通信');
    const source = container.querySelector('.team-summary-header details') as HTMLDetailsElement;
    expect(source.open).toBe(false);
    expect(source.textContent).toContain(summary.nativeRunId);
    expect(source.textContent).toContain('运行身份置信度');
  });

  it('七 tab 齐全 + 切换 panel', async () => {
    const r1 = nextRunId();
    vi.stubGlobal('fetch', teamFetchMock({ runs: [makeRun(r1)] }));
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(7);
    const labels = Array.from(tabs).map((t) => t.textContent);
    expect(labels).toEqual(['团队概览', '任务', '时间线', '通信', '账本', '检查器', '对比']);
    expect(container.querySelector('.team-workbench')).not.toBeNull();
    expect(container.querySelector('.team-workbench .tw-member')).not.toBeNull();

    // 切到 tasks
    act(() => (tabs[1] as HTMLElement).click());
    await wait(50);
    expect(container.querySelector('.team-tasks-panel')).not.toBeNull();
    // 切到 ledger
    act(() => (tabs[4] as HTMLElement).click());
    await wait(50);
    expect(container.querySelector('.team-ledger-panel')).not.toBeNull();
    // 切到 compare
    act(() => (tabs[6] as HTMLElement).click());
    await wait(50);
    expect(container.querySelector('.team-compare-panel')).not.toBeNull();
  });

  it('默认 topology panel 渲染', async () => {
    const r1 = nextRunId();
    vi.stubGlobal('fetch', teamFetchMock({ runs: [makeRun(r1)] }));
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    expect(container.querySelector('.team-topology-panel')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.7 selection 共享高亮（zero-request cross-highlighting）
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell selection 共享高亮', () => {
  it('omits monetary availability/currency even when source cost evidence exists, preserving Token availability',async()=>{
    const id=nextRunId();const summary=makeRun(id,{costAvailable:true,costCurrency:'USD'});
    vi.stubGlobal('fetch',teamFetchMock({runs:[summary],snapshot:()=>makeSnapshot(id,{summary})}));const {container}=render(<TeamShellHarness invalidateKey={0}/>);await wait(350);act(()=>(container.querySelector('.team-row') as HTMLElement).click());await wait(50);
    const header=container.querySelector('.team-summary-header')!;expect(header).not.toBeNull();expect(header.textContent).not.toContain('USD');expect(header.textContent).not.toContain('成本');expect(header.querySelector('.team-summary-provenance')?.textContent).toContain('Token');expect(summary.costCurrency).toBe('USD');
  });
  it('topology 选择 agent → 切 tasks → selection 保留（不发请求）', async () => {
    const r1 = nextRunId();
    const fetchCalls: string[] = [];
    const customMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      return teamFetchMock({ runs: [makeRun(r1)] })(input, init);
    });
    vi.stubGlobal('fetch', customMock);
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);

    // topology panel：点击第一个 agent node
    const agentNode = container.querySelector('.team-topo-node') as HTMLElement;
    expect(agentNode).not.toBeNull();
    act(() => agentNode.click());
    // selection 应该设置 → team-topo-node-on
    expect(container.querySelector('.team-topo-node-on')).not.toBeNull();

    // 切到 tasks panel
    const tabs = container.querySelectorAll('[role="tab"]');

    act(() => (tabs[1] as HTMLElement).click());
    await wait(50);
    // tasks panel 渲染
    expect(container.querySelector('.team-tasks-panel')).not.toBeNull();
    // selection 仍在 teamHash 中（切 panel 不发请求，zero-request cross-highlighting）
    // 验证切 panel 没有为每个 entity 发请求
    const snapshotCalls = fetchCalls.filter((c) => c.startsWith('GET /api/team-runs/r-'));
    // 打开 run 时 1 个 snapshot，切 panel 不增加 snapshot 请求
    expect(snapshotCalls.length).toBe(1);
  });

  it('tasks panel 选择 task → 切 topology → task 高亮保留', async () => {
    const r1 = nextRunId();
    vi.stubGlobal('fetch', teamFetchMock({ runs: [makeRun(r1)] }));
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);

    // 切到 tasks
    const tabs = container.querySelectorAll('[role="tab"]');
    act(() => (tabs[1] as HTMLElement).click());
    await wait(50);

    // 点击第一个 task row
    const taskRow = container.querySelector('.team-task-row') as HTMLElement;
    expect(taskRow).not.toBeNull();
    act(() => taskRow.click());
    expect(container.querySelector('.team-task-row-on')).not.toBeNull();

    // 切回 topology
    act(() => (tabs[0] as HTMLElement).click());
    await wait(50);
    // selection 保留（teamHash.selection 仍是 task）
    // topology panel 中 agent 不会被高亮（selection.kind === 'task'）
    expect(container.querySelector('.team-topo-node-on')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.4 no per-entity fetching
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell no per-entity fetching', () => {
  it('打开 run 只发 1 个 snapshot 请求，不为每个 agent/task 发请求', async () => {
    const r1 = nextRunId();
    const fetchCalls: string[] = [];
    const customMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url}`);
      return teamFetchMock({ runs: [makeRun(r1)] })(input, init);
    });
    vi.stubGlobal('fetch', customMock);
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);

    // 只有一个 snapshot 请求
    const snapshotCalls = fetchCalls.filter((c) =>
      c.match(/^GET \/api\/team-runs\/[^/]+$/) !== null,
    );
    expect(snapshotCalls.length).toBe(1);
    // 没有 /agents 或 /tasks 等单独端点
    const entityCalls = fetchCalls.filter((c) =>
      c.includes('/agents') || c.includes('/tasks/') || c.includes('/messages/'),
    );
    expect(entityCalls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.4 cache 行为
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell cache 行为', () => {
  it('切走切回同一 run 不再发 snapshot 请求（cache 命中）', async () => {
    const r1 = nextRunId();
    const r2 = nextRunId();
    const fetchCalls: string[] = [];
    const customMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url}`);
      return teamFetchMock({ runs: [makeRun(r1), makeRun(r2)] })(input, init);
    });
    vi.stubGlobal('fetch', customMock);
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);

    const rows = container.querySelectorAll('.team-row');
    // 打开 r1
    act(() => (rows[0] as HTMLElement).click());
    await wait(50);
    const snapshotCallsAfterFirst = fetchCalls.filter((c) =>
      c.match(/^GET \/api\/team-runs\/[^/]+$/) !== null,
    ).length;
    expect(snapshotCallsAfterFirst).toBe(1);

    // 切到 r2
    act(() => (rows[1] as HTMLElement).click());
    await wait(50);
    const snapshotCallsAfterSecond = fetchCalls.filter((c) =>
      c.match(/^GET \/api\/team-runs\/[^/]+$/) !== null,
    ).length;
    expect(snapshotCallsAfterSecond).toBe(2);

    // 切回 r1（cache 命中，不发请求）
    act(() => (rows[0] as HTMLElement).click());
    await wait(50);
    const snapshotCallsAfterThird = fetchCalls.filter((c) =>
      c.match(/^GET \/api\/team-runs\/[^/]+$/) !== null,
    ).length;
    expect(snapshotCallsAfterThird).toBe(2); // 仍然是 2，没有新请求
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.8 SSE patch
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell SSE patch', () => {
  it('列表态：invalidateKey 变化 → 重拉第一页', async () => {
    const r1 = nextRunId();
    const fetchCalls: string[] = [];
    const customMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      return teamFetchMock({ runs: [makeRun(r1)] })(input, init);
    });
    vi.stubGlobal('fetch', customMock);
    const { root } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    const listCallsBefore = fetchCalls.filter((c) => c === 'GET /api/team-runs').length;
    expect(listCallsBefore).toBe(1);

    // 触发 SSE patch（invalidateKey +1）
    rerender(root, <TeamShellHarness invalidateKey={1} />);
    await wait(350);
    const listCallsAfter = fetchCalls.filter((c) => c === 'GET /api/team-runs').length;
    expect(listCallsAfter).toBe(2);
  });

  it('打开 run 态：invalidateKey 变化 → patch 请求', async () => {
    const r1 = nextRunId();
    const fetchCalls: string[] = [];
    const customMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      return teamFetchMock({ runs: [makeRun(r1)] })(input, init);
    });
    vi.stubGlobal('fetch', customMock);
    const { container, root } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);

    // 触发 SSE patch
    rerender(root, <TeamShellHarness invalidateKey={1} />);
    await wait(50);
    const patchCalls = fetchCalls.filter((c) => c.endsWith('/patch'));
    expect(patchCalls.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.11 六状态
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell 六状态', () => {
  it('snapshot error 态渲染 ErrorState（非 404 错误）', async () => {
    const r1 = nextRunId();
    vi.stubGlobal(
      'fetch',
      teamFetchMock({
        runs: [makeRun(r1)],
        snapshotError: { code: 'TEAM_PANEL_FAILED', message: 'boom', status: 500 },
      }),
    );
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    expect(container.querySelector('.ui-error')).not.toBeNull();
  });

  it('snapshot 404 → onTeamHashChange 设置 invalidRunId', async () => {
    const r1 = nextRunId();
    const hashChanges: TeamHashState[] = [];
    vi.stubGlobal(
      'fetch',
      teamFetchMock({
        runs: [makeRun(r1)],
        snapshotError: { code: 'TEAM_RUN_NOT_FOUND', message: 'not found', status: 404 },
      }),
    );
    const { container } = render(
      <TeamShellHarness invalidateKey={0} onHashChange={(h) => hashChanges.push(h)} />,
    );
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    // 应该有 invalidRunId 设置
    const withInvalid = hashChanges.find((h) => h.invalidRunId !== null);
    expect(withInvalid).toBeDefined();
    expect(withInvalid?.invalidRunId).toBe(r1);
  });

  it('topology empty 态（snapshot.agents 为空）', async () => {
    const r1 = nextRunId();
    vi.stubGlobal(
      'fetch',
      teamFetchMock({
        runs: [makeRun(r1)],
        snapshot: () => makeSnapshot(r1, { agents: [], agentEdges: [] }),
      }),
    );
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    // topology panel empty 态
    expect(container.querySelector('.ui-empty')).not.toBeNull();
  });

  it('communication unavailable 态（completeness.communication=unavailable）', async () => {
    const r1 = nextRunId();
    const unavailableCompleteness = { ...FULL_COMPLETENESS, communication: 'unavailable' as CompletenessLevel };
    vi.stubGlobal(
      'fetch',
      teamFetchMock({
        runs: [makeRun(r1)],
        snapshot: () => makeSnapshot(r1, { completeness: unavailableCompleteness }),
      }),
    );
    const { container } = render(<TeamShellHarness invalidateKey={0} />);
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);
    // 切到 communication panel
    const tabs = container.querySelectorAll('[role="tab"]');
    act(() => (tabs[3] as HTMLElement).click());
    await wait(50);
    // unavailable 态渲染
    expect(container.textContent).toContain('团队数据不可用');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.7 删除 run
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamShell 删除 run', () => {
  it('点击删除 → DELETE 请求 + deletedRunId 设置', async () => {
    const r1 = nextRunId();
    const hashChanges: TeamHashState[] = [];
    const fetchCalls: string[] = [];
    const customMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      return teamFetchMock({ runs: [makeRun(r1)] })(input, init);
    });
    vi.stubGlobal('fetch', customMock);
    const { container } = render(
      <TeamShellHarness invalidateKey={0} onHashChange={(h) => hashChanges.push(h)} />,
    );
    await wait(350);
    act(() => (container.querySelector('.team-row') as HTMLElement).click());
    await wait(50);

    // 点击删除按钮
    const deleteBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('删除团队运行'),
    ) as HTMLButtonElement;
    expect(deleteBtn).toBeDefined();
    act(() => deleteBtn.click());
    await wait(50);

    // DELETE 请求发出
    const deleteCalls = fetchCalls.filter((c) => c.startsWith('DELETE /api/team-runs/'));
    expect(deleteCalls.length).toBe(1);

    // deletedRunId 设置
    const withDeleted = hashChanges.find((h) => h.deletedRunId !== null);
    expect(withDeleted).toBeDefined();
    expect(withDeleted?.deletedRunId).toBe(r1);
  });
});


describe('narrow run-list switching',()=>{
  it('reuses the existing list and closes it when a run is selected',async()=>{
    const id=nextRunId();vi.stubGlobal('fetch',teamFetchMock({runs:[makeRun(id)],snapshot:()=>makeSnapshot(id)}));
    const {container}=render(<TeamShellHarness invalidateKey={0}/>);await wait(350);
    const toggle=container.querySelector<HTMLButtonElement>('.team-mobile-runs-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');act(()=>toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');expect(container.querySelectorAll('.team-rail')).toHaveLength(1);
    act(()=>(container.querySelector('.team-row') as HTMLElement).click());await wait(50);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');expect(container.querySelector('.team-summary-title')).not.toBeNull();
  });
});
