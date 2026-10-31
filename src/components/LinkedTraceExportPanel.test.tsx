import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedTraceExportPanel } from './LinkedTraceExportPanel.js';
import type { LinkedTraceExportPanelProps } from './LinkedTraceExportPanel.js';
import { TRACE_EXPORT_MAX_BYTES } from '../core/trace-export.js';
import type { TraceExportPage } from '../core/trace-export.js';
import { buildLinkedTraceExport } from '../core/linked-trace-export.js';

const roots: Root[] = [];
const stamp = '2026-10-19T00:00:00.000Z';
const createUrl = vi.fn(() => 'blob:synthetic-export');
const revokeUrl = vi.fn();
let download: ReturnType<typeof vi.spyOn>;
function payload(sessionKey = 'scan-key', extra: Partial<TraceExportPage> = {}) {
  const page: TraceExportPage = { session: { id: sessionKey, provider: 'codex', updatedAt: stamp, durationSource: 'unknown' }, detailLoaded: true,
    declaredEventCount: 2, eventTotal: 2, offset: 0, limit: 100, events: [{ id: 'event-1', sequence: 1, kind: 'tool', phase: 'implement', startedAt: stamp, durationMs: 0, status: 'unknown' }], ...extra };
  return buildLinkedTraceExport(page, { sessionKey, sessionDurationSource: 'unknown', events: page.events.map(e => ({ ...e, sessionId: sessionKey, turnKey: null, title: '', actor: '', tool: null, tokens: null, error: null, hasInput: false, hasOutput: false, hasRaw: false })),
    eventOffset: page.offset, eventLimit: page.limit, eventTotal: page.eventTotal, eventsHasMore: page.offset + page.events.length < page.eventTotal,
    attempts: [], capturesHasMore: false, nextCaptureCursor: null, identities: [], identityCompleteness: { complete: false, omittedCount: 1, reasons: ['identity_not_collected'] } },
    { eventOffset: page.offset, eventLimit: page.limit, captureLimit: 20 }, { scan: { traceId: 'a'.repeat(32), spanId: () => 'b'.repeat(16) }, network: () => ({ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) }) }, stamp);
}
const response = (value = payload(), status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function render(props: Partial<LinkedTraceExportPanelProps> = {}) {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  const initial: LinkedTraceExportPanelProps = { sessionKey: 'scan-key', locale: 'en', ...props };
  act(() => root.render(<LinkedTraceExportPanel {...initial} />));
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
    act(() => f.root.render(<LinkedTraceExportPanel {...f.props} locale="zh" invalidateKey={1} />));
    expect(fetcher).not.toHaveBeenCalled(); expect(f.container.textContent).toContain('不上传'); expect(f.container.textContent).toContain('观测点');
  });
  it('downloads only after action, displays partial coverage and selects next page without fetching', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => response()); vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download linked OTLP JSON');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/sessions/scan-key/linked-trace-export?eventOffset=0&eventLimit=100&captureLimit=20');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(download).toHaveBeenCalledTimes(1); expect(createUrl).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).toContain('Partial retained native metadata'); expect(f.container.textContent).toContain('saving is not confirmed');
    expect(document.querySelector('a')).toBeNull();
    await click(f.container, 'Select next native page'); expect(fetcher).toHaveBeenCalledTimes(1);
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
    await click(f.container, 'Download linked OTLP JSON'); expect(f.container.textContent).toContain('SESSION_NOT_FOUND'); expect(f.container.textContent).not.toContain('SECRET INTERNAL TEXT');
    expect(download).not.toHaveBeenCalled(); await click(f.container, 'Retry local export');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(download).toHaveBeenCalledTimes(1); expect(f.container.querySelector('[role=alert]')).toBeNull();
  });
  it('cancels a pending export and suppresses the old response even when fetch ignores abort', async () => {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn((_url: string, _init: RequestInit) => promise); vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download linked OTLP JSON'); expect(f.container.textContent).toContain('Reading retained metadata');
    await click(f.container, 'Cancel export'); expect(f.container.textContent).toContain('Export cancelled');
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled();
    const options = fetcher.mock.calls[0]![1] as RequestInit; expect(options.signal!.aborted).toBe(true);
  });
  it('ends waiting at10s, exposes retry and suppresses a late download', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; }); vi.stubGlobal('fetch', vi.fn(() => promise)); const f = render();
    await click(f.container, 'Download linked OTLP JSON'); await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(f.container.textContent).toContain('exceeded 10 seconds'); expect(f.container.querySelector('button')!.disabled).toBe(false);
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled();
  });
  it.each(['session', 'invalidation', 'range', 'unmount'])('revokes pending ownership on %s change', async change => {
    let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn((_url: string, _init: RequestInit) => promise); vi.stubGlobal('fetch', fetcher); const f = render(); await click(f.container, 'Download linked OTLP JSON');
    if (change === 'range') input(f.container, 0, '1');
    else act(() => { if (change === 'unmount') f.root.render(null); else f.root.render(<LinkedTraceExportPanel {...f.props} sessionKey={change === 'session' ? 'other' : 'scan-key'} invalidateKey={change === 'invalidation' ? 1 : 0} />); });
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses mismatched identity, invalid JSON and bodies over the streaming byte cap', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(payload('other')))
      .mockResolvedValueOnce(new Response('not-json', { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('x'.repeat(TRACE_EXPORT_MAX_BYTES + 1), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download linked OTLP JSON'); expect(f.container.textContent).toContain('INVALID_EXPORT');
    await click(f.container, 'Retry local export'); expect(f.container.textContent).toContain('INVALID_EXPORT');
    await click(f.container, 'Retry local export'); expect(f.container.textContent).toContain('EXECUTION_METADATA_LIMIT'); expect(download).not.toHaveBeenCalled();
  });
  it('cancels an already-started response stream on timeout and allows a fresh explicit retry', async () => {
    vi.useFakeTimers(); const cancelStream = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel: cancelStream });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher); const f = render(); await click(f.container, 'Download linked OTLP JSON');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(cancelStream).toHaveBeenCalledTimes(1); expect(download).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain('exceeded 10 seconds');
    await click(f.container, 'Retry local export'); expect(download).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shows empty/unloaded/mismatched coverage in Chinese without claiming full source history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload('scan-key', { events: [], eventTotal: 0, declaredEventCount: 5, detailLoaded: false }))));
    const f = render({ locale: 'zh' }); await click(f.container, '下载关联 OTLP JSON');
    expect(f.container.textContent).toContain('本页没有可导出的观测记录'); expect(f.container.textContent).toContain('详情尚未全部加载');
    expect(f.container.textContent).toContain('索引数量与已存事件数量不一致'); expect(f.container.textContent).toContain('源历史完整性与重试身份始终未知');
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('selects only the next capture cursor without downloading or changing native range', async () => {
    const data = payload();
    const attributes = data.resourceSpans[0]!.resource.attributes;
    const replace = (key: string, value: (typeof attributes)[number]['value']) => { attributes.find(a => a.key === 'awesome_telemetry.' + key)!.value = value; };
    replace('capture_page.returned', { intValue: '2' }); replace('capture_page.omitted_invalid_time', { intValue: '2' });
    replace('capture_page.proxy_ids', { stringValue: '[9,8]' }); replace('capture_page.has_more', { boolValue: true }); replace('capture_page.partial', { boolValue: true });
    attributes.push({ key: 'awesome_telemetry.capture_page.next_cursor', value: { intValue: '8' } });
    const fetcher = vi.fn(async () => response(data)); vi.stubGlobal('fetch', fetcher); const f = render();
    await click(f.container, 'Download linked OTLP JSON'); expect(download).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).toContain('Partial capture coverage'); expect(f.container.textContent).toContain('identity_not_collected');
    await click(f.container, 'Select next capture page'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect([...f.container.querySelectorAll('input')].map(i => i.value)).toEqual(['0', '100', '8']);
    await click(f.container, 'Download linked OTLP JSON');
    expect(fetcher).toHaveBeenCalledTimes(2); // Response still describes first page: owner/range validator must reject it.
    expect(f.container.textContent).toContain('INVALID_EXPORT'); expect(download).toHaveBeenCalledTimes(1);
  });
  it('validates safe cursor input and aborts ownership when the capture cursor changes', async () => {
    let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn(() => promise); vi.stubGlobal('fetch', fetcher); const f = render();
    for (const text of ['0', '-1', '01', '1e2', '9007199254740992']) { input(f.container, 2, text); expect(f.container.querySelector('button')!.disabled).toBe(true); }
    input(f.container, 2, ''); await click(f.container, 'Download linked OTLP JSON'); input(f.container, 2, '5');
    await act(async () => { resolve(response()); await promise; }); expect(download).not.toHaveBeenCalled();
  });
  it('locale changes do not refetch or discard a valid in-flight read', async () => {
    let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn(() => promise); vi.stubGlobal('fetch', fetcher); const f = render(); await click(f.container, 'Download linked OTLP JSON');
    act(() => f.root.render(<LinkedTraceExportPanel {...f.props} locale="zh" />));
    await act(async () => { resolve(response()); await promise; });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(download).toHaveBeenCalledTimes(1); expect(f.container.textContent).toContain('已请求下载');
  });
  it('rejects forbidden OTLP fields and malformed UTF8 before creating any download', async () => {
    const data = payload(); Object.assign(data.resourceSpans[0]!.scopeSpans[0]!.spans[0]!, { parentSpanId: 'a'.repeat(16) });
    const fetcher = vi.fn().mockResolvedValueOnce(response(data)).mockResolvedValueOnce(new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher); const f = render(); await click(f.container, 'Download linked OTLP JSON'); await click(f.container, 'Retry local export');
    expect(f.container.textContent).toContain('INVALID_EXPORT'); expect(createUrl).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });

});
