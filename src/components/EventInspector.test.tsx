import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { TraceEvent, TraceEventRaw, TraceEventSlim } from '../core/trace-types.js';
import { EventInspector } from './EventInspector.js';
import { setDesensitizationEnabled } from './inspector-text.js';

function makeEvent(over: Partial<TraceEventSlim> = {}): TraceEventSlim {
  return {
    id: 'e1',
    sessionId: 's1',
    sequence: 1,
    turnKey: null,
    kind: 'llm',
    phase: 'implement',
    title: 'response',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: true,
    ...over,
  };
}

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

function baseProps(over: {
  event?: TraceEventSlim;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent | TraceEventRaw>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
} = {}) {
  return {
    sessionKey: 's1',
    event: over.event ?? makeEvent(),
    locale: 'en' as const,
    fontPx: 13,
    width: 420,
    collapsed: false,
    onResize: () => undefined,
    onToggleCollapse: () => undefined,
    loadDetail:
      over.loadDetail ??
      (() => Promise.resolve({ ...makeEvent(), inputSummary: null, outputSummary: null })),
    loadRaw:
      over.loadRaw ??
      (() => Promise.resolve({ ...makeEvent(), inputSummary: null, outputSummary: null, raw: null })),
    onOpenTranscript: () => undefined,
    onOpenTokens: () => undefined,
    onClose: () => undefined,
  };
}

describe('EventInspector（建议 5/6）', () => {
  it('Raw tab 对 JSON 内容做语法高亮 + 密钥脱敏', async () => {
    setDesensitizationEnabled(true);
    const raw = JSON.stringify({ key: 'sk-abcdefghijklmnopqrstuvwxyz123', count: 3 });
    const { html, unmount } = mount(
      <EventInspector
        {...baseProps({
          loadRaw: () =>
            Promise.resolve({ ...makeEvent(), inputSummary: null, outputSummary: null, raw }),
        })}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    const rawTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Raw',
    );
    expect(rawTab).toBeDefined();
    act(() => {
      rawTab!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const body = html();
    expect(body).toContain('inspector-json-key');
    expect(body).toContain('sk-****');
    expect(body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123');
    unmount();
  });

  it('关闭脱敏开关后 raw 保留原文', async () => {
    setDesensitizationEnabled(false);
    const raw = JSON.stringify({ token: 'abcdefghijklmnop123456' });
    const { html, unmount } = mount(
      <EventInspector
        {...baseProps({
          loadRaw: () =>
            Promise.resolve({ ...makeEvent(), inputSummary: null, outputSummary: null, raw }),
        })}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    const rawTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Raw',
    );
    act(() => {
      rawTab!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html()).toContain('abcdefghijklmnop123456');
    unmount();
    setDesensitizationEnabled(true);
  });
});
