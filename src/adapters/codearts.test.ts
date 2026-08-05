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
});
