import { describe, expect, it } from 'vitest';

import { normalizeWorkBuddySample, type WorkBuddyRawMessage } from './workbuddy.js';
import { workbuddyFixture } from './__fixtures__/workbuddy.js';

const SRC = '/tmp/workbuddy.jsonl';

function sample(messages: WorkBuddyRawMessage[]) {
  return { sourceAgent: 'WorkBuddy', session: workbuddyFixture.session, events: messages };
}

describe('WorkBuddy adapter（REQ-009）', () => {
  it('fixture：callId 配对、Exit Code 错误、<user_query> 提取、credit 累计', () => {
    const r = normalizeWorkBuddySample(sample(workbuddyFixture.events), SRC);
    expect(r.session.provider).toBe('workbuddy');
    expect(r.session.sourceAgent).toBe('WorkBuddy');
    expect(r.session.title).toBe('optimize the loader');
    expect(r.session.costUsd).toBeCloseTo(0.003);
    expect(r.session.eventCount).toBe(3); // call + result 配对合并为 1
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'bash', 'file_write']);
    expect(r.events[1]?.status).toBe('error'); // Exit Code: 1 配对结果
    expect(r.events[1]?.outputSummary).toContain('Exit Code: 1');
  });

  it('skipRun 标志也判为错误', () => {
    const messages: WorkBuddyRawMessage[] = [
      { id: 'f1', type: 'function_call', callId: 'c1', toolName: 'Bash', timestamp: '2026-08-01T00:00:00.000Z' },
      { id: 'f2', type: 'function_call_result', callId: 'c1', toolName: 'Bash', skipRun: true, timestamp: '2026-08-01T00:00:01.000Z' },
    ];
    const r = normalizeWorkBuddySample(sample(messages), SRC);
    expect(r.events[0]?.status).toBe('error');
  });

  it('状态归一化四类映射', () => {
    const messages: WorkBuddyRawMessage[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) => ({
      id: `w${i}`, type: 'function_call', callId: `c${i}`, toolName: 'Bash', status, timestamp: `2026-08-01T00:00:0${i}.000Z`,
    }));
    const r = normalizeWorkBuddySample(sample(messages), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const messages: WorkBuddyRawMessage[] = [
      { id: 'dup', type: 'function_call', toolName: 'Bash', timestamp: '2026-08-01T00:00:00.000Z' },
      { id: 'dup', type: 'function_call', toolName: 'Bash', timestamp: '2026-08-01T00:00:01.000Z' },
    ];
    const r = normalizeWorkBuddySample(sample(messages), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup', 'dup:2']);
  });

  it('title 截断到 200 字符', () => {
    const messages: WorkBuddyRawMessage[] = [
      { id: 'w1', type: 'function_call', toolName: 'Bash', content: 'e'.repeat(250), timestamp: '2026-08-01T00:00:00.000Z' },
    ];
    const r = normalizeWorkBuddySample(sample(messages), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeWorkBuddySample(sample(workbuddyFixture.events), SRC);
    expect((r.events[1] as unknown as { raw?: string }).raw).toContain('"callId"');
    expect(r.events[1]?.title).not.toContain('"callId"');
  });
});
