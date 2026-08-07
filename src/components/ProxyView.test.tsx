import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FridaView } from './FridaView.js';
import { ProxyView } from './ProxyView.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function fullRequest(id: number): Record<string, unknown> {
  return {
    id,
    requestId: `req-${id}`,
    method: 'POST',
    url: 'https://api.example.com/v1/messages',
    hostname: 'api.example.com',
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: '{"messages":[]}',
    responseStatus: 200,
    responseBody: '{}',
    contentType: 'application/json',
    isStreaming: false,
    startedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null,
    durationMs: 100,
    captureMethod: 'mitm',
    ttnetEncrypted: false,
    systemPrompt: null,
    systemPromptLen: 0,
    model: 'claude-sonnet',
    inputTokens: null,
    outputTokens: null,
    parsedSessionId: null,
    parserRoute: '/v1/messages',
    captureGroupId: null,
    requestFormat: 'anthropic_messages',
    rawRequestBody: null,
    rawResponseBody: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('REQ-020/021 代理与 Frida 视图', () => {
  it('代理未启动：空态含启动按钮与 CA 安装提示，不是一句「暂无数据」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/proxy/requests')) {
          return jsonResponse({ items: [], nextCursor: null, hasMore: false });
        }
        if (String(url).includes('/proxy/status')) {
          return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
        }
        return jsonResponse({});
      }),
    );
    const container = render(<ProxyView locale="zh" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('代理未运行');
    expect(container.textContent).toContain('启动代理');
    expect(container.textContent).toContain('下载 CA 证书');
  });

  it('Frida 前置条件空态说明缺什么', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/frida/status')) {
          return jsonResponse({ running: false, starting: false, pid: null });
        }
        if (String(url).includes('/frida/captures')) {
          return jsonResponse({ items: [], nextCursor: null, hasMore: false });
        }
        return jsonResponse({});
      }),
    );
    const container = render(<FridaView locale="zh" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Frida 未安装或未找到 Trae 目标进程');
    expect(container.textContent).toContain('macOS 暂不支持');
  });

  it('§7.2 懒加载：打开抽屉在 Request tab 时零 diff 请求；首次激活 Context Diff 只发一次；离开再回不重发', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/proxy/requests') && u.includes('context-diff')) {
          return jsonResponse({
            base: {
              id: 1,
              requestId: 'req-1',
              startedAt: '2026-08-07T00:00:00.000Z',
              hostname: 'api.example.com',
              model: 'claude-sonnet',
              captureMethod: 'mitm',
              parserRoute: '/v1/messages',
              requestFormat: 'anthropic_messages',
              parsedSessionId: null,
              captureGroupId: null,
              bodySha256: 'a'.repeat(64),
              bodyBytes: 10,
            },
            target: {
              id: 2,
              requestId: 'req-2',
              startedAt: '2026-08-07T00:00:00.000Z',
              hostname: 'api.example.com',
              model: 'claude-sonnet',
              captureMethod: 'mitm',
              parserRoute: '/v1/messages',
              requestFormat: 'anthropic_messages',
              parsedSessionId: null,
              captureGroupId: null,
              bodySha256: 'b'.repeat(64),
              bodyBytes: 12,
            },
            pairing: { confidence: 'capture_group', reason: 'same group', warnings: [] },
            noChange: false,
            growth: {
              baseChars: 10,
              targetChars: 20,
              deltaChars: 10,
              messageDelta: 1,
              toolDelta: 0,
              inputTokenDelta: null,
              inputTokenDeltaReason: 'usage_missing',
            },
            indicators: [],
            categories: [
              { category: 'system', added: 0, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
              { category: 'messages', added: 1, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
              { category: 'tools', added: 0, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
              { category: 'parameters', added: 0, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
            ],
            completeness: { complete: true, omittedCount: 0, reasons: [] },
            generatedAt: '2026-08-07T00:00:01.000Z',
            durationMs: 5,
          });
        }
        if (u.includes('/proxy/requests') && u.match(/\/proxy\/requests\/\d+$/)) {
          return jsonResponse(fullRequest(Number(u.match(/\/proxy\/requests\/(\d+)/)?.[1] ?? 2)));
        }
        if (u.includes('/proxy/requests')) {
          return jsonResponse({
            items: [
              {
                id: 1,
                requestId: 'req-1',
                method: 'POST',
                url: 'https://api.example.com/v1/messages',
                hostname: 'api.example.com',
                responseStatus: 200,
                contentType: 'application/json',
                isStreaming: false,
                startedAt: '2026-08-07T00:00:00.000Z',
                completedAt: null,
                durationMs: 100,
                captureMethod: 'mitm',
                ttnetEncrypted: false,
                systemPromptLen: 0,
                model: 'claude-sonnet',
                inputTokens: null,
                outputTokens: null,
                parsedSessionId: null,
                parserRoute: '/v1/messages',
                captureGroupId: null,
                requestFormat: 'anthropic_messages',
                hasSystemPrompt: false,
              },
            ],
            nextCursor: null,
            hasMore: false,
          });
        }
        if (u.includes('/proxy/status')) {
          return jsonResponse({ running: true, starting: false, port: 8888, requestCount: 1, startedAt: null });
        }
        return jsonResponse({});
      }),
    );
    const container = render(<ProxyView locale="zh" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 打开请求详情抽屉（Request tab）→ 尚无异义 diff 请求。
    const row = container.querySelector('.proxy-table-row');
    expect(row).not.toBeNull();
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const callsBeforeDetail = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(callsBeforeDetail).toBe(0);
    await act(async () => {
      (row as HTMLTableRowElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 默认仍在 Request tab：依旧零 diff 请求。
    let diffCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(diffCalls).toBe(0);
    // 切换到 Context Diff tab → 恰好一次。
    const contextTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      (tab.textContent ?? '').includes('上下文差异'),
    );
    expect(contextTab).not.toBeUndefined();
    await act(async () => {
      (contextTab as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    diffCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(diffCalls).toBe(1);
    // 切回 Request 再回 Context Diff → 缓存命中，仍 1 次。
    const requestTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      (tab.textContent ?? '').includes('Request'),
    );
    await act(async () => {
      (requestTab as HTMLButtonElement).click();
    });
    const contextTab2 = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      (tab.textContent ?? '').includes('上下文差异'),
    );
    await act(async () => {
      (contextTab2 as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    diffCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(diffCalls).toBe(1);
  });
});
