import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MessageRole,
  TokenUsage,
  TraceKind,
  TraceStatus,
  TraceTurn,
  TurnKind,
  TurnModel,
} from './trace-types.js';
import {
  HIGH_INPUT_THRESHOLD_TOKENS,
  LOW_CACHE_THRESHOLD,
  SLOW_TURN_THRESHOLD_MS,
  analyzeTurns,
  computeCacheRate,
} from './turn-analysis.js';

const ROLE_TO_KIND: Record<MessageRole, TraceKind> = {
  system: 'system',
  user: 'user_prompt',
  assistant: 'llm',
  tool: 'tool',
  reasoning: 'reasoning',
  compact: 'compact',
  subagent: 'subagent_prompt',
};

interface MessageSpec {
  role?: MessageRole;
  tool?: string | null;
  status?: TraceStatus;
  durationMs?: number;
  tokens?: TokenUsage | null;
}

function makeTokens(options: {
  input: number;
  output: number;
  cacheRead: number;
  reasoning?: number;
  cacheWrite?: number;
  /** Override the computed total (used for tool-message fixtures). */
  total?: number;
}): TokenUsage {
  const reasoning = options.reasoning ?? 0;
  const cacheWrite = options.cacheWrite ?? 0;
  return {
    input: options.input,
    output: options.output,
    reasoning,
    cacheRead: options.cacheRead,
    cacheWrite,
    netInput: Math.max(0, options.input - options.cacheRead),
    total:
      options.total ??
      (options.input + options.output + reasoning + options.cacheRead + cacheWrite),
  };
}

/** A tool-message usage carrying only a hand-picked token total. */
function toolTokens(total: number): TokenUsage {
  return makeTokens({ input: 0, output: 0, cacheRead: 0, total });
}

function makeTurn(
  index: number,
  options: {
    kind?: TurnKind;
    durationMs?: number;
    tokens?: TokenUsage;
    messages?: MessageSpec[];
  } = {},
): TraceTurn {
  const kind = options.kind ?? (index === 0 ? 'init' : 'cycle');
  const durationMs = options.durationMs ?? 1_000;
  const tokens =
    options.tokens ?? makeTokens({ input: 100, output: 10, cacheRead: 100 });
  const messages = options.messages ?? [];
  return {
    index,
    kind,
    startedAt: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    durationMs,
    tokens,
    model: 'codex-1',
    messageCount: messages.length,
    toolCount: messages.filter((m) => m.tool !== null && m.tool !== undefined).length,
    status: messages.some((m) => m.status === 'error')
      ? 'error'
      : 'success',
    badges: [],
    messages: messages.map((spec, i) => {
      const role = spec.role ?? 'tool';
      const tool = spec.tool ?? (role === 'tool' ? 'bash' : null);
      return {
        eventId: `e${index}-${i}`,
        sequence: index * 100 + i,
        role,
        kind: ROLE_TO_KIND[role],
        title: `message ${i}`,
        tool,
        startedAt: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
        durationMs: spec.durationMs ?? 0,
        status: spec.status ?? 'success',
        tokens: spec.tokens ?? null,
        hasInput: false,
        hasOutput: false,
        hasRaw: false,
        error: spec.status === 'error' ? 'boom' : null,
      };
    }),
  };
}

function makeModel(
  turns: TraceTurn[],
  options: { complete?: boolean; omittedEventCount?: number } = {},
): TurnModel {
  return {
    turns,
    segmentationSource: 'turn_key',
    complete: options.complete ?? true,
    omittedEventCount: options.omittedEventCount ?? 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Hand-computed fixture (tasks 8.8). Every number below is computed by hand so
 * a regression in any section changes an assertion.
 *
 * Turns:
 *   0 init  duration 5_000    input 1_000  output 100  cacheRead 1_000  rate 0.5
 *   1 cycle duration 25_000   input 3_000  output 500  cacheRead 1_000  rate 0.25
 *   2 cycle duration 35_001   input 60_001 output 300  cacheRead 0      rate 0
 *   3 user  duration 1_000    input 100    output 10   cacheRead 0      rate 0
 *   4 cycle duration 2_000    input 200    output 20   cacheRead 200    rate 0.5
 *
 * Tool messages: turn1 bash (100ms, total 600) + read (400ms, total 300);
 * turn2 bash (200ms, total 400); turn4 grep (300ms, total 500, status error).
 */
function fixtureModel(): TurnModel {
  return makeModel([
    makeTurn(0, {
      kind: 'init',
      durationMs: 5_000,
      tokens: makeTokens({ input: 1_000, output: 100, cacheRead: 1_000 }),
      messages: [{ role: 'system' }, { role: 'user' }],
    }),
    makeTurn(1, {
      durationMs: 25_000,
      tokens: makeTokens({ input: 3_000, output: 500, cacheRead: 1_000 }),
      messages: [
        { role: 'assistant' },
        {
          role: 'tool',
          tool: 'bash',
          durationMs: 100,
          tokens: toolTokens(600),
        },
        {
          role: 'tool',
          tool: 'read',
          durationMs: 400,
          tokens: toolTokens(300),
        },
      ],
    }),
    makeTurn(2, {
      durationMs: 35_001,
      tokens: makeTokens({ input: 60_001, output: 300, cacheRead: 0 }),
      messages: [
        { role: 'assistant' },
        {
          role: 'tool',
          tool: 'bash',
          durationMs: 200,
          tokens: toolTokens(400),
        },
      ],
    }),
    makeTurn(3, {
      kind: 'user',
      durationMs: 1_000,
      tokens: makeTokens({ input: 100, output: 10, cacheRead: 0 }),
      messages: [{ role: 'user' }],
    }),
    makeTurn(4, {
      durationMs: 2_000,
      tokens: makeTokens({ input: 200, output: 20, cacheRead: 200 }),
      messages: [
        { role: 'assistant' },
        {
          role: 'tool',
          tool: 'grep',
          durationMs: 300,
          status: 'error',
          tokens: toolTokens(500),
        },
      ],
    }),
  ]);
}

describe('analyzeTurns — hand-computed fixture (tasks 8.1/8.8)', () => {
  const analysis = analyzeTurns(fixtureModel());

  it('computes the execution overview exactly', () => {
    expect(analysis.overview).toEqual({
      turnCount: 5,
      kindCounts: { init: 1, user: 1, cycle: 3 },
      roundCount: 2,
      totalDurationMs: 5_000 + 25_000 + 35_001 + 1_000 + 2_000,
      totalInputTokens: 1_000 + 3_000 + 60_001 + 100 + 200,
      totalOutputTokens: 100 + 500 + 300 + 10 + 20,
      totalCacheReadTokens: 1_000 + 1_000 + 0 + 0 + 200,
      // cacheRead / (input + cacheRead), null only when the denominator is 0
      cacheRate: 2_200 / (64_301 + 2_200),
    });
  });

  it('groups tool usage by tool: count desc, ties by name asc (tasks 8.2)', () => {
    expect(analysis.toolUsage).toEqual([
      { tool: 'bash', count: 2, meanDurationMs: (100 + 200) / 2, totalTokens: 1_000 },
      { tool: 'grep', count: 1, meanDurationMs: 300, totalTokens: 500 },
      { tool: 'read', count: 1, meanDurationMs: 400, totalTokens: 300 },
    ]);
  });

  it('orders top-10 duration desc, ties by turn index asc (tasks 8.3)', () => {
    expect(analysis.topDurationTurns).toEqual([
      { turnIndex: 2, value: 35_001 },
      { turnIndex: 1, value: 25_000 },
      { turnIndex: 0, value: 5_000 },
      { turnIndex: 4, value: 2_000 },
      { turnIndex: 3, value: 1_000 },
    ]);
  });

  it('orders top-10 tokens desc, ties by turn index asc (tasks 8.3)', () => {
    expect(analysis.topTokenTurns).toEqual([
      { turnIndex: 2, value: 60_301 },
      { turnIndex: 1, value: 4_500 },
      { turnIndex: 0, value: 2_100 },
      { turnIndex: 4, value: 420 },
      { turnIndex: 3, value: 110 },
    ]);
  });

  it('computes the per-turn cache-rate trend with null for a zero denominator (tasks 8.4)', () => {
    expect(analysis.cacheTrend).toEqual([
      { turnIndex: 0, rate: 0.5 },
      { turnIndex: 1, rate: 0.25 },
      { turnIndex: 2, rate: 0 },
      { turnIndex: 3, rate: 0 },
      { turnIndex: 4, rate: 0.5 },
    ]);
  });

  it('emits anomalies in turn order, then fixed rule order, with severity and detail (tasks 8.5)', () => {
    expect(analysis.anomalies).toEqual([
      {
        rule: 'low_cache',
        severity: 'attention',
        turnIndex: 1,
        detail: `cache rate 0.25 below ${LOW_CACHE_THRESHOLD}`,
      },
      {
        rule: 'slow_turn',
        severity: 'danger',
        turnIndex: 2,
        detail: `durationMs 35001 exceeds ${SLOW_TURN_THRESHOLD_MS}`,
      },
      {
        rule: 'high_input',
        severity: 'attention',
        turnIndex: 2,
        detail: `tokens.input 60001 exceeds ${HIGH_INPUT_THRESHOLD_TOKENS}`,
      },
      {
        rule: 'low_cache',
        severity: 'attention',
        turnIndex: 2,
        detail: `cache rate 0 below ${LOW_CACHE_THRESHOLD}`,
      },
      {
        rule: 'low_cache',
        severity: 'attention',
        turnIndex: 3,
        detail: `cache rate 0 below ${LOW_CACHE_THRESHOLD}`,
      },
      {
        rule: 'tool_error',
        severity: 'danger',
        turnIndex: 4,
        detail: 'tool grep errored',
      },
    ]);
  });

  it('propagates completeness and the omitted event count (tasks 8.6)', () => {
    const incomplete = analyzeTurns(
      makeModel(fixtureModel().turns, {
        complete: false,
        omittedEventCount: 1_500,
      }),
    );
    expect(incomplete.complete).toBe(false);
    expect(incomplete.omittedEventCount).toBe(1_500);
    // Sections still compute over the loaded turns; consumers render every
    // total as an em dash when complete is false.
    expect(incomplete.overview.turnCount).toBe(5);
  });
});

describe('analyzeTurns — threshold boundaries (tasks 8.5/8.8)', () => {
  it('slow_turn fires only above 30,000 ms, never at it', () => {
    const at = analyzeTurns(
      makeModel([
        makeTurn(1, {
          durationMs: SLOW_TURN_THRESHOLD_MS,
          tokens: makeTokens({ input: 100, output: 10, cacheRead: 100 }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(at.anomalies.filter((a) => a.rule === 'slow_turn')).toHaveLength(0);

    const past = analyzeTurns(
      makeModel([
        makeTurn(1, {
          durationMs: SLOW_TURN_THRESHOLD_MS + 1,
          tokens: makeTokens({ input: 100, output: 10, cacheRead: 100 }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(past.anomalies).toEqual([
      {
        rule: 'slow_turn',
        severity: 'danger',
        turnIndex: 1,
        detail: `durationMs ${SLOW_TURN_THRESHOLD_MS + 1} exceeds ${SLOW_TURN_THRESHOLD_MS}`,
      },
    ]);
  });

  it('high_input fires only above 50,000 input tokens, never at it', () => {
    const at = analyzeTurns(
      makeModel([
        makeTurn(1, {
          tokens: makeTokens({
            input: HIGH_INPUT_THRESHOLD_TOKENS,
            output: 10,
            // rate = 0.5 so no low-cache anomaly contaminates the list
            cacheRead: HIGH_INPUT_THRESHOLD_TOKENS,
          }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(at.anomalies.filter((a) => a.rule === 'high_input')).toHaveLength(0);

    const past = analyzeTurns(
      makeModel([
        makeTurn(1, {
          tokens: makeTokens({
            input: HIGH_INPUT_THRESHOLD_TOKENS + 1,
            output: 10,
            // rate = 0.5 so no low-cache anomaly contaminates the list
            cacheRead: HIGH_INPUT_THRESHOLD_TOKENS + 1,
          }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(past.anomalies).toEqual([
      {
        rule: 'high_input',
        severity: 'attention',
        turnIndex: 1,
        detail: `tokens.input ${HIGH_INPUT_THRESHOLD_TOKENS + 1} exceeds ${HIGH_INPUT_THRESHOLD_TOKENS}`,
      },
    ]);
  });

  it('low_cache fires only below 0.5, never at it, and never for a null rate', () => {
    const at = analyzeTurns(
      makeModel([
        makeTurn(1, {
          tokens: makeTokens({ input: 100, output: 10, cacheRead: 100 }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(at.anomalies.filter((a) => a.rule === 'low_cache')).toHaveLength(0);

    const below = analyzeTurns(
      makeModel([
        makeTurn(1, {
          tokens: makeTokens({ input: 60, output: 10, cacheRead: 40 }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(below.anomalies).toEqual([
      {
        rule: 'low_cache',
        severity: 'attention',
        turnIndex: 1,
        detail: `cache rate 0.4 below ${LOW_CACHE_THRESHOLD}`,
      },
    ]);

    // A turn with no token figures has a null cache rate: no low-cache anomaly.
    const nullRate = analyzeTurns(
      makeModel([
        makeTurn(1, {
          tokens: makeTokens({ input: 0, output: 0, cacheRead: 0 }),
          messages: [{ role: 'assistant' }],
        }),
      ]),
    );
    expect(nullRate.anomalies.filter((a) => a.rule === 'low_cache')).toHaveLength(0);
    expect(nullRate.cacheTrend).toEqual([{ turnIndex: 1, rate: null }]);
  });

  it('tool_error fires only when a tool member errored, never for a non-tool member', () => {
    const clean = analyzeTurns(
      makeModel([
        makeTurn(1, {
          messages: [{ role: 'tool', tool: 'bash', status: 'success' }],
        }),
      ]),
    );
    expect(clean.anomalies.filter((a) => a.rule === 'tool_error')).toHaveLength(0);

    const erroredTool = analyzeTurns(
      makeModel([
        makeTurn(1, {
          messages: [{ role: 'tool', tool: 'bash', status: 'error' }],
        }),
      ]),
    );
    expect(erroredTool.anomalies).toEqual([
      {
        rule: 'tool_error',
        severity: 'danger',
        turnIndex: 1,
        detail: 'tool bash errored',
      },
    ]);

    // An errored non-tool member (e.g. an llm message) is not a tool error.
    const erroredLlm = analyzeTurns(
      makeModel([
        makeTurn(1, {
          messages: [{ role: 'assistant', status: 'error' }],
        }),
      ]),
    );
    expect(erroredLlm.anomalies.filter((a) => a.rule === 'tool_error')).toHaveLength(0);
  });
});

describe('analyzeTurns — ordering determinism (tasks 8.2/8.3)', () => {
  it('breaks tool-usage ties by tool name ascending', () => {
    const model = makeModel([
      makeTurn(1, {
        messages: [
          { role: 'tool', tool: 'read', durationMs: 10 },
          { role: 'tool', tool: 'bash', durationMs: 20 },
          { role: 'tool', tool: 'grep', durationMs: 30 },
        ],
      }),
    ]);
    const rows = analyzeTurns(model).toolUsage;
    expect(rows.map((r) => r.tool)).toEqual(['bash', 'grep', 'read']);
  });

  it('caps both top lists at ten and breaks value ties by turn index ascending', () => {
    const turns: TraceTurn[] = [];
    for (let i = 1; i <= 12; i += 1) {
      turns.push(
        makeTurn(i, {
          // i=1..10 get unique values 100..1000; 11 and 12 tie with 9 and 10.
          durationMs: 1_000 + i * 100,
          tokens: makeTokens({ input: 10 * i, output: 1, cacheRead: 10 * i }),
          messages: [{ role: 'assistant' }],
        }),
      );
    }
    const analysis = analyzeTurns(makeModel(turns));
    expect(analysis.topDurationTurns).toHaveLength(10);
    expect(analysis.topTokenTurns).toHaveLength(10);

    // Hand-computed top-10 duration: indices 12..3 (values 2200..1300).
    expect(analysis.topDurationTurns.map((r) => r.turnIndex)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    // Hand-computed top-10 tokens: indices 12..3 (values 242..33).
    expect(analysis.topTokenTurns.map((r) => r.turnIndex)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
  });

  it('breaks duration ties by turn index ascending', () => {
    const model = makeModel([
      makeTurn(2, { durationMs: 500 }),
      makeTurn(4, { durationMs: 500 }),
      makeTurn(1, { durationMs: 500 }),
    ]);
    const rows = analyzeTurns(model).topDurationTurns;
    expect(rows.map((r) => r.turnIndex)).toEqual([1, 2, 4]);
  });

  it('is deterministic across runs', () => {
    const model = fixtureModel();
    expect(analyzeTurns(model)).toEqual(analyzeTurns(model));
  });
});

describe('analyzeTurns — empty, null, and request-free guarantees', () => {
  it('reports every section empty for a zero-turn session without failing (tasks 8.8)', () => {
    const analysis = analyzeTurns(makeModel([]));
    expect(analysis.overview).toEqual({
      turnCount: 0,
      kindCounts: { init: 0, user: 0, cycle: 0 },
      roundCount: 0,
      totalDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      // zero denominator → null, never 0 (deviation C14)
      cacheRate: null,
    });
    expect(analysis.toolUsage).toEqual([]);
    expect(analysis.topDurationTurns).toEqual([]);
    expect(analysis.topTokenTurns).toEqual([]);
    expect(analysis.cacheTrend).toEqual([]);
    expect(analysis.anomalies).toEqual([]);
  });

  it('computeCacheRate is null when the denominator is 0 and real otherwise', () => {
    expect(computeCacheRate(0, 0)).toBeNull();
    expect(computeCacheRate(100, 0)).toBe(0);
    expect(computeCacheRate(0, 50)).toBe(1);
    expect(computeCacheRate(300, 100)).toBe(0.25);
  });

  it('issues zero network requests (C11: analysis is client-side arithmetic)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    analyzeTurns(fixtureModel());
    analyzeTurns(makeModel([]));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
