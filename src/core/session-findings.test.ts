import { beforeEach, describe, expect, it } from 'vitest';

import type { TraceEventSlim, TraceSession } from './trace-types.js';
import { computeFindings } from './session-findings.js';

const SESSION: TraceSession = {
  id: 's1',
  provider: 'codex',
  sourceAgent: 'Codex',
  title: 't',
  startedAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:10:00.000Z',
  status: 'success',
  cwd: '/tmp',
  messageCount: 1,
  eventCount: 0,
  tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 0 },
  costUsd: 0,
  systemPrompt: null,
  dataSource: 'scan',
  sourcePath: '~/.codex/x.jsonl',
  totalDurationMs: 0,
  isSubagent: false,
};

let seq = 0;
beforeEach(() => {
  seq = 0;
});

function ev(partial: Partial<TraceEventSlim>): TraceEventSlim {
  seq += 1;
  const index = seq;
  return {
    id: `e${index}`,
    sessionId: 's1',
    sequence: index,
    kind: 'llm',
    phase: 'implement',
    title: '',
    startedAt: `2026-08-01T00:00:0${Math.floor(index / 10)}.${String(index % 10).padStart(2, '0')}Z`,
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...partial,
  };
}

function kinds(result: { findings: Array<{ kind: string }> }): string[] {
  return result.findings.map((f) => f.kind);
}

describe('computeFindings 十条规则', () => {
  it('回归（add-mission-control 1.6）：推导时长输入不产生 NaN，idleHigh/ttft 仍按规则触发', () => {
    // claude/codex 推导时长后的典型输入：user_prompt 无时长，后续为相邻时间戳推导值
    const events = [
      ev({ startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0, kind: 'user_prompt', actor: 'user' }),
      ev({ startedAt: '2026-08-01T00:00:10.000Z', durationMs: 5000, kind: 'llm' }),
      ev({ startedAt: '2026-08-01T00:00:20.000Z', durationMs: 2000, kind: 'bash', tool: 'Bash', status: 'error' }),
      ev({ startedAt: '2026-08-01T00:00:23.000Z', durationMs: 1000, kind: 'llm' }),
    ];
    const result = computeFindings(SESSION, events);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(Number.isFinite(f.evidence.metric?.value ?? 0)).toBe(true);
    }
    expect(kinds(result)).toContain('idleHigh'); // 大段空转仍被识别
    expect(kinds(result)).toContain('ttft'); // 首个 user_prompt → llm 10s > 5s
  });

  it('规则 1：单阶段 > 50% 时长', () => {
    const events = [
      ev({ phase: 'debug', durationMs: 6000 }),
      ev({ phase: 'debug', durationMs: 2000 }),
      ev({ phase: 'implement', durationMs: 2000 }),
    ];
    const result = computeFindings(SESSION, events);
    const rule = result.findings.find((f) => f.kind === 'phaseDominant');
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('warning');
    expect(rule!.data.pct).toBe('80');
    expect(rule!.evidence.phase).toBe('debug');
  });

  it('规则 2：超长单事件 > 20%', () => {
    const events = [
      ev({ durationMs: 8000, title: 'npm test' }),
      ev({ durationMs: 1000 }),
      ev({ durationMs: 1000 }),
    ];
    const result = computeFindings(SESSION, events);
    const rule = result.findings.find((f) => f.kind === 'longEvent');
    expect(rule).toBeDefined();
    expect(rule!.evidence.eventIds).toContain('e1');
    expect(rule!.data.durMs).toBe(8000);
  });

  it('规则 3：修复循环 ≥2 轮', () => {
    const events = [
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'bash', title: 'npm test', tool: 'bash', status: 'error' }),
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'bash', title: 'npm test', tool: 'bash', status: 'error' }),
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
    ];
    const result = computeFindings(SESSION, events);
    const rule = result.findings.find((f) => f.kind === 'repairLoop');
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('critical');
    expect(rule!.data.rounds).toBe(2);
  });

  it('规则 4：盲写文件', () => {
    const events = [
      ev({ kind: 'file_write', title: 'Edit src/auth/jwt.ts', tool: 'edit' }),
      ev({ kind: 'file_write', title: 'Edit src/utils/x.ts', tool: 'edit' }),
    ];
    const result = computeFindings(SESSION, events);
    const rule = result.findings.find((f) => f.kind === 'blindWrite');
    expect(rule).toBeDefined();
    expect(rule!.data.count).toBe(2);
  });

  it('规则 4 不误报：先读后写', () => {
    const events = [
      ev({ kind: 'file_read', title: 'src/auth/jwt.ts', tool: 'read' }),
      ev({ kind: 'file_write', title: 'Edit src/auth/jwt.ts', tool: 'edit' }),
    ];
    expect(kinds(computeFindings(SESSION, events))).not.toContain('blindWrite');
  });

  it('规则 5：无验证收尾', () => {
    const events = [ev({}), ev({})];
    expect(kinds(computeFindings(SESSION, events))).toContain('noVerify');
    const withVerify = [ev({}), ev({ phase: 'verify' })];
    expect(kinds(computeFindings(SESSION, withVerify))).not.toContain('noVerify');
  });

  it('规则 6：工具失败率高', () => {
    const events = [
      ev({ kind: 'bash', tool: 'bash', status: 'error' }),
      ev({ kind: 'bash', tool: 'bash', status: 'error' }),
      ev({ kind: 'bash', tool: 'bash', status: 'success' }),
    ];
    const result = computeFindings(SESSION, events);
    expect(result.findings.some((f) => f.id === 'rule-6-bash')).toBe(true);
  });

  it('规则 7：系统提示词重复占比', () => {
    const events = [
      ev({ kind: 'llm', tokens: { input: 1000, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1000, total: 1010 } }),
      ev({ kind: 'llm', tokens: { input: 500, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 500, total: 510 } }),
      ev({ kind: 'llm', tokens: { input: 500, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 500, total: 510 } }),
    ];
    const result = computeFindings(SESSION, events);
    expect(kinds(result)).toContain('sysPromptRepeat');
  });

  it('规则 9：首 Token 慢', () => {
    const events = [
      ev({ kind: 'user_prompt', actor: 'user', startedAt: '2026-08-01T00:00:00.000Z' }),
      ev({ kind: 'llm', durationMs: 6000, startedAt: '2026-08-01T00:00:06.000Z' }),
    ];
    expect(kinds(computeFindings(SESSION, events))).toContain('ttft');
  });

  it('规则 10：用户介入 ≥4 次', () => {
    const events = [
      ev({ kind: 'user_prompt', actor: 'user' }),
      ev({ kind: 'user_prompt', actor: 'user' }),
      ev({ kind: 'user_prompt', actor: 'user' }),
      ev({ kind: 'user_prompt', actor: 'user' }),
    ];
    expect(kinds(computeFindings(SESSION, events))).toContain('manyInterventions');
  });

  it('无异常时 passed = 10', () => {
    const result = computeFindings(SESSION, []);
    expect(result.findings).toHaveLength(0);
    expect(result.passed).toBe(10);
  });
});
