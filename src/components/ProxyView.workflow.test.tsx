import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { MonitorConnectionProfile, ProxyRequestListItem } from '../core/trace-types.js';
import { t } from '../i18n.js';
import { ProxyView } from './ProxyView.js';

const idle = { running: false, starting: false, port: null, requestCount: 0, startedAt: null };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const roots = new Set<ReturnType<typeof createRoot>>();
function mount(): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container);roots.add(root);
  act(() => root.render(<ProxyView locale="en" />));return { container, root };
}
const button = (container: HTMLElement, text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
function item(id: number, patch: Partial<ProxyRequestListItem> = {}): ProxyRequestListItem {
  return { id, requestId: 'req-' + id, method: 'POST', url: 'https://synthetic.test/v1/messages/' + id, hostname: 'synthetic.test',
    responseStatus: 200, contentType: 'application/json', isStreaming: false, startedAt: '2026-10-18T00:00:00.000Z', completedAt: null,
    durationMs: 0, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, hasSystemPrompt: false, model: 'synthetic-model',
    inputTokens: null, outputTokens: null, parsedSessionId: null, parserRoute: null, captureGroupId: null, requestFormat: 'anthropic_messages', ...patch };
}
afterEach(() => { act(() => { for (const root of roots) root.unmount();roots.clear(); });document.body.innerHTML = '';vi.useRealTimers();vi.unstubAllGlobals(); });

it('does not call an unknown initial runtime stopped and times out an abort-ignoring status read without blocking history', async () => {
  vi.useFakeTimers();let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/status')) { signal = init?.signal as AbortSignal;return new Promise<Response>(() => undefined); }
    return response({ items: [], nextCursor: null, hasMore: false });
  }));
  const { container } = mount();expect(container.textContent).toContain('Monitor state unconfirmed');expect(button(container, 'Start proxy').disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(signal?.aborted).toBe(true);expect(container.textContent).toContain('PROXY_STATUS_FAILED');expect(container.textContent).toContain('No saved record loaded');
});

it('validates ports and makes a start wait single-flight until explicit status recovery after cancellation', async () => {
  let startSignal: AbortSignal | undefined;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/start')) { startSignal = init?.signal as AbortSignal;return new Promise<Response>(() => undefined); }
    return response(path.endsWith('/status') ? idle : { items: [], hasMore: false, nextCursor: null });
  });vi.stubGlobal('fetch', fetcher);const { container } = mount();
  await act(async () => { await Promise.resolve(); });
  const input = container.querySelector<HTMLInputElement>('.capture-control-section input')!;expect(input).not.toBeNull();
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1e3');input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => button(container, 'Start proxy').click());expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/start'))).toBe(false);
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '7793');input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => { button(container, 'Start proxy').click();button(container, 'Start proxy').click(); });
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/start'))).toHaveLength(1);
  act(() => button(container, 'Cancel waiting').click());expect(startSignal?.aborted).toBe(true);expect(button(container, 'Start proxy').disabled).toBe(true);
  expect(container.textContent).toContain('Control outcome unconfirmed');
  await act(async () => button(container, 'Refresh monitor status').click());expect(button(container, 'Start proxy').disabled).toBe(false);
});

it('uses a focus-trapped Stop confirmation and never posts stop before explicit confirmation', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => response(String(input).endsWith('/status') ? { ...idle, running: true, port: 7793 } : String(input).endsWith('/stop') ? idle : { items: [], hasMore: false, nextCursor: null }));
  vi.stubGlobal('fetch', fetcher);const { container } = mount();await act(async () => { await Promise.resolve(); });
  act(() => button(container, 'Stop proxy').click());expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
  expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/stop'))).toBe(false);expect(document.activeElement?.textContent).not.toBe('Confirm');
  await act(async () => button(container, 'Confirm').click());expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/stop'))).toHaveLength(1);
});

it('appends explicit cursor pages, preserves later SSE metadata across both snapshots and does not read bodies', async () => {
  let finishInitial!: (value: Response) => void, finishPage!: (value: Response) => void;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/status')) return response(idle);
    if (path.includes('cursor=')) return new Promise<Response>(resolve => { finishPage = resolve; });
    return new Promise<Response>(resolve => { finishInitial = resolve; });
  });vi.stubGlobal('fetch', fetcher);const { container, root } = mount();
  const live = item(3, { hostname: 'live-later.test', model: 'SSE_NEWER_MODEL' });
  await act(async () => root.render(<ProxyView locale="en" liveUpdates={[{ id: 3, hostname: live.hostname, item: live, requestCount: 3 }]} />));
  await act(async () => finishInitial(response({ items: [item(1), item(3, { model: 'STALE_MODEL' })], nextCursor: 'owned-next', hasMore: true })));
  expect(container.textContent).toContain('SSE_NEWER_MODEL');expect(container.textContent).not.toContain('STALE_MODEL');
  act(() => { button(container, 'Load 50 more').click();button(container, 'Load 50 more').click(); });
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('cursor=owned-next'))).toHaveLength(1);
  const newest = item(4, { hostname: 'during-page.test' });
  await act(async () => root.render(<ProxyView locale="en" liveUpdates={[{ id: 4, hostname: newest.hostname, item: newest, requestCount: 4 }]} />));
  await act(async () => finishPage(response({ items: [item(2), item(1)], nextCursor: null, hasMore: false })));
  expect(container.querySelector('.capture-requests')?.textContent).toContain('4 / 4');
  expect(container.textContent).toContain('live-later.test');expect(container.textContent).toContain('during-page.test');
  const calls = fetcher.mock.calls.length;
  await act(async () => root.render(<ProxyView locale="zh" />));
  expect(fetcher).toHaveBeenCalledTimes(calls);expect(fetcher.mock.calls.every(([url]) => /\/status$|\/requests\?/.test(String(url)))).toBe(true);
});

it('retains a later runtime patch and historical count when an older status snapshot finishes', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/status')
    ? new Promise<Response>(resolve => { finish = resolve; }) : response({ items: [], nextCursor: null, hasMore: false })));
  const { container, root } = mount();
  await act(async () => root.render(<ProxyView locale="en" liveStatus={{ running: true, starting: false, port: 7793 }}
    liveUpdates={[{ id: 8, hostname: 'synthetic.test', item: item(8), requestCount: 8 }]} />));
  await act(async () => finish(response({ ...idle, requestCount: 2 })));
  expect(container.textContent).toContain('8 req');expect(button(container, 'Stop proxy')).toBeDefined();
  expect(container.textContent).not.toContain('2026-'); // No invented start timestamp.
});

it('clears only the loaded list without IO or counter/runtime changes, keeps old SSE IDs hidden and restores on refresh', async () => {
  const old = item(1, { hostname: 'hidden-old.test' }), fresh = item(2, { hostname: 'new-after-clear.test' });
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => response(String(input).endsWith('/status')
    ? { ...idle, running: true, port: 7793, requestCount: 17 }
    : { items: [old], nextCursor: null, hasMore: false }));
  vi.stubGlobal('fetch', fetcher);const { container, root } = mount();await act(async () => { await Promise.resolve(); });
  const oldUpdate = { id: old.id, hostname: old.hostname, item: old, requestCount: 17 };
  await act(async () => root.render(<ProxyView locale="en" liveUpdates={[oldUpdate]} />));
  const calls = fetcher.mock.calls.length;
  act(() => button(container, 'Clear current list').click());
  expect(fetcher).toHaveBeenCalledTimes(calls);expect(container.querySelectorAll('.capture-request-open')).toHaveLength(0);
  expect(container.textContent).toContain('17 req');expect(button(container, 'Stop proxy').disabled).toBe(false);
  expect(container.querySelector('.capture-requests [role="status"]')?.textContent).toContain('Refresh list to restore');
  expect(container.querySelector('[role="dialog"]')).toBeNull();expect(button(container, 'Clear current list').disabled).toBe(true);
  await act(async () => root.render(<ProxyView locale="en" liveUpdates={[oldUpdate, { id: fresh.id, hostname: fresh.hostname, item: fresh, requestCount: 18 }]} />));
  expect(container.textContent).not.toContain('hidden-old.test');expect(container.textContent).toContain('new-after-clear.test');expect(container.textContent).toContain('18 req');
  act(() => button(container, 'Clear current list').click());expect(fetcher).toHaveBeenCalledTimes(calls);
  await act(async () => root.render(<ProxyView locale="zh" liveUpdates={[oldUpdate, { id: fresh.id, hostname: fresh.hostname, item: fresh, requestCount: 18 }]} />));
  expect(container.querySelectorAll('.capture-request-open')).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(calls);
  await act(async () => button(container, '刷新列表').click());
  expect(container.textContent).toContain('hidden-old.test');expect(container.querySelector('.capture-requests [role="status"]')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);expect(fetcher.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
});

it('revokes an in-flight cursor page on clear, rejects ignored-abort results and restores paging with newer SSE metadata', async () => {
  let finishPage!: (value: Response) => void, finishRefresh!: (value: Response) => void;let pageSignal: AbortSignal | undefined;
  let firstPageReads = 0, cursorReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);if (path.endsWith('/status')) return response(idle);
    if (path.includes('cursor=')) {
      cursorReads += 1;if (cursorReads > 1) return response({ items: [item(1)], nextCursor: null, hasMore: false });
      pageSignal = init?.signal as AbortSignal;return new Promise<Response>(resolve => { finishPage = resolve; });
    }
    firstPageReads += 1;if (firstPageReads === 1) return response({ items: [item(2)], nextCursor: 'before-clear', hasMore: true });
    return new Promise<Response>(resolve => { finishRefresh = resolve; });
  });
  vi.stubGlobal('fetch', fetcher);const { container, root } = mount();await act(async () => { await Promise.resolve(); });
  act(() => button(container, 'Load 50 more').click());const calls = fetcher.mock.calls.length;
  act(() => button(container, 'Clear current list').click());expect(pageSignal?.aborted).toBe(true);expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(button(container, 'Load 50 more')).toBeUndefined();expect(button(container, 'Refresh list').disabled).toBe(false);
  expect(document.activeElement).toBe(button(container, 'Refresh list'));
  await act(async () => finishPage(response({ items: [item(1, { hostname: 'STALE_CANCELLED_PAGE' })], nextCursor: 'late-cursor', hasMore: true })));
  expect(container.textContent).not.toContain('STALE_CANCELLED_PAGE');expect(button(container, 'Load 50 more')).toBeUndefined();
  act(() => button(container, 'Refresh list').click());
  const live = item(3, { model: 'NEWER_LIVE_MODEL' });
  await act(async () => root.render(<ProxyView locale="en" liveUpdates={[{ id: 3, hostname: live.hostname, item: live }]} />));
  await act(async () => finishRefresh(response({ items: [item(2), item(3, { model: 'OLD_SNAPSHOT_MODEL' })], nextCursor: 'restored-cursor', hasMore: true })));
  expect(container.textContent).toContain('NEWER_LIVE_MODEL');expect(container.textContent).not.toContain('OLD_SNAPSHOT_MODEL');
  await act(async () => button(container, 'Load 50 more').click());
  expect(container.querySelector('.capture-requests')?.textContent).toContain('3 / 3');
  expect(fetcher.mock.calls.filter(([path]) => String(path).includes('cursor=restored-cursor'))).toHaveLength(1);
  expect(fetcher.mock.calls.every(([path]) => /\/status$|\/requests\?/.test(String(path)))).toBe(true);
});

it.each(['failure', 'cancel', 'timeout'] as const)('keeps local hiding through a %s refresh, rejects late recovery and restores only after successful retry', async outcome => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;let listReads = 0;
  const old = item(1, { hostname: 'only-after-good-refresh.test' });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/status')) return response(idle);
    listReads += 1;
    if (listReads === 2) { signal = init?.signal as AbortSignal;return new Promise<Response>(resolve => { finish = resolve; }); }
    return response({ items: [old], nextCursor: null, hasMore: false });
  });
  vi.stubGlobal('fetch', fetcher);const { container, root } = mount();await act(async () => { await Promise.resolve(); });
  act(() => button(container, 'Clear current list').click());act(() => button(container, 'Refresh list').click());
  if (outcome === 'failure') await act(async () => finish(response({ error: { code: 'SYNTHETIC_LIST_FAILURE', message: 'Synthetic failure' } }, 503)));
  else if (outcome === 'cancel') act(() => button(container, 'Cancel waiting').click());
  else await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  if (outcome !== 'failure') {
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(response({ items: [old], nextCursor: 'LATE_RECOVERY_CURSOR', hasMore: true })));
  }
  await act(async () => root.render(<ProxyView locale="en" liveUpdates={[{ id: old.id, hostname: old.hostname, item: old }]} />));
  expect(container.textContent).not.toContain('only-after-good-refresh.test');expect(container.textContent).toContain('PROXY_LIST_FAILED');
  expect(container.querySelector('.capture-requests [role="status"]')?.textContent).toContain('Refresh list to restore');
  expect(button(container, 'Load 50 more')).toBeUndefined();expect(listReads).toBe(2);
  await act(async () => button(container, 'Retry').click());
  expect(container.textContent).toContain('only-after-good-refresh.test');expect(container.textContent).not.toContain('PROXY_LIST_FAILED');
  expect(container.querySelector('.capture-requests [role="status"]')).toBeNull();expect(listReads).toBe(3);
  expect(fetcher.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
});

it('does not persist local hiding after the view unmounts and reopens', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => response(String(input).endsWith('/status') ? idle
    : { items: [item(1)], nextCursor: null, hasMore: false }));
  vi.stubGlobal('fetch', fetcher);const first = mount();await act(async () => { await Promise.resolve(); });
  act(() => button(first.container, 'Clear current list').click());expect(first.container.querySelectorAll('.capture-request-open')).toHaveLength(0);
  act(() => first.root.unmount());roots.delete(first.root);first.container.remove();
  const second = mount();await act(async () => { await Promise.resolve(); });
  expect(second.container.querySelectorAll('.capture-request-open')).toHaveLength(1);expect(second.container.querySelector('.capture-requests [role="status"]')).toBeNull();
  expect(fetcher.mock.calls.filter(([path]) => String(path).includes('/requests?'))).toHaveLength(2);
  expect(fetcher.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
});

it('times out control once, rejects late success and only explicit status recovery unlocks another command', async () => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/start')) { signal = init?.signal as AbortSignal;return new Promise<Response>(resolve => { finish = resolve; }); }
    return response(path.endsWith('/status') ? idle : { items: [], nextCursor: null, hasMore: false });
  });vi.stubGlobal('fetch', fetcher);const { container } = mount();await act(async () => { await Promise.resolve(); });
  act(() => button(container, 'Start proxy').click());
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(signal?.aborted).toBe(true);expect(container.textContent).toContain('PROXY_CONTROL_TIMEOUT');expect(button(container, 'Start proxy').disabled).toBe(true);
  await act(async () => finish(response({ ...idle, running: true, port: 7793 })));
  expect(button(container, 'Stop proxy')).toBeUndefined();expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(1);
  await act(async () => button(container, 'Refresh monitor status').click());expect(button(container, 'Start proxy').disabled).toBe(false);
});

it('owns selected-detail timeout/cancel and rejects old results after explicit retry, close and unmount', async () => {
  vi.useFakeTimers();const finishes: Array<(value: Response) => void> = [], signals: AbortSignal[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/requests/1')) { signals.push(init?.signal as AbortSignal);return new Promise<Response>(resolve => { finishes.push(resolve); }); }
    return response(path.endsWith('/status') ? idle : { items: [item(1)], nextCursor: null, hasMore: false });
  });vi.stubGlobal('fetch', fetcher);const { container, root } = mount();await act(async () => { await Promise.resolve(); });
  act(() => container.querySelector<HTMLButtonElement>('.capture-request-open')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(signals[0]?.aborted).toBe(true);expect(container.textContent).toContain('PROXY_DETAIL_FAILED');
  act(() => button(container, 'Retry').click());
  await act(async () => finishes[0]!(response({ ...item(1), url: 'STALE_DETAIL_NEVER_SHOWN' })));
  expect(container.textContent).not.toContain('STALE_DETAIL_NEVER_SHOWN');
  act(() => button(container, 'Cancel waiting').click());expect(signals[1]?.aborted).toBe(true);
  act(() => container.querySelector<HTMLButtonElement>('.capture-detail-drawer .ui-drawer-header button')!.click());
  await act(async () => finishes[1]!(response({ ...item(1), url: 'CANCELLED_DETAIL_NEVER_SHOWN' })));
  expect(container.textContent).not.toContain('CANCELLED_DETAIL_NEVER_SHOWN');expect(container.querySelector('.capture-detail-drawer')).toBeNull();
  act(() => container.querySelector<HTMLButtonElement>('.capture-request-open')!.click());act(() => root.unmount());roots.delete(root);
  expect(signals[2]?.aborted).toBe(true);
});

it('resizes the selected drawer by keyboard within bounds and restores focus to its native opener', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/requests/1') ? new Promise<Response>(() => undefined)
    : response(String(input).endsWith('/status') ? idle : { items: [item(1)], nextCursor: null, hasMore: false })));
  const { container } = mount();await act(async () => { await Promise.resolve(); });
  const opener = container.querySelector<HTMLButtonElement>('.capture-request-open')!;act(() => { opener.focus();opener.click(); });
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
  expect(handle.getAttribute('aria-valuenow')).toBe('280');
  act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(handle.getAttribute('aria-valuenow')).toBe('296');
  act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
  expect(handle.getAttribute('aria-valuenow')).toBe('900');
  act(() => container.querySelector<HTMLButtonElement>('.capture-detail-drawer .ui-drawer-header button')!.click());
  expect(document.activeElement).toBe(opener);
});

it('guards dirty setup close with a safe nested confirmation, keeps its draft on cancel and never saves implicitly', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => response(String(input).endsWith('/status') ? idle
    : String(input).endsWith('/profiles') ? { items: [] } : { items: [], nextCursor: null, hasMore: false }));vi.stubGlobal('fetch', fetcher);const { container } = mount();
  await act(async () => { await Promise.resolve(); });
  await act(async () => { button(container, t('monitor.title', 'en')).click();await import('./MonitorSetupPanel.js'); });
  act(() => { const input = container.querySelector<HTMLInputElement>('.monitor-setup input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Unsent setup draft');input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => container.querySelector<HTMLButtonElement>('.monitor-setup-drawer .ui-drawer-header button')!.click());
  expect(container.querySelector('[aria-label="Close connection setup?"]')).not.toBeNull();expect(document.activeElement?.textContent).not.toBe('Discard draft and close waiting');
  act(() => button(container, 'Keep editing').click());expect(container.querySelector<HTMLInputElement>('.monitor-setup input')!.value).toBe('Unsent setup draft');
  act(() => container.querySelector<HTMLButtonElement>('.monitor-setup-drawer .ui-drawer-header button')!.click());act(() => button(container, 'Discard draft and close waiting').click());
  expect(container.querySelector('.monitor-setup')).toBeNull();expect(fetcher.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
});

it('does not allow parent listener controls to bypass a cancelled setup start, and ignores late child readiness', async () => {
  const profile: MonitorConnectionProfile = { id: '00000000-0000-4000-8000-000000000001', label: 'Synthetic', agent: 'codex', projectDirectory: '/synthetic', executable: null, noProxy: null, proxyPort: 7793,
    revision: 1, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
  let finish!: (value: Response) => void;let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);if (path.endsWith('/start')) { signal = init?.signal as AbortSignal;return new Promise<Response>(resolve => { finish = resolve; }); }
    return response(path.endsWith('/status') ? idle : path.endsWith('/profiles') ? { items: [profile] } : { items: [], nextCursor: null, hasMore: false });
  });vi.stubGlobal('fetch', fetcher);const { container } = mount();await act(async () => { await Promise.resolve(); });
  await act(async () => { button(container, t('monitor.title', 'en')).click();await import('./MonitorSetupPanel.js'); });
  act(() => { const select = container.querySelector<HTMLSelectElement>('.monitor-setup select')!;select.value = profile.id;select.dispatchEvent(new Event('change', { bubbles: true })); });
  act(() => button(container, t('monitor.startListener', 'en')).click());act(() => button(container, 'Cancel waiting').click());
  expect(signal?.aborted).toBe(true);expect(button(container, 'Start proxy').disabled).toBe(true);
  act(() => container.querySelector<HTMLButtonElement>('.monitor-setup-drawer .ui-drawer-header button')!.click());
  await act(async () => finish(response({ profile, status: { ...idle, running: true, port: 7793 }, commands: { posix: 'LATE_CHILD_START', powershell: 'late' } })));
  expect(container.textContent).not.toContain('LATE_CHILD_START');expect(button(container, 'Start proxy').disabled).toBe(true);
  await act(async () => button(container, 'Refresh monitor status').click());expect(button(container, 'Start proxy').disabled).toBe(false);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
