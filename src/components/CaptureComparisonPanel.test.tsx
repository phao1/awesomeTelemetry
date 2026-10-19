import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureComparisonPanel } from './CaptureComparisonPanel.js';
import type { CaptureComparisonResponse, ProxyRequestListItem, RequestContextDiffResponse } from '../core/trace-types.js';

function request(id: number): ProxyRequestListItem {
  return { id, requestId: 'req-' + id, method: 'POST', url: 'https://synthetic.test/v1/messages', hostname: 'synthetic.test',
    responseStatus: 200, contentType: 'text/event-stream', isStreaming: true, startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:02.000Z', durationMs: 2000,
    captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, model: 'synthetic-model', inputTokens: 100, outputTokens: 20,
    parsedSessionId: null, parserRoute: '/v1/messages', captureGroupId: null, requestFormat: 'anthropic_messages', hasSystemPrompt: false };
}
function comparison(baseId = 1, targetId = 2): CaptureComparisonResponse {
  const side = (id: number): CaptureComparisonResponse['base'] => ({ request: request(id), originalDeletion: null, analysisUnavailableReason: null,
    evidence: { request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false,
      processing: { version: 1, status: 'ok', error: null },
      transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
        timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150, firstContentMs: id === baseId ? 800 : 900,
          firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', completedMs: 2000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } } },
    analysis: { parserVersion: 2, requestFormat: 'anthropic_messages', model: 'synthetic-model', state: 'completed', stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: id === baseId ? 20 : 30, cacheReadTokens: 40, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: 120,
        accounting: 'anthropic_additive_input', snapshots: [] }, completeness: { complete: true, omittedCount: 0, reasons: [] }, errorCount: 0, errorCodes: [], errorCodesTruncated: false } });
  return { base: side(baseId), target: side(targetId), generatedAt: '2026-10-16T00:00:03.000Z' };
}
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const setInput = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const open = vi.fn();
const render = async (props: { targetId?: number; locale?: 'en' | 'zh'; metadataOnly?: boolean; invalidateKey?: number } = {}) => act(async () => {
  root.render(<CaptureComparisonPanel targetId={2} locale="en" loadedItems={[request(1), request(2), request(3)]} onOpenRequest={open} {...props} />);
});
const button = (label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(node => node.textContent === label);
  if (found === undefined) throw new Error('Missing button: ' + label);
  return found;
};
const selectBase = async (id = '1') => act(async () => setInput(container.querySelector('input')!, id));
const compare = async () => act(async () => button('Compare selected captures').click());
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); open.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('explicit selected capture comparison', () => {
  it('does not read on mount or selection, validates manual IDs, and uses one GET with real calculations', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response(comparison())); vi.stubGlobal('fetch', fetcher);
    await render(); expect(fetcher).not.toHaveBeenCalled();
    for (const id of ['', '0', '-1', '1e3', '1.5', '2', '9007199254740992']) {
      await selectBase(id); expect(button('Compare selected captures').disabled).toBe(true);
    }
    await selectBase(); expect(fetcher).not.toHaveBeenCalled();
    await compare(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(['/api/proxy/requests/2/comparison?base=1', { headers: { accept: 'application/json' }, signal: expect.any(AbortSignal), cache: 'no-store' }]);
    const contentRow = container.querySelector('[data-comparison-metric="firstContentMs"]')!;
    expect([...contentRow.querySelectorAll('td')].slice(0, 3).map(node => node.textContent)).toEqual(['800 ms', '900 ms', '+100 ms']);
    expect(contentRow.querySelector('details')?.open).toBe(false);
    expect(contentRow.querySelector('details')?.textContent).toContain('base.evidence.transport.timing.firstContentMs');
    expect(container.textContent).toContain('not a controlled experiment');
    expect(container.textContent).toContain('Cost is unknown');
    expect(container.textContent).toContain('anthropic_additive_input'); expect(container.textContent).toContain('sse_event_dispatch');
    expect(container.querySelector('[data-comparison-metric="cacheWriteTokens"]')?.textContent).toContain('—');
    expect(fetcher.mock.calls.some(call => String(call[0]).includes('context-diff') || String(call[0]).includes('/body/'))).toBe(false);
    act(() => button('Open base capture #1').click()); act(() => button('Open target capture #2').click()); expect(open.mock.calls).toEqual([[1], [2]]);
    await render({ locale: 'zh' }); expect(fetcher).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('不是受控实验');
  });
  it('selects an already loaded base without scanning the request list', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response(comparison(3))); vi.stubGlobal('fetch', fetcher);
    await render();
    const select = container.querySelector('select')!;
    expect([...select.options].map(option => option.value)).toEqual(['', '1', '3']);
    await act(async () => { select.value = '3'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(fetcher).not.toHaveBeenCalled(); await compare(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('comparison?base=3');
  });
  it('derives diagnostics only from the loaded comparison, with threshold/locale/source actions adding no requests', async () => {
    const fetcher = vi.fn(async () => response(comparison())); vi.stubGlobal('fetch', fetcher);
    await render(); expect(container.querySelector('[aria-label="Selected-pair evidence diagnostics"]')).toBeNull();
    await selectBase(); await compare();
    const diagnostics = container.querySelector('[aria-label="Selected-pair evidence diagnostics"]')!;
    expect(diagnostics).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => setInput(diagnostics.querySelector('input')!, '1'));
    expect(diagnostics.querySelectorAll('[data-diagnostic-finding="slow_network"]')).toHaveLength(2);
    const source = diagnostics.querySelector('[data-diagnostic-finding="slow_network"] button') as HTMLButtonElement;
    act(() => source.click()); expect(open).toHaveBeenLastCalledWith(1); expect(fetcher).toHaveBeenCalledTimes(1);
    await render({ locale: 'zh' });
    expect(container.querySelector('[aria-label="选定组合的证据诊断"] input')?.getAttribute('value')).toBe('1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['pair', 'mode', 'invalidation'] as const)('unmounts already shown diagnostic findings immediately after %s without extra reads', async change => {
    const fetcher = vi.fn(async () => response(comparison())); vi.stubGlobal('fetch', fetcher);
    await render(); await selectBase(); await compare();
    expect(container.querySelector('[aria-label="Selected-pair evidence diagnostics"]')).not.toBeNull();
    if (change === 'pair') await selectBase('3');
    if (change === 'mode') await render({ metadataOnly: true });
    if (change === 'invalidation') await render({ invalidateKey: 1 });
    expect(container.querySelector('[aria-label="Selected-pair evidence diagnostics"]')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps the same pending read on locale changes instead of cancelling or rereading evidence', async () => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); });
    vi.stubGlobal('fetch', fetcher); await render(); await selectBase(); await compare(); await render({ locale: 'zh' });
    expect(signal.aborted).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => finish(response(comparison())));
    expect(container.querySelector('[data-comparison-result]')).not.toBeNull(); expect(container.textContent).toContain('代理时序偏移');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'pair', 'target', 'mode', 'invalidation', 'unmount'] as const)('aborts pending work and rejects a late result after %s without auto-reread', async change => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); });
    vi.stubGlobal('fetch', fetcher); await render(); await selectBase(); await compare();
    if (change === 'cancel') await act(async () => button('Cancel comparison').click());
    if (change === 'pair') await selectBase('3');
    if (change === 'target') await render({ targetId: 3 });
    if (change === 'mode') await render({ metadataOnly: true });
    if (change === 'invalidation') await render({ invalidateKey: 1 });
    if (change === 'unmount') { act(() => root.unmount()); root = createRoot(container); }
    expect(signal.aborted).toBe(true);
    await act(async () => finish(response(comparison())));
    expect(container.querySelector('[data-comparison-result]')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
    if (change === 'invalidation') expect(container.textContent).toContain('Evidence changed');
  });
  it('owns the 10s deadline even if transport ignores abort, and supports an explicit retry', async () => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); });
    vi.stubGlobal('fetch', fetcher); vi.useFakeTimers(); await render(); await selectBase(); await compare();
    expect(button('Refresh comparison').disabled).toBe(true);
    await act(async () => button('Refresh comparison').click());
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('10 seconds');
    await act(async () => finish(response(comparison()))); expect(container.querySelector('[data-comparison-result]')).toBeNull();
    fetcher.mockImplementation(async () => response(comparison()));
    await act(async () => button('Retry comparison').click()); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-comparison-result]')).not.toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('retains a selected pair on invalidation but hides its evidence until explicit refresh', async () => {
    const fetcher = vi.fn(async () => response(comparison())); vi.stubGlobal('fetch', fetcher);
    await render(); await selectBase(); await compare(); await render({ invalidateKey: 1 });
    expect(container.querySelector('[data-comparison-result]')).toBeNull(); expect(container.textContent).toContain('Evidence changed'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input')?.value).toBe('1');
    await act(async () => button('Refresh comparison').click()); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-comparison-result]')).not.toBeNull();
  });
  it.each(['metadata', 'base_deleted', 'target_deleted'] as const)('prevents body diff and body-derived reads for %s mode', async mode => {
    const data = comparison();
    if (mode === 'metadata') for (const side of [data.base, data.target]) { side.analysis = null; side.analysisUnavailableReason = 'metadata_only'; }
    else {
      const side = mode === 'base_deleted' ? data.base : data.target;
      side.originalDeletion = { id: 'job-1', proxyId: side.request.id, requestId: side.request.requestId, state: 'failed', error: 'CAPTURE_STORE_BUSY',
        createdAt: data.generatedAt, updatedAt: data.generatedAt, completedAt: null };
      side.analysis = null; side.analysisUnavailableReason = 'original_deleted';
    }
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response(data)); vi.stubGlobal('fetch', fetcher);
    await render({ metadataOnly: mode === 'metadata' }); await selectBase(); await compare();
    expect(button('Open context diff for this pair').disabled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/proxy/requests/2/comparison?base=1' + (mode === 'metadata' ? '&mode=metadata' : ''));
    await act(async () => button('Open context diff for this pair').click()); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('lazy-mounts the existing context diff only on explicit action and passes the exact selected pair', async () => {
    const ref = (id: number) => ({ id, requestId: 'req-' + id, startedAt: '2026-10-16T00:00:00.000Z', hostname: 'synthetic.test', model: 'synthetic-model', captureMethod: 'mitm' as const,
      parserRoute: '/v1/messages', requestFormat: 'anthropic_messages' as const, parsedSessionId: null, captureGroupId: null, bodySha256: 'a'.repeat(64), bodyBytes: 10 });
    const diff: RequestContextDiffResponse = { base: ref(1), target: ref(2), pairing: { confidence: 'manual', reason: 'EXPLICIT_PAIR_DIFF', warnings: [] }, noChange: true,
      growth: { baseChars: 10, targetChars: 10, deltaChars: 0, messageDelta: 0, toolDelta: 0, inputTokenDelta: null, inputTokenDeltaReason: 'usage_missing' }, indicators: [], categories: [],
      completeness: { complete: true, omittedCount: 0, reasons: [] }, generatedAt: '2026-10-16T00:00:03.000Z', durationMs: 1 };
    const fetcher = vi.fn(async (url: string) => response(url.includes('context-diff') ? diff : comparison())); vi.stubGlobal('fetch', fetcher);
    await render(); await selectBase(); await compare(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="context-diff-panel"]')).toBeNull();
    await act(async () => { button('Open context diff for this pair').click(); await import('./RequestContextDiffPanel.js'); });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/proxy/requests/2/comparison?base=1', '/api/proxy/requests/2/context-diff?base=1']);
    expect(container.textContent).toContain('EXPLICIT_PAIR_DIFF');
    await render({ metadataOnly: true }); expect(container.querySelector('[data-testid="context-diff-panel"]')).toBeNull(); expect(container.textContent).not.toContain('EXPLICIT_PAIR_DIFF');
  });
  it('shows local API errors, retries explicitly and renders observed strings inertly', async () => {
    const data = comparison(); data.base.request.model = '<img src=x onerror=alert(1)>';
    const fetcher = vi.fn().mockResolvedValueOnce(response({ error: { code: 'CAPTURE_COMPARISON_LIMIT', message: 'synthetic limit' } }, 503)).mockResolvedValueOnce(response(data)); vi.stubGlobal('fetch', fetcher);
    await render(); await selectBase(); await compare();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CAPTURE_COMPARISON_LIMIT'); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => button('Retry comparison').click()); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>'); expect(container.querySelector('img')).toBeNull();
  });
  it.each(['wrong_pair', 'metadata_analysis', 'deleted_analysis'] as const)('rejects an unsafe successful response (%s) rather than showing body-derived evidence', async kind => {
    const data = comparison();
    if (kind === 'wrong_pair') data.base.request.id = 99;
    if (kind === 'deleted_analysis') data.base.originalDeletion = { id: 'job', proxyId: 1, requestId: 'req-1', state: 'pending', error: null, createdAt: data.generatedAt, updatedAt: data.generatedAt, completedAt: null };
    const fetcher = vi.fn(async () => response(data)); vi.stubGlobal('fetch', fetcher);
    await render({ metadataOnly: kind === 'metadata_analysis' }); await selectBase(); await compare();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('INVALID_COMPARISON');
    expect(container.querySelector('[data-comparison-result]')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
