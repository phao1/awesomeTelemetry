import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyLivePanel } from './ProxyLivePanel.js';
import type { LiveStreamEntry } from './ProxyLivePanel.js';

/** Transport-only double; lifecycle/filtering/bounds/rendering use the real component. */
class EventSourceTransport {
  static instances: EventSourceTransport[] = [];
  readonly url: string;
  listeners = new Map<string, EventListener[]>();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  constructor(url: string) { this.url = url; EventSourceTransport.instances.push(this); }
  addEventListener(name: string, listener: EventListener): void { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  emit(name: string, value: unknown): void { this.raw(name, JSON.stringify(value)); }
  raw(name: string, data: string): void { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data })); }
}
const stream = (requestId: string, ended = false): LiveStreamEntry => ({ requestId, hostname: requestId + '.test', startedAt: '2026-10-16T00:00:00.000Z', ended });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = (streams: LiveStreamEntry[], locale: 'zh' | 'en' = 'en') => act(() => root.render(<ProxyLivePanel streams={streams} locale={locale} />));
const select = (id: string) => act(() => { (container.querySelector('[data-stream-id="' + id + '"]') as HTMLButtonElement).click(); });
beforeEach(() => {
  EventSourceTransport.instances = []; vi.stubGlobal('EventSource', EventSourceTransport);
  // Transport remains pending unless the inventory test explicitly supplies it.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('selected ephemeral live preview', () => {
  it('does not remount an opened inspector or reset its pause setting on relation invalidation', async () => {
    await import('./CodexCallsPanel.js');
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/proxy/live' ? { items: [] } : {
      requestId: 'ws-selected', active: true, fingerprint: 'f'.repeat(64), items: [], offset: 0, limit: 20, total: 0, hasMore: false, complete: false, reasons: [], unassignedEvents: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<ProxyLivePanel streams={[stream('ws-selected')]} locale="en" />));
    select('ws-selected');
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Codex call chain')!.click(); });
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => checkbox.click()); expect(checkbox.checked).toBe(false);
    await act(async () => root.render(<ProxyLivePanel streams={[stream('ws-selected')]} locale="en" invalidateKey={1} />));
    expect(container.querySelector('input[type="checkbox"]')).toBe(checkbox);
    expect(checkbox.checked).toBe(false); expect(EventSourceTransport.instances).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('reuses the selected SSE for bounded inspector updates, including reconnect and final end, never unopened inspectors', async () => {
    await import('./CodexCallsPanel.js');
    let ended = false, total = 0;
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/proxy/live' ? { items: [] } : {
      requestId: 'ws-selected', active: !ended, fingerprint: 'f'.repeat(64), items: [], offset: 0, limit: 20, total, hasMore: false, complete: ended, reasons: [], unassignedEvents: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<ProxyLivePanel streams={[stream('ws-selected')]} locale="en" />));
    select('ws-selected'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_sources_changed', { requestIds: ['ws-selected'] }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Codex call chain')!.click(); });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(EventSourceTransport.instances).toHaveLength(1);
    vi.useFakeTimers();
    try {
      await act(async () => { source.emit('proxy_sources_changed', { requestIds: ['ws-other'] }); source.raw('proxy_sources_changed', '{bad json'); });
      await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(2);
      total = 3;
      await act(async () => source.emit('proxy_sources_changed', { requestIds: ['ws-selected'] }));
      await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetcher).toHaveBeenCalledTimes(3);
      expect(container.textContent).toContain('0–0 / 3');
      await act(async () => source.onopen?.()); await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(4);
      ended = true;
      await act(async () => source.emit('proxy_stream_ended', { requestId: 'ws-selected' }));
      await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fetcher).toHaveBeenCalledTimes(5);
      expect(source.close).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(5);
      expect(EventSourceTransport.instances).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('rediscovers active WS metadata after reload without subscribing or fetching bodies, and preserves newer terminal notifications', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [stream('ws-before-open')] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<ProxyLivePanel streams={[]} locale="en" />));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]).toEqual(['/api/proxy/live', expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' })]);
    expect(container.querySelector('[data-stream-id="ws-before-open"]')).not.toBeNull();
    expect(EventSourceTransport.instances).toHaveLength(0);
    render([stream('ws-before-open', true)]);
    expect((container.querySelector('[data-stream-id="ws-before-open"]') as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Refresh active connections')!.click(); });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(EventSourceTransport.instances).toHaveLength(0);
  });
  it('has bilingual empty/unselected states and never subscribes before an explicit selection', () => {
    render([]); expect(container.textContent).toContain('No recent live streams');
    render([], 'zh'); expect(container.textContent).toContain('暂无近期实时流');
    render([stream('a'), stream('done', true)]);
    expect(EventSourceTransport.instances).toHaveLength(0);
    expect((container.querySelector('[data-stream-id="done"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('Select an active stream');
  });
  it('encodes only the selected request, filters other IDs, renders immediately and escapes text', () => {
    const id = 'req/a?b&c'; render([stream(id)]); select(id);
    const source = EventSourceTransport.instances[0]!;
    expect(source.url).toBe('/api/events?requestId=req%2Fa%3Fb%26c');
    expect(container.textContent).toContain('Connecting');
    act(() => source.onopen?.()); expect(container.textContent).toContain('Waiting for fragments');
    act(() => source.emit('proxy_stream_chunk', { requestId: 'other', chunk: 'WRONG_STREAM' }));
    expect(container.textContent).not.toContain('WRONG_STREAM');
    act(() => source.emit('proxy_stream_chunk', { requestId: id, chunk: '<img src=x onerror=alert(1)>🤖' }));
    expect(container.querySelector('pre')?.textContent).toBe('<img src=x onerror=alert(1)>🤖');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('earlier fragments');
  });
  it('does not reconnect on locale, unrelated list, or metadata changes', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'retained' }));
    render([{ ...stream('a'), hostname: 'changed.test' }, stream('b')], 'zh');
    expect(EventSourceTransport.instances).toHaveLength(1); expect(source.close).not.toHaveBeenCalled();
    expect(container.querySelector('pre')?.textContent).toBe('retained');
    expect(container.textContent).toContain('选择之前');
  });
  it('preserves partial preview on disconnect and automatic reconnect, without constructing another EventSource', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'before-' }));
    act(() => source.onerror?.());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Disconnected');
    expect(source.close).not.toHaveBeenCalled(); expect(EventSourceTransport.instances).toHaveLength(1);
    act(() => { source.onopen?.(); source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'after' }); });
    expect(container.querySelector('pre')?.textContent).toBe('before-after');
    expect(container.textContent).toContain('gap');
  });
  it('closes matching terminal events once, ignores unrelated/late data and keeps the ended preview', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'final evidence' }));
    act(() => source.emit('proxy_stream_ended', { requestId: 'other' })); expect(source.close).not.toHaveBeenCalled();
    act(() => source.emit('proxy_stream_ended', { requestId: 'a' })); expect(source.close).toHaveBeenCalledTimes(1);
    act(() => { source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'LATE' }); source.onerror?.(); });
    render([stream('a', true)], 'zh');
    expect(container.querySelector('pre')?.textContent).toBe('final evidence');
    expect(container.textContent).toContain('已结束');
    expect(source.close).toHaveBeenCalledTimes(1);
  });
  it('drains selected tail chunks after metadata ends before closing on its own ordered terminal event', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'metadata-finished' }));
    render([stream('a', true)]);
    expect(source.close).not.toHaveBeenCalled();
    act(() => {
      source.emit('proxy_stream_chunk', { requestId: 'a', chunk: '-tail' });
      source.emit('proxy_stream_ended', { requestId: 'a' });
    });
    expect(source.close).toHaveBeenCalledTimes(1); expect(container.querySelector('pre')?.textContent).toBe('metadata-finished-tail');
    render([stream('a')]); expect(EventSourceTransport.instances).toHaveLength(1);
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'LATE' }));
    expect(container.querySelector('pre')?.textContent).toBe('metadata-finished-tail');
  });
  it('limits metadata-end draining to five seconds then closes with a persistent gap warning', () => {
    vi.useFakeTimers();
    try {
      render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
      act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'partial' }));
      render([stream('a', true)]);
      act(() => vi.advanceTimersByTime(2000));
      render([stream('a')], 'zh');
      act(() => vi.advanceTimersByTime(2999)); expect(source.close).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1)); expect(source.close).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('缺口'); expect(container.querySelector('pre')?.textContent).toBe('partial');
      act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'LATE' }));
      expect(container.querySelector('pre')?.textContent).toBe('partial');
      render([stream('a')]); expect(EventSourceTransport.instances).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('cancels the drain deadline on its own terminal event or unmount without a false timeout gap', async () => {
    // Settle the independent metadata HTTP transport before checking ownership
    // of the selected SSE drain timer. Keep every original timer assertion.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } })));
    await act(async () => root.render(<ProxyLivePanel streams={[stream('a'), stream('b')]} locale="en" />));
    vi.useFakeTimers();
    try {
      render([stream('a'), stream('b')]); select('a'); const first = EventSourceTransport.instances[0]!;
      render([stream('a', true), stream('b')]);
      expect(vi.getTimerCount()).toBe(1);
      act(() => first.emit('proxy_stream_ended', { requestId: 'a' }));
      expect(vi.getTimerCount()).toBe(0);
      act(() => vi.advanceTimersByTime(5000));
      expect(container.textContent).not.toContain('A connection gap occurred');
      expect(first.close).toHaveBeenCalledTimes(1);
      select('b'); const second = EventSourceTransport.instances[1]!;
      render([stream('a', true), stream('b', true)]);
      expect(vi.getTimerCount()).toBe(1);
      act(() => root.unmount()); expect(vi.getTimerCount()).toBe(0); expect(second.close).toHaveBeenCalledTimes(1);
      root = createRoot(container);
    } finally { vi.useRealTimers(); }
  });
  it('switches ownership, rejects late old events, and closes on deselection and unmount', () => {
    render([stream('a'), stream('b')]); select('a'); const first = EventSourceTransport.instances[0]!;
    act(() => first.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'old' }));
    select('b'); const second = EventSourceTransport.instances[1]!; expect(first.close).toHaveBeenCalledTimes(1);
    act(() => { first.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'LATE' }); second.emit('proxy_stream_chunk', { requestId: 'b', chunk: 'new' }); });
    expect(container.querySelector('pre')?.textContent).toBe('new');
    act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Close preview')!.click(); });
    expect(second.close).toHaveBeenCalledTimes(1); expect(container.querySelector('pre')).toBeNull();
    select('a'); const third = EventSourceTransport.instances[2]!;
    act(() => root.unmount()); expect(third.close).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });
  it('bounds the displayed UTF-8 prefix to 64KiB without splitting an emoji or appending future fragments', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'a'.repeat(65534) + '🤖' + 'end' }));
    expect(new TextEncoder().encode(container.querySelector('pre')!.textContent!).byteLength).toBe(65534);
    expect(container.textContent).toContain('64 KiB');
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'b' }));
    expect(container.querySelector('pre')?.textContent).toBe('a'.repeat(65534));
    expect(container.textContent).toContain('Truncated');
  });
  it('reports malformed frames, ignores invalid payload types and continues handling valid matching data', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => { source.raw('proxy_stream_chunk', '{'); source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 9 }); source.emit('proxy_stream_ended', {}); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid preview frame');
    expect(source.close).not.toHaveBeenCalled();
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'valid' }));
    expect(container.querySelector('pre')?.textContent).toBe('valid');
  });
  it('closes an evicted selected stream, preserving preview and explaining the unavailable live entry', () => {
    render([stream('a')]); select('a'); const source = EventSourceTransport.instances[0]!;
    act(() => source.emit('proxy_stream_chunk', { requestId: 'a', chunk: 'kept' }));
    render([stream('b')]); expect(source.close).toHaveBeenCalledTimes(1);
    expect(container.querySelector('pre')?.textContent).toBe('kept');
    expect(container.textContent).toContain('no longer in the recent list');
  });
  it('shows a constructor failure and supports an explicit local subscription retry without losing the warning', () => {
    vi.stubGlobal('EventSource', class { constructor() { throw new Error('unavailable'); } });
    render([stream('a')]); select('a');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
    vi.stubGlobal('EventSource', EventSourceTransport);
    act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry preview connection')!.click(); });
    expect(EventSourceTransport.instances).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('gap');
  });
});
