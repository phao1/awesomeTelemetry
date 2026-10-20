import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkedExecutionPage, NativeSessionFamilyPage, TraceSourceIdentity } from '../core/trace-types.js';
import { SessionFamilyPanel } from './SessionFamilyPanel.js';

const roots: Root[] = [];
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const response = (value: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(value) }) as Response;
const stamp = '2026-10-19T00:00:00.000Z';
const meta = (id: string): NativeSessionFamilyPage['session'] => ({ id, provider: 'codex', sourceAgent: 'Codex', title: 'Synthetic ' + id, startedAt: stamp });
function identity(child: string, parent: string): TraceSourceIdentity {
  return { id: (child === 'child' ? 'a' : 'b').repeat(64), source: 'scan', sourceKey: child, namespace: 'agent:codex', kind: 'parent_session', value: parent, scope: child, eventId: null, sourcePath: 'events[0].payload.parent_thread_id' };
}
function family(id = 'root', children: string[] = ['child']): NativeSessionFamilyPage {
  return { session: meta(id), parents: { sessionKey: id, items: id === 'root' ? [] : [{ identity: identity(id, 'root'), state: 'resolved', matches: [meta('root')], matchesTruncated: false }], nextCursor: null, hasMore: false, completeness: { complete: true, omittedCount: 0, reasons: [] } }, children: children.map(child => ({ session: meta(child), identity: identity(child, id), state: 'resolved' })), nextCursor: null, hasMore: false, completeness: { complete: true, omittedCount: 0, reasons: [] } };
}
function execution(key = 'child', empty = false): LinkedExecutionPage {
  return { sessionKey: key, sessionDurationSource: 'unknown', events: [], eventOffset: 0, eventLimit: 20, eventTotal: 0, eventsHasMore: false,
    identities: [], identityCompleteness: { complete: true, omittedCount: 0, reasons: [] }, nextCaptureCursor: null, capturesHasMore: false,
    attempts: empty ? [] : [1, 2].map(id => ({ association: { id: String(id), sessionKey: key, proxyId: id, state: 'direct', reason: 'exact_native_session_id', evidenceIds: [], createdAt: stamp, updatedAt: stamp },
      request: { id, requestId: 'req-' + id, method: 'POST', url: '/v1/responses', hostname: 'synthetic.invalid', responseStatus: 200, contentType: 'application/json', isStreaming: false, startedAt: stamp, completedAt: stamp, durationMs: 1, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, model: 'synthetic', inputTokens: null, outputTokens: null, parsedSessionId: null, parserRoute: 'openai', captureGroupId: null, requestFormat: 'openai_responses', hasSystemPrompt: false },
      transport: { version: 1, state: id === 1 ? 'network_error' : 'completed', error: id === 1 ? 'ECONNRESET' : null, requestEnded: true, responseEnded: id === 2, statusCode: 200 },
      matches: [{ eventId: 'event-1', scanIdentityId: 'scan-id', proxyIdentityId: 'proxy-' + id, namespace: 'protocol:openai', kind: 'response', value: 'response-native', scope: key }],
    })) };
}
function render(locale: 'en' | 'zh' = 'en') {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  const close = vi.fn(), openSession = vi.fn(), openRequest = vi.fn();
  const props = { sessionKey: 'root', locale, onClose: close, onOpenSession: openSession, onOpenRequest: openRequest };
  act(() => root.render(<SessionFamilyPanel {...props} />));
  return { container, root, props, close, openSession, openRequest };
}
const click = async (container: Element, text: string) => { await act(async () => { const button = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text)); expect(button, text).toBeDefined(); button!.click(); }); await flush(); };

describe('family drawer user journey', () => {
  it('loads one family, expands only a selected branch, then reads attempts and one event body on explicit actions', async () => {
    const fetchMock = vi.fn(async (url: string) => response(url.includes('/events/') ? { id: 'event-1', title: 'Synthetic detail', inputSummary: '<img src=x onerror=alert(1)>', outputSummary: 'Retained output' }
      : url.includes('/execution') ? execution() : url.includes('/child/family') ? family('child', ['grandchild']) : family()));
    vi.stubGlobal('fetch', fetchMock); const f = render(); await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sessions/root/family']);
    expect(f.container.textContent).not.toContain('Synthetic grandchild');
    await act(async () => { f.container.querySelector<HTMLButtonElement>('[aria-label="Expand children Synthetic child"]')!.click(); }); await flush();
    expect(f.container.textContent).toContain('Synthetic grandchild'); expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { f.container.querySelector<HTMLButtonElement>('[data-family-session="child"] .family-node-select')!.click(); }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await click(f.container, 'Events & attempts');
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/sessions/child/execution?eventLimit=20&captureLimit=20');
    expect(f.container.textContent).toContain('Retry relation: unknown');
    await click(f.container, '#1 · Inspect attempt');
    expect(f.container.textContent).toContain('Network failure'); expect(fetchMock).toHaveBeenCalledTimes(3);
    await click(f.container, 'Read event details');
    expect(fetchMock.mock.calls[3]![0]).toContain('/api/sessions/child/events/event-1');
    expect(f.container.textContent).toContain('<img src=x onerror=alert(1)>'); expect(f.container.querySelector('img')).toBeNull();
    await click(f.container, 'Open capture Trace'); expect(f.openRequest).toHaveBeenCalledExactlyOnceWith(1); expect(f.close).toHaveBeenCalledOnce();
  });

  it('opens the exact selected native trace and retains locale changes without reads', async () => {
    const fetchMock = vi.fn(async () => response(family())); vi.stubGlobal('fetch', fetchMock);
    const f = render(); await flush();
    act(() => f.root.render(<SessionFamilyPanel {...f.props} locale="zh" />));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await click(f.container, '打开原生 Trace'); expect(f.openSession).toHaveBeenCalledExactlyOnceWith('root');
  });

  it('shows a complete empty/unknown flow rather than inventing a root or retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/execution') ? execution('root', true) : family('root', []))));
    const f = render('zh'); await flush(); expect(f.container.textContent).toContain('没有声明不代表这是根会话');
    await click(f.container, '执行与尝试'); expect(f.container.textContent).toContain('没有已确认关联的网络尝试'); expect(f.container.textContent).toContain('重试关系：未知');
  });

  it('marks invalidated conclusions stale without auto-refetch and refreshes explicitly', async () => {
    const fetchMock = vi.fn(async () => response(family())); vi.stubGlobal('fetch', fetchMock);
    const f = render(); await flush();
    act(() => f.root.render(<SessionFamilyPanel {...f.props} invalidateKey={1} />));
    expect(f.container.textContent).toContain('Old conclusions are hidden'); expect(f.container.textContent).not.toContain('Synthetic child'); expect(fetchMock).toHaveBeenCalledTimes(1);
    await click(f.container, 'Refresh relations'); expect(fetchMock).toHaveBeenCalledTimes(2); expect(f.container.textContent).toContain('Synthetic child');
  });

  it('does not let a late source read replace a newly selected owner', async () => {
    let resolveOld!: (value: Response) => void;
    const delayed = new Promise<Response>(resolve => { resolveOld = resolve; });
    const other = family('other', []); other.parents.items = [];
    const fetchMock = vi.fn(async (url: string) => url.includes('/root/family') ? delayed : response(other));
    vi.stubGlobal('fetch', fetchMock); const f = render();
    act(() => f.root.render(<SessionFamilyPanel {...f.props} sessionKey="other" />)); await flush();
    await act(async () => { resolveOld(response(family())); await delayed; });
    expect(f.container.textContent).not.toContain('Synthetic root'); expect(f.container.textContent).toContain('Synthetic other');
    const options = fetchMock.mock.calls[0] as unknown[]; expect(options[0]).toContain('/root/');
  });

  it('returns from a failed local read through an explicit retry only', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('SYNTHETIC_READ_FAILED')).mockResolvedValue(response(family()));
    vi.stubGlobal('fetch', fetchMock); const f = render(); await flush();
    expect(f.container.textContent).toContain('SYNTHETIC_READ_FAILED'); expect(fetchMock).toHaveBeenCalledTimes(1);
    await click(f.container, 'Retry local read'); expect(fetchMock).toHaveBeenCalledTimes(2); expect(f.container.textContent).toContain('Synthetic child');
  });

  it('times out an unresponsive read and suppresses its late result', async () => {
    vi.useFakeTimers(); let resolveOld!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveOld = resolve; })));
    const f = render(); await act(async () => { vi.advanceTimersByTime(5000); });
    expect(f.container.textContent).toContain('exceeded 5 seconds');
    await act(async () => { resolveOld(response(family())); });
    expect(f.container.textContent).not.toContain('Synthetic child');
  });

  it('aborts its owned request on unmount', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); }));
    const f = render(); expect(signal?.aborted).toBe(false); act(() => f.root.render(<div />)); expect(signal?.aborted).toBe(true);
  });
});
