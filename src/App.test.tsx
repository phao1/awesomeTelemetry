import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from './core/trace-types.js';
import type { SessionDetailResponse, TraceEventSlim, TraceSession } from './core/trace-types.js';
import App from './App.js';

function session(id: string, provider: 'codex' | 'claude', title: string): SessionIndexEntry {
  return {
    id,
    provider,
    sourceAgent: provider,
    title,
    startedAt: `2026-08-0${id.slice(-1)}T00:00:00.000Z`,
    updatedAt: `2026-08-0${id.slice(-1)}T00:01:00.000Z`,
    status: 'success',
    cwd: '/tmp',
    eventCount: 10,
    messageCount: 3,
    tokenTotal: 100,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  };
}

const THREE_SESSIONS = [
  session('s-1', 'codex', 'fix build'),
  session('s-2', 'claude', 'refactor api'),
  session('s-3', 'codex', 'debug login'),
];

/** jsdom 无 EventSource：补最小桩（SSE 订阅能力，不 mock 被测逻辑）。 */
class EventSourceStub {
  static readonly instances: EventSourceStub[] = [];
  readonly onopen: (() => void) | null = null;
  readonly onerror: (() => void) | null = null;
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();

  constructor(_url: string) {
    EventSourceStub.instances.push(this);
  }

  addEventListener(type: string, cb: (event: { data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }

  close(): void {
    // noop
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

function renderApp(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(<App />);
  });
  return container;
}

beforeEach(() => {
  EventSourceStub.instances.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 }),
  })));
  vi.stubGlobal('EventSource', EventSourceStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('REQ-015 共享会话 store（G7.6）', () => {
  it('1.1 启动后直接切 compare：两个选择器各含全部 3 个会话', async () => {
    const container = renderApp();
    await act(async () => {
      // 会话列表首帧拉取带 250ms 防抖（服务端过滤），等它完成
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const compareTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('对比'),
    );
    expect(compareTab).toBeDefined();
    act(() => compareTab!.click());

    // REQ-019：MUST NOT 用原生 select（7.1）——选择器是 Popover 搜索按钮
    expect(container.querySelectorAll('select')).toHaveLength(0);
    const pickers = Array.from(container.querySelectorAll('.compare-picker'));
    expect(pickers).toHaveLength(2);
    act(() => (pickers[0] as HTMLButtonElement).click());
    const items = Array.from(container.querySelectorAll('.compare-picker-item'));
    expect(items.length).toBe(3);
    const titles = items.map((el) => el.textContent ?? '');
    expect(titles.some((t) => t.includes('fix build'))).toBe(true);
    expect(titles.some((t) => t.includes('refactor api'))).toBe(true);
    expect(titles.some((t) => t.includes('debug login'))).toBe(true);
  });

  it('REQ-023：/api/health 只请求一次，不轮询', async () => {
    const container = renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const fetchMock = vi.mocked(fetch);
    const healthCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/health'),
    );
    expect(healthCalls).toHaveLength(1);
    container.remove();
  });

  it('会话视图 IA：粘性工具条 + findings 折叠 + 时间线主画布（含双模式）', async () => {
    const sessionDetail: SessionDetailResponse = {
      session: {
        id: 's-1',
        provider: 'codex',
        sourceAgent: 'Codex',
        title: 'fix build',
        startedAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:01:00.000Z',
        status: 'success',
        cwd: '/tmp',
        messageCount: 2,
        eventCount: 2,
        tokenUsage: {
          input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, netInput: 7, total: 38,
        },
        costUsd: 0.01,
        systemPrompt: null,
        dataSource: 'scan',
        sourcePath: '/tmp/s-1.jsonl',
        totalDurationMs: 1000,
        isSubagent: false,
      } satisfies TraceSession,
      events: [
        {
          id: 'e1', sessionId: 's-1', sequence: 1, kind: 'llm', phase: 'implement',
          title: 'step one', startedAt: '2026-08-05T00:00:00.000Z', durationMs: 100,
          status: 'success', actor: 'assistant', tool: null, tokens: null, error: null,
          hasInput: true, hasOutput: false, hasRaw: false,
        },
        {
          id: 'e2', sessionId: 's-1', sequence: 2, kind: 'llm', phase: 'debug',
          title: 'step two', startedAt: '2026-08-05T00:00:05.000Z', durationMs: 50,
          status: 'error', actor: 'assistant', tool: null, tokens: null, error: 'boom',
          hasInput: false, hasOutput: true, hasRaw: false,
        },
      ] satisfies TraceEventSlim[],
      mode: 'slim',
      eventTotal: 2,
      eventOffset: 0,
      eventLimit: 2,
      hasMore: false,
      pending: false,
    };
    const okJson = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      }) as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/sessions/s-1')) {
          return okJson(sessionDetail);
        }
        if (url.includes('/api/sessions?')) {
          return okJson({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 });
        }
        if (url.includes('/api/health')) {
          return okJson({ ok: true, dbSizeBytes: 1, walSizeBytes: 1 });
        }
        return okJson({});
      }),
    );

    const container = renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const rows = Array.from(container.querySelectorAll('.session-row'));
    expect(rows.length).toBe(3);
    act(() => (rows[0] as HTMLElement).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.session-toolbar')).not.toBeNull();
    expect(container.querySelector('.session-toolbar-title')?.textContent).toContain('fix build');
    expect(container.querySelector('.session-findings-panel')).not.toBeNull();
    expect(container.querySelector('.gantt-wrap')).not.toBeNull();
    expect(container.querySelector('.timeline-mode')).not.toBeNull();
    expect(container.querySelector('.timeline-phase-axis')).not.toBeNull();
    // 点击甘特阶段轴片段 → 右侧 EventInspector 出现
    const debugSeg = Array.from(container.querySelectorAll('.timeline-phase-seg')).find(
      (s) => s.getAttribute('data-phase') === 'debug',
    );
    expect(debugSeg).toBeDefined();
    act(() => (debugSeg as HTMLElement).click());
    expect(container.querySelector('.inspector')).not.toBeNull();

    sessionDetail.events.push({
      id: 'e3', sessionId: 's-1', sequence: 3, kind: 'llm', phase: 'implement',
      title: 'live update', startedAt: '2026-08-05T00:00:06.000Z', durationMs: 10,
      status: 'success', actor: 'assistant', tool: null, tokens: null, error: null,
      hasInput: false, hasOutput: true, hasRaw: false,
      inputSummary: null, outputSummary: 'live update',
    });
    sessionDetail.eventTotal = 3;
    sessionDetail.session.eventCount = 3;
    await act(async () => {
      EventSourceStub.instances.at(-1)?.emit('sessions_changed', { keys: ['s-1'], count: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('live update');
    container.remove();
  });
});

describe('Compare 端到端（UI-TASKS 2 回归）', () => {
  it('真实 API 形状（speed 含 null）：切对比 → 选左右会话 → verdict/speed/charts 渲染且不崩溃', async () => {
    const speedWithNulls = {
      ttftMs: null, tps: null, tpotMs: null, e2eMs: 5000, turnGapMedianMs: null,
      pureInferenceMs: null, avgLlmResponseLatencyMs: null, avgLlmDurationMs: null,
      cacheHitRate: null, avgTokensPerCall: null, systemPromptTokensEstimate: null,
    };
    const detail = (id: string, events: unknown[], totalDurationMs: number, title: string) => ({
      session: {
        id,
        provider: id === 's-1' ? 'codex' : 'claude',
        sourceAgent: id === 's-1' ? 'Codex' : 'Claude',
        title,
        startedAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:01:00.000Z',
        status: 'success',
        cwd: '/tmp',
        messageCount: 3,
        eventCount: events.length,
        tokenUsage: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 100, total: 150 },
        costUsd: 0.01,
        systemPrompt: null,
        dataSource: 'scan',
        sourcePath: `/tmp/${id}.jsonl`,
        totalDurationMs,
        isSubagent: false,
      },
      events,
      mode: 'slim',
      eventTotal: events.length,
      eventOffset: 0,
      eventLimit: 2000,
      hasMore: false,
      pending: false,
    });
    const slimEvent = (id: string, sessionId: string, sequence: number, over: Record<string, unknown> = {}) => ({
      id,
      sessionId,
      sequence,
      kind: 'tool',
      phase: 'implement',
      title: 'Bash: npm test',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'error',
      actor: 'assistant',
      tool: 'Bash',
      tokens: null,
      error: 'timeout',
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      ...over,
    });
    const comparePayload = {
      left: detail('s-1', [
        slimEvent('e1', 's-1', 1),
        slimEvent('e2', 's-1', 2, { kind: 'file_write', phase: 'implement', title: 'Edit src/a.ts', status: 'success', tool: null, error: null }),
        slimEvent('e3', 's-1', 3, { kind: 'test', phase: 'verify', title: 'vitest run', status: 'success', tool: null, error: null }),
      ], 5000, 'fix build'),
      right: detail('s-2', [
        slimEvent('r1', 's-2', 1, { kind: 'llm', phase: 'implement', title: 'respond', status: 'success', tool: null, error: null }),
        slimEvent('r2', 's-2', 2, { kind: 'bash', phase: 'verify', title: 'npm test', status: 'success', tool: null, error: null }),
      ], 3000, 'refactor api'),
      speed: { left: { ...speedWithNulls, e2eMs: 5000 }, right: { ...speedWithNulls, e2eMs: 3000 } },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });
      if (url.includes('/api/compare')) {
        return json(comparePayload);
      }
      if (url.includes('/api/health')) {
        return json({ ok: true, schemaVersion: 1, uptimeMs: 1, dbSizeBytes: 1, walSizeBytes: 0 });
      }
      if (url.includes('/api/sessions')) {
        return json({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = renderApp();
    // 会话列表首帧拉取带 250ms 防抖（与既有用例一致）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const compareTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('对比'),
    );
    expect(compareTab).toBeDefined();
    act(() => compareTab!.click());

    act(() => {
      (container.querySelectorAll('.compare-picker')[0] as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const leftItems = container.querySelectorAll('.compare-picker-item');
    expect(leftItems.length).toBeGreaterThan(0);
    act(() => {
      (leftItems[0] as HTMLButtonElement).click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    act(() => {
      (container.querySelectorAll('.compare-picker')[1] as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const rightItems = container.querySelectorAll('.compare-picker-item');
    act(() => {
      (rightItems[1] as HTMLButtonElement).click();
    });

    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (container.querySelector('.compare-verdict') !== null) {
          break;
        }
      }
    });

    expect(container.querySelector('.compare-verdict')).not.toBeNull();
    expect(container.querySelector('.compare-speed-grid')).not.toBeNull();
    expect(container.querySelector('.compare-charts')).not.toBeNull();
    expect(container.textContent).not.toContain('COMPARE_FAILED');
    expect(container.textContent).not.toContain('NaN');
    expect(container.querySelector('.ui-error-boundary')).toBeNull();
    container.remove();
  });
});
