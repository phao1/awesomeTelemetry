import { describe, expect, it } from 'vitest';

import type { TraceEvent, TraceRecord } from './trace-types.js';
import {
  computeTokenBreakdown,
  extractTokenText,
  extractTokenTexts,
} from './token-breakdown.js';

function ev(id: string, cacheRead: number, cacheWrite = 0): TraceEvent {
  return {
    id, sessionId: 's1', sequence: 1, turnKey: null, kind: 'llm', phase: 'implement', title: '',
    startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0, status: 'success',
    actor: 'assistant', tool: null,
    tokens: { input: 1, output: 2, reasoning: 1, cacheRead, cacheWrite, netInput: Math.max(0, 1 - cacheRead), total: 1 + 2 + 1 + cacheRead + cacheWrite },
    error: null, hasInput: false, hasOutput: false, hasRaw: false,
    inputSummary: null, outputSummary: null,
  };
}

const base: Omit<TraceRecord, 'events'> = {
  session: {
    id: 's1', provider: 'opencode', sourceAgent: 'OpenCode', title: '', startedAt: 'x',
    updatedAt: 'x', status: 'success', cwd: null, messageCount: 0, eventCount: 2,
    tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 0 },
    costUsd: 0, systemPrompt: null, dataSource: 'scan', sourcePath: '/tmp/x', totalDurationMs: 0,
    isSubagent: false,
  },
  tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
  turnKeySource: 'unavailable',
};

describe('REQ-007 token 分解', () => {
  it('#4/#8 按 tokenSemantics 聚合：cacheRead 增量求和，total 含 cacheWrite', () => {
    const record: TraceRecord = { ...base, events: [ev('a', 10, 2), ev('b', 30, 3)] };
    const breakdown = computeTokenBreakdown(record);
    expect(breakdown.cacheRead).toBe(40); // #4：OpenCode 系实测为增量 → sum
    expect(breakdown.input).toBe(2);
    expect(breakdown.output).toBe(4);
    expect(breakdown.reasoning).toBe(2);
    expect(breakdown.cacheWrite).toBe(5);
    // #8：total = input + output + reasoning + cacheRead + cacheWrite
    expect(breakdown.total).toBe(2 + 4 + 2 + 40 + 5);
  });

  it('#6 reasoningInTotal=false 时 total 不含 reasoning（CodeArts/DeepSeek）', () => {
    const record: TraceRecord = {
      ...base,
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental', reasoningInTotal: false },
      events: [ev('a', 10, 2)],
    };
    const breakdown = computeTokenBreakdown(record);
    expect(breakdown.reasoning).toBe(1);
    expect(breakdown.total).toBe(1 + 2 + 10 + 2); // reasoning 1 不计入 total
  });

  it('extractTokenText 可读文本', () => {
    expect(extractTokenText({ input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, netInput: 0, total: 10 })).toContain('total 10');
    expect(extractTokenText(null)).toBe('tokens: n/a');
  });

  it('#19 extractTokenTexts 从事件正文/raw 提取 system/input/output/reasoning', () => {
    const record: TraceRecord = {
      ...base,
      session: { ...base.session, systemPrompt: 'SYSTEM PROMPT' },
      events: [
        {
          ...ev('u', 0),
          kind: 'user_prompt',
          hasInput: true,
          inputSummary: '用户问题',
          outputSummary: null,
        },
        {
          ...ev('l1', 0),
          kind: 'llm',
          hasOutput: true,
          outputSummary: '助手回答',
          raw: JSON.stringify({ type: 'reasoning', text: '先思考' }),
        } as unknown as TraceEvent,
        {
          ...ev('l2', 0),
          kind: 'llm',
          outputSummary: null,
          raw: JSON.stringify({ type: 'llm', reasoningContent: '再推理' }),
        } as unknown as TraceEvent,
        {
          ...ev('s', 0),
          kind: 'system',
          outputSummary: '系统正文',
        } as unknown as TraceEvent,
      ],
    };
    const texts = extractTokenTexts(record);
    expect(texts.system).toBe('SYSTEM PROMPT');
    expect(texts.input).toBe('用户问题');
    expect(texts.output).toBe('助手回答');
    expect(texts.reasoning).toContain('先思考');
    expect(texts.reasoning).toContain('再推理');
  });
});
