import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SystemPromptSection, SYS_PROMPT_KEY, SYS_PROMPT_PREVIEW_LIMIT, SessionToolbar } from './SessionToolbar.js';
import { makeEvent, makeSession } from './compare-test-fixtures.js';

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
  localStorage.removeItem(SYS_PROMPT_KEY);
});

const prompt = 'You are a helpful coding assistant. '.repeat(300); // ~8700 chars

describe('SystemPromptSection（REQ-103）', () => {
  it('systemPrompt === null 时整个区域不渲染', () => {
    const { html, unmount } = mount(
      <SystemPromptSection session={makeSession('s1', { systemPrompt: null })} locale="zh" />,
    );
    expect(html()).not.toContain('sys-prompt');
    unmount();
  });

  it('折叠态显示字符数与估算 token；点击展开显示正文', () => {
    const session = makeSession('s1', { systemPrompt: prompt });
    const { html, unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    expect(html()).toContain(`${prompt.length.toLocaleString()} 字符`);
    expect(html()).toContain(`~${Math.ceil(prompt.length / 4).toLocaleString()} tokens`);
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      toggle.click();
    });
    expect(html()).toContain('sys-prompt-text');
    unmount();
  });

  it('超 5000 字符截断 + Show more 显示全文', () => {
    const session = makeSession('s1', { systemPrompt: prompt });
    const { html, unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    act(() => {
      toggle.click();
    });
    const pre = document.querySelector<HTMLPreElement>('.sys-prompt-text');
    expect(pre?.textContent?.length).toBe(SYS_PROMPT_PREVIEW_LIMIT);
    expect(html()).toContain(`显示更多（${(prompt.length - SYS_PROMPT_PREVIEW_LIMIT).toLocaleString()} 字符）`);
    const more = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('显示更多'));
    expect(more).toBeDefined();
    act(() => {
      more!.click();
    });
    expect(document.querySelector<HTMLPreElement>('.sys-prompt-text')?.textContent?.length).toBe(prompt.length);
    unmount();
  });

  it('折叠状态持久化到 awesome-telemetry.sysPromptExpanded', () => {
    localStorage.setItem(SYS_PROMPT_KEY, '1');
    const session = makeSession('s1', { systemPrompt: 'short prompt' });
    const { html, unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    expect(document.querySelector('.sys-prompt-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(html()).toContain('short prompt');
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    act(() => {
      toggle.click();
    });
    expect(localStorage.getItem(SYS_PROMPT_KEY)).toBe('0');
    unmount();
  });

  it('键盘 Enter/Space 可切换（role="button" + tabIndex）', () => {
    const session = makeSession('s1', { systemPrompt: 'short prompt' });
    const { unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    expect(toggle.getAttribute('role')).toBe('button');
    expect(toggle.getAttribute('tabindex')).toBe('0');
    act(() => {
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    unmount();
  });

  it('SessionToolbar 组合渲染时系统 Prompt 区在其下方', () => {
    const session = makeSession('s1', { systemPrompt: 'short prompt' });
    const { html, unmount } = mount(
      <SessionToolbar
        session={session}
        events={[makeEvent({ id: 'e1', kind: 'llm' })]}
        locale="zh"
      />,
    );
    expect(html()).toContain('session-toolbar');
    expect(html()).toContain('sys-prompt');
    unmount();
  });

  it('D14/6.15：渲染会话标签 chips 与返回按钮（onBack）', () => {
    const session = makeSession('s1');
    const onBack = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(
        <SessionToolbar
          session={session}
          events={[]}
          locale="zh"
          tags={['refactor', 'perf']}
          onBack={onBack}
        />,
      );
    });
    expect(container.querySelectorAll('.session-toolbar-tags .session-row-tag').length).toBe(2);
    expect(container.textContent).toContain('refactor');
    const back = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('返回'),
    ) as HTMLButtonElement;
    expect(back).toBeDefined();
    act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
