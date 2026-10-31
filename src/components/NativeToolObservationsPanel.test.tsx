import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeToolObservationPage } from '../core/native-tool-observations.js';
import { NativeToolObservationsPanel } from './NativeToolObservationsPanel.js';

const roots: Root[] = [];
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
const identity = { namespace: 'protocol:openai', value: 'call/a &b', scope: 'native-s' };
function page(sequence = 1): NativeToolObservationPage {
  return { sessionKey: 's', identity, state: 'retained_reference', events: [{ id: 'event-' + sequence, sessionId: 's', sequence, turnKey: null, kind: 'tool', phase: 'understand', title: 'Inspect file', tool: 'read_file', actor: 'assistant', startedAt: '2026-10-19T00:00:00Z', durationMs: 0, status: 'unknown', tokens: null, error: null, hasInput: true, hasOutput: false, hasRaw: true }], eventTotal: 2, identities: [], completeness: { complete: true, omittedCount: 0, reasons: [] }, nextCursor: sequence === 1 ? 1 : null, hasMore: sequence === 1 };
}
const response = (value: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(value) }) as Response;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
function mount() {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
  const props = { sessionKey: 's', identity, locale: 'en' as const, onSelect: vi.fn() };
  act(() => root.render(<NativeToolObservationsPanel {...props} />)); return { root, container, props };
}
function click(container: Element, text: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!; expect(button).toBeDefined(); act(() => button.click()); }
describe('cross-page native tool evidence', () => {
  it('reads bounded metadata with opaque IDs and actual cursors; selection alone does not read a body', async () => {
    const fetchMock = vi.fn(async (url: string) => response(page(url.includes('cursor=1&') ? 222 : 1))); vi.stubGlobal('fetch', fetchMock);
    const f = mount(); await flush(); expect(fetchMock).toHaveBeenCalledTimes(1);
    const query = new URL(fetchMock.mock.calls[0]![0], 'http://127.0.0.1').searchParams;
    expect(query.get('value')).toBe(identity.value); expect(query.get('scope')).toBe(identity.scope); expect(query.get('limit')).toBe('20');
    click(f.container, 'Next evidence page'); await flush(); expect(fetchMock.mock.calls[1]![0]).toContain('cursor=1&');
    act(() => f.container.querySelector<HTMLButtonElement>('.native-tool-members button')!.click());
    expect(f.props.onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'event-222', sequence: 222 })); expect(fetchMock).toHaveBeenCalledTimes(2);
    click(f.container, 'Previous evidence page'); await flush(); expect(fetchMock.mock.calls[2]![0]).toContain('cursor=0&');
  });
  it.each(['incomplete', 'ambiguous', 'unresolved'] as const)('retains explicit %s without execution conclusions', async state => {
    const value = page(); value.state = state; value.events = []; value.hasMore = false; value.nextCursor = null; value.completeness = { complete: false, omittedCount: 1, reasons: ['source_incomplete'] };
    vi.stubGlobal('fetch', vi.fn(async () => response(value))); const f = mount(); await flush();
    expect(f.container.textContent).toContain('source_incomplete'); expect(f.container.textContent).toContain('No retained member');
    expect(f.container.textContent).toContain('do not prove complete execution'); expect(f.props.onSelect).not.toHaveBeenCalled();
  });
  it('supports explicit error retry without automatic retry', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(response(page())); vi.stubGlobal('fetch', fetchMock); const f = mount(); await flush();
    expect(f.container.textContent).toContain('offline'); expect(fetchMock).toHaveBeenCalledTimes(1);
    click(f.container, 'Retry cross-page read'); await flush(); expect(f.container.querySelector('[role="alert"]')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(['cancel', 'timeout'] as const)('releases %s waits and suppresses ignored-abort results', async mode => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void; let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(done => { resolve = done; }); }); vi.stubGlobal('fetch', fetchMock); const f = mount();
    if (mode === 'cancel') click(f.container, 'Cancel read'); else await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(signal?.aborted).toBe(true); expect(f.container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => { resolve(response(page())); await Promise.resolve(); });
    expect(f.container.querySelector('.native-tool-members')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('aborts changed identity ownership and never restores the previous evidence', async () => {
    let resolve!: (value: Response) => void; let signal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(done => { resolve = done; }); }).mockResolvedValue(response({ ...page(), identity: { ...identity, value: 'new' } }));
    vi.stubGlobal('fetch', fetchMock); const f = mount();
    act(() => f.root.render(<NativeToolObservationsPanel {...f.props} identity={{ ...identity, value: 'new' }} />)); await flush();
    expect(signal?.aborted).toBe(true); await act(async () => { resolve(response({ ...page(), eventTotal: 999 })); });
    expect(f.container.textContent).not.toContain('999'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('changes locale without a read and aborts the owned read on unmount', async () => {
    let signal: AbortSignal | undefined; const fetchMock = vi.fn((_url: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(() => {}); }); vi.stubGlobal('fetch', fetchMock); const f = mount();
    act(() => f.root.render(<NativeToolObservationsPanel {...f.props} locale="zh" />)); expect(f.container.textContent).toContain('同一原生 ID 的跨页证据'); expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => f.root.render(<div />)); expect(signal?.aborted).toBe(true);
  });
  it.each(['owner', 'cursor'] as const)('rejects a mismatched %s response', async mismatch => {
    const value = page(); if (mismatch === 'owner') value.sessionKey = 'other'; else value.nextCursor = 500;
    vi.stubGlobal('fetch', vi.fn(async () => response(value))); const f = mount(); await flush(); expect(f.container.textContent).toContain('INVALID_TOOL_OBSERVATIONS'); expect(f.container.querySelector('.native-tool-members')).toBeNull();
  });
});
