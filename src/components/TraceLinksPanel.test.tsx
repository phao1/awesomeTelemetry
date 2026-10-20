import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProxyRequestListItem, TraceAssociation, TraceIdentityPage } from '../core/trace-types.js';
import { ProxyTraceLinksPanel, SessionCaptureLinksPanel } from './TraceLinksPanel.js';

const roots: Root[] = [];
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount(); }); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function render(node: React.JSX.Element) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); roots.push(root);
  act(() => { root.render(node); });
  return { root, container };
}
function response(value: unknown): Response { return { ok: true, status: 200, text: async () => JSON.stringify(value) } as Response; }
const flush = async (): Promise<void> => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
function association(id: number, state: TraceAssociation['state'] = 'candidate'): TraceAssociation {
  return { id: String(id).padStart(64, '0'), sessionKey: 'native-session', proxyId: id, state, reason: 'native evidence', evidenceIds: ['evidence-id'], createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' };
}
function request(id: number): ProxyRequestListItem {
  return { id, requestId: 'request-' + id, method: 'POST', url: '/v1/messages', hostname: 'synthetic-' + id + '.test', responseStatus: 200, contentType: 'application/json', isStreaming: false,
    startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:01.000Z', durationMs: 1000, captureMethod: 'mitm', ttnetEncrypted: false,
    systemPromptLen: 0, model: 'demo', inputTokens: null, outputTokens: null, parsedSessionId: null, parserRoute: 'anthropic', captureGroupId: 'run-not-session', requestFormat: 'anthropic_messages', hasSystemPrompt: false };
}
function identityPage(proxyId = 1): TraceIdentityPage {
  return { source: 'proxy', sourceKey: String(proxyId), parserVersion: 1,
    items: [{ id: 'a'.repeat(64), source: 'proxy', sourceKey: String(proxyId), namespace: 'agent:claude', kind: 'session', value: 'native-session', scope: null, eventId: null, sourcePath: 'request.headers.x-agent-session-id' }],
    completeness: { complete: true, omittedCount: 0, reasons: [] }, nextCursor: null, hasMore: false };
}
function button(container: Element, text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(button => button.textContent === text && !button.disabled)!;
}

describe('linked trace metadata UI', () => {
  it('opens cross-source export only for eligible scan sessions, without fetching until explicit download', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const props = { sessionKey: 'native-session', locale: 'zh' as const, onOpenRequest: vi.fn() };
    const f = render(<SessionCaptureLinksPanel {...props} />); expect(f.container.textContent).not.toContain('跨来源 Trace 导出');
    act(() => f.root.render(<SessionCaptureLinksPanel {...props} traceExportEnabled />));
    await act(async () => { button(f.container, '跨来源 Trace 导出').click(); await import('./LinkedTraceExportPanel.js'); }); await flush();
    expect(f.container.textContent).toContain('下载关联 OTLP JSON'); expect(fetchMock).not.toHaveBeenCalled();
    act(() => f.root.render(<SessionCaptureLinksPanel {...props} traceExportEnabled={false} />));
    expect(f.container.querySelector('.linked-trace-export-panel')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps scan export eligibility explicit and opening the independent export panel performs no fetch', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const props = { sessionKey: 'native-session', locale: 'zh' as const, onOpenRequest: vi.fn() };
    const f = render(<SessionCaptureLinksPanel {...props} />); expect(f.container.textContent).not.toContain('标准 Trace 导出');
    act(() => f.root.render(<SessionCaptureLinksPanel {...props} traceExportEnabled />));
    await act(async () => { button(f.container, '标准 Trace 导出').click(); await import('./TraceExportPanel.js'); }); await flush();
    expect(f.container.textContent).toContain('下载 OTLP JSON'); expect(fetchMock).not.toHaveBeenCalled();
    act(() => f.root.render(<SessionCaptureLinksPanel {...props} traceExportEnabled={false} />)); expect(f.container.querySelector('.trace-export-panel')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('opens the standalone tool investigation with one metadata page and no collapsed association reads', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/sessions/native-session/execution?eventOffset=0&eventLimit=100&captureLimit=20');
      return response({ sessionKey: 'native-session', sessionDurationSource: 'unknown', events: [], eventOffset: 0, eventLimit: 100, eventTotal: 0, eventsHasMore: false,
        attempts: [], nextCaptureCursor: null, capturesHasMore: false, identities: [], identityCompleteness: { complete: true, omittedCount: 0, reasons: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={vi.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled(); const entry = button(container, '工具执行调查台 →'); entry.focus();
    await act(async () => { entry.click(); await import('./ToolExecutionPanel.js'); }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('没有保留事件');
    act(() => container.querySelector<HTMLButtonElement>('.ui-drawer-header .ui-icon-btn')!.click());
    expect(document.activeElement).toBe(entry); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the standalone family entry without fetching collapsed association lists and returns focus on close', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/sessions/native-session/family');
      return response({ session: { id: 'native-session', provider: 'codex', sourceAgent: 'Codex', title: 'Synthetic family', startedAt: '2026-10-19T00:00:00.000Z' }, parents: { sessionKey: 'native-session', items: [], nextCursor: null, hasMore: false, completeness: { complete: true, omittedCount: 0, reasons: [] } }, children: [], nextCursor: null, hasMore: false, completeness: { complete: true, omittedCount: 0, reasons: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={vi.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled(); const entry = button(container, 'Agent 家族与尝试 →'); entry.focus();
    await act(async () => { entry.click(); await import('./SessionFamilyPanel.js'); }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('.ui-drawer-header .ui-icon-btn')!.click(); });
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(entry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens native parents lazily, navigates only a resolved owner and hides invalidated conclusions without reads', async () => {
    const open = vi.fn();
    const fetchMock = vi.fn(async (url: string) => response(url.endsWith('/parents') ? {
      sessionKey: 'native-session', items: [{ identity: { ...identityPage().items[0], source: 'scan', sourceKey: 'native-session', kind: 'parent_session', value: 'parent-native', scope: 'child-native', sourcePath: 'session_meta.payload.parent_thread_id' },
        state: 'resolved', matches: [{ id: 'parent-key', provider: 'codex', sourceAgent: 'Codex', title: 'Synthetic parent', startedAt: '2026-10-16T00:00:00.000Z' }], matchesTruncated: false }],
      nextCursor: null, hasMore: false, completeness: { complete: true, omittedCount: 0, reasons: [] },
    } : { sessionKey: 'native-session', items: [], confirmedCount: 0, candidateCount: 0, nextCursor: null, hasMore: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { root, container } = render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={vi.fn()} onOpenSession={open} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { const details = container.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })); }); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/native-session/capture-links']);
    await act(async () => { button(container, '原生父会话引用').click(); await import('./NativeSessionParentsPanel.js'); }); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/native-session/capture-links', '/api/sessions/native-session/parents']);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-native-parent-reference]')!.click(); });
    expect(container.textContent).toContain('Synthetic parent');
    await act(async () => { button(container, '打开已解析父级会话').click(); });
    expect(open).toHaveBeenCalledExactlyOnceWith('parent-key');
    await act(async () => { root.render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={vi.fn()} onOpenSession={open} invalidateKey={1} />); });
    expect(container.textContent).toContain('父级依据已变化');
    expect(container.textContent).not.toContain('Synthetic parent');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('loads execution metadata only after its explicit action inside the expanded session entry', async () => {
    const fetchMock = vi.fn(async (url: string) => response(url.endsWith('/execution') ? {
      sessionKey: 'native-session', sessionDurationSource: 'unknown', events: [], eventOffset: 0, eventLimit: 100, eventTotal: 0, eventsHasMore: false,
      attempts: [], nextCaptureCursor: null, capturesHasMore: false, identities: [], identityCompleteness: { complete: true, omittedCount: 0, reasons: [] },
    } : { sessionKey: 'native-session', items: [], confirmedCount: 0, candidateCount: 0, nextCursor: null, hasMore: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={vi.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { const details = container.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })); }); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/native-session/capture-links']);
    await act(async () => { button(container, '关联执行证据').click(); });
    await vi.waitFor(async () => {
      await flush();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/native-session/capture-links', '/api/sessions/native-session/execution']);
    });
    expect(container.textContent).toContain('此页没有原生事件');
  });
  it.each(['identities', 'decisions'])('does not attach a late %s drill-down to a newly selected proxy', async endpoint => {
    let resolveOld!: (value: Response) => void;
    const delayed = new Promise<Response>(resolve => { resolveOld = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input === '/api/sessions/native-session/identities' || input.endsWith('/decisions')) return delayed;
      const id = input.includes('/requests/2/') ? 2 : 1;
      return response(input.endsWith('/identities') ? identityPage(id) : { proxyId: id, items: [association(id)], nextCursor: null, hasMore: false });
    }));
    const { root, container } = render(<ProxyTraceLinksPanel proxyId={1} sessions={[]} locale="zh" />);
    await flush();
    await act(async () => { button(container, endpoint === 'identities' ? '查看会话身份依据' : '人工决定记录').click(); });
    await act(async () => { root.render(<ProxyTraceLinksPanel proxyId={2} sessions={[]} locale="zh" />); }); await flush();
    await act(async () => {
      resolveOld(response(endpoint === 'identities' ? { ...identityPage(), sourceKey: 'STALE_SOURCE', items: [] } : { items: [{ sequence: 1, associationId: 'old', state: 'confirmed', note: 'STALE_NOTE', decidedAt: 'old' }], nextCursor: null, hasMore: false }));
      await delayed;
    });
    expect(container.textContent).not.toContain('STALE_SOURCE');
    expect(container.textContent).not.toContain('STALE_NOTE');
    expect(container.textContent).toContain('proxy · 2');
  });
  it('loads a session link page only after expansion, never per-request details, and marks invalidation without refetch', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      expect(input).toBe('/api/sessions/native-session/capture-links');
      return response({ sessionKey: 'native-session', items: Array.from({ length: 50 }, (_, index) => ({ association: association(index + 1), request: { ...request(index + 1), hasSystemPrompt: index === 0 } })), confirmedCount: 0, candidateCount: 50, nextCursor: null, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock); const open = vi.fn();
    const { root, container } = render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={open} />);
    await flush(); expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { const details = container.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/native-session/capture-links');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(container.textContent).toContain('待确认候选');
    await act(async () => { container.querySelector('tbody button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(open).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('不会把时间窗内最长的提示词复制为会话上下文');
    const promptButtons = [...container.querySelectorAll('button')].filter(node => node.textContent?.startsWith('查看此请求的 Prompt'));
    expect(promptButtons).toHaveLength(1);
    await act(async () => { promptButtons[0]!.click(); });
    expect(open.mock.calls).toEqual([[1], [1]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(<SessionCaptureLinksPanel sessionKey="native-session" locale="zh" onOpenRequest={open} invalidateKey={1} />); });
    expect(container.textContent).toContain('关联证据有更新');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('loads exactly two metadata endpoints for a proxy and confirms/revokes a candidate with explicit user actions', async () => {
    let current = association(1);
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { current = { ...current, state: JSON.parse(String(init.body)).state }; return response(current); }
      if (String(input).endsWith('/identities')) return response(identityPage());
      return response({ proxyId: 1, items: [current], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock); const open = vi.fn();
    const { container } = render(<ProxyTraceLinksPanel proxyId={1} sessions={[]} locale="zh" onOpenSession={open} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(['/api/proxy/requests/1/identities', '/api/proxy/requests/1/trace-links']);
    await act(async () => { button(container, '确认关联').click(); });
    await flush();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(put[0]).toBe('/api/proxy/requests/1/trace-links/native-session');
    expect(JSON.parse(String(put[1]?.body))).toEqual({ state: 'confirmed', note: null });
    expect(container.textContent).toContain('人工确认');
    await act(async () => { button(container, '解除关联').click(); }); await flush();
    expect(container.textContent).toContain('已解除');
    expect(fetchMock.mock.calls.some(([url]) => /\/body\/|\/events\/|\/analysis/.test(url))).toBe(false);
  });
  it('reads only the explicitly chosen audit history and escapes the original note', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/decisions')) return response({ items: [{ sequence: 1, associationId: 'assoc', state: 'confirmed', note: '<img src=x onerror=alert(1)>', decidedAt: '2026-10-16T00:00:00.000Z' }], nextCursor: null, hasMore: false });
      return response(input.endsWith('/identities') ? identityPage() : { proxyId: 1, items: [association(1)], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<ProxyTraceLinksPanel proxyId={1} sessions={[]} locale="zh" />);
    await flush(); expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { button(container, '人工决定记录').click(); }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });
  it('shows request errors and retries instead of leaving an infinite skeleton', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('Synthetic backend failure'); });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<ProxyTraceLinksPanel proxyId={1} sessions={[]} locale="en" />);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Synthetic backend failure');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { button(container, 'Refresh links').click(); }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('ignores late results from the previously inspected proxy', async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    const delayed = new Promise<Response>(resolve => { resolveOld = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/requests/1/')) return delayed;
      return response(input.endsWith('/identities') ? identityPage(2) : { proxyId: 2, items: [{ ...association(2), sessionKey: 'new-session' }], nextCursor: null, hasMore: false });
    }));
    const { root, container } = render(<ProxyTraceLinksPanel proxyId={1} sessions={[]} locale="zh" />);
    await act(async () => { root.render(<ProxyTraceLinksPanel proxyId={2} sessions={[]} locale="zh" />); });
    await flush();
    await act(async () => { resolveOld!(response({ proxyId: 1, items: [{ ...association(1), sessionKey: 'old-session' }], nextCursor: null, hasMore: false })); await delayed; });
    expect(container.textContent).toContain('new-session');
    expect(container.textContent).not.toContain('old-session');
  });
});
