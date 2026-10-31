import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexCallDetail, CodexCallPage, CodexCallSummary } from '../core/trace-types.js';
import { CodexCallsPanel } from './CodexCallsPanel.js';

const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: null, reasoningTokens: 1, nativeTotalTokens: 12, totalTokens: 12, accounting: 'openai_subsets' as const };
const call: CodexCallSummary = { sequence: 0, responseId: 'synthetic-response', previousResponseId: null, predecessorSequence: null, streamId: null, model: 'synthetic', warmup: false,
  nativeSessionId: 'native-one', nativeTurnId: 'turn-one', startedAt: '2026-10-16T00:00:00.000Z', startedMs: 0, firstContentMs: 10, durationMs: 20, state: 'completed',
  usage, proposedToolIds: [], returnedToolIds: [], reasons: [] };
const page: CodexCallPage = { requestId: 'ws-synthetic', active: false, fingerprint: 'f'.repeat(64), items: [call], offset: 0, limit: 20, total: 1, hasMore: false, complete: true, reasons: [], unassignedEvents: 0 };
const detail: CodexCallDetail = { contextDiff: null, contextDiffUnavailableReason: 'no_predecessor', requestId: page.requestId, active: false, fingerprint: page.fingerprint, call, native: { state: 'linked', sessionKey: 'scan-one', matches: [{ eventId: 'tool-one', kind: 'tool_call', value: 'tool-one', sourcePath: 'events[2].payload.call_id' }] },
  requestPreview: '{"input":"<script>INERT_CODEX_ONLY</script>"}', requestPreviewTruncated: false, toolReferences: [],
  analysis: { parserVersion: 3, requestFormat: 'openai_responses', model: 'synthetic', responseId: 'synthetic-response', state: 'completed', system: 'SYSTEM_ONLY_SELECTED', declarations: [], items: [
    { phase: 'response', kind: 'text', id: null, callId: null, name: null, index: 0, choiceIndex: null, content: 'SYNTHETIC_SELECTED_OUTPUT', toolResultIsError: null, complete: true, sourcePath: 'events[1]' },
  ], stopReason: null, usage: { ...usage, snapshots: [] }, errors: [], unknownEvents: 0, completeness: { complete: true, reasons: [], omittedCount: 0 } } };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const openSession = vi.fn();
const render = (props: { locale?: 'zh' | 'en'; invalidateKey?: number; changeKey?: number; source?: { id: number } | { requestId: string } } = {}) => act(async () => root.render(<CodexCallsPanel source={{ id: 7 }} locale="en" onOpenSession={openSession} {...props} />));
const click = (text: string) => act(async () => {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === text);
  if (button === undefined) throw new Error('Missing button ' + text); button.click();
});
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); openSession.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('selected Codex call chain', () => {
  it('clears preserved body/analysis immediately when a refresh learns durable deletion intent', async () => {
    let deleted = false;
    const fetcher = vi.fn(async (url: string) => deleted ? json({ error: { code: 'CAPTURE_ORIGINALS_DELETED', message: 'deleted' } }, 409) : json(url.endsWith('/0') ? detail : page)); vi.stubGlobal('fetch', fetcher);
    await render(); await click('Call 1'); expect(container.textContent).toContain('SYNTHETIC_SELECTED_OUTPUT');
    deleted = true; await click('Refresh written calls');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('deleted');
    expect(container.textContent).not.toContain('SYNTHETIC_SELECTED_OUTPUT');
    expect(container.textContent).not.toContain('SYSTEM_ONLY_SELECTED');
    await click('Refresh written calls'); expect(container.textContent).not.toContain('SYNTHETIC_SELECTED_OUTPUT');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('converges an actual live-to-saved409 exactly once, serially, even when the first snapshot races', async () => {
    vi.useFakeTimers(); let failed = true;
    const fetcher = vi.fn(async () => failed ? json({ error: { code: 'CODEX_SOURCE_CHANGED', message: 'handoff' } }, 409) : json(page)); vi.stubGlobal('fetch', fetcher);
    const live = { requestId: 'ws-synthetic' };
    await render({ source: live }); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('One automatic reread is pending');
    failed = false;
    await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Call 1');
    failed = true; await click('Refresh written calls'); expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('handoff');
    await render({ source: live, changeKey: 10 }); await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('delays large selected details to the30s byte window without losing dirty hints or manual refresh', async () => {
    vi.useFakeTimers();
    const pendingCall = { ...call, state: 'pending' }, activePage = { ...page, active: true, items: [pendingCall] };
    const largeDetail = { ...detail, active: true, call: pendingCall, analysis: { ...detail.analysis, items: Array.from({ length: 20 }, () => ({ ...detail.analysis.items[0]!, content: 'x'.repeat(32768) })) } };
    const fetcher = vi.fn(async (url: string) => json(url.endsWith('/0') ? largeDetail : activePage)); vi.stubGlobal('fetch', fetcher);
    const live = { requestId: 'ws-synthetic' };
    await render({ source: live }); await click('Call 1');
    await render({ source: live, changeKey: 1 });
    expect(container.textContent).toContain('30-second auto-read byte budget');
    await act(async () => vi.advanceTimersByTimeAsync(29999)); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetcher).toHaveBeenCalledTimes(4);
    const bytes = fetcher.mock.calls.reduce((sum, [url]) => sum + new TextEncoder().encode(JSON.stringify(url.endsWith('/0') ? largeDetail : activePage)).length, 0);
    expect(bytes).toBeLessThan(2_000_000);
    await click('Refresh written calls'); expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('keeps sustained source traffic within14 selected reads per30s rather than one read per message', async () => {
    vi.useFakeTimers();
    const pendingCall = { ...call, state: 'pending' }, activePage = { ...page, active: true, items: [pendingCall] };
    const fetcher = vi.fn(async (url: string) => json(url.endsWith('/0') ? { ...detail, active: true, call: pendingCall } : activePage)); vi.stubGlobal('fetch', fetcher);
    const live = { requestId: 'ws-synthetic' };
    await render({ source: live }); await click('Call 1');
    for (let second = 1; second <= 30; second += 1) {
      await render({ source: live, changeKey: second * 1000 });
      await act(async () => vi.advanceTimersByTimeAsync(1000));
    }
    expect(fetcher).toHaveBeenCalledTimes(14);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/0'))).toHaveLength(7);
    expect(fetcher.mock.calls.every(([url]) => url.includes('/ws-synthetic/codex-calls'))).toBe(true);
  });
  it('coalesces only source hints at5s, preserves completed selection/expanded content, and does not poll', async () => {
    vi.useFakeTimers();
    const activePage = { ...page, active: true, complete: false }, activeDetail = { ...detail, active: true };
    const fetcher = vi.fn(async (url: string) => json(url.endsWith('/0') ? activeDetail : activePage)); vi.stubGlobal('fetch', fetcher);
    const live = { requestId: 'ws-synthetic' };
    await render({ source: live }); await click('Call 1');
    const expanded = container.querySelector('details')!; expanded.open = true;
    await render({ source: live, changeKey: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(4999)); expect(fetcher).toHaveBeenCalledTimes(2);
    await render({ source: live, changeKey: 50 });
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[2]?.[0]).toContain('?offset=0');
    expect(container.textContent).toContain('SYNTHETIC_SELECTED_OUTPUT');
    expect(container.querySelector('details')).toBe(expanded); expect(expanded.open).toBe(true);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('Call 1');
    await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(3);
    await click('Refresh written calls'); expect(fetcher).toHaveBeenCalledTimes(5);
    expect(container.querySelector('details')).toBe(expanded);
  });
  it('serializes changed pending detail after its metadata page and reflects final completion', async () => {
    vi.useFakeTimers(); let completed = false, resolvePage!: (value: Response) => void;
    const activePage = { ...page, active: true, complete: false, items: [{ ...call, state: 'pending' }] };
    let pageReads = 0;
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('/0')) return Promise.resolve(json({ ...detail, active: !completed, call: { ...call, state: completed ? 'completed' : 'pending' } }));
      if (++pageReads === 2) return new Promise<Response>(resolve => { resolvePage = resolve; });
      return Promise.resolve(json(activePage));
    }); vi.stubGlobal('fetch', fetcher);
    const live = { requestId: 'ws-synthetic' };
    await render({ source: live }); await click('Call 1');
    await render({ source: live, changeKey: 1 }); await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    await render({ source: live, changeKey: 2 });
    await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(3);
    completed = true; await act(async () => resolvePage(json(page)));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('Call 1');
    expect(container.textContent).toContain('SYNTHETIC_SELECTED_OUTPUT');
    await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('pauses while hidden or unchecked, resumes one dirty snapshot, and stops automatic retry on error', async () => {
    vi.useFakeTimers();
    let failed = false;
    const fetcher = vi.fn(async () => failed ? json({ error: { code: 'CODEX_INSPECTION_BUSY', message: 'busy' } }, 503) : json({ ...page, active: true })); vi.stubGlobal('fetch', fetcher);
    const live = { requestId: 'ws-synthetic' };
    await render({ source: live });
    const checkbox = container.querySelector('input')!;
    await act(async () => checkbox.click());
    await render({ source: live, changeKey: 1 }); await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(fetcher).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); checkbox.click(); });
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(fetcher).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetcher).toHaveBeenCalledTimes(2);
    failed = true;
    await render({ source: live, changeKey: 2 }); await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('busy');
    await render({ source: live, changeKey: 3 }); await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(3);
    failed = false; await click('Refresh written calls'); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await render({ source: live, changeKey: 4 });
    await act(async () => root.render(<p>closed</p>));
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('fetches only a metadata page until explicit selection and uses escaped readable detail plus native navigation', async () => {
    const fetcher = vi.fn(async (url: string) => json(url.endsWith('/0') ? detail : page)); vi.stubGlobal('fetch', fetcher);
    await render(); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]?.[0]).toBe('/api/proxy/requests/7/codex-calls?offset=0&limit=20');
    expect(container.textContent).not.toContain('SYNTHETIC_SELECTED_OUTPUT');
    await click('Call 1'); expect(fetcher).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('SYNTHETIC_SELECTED_OUTPUT');
    expect(container.textContent).toContain('INERT_CODEX_ONLY'); expect(container.querySelector('script')).toBeNull();
    await click('Open native trajectory'); expect(openSession).toHaveBeenCalledWith('scan-one');
    await render({ locale: 'zh' }); expect(fetcher).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('Codex 逐调用链路');
  });
  it('uses explicit refresh, not polling or automatic original/body fetches', async () => {
    const fetcher = vi.fn(async (_url: string) => json({ ...page, active: true, complete: false })); vi.stubGlobal('fetch', fetcher);
    await render(); expect(fetcher).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('written disk snapshot');
    await click('Refresh written calls'); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => url.includes('codex-calls'))).toBe(true);
  });
  it('aborts and discards an old selected body when relation/source invalidation arrives', async () => {
    let resolveDetail!: (value: Response) => void, signal: AbortSignal | undefined;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/0')) { signal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { resolveDetail = resolve; }); }
      return Promise.resolve(json(page));
    }); vi.stubGlobal('fetch', fetcher);
    await render(); await click('Call 1');
    const resolveOld = resolveDetail, oldSignal = signal;
    await render({ invalidateKey: 1 });
    expect(oldSignal?.aborted).toBe(true);
    expect(signal?.aborted).toBe(false);
    await act(async () => resolveOld(json(detail))); expect(container.textContent).not.toContain('SYNTHETIC_SELECTED_OUTPUT');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('Call 1');
    const fresh = { ...detail, requestPreview: 'FRESH_SELECTED_BODY', analysis: { ...detail.analysis, system: 'FRESH_SYSTEM', items: [] } };
    await act(async () => resolveDetail(json(fresh)));
    expect(container.textContent).toContain('FRESH_SELECTED_BODY'); expect(container.textContent).not.toContain('SYNTHETIC_SELECTED_OUTPUT');
  });
  it('shows bounded/incomplete/error states and can retry without any execution action', async () => {
    let failed = true;
    const fetcher = vi.fn(async () => failed ? json({ error: { code: 'CODEX_INSPECTION_FAILED', message: 'Synthetic integrity error' } }, 503) : json({ ...page, items: [], total: 0, complete: false, reasons: ['request_partial_record'] }));
    vi.stubGlobal('fetch', fetcher);
    await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Synthetic integrity error');
    failed = false; await click('Refresh written calls'); expect(container.textContent).toContain('request_partial_record'); expect(container.textContent).toContain('No response.create');
  });
  it('never restores a stale finalized-source fingerprint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/0') ? { ...detail, fingerprint: 'a'.repeat(64) } : page)));
    await render(); await click('Call 1'); expect(container.textContent).not.toContain('SYNTHETIC_SELECTED_OUTPUT');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CODEX_SOURCE_CHANGED');
  });
});
