import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureBundleControl } from './CaptureBundleControl.js';
import type { CaptureBundlePlan } from '../core/capture-bundle.js';

const roots: Root[] = [];
function plan(mode: 'originals' | 'metadata' = 'originals'): CaptureBundlePlan {
  return { format: 'awesome-telemetry.capture-bundle', formatVersion: 1, proxyId: 1, requestId: 'synthetic', generatedAt: '2026-10-20T00:00:00.000Z', revision: 'a'.repeat(64), mode,
    files: [{ path: 'evidence.json', bytes: 12, sha256: 'b'.repeat(64) }, { path: 'README.txt', bytes: 15, sha256: 'c'.repeat(64) }, ...(mode === 'originals' ? [{ path: 'originals/request.body', bytes: 104857600, sha256: 'd'.repeat(64) }] : [])],
    originalBytes: mode === 'originals' ? 104857600 : 0, omissions: ['source_history_completeness_unknown', 'bounded_metadata_pages'] };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function render() {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  act(() => root.render(<CaptureBundleControl id={1} locale="en" blocked={false} />)); return { container, root };
}
async function click(container: Element, text: string) {
  await act(async () => { const button = [...container.querySelectorAll('button')].find(value => value.textContent === text); expect(button).toBeDefined(); button!.click(); });
}
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('CB-005 native streaming bundle workflow', () => {
  it('prepares metadata only on explicit action and offers a source-bound native link without a body fetch or Blob', async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => response(plan())); vi.stubGlobal('fetch', fetcher);
    const f = render(); expect(fetcher).not.toHaveBeenCalled(); expect(f.container.querySelector('a')).toBeNull();
    await click(f.container, 'Prepare original bundle'); expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/proxy/requests/1/bundle/manifest?mode=originals');
    const anchor = f.container.querySelector('a')!; expect(anchor.download).toBe('capture-1.tar');
    const url = new URL(anchor.href); expect(url.pathname).toBe('/api/proxy/requests/1/bundle'); expect(url.searchParams.get('at')).toBe(plan().generatedAt); expect(url.searchParams.get('revision')).toBe(plan().revision);
    expect(f.container.textContent).toContain('104,857,600'); expect(f.container.textContent).toContain('originals/request.body'); expect(f.container.textContent).toContain('source_history_completeness_unknown');
    anchor.addEventListener('click', event => event.preventDefault()); act(() => anchor.click());
    expect(fetcher).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain('Saving is unconfirmed');
    act(() => f.root.render(<CaptureBundleControl id={1} locale="zh" blocked={false} />)); expect(fetcher).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain('下载 tar 证据包');
  });
  it('removes stale links on source invalidation and blocked/deleted mode transitions', async () => {
    const fetcher = vi.fn(async (url: string) => response(plan(url.endsWith('mode=metadata') ? 'metadata' : 'originals'))); vi.stubGlobal('fetch', fetcher);
    const f = render(); await click(f.container, 'Prepare original bundle'); expect(f.container.querySelector('a')).not.toBeNull();
    act(() => f.root.render(<CaptureBundleControl id={1} locale="en" blocked={true} />)); expect(f.container.querySelector('a')).toBeNull();
    act(() => f.root.render(<CaptureBundleControl id={1} locale="en" blocked={false} metadataOnly />));
    await click(f.container, 'Prepare metadata bundle'); expect(fetcher).toHaveBeenCalledTimes(2); expect(f.container.querySelector('a')!.href).toContain('mode=metadata'); expect(f.container.textContent).not.toContain('originals/request.body');
    act(() => f.root.render(<CaptureBundleControl id={1} locale="en" blocked={false} metadataOnly invalidateKey={1} />)); expect(f.container.querySelector('a')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects wrong-owner, traversal, unexpected-original and oversized plans without a download link', async () => {
    const invalid = [ { ...plan(), proxyId: 2 }, { ...plan(), files: [...plan().files, { path: '../../private.key', bytes: 1, sha256: 'e'.repeat(64) }] }, { ...plan(), originalBytes: 0 }, { ...plan(), omissions: ['x'.repeat(70000)] } ];
    const fetcher = vi.fn(async () => response(invalid.shift())); vi.stubGlobal('fetch', fetcher); const f = render();
    for (let index = 0; index < 4; index++) { await click(f.container, 'Prepare original bundle'); expect(f.container.querySelector('a')).toBeNull(); expect(f.container.querySelector('[role="alert"]')).not.toBeNull(); }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('cancels, times out and suppresses late plans across source changes', async () => {
    vi.useFakeTimers(); let release: (response: Response) => void = () => undefined; let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_url: string, options?: RequestInit) => { signal = options?.signal; return new Promise<Response>(resolve => { release = resolve; }); }); vi.stubGlobal('fetch', fetcher);
    const f = render(); await click(f.container, 'Prepare original bundle'); await click(f.container, 'Cancel preparation'); expect(signal?.aborted).toBe(true);
    await act(async () => release(response(plan()))); expect(f.container.querySelector('a')).toBeNull();
    await click(f.container, 'Prepare original bundle'); await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(signal?.aborted).toBe(true); expect(f.container.textContent).toContain('exceeded 5 seconds');
    await act(async () => release(response(plan()))); expect(f.container.querySelector('a')).toBeNull();
    await click(f.container, 'Prepare original bundle'); act(() => f.root.render(<CaptureBundleControl id={2} locale="en" blocked={false} />)); expect(signal?.aborted).toBe(true);
    await act(async () => release(response(plan()))); expect(f.container.querySelector('a')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('displays a stable server error and retries only after a new explicit preparation', async () => {
    const fetcher = vi.fn(async () => response({ error: { code: 'CAPTURE_ORIGINALS_DELETED', message: 'Deleted' } }, 409)); vi.stubGlobal('fetch', fetcher);
    const f = render(); await click(f.container, 'Prepare original bundle'); expect(f.container.textContent).toContain('CAPTURE_ORIGINALS_DELETED'); expect(f.container.querySelector('a')).toBeNull();
    fetcher.mockImplementation(async () => response(plan())); await click(f.container, 'Prepare original bundle'); expect(fetcher).toHaveBeenCalledTimes(2); expect(f.container.querySelector('a')).not.toBeNull(); expect(f.container.textContent).not.toContain('CAPTURE_ORIGINALS_DELETED');
  });
});
