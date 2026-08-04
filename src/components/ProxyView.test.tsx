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
});
