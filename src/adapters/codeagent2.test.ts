import { describe, expect, it } from 'vitest';

import { codeagent2Adapter } from './codeagent2.js';
import { codeagent2Fixture } from './__fixtures__/codeagent2.js';

const SRC = '/tmp/codemate.sqlite';

describe('CodeAgent2 adapter（REQ-005/G9.1 thin wrapper）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = codeagent2Adapter.normalize(
      { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events: codeagent2Fixture.events },
      SRC,
    );
    expect(r.session.provider).toBe('codeagent2');
    expect(r.session.sourceAgent).toBe('CodeMate');
    expect(r.session.id).toBe('cm-s1');
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'file_read']);
    expect(r.events[1]?.phase).toBe('understand'); // Grep → understand
  });

  it('#4 cacheRead 增量用 sum', () => {
    const events = [
      { id: 'm1', role: 'assistant' as const, sessionID: 'cm-s1', time: { created: 1754000000000 }, tokens: { cache: { read: 10 } }, content: [{ type: 'text', text: 'a' }] },
      { id: 'm2', role: 'assistant' as const, sessionID: 'cm-s1', time: { created: 1754000010000 }, tokens: { cache: { read: 25 } }, content: [{ type: 'text', text: 'b' }] },
    ];
    const r = codeagent2Adapter.normalize(
      { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events },
      SRC,
    );
    expect(r.session.tokenUsage.cacheRead).toBe(35); // 10 + 25
  });

  it('状态归一化四类映射', () => {
    const statuses = ['completed', 'failed', 'paused', 'canceled'];
    const events = statuses.map((status, i) => ({
      id: `s${i}`, role: 'assistant' as const, sessionID: 'cm-s1', time: { created: 1754000000000 + i },
      tokens: null,
      content: [{ type: 'tool', tool: 'Bash', state: { status, title: 'x' } }],
    }));
    const r = codeagent2Adapter.normalize(
      { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events },
      SRC,
    );
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const events = [
      { id: 'dup', role: 'assistant' as const, sessionID: 'cm-s1', time: { created: 1754000000000 }, tokens: null, content: [{ type: 'text', text: 'a' }] },
      { id: 'dup', role: 'assistant' as const, sessionID: 'cm-s1', time: { created: 1754000010000 }, tokens: null, content: [{ type: 'text', text: 'b' }] },
    ];
    const r = codeagent2Adapter.normalize(
      { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events },
      SRC,
    );
    expect(r.events.map((e) => e.id)).toEqual(['dup-0', 'dup-0:2']);
  });

  it('title 截断到 200 字符', () => {
    const events = [
      { id: 'm1', role: 'user' as const, sessionID: 'cm-s1', time: { created: 1754000000000 }, tokens: null, content: [{ type: 'text', text: 'g'.repeat(250) }] },
    ];
    const r = codeagent2Adapter.normalize(
      { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events },
      SRC,
    );
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = codeagent2Adapter.normalize(
      { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events: codeagent2Fixture.events },
      SRC,
    );
    expect((r.events[1] as unknown as { raw?: string }).raw).toContain('"tool"');
    expect(r.events[1]?.title).not.toContain('"tool"');
  });
});
