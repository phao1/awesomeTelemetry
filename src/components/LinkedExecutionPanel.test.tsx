import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkedExecutionPage, TraceEventSlim } from '../core/trace-types.js';
import { LinkedExecutionPanel } from './LinkedExecutionPanel.js';

const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach(root => root.unmount()); }); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
const stamp = '2026-10-16T00:00:00.000Z';
function event(sequence = 1): TraceEventSlim {
  return { id: `event-${sequence}`, sessionId: 'native', sequence, turnKey: 'opaque:native:turn', kind: 'llm', phase: 'implement', title: `<img src=x> event ${sequence}`,
    startedAt: stamp, durationMs: 100, status: 'success', actor: 'assistant', tool: null, tokens: null, error: null, hasInput: true, hasOutput: true, hasRaw: true };
}
function page(): LinkedExecutionPage {
  return { sessionKey: 'native', sessionDurationSource: 'derived', events: Array.from({ length: 100 }, (_, i) => event(i + 1)), eventOffset: 0, eventLimit: 100, eventTotal: 250, eventsHasMore: true,
    attempts: [{ association: { id: 'assoc', sessionKey: 'native', proxyId: 7, state: 'direct', reason: 'source evidence', evidenceIds: ['session-evidence'], createdAt: stamp, updatedAt: stamp },
      request: { id: 7, requestId: 'capture', method: 'POST', url: '/v1/messages', hostname: 'synthetic.test', responseStatus: 200, contentType: 'text/event-stream', isStreaming: true,
        startedAt: stamp, completedAt: stamp, durationMs: 1000, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, model: 'demo', inputTokens: null, outputTokens: null,
        parsedSessionId: null, parserRoute: 'anthropic', captureGroupId: 'not-session', requestFormat: 'anthropic_messages', hasSystemPrompt: false },
      transport: null, matches: [{ eventId: 'event-1', scanIdentityId: 'scan-id', proxyIdentityId: 'proxy-id', namespace: 'agent:claude', kind: 'tool_call', value: 'tool-1', scope: 'native-scope' }] }],
    nextCaptureCursor: 7, capturesHasMore: true, identities: [], identityCompleteness: { complete: true, omittedCount: 0, reasons: [] } };
}
function response(value: unknown): Response { return { ok: true, status: 200, text: async () => JSON.stringify(value) } as Response; }
async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function render(locale: 'zh' | 'en' = 'zh') {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); roots.push(root); const open = vi.fn();
  act(() => root.render(<LinkedExecutionPanel sessionKey="native" locale={locale} onOpenRequest={open} />));
  return { container, root, open };
}
function button(container: Element, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text));
  expect(found, text).toBeDefined(); return found!;
}

describe('linked execution exploration', () => {
  it.each(['derived', 'measured', 'unknown'] as const)('labels %s as a session declaration, never per-event measured evidence', async source => {
    const result = page(); result.sessionDurationSource = source; result.events[0]!.durationMs = 0;
    result.attempts[0]!.transport = { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
      timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150, firstContentMs: 800,
        firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', completedMs: 2000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } };
    const fetchMock = vi.fn(async (url: string) => response(url.includes('/events/') ? { ...event(), inputSummary: null, outputSummary: null } : result));
    vi.stubGlobal('fetch', fetchMock); const { container, root, open } = render('en'); await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-execution-event]')!.click()); await flush();
    await act(async () => button(container, 'Shared identity evidence').click());
    const comparison = container.querySelector('[aria-label="Native and proxy timing"]');
    expect(comparison?.textContent).toContain('Normalized log duration'); expect(comparison?.textContent).toContain('0 ms');
    expect(comparison?.textContent).toContain(`Session declaration: ${source}`);
    expect(comparison?.textContent).toContain('Per-event measurement provenance is unknown');
    expect(comparison?.textContent).toContain('Zero does not prove a measured zero');
    expect(comparison?.textContent).toContain('100 ms'); expect(comparison?.textContent).toContain('800 ms'); expect(comparison?.textContent).toContain('2000 ms');
    expect(comparison?.textContent).toContain('not proof of the same call');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => root.render(<LinkedExecutionPanel sessionKey="native" locale="en" onOpenRequest={open} invalidateKey={1} />));
    expect(container.querySelector('[aria-label="Native and proxy timing"]')).toBeNull();
    expect(container.textContent).not.toContain('2000 ms'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps timing unknown when a network outcome exists without timing evidence', async () => {
    const result = page(); result.attempts[0]!.transport = { version: 1, state: 'network_error', error: 'ECONNRESET', requestEnded: true, responseEnded: false, statusCode: null };
    const fetchMock = vi.fn(async () => response(result)); vi.stubGlobal('fetch', fetchMock);
    const { container } = render('en'); await flush();
    await act(async () => button(container, 'Shared identity evidence').click());
    expect(container.textContent).toContain('Legacy timing is unknown'); expect(container.textContent).not.toContain('1000 ms');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('shows missing transport as unknown without substituting legacy duration or requesting capture details', async () => {
    const fetchMock = vi.fn(async () => response(page())); vi.stubGlobal('fetch', fetchMock);
    const { container, root, open } = render('en'); await flush();
    await act(async () => button(container, 'Shared identity evidence').click());
    expect(container.textContent).toContain('Legacy timing is unknown'); expect(container.textContent).not.toContain('1000 ms');
    act(() => root.render(<LinkedExecutionPanel sessionKey="native" locale="zh" onOpenRequest={open} />));
    expect(container.textContent).toContain('会话来源声明'); expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => root.render(<LinkedExecutionPanel sessionKey="native" locale="zh" onOpenRequest={open} invalidateKey={1} />));
    expect(container.querySelector('[aria-label="原生与代理时序"]')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('makes one metadata read, virtualizes native rows, and only opens the selected body/capture', async () => {
    const fetchMock = vi.fn(async (url: string) => response(url.includes('/events/') ? { ...event(), inputSummary: '<script>original</script>', outputSummary: 'tool evidence' } : page()));
    vi.stubGlobal('fetch', fetchMock); const { container, open } = render(); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/native/execution']);
    expect(container.querySelectorAll('[data-execution-event]')).toHaveLength(20);
    expect(container.querySelectorAll('*').length).toBeLessThan(150);
    expect(container.textContent).not.toContain('scan-id');
    await act(async () => button(container, '共享标识依据').click());
    expect(container.textContent).toContain('scan-id'); expect(container.textContent).toContain('不证明因果');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-execution-event]')!.click()); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/native/execution', '/api/sessions/native/events/event-1']);
    expect(container.textContent).toContain('<script>original</script>'); expect(container.querySelector('script,img')).toBeNull();
    expect(container.textContent).toContain('opaque:native:turn');
    await act(async () => button(container, '#7 · demo').click()); expect(open).toHaveBeenCalledWith(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('uses actual returned event count and capture cursor without fetching individual rows', async () => {
    const clipped = { ...page(), events: [event(), event(2), event(3)], eventLimit: 100 };
    const fetchMock = vi.fn(async (_url: string) => response(clipped)); vi.stubGlobal('fetch', fetchMock);
    const { container } = render(); await flush();
    await act(async () => button(container, '下一页原生事件').click()); await flush();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sessions/native/execution?eventOffset=3');
    await act(async () => button(container, '下一页抓包请求').click()); await flush();
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/sessions/native/execution?eventOffset=3&captureCursor=7');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('marks changed association evidence stale without refetch and drops open body/matches', async () => {
    const fetchMock = vi.fn(async (url: string) => response(url.includes('/events/') ? { ...event(), inputSummary: 'old-body', outputSummary: null } : page()));
    vi.stubGlobal('fetch', fetchMock); const { root, container, open } = render(); await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-execution-event]')!.click()); await flush();
    expect(container.textContent).toContain('old-body');
    act(() => root.render(<LinkedExecutionPanel sessionKey="native" locale="en" onOpenRequest={open} />)); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => root.render(<LinkedExecutionPanel sessionKey="native" locale="en" onOpenRequest={open} invalidateKey={1} />)); await flush();
    expect(container.textContent).toContain('Association evidence changed');
    expect(container.textContent).not.toContain('old-body'); expect(container.querySelector('[data-execution-event]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => button(container, 'Refresh execution evidence').click()); await flush(); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('ignores a late page after invalidation or source change', async () => {
    let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/native/') ? delayed : response({ ...page(), events: [], attempts: [], sessionKey: 'other' })));
    const { root, container, open } = render();
    act(() => root.render(<LinkedExecutionPanel sessionKey="other" locale="zh" onOpenRequest={open} />)); await flush();
    await act(async () => { resolve(response(page())); await delayed; });
    expect(container.querySelector('[data-execution-event]')).toBeNull(); expect(container.textContent).not.toContain('synthetic.test');
  });
  it('aborts a stalled page after five seconds even if fetch ignores abort and permits explicit retry', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementationOnce(() => delayed).mockResolvedValue(response(page()));
    vi.stubGlobal('fetch', fetchMock); const { container } = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true); expect(container.querySelector('[role="alert"]')?.textContent).toContain('超过 5 秒');
    await act(async () => { resolve(response({ ...page(), events: [event(999)] })); await delayed; });
    expect(container.textContent).not.toContain('event 999');
    await act(async () => button(container, '刷新执行证据').click()); await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[data-execution-event]')).not.toBeNull();
  });
  it('owns a timed-out single-event read and rejects its late body without retrying the page', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes('/events/') ? delayed : response(page()));
    vi.stubGlobal('fetch', fetchMock); const { container } = render(); await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-execution-event]')!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('超过 5 秒');
    await act(async () => { resolve(response({ ...event(), inputSummary: 'late-body', outputSummary: null })); await delayed; });
    expect(container.textContent).not.toContain('late-body'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('shows incomplete/unbound metadata without claiming missing event bindings', async () => {
    const result = page(); result.attempts[0]!.matches = []; result.identityCompleteness = { complete: false, omittedCount: 2, reasons: ['source_missing'] };
    vi.stubGlobal('fetch', vi.fn(async () => response(result))); const { container } = render('en'); await flush();
    expect(container.textContent).toContain('source_missing');
    await act(async () => button(container, 'Shared identity evidence').click());
    expect(container.textContent).toContain('no native event binding can be asserted');
  });
});
