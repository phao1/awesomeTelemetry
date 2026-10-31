import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureReparseControl } from './CaptureReparseControl.js';
import type { CaptureReparseResponse, CaptureReparseStatus } from '../core/trace-types.js';

function status(): CaptureReparseStatus {
  return { proxyId: 7, requestId: 'req-7', currentParserVersion: 3, currentMetricVersion: 1, state: 'current', unavailableReason: null,
    snapshot: { parserVersion: 3, metricVersion: 1, sourceFingerprint: 'a'.repeat(64), parsedAt: '2026-10-16T00:00:00.000Z', requestFormat: 'openai_chat', state: 'completed',
      usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: 19, totalTokens: 19, accounting: 'openai_subsets' },
      completeness: { complete: true, omittedCount: 0, reasons: [] } } };
}
function parsed(): CaptureReparseResponse {
  const value = status();
  return { status: value, analysis: { parserVersion: 3, requestFormat: 'openai_chat', model: null, responseId: null, state: 'completed', stopReason: null,
    system: 'RETURNED_BODY_NOT_DUPLICATED_IN_CONTROL', declarations: [], items: [], errors: [], unknownEvents: 0,
    usage: { ...value.snapshot!.usage, snapshots: [] }, completeness: value.snapshot!.completeness } };
}
const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'content-type': 'application/json' } });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onBegin = vi.fn(), onParsed = vi.fn();
const render = async (props: { id?: number; requestId?: string; locale?: 'en' | 'zh'; blocked?: boolean; invalidateKey?: number; onBegin?: () => void; onParsed?: (value: CaptureReparseResponse) => void } = {}) => act(async () => root.render(
  <CaptureReparseControl id={7} requestId="req-7" locale="en" blocked={false} invalidateKey={0} onBegin={onBegin} onParsed={onParsed} {...props} />,
));
const button = (text: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(node => node.textContent === text);
  if (found === undefined) throw new Error('Missing control: ' + text);
  return found;
};
const click = async (text: string) => act(async () => button(text).click());
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); onBegin.mockClear(); onParsed.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('explicit versioned same-capture reparse', () => {
  it.each(['en', 'zh'] as const)('loads status only on expansion, shows metadata limitations and does not poll/re-read on callback or locale changes (%s)', async locale => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json(status())); vi.stubGlobal('fetch', fetcher);
    await render({ locale }); expect(fetcher).not.toHaveBeenCalled();
    await click(locale === 'en' ? 'Offline reparse' : '离线重解析'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(['/api/proxy/requests/7/reparse', { headers: { accept: 'application/json' }, signal: expect.any(AbortSignal), cache: 'no-store' }]);
    expect(container.textContent).toContain('a'.repeat(64)); expect(container.textContent).toContain('2026-10-16T00:00:00.000Z');
    expect(container.textContent).toContain(locale === 'en' ? 'not a fresh file integrity check' : '不代表重新校验文件完整性');
    expect(container.querySelector('[data-reparse-usage="cacheReadTokens"]')?.textContent).toContain('—');
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    await render({ locale: locale === 'en' ? 'zh' : 'en', onBegin: () => undefined, onParsed: () => undefined }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['not_parsed', 'stale', 'unavailable'] as const)('renders explicit %s status without silently recomputing', async state => {
    const value = status(); value.state = state;
    if (state === 'not_parsed') value.snapshot = null;
    if (state === 'stale') value.snapshot!.parserVersion = 2;
    if (state === 'unavailable') { value.snapshot = null; value.unavailableReason = 'originals_incomplete'; }
    const fetcher = vi.fn(async () => json(value)); vi.stubGlobal('fetch', fetcher); await render(); await click('Offline reparse');
    expect(container.querySelector('[data-reparse-state]')?.textContent).toContain({ not_parsed: 'Not reparsed', stale: 'Stale metadata', unavailable: 'Unavailable' }[state]);
    expect(button('Reparse retained originals').disabled).toBe(state === 'unavailable'); expect(fetcher).toHaveBeenCalledTimes(1);
    if (state === 'stale') expect(container.textContent).toContain('2 / 1');
    if (state === 'unavailable') expect(container.textContent).toContain('originals_incomplete');
    expect(onBegin).not.toHaveBeenCalled(); expect(onParsed).not.toHaveBeenCalled();
  });
  it('posts only on explicit action, clears parent evidence first, and passes the actual result without another analysis GET/body copy', async () => {
    const value = parsed(); const order: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { order.push(init?.method ?? 'GET'); return json(init?.method === 'POST' ? value : status()); }); vi.stubGlobal('fetch', fetcher);
    await render({ onBegin: () => order.push('begin') }); await click('Offline reparse'); await click('Reparse retained originals');
    expect(order).toEqual(['GET', 'begin', 'POST']); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual(['/api/proxy/requests/7/reparse', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{"expectedRequestId":"req-7"}', signal: expect.any(AbortSignal), cache: 'no-store' }]);
    expect(onParsed).toHaveBeenCalledExactlyOnceWith(value); expect(container.textContent).toContain('Reparse result received');
    expect(container.textContent).not.toContain('RETURNED_BODY_NOT_DUPLICATED_IN_CONTROL');
    expect(fetcher.mock.calls.some(([url]) => url.includes('/analysis') || url.includes('/body/'))).toBe(false);
  });
  it.each(['blocked', 'invalidation', 'request', 'unmount', 'cancel', 'collapse'] as const)('aborts a pending POST and rejects late body callbacks after %s without automatic reads', async change => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return json(status()); signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }); vi.stubGlobal('fetch', fetcher); await render(); await click('Offline reparse');
    await click('Reparse retained originals'); expect(onBegin).toHaveBeenCalledTimes(1);
    if (change === 'blocked') await render({ blocked: true });
    if (change === 'invalidation') await render({ invalidateKey: 1 });
    if (change === 'request') await render({ id: 8, requestId: 'req-8' });
    if (change === 'unmount') { act(() => root.unmount()); root = createRoot(container); }
    if (change === 'cancel') await click('Stop waiting');
    if (change === 'collapse') await click('Offline reparse');
    expect(signal.aborted).toBe(true); await act(async () => finish(json(parsed())));
    expect(onParsed).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Reparse result received'); expect(container.textContent).not.toContain('a'.repeat(64));
    if (change === 'cancel' || change === 'collapse' || change === 'invalidation') expect(container.textContent).toContain('not guaranteed rollback');
  });
  it('times out after 10 seconds even if abort is ignored, preserves uncertainty, and requires explicit status refresh before another POST', async () => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return json(status()); signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }); vi.stubGlobal('fetch', fetcher); vi.useFakeTimers(); await render(); await click('Offline reparse'); await click('Reparse retained originals');
    expect(button('Reparse retained originals').disabled).toBe(true); await click('Reparse retained originals'); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('10 seconds'); expect(container.textContent).toContain('not guaranteed rollback');
    expect(button('Reparse retained originals').disabled).toBe(true);
    await act(async () => finish(json(parsed()))); expect(onParsed).not.toHaveBeenCalled();
    await click('Refresh reparse status'); expect(fetcher).toHaveBeenCalledTimes(3); expect(button('Reparse retained originals').disabled).toBe(false);
  });
  it('hides a stale status on invalidation without refetching and never fetches while blocked', async () => {
    const fetcher = vi.fn(async () => json(status())); vi.stubGlobal('fetch', fetcher);
    await render({ blocked: true }); expect(button('Offline reparse').disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    await render(); await click('Offline reparse'); await render({ invalidateKey: 1 });
    expect(container.textContent).not.toContain('a'.repeat(64)); expect(container.textContent).toContain('Evidence changed'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(button('Reparse retained originals').disabled).toBe(true); await click('Refresh reparse status'); expect(fetcher).toHaveBeenCalledTimes(2);
    await render({ blocked: true, invalidateKey: 1 }); expect(container.textContent).not.toContain('a'.repeat(64));
    await render({ invalidateKey: 1 }); expect(fetcher).toHaveBeenCalledTimes(2); expect(button('Reparse retained originals').disabled).toBe(true);
  });
  it.each(['blocked', 'invalidation', 'request', 'unmount', 'cancel', 'collapse'] as const)('owns a pending metadata GET and rejects its late status after %s', async change => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); });
    vi.stubGlobal('fetch', fetcher); await render(); await click('Offline reparse');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    if (change === 'blocked') await render({ blocked: true });
    if (change === 'invalidation') await render({ invalidateKey: 1 });
    if (change === 'request') await render({ id: 8, requestId: 'req-8' });
    if (change === 'unmount') { act(() => root.unmount()); root = createRoot(container); }
    if (change === 'cancel') await click('Stop waiting');
    if (change === 'collapse') await click('Offline reparse');
    expect(signal.aborted).toBe(true); await act(async () => finish(json(status())));
    expect(container.textContent).not.toContain('a'.repeat(64)); expect(onParsed).not.toHaveBeenCalled(); expect(onBegin).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('owns the metadata timeout and exposes semantic keyboard controls with Escape cancellation and focus return', async () => {
    let finish!: (value: Response) => void; let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); });
    vi.stubGlobal('fetch', fetcher); vi.useFakeTimers(); await render();
    const trigger = button('Offline reparse'); expect(trigger.type).toBe('button'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click('Offline reparse'); expect(container.querySelector('#' + CSS.escape(trigger.getAttribute('aria-controls')!))).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('10 seconds');
    await act(async () => finish(json(status()))); expect(container.textContent).not.toContain('a'.repeat(64));
    await click('Refresh reparse status');
    act(() => button('Stop waiting').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(signal.aborted).toBe(true); expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger);
    await act(async () => finish(json(status()))); expect(container.textContent).not.toContain('a'.repeat(64)); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('clears old status while refreshing and offers a static bilingual API error without automatic POST retry', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(json(status())).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValueOnce(json(status()));
    vi.stubGlobal('fetch', fetcher); await render(); await click('Offline reparse'); await click('Refresh reparse status');
    expect(container.textContent).not.toContain('a'.repeat(64));
    await act(async () => finish(json({ error: { code: 'CAPTURE_REPARSE_BUSY', message: '<script>secret</script>' } }, 503)));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CAPTURE_REPARSE_BUSY'); expect(container.querySelector('script')).toBeNull(); expect(container.textContent).not.toContain('secret');
    await render({ locale: 'zh' }); expect(container.textContent).toContain('读取失败'); expect(fetcher).toHaveBeenCalledTimes(2);
    await click('刷新重解析状态'); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('shows only allowlisted source reasons from real 422 envelopes, never private paths/messages, while retaining uncertain outcome', async () => {
    let posts = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return json(status());
      posts += 1;
      return json({ error: { code: 'CAPTURE_REPARSE_UNSUPPORTED', message: 'private-message /Users/private/original.body',
        details: { reason: posts === 1 ? 'source_integrity_failed' : '/Users/private/<script>unsafe-reason</script>', path: '/Users/private/original.body' } } }, 422);
    }); vi.stubGlobal('fetch', fetcher);
    await render(); await click('Offline reparse'); await click('Reparse retained originals');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CAPTURE_REPARSE_UNSUPPORTED');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('source_integrity_failed');
    expect(container.querySelector('[data-reparse-uncertain]')?.textContent).toContain('not guaranteed rollback');
    expect(onParsed).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
    await click('Refresh reparse status'); expect(container.querySelector('[role="alert"]')).toBeNull();
    await click('Reparse retained originals');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CAPTURE_REPARSE_UNSUPPORTED');
    expect(container.textContent).not.toContain('source_integrity_failed'); expect(container.textContent).not.toContain('unsafe-reason');
    expect(container.textContent).not.toContain('/Users/private'); expect(container.textContent).not.toContain('private-message'); expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[data-reparse-uncertain]')).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(4); expect(onParsed).not.toHaveBeenCalled();
  });
  it.each(['wrong_id', 'wrong_request', 'bad_version', 'current_mismatch', 'bad_hash', 'bad_date', 'impossible_date', 'missing_counter', 'invalid_counter', 'bad_state', 'bad_reason'] as const)('refuses malformed successful status metadata (%s)', async kind => {
    const value = status();
    if (kind === 'wrong_id') value.proxyId = 8;
    if (kind === 'wrong_request') value.requestId = 'req-other';
    if (kind === 'bad_version') value.currentMetricVersion = 0;
    if (kind === 'current_mismatch') value.snapshot!.parserVersion = 2;
    if (kind === 'bad_hash') value.snapshot!.sourceFingerprint = 'not-sha';
    if (kind === 'bad_date') value.snapshot!.parsedAt = 'yesterday';
    if (kind === 'impossible_date') value.snapshot!.parsedAt = '2026-02-30T00:00:00.000Z';
    if (kind === 'missing_counter') Reflect.deleteProperty(value.snapshot!.usage, 'inputTokens');
    if (kind === 'invalid_counter') value.snapshot!.usage.inputTokens = -1;
    if (kind === 'bad_state') value.snapshot = null;
    if (kind === 'bad_reason') value.unavailableReason = 'originals_deleted';
    const fetcher = vi.fn(async () => json(value)); vi.stubGlobal('fetch', fetcher); await render(); await click('Offline reparse');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('INVALID_REPARSE_RESPONSE');
    expect(button('Reparse retained originals').disabled).toBe(true); expect(onParsed).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['not_current', 'analysis_version', 'analysis_shape', 'analysis_unknown_counter', 'snapshot_mismatch'] as const)('rejects unsafe successful POST responses (%s) without a body callback', async kind => {
    const value = parsed();
    if (kind === 'not_current') value.status.state = 'stale';
    if (kind === 'analysis_version') value.analysis.parserVersion = 2;
    if (kind === 'analysis_shape') Reflect.deleteProperty(value.analysis, 'items');
    if (kind === 'analysis_unknown_counter') Reflect.deleteProperty(value.analysis.usage, 'outputTokens');
    if (kind === 'snapshot_mismatch') value.analysis.state = 'failed';
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'POST' ? value : status())); vi.stubGlobal('fetch', fetcher);
    await render(); await click('Offline reparse'); await click('Reparse retained originals');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('INVALID_REPARSE_RESPONSE'); expect(onParsed).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Reparse result received');
  });
  it.each(['failed', 'unknown', 'incomplete'] as const)('uses the latest callback without rereading or treating %s protocol as infrastructure failure', async state => {
    const value = parsed(); value.analysis.state = state; value.status.snapshot!.state = state; value.analysis.usage.outputTokens = null; value.status.snapshot!.usage.outputTokens = null;
    if (state === 'incomplete') {
      value.analysis.completeness = { complete: false, omittedCount: 1, reasons: ['response:interrupted'] };
      value.status.snapshot!.completeness = value.analysis.completeness;
    }
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'POST' ? value : status())); vi.stubGlobal('fetch', fetcher);
    const latest = vi.fn(); await render(); await click('Offline reparse'); await render({ onParsed: latest }); expect(fetcher).toHaveBeenCalledTimes(1);
    await click('Reparse retained originals'); expect(latest).toHaveBeenCalledExactlyOnceWith(value); expect(onParsed).not.toHaveBeenCalled();
    expect(latest.mock.calls[0]?.[0].analysis.usage.outputTokens).toBeNull(); expect(container.textContent).toContain(state);
    if (state === 'incomplete') expect(container.textContent).toContain('response:interrupted');
  });
});
