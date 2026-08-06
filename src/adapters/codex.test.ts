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
    // session_meta / turn_context 是元数据行，不产生轨迹事件
    expect(r.session.eventCount).toBe(6);
    expect(r.events.map((e) => e.kind)).toEqual([
      'user_prompt', 'tool', 'tool', 'llm', 'llm', 'llm',
    ]);
    expect(r.events[1]?.tool).toBe('shell');
    // 取末条累计快照：input 25 已减去 cached 8 → 17；Codex 的 input 本就含 cached，
    // 减完之后 input 即净输入，netInput 不再二次相减。
    expect(r.session.tokenUsage).toEqual({
      input: 17, output: 8, reasoning: 3, cacheRead: 8, cacheWrite: 0, netInput: 17, total: 33,
    });
  });

  it('turn_context.model 标注到该轮之后的事件上', () => {
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect(r.session.primaryModel).toBe('deepseek-v4-flash');
    expect(r.events.every((e) => e.model === 'deepseek-v4-flash')).toBe(true);
  });

  it('会话总量以末条 total_token_usage 累计快照为准', () => {
    const last = codexFixture.events.at(-1)?.payload?.info?.total_token_usage;
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect(r.session.tokenUsage.total).toBe(last?.total_tokens);
  });

  it('累计快照与逐轮增量之和不一致时，取快照（重试轮会重复计入增量）', () => {
    const rows: CodexRawRow[] = [
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 30, output_tokens: 1 },
            total_token_usage: { input_tokens: 30, output_tokens: 1, total_tokens: 31 },
          },
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            // 增量之和会得到 50+2；但 Codex 自报累计只有 45+2
            last_token_usage: { input_tokens: 20, output_tokens: 1 },
            total_token_usage: { input_tokens: 45, output_tokens: 2, total_tokens: 47 },
          },
        },
      },
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.session.tokenUsage.total).toBe(47);
    // 事件级仍保留逐轮增量，供时间线与归因使用
    expect(r.events.map((e) => e.tokens?.input)).toEqual([30, 20]);
  });

  it('无 token_count 行时退回逐事件求和', () => {
    const rows: CodexRawRow[] = [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'hi' } },
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.session.tokenUsage.total).toBe(0);
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
