import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { SpeedMetrics } from '../core/trace-types.js';
import { CompareSpeedMetrics } from './CompareSpeedMetrics.js';
import { makeEvent } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      root.unmount();
    },
    html: () => container.innerHTML,
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

/** 真实 API 形状：无 token/llm 事件的会话 tps/tpot/turnGap/pureInference 为 null。 */
const NULL_SPEED: SpeedMetrics = {
  ttftMs: null,
  tps: null,
  tpotMs: null,
  e2eMs: 5000,
  turnGapMedianMs: null,
  pureInferenceMs: null,
  avgLlmResponseLatencyMs: null,
  avgLlmDurationMs: null,
  cacheHitRate: null,
  avgTokensPerCall: null,
  systemPromptTokensEstimate: null,
};

const FULL_SPEED: SpeedMetrics = {
  ttftMs: 120,
  tps: 45.5,
  tpotMs: 22.2,
  e2eMs: 3000,
  turnGapMedianMs: 800,
  pureInferenceMs: 2500,
  avgLlmResponseLatencyMs: 200,
  avgLlmDurationMs: 900,
  cacheHitRate: 0.5,
  avgTokensPerCall: 100,
  systemPromptTokensEstimate: 200,
};

describe('CompareSpeedMetrics（建议 2）', () => {
  it('六指标全部渲染，字段名映射正确（tpotMs/turnGapMedianMs/pureInferenceMs）', () => {
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{ left: FULL_SPEED, right: { ...FULL_SPEED, e2eMs: 6000, tps: 30 } }}
        locale="zh"
      />,
    );
    const out = html();
    expect(out).toContain('端到端耗时');
    expect(out).toContain('TTFT · 首字延迟');
    expect(out).toContain('TPS · 每秒 token');
    expect(out).toContain('TPOT · 每 token 延迟');
    expect(out).toContain('轮次间隔中位数');
    expect(out).toContain('纯推理时间');
    expect(out).toContain('22.2ms'); // TPOT 值来自 tpotMs
    expect(out).toContain('0.8s'); // turnGapMedianMs → fmtDur
    unmount();
  });

  it('null/undefined 指标渲染 —，不崩溃（真实 API 形状回归）', () => {
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{
          left: NULL_SPEED,
          right: NULL_SPEED,
        }}
        locale="zh"
      />,
    );
    const out = html();
    expect(out).not.toContain('NaN');
    expect(out).toContain('—');
    unmount();
  });

  it('undefined 字段（字段名拼错防御）也不崩溃', () => {
    const partial = { e2eMs: 1000 } as SpeedMetrics;
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{ left: partial, right: partial }}
        locale="zh"
      />,
    );
    expect(html()).toContain('—');
    unmount();
  });

  it('Token 堆叠条段点击打开 TokenTextModal（REQ-101）', () => {
    const session = {
      id: 'left',
      provider: 'codex' as const,
      sourceAgent: 'Codex',
      title: 'session left',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
      status: 'success' as const,
      cwd: '/tmp',
      messageCount: 3,
      eventCount: 5,
      tokenUsage: {
        input: 100,
        output: 50,
        reasoning: 20,
        cacheRead: 30,
        cacheWrite: 10,
        netInput: 130,
        total: 210,
      },
      costUsd: 0.02,
      systemPrompt: 'You are a coding assistant',
      dataSource: 'scan' as const,
      sourcePath: '/tmp/left.jsonl',
      totalDurationMs: 5000,
      isSubagent: false,
    };
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{ left: FULL_SPEED, right: FULL_SPEED }}
        locale="zh"
        sessions={{ left: session, right: session }}
      />,
    );
    const seg = document.querySelector<HTMLButtonElement>('.token-stack-seg[aria-label="L output"]');
    expect(seg).toBeDefined();
    act(() => {
      seg!.click();
    });
    expect(html()).toContain('Token 文本');
    unmount();
  });

  it('10 卡：6 核心 + 4 辅助（REQ-102）', () => {
    const session = {
      id: 'left',
      provider: 'codex' as const,
      sourceAgent: 'Codex',
      title: 'session left',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
      status: 'success' as const,
      cwd: '/tmp',
      messageCount: 3,
      eventCount: 5,
      tokenUsage: {
        input: 100,
        output: 50,
        reasoning: 20,
        cacheRead: 30,
        cacheWrite: 10,
        netInput: 130,
        total: 210,
      },
      costUsd: 0.02,
      systemPrompt: 'You are a coding assistant',
      dataSource: 'scan' as const,
      sourcePath: '/tmp/left.jsonl',
      totalDurationMs: 5000,
      isSubagent: false,
    };
    const event = (id: string, kind: 'llm' | 'tool', tool: string | null): ReturnType<typeof makeEvent> =>
      makeEvent({ id, kind, tool, durationMs: 500 });
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{ left: FULL_SPEED, right: FULL_SPEED }}
        locale="zh"
        sessions={{ left: session, right: session }}
        events={{
          left: [event('l1', 'llm', null), event('l2', 'tool', 'Bash')],
          right: [event('r1', 'llm', null)],
        }}
      />,
    );
    const out = html();
    // 核心 6
    expect(out).toContain('端到端耗时');
    expect(out).toContain('TTFT · 首字延迟');
    expect(out).toContain('TPS · 每秒 token');
    expect(out).toContain('TPOT · 每 token 延迟');
    expect(out).toContain('轮次间隔中位数');
    expect(out).toContain('纯推理时间');
    // 辅助 4
    expect(out).toContain('LLM 调用数');
    expect(out).toContain('LLM 平均耗时');
    expect(out).toContain('工具总耗时');
    expect(out).toContain('缓存命中率');
    expect(document.querySelectorAll('.compare-speed-card').length).toBe(6);
    expect(document.querySelectorAll('.compare-speed-aux-card').length).toBe(4);
    unmount();
  });

  it('TTFT > 5000ms 显示启动开销警告条（REQ-102）', () => {
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{ left: { ...FULL_SPEED, ttftMs: 6200 }, right: { ...FULL_SPEED, ttftMs: 80 } }}
        locale="zh"
      />,
    );
    expect(html()).toContain('启动开销：6.2s');
    expect(html()).toContain('compare-speed-warn');
    unmount();
  });

  it('辅助指标 null 显示 —，MUST NOT 显示 0（REQ-102）', () => {
    const nullSpeed: SpeedMetrics = {
      ...NULL_SPEED,
      avgLlmDurationMs: null,
      cacheHitRate: null,
    };
    const { html, unmount } = mount(
      <CompareSpeedMetrics
        speed={{ left: nullSpeed, right: nullSpeed }}
        locale="zh"
      />,
    );
    const out = html();
    expect(out).not.toContain('0%');
    expect(out).not.toContain('0.0ms');
    expect(document.querySelectorAll('.compare-speed-aux-value .compare-side-mark').length).toBe(8);
    unmount();
  });
});
