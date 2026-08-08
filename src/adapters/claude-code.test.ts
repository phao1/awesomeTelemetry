import { describe, expect, it } from 'vitest';

import { computeMetrics } from '../core/metrics.js';
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
    // 源数据无 model → primaryModel 为 null，事件 model 为 null（不猜）
    expect(r.session.primaryModel).toBeNull();
    expect(r.events.every((e) => e.model === null || e.model === undefined)).toBe(true);
    expect(r.session.tokenUsage).toEqual({
      input: 150, output: 50, reasoning: 0, cacheRead: 15, cacheWrite: 2, netInput: 135, total: 217, // #8：total 含 cacheWrite
    });
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'llm', 'tool', 'llm']);
    expect(r.tokenSemantics).toEqual({ cacheRead: 'incremental', reasoning: 'incremental' });
    // fix-adapter-turn-semantics A5：按 assistant message.id 分组 → message_identity。
    expect(r.turnKeySource).toBe('message_identity');
    // A4：user prompt 携带其后 assistant 的 id；tool_use 与回填的 tool_result 继承同 key。
    expect(r.events.map((e) => e.turnKey)).toEqual(['msg-a1', 'msg-a1', 'msg-a1', 'msg-a2']);
    // A7：toolu-1 的 tool 事件拿到结果输出，不再有 user_prompt。
    const tool = r.events.find((e) => e.kind === 'tool')!;
    expect(tool.hasOutput).toBe(true);
    expect(tool.outputSummary).toBe('parse.ts:42 — missing null check');
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

  it('P0-A：fixture 推导时长后 avgToolDurationMs > 0', () => {
    const r = normalizeClaudeSample(sample(claudeFixture.events), SRC);
    // fixture 时间戳间隔 5s：非 user_prompt 事件全部被推导出时长
    const tool = r.events.find((e) => e.kind === 'tool')!;
    expect(tool.durationMs).toBeGreaterThan(0);
    const metrics = computeMetrics(r);
    expect(metrics.avgToolDurationMs).toBeGreaterThan(0);
    expect(r.session.durationSource).toBe('derived');
  });

  it('P0-B：读取 message.model 写入 llm 事件，主模型按 token 占比选出', () => {
    const rows: ClaudeRawRow[] = [
      {
        type: 'assistant',
        message: {
          id: 'a1',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'x' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'a2',
          model: 'claude-haiku-4-5',
          content: [{ type: 'text', text: 'y' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
    ];
    const r = normalizeClaudeSample(sample(rows), SRC);
    const models = r.events.filter((e) => e.kind === 'llm').map((e) => e.model);
    expect(models).toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
    expect(r.session.primaryModel).toBe('claude-opus-4-8');
  });

  it('P0-C：未知模型 costSource 为 unknown（不渲染 $0.0000）', () => {
    const rows: ClaudeRawRow[] = [
      {
        type: 'assistant',
        message: {
          id: 'a1',
          model: 'glm-4-plus',
          content: [{ type: 'text', text: 'x' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
    ];
    const r = normalizeClaudeSample(sample(rows), SRC);
    expect(r.session.costSource).toBe('unknown');
    expect(r.session.costUsd).toBe(0);
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

  describe('fix-adapter-turn-semantics §3（tool_result 是结果，不是 user message）', () => {
    function toolResultRow(toolUseId: string, text = 'output', isError = false): ClaudeRawRow {
      return {
        type: 'user',
        sessionId: 'claude-s1',
        timestamp: '2026-08-01T00:00:07.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: [{ type: 'text', text }],
              is_error: isError,
            },
          ],
        },
      };
    }

    it('3.1/3.4：tool_result 行不产生 user_prompt；genuine user 行仍产生', () => {
      const rows: ClaudeRawRow[] = [
        {
          type: 'user',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:00.000Z',
          message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
        },
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:01.000Z',
          message: { id: 'a1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu-1', name: 'Bash', input: {} }] },
        },
        toolResultRow('toolu-1'),
      ];
      const r = normalizeClaudeSample(sample(rows), SRC);
      expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'tool']);
      expect(r.events[0]!.kind).toBe('user_prompt'); // genuine prompt 照常
      expect(r.session.messageCount).toBe(2); // tool_result 行不计入消息
    });

    it('3.2：结果按 tool_use_id 回填到 tool 事件，hasOutput=true，继承同 key', () => {
      const rows: ClaudeRawRow[] = [
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:01.000Z',
          message: { id: 'a1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu-1', name: 'Bash', input: {} }] },
        },
        toolResultRow('toolu-1', 'ls output'),
      ];
      const r = normalizeClaudeSample(sample(rows), SRC);
      expect(r.events).toHaveLength(1);
      const tool = r.events[0]!;
      expect(tool.kind).toBe('tool');
      expect(tool.hasOutput).toBe(true);
      expect(tool.outputSummary).toBe('ls output');
      expect(tool.turnKey).toBe('a1');
    });

    it('3.3：无匹配 tool_use 的 tool_result → 只带结果侧的 tool 事件，不丢弃、不转 user message', () => {
      const r = normalizeClaudeSample(sample([toolResultRow('toolu-missing', 'orphan output')]), SRC);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('tool');
      expect(r.events[0]!.outputSummary).toBe('orphan output');
      expect(r.events[0]!.tool).toBeNull();
      expect(r.events[0]!.status).toBe('success');
      expect(r.events[0]!.turnKey).toBeNull();
      expect(r.session.messageCount).toBe(0);
    });

    it('3.3：is_error 的 tool_result → status error', () => {
      const r = normalizeClaudeSample(sample([toolResultRow('toolu-missing', 'exit 1', true)]), SRC);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('tool');
      expect(r.events[0]!.status).toBe('error');
    });

    it('3.5：turn-key 分组 —— 一条 assistant 消息的两个 tool_use 与结果同 key，下一条消息不同 key', () => {
      const rows: ClaudeRawRow[] = [
        {
          type: 'user',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:00.000Z',
          message: { id: 'msg-u1', role: 'user', content: [{ type: 'text', text: 'do it' }] },
        },
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:01.000Z',
          message: {
            id: 'msg-a1',
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'toolu-1', name: 'Read', input: {} },
              { type: 'tool_use', id: 'toolu-2', name: 'Bash', input: {} },
            ],
          },
        },
        { ...toolResultRow('toolu-1', 'r1'), ...{ timestamp: '2026-08-01T00:00:04.000Z' } },
        { ...toolResultRow('toolu-2', 'r2'), ...{ timestamp: '2026-08-01T00:00:05.000Z' } },
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:10.000Z',
          message: { id: 'msg-a2', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        },
      ];
      const r = normalizeClaudeSample(sample(rows), SRC);
      expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'tool', 'tool', 'llm']);
      // user_prompt 也携带其后 assistant 消息的 key（A4 前瞻），故同 key 集合含它。
      expect(r.events.filter((e) => e.turnKey === 'msg-a1').map((e) => e.kind)).toEqual([
        'user_prompt', 'tool', 'tool',
      ]);
      const a1 = r.events.filter((e) => e.kind === 'tool');
      expect(a1.map((e) => e.kind)).toEqual(['tool', 'tool']);
      expect(a1.every((e) => e.hasOutput && e.outputSummary !== null)).toBe(true);
      expect(r.events.find((e) => e.kind === 'user_prompt')!.turnKey).toBe('msg-a1');
      expect(r.events.find((e) => e.kind === 'llm')!.turnKey).toBe('msg-a2');
    });

    it('3.7：同时间戳的三 part 保持源顺序（A11 稳定排序）', () => {
      const rows: ClaudeRawRow[] = [
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:05.000Z',
          message: {
            id: 'msg-a1',
            role: 'assistant',
            content: [
              { type: 'text', text: 'first' },
              { type: 'tool_use', id: 'toolu-1', name: 'Read', input: {} },
              { type: 'text', text: 'last' },
            ],
          },
        },
      ];
      const r = normalizeClaudeSample(sample(rows), SRC);
      expect(r.events.map((e) => e.kind)).toEqual(['llm', 'tool', 'llm']);
      expect(r.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
      expect(r.events.map((e) => e.outputSummary ?? e.tool)).toEqual(['first', 'Read', 'last']);
      expect(r.events.every((e) => e.turnKey === 'msg-a1')).toBe(true);
    });

    it('3.9 回归：live 的 llm > tool > user_prompt > tool > user_prompt 模式不再出现', () => {
      const rows: ClaudeRawRow[] = [
        {
          type: 'user',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:00.000Z',
          message: { id: 'msg-u1', role: 'user', content: [{ type: 'text', text: 'task' }] },
        },
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:05.000Z',
          message: {
            id: 'msg-a1',
            role: 'assistant',
            content: [
              { type: 'text', text: 'step 1' },
              { type: 'tool_use', id: 'toolu-1', name: 'Bash', input: {} },
            ],
          },
        },
        toolResultRow('toolu-1', 'result-1'),
        {
          type: 'assistant',
          sessionId: 'claude-s1',
          timestamp: '2026-08-01T00:00:10.000Z',
          message: {
            id: 'msg-a2',
            role: 'assistant',
            content: [
              { type: 'text', text: 'step 2' },
              { type: 'tool_use', id: 'toolu-2', name: 'Bash', input: {} },
            ],
          },
        },
        { ...toolResultRow('toolu-2', 'result-2'), ...{ timestamp: '2026-08-01T00:00:12.000Z' } },
      ];
      const r = normalizeClaudeSample(sample(rows), SRC);
      const kinds = r.events.map((e) => e.kind);
      expect(kinds).toEqual(['user_prompt', 'llm', 'tool', 'llm', 'tool']);
      expect(kinds.filter((k) => k === 'user_prompt')).toHaveLength(1);
      expect(r.events.filter((e) => e.kind === 'tool').every((e) => e.hasOutput)).toBe(true);
      // turn-key 分组与 sequence 顺序一致：同 key 的事件 sequence 连续。
      const turns = new Map<string, number[]>();
      for (const e of r.events) {
        turns.set(e.turnKey ?? '', [...(turns.get(e.turnKey ?? '') ?? []), e.sequence]);
      }
      for (const seqs of turns.values()) {
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      }
      expect(turns.get('msg-a1')).toEqual([1, 2, 3]);
      expect(turns.get('msg-a2')).toEqual([4, 5]);
    });
  });
});
