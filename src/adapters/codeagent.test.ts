import { describe, expect, it } from 'vitest';

import type { ClaudeRawRow } from './claude-code.js';
import { codeAgentAdapter } from './codeagent.js';
import { codeagentFixture } from './__fixtures__/codeagent.js';

const SRC = '/tmp/codeagent.jsonl';

describe('CodeAgent adapter（REQ-004/G9.2）', () => {
  it('fixture：drop file-history-snapshot 行并 relabel actor', () => {
    const r = codeAgentAdapter.normalize(
      { sourceAgent: 'CodeAgent', session: {}, events: codeagentFixture.events },
      SRC,
    );
    expect(r.session.provider).toBe('codeagent');
    expect(r.session.sourceAgent).toBe('CodeAgent');
    expect(r.session.eventCount).toBe(2); // snapshot 行被 drop
    expect(r.events.every((e) => e.actor === 'user' || e.actor === 'codeagent')).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'llm']);
  });

  it('token 聚合用 sum（incremental）', () => {
    const rows: ClaudeRawRow[] = [
      { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } } },
      { type: 'assistant', message: { id: 'a2', content: [{ type: 'text', text: 'y' }], usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 4 } } },
    ];
    const r = codeAgentAdapter.normalize(
      { sourceAgent: 'CodeAgent', session: {}, events: rows },
      SRC,
    );
    expect(r.session.tokenUsage).toEqual({
      input: 12, output: 6, reasoning: 0, cacheRead: 7, cacheWrite: 0, netInput: 5, total: 25,
    });
  });

  it('状态归一化四类映射', () => {
    const rows: ClaudeRawRow[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) => ({
      type: 'user',
      message: { id: `u${i}`, content: [{ type: 'text', text: 'hi' }], status },
    }));
    const r = codeAgentAdapter.normalize({ sourceAgent: 'CodeAgent', session: {}, events: rows }, SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const rows: ClaudeRawRow[] = [
      { type: 'user', message: { id: 'dup', content: [{ type: 'text', text: 'a' }] } },
      { type: 'user', message: { id: 'dup', content: [{ type: 'text', text: 'b' }] } },
    ];
    const r = codeAgentAdapter.normalize({ sourceAgent: 'CodeAgent', session: {}, events: rows }, SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup', 'dup:2']);
  });

  it('title 截断到 200 字符', () => {
    const rows: ClaudeRawRow[] = [
      { type: 'user', message: { id: 'u1', content: [{ type: 'text', text: 'y'.repeat(250) }] } },
    ];
    const r = codeAgentAdapter.normalize({ sourceAgent: 'CodeAgent', session: {}, events: rows }, SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = codeAgentAdapter.normalize(
      { sourceAgent: 'CodeAgent', session: {}, events: codeagentFixture.events },
      SRC,
    );
    const ev = r.events[1] as unknown as { raw?: string };
    expect(ev.raw).toContain('"text"');
    expect(r.events[1]?.outputSummary).not.toContain(ev.raw ?? '');
  });
});
