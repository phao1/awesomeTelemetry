import { describe, expect, it } from 'vitest';

import { normalizeCodexSample, type CodexRawRow } from './codex.js';
import { codexFixture } from './__fixtures__/codex.js';

const SRC = '/tmp/codex.jsonl';

function sample(events: CodexRawRow[]) {
  return { sourceAgent: 'Codex', session: {}, events };
}

describe('Codex adapter（REQ-007）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect(r.session.provider).toBe('codex');
    expect(r.session.sourceAgent).toBe('Codex');
    expect(r.session.id).toBe('codex-s1');
    expect(r.session.cwd).toBe('/tmp/proj');
    expect(r.session.eventCount).toBe(4);
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'tool', 'tool', 'llm']);
    expect(r.events[1]?.tool).toBe('shell');
    expect(r.session.tokenUsage).toEqual({
      input: 15, output: 8, reasoning: 3, cacheRead: 3, cacheWrite: 0, netInput: 12, total: 29,
    });
  });

  it('cacheRead 用 sum（incremental）', () => {
    const rows: CodexRawRow[] = [
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'a', usage: { cache_read_input_tokens: 10 } } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'b', usage: { cache_read_input_tokens: 5 } } },
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.session.tokenUsage.cacheRead).toBe(15);
  });

  it('状态归一化四类映射', () => {
    const rows: CodexRawRow[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) => ({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: `hi${i}`, status },
    }));
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const rows: CodexRawRow[] = [
      { type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'shell' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'shell' } },
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['c1', 'c1:2']);
  });

  it('title 截断到 200 字符', () => {
    const rows: CodexRawRow[] = [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'z'.repeat(250) } },
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect((r.events[1] as unknown as { raw?: string }).raw).toContain('function_call');
    expect(r.events[1]?.inputSummary).not.toContain('"type"');
  });
});
