import { describe, expect, it } from 'vitest';

import type { MessageRole, TraceKind, TraceTurn } from './trace-types.js';
import {
  RIBBON_MAX_SEGMENTS,
  RIBBON_MIN_SEGMENT_PX,
  computeRibbon,
} from './turn-ribbon.js';

const ROLE_TO_KIND: Record<MessageRole, TraceKind> = {
  system: 'system',
  user: 'user_prompt',
  assistant: 'llm',
  tool: 'tool',
  reasoning: 'reasoning',
  compact: 'compact',
  subagent: 'subagent_prompt',
};

function makeTurn(
  index: number,
  options: {
    durationMs?: number;
    tokens?: number;
    roles?: readonly MessageRole[];
  } = {},
): TraceTurn {
  const durationMs = options.durationMs ?? 1_000;
  const total = options.tokens ?? 100;
  const roles = options.roles ?? (['assistant'] as const);
  const startedAt = `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`;
  return {
    index,
    kind: index === 0 ? 'init' : 'cycle',
    startedAt,
    durationMs,
    tokens: {
      input: total,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      netInput: total,
      total,
    },
    model: 'codex-1',
    messageCount: roles.length,
    toolCount: roles.filter((role) => role === 'tool').length,
    status: 'success',
    badges: [],
    messages: roles.map((role, i) => ({
      eventId: `e${index}-${i}`,
      sequence: index * 10 + i,
      role,
      kind: ROLE_TO_KIND[role],
      title: `message ${i}`,
      tool: role === 'tool' ? 'bash' : null,
      startedAt,
      durationMs: 0,
      status: 'success',
      tokens: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      error: null,
    })),
  };
}

function makeTurns(count: number): TraceTurn[] {
  return Array.from({ length: count }, (_, i) => makeTurn(i));
}

function turnIndicesOf(ribbon: ReturnType<typeof computeRibbon>): number[] {
  return ribbon.segments.flatMap((segment) => [...segment.turnIndices]);
}

describe('computeRibbon — proportionality (tasks 5.2)', () => {
  it('sizes segments by duration share in time mode', () => {
    const turns = [
      makeTurn(0, { durationMs: 100 }),
      makeTurn(1, { durationMs: 300 }),
      makeTurn(2, { durationMs: 600 }),
    ];
    const ribbon = computeRibbon(turns, 'time', 1_000);
    expect(ribbon.segments.map((s) => s.widthPx)).toEqual([100, 300, 600]);
    expect(ribbon.segments.map((s) => s.weight)).toEqual([100, 300, 600]);
    expect(ribbon.totalWidthPx).toBeCloseTo(1_000, 6);
    expect(ribbon.mode).toBe('time');
  });

  it('sizes segments by token total share in token mode', () => {
    const turns = [
      makeTurn(0, { tokens: 50 }),
      makeTurn(1, { tokens: 150 }),
    ];
    const ribbon = computeRibbon(turns, 'token', 800);
    expect(ribbon.segments.map((s) => s.widthPx)).toEqual([200, 600]);
    expect(ribbon.segments.map((s) => s.weight)).toEqual([50, 150]);
    expect(ribbon.mode).toBe('token');
  });

  it('a single turn fills the whole container', () => {
    const ribbon = computeRibbon([makeTurn(7)], 'time', 500);
    expect(ribbon.segments).toHaveLength(1);
    expect(ribbon.segments[0]!.turnIndices).toEqual([7]);
    expect(ribbon.segments[0]!.widthPx).toBe(500);
  });
});

describe('computeRibbon — minimum-width floor (tasks 5.2)', () => {
  it('keeps a zero-weight turn visible as a 2px line', () => {
    const turns = [
      makeTurn(0, { durationMs: 1_000 }),
      makeTurn(1, { durationMs: 0 }),
    ];
    const ribbon = computeRibbon(turns, 'time', 1_000);
    expect(ribbon.segments[1]!.weight).toBe(0);
    expect(ribbon.segments[1]!.widthPx).toBe(RIBBON_MIN_SEGMENT_PX);
    expect(ribbon.segments[0]!.widthPx).toBeCloseTo(1_000, 6);
    // the floor means the sum may exceed the container; the flex container
    // resolves the overflow
    expect(ribbon.totalWidthPx).toBe(RIBBON_MIN_SEGMENT_PX + 1_000);
  });

  it('floors a sub-floor proportional width up to 2px', () => {
    const turns = [
      makeTurn(0, { durationMs: 1 }),
      makeTurn(1, { durationMs: 999 }),
    ];
    const ribbon = computeRibbon(turns, 'time', 1_000);
    expect(ribbon.segments[0]!.widthPx).toBe(RIBBON_MIN_SEGMENT_PX);
    expect(ribbon.segments[1]!.widthPx).toBeCloseTo(999, 6);
  });
});

describe('computeRibbon — zero total (tasks 5.3)', () => {
  it('gives every segment an equal width and never divides by zero', () => {
    const turns = [0, 1, 2, 3].map((i) => makeTurn(i, { durationMs: 0 }));
    const ribbon = computeRibbon(turns, 'time', 400);
    for (const segment of ribbon.segments) {
      expect(segment.widthPx).toBe(100);
      expect(Number.isFinite(segment.widthPx)).toBe(true);
    }
    expect(ribbon.totalWidthPx).toBe(400);
  });

  it('keeps the equal-width guarantee when the floor bites', () => {
    const turns = makeTurns(RIBBON_MAX_SEGMENTS).map((turn) =>
      makeTurn(turn.index, { durationMs: 0 }),
    );
    const ribbon = computeRibbon(turns, 'time', 300);
    const widths = ribbon.segments.map((s) => s.widthPx);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]!).toBe(RIBBON_MIN_SEGMENT_PX);
  });
});

describe('computeRibbon — bucketing above the cap (tasks 5.4)', () => {
  it('exactly 200 turns stay one segment per turn', () => {
    const ribbon = computeRibbon(makeTurns(RIBBON_MAX_SEGMENTS), 'time', 800);
    expect(ribbon.segments).toHaveLength(RIBBON_MAX_SEGMENTS);
    expect(ribbon.segments.every((s) => s.turnIndices.length === 1)).toBe(true);
    expect(turnIndicesOf(ribbon)).toEqual(
      Array.from({ length: RIBBON_MAX_SEGMENTS }, (_, i) => i),
    );
  });

  it('201 turns bucket to 200 segments, dropping no turn', () => {
    const ribbon = computeRibbon(
      makeTurns(RIBBON_MAX_SEGMENTS + 1),
      'time',
      800,
    );
    expect(ribbon.segments).toHaveLength(RIBBON_MAX_SEGMENTS);
    const sizes = ribbon.segments.map((s) => s.turnIndices.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(RIBBON_MAX_SEGMENTS + 1);
    expect(Math.min(...sizes)).toBe(1);
    expect(Math.max(...sizes)).toBe(2);
    expect(sizes.filter((size) => size === 2)).toHaveLength(1);
    expect(turnIndicesOf(ribbon)).toEqual(
      Array.from({ length: RIBBON_MAX_SEGMENTS + 1 }, (_, i) => i),
    );
  });

  it('500 turns bucket into 200 equal turn-count buckets', () => {
    const ribbon = computeRibbon(makeTurns(500), 'time', 800);
    expect(ribbon.segments).toHaveLength(RIBBON_MAX_SEGMENTS);
    const sizes = ribbon.segments.map((s) => s.turnIndices.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(500);
    expect(Math.min(...sizes)).toBe(2);
    expect(Math.max(...sizes)).toBe(3);
    expect(sizes.filter((size) => size === 3)).toHaveLength(100);
    expect(sizes.filter((size) => size === 2)).toHaveLength(100);
    expect(turnIndicesOf(ribbon)).toEqual(
      Array.from({ length: 500 }, (_, i) => i),
    );
  });
});

describe('computeRibbon — dominant role (tasks 5.5)', () => {
  it('breaks a six-role tie in the order system > user > assistant > tool > reasoning > compact', () => {
    const allSix = makeTurn(0, {
      roles: ['system', 'user', 'assistant', 'tool', 'reasoning', 'compact'],
    });
    const ribbon = computeRibbon([allSix], 'time', 100);
    expect(ribbon.segments[0]!.dominantRole).toBe('system');
  });

  it.each([
    [['user', 'assistant'], 'user'],
    [['assistant', 'tool'], 'assistant'],
    [['tool', 'reasoning'], 'tool'],
    [['reasoning', 'compact'], 'reasoning'],
    [['system', 'user'], 'system'],
  ] as const)('breaks a two-role tie toward %s', (roles, expected) => {
    const ribbon = computeRibbon([makeTurn(0, { roles })], 'time', 100);
    expect(ribbon.segments[0]!.dominantRole).toBe(expected);
  });

  it('picks the role with the most messages', () => {
    const turn = makeTurn(0, {
      roles: ['assistant', 'assistant', 'tool'],
    });
    const ribbon = computeRibbon([turn], 'time', 100);
    expect(ribbon.segments[0]!.dominantRole).toBe('assistant');
  });

  it('aggregates message counts across the turns of a bucket', () => {
    const turns = [
      makeTurn(0, { roles: ['system'] }),
      makeTurn(1, { roles: ['user'] }),
      ...Array.from({ length: RIBBON_MAX_SEGMENTS - 1 }, (_, i) =>
        makeTurn(i + 2),
      ),
    ];
    const ribbon = computeRibbon(turns, 'time', 800);
    const bucket = ribbon.segments[0]!;
    expect(bucket.turnIndices).toEqual([0, 1]);
    expect(bucket.dominantRole).toBe('system');
  });

  it('returns null when the segment has no ribbon-role message (subagent)', () => {
    const turn = makeTurn(3, { roles: ['subagent'] });
    const ribbon = computeRibbon([turn], 'time', 100);
    expect(ribbon.segments[0]!.dominantRole).toBeNull();
  });
});

describe('computeRibbon — accessible labels (tasks 5.6)', () => {
  it('names turn index, duration, and token total for a single turn', () => {
    const turn = makeTurn(3, { durationMs: 1_200, tokens: 3_400 });
    const ribbon = computeRibbon([turn], 'time', 100);
    expect(ribbon.segments[0]!.ariaLabel).toBe(
      'Turn 3: duration 1200 ms, tokens 3400',
    );
    expect(ribbon.segments[0]!.durationMs).toBe(1_200);
    expect(ribbon.segments[0]!.tokenTotal).toBe(3_400);
  });

  it('names the turn range for a bucket', () => {
    const turns = [
      makeTurn(0, { durationMs: 1_000, tokens: 100 }),
      makeTurn(1, { durationMs: 1_000, tokens: 100 }),
      ...Array.from({ length: RIBBON_MAX_SEGMENTS - 1 }, (_, i) =>
        makeTurn(i + 2),
      ),
    ];
    const ribbon = computeRibbon(turns, 'time', 800);
    const bucket = ribbon.segments[0]!;
    expect(bucket.ariaLabel).toBe(
      'Turns 0-1: duration 2000 ms, tokens 200',
    );
  });
});

describe('computeRibbon — edge hygiene', () => {
  it('handles an empty turn list without a crash', () => {
    const ribbon = computeRibbon([], 'time', 800);
    expect(ribbon.segments).toEqual([]);
    expect(ribbon.totalWidthPx).toBe(0);
    expect(ribbon.mode).toBe('time');
  });
});

describe('computeRibbon — D20 benchmark (tasks 5.8)', () => {
  it('computes 200 turns in under 5 ms', () => {
    const turns = makeTurns(RIBBON_MAX_SEGMENTS);
    // warm-up
    computeRibbon(turns, 'time', 800);
    computeRibbon(turns, 'token', 800);

    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      computeRibbon(turns, i % 2 === 0 ? 'time' : 'token', 800);
      samples.push(performance.now() - start);
    }
    const worst = Math.max(...samples);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log(
      `[turn-ribbon] 200 turns: worst ${worst.toFixed(3)}ms, avg ${avg.toFixed(3)}ms`,
    );
    expect(worst).toBeLessThan(5);
  });
});
