import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from './core/trace-types.js';
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
  readonly onopen: (() => void) | null = null;
  readonly onerror: (() => void) | null = null;
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();

  constructor(_url: string) {}

  addEventListener(type: string, cb: (event: { data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }

  close(): void {
    // noop
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const compareTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('对比'),
    );
    expect(compareTab).toBeDefined();
    act(() => compareTab!.click());

    const selects = container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const select of Array.from(selects).slice(0, 2)) {
      const options = Array.from(select.querySelectorAll('option')).filter(
        (o) => o.getAttribute('value') !== '',
      );
      expect(options.map((o) => o.getAttribute('value')).sort()).toEqual(['s-1', 's-2', 's-3']);
    }
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
});
