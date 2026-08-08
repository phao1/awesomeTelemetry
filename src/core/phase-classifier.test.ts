import { describe, expect, it } from 'vitest';

import type { TraceEvent } from './trace-types.js';
import { classifyBashCommand, classifyEvents } from './phase-classifier.js';

function ev(over: Partial<TraceEvent> & { id: string }): TraceEvent {
  const { id, ...rest } = over;
  return {
    id,
    sessionId: 's1',
    sequence: 1,
    // fix-adapter-turn-semantics 5.5：事件契约新增必填 turnKey（null 合法）。
    turnKey: null,
    kind: 'llm',
    phase: 'understand',
    title: '',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 0,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
    ...rest,
  };
}

describe('REQ-003 bash 命令分类', () => {
  it('测试命令 → verify', () => {
    expect(classifyBashCommand('npm test -- --run')).toBe('verify');
    expect(classifyBashCommand('cargo test -p x')).toBe('verify');
    expect(classifyBashCommand('npx eslint src')).toBe('verify'); // eslint 命中
  });
  it('提交/推送 → report', () => {
    expect(classifyBashCommand('git commit -m "x"')).toBe('report');
    expect(classifyBashCommand('gh pr create')).toBe('report');
  });
  it('查看类 → understand', () => {
    expect(classifyBashCommand('cat foo.ts')).toBe('understand');
    expect(classifyBashCommand('grep -r x .')).toBe('understand');
  });
  it('修改类 → implement', () => {
    expect(classifyBashCommand('mkdir -p src')).toBe('implement');
    expect(classifyBashCommand('git add .')).toBe('implement');
  });
});

describe('REQ-001 两遍分类', () => {
  it('bash 测试命令 → verify', () => {
    const events = classifyEvents([ev({ id: 'e1', kind: 'bash', title: 'npm test' })]);
    expect(events[0]?.phase).toBe('verify');
  });

  it('错误后写文件 → debug', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'bash', title: 'npm run build', status: 'error' }),
      ev({ id: 'e2', kind: 'file_write', title: 'edit src/x.ts' }),
    ]);
    expect(events[1]?.phase).toBe('debug');
  });

  it('propagate 继承最近 explicit；前后等距时 LLM 偏前、message 偏后', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'bash', title: 'cat a.ts' }),          // understand
      ev({ id: 'e2', kind: 'llm', title: 'thinking' }),            // 等距前 1 / 后 1 → LLM 偏前
      ev({ id: 'e3', kind: 'file_write', title: 'write b.ts' }),   // implement
      ev({ id: 'e4', kind: 'message', title: 'done' }),            // 前后等距 → message 偏后
    ]);
    expect(events[1]?.phase).toBe('understand');
    expect(events[3]?.phase).toBe('implement');
  });

  it('无 explicit 时用 kind 默认值', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'user_prompt', title: 'hello' }),
      ev({ id: 'e2', kind: 'system', title: 'meta' }),
    ]);
    expect(events[0]?.phase).toBe('understand');
    expect(events[1]?.phase).toBe('understand');
  });

  it('tool 走 ACTION_PHASE 表', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'tool', tool: 'Grep', title: 'grep' }),
      ev({ id: 'e2', kind: 'tool', tool: 'Write', title: 'write' }),
      ev({ id: 'e3', kind: 'tool', tool: 'TodoWrite', title: 'todo' }),
    ]);
    expect(events[0]?.phase).toBe('understand');
    expect(events[1]?.phase).toBe('implement');
    expect(events[2]?.phase).toBe('plan');
  });

  /**
   * 真实数据里 npm test 一律通过 Claude 的 `Bash` / Codex 的 `exec_command` 发出，
   * 命令在 inputSummary。此前只查工具名 → 全部落到 implement，
   * 全库 33,046 个事件里 verify 阶段一个都没有，「准 / 验证覆盖」恒为 0。
   */
  it('跑 shell 的工具按命令内容判定，而不是工具名', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'tool', tool: 'Bash', title: 'Bash', inputSummary: 'npm test' }),
      ev({ id: 'e2', kind: 'tool', tool: 'exec_command', title: 'exec_command', inputSummary: 'npm run test -- foo' }),
      ev({ id: 'e3', kind: 'tool', tool: 'Bash', title: 'Bash', inputSummary: 'git commit -m x' }),
      ev({ id: 'e4', kind: 'tool', tool: 'exec_command', title: 'exec_command', inputSummary: 'rg TODO src' }),
      ev({ id: 'e5', kind: 'tool', tool: 'Bash', title: 'Bash', inputSummary: 'mkdir dist' }),
      ev({ id: 'e6', kind: 'tool', tool: 'Bash', title: 'Bash', inputSummary: 'node scripts/x.mjs' }),
    ]);
    expect(events.map((e) => e.phase)).toEqual([
      'verify', 'verify', 'report', 'understand', 'implement', 'implement',
    ]);
  });

  it('计划类工具归入 plan（update_plan / TaskCreate）', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'tool', tool: 'update_plan', title: 'update_plan' }),
      ev({ id: 'e2', kind: 'tool', tool: 'TaskCreate', title: 'TaskCreate' }),
    ]);
    expect(events.map((e) => e.phase)).toEqual(['plan', 'plan']);
  });

  /**
   * fix-adapter-turn-semantics A8：compact 是上下文恢复，直接归 understand
   * （explicit，不是未知类型兜底）。
   */
  it('compact → understand', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'compact', title: 'context_compacted', turnKey: 'c1' }),
      ev({ id: 'e2', kind: 'llm', title: 'reply', turnKey: 'c1' }),
    ]);
    expect(events[0]?.phase).toBe('understand');
  });

  /**
   * fix-adapter-turn-semantics A8：reasoning 不是独立活动，继承同一决策周期
   * （turnKey）内 llm 事件的阶段——即使两遍传播会给它一个不同的最近 explicit。
   * 本用例里两遍传播会把 reasoning 判成 verify（前邻），但周期 llm 是 implement，
   * Pass 3 必须把 reasoning 拉回 implement。
   */
  it('reasoning 继承同周期 llm 的阶段（turnKey 分组），不引入自己的阶段', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'tool', tool: 'Bash', title: 'npm test', inputSummary: 'npm test', turnKey: 'a' }),
      ev({ id: 'e2', kind: 'reasoning', title: 'think', turnKey: 'b' }),
      ev({ id: 'e3', kind: 'llm', title: 'assistant msg', turnKey: 'b' }),
      ev({ id: 'e4', kind: 'file_write', tool: 'Write', title: 'write b.ts', turnKey: 'b' }),
    ]);
    // e2 与 e3 同周期（turnKey b）：reasoning 必须与 llm 同为 implement。
    expect(events[1]?.phase).toBe('implement');
    expect(events[2]?.phase).toBe('implement');
  });

  /** A8 兜底：turnKey 为 null（源无边界信号）或周期内无 llm 时，保留两遍传播结果。 */
  it('reasoning 无同周期 llm 时保留两遍传播结果', () => {
    const events = classifyEvents([
      ev({ id: 'e1', kind: 'tool', tool: 'Grep', title: 'grep', turnKey: null }),
      ev({ id: 'e2', kind: 'reasoning', title: 'think', turnKey: null }),
      ev({ id: 'e3', kind: 'tool', tool: 'Write', title: 'write', turnKey: null }),
    ]);
    // 等距前后 explicit → reasoning 偏后（agent/message 分支之外的 kind 同样偏后）
    expect(events[1]?.phase).toBe('implement');
  });
});
