import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionDetailResponse, TraceEvent } from '../core/trace-types.js';
import { recordCache } from '../cache/caches.js';
import { TokenTextModal, TOKEN_TEXT_LIMIT } from './TokenTextModal.js';
import { makeEvent, makeResult, makeSession } from './compare-test-fixtures.js';

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
  recordCache.clear();
  vi.restoreAllMocks();
});

function fullRecord(outputText: string, over: Partial<SessionDetailResponse> = {}): SessionDetailResponse {
  const user = {
    ...makeEvent({ id: 'user1', kind: 'user_prompt', title: 'ask' }),
    inputSummary: 'the user input text',
    outputSummary: null,
    raw: null,
  } as TraceEvent;
  const llm = {
    ...makeEvent({ id: 'llm1', kind: 'llm', title: 'think' }),
    inputSummary: 'user asked something',
    outputSummary: outputText,
    raw: null,
  } as TraceEvent;
  return {
    ...makeResult().left,
    session: makeSession('left', { provider: 'codex', sourceAgent: 'Codex', systemPrompt: 'You are a coding assistant' }),
    events: [user, llm],
    mode: 'full',
    ...over,
  };
}

function baseProps(over: Partial<Parameters<typeof TokenTextModal>[0]> = {}): Parameters<typeof TokenTextModal>[0] {
  return {
    sessionKey: 'left',
    provider: 'codex',
    agentName: 'Codex',
    tokenClass: 'output',
    tokenCount: 450,
    locale: 'zh',
    onClose: () => undefined,
    ...over,
  };
}

describe('TokenTextModal（REQ-101）', () => {
  it('正常：显示输出文本 + token 数 + 字符数', async () => {
    const loadFull = vi.fn(async () => fullRecord('hello world'));
    const { html, unmount } = mount(
      <TokenTextModal {...baseProps({ tokenClass: 'output', tokenCount: 450, loadFull })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadFull).toHaveBeenCalledTimes(1);
    expect(html()).toContain('hello world');
    expect(html()).toContain('450');
    expect(html()).toContain('11');
    unmount();
  });

  it('缺失：system 未持久化时显示警告 banner，正文为空', async () => {
    const record = fullRecord('', { session: makeSession('left', { provider: 'codex', sourceAgent: 'Codex', systemPrompt: null }) });
    const loadFull = vi.fn(async () => record);
    const { html, unmount } = mount(
      <TokenTextModal {...baseProps({ tokenClass: 'system', tokenCount: 0, loadFull })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('系统提示词未持久化');
    expect(html()).toContain('token-modal-warning');
    unmount();
  });

  it('截断：超 10000 字符截断，Show all 后显示全文', async () => {
    const long = 'x'.repeat(TOKEN_TEXT_LIMIT + 2000);
    const loadFull = vi.fn(async () => fullRecord(long));
    const { html, unmount } = mount(
      <TokenTextModal {...baseProps({ tokenClass: 'output', loadFull })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const pre = document.querySelector<HTMLPreElement>('.token-modal-text');
    expect(pre?.textContent?.length).toBe(TOKEN_TEXT_LIMIT);
    expect(html()).toContain('显示全部（2,000 字符）');
    const showAll = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('显示全部'));
    expect(showAll).toBeDefined();
    act(() => {
      showAll!.click();
    });
    expect(document.querySelector<HTMLPreElement>('.token-modal-text')?.textContent?.length).toBe(TOKEN_TEXT_LIMIT + 2000);
    unmount();
  });

  it('懒加载：recordCache miss 时发一次 mode=full 并写缓存，二次打开不再请求', async () => {
    const loadFull = vi.fn(async () => fullRecord('cached text'));
    const first = mount(
      <TokenTextModal {...baseProps({ tokenClass: 'input', loadFull })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadFull).toHaveBeenCalledTimes(1);
    expect(first.html()).toContain('the user input text');
    expect(recordCache.get('left:full')).toBeDefined();
    first.unmount();

    const second = mount(
      <TokenTextModal {...baseProps({ tokenClass: 'input', loadFull })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadFull).toHaveBeenCalledTimes(1);
    expect(second.html()).toContain('the user input text');
    second.unmount();
  });

  it('slim 命中时 system 段直接读 systemPrompt，不额外发请求', async () => {
    const slim = {
      ...makeResult().left,
      session: makeSession('left', { provider: 'codex', sourceAgent: 'Codex', systemPrompt: 'slim system text' }),
      mode: 'slim' as const,
    };
    recordCache.set('left:slim', slim);
    const loadFull = vi.fn(async () => fullRecord(''));
    const { html, unmount } = mount(
      <TokenTextModal {...baseProps({ tokenClass: 'system', loadFull })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadFull).not.toHaveBeenCalled();
    expect(html()).toContain('slim system text');
    unmount();
  });
});
