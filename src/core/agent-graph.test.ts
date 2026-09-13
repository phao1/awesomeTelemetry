import { describe, expect, it } from 'vitest';

import { deriveAgentGraph, MAIN_AGENT_ID } from './agent-graph.js';
import type { TraceEventSlim, TraceSession } from './trace-types.js';

function session(over: Partial<TraceSession> = {}): TraceSession {
  return {
    id: 's1',
    provider: 'claude',
    sourceAgent: 'Claude',
    title: 'ship feature',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:02:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 4,
    eventCount: 6,
    tokenUsage: {
      input: 10,
      output: 5,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      netInput: 10,
      total: 15,
    },
    costUsd: 0,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: '/tmp/s1.jsonl',
    totalDurationMs: 120_000,
    isSubagent: false,
    ...over,
  };
}

function ev(
  id: string,
  sequence: number,
  kind: TraceEventSlim['kind'],
  over: Partial<TraceEventSlim> = {},
): TraceEventSlim {
  return {
    id,
    sessionId: 's1',
    sequence,
    turnKey: null,
    kind,
    phase: 'implement',
    title: `${kind} ${id}`,
    startedAt: `2026-08-01T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    durationMs: 1_000,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    model: null,
    ...over,
  };
}

describe('deriveAgentGraph', () => {
  it('single-agent session yields only the main node and no edges', () => {
    const graph = deriveAgentGraph({
      session: session(),
      events: [
        ev('u1', 1, 'user_prompt', { actor: 'user' }),
        ev('l1', 2, 'llm'),
        ev('t1', 3, 'tool', { tool: 'Read', title: 'Read src/a.ts' }),
      ],
    });
    expect(graph.singleAgent).toBe(true);
    expect(graph.spawnCount).toBe(0);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.id).toBe(MAIN_AGENT_ID);
    expect(graph.nodes[0]!.label).toBe('Claude');
    expect(graph.edges).toHaveLength(0);
    expect(graph.spans).toHaveLength(3);
  });

  it('Task tool spawn opens a child, return on next user prompt', () => {
    const graph = deriveAgentGraph({
      session: session(),
      events: [
        ev('u1', 1, 'user_prompt', { actor: 'user' }),
        ev('l1', 2, 'llm'),
        ev('sp', 3, 'tool', {
          tool: 'Task',
          title: '{"subagent_type":"Explore","prompt":"find auth"}',
        }),
        ev('r1', 4, 'file_read', { title: 'Read src/auth.ts' }),
        ev('u2', 5, 'user_prompt', { actor: 'user', title: 'continue' }),
        ev('l2', 6, 'llm'),
      ],
    });
    expect(graph.singleAgent).toBe(false);
    expect(graph.spawnCount).toBe(1);
    expect(graph.nodes.map((n) => n.id)).toEqual([MAIN_AGENT_ID, 'spawn:sp']);
    const child = graph.nodes[1]!;
    expect(child.label).toBe('Explore');
    expect(child.type).toBe('Explore');
    expect(child.eventCount).toBeGreaterThanOrEqual(2);
    const kinds = graph.edges.map((e) => e.kind);
    expect(kinds).toContain('spawn');
    expect(kinds).toContain('return');
    const spawn = graph.edges.find((e) => e.kind === 'spawn')!;
    expect(spawn.fromId).toBe(MAIN_AGENT_ID);
    expect(spawn.toId).toBe('spawn:sp');
    const ret = graph.edges.find((e) => e.kind === 'return')!;
    expect(ret.fromId).toBe('spawn:sp');
    expect(ret.toId).toBe(MAIN_AGENT_ID);
  });

  it('consecutive spawns without a user prompt emit handoff', () => {
    const graph = deriveAgentGraph({
      session: session(),
      events: [
        ev('sp1', 1, 'subagent_prompt', { title: 'subagent_type: Planner' }),
        ev('w1', 2, 'file_write', { title: 'Edit plan.md' }),
        ev('sp2', 3, 'subagent_prompt', { title: 'subagent_type: Coder' }),
        ev('w2', 4, 'file_write', { title: 'Edit src/a.ts' }),
      ],
    });
    expect(graph.spawnCount).toBe(2);
    expect(graph.edges.map((e) => e.kind)).toEqual(['spawn', 'handoff', 'return']);
    const handoff = graph.edges.find((e) => e.kind === 'handoff')!;
    expect(handoff.fromId).toBe('spawn:sp1');
    expect(handoff.toId).toBe('spawn:sp2');
  });

  it('does not treat OpenCode agent-step titles as new agents', () => {
    const graph = deriveAgentGraph({
      session: session({ provider: 'opencode', sourceAgent: 'OpenCode', isSubagent: true }),
      events: [
        ev('a1', 1, 'agent', { title: 'agent step: completed', actor: 'subagent' }),
        ev('a2', 2, 'agent', { title: 'agent step: completed', actor: 'subagent' }),
        ev('t1', 3, 'tool', { tool: 'bash', title: 'bash ls' }),
      ],
    });
    expect(graph.singleAgent).toBe(true);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.kind).toBe('subagent');
    expect(graph.nodes[0]!.eventCount).toBe(3);
  });
});
