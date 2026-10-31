import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CaptureExportControl } from './CaptureExportControl.js';

const packageJson = (id = 7) => ({ format: 'awesome-telemetry.capture-evidence', formatVersion: 1, exportedAt: '2026-10-16T00:00:00.000Z', schemaVersion: 17,
  request: { id }, capture: { request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} },
  originalDeletion: { state: 'complete' }, analysis: null, analysisUnavailableReason: 'original_deleted',
  identities: { items: [], hasMore: false }, traceLinks: { items: [], hasMore: false }, limitations: ['original_bodies_not_included'] });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let blobs: Blob[];
let revoke: ReturnType<typeof vi.fn>;
let clicks: Array<{ href: string; filename: string }>;
const render = async (id = 7, blocked = false, locale: 'zh' | 'en' = 'en', metadataOnly = false) => act(async () => root.render(<CaptureExportControl id={id} blocked={blocked} locale={locale} metadataOnly={metadataOnly} />));
const clickExport = async () => act(async () => { (container.querySelector('button') as HTMLButtonElement).click(); });
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  blobs = []; clicks = []; revoke = vi.fn();
  const BaseURL = URL;
  vi.stubGlobal('URL', Object.assign(class extends BaseURL {}, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:local-export-' + blobs.length; }), revokeObjectURL: revoke }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push({ href: this.href, filename: this.download }); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('explicit local evidence download', () => {
  it('does not fetch until clicked, including blocked state, and explains local/no-inline scope in both languages', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await render(7, true); expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    await clickExport(); expect(fetcher).not.toHaveBeenCalled(); expect(container.textContent).toContain('separately');
    await render(7, false, 'zh'); expect(container.textContent).toContain('原文'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends exactly one request, saves the versioned metadata-only deletion package and owns object-URL cleanup', async () => {
    const fetcher = vi.fn(async () => jsonResponse(packageJson())); vi.stubGlobal('fetch', fetcher);
    await render(); await clickExport();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledWith('/api/proxy/requests/7/export', { signal: expect.any(AbortSignal), cache: 'no-store' });
    expect(clicks).toEqual([{ href: 'blob:local-export-1', filename: 'capture-7.json' }]);
    expect(JSON.parse(await blobs[0]!.text())).toEqual(packageJson());
    expect(container.textContent).toContain('Download requested'); expect(container.textContent).toContain('not confirmed');
    expect(revoke).not.toHaveBeenCalled();
    act(() => root.unmount()); expect(revoke).toHaveBeenCalledWith('blob:local-export-1'); root = createRoot(container);
  });
  it('switches to explicit metadata mode by aborting a pending full export and rejecting its late result', async () => {
    let finishFull!: (value: Response) => void; let fullSignal!: AbortSignal;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('?mode=metadata')) return Promise.resolve(jsonResponse(packageJson()));
      fullSignal = init!.signal as AbortSignal;
      return new Promise<Response>(resolve => { finishFull = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    await render(); await clickExport(); await render(7, false, 'en', true);
    expect(fullSignal.aborted).toBe(true); expect(container.textContent).toContain('Metadata-only export');
    await act(async () => finishFull(jsonResponse(packageJson()))); expect(clicks).toHaveLength(0);
    await clickExport();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[1]?.[0]).toBe('/api/proxy/requests/7/export?mode=metadata');
    expect(clicks).toHaveLength(1);
  });
  it('rejects analysis in a metadata-only response even when no deletion intent exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...packageJson(), originalDeletion: null, analysis: { system: 'SHOULD_NOT_EXPORT' }, analysisUnavailableReason: null })));
    await render(7, false, 'en', true); await clickExport();
    expect(clicks).toHaveLength(0); expect(blobs).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('INVALID_EXPORT');
    expect(container.textContent).not.toContain('SHOULD_NOT_EXPORT');
  });
  it('blocks overlapping clicks, does not refetch/restart on locale changes, and exposes cancel', async () => {
    let resolve!: (value: Response) => void; let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(done => { resolve = done; }); }); vi.stubGlobal('fetch', fetcher);
    await render(); await clickExport(); await clickExport(); await render(7, false, 'zh');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(signal?.aborted).toBe(false);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '取消导出')!.click(); });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(jsonResponse(packageJson()))); expect(clicks).toHaveLength(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it('aborts and rejects late results on unknown/deleting availability, ID changes and unmount', async () => {
    const pending: Array<{ resolve: (value: Response) => void; signal: AbortSignal }> = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(resolve => { pending.push({ resolve, signal: init!.signal as AbortSignal }); })));
    await render(); await clickExport(); await render(7, true);
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () => pending[0]!.resolve(jsonResponse(packageJson()))); expect(clicks).toHaveLength(0);
    await render(7, false); await clickExport(); await render(8, false);
    expect(pending[1]!.signal.aborted).toBe(true);
    await act(async () => pending[1]!.resolve(jsonResponse(packageJson()))); expect(clicks).toHaveLength(0);
    await clickExport(); act(() => root.unmount()); expect(pending[2]!.signal.aborted).toBe(true);
    await act(async () => pending[2]!.resolve(jsonResponse(packageJson(8)))); expect(clicks).toHaveLength(0);
    root = createRoot(container);
  });
  it('times out after ten seconds even when transport ignores abort, rejects its late result and allows explicit retry', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetcher);
    vi.useFakeTimers(); await render(); await clickExport();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('10 seconds');
    expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => resolve(jsonResponse(packageJson()))); expect(clicks).toHaveLength(0);
    vi.useRealTimers(); fetcher.mockImplementation(async () => jsonResponse(packageJson()));
    await clickExport(); expect(fetcher).toHaveBeenCalledTimes(2); expect(clicks).toHaveLength(1);
  });
  it('shows the unified error code, retries only the explicit export, and never claims an errored response was downloaded', async () => {
    let succeed = false;
    const fetcher = vi.fn(async () => succeed ? jsonResponse(packageJson()) : jsonResponse({ error: { code: 'CAPTURE_EXPORT_LIMIT', message: 'static error' } }, 503)); vi.stubGlobal('fetch', fetcher);
    await render(); await clickExport(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('CAPTURE_EXPORT_LIMIT'); expect(clicks).toHaveLength(0);
    succeed = true; await clickExport(); expect(fetcher).toHaveBeenCalledTimes(2); expect(clicks).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(['wrong_id', 'wrong_format', 'bad_version', 'deleted_analysis', 'too_large'])('refuses malformed or unsafe successful payloads: %s', async kind => {
    const value = packageJson();
    if (kind === 'wrong_id') value.request.id = 8;
    if (kind === 'wrong_format') value.format = 'unrelated';
    if (kind === 'bad_version') value.formatVersion = 2;
    if (kind === 'deleted_analysis') Object.assign(value, { analysis: { system: 'DELETED_SECRET' } });
    if (kind === 'too_large') Object.assign(value, { padding: 'x'.repeat(4 * 1024 * 1024) });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(value)));
    await render(); await clickExport(); expect(clicks).toHaveLength(0); expect(blobs).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('DELETED_SECRET');
  });
});
