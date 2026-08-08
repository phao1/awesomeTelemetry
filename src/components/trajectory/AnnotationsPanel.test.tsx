import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionAnnotations, SessionAnnotationsUpdate } from '../../core/trace-types.js';
import { ApiError } from '../../api/client.js';
import { AnnotationsPanel } from './AnnotationsPanel.js';

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
  vi.restoreAllMocks();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

const EMPTY: SessionAnnotations = { sessionKey: 's1', tags: [], note: null, updatedAt: null };

/** React 19 受控输入：用原生 setter 触发 value 变更，否则状态不更新。 */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AnnotationsPanel（D13）', () => {
  it('从未注解：空标签 + 空备注，不是错误态（边例表）', async () => {
    const fetchAnnotations = vi.fn(async () => EMPTY);
    const { html, unmount } = mount(
      <AnnotationsPanel locale="zh" sessionKey="s1" fetchAnnotations={fetchAnnotations} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('还没有标签');
    expect(document.querySelector('.ui-error')).toBeNull();
    unmount();
  });

  it('标签添加即时持久化：一次 PUT，服务器规范化后回显', async () => {
    const fetchAnnotations = vi.fn(async () => EMPTY);
    const saveAnnotations = vi.fn(async (key: string, update: { tags?: string[] }) => ({
      ...EMPTY,
      tags: (update.tags ?? []).map((tag) => tag.trim().toLowerCase()).sort(),
    }));
    const { html, unmount } = mount(
      <AnnotationsPanel
        locale="zh"
        sessionKey="s1"
        fetchAnnotations={fetchAnnotations}
        saveAnnotations={saveAnnotations}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      const input = document.querySelector('.annotations-tag-input') as HTMLInputElement;
      setValue(input, 'Refactor');
      (document.querySelector('.annotations-tag-input-row button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveAnnotations).toHaveBeenCalledTimes(1);
    expect(saveAnnotations).toHaveBeenCalledWith('s1', { tags: ['Refactor'] });
    expect(html()).toContain('refactor');
    unmount();
  });

  it('备注：未变化禁用保存；显式保存成功 → Toast + 禁用；失败 → 带 code 的 Toast', async () => {
    const fetchAnnotations = vi.fn(async () => ({ ...EMPTY, note: 'old' }));
    const saveAnnotations = vi
      .fn<(key: string, update: SessionAnnotationsUpdate) => Promise<SessionAnnotations>>()
      .mockResolvedValueOnce({ ...EMPTY, note: 'new note' })
      .mockRejectedValueOnce(new ApiError('BAD_REQUEST', 'too long', 400));
    const { html, unmount } = mount(
      <AnnotationsPanel
        locale="zh"
        sessionKey="s1"
        fetchAnnotations={fetchAnnotations}
        saveAnnotations={saveAnnotations}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const saveButton = (): HTMLButtonElement =>
      document.querySelector('.annotations-note-actions button') as HTMLButtonElement;
    // 未变化 → 禁用
    expect(saveButton().disabled).toBe(true);
    act(() => {
      const textarea = document.querySelector('.annotations-note textarea') as HTMLTextAreaElement;
      setValue(textarea, 'new note');
    });
    expect(saveButton().disabled).toBe(false);
    act(() => saveButton().click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveAnnotations).toHaveBeenCalledWith('s1', { note: 'new note' });
    expect(html()).toContain('备注已保存');
    expect(saveButton().disabled).toBe(true);
    // 再次编辑 → 失败 Toast 携带 code，按钮保持可用
    act(() => {
      const textarea = document.querySelector('.annotations-note textarea') as HTMLTextAreaElement;
      setValue(textarea, 'too long note');
    });
    act(() => saveButton().click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('BAD_REQUEST');
    expect(saveButton().disabled).toBe(false);
    unmount();
  });

  it('标签保存失败：Toast 带 code，且不清空其余标签', async () => {
    const fetchAnnotations = vi.fn(async () => ({ ...EMPTY, tags: ['keep'] }));
    const saveAnnotations = vi.fn(async () => {
      throw new ApiError('BAD_REQUEST', 'invalid tag', 400);
    });
    const { html, unmount } = mount(
      <AnnotationsPanel
        locale="zh"
        sessionKey="s1"
        fetchAnnotations={fetchAnnotations}
        saveAnnotations={saveAnnotations}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('keep');
    act(() => {
      const input = document.querySelector('.annotations-tag-input') as HTMLInputElement;
      setValue(input, 'bad tag');
      (document.querySelector('.annotations-tag-input-row button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('BAD_REQUEST');
    expect(html()).toContain('keep');
    unmount();
  });

  it('读取失败 → 错误态 + 重试（四态）', async () => {
    const fetchAnnotations = vi
      .fn<(key: string) => Promise<SessionAnnotations>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(EMPTY);
    const { html, unmount } = mount(
      <AnnotationsPanel locale="zh" sessionKey="s1" fetchAnnotations={fetchAnnotations} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('offline');
    act(() => {
      (document.querySelector('.ui-error button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.ui-error')).toBeNull();
    expect(html()).toContain('还没有标签');
    unmount();
  });
});
