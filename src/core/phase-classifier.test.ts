import { describe, expect, it } from 'vitest';

import type { TraceEvent } from './trace-types.js';
import { classifyBashCommand, classifyEvents } from './phase-classifier.js';

function ev(over: Partial<TraceEvent> & { id: string }): TraceEvent {
  const { id, ...rest } = over;
  return {
    id,
    sessionId: 's1',
    sequence: 1,
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
});
