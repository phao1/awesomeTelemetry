import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContextDiffPanel } from './RequestContextDiffPanel.js';
import type {
  ProxyRequestListItem,
  RequestContextDiffResponse,
} from '../core/trace-types.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function jsonErr(status: number, code: string, message: string): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code, message } }),
  } as unknown as Response;
}

/** 通过原生 setter 写入受控 input 的值以触发 React onChange（jsdom 无 fireEvent）。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 通过 category tab 的文字（含 count）切换到指定类别。 */
async function clickCategory(container: HTMLDivElement, label: string): Promise<void> {
  const tab = [...container.querySelectorAll('[role="tab"]')].find((node) =>
    (node.textContent ?? '').includes(label),
  );
  expect(tab).not.toBeUndefined();
  await act(async () => {
    (tab as HTMLButtonElement).click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function ref(id: number, overrides: Partial<RequestContextDiffResponse['base']> = {}): RequestContextDiffResponse['base'] {
  return {
    id,
    requestId: `req-${id}`,
    startedAt: '2026-08-07T00:00:00.000Z',
    hostname: 'api.example.com',
    model: 'claude-sonnet',
    captureMethod: 'mitm',
    parserRoute: '/v1/messages',
    requestFormat: 'anthropic_messages',
    parsedSessionId: null,
    captureGroupId: null,
    bodySha256: 'a'.repeat(64),
    bodyBytes: 1024,
    ...overrides,
  };
}

function diffResponse(overrides: Partial<RequestContextDiffResponse> = {}): RequestContextDiffResponse {
  const base: RequestContextDiffResponse = {
    base: ref(1),
    target: ref(2),
    pairing: { confidence: 'capture_group', reason: 'same capture group', warnings: [] },
    noChange: false,
    growth: {
      baseChars: 100,
      targetChars: 180,
      deltaChars: 80,
      messageDelta: 1,
      toolDelta: 0,
      inputTokenDelta: null,
      inputTokenDeltaReason: 'usage_missing',
    },
    indicators: [],
    categories: [
      {
        category: 'system',
        added: 0,
        removed: 1,
        modified: 0,
        unchanged: 0,
        completeness: { complete: true, omittedCount: 0, reasons: [] },
        entries: [],
      },
      {
        category: 'messages',
        added: 1,
        removed: 0,
        modified: 0,
        unchanged: 3,
        completeness: { complete: true, omittedCount: 0, reasons: [] },
        entries: [
          {
            category: 'messages',
            kind: 'added',
            identity: 'sha:bbbb',
            label: 'user message',
            beforePath: null,
            afterPath: 'messages[2]',
            beforeIndex: null,
            afterIndex: 2,
            changedPaths: [],
            before: null,
            after: {
              jsonType: 'string',
              sha256: 'b'.repeat(64),
              charLength: 80,
              excerptStart: 'hello world',
              excerptEnd: '',
              truncated: false,
            },
            segments: null,
            truncatedReason: null,
          },
        ],
      },
      {
        category: 'tools',
        added: 0,
        removed: 0,
        modified: 1,
        unchanged: 2,
        completeness: { complete: true, omittedCount: 0, reasons: [] },
        entries: [],
      },
      {
        category: 'parameters',
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 1,
        completeness: { complete: true, omittedCount: 0, reasons: [] },
        entries: [],
      },
    ],
    completeness: { complete: true, omittedCount: 0, reasons: [] },
    generatedAt: '2026-08-07T00:00:01.000Z',
    durationMs: 12,
    ...overrides,
  };
  return base;
}

function listItem(id: number, overrides: Partial<ProxyRequestListItem> = {}): ProxyRequestListItem {
  return {
    id,
    requestId: `req-${id}`,
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
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('RequestContextDiffPanel §7', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('首次激活加载自动配对；loading → success，置信度/增长/token 缺失渲染 —', async () => {
    const response = diffResponse();
    vi.mocked(fetch).mockResolvedValueOnce(jsonOk(response));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="zh"
        loadedItems={[listItem(1)]}
        onOpenRequest={() => undefined}
      />,
    );
    expect(container.querySelector('.ui-skeleton')).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('配对置信度');
    expect(container.textContent).toContain('同一代理运行内最近请求');
    expect(container.textContent).toContain('输入 token 增量');
    expect(container.textContent).toContain('—');
    expect(container.textContent).toContain('Messages');
    await clickCategory(container, 'Messages');
    expect(container.textContent).toContain('user message');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/context-diff');
  });

  it('缓存：同一 target/base pair 第二次不重发请求；更换 base 才再请求', async () => {
    const first = diffResponse();
    const manual = diffResponse({ base: ref(3), pairing: { confidence: 'manual', reason: 'manual', warnings: [] } });
    vi.mocked(fetch).mockResolvedValueOnce(jsonOk(first)).mockResolvedValueOnce(jsonOk(manual));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="en"
        loadedItems={[listItem(1), listItem(3)]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    // 手动输入基线 ID 3 → 新的 key，第二次请求。
    await act(async () => {
      setInputValue(container.querySelector('.context-base-id-entry input') as HTMLInputElement, '3');
    });
    await act(async () => {
      const input = container.querySelector('.context-base-id-entry input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain('base=3');
    expect(container.textContent).toContain('Manually selected base');
    // 再次选择同一个 base #3 → 缓存命中，仍 2 次请求。
    await act(async () => {
      setInputValue(container.querySelector('.context-base-id-entry input') as HTMLInputElement, '3');
    });
    await act(async () => {
      const input = container.querySelector('.context-base-id-entry input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('缓存逐出：插入超过 10 个 pair 时，最旧者被逐出并重新请求', async () => {
    const items = Array.from({ length: 13 }, (_, index) => listItem(index + 1));
    const pending: Array<Promise<Response>> = [];
    for (let id = 1; id <= 12; id += 1) {
      pending.push(Promise.resolve(jsonOk(diffResponse({ base: ref(id) }))));
    }
    vi.mocked(fetch).mockImplementation(
      (() => {
        let call = 0;
        return async () => {
          const index = Math.min(call, pending.length - 1);
          call += 1;
          return pending[index] ?? jsonOk(diffResponse());
        };
      })(),
    );
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="en"
        loadedItems={items}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 初始 previous = 1 次。随后点击 11 个 distinct base（3..13），共 12 次请求。
    const clickBase = async (baseId: number): Promise<void> => {
      const buttons = [...container.querySelectorAll('.context-base-item')];
      const target = buttons.find((button) => button.textContent?.includes(`#${baseId}`));
      expect(target).not.toBeUndefined();
      await act(async () => {
        (target as HTMLButtonElement).click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const baseIds = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (const baseId of baseIds) {
      await clickBase(baseId);
    }
    // 初始 previous + 11 个 base = 12 次请求；缓存现在有 11 个 distinct key（previous + 3..13）
    // 但上限 10，逐出了 previous 与 base=3。因此请求 #3 再次触发网络请求。
    const countBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await clickBase(3);
    const countAfter = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(countBefore).toBe(12);
    expect(countAfter).toBe(13);
  });

  it('手动 ID 输入后提交请求 base=<id> 并排除目标', async () => {
    const manual = diffResponse({ base: ref(9), pairing: { confidence: 'manual', reason: 'manual', warnings: [] } });
    vi.mocked(fetch).mockResolvedValueOnce(jsonOk(diffResponse())).mockResolvedValueOnce(jsonOk(manual));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="zh"
        loadedItems={[]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const input = container.querySelector('.context-base-id-entry input');
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input as HTMLInputElement, '9');
    });
    await act(async () => {
      const input2 = container.querySelector('.context-base-id-entry input') as HTMLInputElement;
      input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain('base=9');
  });

  it('自动配对不可用 → unavailable 引导 + 基线选择器，不渲染零变化摘要', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonErr(409, 'CONTEXT_DIFF_UNAVAILABLE', 'pairing_unavailable'));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="zh"
        loadedItems={[listItem(1)]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('没有可自动配对的基线');
    expect(container.textContent).toContain('选择基线请求');
    expect(container.textContent).not.toContain('无变化');
  });

  it('unsupported 态展示原因且不自动重试', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonErr(422, 'CONTEXT_DIFF_UNSUPPORTED', 'source_too_large'));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="unknown"
        locale="zh"
        loadedItems={[]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('该请求格式不受支持');
    expect(container.textContent).toContain('source_too_large');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('error 态显示错误码 + 重试按钮，点击重试再次请求', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonErr(500, 'INTERNAL_ERROR', 'boom'))
      .mockResolvedValueOnce(jsonOk(diffResponse()));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="zh"
        loadedItems={[]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('INTERNAL_ERROR');
    const retryButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'retry');
    expect(retryButton).not.toBeUndefined();
    await act(async () => {
      (retryButton as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await clickCategory(container, 'Messages');
    expect(container.textContent).toContain('user message');
  });

  it('渲染警告、部分证据、省略计数与截断原因', async () => {
    const response = diffResponse({
      pairing: {
        confidence: 'manual',
        reason: 'manual',
        warnings: ['models differ: claude vs gpt'],
      },
      indicators: [
        {
          code: 'history_shrink',
          classification: 'suspected_compaction',
          severity: 'warning',
          before: 200,
          after: 100,
          message: 'history shrank 50%',
        },
      ],
      categories: [
        {
          category: 'system',
          added: 0,
          removed: 1,
          modified: 0,
          unchanged: 0,
          completeness: { complete: false, omittedCount: 5, reasons: ['item_limit'] },
          entries: [
            {
              category: 'system',
              kind: 'removed',
              identity: 'sys:0',
              label: 'system block',
              beforePath: 'system',
              afterPath: null,
              beforeIndex: 0,
              afterIndex: null,
              changedPaths: [],
              before: {
                jsonType: 'string',
                sha256: 'c'.repeat(64),
                charLength: 4000,
                excerptStart: 'start...',
                excerptEnd: '...end',
                truncated: true,
              },
              after: null,
              segments: [
                { kind: 'equal', text: 'common' },
                { kind: 'removed', text: 'old' },
              ],
              truncatedReason: 'inline_limit',
            },
          ],
        },
      ],
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonOk(response));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="zh"
        loadedItems={[]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('models differ');
    expect(container.textContent).toContain('疑似上下文压缩');
    expect(container.textContent).toContain('部分证据');
    expect(container.textContent).toContain('另有 5 项省略');
    // 展开 system 行以显示路径/摘要/哈希/截断原因。
    const head = container.querySelector('.context-change-row-head');
    expect(head).not.toBeNull();
    await act(async () => {
      (head as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain('system');
    expect(container.textContent).toContain('start...');
    expect(container.textContent).toContain('...end');
    expect(container.textContent).toContain('达到内联截断上限');
  });

  it('源动作：打开 base / target 触发 onOpenRequest', async () => {
    const onOpenRequest = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(jsonOk(diffResponse()));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="zh"
        loadedItems={[]}
        onOpenRequest={onOpenRequest}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const buttons = [...container.querySelectorAll('.context-source-actions button')];
    expect(buttons).toHaveLength(2);
    await act(async () => {
      (buttons[0] as HTMLButtonElement).click();
    });
    expect(onOpenRequest).toHaveBeenCalledWith(1);
    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(onOpenRequest).toHaveBeenCalledWith(2);
  });

  it('键盘：Enter 提交 ID、类别 tab 可点、行可展开/折叠（aria-expanded）', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonOk(diffResponse()));
    const container = render(
      <RequestContextDiffPanel
        targetId={2}
        targetFormat="anthropic_messages"
        locale="en"
        loadedItems={[]}
        onOpenRequest={() => undefined}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll('.context-category-count').length).toBe(4);
    await clickCategory(container, 'Messages');
    const rowHead = container.querySelector('.context-change-row-head');
    expect((rowHead as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      (rowHead as HTMLButtonElement).click();
    });
    expect((rowHead as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
  });
});
