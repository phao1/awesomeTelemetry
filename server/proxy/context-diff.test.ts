import { describe, expect, it } from 'vitest';

import {
  HISTORY_SHRINK_RATIO,
  MAX_CHANGE_ENTRIES,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_INLINE_TEXT_CHARS,
  MAX_RESPONSE_BYTES,
  normalizeRequestContext,
  type NormalizedRequestContext,
} from './context-normalizer.js';
import {
  diffContexts,
  enforceResponseBudget,
  evidenceOf,
  inlineDiff,
  type ContextDiffResult,
} from './context-diff.js';

function norm(body: string, format = 'anthropic_messages' as const): NormalizedRequestContext {
  const r = normalizeRequestContext({ format, desensitizedBody: body });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('expected ok');
  return r.normalized;
}

async function diff(
  base: NormalizedRequestContext,
  target: NormalizedRequestContext,
  tokens: { base?: number | null; target?: number | null } = {},
): Promise<ContextDiffResult> {
  return diffContexts({
    base,
    target,
    baseInputTokens: tokens.base ?? null,
    targetInputTokens: tokens.target ?? null,
  });
}

function category(r: ContextDiffResult, name: string) {
  const c = r.categories.find((x) => x.category === name);
  if (!c) throw new Error(`missing category ${name}`);
  return c;
}

function anthropic(messages: unknown[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'claude-3-5-sonnet', system: 'be helpful', messages, ...over });
}

const USER_A = { role: 'user', content: 'hello world' };
const USER_B = { role: 'user', content: 'second question' };
const ASST = { role: 'assistant', content: 'ok done' };

describe('context-diff: append', () => {
  it('reports only the appended message and keeps the rest unchanged', async () => {
    const base = norm(anthropic([USER_A]));
    const target = norm(anthropic([USER_A, ASST]));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    expect(msgs.unchanged).toBe(1);
    expect(msgs.added).toBe(1);
    expect(msgs.removed).toBe(0);
    expect(msgs.modified).toBe(0);
    expect(msgs.entries).toHaveLength(1);
    expect(msgs.entries[0]!.kind).toBe('added');
    expect(r.noChange).toBe(false);
    expect(r.growth.messageDelta).toBe(1);
    expect(r.growth.baseChars).toBe(base.stats.totalChars);
    expect(r.growth.targetChars).toBe(target.stats.totalChars);
  });
});

describe('context-diff: no-change', () => {
  it('returns noChange=true only when every category is unchanged and complete', async () => {
    const body = anthropic([USER_A, USER_B, ASST]);
    const r = await diff(norm(body), norm(body));
    expect(r.noChange).toBe(true);
    for (const c of r.categories) {
      expect(c.unchanged).toBeGreaterThanOrEqual(0);
      expect(c.added + c.removed + c.modified).toBe(0);
      expect(c.entries).toHaveLength(0);
      expect(c.completeness.complete).toBe(true);
    }
    expect(r.indicators).toHaveLength(0);
  });
});

describe('context-diff: removal', () => {
  it('reports a removed message and system/tool loss indicators', async () => {
    const base = norm(anthropic([USER_A, USER_B]));
    const target = norm(anthropic([USER_A]));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    expect(msgs.removed).toBe(1);
    expect(msgs.unchanged).toBe(1);
    expect(msgs.entries[0]!.kind).toBe('removed');
  });
});

describe('context-diff: modification with inline segments', () => {
  it('produces equal/removed/added Unicode segments for a changed message', async () => {
    const base = norm(anthropic([{ role: 'user', content: 'Hello 🌍 world' }]));
    const target = norm(anthropic([{ role: 'user', content: 'Hello 🌎 planet' }]));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    expect(msgs.modified).toBe(1);
    const entry = msgs.entries[0]!;
    expect(entry.kind).toBe('modified');
    expect(entry.segments).not.toBeNull();
    const kinds = entry.segments!.map((s) => s.kind);
    expect(kinds[0]).toBe('equal');
    expect(kinds).toContain('removed');
    expect(kinds).toContain('added');
  });
});

describe('context-diff: message reorder stays significant', () => {
  it('reports reordered equal messages as remove/add evidence', async () => {
    const base = norm(anthropic([USER_A, USER_B]));
    const target = norm(anthropic([USER_B, USER_A]));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    // Order is significant: it must not be reported as a full no-change set.
    expect(msgs.removed + msgs.added + msgs.modified).toBeGreaterThan(0);
    expect(r.noChange).toBe(false);
  });
});

describe('context-diff: stable-ID matching precedence', () => {
  it('pairs by explicit provider ID before content hash (modified, not add+remove)', async () => {
    const base = norm(anthropic([{ role: 'user', content: 'hello', id: 'm1' }, USER_B]));
    const target = norm(anthropic([{ role: 'user', content: 'hello world', id: 'm1' }, USER_B]));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    expect(msgs.modified).toBe(1);
    expect(msgs.added + msgs.removed).toBe(0);
    expect(msgs.entries[0]!.identity).toBe('m1');
    expect(msgs.entries[0]!.kind).toBe('modified');
  });
});

describe('context-diff: duplicate messages stay independent', () => {
  it('one removed occurrence does not remove all identical messages', async () => {
    const base = norm(anthropic([USER_A, USER_A, USER_B]));
    const target = norm(anthropic([USER_A, USER_B]));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    expect(msgs.unchanged).toBe(2);
    expect(msgs.removed).toBe(1);
  });
});

describe('context-diff: tool schema paths', () => {
  it('object key order does not create a false modification', async () => {
    const schemaA = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
    const schemaB = { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' };
    const base = norm(
      anthropic([USER_A], { tools: [{ name: 't1', input_schema: schemaA }] }),
    );
    const target = norm(
      anthropic([USER_A], { tools: [{ name: 't1', input_schema: schemaB }] }),
    );
    const r = await diff(base, target);
    const tools = category(r, 'tools');
    expect(tools.unchanged).toBe(1);
    expect(tools.modified).toBe(0);
  });

  it('reports recursive changed paths when a tool schema changes', async () => {
    const base = norm(
      anthropic([USER_A], {
        tools: [{ name: 't1', description: 'old', input_schema: { type: 'object', properties: { a: { type: 'string' } } } }],
      }),
    );
    const target = norm(
      anthropic([USER_A], {
        tools: [{ name: 't1', description: 'new', input_schema: { type: 'object', properties: { a: { type: 'integer' } } } }],
      }),
    );
    const r = await diff(base, target);
    const tools = category(r, 'tools');
    expect(tools.modified).toBe(1);
    const entry = tools.entries[0]!;
    expect(entry.changedPaths).toContain('description');
    expect(entry.changedPaths).toContain('schema.properties.a.type');
    expect(entry.before).not.toBeNull();
    expect(entry.after).not.toBeNull();
  });
});

describe('context-diff: typed parameter changes', () => {
  it('preserves JSON types and does not coerce to strings', async () => {
    const base = norm(anthropic([USER_A], { temperature: 0.7 }));
    const target = norm(anthropic([USER_A], { temperature: '0.7' }));
    const r = await diff(base, target);
    const params = category(r, 'parameters');
    expect(params.modified).toBe(1);
    const entry = params.entries[0]!;
    expect(entry.before!.jsonType).toBe('number');
    expect(entry.after!.jsonType).toBe('string');
  });

  it('treats an object key reorder in a scalar-metadata value as unchanged', async () => {
    const base = norm(
      anthropic([USER_A], { metadata: { user_id: 'u-1', org: 'acme' } }),
    );
    const target = norm(
      anthropic([USER_A], { metadata: { org: 'acme', user_id: 'u-1' } }),
    );
    const r = await diff(base, target);
    const params = category(r, 'parameters');
    expect(params.added + params.removed + params.modified).toBe(0);
  });
});

describe('context-diff: system category', () => {
  it('detects a removed system block and emits system_loss', async () => {
    const base = norm(
      JSON.stringify({ model: 'claude', system: ['part one', 'part two'], messages: [USER_A] }),
    );
    const target = norm(
      JSON.stringify({ model: 'claude', system: ['part one'], messages: [USER_A] }),
    );
    const r = await diff(base, target);
    const sys = category(r, 'system');
    expect(sys.removed).toBe(1);
    expect(r.indicators.some((i) => i.code === 'system_loss')).toBe(true);
  });

  it('emits a system modification with inline segments', async () => {
    const base = norm(JSON.stringify({ model: 'claude', system: 'keep it short', messages: [USER_A] }));
    const target = norm(JSON.stringify({ model: 'claude', system: 'keep it very short', messages: [USER_A] }));
    const r = await diff(base, target);
    const sys = category(r, 'system');
    expect(sys.modified).toBe(1);
    expect(sys.entries[0]!.segments).not.toBeNull();
  });
});

describe('context-diff: history shrink indicator (30% threshold)', () => {
  function shrink(ratio: number): { base: NormalizedRequestContext; target: NormalizedRequestContext } {
    // Base messageChars = 997 + 3 = 1000; target messageChars = T + 2.
    const baseBody = anthropic([
      { role: 'user', content: 'a'.repeat(995) },
      { role: 'user', content: 'b' },
    ]);
    const targetLen = Math.round(1000 * (1 - ratio)) - 2;
    const targetBody = anthropic([{ role: 'user', content: 'a'.repeat(targetLen) }]);
    return { base: norm(baseBody), target: norm(targetBody) };
  }

  it('does not flag at just below the threshold', async () => {
    const { base, target } = shrink(HISTORY_SHRINK_RATIO - 0.01);
    const r = await diff(base, target);
    expect(r.indicators.some((i) => i.code === 'history_shrink')).toBe(false);
  });

  it('flags suspected_compaction exactly at the threshold with a removal', async () => {
    const { base, target } = shrink(HISTORY_SHRINK_RATIO);
    const r = await diff(base, target);
    const ind = r.indicators.find((i) => i.code === 'history_shrink');
    expect(ind).toBeDefined();
    expect(ind!.classification).toBe('suspected_compaction');
    expect(ind!.severity).toBe('warning');
    expect(ind!.before).toBe(base.stats.messageChars);
    expect(ind!.after).toBe(target.stats.messageChars);
  });
});

describe('context-diff: captured token delta', () => {
  it('uses captured_usage when both sides have tokens, else usage_missing', async () => {
    const body = anthropic([USER_A]);
    const withTokens = await diff(norm(body), norm(body), { base: 100, target: 150 });
    expect(withTokens.growth.inputTokenDelta).toBe(50);
    expect(withTokens.growth.inputTokenDeltaReason).toBe('captured_usage');

    const noTokens = await diff(norm(body), norm(body));
    expect(noTokens.growth.inputTokenDelta).toBeNull();
    expect(noTokens.growth.inputTokenDeltaReason).toBe('usage_missing');
  });
});

describe('context-diff: incomplete evidence forces noChange=false', () => {
  it('marks source_incomplete and never claims complete no-change when a source is truncated', async () => {
    const many = Array.from({ length: 3 }, () => USER_A);
    // Build a context whose messages exceed the 2,000 cap via normalization.
    const huge: { role: string; content: string }[] = [];
    for (let i = 0; i < 2_050; i += 1) {
      huge.push({ role: 'user', content: `m${i}` });
    }
    const base = norm(anthropic(huge));
    const target = norm(anthropic([USER_A]));
    const r = await diff(base, target);
    expect(base.completeness.complete).toBe(false);
    expect(r.completeness.complete).toBe(false);
    expect(r.completeness.reasons).toContain('item_limit');
    expect(r.noChange).toBe(false);
    expect(r.indicators.some((i) => i.code === 'source_incomplete')).toBe(true);
    expect(many).toHaveLength(3);
  });
});

describe('context-diff: entry cap and response budget', () => {
  function bodyWith(n: number): string {
    const messages = Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message number ${i}`,
    }));
    return anthropic(messages);
  }

  it('caps changed entries at MAX_CHANGE_ENTRIES and flags entry_limit', async () => {
    const base = norm(bodyWith(1));
    // Target with many distinct added messages -> many added entries.
    const target = norm(bodyWith(2_500));
    const r = await diff(base, target);
    const total = r.categories.reduce((s, c) => s + c.entries.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CHANGE_ENTRIES);
    expect(r.completeness.reasons).toContain('entry_limit');
    expect(r.noChange).toBe(false);
  });

  it('keeps the serialized response below 1 MiB after budget enforcement', async () => {
    const base = norm(bodyWith(2_400));
    const target = norm(bodyWith(2_480));
    const r = await diff(base, target);
    const response = {
      base: { id: 1 },
      target: { id: 2 },
      pairing: { confidence: 'manual', reason: 'x', warnings: [] },
      noChange: r.noChange,
      growth: r.growth,
      indicators: r.indicators,
      categories: r.categories,
      completeness: r.completeness,
      generatedAt: new Date().toISOString(),
      durationMs: 1,
    } as never;
    enforceResponseBudget(response);
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });
});

describe('context-diff: inline + evidence bounds', () => {
  it('returns null segments and inline_limit for oversized text', async () => {
    const big = 'x'.repeat(MAX_INLINE_TEXT_CHARS + 10);
    const base = norm(JSON.stringify({ model: 'claude', system: 'a', messages: [{ role: 'user', content: big }] }));
    const target = norm(JSON.stringify({ model: 'claude', system: 'a', messages: [{ role: 'user', content: big + 'y' }] }));
    const r = await diff(base, target);
    const msgs = category(r, 'messages');
    const entry = msgs.entries.find((e) => e.kind === 'modified');
    expect(entry).toBeDefined();
    expect(entry!.segments).toBeNull();
    expect(entry!.truncatedReason).toBe('inline_limit');
    expect(entry!.before!.truncated).toBe(true);
    expect(entry!.before!.excerptStart.length).toBeLessThanOrEqual(MAX_EVIDENCE_EXCERPT_CHARS);
  });

  it('inlineDiff compares Unicode code points, not UTF-16 units', () => {
    const before = 'a😀b';
    const after = 'a😀c';
    const d = inlineDiff(before, after);
    expect(d.truncated).toBe(false);
    expect(d.segments!.map((s) => s.kind)).toEqual(['equal', 'removed', 'added']);
  });
});

describe('context-diff: evidence helper', () => {
  it('exposes type, hash, length and excerpts with canonical ordering', () => {
    const ev = evidenceOf({ b: 1, a: 2 });
    expect(ev.jsonType).toBe('object');
    expect(ev.sha256).toHaveLength(64);
    expect(ev.excerptStart).toBe('{"a":2,"b":1}');
    expect(ev.truncated).toBe(false);
  });
});
