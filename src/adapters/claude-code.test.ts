import { describe, expect, it } from 'vitest';

import { normalizeClaudeSample, type ClaudeRawRow } from './claude-code.js';
import { claudeFixture } from './__fixtures__/claude.js';

const SRC = '/tmp/claude.jsonl';

function sample(events: ClaudeRawRow[]) {
  return { sourceAgent: 'Claude', session: {}, events };
}

describe('Claude Code adapter（REQ-004）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeClaudeSample(sample(claudeFixture.events), SRC);
    expect(r.session.provider).toBe('claude');
    expect(r.session.sourceAgent).toBe('Claude');
    expect(r.session.id).toBe('claude-s1');
    expect(r.session.eventCount).toBe(4);
    expect(r.session.messageCount).toBe(3);
    expect(r.session.tokenUsage).toEqual({
      input: 150, output: 50, reasoning: 0, cacheRead: 15, cacheWrite: 2, total: 215,
    });
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'llm', 'tool', 'llm']);
    expect(r.tokenSemantics).toEqual({ cacheRead: 'incremental', reasoning: 'incremental' });
  });

  it('cacheRead 用 sum（incremental 语义）', () => {
    const rows: ClaudeRawRow[] = [
      { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'x' }], usage: { cache_read_input_tokens: 10 } } },
      { type: 'assistant', message: { id: 'a2', content: [{ type: 'text', text: 'y' }], usage: { cache_read_input_tokens: 5 } } },
    ];
    const r = normalizeClaudeSample(sample(rows), SRC);
    expect(r.session.tokenUsage.cacheRead).toBe(15);
    expect(r.session.tokenUsage.total).toBe(15);
  });

  it('状态归一化四类映射', () => {
    const statuses = ['completed', 'failed', 'paused', 'canceled'];
    const rows: ClaudeRawRow[] = statuses.map((status, i) => ({
      type: 'user',
      message: { id: `u${i}`, content: [{ type: 'text', text: 'hi' }], status },
    }));
    const r = normalizeClaudeSample(sample(rows), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const rows: ClaudeRawRow[] = [
      { type: 'user', message: { id: 'dup', content: [{ type: 'text', text: 'a' }] } },
      { type: 'user', message: { id: 'dup', content: [{ type: 'text', text: 'b' }] } },
    ];
    const r = normalizeClaudeSample(sample(rows), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup', 'dup:2']);
  });

  it('title 截断到 200 字符', () => {
    const rows: ClaudeRawRow[] = [
      { type: 'user', message: { id: 'u1', content: [{ type: 'text', text: 'x'.repeat(250) }] } },
    ];
    const r = normalizeClaudeSample(sample(rows), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeClaudeSample(sample(claudeFixture.events), SRC);
    const ev = r.events[2] as unknown as { raw?: string }; // tool_use
    expect(ev.raw).toContain('tool_use');
    expect(r.events[2]?.inputSummary).not.toContain(ev.raw ?? '');
  });
});
