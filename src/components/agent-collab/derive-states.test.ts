/**
 * agent-collaboration-replay §3.5.3 / §3.6 — derive-states 纯函数测试。
 *
 * 不 mock 被测逻辑、不放松断言（AGENTS.md）。
 */
import { describe, expect, it } from 'vitest';

import type {
  TeamActivitySlim,
  TeamAgent,
  TeamTask,
} from '../../core/trace-types.js';
import {
  countActivitiesPerTask,
  deriveAgentStates,
  mapTraceStatusToAgentState,
} from './derive-states.js';

// ── mock data helpers ────────────────────────────────────────

function makeAgent(id: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id,
    runId: 'r1',
    nativeId: `n-${id}`,
    displayName: `Agent ${id}`,
    role: 'team-mate',
    roleClass: 'teammate',
    model: 'gpt-4',
    state: 'idle',
    createdAt: null,
    endedAt: null,
    sessionKeys: [],
    evidenceIds: [],
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
    startedAt: '2024-01-01T00:00:00Z',
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

// ── deriveAgentStates 测试 ───────────────────────────────────

describe('deriveAgentStates', () => {
  it('1. 无活动 → 返回 agent 自身 state', () => {
    const agents = [
      makeAgent('a1', { state: 'busy' }),
      makeAgent('a2', { state: 'idle' }),
    ];
    const states = deriveAgentStates(agents, []);
    expect(states.get('a1')).toBe('busy');
    expect(states.get('a2')).toBe('idle');
  });

  it('2. agent_lifecycle 活动 → 覆盖 agent 自身 state', () => {
    const agents = [makeAgent('a1', { state: 'idle' })];
    const activities = [
      makeActivity('act1', { agentId: 'a1', kind: 'agent_lifecycle', status: 'running' }),
    ];
    const states = deriveAgentStates(agents, activities);
    // running → busy
    expect(states.get('a1')).toBe('busy');
  });

  it('3. 多状态序列：按 startedAt 升序，后覆盖前', () => {
    const agents = [makeAgent('a1', { state: 'created' })];
    const activities = [
      // 故意倒序传入
      makeActivity('act3', {
        agentId: 'a1',
        kind: 'agent_lifecycle',
        status: 'success',
        startedAt: '2024-01-01T00:02:00Z',
      }),
      makeActivity('act1', {
        agentId: 'a1',
        kind: 'agent_lifecycle',
        status: 'running',
        startedAt: '2024-01-01T00:00:00Z',
      }),
      makeActivity('act2', {
        agentId: 'a1',
        kind: 'agent_lifecycle',
        status: 'error',
        startedAt: '2024-01-01T00:01:00Z',
      }),
    ];
    const states = deriveAgentStates(agents, activities);
    // 最后（按时间升序）是 success → completed
    expect(states.get('a1')).toBe('completed');
  });

  it('4. 非 agent_lifecycle 活动不参与状态推导', () => {
    const agents = [makeAgent('a1', { state: 'idle' })];
    const activities = [
      makeActivity('act1', { agentId: 'a1', kind: 'tool_call', status: 'success' }),
      makeActivity('act2', { agentId: 'a1', kind: 'message_sent', status: 'running' }),
    ];
    const states = deriveAgentStates(agents, activities);
    // 状态保持 idle（无 agent_lifecycle 活动覆盖）
    expect(states.get('a1')).toBe('idle');
  });

  it('5. mapTraceStatusToAgentState 全分支', () => {
    expect(mapTraceStatusToAgentState('success')).toBe('completed');
    expect(mapTraceStatusToAgentState('running')).toBe('busy');
    expect(mapTraceStatusToAgentState('error')).toBe('failed');
    expect(mapTraceStatusToAgentState('cancelled')).toBe('cancelled');
    expect(mapTraceStatusToAgentState('unknown')).toBe('unknown');

  });
});

// ── countActivitiesPerTask 测试 ─────────────────────────────

describe('countActivitiesPerTask', () => {
  it('1. 空 activities → 全 0', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')];
    const counts = countActivitiesPerTask(tasks, []);
    expect(counts).toEqual([0, 0, 0]);
  });

  it('2. 多 task + 多活动 → 按 taskId 累加', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')];
    const activities = [
      makeActivity('a1', { taskId: 't1' }),
      makeActivity('a2', { taskId: 't1' }),
      makeActivity('a3', { taskId: 't2' }),
      makeActivity('a4', { taskId: 't1' }),
      makeActivity('a5', { taskId: 't3' }),
      makeActivity('a6', { taskId: 't3' }),
      makeActivity('a7', { taskId: 't3' }),
    ];
    const counts = countActivitiesPerTask(tasks, activities);
    expect(counts).toEqual([3, 1, 3]);
  });

  it('3. task 无活动 → 对应位置 0', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')];
    const activities = [
      makeActivity('a1', { taskId: 't1' }),
      makeActivity('a2', { taskId: 't1' }),
    ];
    const counts = countActivitiesPerTask(tasks, activities);
    expect(counts).toEqual([2, 0, 0]);
  });

  it('4. activity.taskId = null → 跳过不计入任何 task', () => {
    const tasks = [makeTask('t1')];
    const activities = [
      makeActivity('a1', { taskId: null }),
      makeActivity('a2', { taskId: 't1' }),
    ];
    const counts = countActivitiesPerTask(tasks, activities);
    expect(counts).toEqual([1]);
  });

  it('5. 空 tasks → 空数组', () => {
    const counts = countActivitiesPerTask([], [
      makeActivity('a1', { taskId: 't1' }),
    ]);
    expect(counts).toEqual([]);
  });
});
