import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceExportPanel } from './TraceExportPanel.js';
import type { TraceExportPanelProps } from './TraceExportPanel.js';
import { buildTraceExport, TRACE_EXPORT_MAX_BYTES } from '../core/trace-export.js';
import type { TraceExportPage } from '../core/trace-export.js';

const roots: Root[] = [];
const stamp = '2026-10-19T00:00:00.000Z';
const createUrl = vi.fn(() => 'blob:synthetic-export');
const revokeUrl = vi.fn();
let download: ReturnType<typeof vi.spyOn>;
function payload(sessionKey = 'scan-key', extra: Partial<TraceExportPage> = {}) {
  return buildTraceExport({ session: { id: sessionKey, provider: 'codex', updatedAt: stamp, durationSource: 'unknown' }, detailLoaded: true,
    declaredEventCount: 2, eventTotal: 2, offset: 0, limit: 100, events: [{ id: 'event-1', sequence: 1, kind: 'tool', phase: 'implement', startedAt: stamp, durationMs: 0, status: 'unknown' }], ...extra },
  { traceId: 'a'.repeat(32), spanId: () => 'b'.repeat(16) }, stamp);
}
const response = (value = payload(), status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function render(props: Partial<TraceExportPanelProps> = {}) {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  const initial: TraceExportPanelProps = { sessionKey: 'scan-key', locale: 'en', ...props };
  act(() => root.render(<TraceExportPanel {...initial} />));
  return { container, root, props: initial };
}
async function click(container: Element, text: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === text);
    expect(button, text).toBeDefined(); button!.click();
  });
}
function input(container: Element, index: number, value: string) {
  act(() => {
    const field = container.querySelectorAll('input')[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  createUrl.mockClear(); revokeUrl.mockClear();
  const BaseURL = URL;
  vi.stubGlobal('URL', class extends BaseURL { static override createObjectURL = createUrl; static override revokeObjectURL = revokeUrl; });
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount(); });
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

describe('explicit OTLP export browser workflow', () => {
  it('does not read on mount, disclosure, locale change or invalidation', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const f = render();
    act(() => f.container.querySelector('summary')!.click());
    act(() => f.root.render(<TraceExportPanel {...f.props} locale="zh" invalidateKey={1} />));
    expect(fetcher).not.toHaveBeenCalled(); expect(f.container.textContent).toContain('不上传云端'); expect(f.container.textContent).toContain('观测时间点');
  });
  it('downloads only after action, displays partial coverage and selects next page without fetching', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => response()); vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download OTLP JSON');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/sessions/scan-key/trace-export?offset=0&limit=100');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(download).toHaveBeenCalledTimes(1); expect(createUrl).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).toContain('Partial retained metadata'); expect(f.container.textContent).toContain('saving is not confirmed');
    expect(document.querySelector('a')).toBeNull();
    await click(f.container, 'Select next page'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(f.container.querySelector('input')!.value).toBe('1'); expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-export');
    expect(f.container.textContent).not.toContain('Download requested');
  });
  it('requires canonical bounded page input and does not send an invalid request', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const f = render();
    for (const value of ['-1', '01', '1e2', '1000001', '']) {
      input(f.container, 0, value); expect(f.container.querySelector('button')!.disabled).toBe(true); expect(f.container.querySelector('[role=alert]')).not.toBeNull();
    }
    input(f.container, 0, '0'); input(f.container, 1, '201'); expect(f.container.querySelector('button')!.disabled).toBe(true);
    input(f.container, 1, '1'); expect(f.container.querySelector('button')!.disabled).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it('shows safe error codes with explicit retry and clears stale errors on success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SESSION_NOT_FOUND', message: 'SECRET INTERNAL TEXT' } }), { status: 404, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download OTLP JSON'); expect(f.container.textContent).toContain('SESSION_NOT_FOUND'); expect(f.container.textContent).not.toContain('SECRET INTERNAL TEXT');
    expect(download).not.toHaveBeenCalled(); await click(f.container, 'Retry local export');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(download).toHaveBeenCalledTimes(1); expect(f.container.querySelector('[role=alert]')).toBeNull();
  });
  it('cancels a pending export and suppresses the old response even when fetch ignores abort', async () => {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn((_url: string, _init: RequestInit) => promise); vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download OTLP JSON'); expect(f.container.textContent).toContain('Reading retained metadata');
    await click(f.container, 'Cancel export'); expect(f.container.textContent).toContain('Export cancelled');
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled();
    const options = fetcher.mock.calls[0]![1] as RequestInit; expect(options.signal!.aborted).toBe(true);
  });
  it('ends waiting at10s, exposes retry and suppresses a late download', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; }); vi.stubGlobal('fetch', vi.fn(() => promise)); const f = render();
    await click(f.container, 'Download OTLP JSON'); await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(f.container.textContent).toContain('exceeded 10 seconds'); expect(f.container.querySelector('button')!.disabled).toBe(false);
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled();
  });
  it.each(['session', 'invalidation', 'range', 'unmount'])('revokes pending ownership on %s change', async change => {
    let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn((_url: string, _init: RequestInit) => promise); vi.stubGlobal('fetch', fetcher); const f = render(); await click(f.container, 'Download OTLP JSON');
    if (change === 'range') input(f.container, 0, '1');
    else act(() => { if (change === 'unmount') f.root.render(null); else f.root.render(<TraceExportPanel {...f.props} sessionKey={change === 'session' ? 'other' : 'scan-key'} invalidateKey={change === 'invalidation' ? 1 : 0} />); });
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses mismatched identity, invalid JSON and bodies over the streaming byte cap', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(payload('other')))
      .mockResolvedValueOnce(new Response('not-json', { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('x'.repeat(TRACE_EXPORT_MAX_BYTES + 1), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download OTLP JSON'); expect(f.container.textContent).toContain('INVALID_EXPORT');
    await click(f.container, 'Retry local export'); expect(f.container.textContent).toContain('INVALID_EXPORT');
    await click(f.container, 'Retry local export'); expect(f.container.textContent).toContain('EXECUTION_METADATA_LIMIT'); expect(download).not.toHaveBeenCalled();
  });
  it('cancels an already-started response stream on timeout and allows a fresh explicit retry', async () => {
    vi.useFakeTimers(); const cancelStream = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel: cancelStream });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher); const f = render(); await click(f.container, 'Download OTLP JSON');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(cancelStream).toHaveBeenCalledTimes(1); expect(download).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain('exceeded 10 seconds');
    await click(f.container, 'Retry local export'); expect(download).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shows empty/unloaded/mismatched coverage in Chinese without claiming full source history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload('scan-key', { events: [], eventTotal: 0, declaredEventCount: 5, detailLoaded: false }))));
    const f = render({ locale: 'zh' }); await click(f.container, '下载 OTLP JSON');
    expect(f.container.textContent).toContain('本页没有可导出的观测记录'); expect(f.container.textContent).toContain('详情尚未全部加载');
    expect(f.container.textContent).toContain('索引数量与已存事件数量不一致'); expect(f.container.textContent).toContain('原始历史是否完整仍未知');
    expect(download).toHaveBeenCalledTimes(1);
  });
});
