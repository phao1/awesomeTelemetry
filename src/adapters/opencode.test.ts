import { describe, expect, it } from 'vitest';

import { normalizeOpenCode, type OpenCodeMessage, type OpenCodeOtelSpan } from './opencode.js';
import { opencodeCarrierFixture, opencodeFixture } from './__fixtures__/opencode.js';
import { computeTokenBreakdown } from '../core/token-breakdown.js';
import { attributeTokensToLlmEvents } from '../core/speed-metrics.js';

const SRC = '/tmp/oc.sqlite';

function sample(events: OpenCodeMessage[]): Parameters<typeof normalizeOpenCode>[0] {
  return {
    sourceAgent: 'OpenCode',
    session: opencodeFixture.session,
    events,
  };
}

function msg(over: Partial<OpenCodeMessage> & { id: string; role: 'user' | 'assistant' }): OpenCodeMessage {
  const { id, role, ...rest } = over;
  return {
    id,
    role,
    sessionID: 'oc-session-1',
    time: { created: 1754000000000 },
    tokens: null,
    content: [{ type: 'text', text: 'x' }],
    ...rest,
  };
}

describe('OpenCode adapter（REQ-005）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeOpenCode(sample(opencodeFixture.events), SRC);
    expect(r.session.provider).toBe('opencode');
    expect(r.session.sourceAgent).toBe('OpenCode');
    expect(r.session.id).toBe('oc-session-1');
    expect(r.session.isSubagent).toBe(true); // 标题匹配 (@...subagent)
    expect(r.session.eventCount).toBe(3);
    expect(r.session.messageCount).toBe(3);
    expect(r.session.totalDurationMs).toBe(40000); // wall-clock
    // #4：cacheRead 100 + 150 = 250（增量求和）；#8：total 含 cacheWrite
    expect(r.session.tokenUsage).toEqual({
      input: 25, output: 13, reasoning: 2, cacheRead: 250, cacheWrite: 5, total: 295,
    });
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'bash', 'llm']);
    expect(r.events[1]?.phase).toBe('verify'); // Bash npm test
    expect(r.tokenSemantics).toEqual({
      cacheRead: 'incremental',
      reasoning: 'incremental',
      reasoningInTotal: true, // #6：OpenCode 实测 total 含 reasoning
    });
  });

  it('#4 cacheRead 用 sum 而非 max，reasoning 用 sum', () => {
    const events = [
      msg({ id: 'm1', role: 'assistant', tokens: { input: 1, output: 1, cache: { read: 10, write: 1 } } }),
      msg({ id: 'm2', role: 'assistant', tokens: { input: 1, output: 1, reasoning: 3, cache: { read: 30, write: 1 } } }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.session.tokenUsage.cacheRead).toBe(40);
    expect(r.session.tokenUsage.reasoning).toBe(3);
    expect(r.session.tokenUsage.cacheWrite).toBe(2);
    expect(r.session.tokenUsage.total).toBe(2 + 2 + 3 + 40 + 2);
  });

  it('#5 多 part 消息的 token 只计一次（step 或最后一个 part 挂载）', () => {
    const events = [
      msg({
        id: 'multi',
        role: 'assistant',
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 7, write: 1 } },
        content: [
          { type: 'step', state: { status: 'completed', title: 'think' } },
          { type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } },
          { type: 'tool', tool: 'Read', state: { status: 'completed', title: 'read x' } },
        ],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events).toHaveLength(3);
    // 只有 step part 挂 token，其余为 null → 会话聚合只计一次
    const withTokens = r.events.filter((e) => e.tokens !== null);
    expect(withTokens).toHaveLength(1);
    expect(r.session.tokenUsage.input).toBe(10);
    expect(r.session.tokenUsage.output).toBe(5);
    expect(r.session.tokenUsage.cacheRead).toBe(7);
    expect(r.session.tokenUsage.total).toBe(10 + 5 + 2 + 7 + 1);
  });

  it('§4.1 回归护栏：computeTokenBreakdown 在归因前后完全相等（归因禁止写回 event.tokens）', () => {
    const r = normalizeOpenCode(
      {
        sourceAgent: 'OpenCode',
        session: opencodeCarrierFixture.session,
        events: opencodeCarrierFixture.events,
      },
      SRC,
    );
    const before = computeTokenBreakdown(r).total;
    const attributed = attributeTokensToLlmEvents(r);
    expect(attributed.size).toBeGreaterThan(0);
    const after = computeTokenBreakdown(r).total;
    // 一旦有人把归因结果写回 event.tokens，这里就会红（双计 bug 的锁死测试）
    expect(after).toBe(before);
  });

  it('状态归一化四类映射', () => {
    const statuses = ['completed', 'failed', 'paused', 'canceled'];
    const events = statuses.map((status, i) =>
      msg({
        id: `s${i}`,
        role: 'assistant',
        content: [{ type: 'tool', tool: 'Bash', state: { status, title: 'x' } }],
      }),
    );
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const events = [
      msg({ id: 'dup', role: 'assistant' }),
      msg({ id: 'dup', role: 'assistant' }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup-0', 'dup-0:2']);
  });

  it('title 截断到 200 字符', () => {
    const long = 'a'.repeat(250);
    const r = normalizeOpenCode(sample([msg({ id: 'm1', role: 'user', content: [{ type: 'text', text: long }] })]), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeOpenCode(
      sample([
        msg({
          id: 'm1',
          role: 'assistant',
          content: [{ type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } }],
        }),
      ]),
      SRC,
    );
    const ev = r.events[0] as unknown as { raw?: string };
    expect(ev.raw).toBeDefined();
    expect(ev.raw).toContain('"tool"');
    expect(r.events[0]?.title).not.toContain(ev.raw ?? '');
  });

  it('OTel span 三源支持', () => {
    const otel: OpenCodeOtelSpan[] = [
      { name: 'POST /chat', startTime: 1754000000000, endTime: 1754000001000, status: 'completed' },
    ];
    const r = normalizeOpenCode(
      { sourceAgent: 'OpenCode', session: opencodeFixture.session, events: [...opencodeFixture.events, ...otel] },
      SRC,
    );
    expect(r.events.length).toBe(4);
    const otelEvent = r.events.find((e) => (e as unknown as { raw?: string }).raw?.includes('POST /chat'));
    expect(otelEvent?.durationMs).toBe(1000);
  });
});
