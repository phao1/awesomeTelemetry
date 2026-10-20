import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkedExecutionPage, TraceEventSlim } from '../core/trace-types.js';
import { ToolExecutionPanel } from './ToolExecutionPanel.js';

const roots: Root[] = [];
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const response = (value: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(value) }) as Response;
function event(id: string, sequence: number, hasOutput = false): TraceEventSlim {
  return { id, sessionId: 's', sequence, turnKey: 't', kind: 'tool', phase: 'understand', title: 'read_file', tool: 'read_file', actor: 'assistant', startedAt: '2026-10-19T00:00:00.000Z', durationMs: 25, status: hasOutput ? 'error' : 'unknown', error: hasOutput ? 'synthetic failure' : null, tokens: null, hasInput: !hasOutput, hasOutput, hasRaw: true };
}
function page(): LinkedExecutionPage {
  const events = [event('in', 1), event('out', 3, true)];
  return { sessionKey: 's', sessionDurationSource: 'derived', events, eventOffset: 0, eventLimit: 100, eventTotal: 2, eventsHasMore: false, attempts: [], nextCaptureCursor: null, capturesHasMore: false, identities: events.map(value => ({ id: 'i-' + value.id, source: 'scan', sourceKey: 's', namespace: 'protocol:openai', kind: 'tool_call', value: 'native-call-a', scope: 'native-s', eventId: value.id, sourcePath: 'events[' + value.sequence + '].payload.call_id' })), identityCompleteness: { complete: true, omittedCount: 0, reasons: [] } };
}
function mount(locale: 'zh' | 'en' = 'zh') {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
  act(() => root.render(<ToolExecutionPanel sessionKey="s" locale={locale} onClose={vi.fn()} onOpenRequest={vi.fn()} />)); return { root, container };
}
function click(container: Element, text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === text);
  expect(button, text).toBeDefined(); act(() => button!.click());
}
describe('tool investigation drawer', () => {
  it('opens cross-page metadata explicitly and reads only an exact off-page member selected by the user', async () => {
    const native = page();
    const fetchMock = vi.fn(async (url: string) => response(url.includes('/tool-observations') ? {
      sessionKey: 's', identity: { namespace: 'protocol:openai', value: 'native-call-a', scope: 'native-s' }, state: 'retained_reference', events: [event('off-page-output', 222, true)], eventTotal: 3, identities: [], completeness: { complete: true, omittedCount: 0, reasons: [] }, nextCursor: null, hasMore: false,
    } : url.includes('/execution') ? native : { ...event('off-page-output', 222, true), inputSummary: null, outputSummary: 'ONLY_SELECTED_BODY' }));
    vi.stubGlobal('fetch', fetchMock); const f = mount(); await flush();
    act(() => f.container.querySelector<HTMLButtonElement>('.tool-group')!.click()); expect(fetchMock).toHaveBeenCalledTimes(1);
    click(f.container, '查看同一原生 ID 的跨页证据'); await flush(); expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1]![0]).toContain('/tool-observations?');
    act(() => f.container.querySelector<HTMLButtonElement>('.native-tool-members button')!.click()); expect(fetchMock).toHaveBeenCalledTimes(2); expect(f.container.textContent).toContain('off-page-output');
    click(f.container, '读取事件正文'); await flush(); expect(fetchMock.mock.calls[2]![0]).toBe('/api/sessions/s/events/off-page-output'); expect(f.container.textContent).toContain('ONLY_SELECTED_BODY');
    act(() => f.root.render(<ToolExecutionPanel sessionKey="s" locale="zh" invalidateKey={1} onClose={vi.fn()} onOpenRequest={vi.fn()} />));
    expect(f.container.querySelector('.native-tool-observations')).toBeNull(); expect(f.container.textContent).not.toContain('ONLY_SELECTED_BODY'); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('reads one metadata page, groups exact tool evidence, and reads only the selected event body/raw explicitly', async () => {
    const fetchMock = vi.fn(async (url: string) => response(url.includes('/execution') ? page() : { ...event(url.includes('/out') ? 'out' : 'in', 1, url.includes('/out')), inputSummary: '{"path":"synthetic.txt"}', outputSummary: '<script>inert</script>', ...(url.includes('include=raw') ? { raw: '{"native":"retained"}' } : {}) }));
    vi.stubGlobal('fetch', fetchMock); const { container } = mount(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0]![0]).toContain('eventLimit=100');
    act(() => container.querySelector<HTMLButtonElement>('.tool-group')!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('同一原生 ID');
    click(container, '读取事件正文'); await flush();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/sessions/s/events/in');
    expect(container.textContent).toContain('synthetic.txt'); expect(container.querySelector('script')).toBeNull();
    act(() => container.querySelectorAll<HTMLButtonElement>('.tool-members button')[1]!.click());
    expect(container.querySelector('.tool-body')).toBeNull();
    click(container, '读取此事件 Raw'); await flush();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/sessions/s/events/out?include=raw');
    expect(container.textContent).toContain('"native":"retained"');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('filters only current metadata and changes locale without network IO', async () => {
    const fetchMock = vi.fn(async () => response(page())); vi.stubGlobal('fetch', fetchMock);
    const { root, container } = mount(); await flush();
    const input = container.querySelector<HTMLInputElement>('input')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'absent'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await flush(); expect(container.textContent).toContain('没有符合条件');
    act(() => root.render(<ToolExecutionPanel sessionKey="s" locale="en" onClose={vi.fn()} onOpenRequest={vi.fn()} />)); await flush();
    expect(container.textContent).toContain('No matching tool record'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('shows unbound records, missing outputs and empty pages distinctly', async () => {
    const data = page(); data.identities = []; data.events = [event('in', 1)];
    vi.stubGlobal('fetch', vi.fn(async () => response(data))); const { container } = mount(); await flush();
    act(() => container.querySelector<HTMLButtonElement>('.tool-group')!.click());
    expect(container.textContent).toContain('无明确原生 ID'); expect(container.textContent).toContain('本页未见输出 · 结果未知');
    expect(container.textContent).not.toContain('success（日志）');
  });
  it('uses actual returned counts for next and explicit previous paging', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const data = page(); data.eventsHasMore = !url.includes('eventOffset=2'); data.eventTotal = 5;
      if (url.includes('eventOffset=2')) data.eventOffset = 2;
      return response(data);
    });
    vi.stubGlobal('fetch', fetchMock); const { container } = mount(); await flush();
    click(container, '下一页'); await flush(); expect(fetchMock.mock.calls.at(-1)![0]).toContain('eventOffset=2');
    click(container, '上一页'); await flush(); expect(fetchMock.mock.calls.at(-1)![0]).toContain('eventOffset=0');
  });
  it('hides invalidated evidence, aborts pending body and rejects its late result without refetch', async () => {
    let resolve!: (value: Response) => void; let signal: AbortSignal | undefined;
    const pending = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => { if (url.includes('/execution')) return response(page()); signal = init?.signal as AbortSignal; return pending; });
    vi.stubGlobal('fetch', fetchMock); const { root, container } = mount(); await flush();
    act(() => container.querySelector<HTMLButtonElement>('.tool-group')!.click()); click(container, '读取事件正文');
    act(() => root.render(<ToolExecutionPanel sessionKey="s" locale="zh" invalidateKey={1} onClose={vi.fn()} onOpenRequest={vi.fn()} />));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(response({ ...event('in', 1), inputSummary: 'STALE', outputSummary: null })); await pending; });
    expect(container.textContent).toContain('来源已变化'); expect(container.textContent).not.toContain('STALE'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('has explicit error retry and never retries automatically', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response(page())); vi.stubGlobal('fetch', fetchMock);
    const { container } = mount(); await flush(); expect(container.textContent).toContain('offline'); expect(fetchMock).toHaveBeenCalledTimes(1);
    click(container, '重试读取'); await flush(); expect(container.textContent).not.toContain('offline'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('releases waiting after five seconds even if fetch ignores abort', async () => {
    vi.useFakeTimers(); const fetchMock = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetchMock);
    const { container } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(container.textContent).toContain('超过 5 秒'); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
