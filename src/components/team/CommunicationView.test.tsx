/**
 * add-agent-team-observability §8.6 / §8.9 / §8.12 / §8.13 / §8.14 —
 * CommunicationView 测试。
 *
 * 覆盖：
 * - §8.6 通信图：direct/leader_mediated/broadcast/unknown、有向边聚合
 * - §8.9 G12.2 unavailable 不伪造、reply correlation、latency 仅在 correlated 时显示
 * - §8.12 跨视图高亮
 * - §8.13 无障碍
 * - §8.14 focus-visible、无 color-only meaning（mode/category 文字 label）
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  TeamAgent,
  TeamCommunication,
  TeamMetrics,
  TeamMetricValue,
  TeamRunSnapshot,
  TeamRunSummary,
} from '../../core/trace-types.js';
import { CommunicationView, type CommunicationViewProps } from './CommunicationView.js';
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
    counts: { agents: 2, tasks: 0, communications: 1, activities: 0, rounds: 0, artifacts: 0 },
    tokenAvailable: true, costAvailable: false, costCurrency: null,
    completeness: FULL_COMPLETENESS, updatedAt: new Date().toISOString(), stamp: 's',
  };
}

function makeAgent(id: string, runId: string): TeamAgent {
  return {
    id, runId, nativeId: `n-${id}`, displayName: `Agent ${id}`,
    role: 'team-mate', roleClass: 'teammate', model: null, state: 'completed',
    createdAt: null, endedAt: null, sessionKeys: [], evidenceIds: [],
  };
}

function makeMessage(
  id: string,
  runId: string,
  over: Partial<TeamCommunication> = {},
): TeamCommunication {
  return {
    id, runId, senderAgentId: 'a-1', recipientAgentIds: ['a-2'],
    mode: 'direct', category: 'coordination',
    taskId: null, correlationId: null, replyToId: null,
    sentAt: '2025-01-01T00:00:00Z', receivedAt: '2025-01-01T00:00:01Z',
    bodyAvailable: false, bodyChars: null, bodyBytes: null, contentHash: null,
    evidenceIds: [], ...over,
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
  over: { agents?: TeamAgent[]; communicationCompleteness?: CompletenessLevel } = {},
): TeamRunSnapshot {
  const completeness = { ...FULL_COMPLETENESS };
  if (over.communicationCompleteness !== undefined) {
    completeness.communication = over.communicationCompleteness;
  }
  return {
    summary: makeRun(runId),
    agents: over.agents ?? [makeAgent('a-1', runId), makeAgent('a-2', runId)],
    agentEdges: [],
    tasks: [],
    taskDependencies: [],
    assignments: [],
    artifacts: [],
    completeness,
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

function baseProps(over: Partial<CommunicationViewProps> = {}): CommunicationViewProps {
  return {
    snapshot: makeSnapshot('r-1'),
    messages: [],
    selection: null,
    onSelect: () => undefined,
    locale: 'zh',
    ...over,
  };
}

afterEach(() => { document.body.innerHTML = ''; });

// ═══════════════════════════════════════════════════════════════════════════
// §8.9 G12.2 unavailable 不伪造
// ═══════════════════════════════════════════════════════════════════════════

describe('CommunicationView §8.9 G12.2 unavailable 不伪造', () => {
  it('completeness.communication=unavailable 渲染 EmptyState（不伪造消息）', () => {
    const snap = makeSnapshot('r-1', { communicationCompleteness: 'unavailable' });
    const messages = [makeMessage('m-1', 'r-1')]; // 即使有消息也不渲染
    const container = render(
      <CommunicationView {...baseProps({ snapshot: snap, messages })} />,
    );
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('不可用');
    // 不渲染消息表
    expect(container.querySelector('.team-comm-row')).toBeNull();
    expect(container.querySelector('.team-comm-graph')).toBeNull();
  });

  it('无消息时渲染 empty（不伪造）', () => {
    const container = render(<CommunicationView {...baseProps({ messages: [] })} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('无消息记录');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.6 通信图
// ═══════════════════════════════════════════════════════════════════════════

describe('CommunicationView §8.6 通信图', () => {
  it('渲染有向图 + 消息表', () => {
    const messages = [makeMessage('m-1', 'r-1')];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    expect(container.querySelector('.team-comm-graph')).not.toBeNull();
    expect(container.querySelector('.team-comm-table')).not.toBeNull();
  });

  it('有向边聚合：同 sender→recipient 多条消息聚合为一条边 + count', () => {
    const messages = [
      makeMessage('m-1', 'r-1'),
      makeMessage('m-2', 'r-1', { category: 'question' }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const edges = container.querySelectorAll('.team-comm-edge');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.querySelector('.team-comm-edge-count')?.textContent).toBe('×2');
  });

  it('不同 sender→recipient 渲染多条边', () => {
    const messages = [
      makeMessage('m-1', 'r-1', { senderAgentId: 'a-1', recipientAgentIds: ['a-2'] }),
      makeMessage('m-2', 'r-1', { senderAgentId: 'a-2', recipientAgentIds: ['a-1'] }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    expect(container.querySelectorAll('.team-comm-edge')).toHaveLength(2);
  });

  it('direct/leader_mediated/broadcast/unknown mode 文字 label（无 color-only）', () => {
    const messages = [
      makeMessage('m-1', 'r-1', { mode: 'direct' }),
      makeMessage('m-2', 'r-1', { mode: 'leader_mediated' }),
      makeMessage('m-3', 'r-1', { mode: 'broadcast' }),
      makeMessage('m-4', 'r-1', { mode: 'unknown' }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const badges = container.querySelectorAll('.team-comm-mode-badge');
    const labels = [...badges].map((b) => b.textContent);
    expect(labels).toContain('直接');
    expect(labels).toContain('中介');
    expect(labels).toContain('广播');
    expect(labels).toContain('未知');
  });

  it('category 文字 label', () => {
    const messages = [
      makeMessage('m-1', 'r-1', { category: 'assignment' }),
      makeMessage('m-2', 'r-1', { category: 'question' }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const badges = container.querySelectorAll('.team-comm-category-badge');
    const labels = [...badges].map((b) => b.textContent);
    expect(labels).toContain('指派');
    expect(labels).toContain('提问');
  });

  it('消息行显示 sender → recipients', () => {
    const messages = [makeMessage('m-1', 'r-1')];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const row = container.querySelector('.team-comm-row');
    expect(row?.querySelector('.team-comm-sender')?.textContent).toBe('Agent a-1');
    expect(row?.querySelector('.team-comm-arrow')?.textContent).toBe('→');
    expect(row?.querySelector('.team-comm-recipients')?.textContent).toBe('Agent a-2');
  });

  it('§8.9 reply correlation：replyToId 非空时显示回复链', () => {
    const messages = [
      makeMessage('m-1', 'r-1'),
      makeMessage('m-2', 'r-1', { replyToId: 'm-1' }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const reply = container.querySelector('.team-comm-reply');
    expect(reply).not.toBeNull();
    expect(reply?.textContent).toContain('回复');
  });

  it('§8.9 latency 仅在 sentAt/receivedAt 均存在时显示', () => {
    const messages = [
      makeMessage('m-1', 'r-1', {
        sentAt: '2025-01-01T00:00:00Z',
        receivedAt: '2025-01-01T00:00:02Z',
      }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const latency = container.querySelector('.team-comm-latency');
    expect(latency).not.toBeNull();
    expect(latency?.textContent).toContain('2000'); // 2s = 2000ms
  });

  it('§8.9 latency 在 receivedAt 缺失时不显示（不伪造）', () => {
    const messages = [
      makeMessage('m-1', 'r-1', { receivedAt: null }),
    ];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    expect(container.querySelector('.team-comm-latency')).toBeNull();
  });

  it('broadcast：多 recipient 渲染为一条消息', () => {
    const messages = [
      makeMessage('m-1', 'r-1', {
        mode: 'broadcast',
        recipientAgentIds: ['a-2', 'a-3'],
      }),
    ];
    const snap = makeSnapshot('r-1', {
      agents: [makeAgent('a-1', 'r-1'), makeAgent('a-2', 'r-1'), makeAgent('a-3', 'r-1')],
    });
    const container = render(
      <CommunicationView {...baseProps({ snapshot: snap, messages })} />,
    );
    const row = container.querySelector('.team-comm-row');
    expect(row?.querySelector('.team-comm-recipients')?.textContent).toContain('Agent a-2');
    expect(row?.querySelector('.team-comm-recipients')?.textContent).toContain('Agent a-3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.12 跨视图高亮
// ═══════════════════════════════════════════════════════════════════════════

describe('CommunicationView §8.12 跨视图高亮', () => {
  it('selection=message 高亮对应行', () => {
    const messages = [makeMessage('m-1', 'r-1')];
    const selection: TeamSelection = { kind: 'message', id: 'm-1' };
    const container = render(
      <CommunicationView {...baseProps({ messages, selection })} />,
    );
    const onRow = container.querySelector('.team-comm-row-on');
    expect(onRow).not.toBeNull();
    expect(onRow?.getAttribute('aria-selected')).toBe('true');
  });

  it('点击消息行触发 onSelect（toggle）', () => {
    const calls: Array<TeamSelection | null> = [];
    const messages = [makeMessage('m-1', 'r-1')];
    const container = render(
      <CommunicationView {...baseProps({ messages, onSelect: (sel) => calls.push(sel) })} />,
    );
    const row = container.querySelector('.team-comm-row') as HTMLDivElement;
    act(() => { row.click(); });
    expect(calls).toEqual([{ kind: 'message', id: 'm-1' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.14 无障碍
// ═══════════════════════════════════════════════════════════════════════════

describe('CommunicationView §8.14 无障碍', () => {
  it('消息行 listitem role + aria-selected + tabIndex', () => {
    const messages = [makeMessage('m-1', 'r-1')];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const row = container.querySelector('.team-comm-row');
    expect(row?.getAttribute('role')).toBe('listitem');
    expect(row?.getAttribute('aria-selected')).toBe('false');
    expect(row?.getAttribute('tabindex')).toBe('0');
  });

  it('消息行 aria-label 含 mode + category + sender → recipient', () => {
    const messages = [makeMessage('m-1', 'r-1', { mode: 'direct', category: 'question' })];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const row = container.querySelector('.team-comm-row');
    const label = row?.getAttribute('aria-label') ?? '';
    expect(label).toContain('直接');
    expect(label).toContain('提问');
    expect(label).toContain('Agent a-1');
    expect(label).toContain('Agent a-2');
  });

  it('有向边 listitem role + aria-label', () => {
    const messages = [makeMessage('m-1', 'r-1')];
    const container = render(<CommunicationView {...baseProps({ messages })} />);
    const edge = container.querySelector('.team-comm-edge');
    expect(edge?.getAttribute('role')).toBe('listitem');
    expect(edge?.getAttribute('aria-label')).toContain('Agent a-1');
    expect(edge?.getAttribute('aria-label')).toContain('Agent a-2');
  });

  it('键盘 Enter 触发选择', () => {
    const calls: Array<TeamSelection | null> = [];
    const messages = [makeMessage('m-1', 'r-1')];
    const container = render(
      <CommunicationView {...baseProps({ messages, onSelect: (sel) => calls.push(sel) })} />,
    );
    const row = container.querySelector('.team-comm-row') as HTMLDivElement;
    act(() => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(calls).toEqual([{ kind: 'message', id: 'm-1' }]);
  });

  it('键盘 Esc 取消选择（已选中时）', () => {
    const calls: Array<TeamSelection | null> = [];
    const messages = [makeMessage('m-1', 'r-1')];
    const selection: TeamSelection = { kind: 'message', id: 'm-1' };
    const container = render(
      <CommunicationView {...baseProps({ messages, selection, onSelect: (sel) => calls.push(sel) })} />,
    );
    const row = container.querySelector('.team-comm-row-on') as HTMLDivElement;
    act(() => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual([null]);
  });
});
