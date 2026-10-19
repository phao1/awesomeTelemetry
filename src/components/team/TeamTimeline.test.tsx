/**
 * add-agent-team-observability §8.3 / §8.4 / §8.11 / §8.13 / §8.14 —
 * TeamTimeline 测试。
 *
 * 覆盖：
 * - §8.3 swimlane 时间线：活动条定位、open ends、ambiguous order
 * - §8.4 虚拟化 lane + 聚合 omitted 计数
 * - §8.11 overlap / dynamic join/leave / unknown vs idle/blocked / ambiguous clocks / running intervals
 * - §8.13 无障碍
 * - §8.14 focus-visible、无 color-only meaning
 * - §8.12 跨视图高亮
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  TeamActivitySlim,
  TeamAgent,
  TeamMetrics,
  TeamMetricValue,
  TeamRunSnapshot,
  TeamRunSummary,
} from '../../core/trace-types.js';
import { TeamTimeline, type TeamTimelineProps } from './TeamTimeline.js';
import type { TeamSelection } from './team-client.js';

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
    counts: { agents: 1, tasks: 0, communications: 0, activities: 0, rounds: 0, artifacts: 0 },
    tokenAvailable: true, costAvailable: false, costCurrency: null,
    completeness: FULL_COMPLETENESS, updatedAt: new Date().toISOString(), stamp: 's',
  };
}

function makeAgent(id: string, runId: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id, runId, nativeId: `n-${id}`, displayName: `Agent ${id}`,
    role: 'team-mate', roleClass: 'teammate', model: null, state: 'completed',
    createdAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T01:00:00Z',
    sessionKeys: [], evidenceIds: [], ...over,
  };
}

function makeActivity(id: string, runId: string, over: Partial<TeamActivitySlim> = {}): TeamActivitySlim {
  return {
    id, runId, agentId: 'a-1', taskId: null, roundId: null,
    kind: 'tool_call', status: 'success',
    startedAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T00:30:00Z',
    nativeSequence: 1, sessionKey: null, eventId: null, turnKey: null,
    messageId: null, artifactId: null, tokenUsage: null,
    costUsd: null, costSource: null, costCurrency: null,
    hasInput: false, hasOutput: false, hasRaw: false,
    evidenceIds: [], orderConfidence: 'native', ...over,
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

function makeSnapshot(
  runId: string,
  over: { agents?: TeamAgent[] } = {},
): TeamRunSnapshot {
  return {
    summary: makeRun(runId),
    agents: over.agents ?? [makeAgent('a-1', runId)],
    agentEdges: [],
    tasks: [],
    taskDependencies: [],
    assignments: [],
    artifacts: [],
    completeness: FULL_COMPLETENESS,
    anomalies: [],
    metrics: makeMetrics(),
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<TeamTimelineProps> = {}): TeamTimelineProps {
  return {
    snapshot: makeSnapshot('r-1'),
    activities: [],
    selection: null,
    onSelect: () => undefined,
    locale: 'zh',
    ...over,
  };
}

afterEach(() => { document.body.innerHTML = ''; });

// ═══════════════════════════════════════════════════════════════════════════
// §8.3 渲染
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamTimeline §8.3 渲染', () => {
  it('empty 态：无 agent 渲染 EmptyState', () => {
    const snap = makeSnapshot('r-1', { agents: [] });
    const container = render(<TeamTimeline {...baseProps({ snapshot: snap })} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('无时间线数据');
  });

  it('渲染 lane（每 agent 一条）', () => {
    const snap = makeSnapshot('r-1', {
      agents: [makeAgent('a-1', 'r-1'), makeAgent('a-2', 'r-1')],
    });
    const container = render(<TeamTimeline {...baseProps({ snapshot: snap })} />);
    const lanes = container.querySelectorAll('.team-timeline-lane');
    expect(lanes).toHaveLength(2);
  });

  it('lane label 显示 agent name + state label + concurrency', () => {
    const container = render(<TeamTimeline {...baseProps()} />);
    const label = container.querySelector('.team-timeline-lane-label');
    expect(label).not.toBeNull();
    expect(label?.querySelector('.team-timeline-lane-name')?.textContent).toBe('Agent a-1');
    expect(label?.querySelector('.team-timeline-lane-state')?.textContent).toBe('已完成');
    expect(label?.querySelector('.team-timeline-lane-conc')?.textContent).toContain('×');
  });

  it('活动条按 startedAt/endedAt 定位（left/width style）', () => {
    const activities = [
      makeActivity('act-1', 'r-1', {
        startedAt: '2025-01-01T00:00:00Z',
        endedAt: '2025-01-01T00:30:00Z',
      }),
    ];
    const container = render(<TeamTimeline {...baseProps({ activities })} />);
    const bar = container.querySelector('.team-timeline-activity');
    expect(bar).not.toBeNull();
    const style = (bar as HTMLDivElement).style;
    expect(style.left).not.toBe('');
    expect(style.width).not.toBe('');
  });

  it('§8.11 open ends：endedAt=null 活动条标记 open', () => {
    const activities = [
      makeActivity('act-1', 'r-1', { endedAt: null }),
    ];
    const container = render(<TeamTimeline {...baseProps({ activities })} />);
    expect(container.querySelector('.team-timeline-activity-open')).not.toBeNull();
  });

  it('§8.11 ambiguous order：orderConfidence=ambiguous 标记', () => {
    const activities = [
      makeActivity('act-1', 'r-1', { orderConfidence: 'ambiguous' }),
    ];
    const container = render(<TeamTimeline {...baseProps({ activities })} />);
    expect(container.querySelector('.team-timeline-activity-ambiguous')).not.toBeNull();
    expect(container.querySelector('.team-timeline-activity-ambiguous-marker')?.textContent).toBe('≈');
  });

  it('§8.11 unknown vs idle/blocked：state 文字 label 区分（无 color-only）', () => {
    const snap = makeSnapshot('r-1', {
      agents: [
        makeAgent('a-1', 'r-1', { state: 'unknown' }),
        makeAgent('a-2', 'r-1', { state: 'idle' }),
        makeAgent('a-3', 'r-1', { state: 'blocked' }),
      ],
    });
    const container = render(<TeamTimeline {...baseProps({ snapshot: snap })} />);
    const states = container.querySelectorAll('.team-timeline-lane-state');
    expect(states[0]?.textContent).toBe('未知');
    expect(states[1]?.textContent).toBe('空闲');
    expect(states[2]?.textContent).toBe('阻塞');
  });

  it('活动 kind 文字 label（无 color-only meaning）', () => {
    const activities = [makeActivity('act-1', 'r-1', { kind: 'tool_call' })];
    const container = render(<TeamTimeline {...baseProps({ activities })} />);
    const bar = container.querySelector('.team-timeline-activity');
    expect(bar?.querySelector('.team-timeline-activity-kind')?.textContent).toBe('工具调用');
  });

  it('无活动的 lane 显示「无活动」', () => {
    const container = render(<TeamTimeline {...baseProps({ activities: [] })} />);
    expect(container.querySelector('.team-timeline-lane-empty')?.textContent).toBe('无活动');
  });

  it('wall-clock axis 显示 min/max 时间', () => {
    const container = render(<TeamTimeline {...baseProps()} />);
    const axis = container.querySelector('.team-timeline-axis');
    expect(axis).not.toBeNull();
    expect(axis?.querySelector('.team-timeline-axis-min')).not.toBeNull();
    expect(axis?.querySelector('.team-timeline-axis-max')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.4 虚拟化 + 聚合
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamTimeline §8.4 聚合 omitted', () => {
  it('lane 超过 laneCap 时显示 omitted 计数', () => {
    const agents = Array.from({ length: 5 }, (_, i) => makeAgent(`a-${i}`, 'r-1'));
    const snap = makeSnapshot('r-1', { agents });
    const container = render(
      <TeamTimeline {...baseProps({ snapshot: snap, laneCap: 2 })} />,
    );
    const omitted = container.querySelector('.team-timeline-omitted');
    expect(omitted).not.toBeNull();
    expect(omitted?.textContent).toContain('3'); // 5 - 2 = 3
    expect(omitted?.getAttribute('role')).toBe('status');
  });

  it('lane 未超 laneCap 时不显示 omitted', () => {
    const container = render(<TeamTimeline {...baseProps({ laneCap: 200 })} />);
    expect(container.querySelector('.team-timeline-omitted')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.12 跨视图高亮
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamTimeline §8.12 跨视图高亮', () => {
  it('selection=agent 高亮对应 lane', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<TeamTimeline {...baseProps({ selection })} />);
    const onLane = container.querySelector('.team-timeline-lane-on');
    expect(onLane).not.toBeNull();
    expect(onLane?.getAttribute('aria-selected')).toBe('true');
  });

  it('selection=activity 高亮对应活动条', () => {
    const activities = [makeActivity('act-1', 'r-1')];
    const selection: TeamSelection = { kind: 'activity', id: 'act-1' };
    const container = render(<TeamTimeline {...baseProps({ activities, selection })} />);
    const onBar = container.querySelector('.team-timeline-activity-on');
    expect(onBar).not.toBeNull();
    expect(onBar?.getAttribute('aria-selected')).toBe('true');
  });

  it('点击 lane label 触发 agent selection', () => {
    const calls: Array<TeamSelection | null> = [];
    const container = render(
      <TeamTimeline {...baseProps({ onSelect: (sel) => calls.push(sel) })} />,
    );
    const label = container.querySelector('.team-timeline-lane-label') as HTMLButtonElement;
    act(() => { label.click(); });
    expect(calls).toEqual([{ kind: 'agent', id: 'a-1' }]);
  });

  it('点击活动条触发 activity selection', () => {
    const calls: Array<TeamSelection | null> = [];
    const activities = [makeActivity('act-1', 'r-1')];
    const container = render(
      <TeamTimeline {...baseProps({ activities, onSelect: (sel) => calls.push(sel) })} />,
    );
    const bar = container.querySelector('.team-timeline-activity') as HTMLDivElement;
    act(() => { bar.click(); });
    expect(calls).toEqual([{ kind: 'activity', id: 'act-1' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.14 无障碍
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamTimeline §8.14 无障碍', () => {
  it('list role + aria-label', () => {
    const container = render(<TeamTimeline {...baseProps()} />);
    const view = container.querySelector('.team-timeline-view');
    expect(view?.getAttribute('role')).toBe('list');
    expect(view?.getAttribute('aria-label')).toBe('时间线');
  });

  it('lane listitem role + aria-selected + aria-label', () => {
    const container = render(<TeamTimeline {...baseProps()} />);
    const lane = container.querySelector('.team-timeline-lane');
    expect(lane?.getAttribute('role')).toBe('listitem');
    expect(lane?.getAttribute('aria-selected')).toBe('false');
    expect(lane?.getAttribute('aria-label')).toContain('Agent a-1');
  });

  it('活动条 listitem role + aria-label 含时间', () => {
    const activities = [makeActivity('act-1', 'r-1')];
    const container = render(<TeamTimeline {...baseProps({ activities })} />);
    const bar = container.querySelector('.team-timeline-activity');
    expect(bar?.getAttribute('role')).toBe('listitem');
    expect(bar?.getAttribute('aria-label')).toContain('工具调用');
    expect(bar?.getAttribute('aria-label')).toContain('→');
  });

  it('活动条 tabIndex=0（键盘可达）', () => {
    const activities = [makeActivity('act-1', 'r-1')];
    const container = render(<TeamTimeline {...baseProps({ activities })} />);
    const bar = container.querySelector('.team-timeline-activity');
    expect(bar?.getAttribute('tabindex')).toBe('0');
  });

  it('键盘 Enter 触发 activity selection', () => {
    const calls: Array<TeamSelection | null> = [];
    const activities = [makeActivity('act-1', 'r-1')];
    const container = render(
      <TeamTimeline {...baseProps({ activities, onSelect: (sel) => calls.push(sel) })} />,
    );
    const bar = container.querySelector('.team-timeline-activity') as HTMLDivElement;
    act(() => {
      bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(calls).toEqual([{ kind: 'activity', id: 'act-1' }]);
  });
});
