import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FridaCaptureInspector } from './FridaCaptureInspector.js';
import type { FridaCapture } from '../core/trace-types.js';
const cleanup: Array<() => void> = [];
const fixture = (id = 1, jsonData = '{"text":"<img src=x onerror=alert(1)>"}'): FridaCapture => ({ id, pid: 12, capturedAt: '2026-10-20T00:00:00.000Z', captureType: 'chat', jsonData, model: null, sessionId: null, captureSessionId: 'local-run', messageCount: null, tokens: null });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function flush() { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); }
function mount() {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), close = vi.fn();
  const render = (id = 1, locale: 'en' | 'zh' = 'en') => act(() => root.render(<FridaCaptureInspector id={id} locale={locale} onClose={close}/>));
  render(); const unmount = () => { act(() => root.unmount()); host.remove(); }; cleanup.push(unmount); return { host, render, close, unmount: () => { cleanup.splice(cleanup.indexOf(unmount), 1); unmount(); } };
}
function button(host: Element, text: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!; }
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Frida selected detail with real API client', () => {
  it('loads only selected id, renders inert original text and does not refetch on locale change', async () => {
    const fetch = vi.fn().mockResolvedValue(response(fixture())); vi.stubGlobal('fetch', fetch);
    const view = mount(); await flush(); expect(fetch.mock.calls[0]?.[0]).toBe('/api/frida/captures/1'); expect(view.host.querySelector('pre')?.textContent).toBe(fixture().jsonData); expect(view.host.querySelector('img')).toBeNull();
    view.render(1, 'zh'); await flush(); expect(fetch).toHaveBeenCalledTimes(1); expect(view.host.textContent).toContain('原生会话');
  });
  it('bounds multibyte text to64KiB and explicitly expands without another read; fonts stay8..28', async () => {
    const jsonData = JSON.stringify({ text: '中😀'.repeat(20000) }), fetch = vi.fn().mockResolvedValue(response(fixture(1, jsonData))); vi.stubGlobal('fetch', fetch);
    const view = mount(); await flush(); expect(new TextEncoder().encode(view.host.querySelector('pre')!.textContent!).length).toBeLessThanOrEqual(65536);
    act(() => button(view.host, 'Expand full retained JSON').click()); expect(view.host.querySelector('pre')?.textContent).toBe(jsonData); expect(fetch).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) act(() => button(view.host, 'A+').click()); expect(view.host.querySelector('pre')?.style.fontSize).toBe('28px');
    for (let i = 0; i < 30; i++) act(() => button(view.host, 'A−').click()); expect(view.host.querySelector('pre')?.style.fontSize).toBe('8px');
    act(() => button(view.host, 'R').click()); expect(view.host.querySelector('pre')?.style.fontSize).toBe('12px');
  });
  it('timeouts ignore-abort transports, hides late body and retries explicitly', async () => {
    vi.useFakeTimers(); let finish!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done; })).mockResolvedValue(response(fixture())); vi.stubGlobal('fetch', fetch);
    const view = mount(); await flush(); const signal = (fetch.mock.calls[0]?.[1] as RequestInit).signal;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(signal?.aborted).toBe(true); expect(view.host.textContent).toContain('FRIDA_READ_TIMEOUT');
    finish(response(fixture())); await flush(); expect(view.host.querySelector('pre')).toBeNull();
    act(() => button(view.host, 'Retry / refresh').click()); await flush(); expect(fetch).toHaveBeenCalledTimes(2); expect(view.host.textContent).not.toContain('FRIDA_READ_TIMEOUT'); expect(view.host.querySelector('pre')).not.toBeNull();
  });
  it('cancels local read and suppresses stale selected-id and unmounted results', async () => {
    const completions: Array<(value: Response) => void> = [], signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => { signals.push(init.signal as AbortSignal); return new Promise(done => { completions.push(done); }); }));
    const view = mount(); view.render(2); expect(signals[0]?.aborted).toBe(true);
    completions[0]!(response(fixture(1))); await flush(); expect(view.host.querySelector('pre')).toBeNull();
    act(() => button(view.host, 'Cancel read').click()); expect(signals[1]?.aborted).toBe(true); completions[1]!(response(fixture(2))); await flush(); expect(view.host.querySelector('pre')).toBeNull(); expect(view.host.textContent).toContain('FRIDA_READ_CANCELLED');
    act(() => button(view.host, 'Retry / refresh').click()); view.unmount(); expect(signals[2]?.aborted).toBe(true); completions[2]!(response(fixture(2))); await flush();
  });
  it('shows HTTP error and rejects mismatched detail identity instead of displaying it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: { code: 'ROUTE_NOT_FOUND', message: 'missing' } }, 404)).mockResolvedValueOnce(response(fixture(2))); vi.stubGlobal('fetch', fetch);
    const view = mount(); await flush(); expect(view.host.textContent).toContain('ROUTE_NOT_FOUND'); act(() => button(view.host, 'Retry / refresh').click()); await flush(); expect(view.host.textContent).toContain('FRIDA_RESPONSE_INVALID'); expect(view.host.querySelector('pre')).toBeNull();
  });
});
