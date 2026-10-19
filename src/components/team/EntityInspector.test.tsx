/**
 * add-agent-team-observability §8.7 / §8.8 / §8.13 / §8.14 —
 * EntityInspector 测试。
 *
 * 覆盖：
 * - §8.7 entity inspector：agent/task/activity/message/artifact/edge 七种 selection
 * - §8.8 body/raw detail control：显式展开、1 请求/tier、bounded cache（由上层）
 * - §8.13 无障碍
 * - §8.14 focus-visible、无 color-only meaning
 * - §8.12 跨视图高亮
 * - not-found 态、empty 态
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdge,
  TeamArtifact,
  TeamMetrics,
  TeamMetricValue,
  TeamRunSnapshot,
  TeamRunSummary,
  TeamTask,
} from '../../core/trace-types.js';
import { EntityInspector, type EntityInspectorProps } from './EntityInspector.js';
import type {
  TeamActivityDetailResponse,
  TeamSelection,
} from './team-client.js';

// ── mock data helpers ────────────────────────────────────────

const FULL_COMPLETENESS: Record<EvidenceDimension, CompletenessLevel> = {
  topology: 'complete', tasks: 'complete', communication: 'partial',
  timing: 'complete', tools: 'complete', outputs: 'complete',
  tokens: 'complete', cost: 'unavailable', verification: 'partial',
};

function makeRun(id: string): TeamRunSummary {
  return {
    id, provider: 'codex', nativeRunId: `n-${id}`, runIdentityConfidence: 'native',
    title: `run ${id}`, goalFingerprint: null, status: 'success',
    startedAt: null, endedAt: null, topologyKind: 'two_level',
    counts: { agents: 2, tasks: 1, communications: 0, activities: 0, rounds: 0, artifacts: 1 },
    tokenAvailable: true, costAvailable: false, costCurrency: null,
    completeness: FULL_COMPLETENESS, updatedAt: new Date().toISOString(), stamp: 's',
  };
}

function makeAgent(id: string, runId: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id, runId, nativeId: `n-${id}`, displayName: `Agent ${id}`,
    role: 'team-mate', roleClass: 'teammate', model: 'gpt-4', state: 'completed',
    createdAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T01:00:00Z',
    sessionKeys: ['sess-1'], evidenceIds: ['ev-1'], ...over,
  };
}

function makeTask(id: string, runId: string): TeamTask {
  return {
    id, runId, nativeId: `n-${id}`, title: `Task ${id}`,
    descriptionAvailable: true, priority: 2, status: 'completed',
    createdAt: '2025-01-01T00:00:00Z', startedAt: '2025-01-01T00:00:00Z',
    completedAt: '2025-01-01T00:30:00Z', cancelledAt: null, failedAt: null,
    resultAvailable: true, evidenceIds: ['ev-2'],
  };
}

function makeEdge(id: string, runId: string, from: string, to: string): TeamAgentEdge {
  return {
    id, runId, fromAgentId: from, toAgentId: to, kind: 'supervises',
    validFrom: null, validTo: null, confidence: 'native', evidenceIds: ['ev-3'],
  };
}

function makeArtifact(id: string, runId: string): TeamArtifact {
  return {
    id, runId, nativeId: null, name: `artifact ${id}`, kind: 'patch',
    pathRedacted: '/redacted/path', contentHash: 'abc123',
    producerAgentIds: ['a-1'], taskIds: ['t-1'],
    createdAt: '2025-01-01T00:00:00Z', acceptedAt: null, hasContent: true,
    evidenceIds: ['ev-4'],
  };
}

function makeMetricValue(): TeamMetricValue {
  return { value: null, available: false, complete: false, criteria: '', evidenceIds: [], numerator: null, denominator: null };
}

function makeMetrics(): TeamMetrics {
  const v = makeMetricValue();
  return {
    calcVersion: 1, generatedAt: new Date().toISOString(),
    scheduling: { wallClockMs: v, agentActiveMs: v, totalWorkMs: v, observedWaitMs: v, maxConcurrency: v, avgConcurrency: v, serialWorkEstimateMs: v, observedSpeedup: v, peakCapacityUtilization: v, criticalPathMs: v, delegationDelayMs: v, handoffLatencyMs: v },
    quality: { taskCompletion: v, verificationCoverage: v, acceptanceCoverage: v, reviewRework: v, acceptedArtifactRate: v },
    stability: { failures: v, retries: v, replacements: v, recoveryLatencyMs: v, blockedOrphanTimeMs: v, unresolvedErrors: v, dagAnomalies: v, incompleteTerminalStates: v },
    cost: { totalInputTokens: v, totalOutputTokens: v, totalReasoningTokens: v, totalCacheReadTokens: v, totalCacheWriteTokens: v, totalCostUsd: v, costCurrency: null, coordinationTokens: v, costGini: v },
    collaboration: { directRatio: v, leaderMediatedRatio: v, responseLatencyMedianMs: v, responseLatencyP95Ms: v, taskBalanceGini: v, leaderWorkConcentration: v, criticalAgentConcentration: v, crossAgentReview: v, duplicateWorkSignal: v },
  };
}

function makeSnapshot(runId: string): TeamRunSnapshot {
  return {
    summary: makeRun(runId),
    agents: [makeAgent('a-1', runId, { role: 'team-leader', roleClass: 'leader' }), makeAgent('a-2', runId)],
    agentEdges: [makeEdge('e-1', runId, 'a-1', 'a-2')],
    tasks: [makeTask('t-1', runId)],
    taskDependencies: [],
    assignments: [],
    artifacts: [makeArtifact('ar-1', runId)],
    completeness: FULL_COMPLETENESS,
    anomalies: [],
    metrics: makeMetrics(),
  };
}

function makeActivityDetail(
  activityId: string,
  over: Partial<TeamActivityDetailResponse> = {},
): TeamActivityDetailResponse {
  const activity: TeamActivitySlim = {
    id: activityId, runId: 'r-1', agentId: 'a-1', taskId: null, roundId: null,
    kind: 'tool_call', status: 'success',
    startedAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T00:30:00Z',
    nativeSequence: 1, sessionKey: null, eventId: null, turnKey: null,
    messageId: null, artifactId: null, tokenUsage: null,
    costUsd: null, costSource: null, costCurrency: null,
    hasInput: true, hasOutput: true, hasRaw: false,
    evidenceIds: ['ev-5'], orderConfidence: 'native',
  };
  return { activity, body: null, raw: null, ...over };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<EntityInspectorProps> = {}): EntityInspectorProps {
  return {
    selection: null,
    snapshot: makeSnapshot('r-1'),
    bodyDetail: null,
    bodyState: 'empty',
    bodyError: null,
    locale: 'zh',
    onLoadBody: () => undefined,
    ...over,
  };
}

afterEach(() => { document.body.innerHTML = ''; });

// ═══════════════════════════════════════════════════════════════════════════
// §8.7 entity inspector
// ═══════════════════════════════════════════════════════════════════════════

describe('EntityInspector §8.7 entity inspector', () => {
  it('selection=null 渲染 EmptyState', () => {
    const container = render(<EntityInspector {...baseProps()} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('未选择实体');
  });

  it('selection=agent 渲染 agent 详情', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-entity')).not.toBeNull();
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('Agent');
    expect(container.querySelector('.team-inspector-id')?.textContent).toBe('a-1');
    // agent 字段
    const fields = container.querySelectorAll('.team-inspector-field-value');
    const texts = [...fields].map((f) => f.textContent);
    expect(texts).toContain('team-leader');
    expect(texts).toContain('leader');
    expect(texts).toContain('gpt-4');
  });

  it('selection=task 渲染 task 详情', () => {
    const selection: TeamSelection = { kind: 'task', id: 't-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('任务');
    const fields = container.querySelectorAll('.team-inspector-field-value');
    const texts = [...fields].map((f) => f.textContent);
    expect(texts).toContain('Task t-1');
    expect(texts).toContain('completed');
  });

  it('selection=artifact 渲染 artifact 详情', () => {
    const selection: TeamSelection = { kind: 'artifact', id: 'ar-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('产物');
    const fields = container.querySelectorAll('.team-inspector-field-value');
    const texts = [...fields].map((f) => f.textContent);
    expect(texts).toContain('artifact ar-1');
    expect(texts).toContain('patch');
  });

  it('selection=edge 渲染 edge 详情（含 from/to agent name）', () => {
    const selection: TeamSelection = { kind: 'edge', id: 'e-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('边');
    const fields = container.querySelectorAll('.team-inspector-field-value');
    const texts = [...fields].map((f) => f.textContent);
    expect(texts).toContain('supervises');
    expect(texts).toContain('Agent a-1');
    expect(texts).toContain('Agent a-2');
  });

  it('selection=activity 渲染 activity 详情（从 bodyDetail.activity）', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const bodyDetail = makeActivityDetail('act-1');
    const container = render(
      <EntityInspector {...baseProps({ selection, bodyDetail, bodyState: 'success' })} />,
    );
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('活动');
    // activity 字段
    const fields = container.querySelectorAll('.team-inspector-field-value');
    const texts = [...fields].map((f) => f.textContent);
    expect(texts).toContain('tool_call');
    expect(texts).toContain('success');
  });

  it('selection=activity 无 bodyDetail 时显示 id 占位（不伪造）', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-id')?.textContent).toBe('act-1');
  });

  it('selection=message 渲染 id 占位（message 不在 snapshot）', () => {
    const selection: TeamSelection = { kind: 'message', id: 'm-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('消息');
    expect(container.querySelector('.team-inspector-id')?.textContent).toBe('m-1');
  });

  it('selection=round 渲染 id 占位', () => {
    const selection: TeamSelection = { kind: 'round', id: 'rd-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('轮次');
  });

  it('not-found：selection 指向不存在的 agent', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'ghost' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('实体未找到');
  });

  it('provenance：evidenceIds 列表', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const provenance = container.querySelector('.team-inspector-provenance');
    expect(provenance).not.toBeNull();
    expect(container.querySelector('.team-inspector-evidence-id')?.textContent).toBe('ev-1');
  });

  it('sessionKeys：agent 关联会话', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const fields = container.querySelectorAll('.team-inspector-field');
    const sessionField = [...fields].find((f) => f.querySelector('.team-inspector-field-label')?.textContent === '关联会话');
    expect(sessionField?.querySelector('.team-inspector-field-value')?.textContent).toContain('sess-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.8 body/raw detail control
// ═══════════════════════════════════════════════════════════════════════════

describe('EntityInspector §8.8 body/raw detail', () => {
  it('selection=activity 时显示 Load body / Load raw 按钮', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const buttons = container.querySelectorAll('.team-inspector-body-actions button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toBe('加载 body');
    expect(buttons[1]?.textContent).toBe('加载 raw');
  });

  it('selection=agent 时不显示 body 按钮（仅 activity 有 body）', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    expect(container.querySelector('.team-inspector-body-actions')).toBeNull();
  });

  it('点击 Load body 触发 onLoadBody(activityId, "body")', () => {
    const calls: Array<{ id: string; tier: 'body' | 'raw' }> = [];
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(
      <EntityInspector {...baseProps({ selection, onLoadBody: (id, tier) => calls.push({ id, tier }) })} />,
    );
    const buttons = container.querySelectorAll('.team-inspector-body-actions button');
    act(() => { (buttons[0] as HTMLButtonElement).click(); });
    expect(calls).toEqual([{ id: 'act-1', tier: 'body' }]);
  });

  it('点击 Load raw 触发 onLoadBody(activityId, "raw")', () => {
    const calls: Array<{ id: string; tier: 'body' | 'raw' }> = [];
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(
      <EntityInspector {...baseProps({ selection, onLoadBody: (id, tier) => calls.push({ id, tier }) })} />,
    );
    const buttons = container.querySelectorAll('.team-inspector-body-actions button');
    act(() => { (buttons[1] as HTMLButtonElement).click(); });
    expect(calls).toEqual([{ id: 'act-1', tier: 'raw' }]);
  });

  it('bodyState=loading 渲染 Skeleton', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(
      <EntityInspector {...baseProps({ selection, bodyState: 'loading' })} />,
    );
    expect(container.querySelector('.ui-skeleton')).not.toBeNull();
  });

  it('bodyState=error 渲染 ErrorState + retry', () => {
    const calls: Array<{ id: string; tier: 'body' | 'raw' }> = [];
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(
      <EntityInspector {...baseProps({
        selection,
        bodyState: 'error',
        bodyError: 'TEAM_BODY_UNAVAILABLE: boom',
        onLoadBody: (id, tier) => calls.push({ id, tier }),
      })} />,
    );
    const err = container.querySelector('.ui-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('TEAM_BODY_UNAVAILABLE');
    // retry 按钮
    const retryBtn = err?.querySelector('button') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    act(() => { retryBtn.click(); });
    expect(calls).toEqual([{ id: 'act-1', tier: 'body' }]);
  });

  it('bodyState=success + bodyDetail.body 渲染 input/output', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const bodyDetail = makeActivityDetail('act-1', {
      body: { input: 'hello', output: 'world', message: null, result: null },
    });
    const container = render(
      <EntityInspector {...baseProps({ selection, bodyDetail, bodyState: 'success' })} />,
    );
    const rows = container.querySelectorAll('.team-inspector-body-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.team-inspector-body-dl')).not.toBeNull();
  });

  it('bodyDetail.raw 渲染 raw pre', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const bodyDetail = makeActivityDetail('act-1', { raw: '{"raw":"data"}' });
    const container = render(
      <EntityInspector {...baseProps({ selection, bodyDetail, bodyState: 'success' })} />,
    );
    const raw = container.querySelector('.team-inspector-body-raw');
    expect(raw).not.toBeNull();
    expect(raw?.textContent).toContain('{"raw":"data"}');
  });

  it('bodyState=unavailable 渲染 unavailable EmptyState', () => {
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(
      <EntityInspector {...baseProps({ selection, bodyState: 'unavailable' })} />,
    );
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('不可用');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.14 无障碍
// ═══════════════════════════════════════════════════════════════════════════

describe('EntityInspector §8.14 无障碍', () => {
  it('region role + aria-label', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const panel = container.querySelector('.team-inspector-entity');
    expect(panel?.getAttribute('role')).toBe('region');
    expect(panel?.getAttribute('aria-label')).toBe('实体检查器');
  });

  it('provenance list role + aria-label', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const provenance = container.querySelector('.team-inspector-provenance');
    expect(provenance?.getAttribute('role')).toBe('list');
    expect(provenance?.getAttribute('aria-label')).toBe('证据来源');
  });

  it('evidence id listitem role', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<EntityInspector {...baseProps({ selection })} />);
    const evId = container.querySelector('.team-inspector-evidence-id');
    expect(evId?.getAttribute('role')).toBe('listitem');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.12 跨视图高亮（inspector 跟随 selection）
// ═══════════════════════════════════════════════════════════════════════════

describe('EntityInspector §8.12 跨视图高亮', () => {
  it('selection 变化时 inspector 同步更新', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    // 先选 agent
    act(() => {
      root.render(<EntityInspector {...baseProps({ selection: { kind: 'agent', id: 'a-1' } })} />);
    });
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('Agent');
    // 切换到 task
    act(() => {
      root.render(<EntityInspector {...baseProps({ selection: { kind: 'task', id: 't-1' } })} />);
    });
    expect(container.querySelector('.team-inspector-kind')?.textContent).toBe('任务');
    root.unmount();
  });
});
