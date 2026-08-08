import { describe, expect, it } from 'vitest';

import type {
  TokenUsage,
  TraceEventSlim,
  TraceSession,
  TurnModel,
  TurnKeySource,
} from './trace-types.js';
import { EMPTY_TOKEN_USAGE } from './trace-types.js';
import { countRounds, deriveTurns } from './turn-model.js';

/** Kinds that carry a tool name in real adapter output (D4 tool family). */
const TOOL_FAMILY_KINDS = new Set([
  'tool',
  'file_read',
  'file_write',
  'bash',
  'test',
]);

function makeEvent(
  sequence: number,
  overrides: Partial<TraceEventSlim> = {},
): TraceEventSlim {
  const kind = overrides.kind ?? 'tool';
  return {
    id: `evt-${sequence}`,
    sessionId: 'sess-1',
    sequence,
    turnKey: null,
    kind,
    phase: 'implement',
    title: `event ${sequence}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 0,
    status: 'success',
    actor: 'assistant',
    tool: TOOL_FAMILY_KINDS.has(kind) ? 'bash' : null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: true,
    ...overrides,
  };
}

function makeSession(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    id: 'sess-1',
    provider: 'codex',
    sourceAgent: 'codex',
    title: 'test session',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 10,
    eventCount: 10,
    tokenUsage: EMPTY_TOKEN_USAGE,
    costUsd: 0,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: '~/test.jsonl',
    totalDurationMs: 60_000,
    isSubagent: false,
    ...overrides,
  };
}

function derive(
  events: TraceEventSlim[],
  options: {
    session?: TraceSession;
    hasMore?: boolean;
    eventTotal?: number;
    turnKeySource?: TurnKeySource;
  } = {},
): TurnModel {
  return deriveTurns(
    events,
    {
      session: options.session ?? makeSession(),
      hasMore: options.hasMore ?? false,
      eventTotal: options.eventTotal ?? events.length,
    },
    options.turnKeySource ?? 'unavailable',
  );
}

function usage(partial: Partial<TokenUsage>): TokenUsage {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    netInput: 0,
    total: 0,
    ...partial,
  };
}

describe('deriveTurns — D3 strategy selection', () => {
  it('chooses turn_key when any event carries a non-null turn key', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'llm', turnKey: 'k1' }),
    ];
    expect(derive(events).segmentationSource).toBe('turn_key');
  });

  it('chooses llm_boundary when all keys are null and an llm event exists', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'llm', turnKey: null }),
      makeEvent(3, { kind: 'tool', turnKey: null }),
    ];
    expect(derive(events).segmentationSource).toBe('llm_boundary');
  });

  it('chooses user_prompt_boundary when only user prompts exist', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt', turnKey: null }),
      makeEvent(3, { kind: 'tool', turnKey: null }),
    ];
    expect(derive(events).segmentationSource).toBe('user_prompt_boundary');
  });

  it('chooses sequence_fallback when no key, no llm and no user prompt exists', () => {
    const events = [
      makeEvent(1, { kind: 'tool', turnKey: null }),
      makeEvent(2, { kind: 'bash', turnKey: null }),
    ];
    expect(derive(events).segmentationSource).toBe('sequence_fallback');
  });

  it('does not let the declared provenance change the segmentation (edge case: message_identity)', () => {
    const events = [
      makeEvent(1, { kind: 'llm', turnKey: 'msg-1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'msg-1' }),
    ];
    expect(
      derive(events, { turnKeySource: 'message_identity' }).segmentationSource,
    ).toBe('turn_key');
  });
});

describe('deriveTurns — turn_key grouping', () => {
  it('opens a cycle turn on a changed key and attaches null-keyed events to the open turn', () => {
    const events = [
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: null }),
      makeEvent(3, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(4, { kind: 'llm', turnKey: 'k2' }),
      makeEvent(5, { kind: 'tool', turnKey: null }),
    ];
    const model = derive(events);
    expect(model.segmentationSource).toBe('turn_key');
    expect(model.turns).toHaveLength(2);
    expect(model.turns[0]!.messages.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(model.turns[1]!.messages.map((m) => m.sequence)).toEqual([4, 5]);
    // The null-keyed events never opened their own turns.
    expect(model.turns[0]!.messages.filter((m) => m.sequence === 2)).toHaveLength(1);
  });

  it('keeps all events of one key in one turn across interleaved nulls', () => {
    const events = [
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'reasoning', turnKey: null }),
      makeEvent(3, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(4, { kind: 'reasoning', turnKey: 'k1' }),
    ];
    const model = derive(events);
    expect(model.turns).toHaveLength(1);
    expect(model.turns[0]!.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
  });
});

describe('deriveTurns — turn 0', () => {
  it('consumes the leading system/user_prompt run as an init turn with index 0', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(4, { kind: 'tool', turnKey: 'k1' }),
    ];
    const model = derive(events);
    expect(model.turns).toHaveLength(2);
    expect(model.turns[0]).toMatchObject({
      index: 0,
      kind: 'init',
      messageCount: 2,
    });
    expect(model.turns[1]!.index).toBe(1);
    expect(model.turns[0]!.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
    ]);
  });

  it('emits no turn 0 when the leading run is empty and keeps index 1 (never shifted)', () => {
    const events = [
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
    ];
    const model = derive(events);
    expect(model.turns).toHaveLength(1);
    expect(model.turns[0]!.index).toBe(1);
    expect(model.turns.some((t) => t.index === 0)).toBe(false);
  });

  it('a session with only system and user_prompt events produces turn 0 only', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'user_prompt' }),
    ];
    const model = derive(events);
    expect(model.turns).toHaveLength(1);
    expect(model.turns[0]).toMatchObject({ index: 0, kind: 'init' });
    expect(model.turns[0]!.messages).toHaveLength(3);
  });
});

describe('deriveTurns — the user-input rule', () => {
  it('turn_key: a mid-session user prompt opens its own user turn even though the key did not change', () => {
    // Claude pattern: the user prompt carries the key of the cycle that
    // follows it, so the key does NOT change at the prompt.
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(4, { kind: 'user_prompt', turnKey: 'k1' }),
      makeEvent(5, { kind: 'llm', turnKey: 'k1' }),
    ];
    const model = derive(events);
    expect(model.turns.map((t) => t.kind)).toEqual([
      'init',
      'cycle',
      'user',
      'cycle',
    ]);
    expect(model.turns[2]!.messages.map((m) => m.sequence)).toEqual([4]);
  });

  it('llm_boundary: a mid-session user prompt opens its own user turn', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'llm' }),
      makeEvent(4, { kind: 'user_prompt' }),
      makeEvent(5, { kind: 'llm' }),
    ];
    const model = derive(events);
    expect(model.turns.map((t) => t.kind)).toEqual([
      'init',
      'cycle',
      'user',
      'cycle',
    ]);
  });

  it('user_prompt_boundary: a mid-session user prompt opens its own user turn and the following run attaches to it', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'tool' }),
      makeEvent(4, { kind: 'user_prompt' }),
      makeEvent(5, { kind: 'tool' }),
    ];
    const model = derive(events);
    expect(model.turns.map((t) => t.kind)).toEqual(['init', 'cycle', 'user']);
    expect(model.turns[2]!.messages.map((m) => m.sequence)).toEqual([4, 5]);
    // The following run joined neither the init turn nor a fabricated boundary.
    expect(model.turns[1]!.messages.map((m) => m.sequence)).toEqual([3]);
  });

  it('sequence_fallback: one honest turn for everything, never chunked', () => {
    // sequence_fallback sessions cannot contain a user prompt by construction
    // (its presence would select user_prompt_boundary), so the user rule is
    // vacuous there; this asserts the no-chunking behaviour instead.
    const events = [
      makeEvent(1, { kind: 'tool' }),
      makeEvent(2, { kind: 'bash' }),
      makeEvent(3, { kind: 'tool' }),
      makeEvent(4, { kind: 'bash' }),
    ];
    const model = derive(events);
    expect(model.segmentationSource).toBe('sequence_fallback');
    expect(model.turns).toHaveLength(1);
    expect(model.turns[0]!.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
    expect(model.turns[0]!.index).toBe(1);
  });

  it('a user prompt sandwiched between two cycles joins neither — three turns result', () => {
    const events = [
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(4, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(5, { kind: 'user_prompt', turnKey: 'k2' }),
      makeEvent(6, { kind: 'llm', turnKey: 'k2' }),
      makeEvent(7, { kind: 'tool', turnKey: 'k2' }),
    ];
    const model = derive(events);
    expect(model.turns.map((t) => t.kind)).toEqual([
      'init',
      'cycle',
      'user',
      'cycle',
    ]);
    expect(model.turns[1]!.messages.map((m) => m.sequence)).toEqual([3, 4]);
    expect(model.turns[2]!.messages.map((m) => m.sequence)).toEqual([5]);
    expect(model.turns[3]!.messages.map((m) => m.sequence)).toEqual([6, 7]);
  });
});

describe('deriveTurns — aggregation', () => {
  it('durationMs is wall-clock (last member end minus first member start), not the sum', () => {
    const events = [
      makeEvent(1, {
        kind: 'llm',
        turnKey: 'k1',
        startedAt: '2026-08-01T00:00:00.000Z',
        durationMs: 500,
      }),
      makeEvent(2, {
        kind: 'tool',
        turnKey: 'k1',
        startedAt: '2026-08-01T00:00:02.000Z',
        durationMs: 500,
      }),
      makeEvent(3, {
        kind: 'tool',
        turnKey: 'k1',
        startedAt: '2026-08-01T00:00:03.000Z',
        durationMs: 1_000,
      }),
    ];
    const model = derive(events);
    // Sum of member durations would be 2,000 ms; wall-clock is
    // (03.000 + 1000) − 00.000 = 4,000 ms.
    expect(model.turns[0]!.durationMs).toBe(4_000);
  });

  it('durationMs is floored at 0', () => {
    const events = [
      makeEvent(1, {
        kind: 'llm',
        turnKey: 'k1',
        startedAt: '2026-08-01T00:00:05.000Z',
        durationMs: 0,
      }),
      makeEvent(2, {
        kind: 'tool',
        turnKey: 'k1',
        startedAt: '2026-08-01T00:00:03.000Z',
        durationMs: 0,
      }),
    ];
    expect(derive(events).turns[0]!.durationMs).toBe(0);
  });

  it('a single-member turn takes the member duration', () => {
    const events = [
      makeEvent(1, { kind: 'llm', turnKey: 'k1', durationMs: 250 }),
    ];
    expect(derive(events).turns[0]!.durationMs).toBe(250);
  });

  it('tokens reuse aggregateTokenUsage over non-null usages (hand-computed fixture)', () => {
    const events = [
      makeEvent(1, {
        kind: 'llm',
        turnKey: 'k1',
        tokens: usage({
          input: 100,
          output: 50,
          reasoning: 10,
          cacheRead: 20,
          cacheWrite: 5,
          netInput: 80,
          total: 185,
        }),
      }),
      makeEvent(2, {
        kind: 'tool',
        turnKey: 'k1',
        tokens: usage({
          input: 60,
          output: 30,
          reasoning: 0,
          cacheRead: 40,
          cacheWrite: 0,
          netInput: 20,
          total: 130,
        }),
      }),
      makeEvent(3, { kind: 'bash', turnKey: 'k1', tokens: null }),
    ];
    const model = derive(events);
    // aggregateTokenUsage with incremental cacheRead semantics:
    // input 160, output 80, reasoning 10, cacheRead 60, cacheWrite 5,
    // netInput = max(0, 160-60) = 100, total = 160+80+10+60+5 = 315.
    expect(model.turns[0]!.tokens).toEqual({
      input: 160,
      output: 80,
      reasoning: 10,
      cacheRead: 60,
      cacheWrite: 5,
      netInput: 100,
      total: 315,
    });
  });

  it('status precedence is error → running → success', () => {
    const errorWins = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1', status: 'error' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1', status: 'running' }),
    ]);
    expect(errorWins.turns[0]!.status).toBe('error');

    const runningWins = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1', status: 'running' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1', status: 'success' }),
    ]);
    expect(runningWins.turns[0]!.status).toBe('running');

    const success = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1', status: 'success' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1', status: 'cancelled' }),
    ]);
    expect(success.turns[0]!.status).toBe('success');
  });

  it('model resolves to the first member model, then session.primaryModel, then null', () => {
    const fromMember = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1', model: 'gpt-4' }),
      makeEvent(2, { kind: 'llm', turnKey: 'k1', model: 'gpt-5' }),
    ]);
    expect(fromMember.turns[0]!.model).toBe('gpt-4');

    const fromSession = derive([makeEvent(1, { kind: 'llm', turnKey: 'k1' })], {
      session: makeSession({ primaryModel: 'claude-3' }),
    });
    expect(fromSession.turns[0]!.model).toBe('claude-3');

    const none = derive([makeEvent(1, { kind: 'llm', turnKey: 'k1' })], {
      session: makeSession({ primaryModel: undefined }),
    });
    expect(none.turns[0]!.model).toBeNull();
  });

  it('counts members and tool members', () => {
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1', tool: 'read' }),
      makeEvent(3, { kind: 'bash', turnKey: 'k1', tool: 'bash' }),
      makeEvent(4, { kind: 'reasoning', turnKey: 'k1' }),
    ]);
    expect(model.turns[0]!.messageCount).toBe(4);
    expect(model.turns[0]!.toolCount).toBe(2);
  });
});

describe('deriveTurns — D8 badges', () => {
  it('init marks the initialisation turn', () => {
    const model = derive([makeEvent(1, { kind: 'system' })]);
    expect(model.turns[0]!.badges).toEqual(['init']);
  });

  it('user marks a user turn', () => {
    const model = derive([
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(3, { kind: 'user_prompt' }),
    ]);
    expect(model.turns[2]!.badges).toEqual(['user']);
  });

  it('tools marks a turn with tool calls', () => {
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1', tool: 'read' }),
    ]);
    expect(model.turns[0]!.badges).toEqual(['tools']);
  });

  it('stop marks a decision cycle with no tool call', () => {
    const model = derive([makeEvent(1, { kind: 'llm', turnKey: 'k1' })]);
    expect(model.turns[0]!.badges).toEqual(['stop']);
  });

  it('error and running reflect the turn status', () => {
    const errored = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1', status: 'error' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
    ]);
    expect(errored.turns[0]!.status).toBe('error');
    expect(errored.turns[0]!.badges).toEqual(['tools', 'error']);

    const running = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1', status: 'running' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
    ]);
    expect(running.turns[0]!.status).toBe('running');
    expect(running.turns[0]!.badges).toEqual(['tools', 'running']);
  });

  it('subagent marks a turn containing agent or subagent_prompt events', () => {
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(3, { kind: 'subagent_prompt', turnKey: 'k1' }),
    ]);
    expect(model.turns[0]!.badges).toEqual(['tools', 'subagent']);
  });

  it('compact marks a turn containing a compaction event', () => {
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(3, { kind: 'compact', turnKey: 'k1' }),
    ]);
    expect(model.turns[0]!.badges).toEqual(['tools', 'compact']);
  });

  it('a user turn carrying tools gets user + tools, never stop', () => {
    const model = derive([
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'tool' }),
      makeEvent(4, { kind: 'user_prompt' }),
      makeEvent(5, { kind: 'tool' }),
    ]);
    expect(model.turns.map((t) => t.kind)).toEqual(['init', 'cycle', 'user']);
    expect(model.turns[2]!.kind).toBe('user');
    expect(model.turns[2]!.messages.map((m) => m.sequence)).toEqual([4, 5]);
    expect(model.turns[2]!.badges).toEqual(['user', 'tools']);
  });
});

describe('deriveTurns — D4 message mapping', () => {
  it('maps every kind to its role, including the tool-family set', () => {
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'reasoning', turnKey: 'k1' }),
      makeEvent(3, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(4, { kind: 'file_read', turnKey: 'k1' }),
      makeEvent(5, { kind: 'file_write', turnKey: 'k1' }),
      makeEvent(6, { kind: 'bash', turnKey: 'k1' }),
      makeEvent(7, { kind: 'test', turnKey: 'k1' }),
      makeEvent(8, { kind: 'compact', turnKey: 'k1' }),
      makeEvent(9, { kind: 'agent', turnKey: 'k1' }),
      makeEvent(10, { kind: 'subagent_prompt', turnKey: 'k1' }),
      makeEvent(11, { kind: 'message', turnKey: 'k1' }),
    ]);
    expect(model.turns[0]!.messages.map((m) => m.role)).toEqual([
      'assistant',
      'reasoning',
      'tool',
      'tool',
      'tool',
      'tool',
      'tool',
      'compact',
      'subagent',
      'subagent',
      'assistant',
    ]);
  });

  it('exposes event.id verbatim as the call identity and never a toolCallId', () => {
    const model = derive([
      makeEvent(1, {
        kind: 'llm',
        turnKey: 'k1',
        id: 'msg_01ABC',
      }),
      makeEvent(2, {
        kind: 'tool',
        turnKey: 'k1',
        id: 'toolu_0117nwDWENk6VtST1KBHjGxX',
      }),
    ]);
    const toolMessage = model.turns[0]!.messages[1]!;
    expect(toolMessage.eventId).toBe('toolu_0117nwDWENk6VtST1KBHjGxX');
    expect(toolMessage).not.toHaveProperty('toolCallId');
    expect(toolMessage).toHaveProperty('sequence', 2);
    expect(toolMessage).toHaveProperty('hasInput');
    expect(toolMessage).toHaveProperty('hasOutput');
    expect(toolMessage).toHaveProperty('hasRaw');
  });

  it('keeps message order identical to sequence order', () => {
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
      makeEvent(3, { kind: 'tool', turnKey: 'k1' }),
    ]);
    expect(model.turns[0]!.messages.map((m) => m.sequence)).toEqual([1, 2, 3]);
  });
});

describe('deriveTurns — kinds, flat list and round count', () => {
  it('counts all three kinds in one flat list (init + 3 user + 411 cycle = 415)', () => {
    const events: TraceEventSlim[] = [
      makeEvent(1, { kind: 'system', turnKey: null }),
      makeEvent(2, { kind: 'user_prompt', turnKey: null }),
    ];
    let sequence = 3;
    const userPromptAt = new Set([100, 200, 300]);
    for (let cycle = 0; cycle < 411; cycle += 1) {
      if (userPromptAt.has(cycle)) {
        events.push(
          makeEvent(sequence++, { kind: 'user_prompt', turnKey: `k${cycle}` }),
        );
      }
      events.push(
        makeEvent(sequence++, { kind: 'llm', turnKey: `k${cycle}` }),
        makeEvent(sequence++, { kind: 'tool', turnKey: `k${cycle}` }),
      );
    }
    const model = derive(events);
    expect(model.turns).toHaveLength(415);
    const byKind = {
      init: model.turns.filter((t) => t.kind === 'init').length,
      user: model.turns.filter((t) => t.kind === 'user').length,
      cycle: model.turns.filter((t) => t.kind === 'cycle').length,
    };
    expect(byKind).toEqual({ init: 1, user: 3, cycle: 411 });
    // One flat ordered sequence — no second grouping layer above the turns.
    expect(model.turns.map((t) => t.index)).toEqual(
      model.turns.map((_, i) => i),
    );
  });

  it('round count is init plus user turns, separate from the total', () => {
    const model = derive([
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(4, { kind: 'user_prompt' }),
      makeEvent(5, { kind: 'llm', turnKey: 'k2' }),
    ]);
    expect(model.turns).toHaveLength(4);
    expect(countRounds(model.turns)).toBe(2);
  });

  it('round count is 0 for cycle-only models and for empty models', () => {
    expect(countRounds([])).toBe(0);
    const model = derive([
      makeEvent(1, { kind: 'llm', turnKey: 'k1' }),
      makeEvent(2, { kind: 'tool', turnKey: 'k1' }),
    ]);
    expect(countRounds(model.turns)).toBe(0);
  });
});

describe('deriveTurns — completeness', () => {
  it('marks the model incomplete with the omitted count when hasMore is true', () => {
    const events = Array.from({ length: 200 }, (_, i) =>
      makeEvent(i + 1, { kind: 'tool' }),
    );
    const model = derive(events, { hasMore: true, eventTotal: 500 });
    expect(model.complete).toBe(false);
    expect(model.omittedEventCount).toBe(300);
  });

  it('marks the model complete with zero omitted when hasMore is false', () => {
    const model = derive([makeEvent(1, { kind: 'tool' })], {
      hasMore: false,
      eventTotal: 1,
    });
    expect(model.complete).toBe(true);
    expect(model.omittedEventCount).toBe(0);
  });
});

describe('deriveTurns — edge cases', () => {
  it('an empty session yields an empty model without crashing', () => {
    const model = derive([]);
    expect(model.turns).toEqual([]);
    expect(model.segmentationSource).toBe('sequence_fallback');
    expect(model.complete).toBe(true);
    expect(model.omittedEventCount).toBe(0);
  });

  it('user_prompt_boundary fires for an unavailable adapter with user prompts and no llm events', () => {
    const model = derive([
      makeEvent(1, { kind: 'system' }),
      makeEvent(2, { kind: 'user_prompt' }),
      makeEvent(3, { kind: 'tool' }),
    ]);
    expect(model.segmentationSource).toBe('user_prompt_boundary');
  });
});

describe('deriveTurns — D20 benchmark (tasks 4.11)', () => {
  it('derives 1,000 synthetic events in under 20 ms', () => {
    // 50 decision cycles × 20 events, turn_key strategy, no turn 0.
    const events: TraceEventSlim[] = [];
    for (let i = 0; i < 1_000; i += 1) {
      const cycle = Math.floor(i / 20);
      events.push(
        makeEvent(i + 1, {
          turnKey: `bench-${cycle}`,
          kind: i % 20 === 0 ? 'llm' : 'tool',
          model: 'codex-1',
        }),
      );
    }

    // warm-up
    derive(events);

    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      derive(events);
      samples.push(performance.now() - start);
    }
    const worst = Math.max(...samples);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log(
      `[turn-model] 1,000 events: worst ${worst.toFixed(3)}ms, avg ${avg.toFixed(3)}ms`,
    );
    expect(worst).toBeLessThan(20);
  });
});
