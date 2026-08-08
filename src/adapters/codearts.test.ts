import { describe, expect, it } from 'vitest';

import { codeartsAdapter } from './codearts.js';
import { codeartsFixture } from './__fixtures__/codearts.js';

const SRC = '/tmp/codearts.sqlite';

describe('CodeArts adapter（REQ-005/G9.1 thin wrapper）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events: codeartsFixture.events },
      SRC,
    );
    expect(r.session.provider).toBe('codearts');
    expect(r.session.sourceAgent).toBe('CodeArts');
    expect(r.session.id).toBe('ca2-s1');
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'file_write']);
  });

  it('#4 cacheRead 增量用 sum', () => {
    const events = [
      { id: 'm1', role: 'assistant' as const, sessionID: 'ca2-s1', time: { created: 1754000000000 }, tokens: { cache: { read: 10 } }, content: [{ type: 'text', text: 'a' }] },
      { id: 'm2', role: 'assistant' as const, sessionID: 'ca2-s1', time: { created: 1754000010000 }, tokens: { cache: { read: 40 } }, content: [{ type: 'text', text: 'b' }] },
    ];
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    expect(r.session.tokenUsage.cacheRead).toBe(50); // 10 + 40
  });

  it('#6 CodeArts/DeepSeek：reasoning 是 output 子集，total 不含 reasoning', () => {
    const events = [
      { id: 'm1', role: 'assistant' as const, sessionID: 'ca2-s1', time: { created: 1754000000000 }, tokens: { input: 100, output: 50, reasoning: 30, cache: { read: 10 } }, content: [{ type: 'text', text: 'a' }] },
    ];
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    expect(r.tokenSemantics.reasoningInTotal).toBe(false);
    expect(r.session.tokenUsage.reasoning).toBe(30);
    expect(r.session.tokenUsage.total).toBe(100 + 50 + 10); // 不含 reasoning
  });

  it('状态归一化四类映射', () => {
    const statuses = ['completed', 'failed', 'paused', 'canceled'];
    const events = statuses.map((status, i) => ({
      id: `s${i}`, role: 'assistant' as const, sessionID: 'ca2-s1', time: { created: 1754000000000 + i },
      tokens: null,
      content: [{ type: 'tool', tool: 'Bash', state: { status, title: 'x' } }],
    }));
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('fix-session-detail-display 2.x：真实 CodeArts part 形状（tool 输入输出 + 纯 step 标记 + step tokens）', () => {
    const events = [
      { id: 'm1', role: 'user' as const, sessionID: 'ca2-s1', time: { created: 1754000000000 }, tokens: null, content: [{ type: 'text', text: '看板下钻' }] },
      {
        id: 'm2',
        role: 'assistant' as const,
        sessionID: 'ca2-s1',
        time: { created: 1754000010000 },
        tokens: null,
        content: [
          { type: 'step-start' },
          {
            type: 'tool',
            tool: 'glob',
            state: { status: 'completed', title: 'glob src', input: { pattern: '*' }, output: '/tmp/a.ts' },
          },
          { type: 'step-finish', tokens: { total: 100, input: 90, output: 10, cache: { read: 0, write: 0 } } },
        ],
      },
    ];
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'file_read', 'agent']);
    expect(r.events[1]!.hasInput).toBe(true);
    expect(JSON.parse(r.events[1]!.inputSummary ?? '')).toEqual({ pattern: '*' });
    expect(r.events[1]!.outputSummary).toBe('/tmp/a.ts');
    expect(r.events[2]!.title).toBe('agent step: success');
    expect(r.events[2]!.tokens?.input).toBe(90);
    expect(r.session.tokenUsage.input).toBe(90); // 只计一次
    expect(r.session.eventCount).toBe(3);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const events = [
      { id: 'dup', role: 'assistant' as const, sessionID: 'ca2-s1', time: { created: 1754000000000 }, tokens: null, content: [{ type: 'text', text: 'a' }] },
      { id: 'dup', role: 'assistant' as const, sessionID: 'ca2-s1', time: { created: 1754000010000 }, tokens: null, content: [{ type: 'text', text: 'b' }] },
    ];
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    expect(r.events.map((e) => e.id)).toEqual(['dup-0', 'dup-0:2']);
  });

  it('title 截断到 200 字符', () => {
    const events = [
      { id: 'm1', role: 'user' as const, sessionID: 'ca2-s1', time: { created: 1754000000000 }, tokens: null, content: [{ type: 'text', text: 'f'.repeat(250) }] },
    ];
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events: codeartsFixture.events },
      SRC,
    );
    expect((r.events[1] as unknown as { raw?: string }).raw).toContain('"tool"');
    expect(r.events[1]?.title).not.toContain('"tool"');
  });

  // fix-adapter-turn-semantics A4 codearts 行：key = 源 message id（去掉 part 序号的
  // 消息标识）。codearts 是七个里唯一有活数据的（A1：155 事件），但规则同样由 fixture
  // 支撑，活数据形状见下一用例。
  it('fix-adapter-turn-semantics A4：turnKey = 源 message id（从源记录取，不经公开 id 反解）', () => {
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events: codeartsFixture.events },
      SRC,
    );
    // fixture：ca2-m1 → user_prompt；ca2-m2 → file_write
    expect(r.events.map((e) => e.turnKey)).toEqual(['ca2-m1', 'ca2-m2']);
    expect(r.turnKeySource).toBe('message_identity');
  });

  it('fix-adapter-turn-semantics A4：活数据形状 msg_…-N —— key 是去掉 part 序号的 message id', () => {
    const events = [
      {
        id: 'msg_e5a6706dd001EO50ARXbYTFmlW',
        role: 'assistant' as const,
        sessionID: 'ca2-s1',
        time: { created: 1754000000000 },
        tokens: null,
        content: [
          { type: 'tool', tool: 'Write', state: { status: 'completed', title: 'write a.ts' } },
          { type: 'text', text: 'ok' },
        ],
      },
    ];
    const r = codeartsAdapter.normalize(
      { sourceAgent: 'CodeArts', session: codeartsFixture.session, events },
      SRC,
    );
    // 公开 id 带 -0 / -1 part 序号；turnKey 是完整 message id，来自源记录而非字符串反解
    expect(r.events.map((e) => e.id)).toEqual([
      'msg_e5a6706dd001EO50ARXbYTFmlW-0',
      'msg_e5a6706dd001EO50ARXbYTFmlW-1',
    ]);
    expect(r.events.map((e) => e.turnKey)).toEqual([
      'msg_e5a6706dd001EO50ARXbYTFmlW',
      'msg_e5a6706dd001EO50ARXbYTFmlW',
    ]);
  });
});
