import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeSessionParentPage } from '../core/trace-types.js';
import { NativeSessionParentsPanel } from './NativeSessionParentsPanel.js';

const roots: Root[] = [];
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function page(state: NativeSessionParentPage['items'][number]['state'] = 'resolved'): NativeSessionParentPage {
  return { sessionKey: 'child', items: [{ identity: { id: 'a'.repeat(64), source: 'scan', sourceKey: 'child', namespace: 'agent:codex', kind: 'parent_session', value: '<img src=x> native-parent', scope: 'native-child', eventId: null, sourcePath: 'events[0].payload.parent_thread_id' }, state,
    matches: [{ id: 'parent-key', provider: 'codex', sourceAgent: 'Codex', title: '<script>parent title</script>', startedAt: '2026-10-16T00:00:00.000Z' }], matchesTruncated: false }], nextCursor: 'a'.repeat(64), hasMore: true, completeness: { complete: state === 'resolved', omittedCount: state === 'resolved' ? 0 : 1, reasons: state === 'resolved' ? [] : ['synthetic_incomplete'] } };
}
function response(value: unknown): Response { return { ok: true, status: 200, text: async () => JSON.stringify(value) } as Response; }
async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function render(locale: 'zh' | 'en' = 'en') {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root); const open = vi.fn();
  act(() => root.render(<NativeSessionParentsPanel sessionKey="child" locale={locale} onOpenSession={open} />));
  return { root, container, open };
}
function button(container: Element, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text)); expect(found, text).toBeDefined(); return found!;
}

describe('native parent reference exploration', () => {
  it('loads one metadata page and opens only a resolved declared parent without interpreting it as spawn evidence', async () => {
    const fetchMock = vi.fn(async (_url: string) => response(page())); vi.stubGlobal('fetch', fetchMock);
    const { container, open } = render(); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/child/parents']);
    expect(container.textContent).toContain('not proof of spawning');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-native-parent-reference]')!.click());
    expect(container.textContent).toContain('events[0].payload.parent_thread_id');
    expect(container.textContent).toContain('native-child');
    expect(container.textContent).toContain('<script>parent title</script>'); expect(container.querySelector('script,img')).toBeNull();
    await act(async () => button(container, 'Open resolved parent').click()); expect(open).toHaveBeenCalledWith('parent-key'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['unresolved', 'ambiguous', 'incomplete'] as const)('never makes a %s candidate owner a direct navigation action', async state => {
    vi.stubGlobal('fetch', vi.fn(async () => response(page(state)))); const { container, open } = render(); await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-native-parent-reference]')!.click());
    expect(container.textContent).toContain('synthetic_incomplete');
    expect([...container.querySelectorAll('button')].some(node => node.textContent?.includes('Open resolved parent'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
  it('uses the exclusive identity cursor and refreshes from the first page without per-candidate requests', async () => {
    const fetchMock = vi.fn(async (_url: string) => response(page())); vi.stubGlobal('fetch', fetchMock);
    const { container } = render(); await flush();
    await act(async () => button(container, 'Next references').click()); await flush();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/sessions/child/parents?cursor=' + 'a'.repeat(64));
    await act(async () => button(container, 'Refresh parent references').click()); await flush();
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/sessions/child/parents');
  });
  it('does not refetch on locale changes and hides invalidated conclusions until explicit refresh', async () => {
    const fetchMock = vi.fn(async () => response(page())); vi.stubGlobal('fetch', fetchMock);
    const { container, root, open } = render(); await flush();
    act(() => root.render(<NativeSessionParentsPanel sessionKey="child" locale="zh" onOpenSession={open} />)); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('父级');
    act(() => root.render(<NativeSessionParentsPanel sessionKey="child" locale="en" onOpenSession={open} invalidateKey={1} />)); await flush();
    expect(container.textContent).toContain('changed'); expect(container.querySelector('[data-native-parent-reference]')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button(container, 'Refresh parent references').click()); await flush(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('aborts a stalled read after five seconds and ignores its late result while allowing a local retry', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementationOnce(() => delayed).mockResolvedValue(response(page()));
    vi.stubGlobal('fetch', fetchMock); const { container } = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true); expect(container.querySelector('[role="alert"]')?.textContent).toContain('5 seconds');
    await act(async () => { resolve(response(page())); await delayed; }); expect(container.querySelector('[data-native-parent-reference]')).toBeNull();
    await act(async () => button(container, 'Retry').click()); await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[data-native-parent-reference]')).not.toBeNull();
  });
  it('drops a late read after unmount/source change instead of restoring another session parent', async () => {
    let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes('/child/') ? delayed : response({ ...page(), sessionKey: 'other', items: [] }));
    vi.stubGlobal('fetch', fetchMock); const { container, root, open } = render();
    act(() => root.render(<NativeSessionParentsPanel sessionKey="other" locale="en" onOpenSession={open} />)); await flush();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => { resolve(response(page())); await delayed; });
    expect(container.querySelector('[data-native-parent-reference]')).toBeNull(); expect(container.textContent).not.toContain('native-parent');
  });
  it('rejects a late same-session result after evidence invalidation without refetching', async () => {
    let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => delayed); vi.stubGlobal('fetch', fetchMock);
    const { container, root, open } = render();
    act(() => root.render(<NativeSessionParentsPanel sessionKey="child" locale="en" onOpenSession={open} invalidateKey={1} />)); await flush();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => { resolve(response(page())); await delayed; });
    expect(container.querySelector('[data-native-parent-reference]')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('shows an ordinary local read failure and clears it on explicit successful retry', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValueOnce({ ok: false, status: 503, text: async () => JSON.stringify({ error: { code: 'EXECUTION_METADATA_LIMIT', message: 'Synthetic metadata limit' } }) } as Response).mockResolvedValue(response(page()));
    vi.stubGlobal('fetch', fetchMock); const { container } = render(); await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Synthetic metadata limit');
    await act(async () => button(container, 'Retry').click()); await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('virtualizes a full reference page and selected candidate owners under 500 DOM nodes', async () => {
    const full = page('ambiguous'); full.items = Array.from({ length: 50 }, (_, index) => ({ ...full.items[0]!, identity: { ...full.items[0]!.identity, id: index.toString(16).padStart(64, '0'), value: 'parent-' + index }, matches: Array.from({ length: 20 }, (_, candidate) => ({ ...full.items[0]!.matches[0]!, id: 'candidate-' + candidate })) }));
    vi.stubGlobal('fetch', vi.fn(async () => response(full))); const { container } = render(); await flush();
    expect(container.querySelectorAll('[data-native-parent-reference]').length).toBeLessThan(25);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-native-parent-reference]')!.click());
    expect(container.querySelectorAll('*').length).toBeLessThan(500);
  });
  it('shows an empty page without classifying missing parent declarations as root', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...page(), items: [], hasMore: false, nextCursor: null })));
    const { container } = render(); await flush(); expect(container.textContent).toContain('No retained parent declaration'); expect(container.textContent).toContain('not proof of spawning');
  });
});
