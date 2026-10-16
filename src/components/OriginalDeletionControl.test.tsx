import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OriginalDeletionControl } from './OriginalDeletionControl.js';
import type { OriginalDeletionJob } from '../core/trace-types.js';

const roots: Root[] = [];
const job: OriginalDeletionJob = { id: '11111111-1111-4111-8111-111111111111', proxyId: 1, requestId: 'req-1', state: 'complete', error: null, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:00.000Z' };
function response(value: unknown, status = 200): Response { return { ok: status < 400, status, text: async () => JSON.stringify(value) } as Response; }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function button(container: HTMLElement, name: string): HTMLButtonElement { const result = [...container.querySelectorAll('button')].find(element => element.textContent === name); if (result === undefined) throw new Error('Missing button: ' + name); return result; }
function mount(overrides: Partial<React.ComponentProps<typeof OriginalDeletionControl>> = {}) {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  const onAvailability = vi.fn(); const props = { id: 1, requestId: 'req-1', locale: 'en' as const, monitorStopped: true, supported: true, onAvailability, ...overrides };
  act(() => root.render(<OriginalDeletionControl {...props} />));
  return { container, root, props, onAvailability };
}
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('explicit original body deletion control', () => {
  it('requires a separate acknowledgement, posts exact identity once and does not claim completion while pending', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? new Promise<Response>(resolve => { finish = resolve; }) : response(null)); vi.stubGlobal('fetch', fetcher);
    const { container, onAvailability } = mount(); await flush();
    act(() => button(container, 'Delete this request’s bodies').click());
    expect(button(container, 'Confirm body deletion').disabled).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('input'));
    expect(container.textContent).toContain('Headers, metrics, associations and native sessions remain'); expect(container.textContent).toContain('req-1');
    act(() => { (container.querySelector('input') as HTMLInputElement).click(); button(container, 'Confirm body deletion').click(); button(container, 'Confirm body deletion').click(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as string)).toEqual({ expectedRequestId: 'req-1', confirm: true });
    expect(onAvailability).toHaveBeenLastCalledWith('blocked'); expect(container.textContent).not.toContain('Bodies and prompt copies deleted; metadata retained.');
    await act(async () => { finish(response(job)); await Promise.resolve(); });
    expect(container.textContent).toContain('Bodies and prompt copies deleted'); expect(button(container, 'Retry body cleanup').disabled).toBe(true);
    expect(document.activeElement).toBe(button(container, 'Refresh deletion status'));
  });
  it('refuses running/unknown monitor and unsupported originals without polling or mutation', async () => {
    const fetcher = vi.fn(async () => response(null)); vi.stubGlobal('fetch', fetcher);
    const { container, root, props } = mount({ monitorStopped: false }); await flush();
    expect(button(container, 'Delete this request’s bodies').disabled).toBe(true); expect(container.textContent).toContain('Stop the monitor');
    act(() => root.render(<OriginalDeletionControl {...props} monitorStopped supported={false} />));
    expect(button(container, 'Delete this request’s bodies').disabled).toBe(true); expect(container.textContent).toContain('complete pair'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps failed cleanup explicit and requires confirmation again for a retry', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => response(init?.method === 'POST' ? job : { ...job, state: 'failed', error: 'CAPTURE_STORE_BUSY', completedAt: null })); vi.stubGlobal('fetch', fetcher);
    const { container, onAvailability } = mount(); await flush(); expect(onAvailability).toHaveBeenLastCalledWith('blocked'); expect(container.textContent).toContain('File cleanup failed');
    expect(fetcher).toHaveBeenCalledTimes(1); act(() => button(container, 'Retry body cleanup').click()); expect(button(container, 'Confirm body deletion').disabled).toBe(true);
    await act(async () => { (container.querySelector('input') as HTMLInputElement).click(); button(container, 'Confirm body deletion').click(); await Promise.resolve(); });
    expect(container.textContent).toContain('Bodies and prompt copies deleted');
  });
  it('does not unblock uncertain content after an unacknowledged POST and null status refresh', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === 'POST') throw new Error('lost transport'); return response(null); }); vi.stubGlobal('fetch', fetcher);
    const { container, onAvailability } = mount(); await flush();
    act(() => button(container, 'Delete this request’s bodies').click());
    await act(async () => { (container.querySelector('input') as HTMLInputElement).click(); button(container, 'Confirm body deletion').click(); await Promise.resolve(); });
    expect(container.textContent).toContain('unconfirmed'); expect(container.textContent).not.toContain('Bodies and prompt copies deleted');
    await act(async () => { button(container, 'Refresh deletion status').click(); await Promise.resolve(); }); expect(onAvailability).toHaveBeenLastCalledWith('blocked');
  });
  it('rejects an unrelated job response and allows explicit status refresh', async () => {
    let reads = 0; vi.stubGlobal('fetch', vi.fn(async () => response(++reads === 1 ? { ...job, proxyId: 99 } : null)));
    const { container, onAvailability } = mount(); await flush(); expect(container.textContent).toContain('INVALID_DELETION_STATUS'); expect(onAvailability).not.toHaveBeenCalledWith('available');
    await act(async () => { button(container, 'Refresh deletion status').click(); await Promise.resolve(); }); expect(onAvailability).toHaveBeenLastCalledWith('available');
  });
  it('returns focus on Escape without submitting', async () => {
    const fetcher = vi.fn(async () => response(null)); vi.stubGlobal('fetch', fetcher); const { container } = mount(); await flush();
    act(() => button(container, 'Delete this request’s bodies').click());
    act(() => container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('input')).toBeNull(); expect(document.activeElement).toBe(button(container, 'Delete this request’s bodies')); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('aborts status on unmount and never applies a late response to another request', async () => {
    let finish!: (value: Response) => void, signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(resolve => { finish = resolve; }); }));
    const { root, onAvailability } = mount(); act(() => root.unmount()); roots.splice(roots.indexOf(root), 1);
    expect(signal?.aborted).toBe(true); await act(async () => { finish(response(job)); await Promise.resolve(); }); expect(onAvailability).not.toHaveBeenCalledWith('blocked');
  });
});
