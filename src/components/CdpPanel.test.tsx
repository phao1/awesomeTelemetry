import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CdpPanel } from './CdpPanel.js';

const roots: Root[] = [];
const idle = { state: 'idle', discovering: false, targetCount: 0, connectedTargetCount: 0 };
const body = '<script>window.pwned=true</script>中文';
const item = { id: 1, targetId: 'synthetic', url: 'https://synthetic.invalid/a', capturedAt: '2026-10-20T00:00:00.000Z', bodyBytes: new TextEncoder().encode(body).length };
const page = { items: [item], totalBytes: item.bodyBytes, rejectedCount: 2, lastIssue: 'capture_limit' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function render() {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
  act(() => root.render(<CdpPanel locale="en" />));
  return { container, root };
}
async function toggle(container: Element, open: boolean) {
  await act(async () => { const details = container.querySelector('details')!; details.open = open; details.dispatchEvent(new Event('toggle')); });
}
async function click(container: Element, text: string) {
  await act(async () => { const button = [...container.querySelectorAll('button')].find(button => button.textContent === text); expect(button).toBeDefined(); button!.click(); });
}
function transport() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) return response(idle);
    if (url.endsWith('/targets')) return response({ items: [] });
    if (url.endsWith('/captures')) return response(page);
    if (url.endsWith('/captures/1')) return response({ ...item, body });
    if (url.endsWith('/start')) { expect(init?.method).toBe('POST'); expect(JSON.parse(String(init?.body))).toEqual({ port: 9222 }); return response({ ...idle, state: 'running' }); }
    if (url.endsWith('/stop')) return response(idle);
    throw Error('Unexpected synthetic request ' + url);
  });
}
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('explicit development CDP workspace', () => {
  it('opens without IO, refreshes bounded metadata explicitly and reads only a selected inert response', async () => {
    const fetcher = transport(); vi.stubGlobal('fetch', fetcher); const f = render();
    expect(fetcher).not.toHaveBeenCalled(); await toggle(f.container, true); expect(fetcher).not.toHaveBeenCalled();
    const start = [...f.container.querySelectorAll('button')].find(button => button.textContent === 'Start CDP')!; expect(start.disabled).toBe(true);
    await click(f.container, 'Refresh status and responses'); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(f.container.textContent).toContain('Rejected responses: 2'); expect(f.container.textContent).toContain('capture_limit'); expect(f.container.textContent).not.toContain(body);
    await click(f.container, '#1 · ' + item.url); expect(fetcher).toHaveBeenCalledTimes(4); expect(fetcher.mock.calls[3]?.[0]).toBe('/api/cdp/captures/1');
    expect(f.container.querySelector('pre')!.textContent).toBe(body); expect(f.container.querySelector('script')).toBeNull();
    expect(f.container.textContent).toContain('Body acquired at (UTC)');
    await click(f.container, 'A+'); expect(f.container.querySelector('pre')!.style.fontSize).toBe('15px');
    act(() => f.root.render(<CdpPanel locale="zh" />)); expect(fetcher).toHaveBeenCalledTimes(4); expect(f.container.textContent).toContain('正文获取时间');
  });
  it('performs explicit start/stop, without automatic reads, polling or locale retries', async () => {
    const fetcher = transport(); vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true);
    await click(f.container, 'Refresh status and responses'); await click(f.container, 'Start CDP');
    expect(fetcher).toHaveBeenCalledTimes(4); expect(f.container.textContent).toContain('Manager enabled');
    await click(f.container, 'Stop CDP'); expect(fetcher).toHaveBeenCalledTimes(5); expect(f.container.textContent).toContain('Stopped');
    act(() => f.root.render(<CdpPanel locale="zh" />)); expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('shows production dev-only guidance and allows an explicit read retry', async () => {
    const fetcher = vi.fn(async () => response({ error: { code: 'ROUTE_NOT_FOUND', message: 'No route' } }, 404)); vi.stubGlobal('fetch', fetcher);
    const f = render(); await toggle(f.container, true); await click(f.container, 'Refresh status and responses');
    expect(f.container.textContent).toContain('npm run dev'); expect(f.container.textContent).toContain('ROUTE_NOT_FOUND');
    fetcher.mockImplementation(async () => response(idle));
    // Return valid per-route metadata on the explicit retry.
    vi.stubGlobal('fetch', transport()); await click(f.container, 'Refresh status and responses'); expect(f.container.textContent).not.toContain('ROUTE_NOT_FOUND');
  });
  it('keeps a cancelled mutation uncertain and ignores late success until explicit status reconciliation', async () => {
    let release: (value: Response) => void = () => undefined; let signal: AbortSignal | null | undefined;
    const base = transport(), fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('/start') ? new Promise<Response>(resolve => { release = resolve; signal = init?.signal; }) : base(url, init));
    vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true); await click(f.container, 'Refresh status and responses');
    await click(f.container, 'Start CDP'); await click(f.container, 'Cancel waiting'); expect(signal?.aborted).toBe(true);
    await act(async () => release(response({ ...idle, state: 'running' })));
    expect(f.container.textContent).toContain('Command outcome is unknown'); expect(f.container.textContent).not.toContain('Manager enabled');
    expect([...f.container.querySelectorAll('button')].find(button => button.textContent === 'Start CDP')!.disabled).toBe(true);
    await click(f.container, 'Refresh status and responses'); expect(f.container.textContent).not.toContain('Command outcome is unknown');
  });
  it('times out local control waits and aborts selected reads when collapsed', async () => {
    vi.useFakeTimers(); const base = transport(); let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('/start') || url.endsWith('/captures/1') ? new Promise<Response>(() => { signal = init?.signal; }) : base(url, init));
    vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true); await click(f.container, 'Refresh status and responses');
    await click(f.container, 'Start CDP'); await act(async () => vi.advanceTimersByTimeAsync(12000));
    expect(f.container.textContent).toContain('CDP_TIMEOUT'); expect(f.container.textContent).toContain('Command outcome is unknown'); expect(signal?.aborted).toBe(true);
    await click(f.container, 'Refresh status and responses'); await click(f.container, '#1 · ' + item.url); expect(signal?.aborted).toBe(false);
    await toggle(f.container, false); expect(signal?.aborted).toBe(true); expect(f.container.querySelector('[role="dialog"]')).toBeNull();
  });
});
