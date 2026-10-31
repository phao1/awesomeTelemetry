import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ProxyRequestListItem } from '../core/trace-types.js';
import { t } from '../i18n.js';
import { CaptureRequestList } from './CaptureRequestList.js';

function item(id: number, patch: Partial<ProxyRequestListItem> = {}): ProxyRequestListItem {
  return { id, requestId: 'req-' + id, method: 'POST', url: 'https://synthetic.test/v1/messages/' + id, hostname: 'synthetic.test',
    responseStatus: 200, contentType: 'application/json', isStreaming: false, startedAt: '2026-10-18T00:00:00.000Z', completedAt: null,
    durationMs: 0, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, hasSystemPrompt: false, model: 'synthetic-model',
    inputTokens: null, outputTokens: null, parsedSessionId: null, parserRoute: null, captureGroupId: null, requestFormat: 'anthropic_messages', ...patch };
}

it('window-renders500 loaded records, exposes native request activation and performs no IO', () => {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container), open = vi.fn(), fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  try {
    act(() => root.render(<CaptureRequestList items={Array.from({ length: 500 }, (_, n) => item(n + 1))} selected={1} pending={false} error={null} hasMore locale="en"
      onOpen={open} onRefresh={() => undefined} onLoadMore={() => undefined} onRetry={() => undefined} onCancel={() => undefined} />));
    expect(container.querySelectorAll('.proxy-table-row').length).toBeLessThanOrEqual(42);
    expect(container.querySelectorAll('.proxy-table-row').length).toBeGreaterThan(0);
    expect(container.querySelector('.capture-request-selected')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.capture-request-open')!.click());expect(open).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('loaded metadata only');expect(container.querySelector('.capture-row-spacer')).not.toBeNull();expect(fetcher).not.toHaveBeenCalled();
  } finally { act(() => root.unmount());container.remove();vi.unstubAllGlobals(); }
});

it('distinguishes unknown status and filters hostname/URL/model/IDs locally without body reads', async () => {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container), fetcher = vi.fn();vi.stubGlobal('fetch', fetcher);
  try {
    act(() => root.render(<CaptureRequestList items={[item(1), item(2, { responseStatus: null, model: 'Unknown-status-model' })]} selected={null} pending={false} error={null} hasMore={false} locale="en"
      onOpen={() => undefined} onRefresh={() => undefined} onLoadMore={() => undefined} onRetry={() => undefined} onCancel={() => undefined} />));
    const select = container.querySelectorAll('select')[1]!;
    act(() => { select.value = 'unknown';select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelectorAll('.proxy-table-row')).toHaveLength(1);expect(container.querySelector('.proxy-table-row')?.textContent).toContain('Unknown-status-model');
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no match');input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelectorAll('.proxy-table-row')).toHaveLength(0);expect(container.textContent).toContain('No match in loaded records');expect(fetcher).not.toHaveBeenCalled();
  } finally { act(() => root.unmount());container.remove();vi.unstubAllGlobals(); }
});

it('places reversible clear beside refresh, keeps the new-request filters and distinguishes hidden from absent history', async () => {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container), clear = vi.fn(), fetcher = vi.fn();vi.stubGlobal('fetch', fetcher);
  const props = { selected: null, pending: false, error: null, hasMore: false, onOpen: () => undefined, onRefresh: () => undefined,
    onLoadMore: () => undefined, onRetry: () => undefined, onCancel: () => undefined, onClear: clear };
  try {
    act(() => root.render(<CaptureRequestList {...props} items={[item(1)]} locale="en" />));
    const actions = [...container.querySelectorAll<HTMLButtonElement>('.capture-toolbar button')];
    expect(actions.map(node => node.textContent)).toEqual(['Refresh list', 'Clear current list']);
    expect(actions[1]!.title).toContain('history, originals and monitoring are unchanged');
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const method = container.querySelector<HTMLSelectElement>('select')!;
    act(() => { method.value = 'POST';method.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'future-only');search.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => actions[1]!.click());expect(clear).toHaveBeenCalledOnce(); // Clears loaded scope even if filters show no rows.
    expect(document.activeElement).toBe(actions[0]);
    act(() => root.render(<CaptureRequestList {...props} items={[]} cleared locale="zh" />));
    expect(search.value).toBe('future-only');expect(container.querySelector('[role="status"]')?.textContent).toContain('刷新列表可恢复');
    expect(method.value).toBe('POST');expect(method.selectedOptions[0]?.textContent).toBe('POST');
    expect(container.textContent).not.toContain(t('capture.noSavedRequests', 'zh'));
    expect(container.querySelector<HTMLButtonElement>('.capture-toolbar button:nth-of-type(2)')!.disabled).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  } finally { act(() => root.unmount());container.remove();vi.unstubAllGlobals(); }
});
