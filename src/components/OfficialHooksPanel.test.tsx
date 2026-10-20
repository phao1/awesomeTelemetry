import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeHookSummary } from '../core/claude-hooks.js';
import { OfficialHooksPanel } from './OfficialHooksPanel.js';

const roots: Root[] = [];
const status = { enabled: false, revision: 0, receivedCount: 2, lastReceivedAt: '2026-10-20T00:00:00.000Z' };
const item: ClaudeHookSummary = { id: 2, receivedAt: status.lastReceivedAt, eventName: 'PostToolUse', nativeSessionId: 'native / s', agentId: null, agentType: null, toolUseId: 'tool&a', toolName: 'Read', nativeDurationMs: 12.5, payloadBytes: 100, nativeSessionKey: 'retained-key', nativeSessionState: 'unique' };
const page = { status, items: [item], hasMore: true, nextCursor: 2 };
const rawJson = '{"private":"<script>window.pwned=true</script>中文"}';
const response = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'content-type': 'application/json' } });
function transport() {
  let current = status;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/events?')) return response({ ...page, status: current });
    if (url.endsWith('/events/2')) return response({ ...item, rawJson, sha256: 'a'.repeat(64) });
    if (url.endsWith('/configure')) {
      const body = JSON.parse(String(init?.body)) as { enabled: boolean; expectedRevision: number; confirmRaw?: boolean };
      expect(init?.method).toBe('POST'); expect(body.expectedRevision).toBe(current.revision); if (body.enabled) expect(body.confirmRaw).toBe(true);
      current = { ...current, enabled: body.enabled, revision: current.revision + 1 };
      return response({ status: current, settings: body.enabled ? { hooks: { Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:4188/api/hooks/claude/events', timeout: 5, headers: { Authorization: 'Bearer SYNTHETIC_ONLY' } }] }] } } : null });
    }
    throw new Error('Unexpected route');
  });
}
function render(latestId = 0) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root); const openSession = vi.fn();
  act(() => root.render(<OfficialHooksPanel locale="en" latestId={latestId} onOpenSession={openSession} />)); return { root, container, openSession };
}
async function toggle(container: Element, open: boolean) { await act(async () => { const details = container.querySelector('details')!; details.open = open; details.dispatchEvent(new Event('toggle')); }); }
async function click(container: Element, label: string) { await act(async () => { const button = [...container.querySelectorAll('button')].find(button => button.textContent === label); expect(button, label).toBeDefined(); button!.click(); }); }
async function ack(container: Element) { await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click()); }
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('CH-005 official hook workspace', () => {
  it('is collapsed without IO, opens with one metadata read and reads only the selected inert original', async () => {
    const fetcher = transport(); vi.stubGlobal('fetch', fetcher); const f = render(); expect(fetcher).not.toHaveBeenCalled();
    await toggle(f.container, true); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]![0]).toBe('/api/hooks/claude/events?');
    expect(f.container.textContent).toContain('Saved deliveries: 2'); expect(f.container.textContent).not.toContain(rawJson);
    expect([...f.container.querySelectorAll('button')].find(button => button.textContent === 'Enable and generate settings')!.disabled).toBe(true);
    await click(f.container, 'Open retained native session'); expect(f.openSession).toHaveBeenCalledExactlyOnceWith('retained-key'); expect(fetcher).toHaveBeenCalledTimes(1);
    await click(f.container, 'Inspect payload #2'); expect(fetcher).toHaveBeenCalledTimes(2); expect(f.container.querySelector('pre')!.textContent).toBe(rawJson); expect(f.container.querySelector('script')).toBeNull();
    await click(f.container, 'A+'); expect(f.container.querySelector('pre')!.style.fontSize).toBe('15px');
    act(() => f.root.render(<OfficialHooksPanel locale="zh" onOpenSession={f.openSession} />)); expect(fetcher).toHaveBeenCalledTimes(2); expect(f.container.textContent).toContain('关闭载荷');
  });
  it('enables, rotates and disables explicitly, hides secrets on close and never installs settings', async () => {
    const fetcher = transport(); vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true);
    await ack(f.container); await click(f.container, 'Enable and generate settings');
    expect((f.container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('Bearer SYNTHETIC_ONLY'); expect(f.container.textContent).toContain('Merge this fragment');
    await ack(f.container); await click(f.container, 'Rotate token and generate settings'); expect(fetcher).toHaveBeenCalledTimes(3);
    await click(f.container, 'Disable receiver'); expect(fetcher).toHaveBeenCalledTimes(4); expect(f.container.querySelector('textarea')).toBeNull();
    await ack(f.container); await click(f.container, 'Enable and generate settings'); await toggle(f.container, false); expect(f.container.querySelector('textarea')).toBeNull();
    await toggle(f.container, true); expect(fetcher).toHaveBeenCalledTimes(6); expect(f.container.querySelector('textarea')).toBeNull();
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/hooks/claude/'))).toBe(true);
  });
  it('uses the complete native tool scope and descending server cursor without fetching per-row bodies', async () => {
    const fetcher = transport(); vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true);
    await click(f.container, 'Show this exact tool scope #2');
    const expected = new URLSearchParams({ sessionId: item.nativeSessionId, toolUseId: item.toolUseId!, agentId: '' });
    expect(fetcher.mock.calls[1]![0]).toBe('/api/hooks/claude/events?' + expected);
    await click(f.container, 'Next page'); expected.set('cursor', '2'); expect(fetcher.mock.calls[2]![0]).toBe('/api/hooks/claude/events?' + expected);
    expect(fetcher.mock.calls.every(([url]) => url.includes('/events?'))).toBe(true);
  });
  it('does no idle polling, refreshes hinted metadata at most once per5s and honors pause', async () => {
    vi.useFakeTimers(); const fetcher = transport(); vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true);
    await act(async () => vi.advanceTimersByTimeAsync(60000)); expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => f.root.render(<OfficialHooksPanel locale="en" latestId={3} />)); await act(async () => vi.advanceTimersByTimeAsync(0)); expect(fetcher).toHaveBeenCalledTimes(2);
    act(() => f.root.render(<OfficialHooksPanel locale="en" latestId={4} />)); await act(async () => vi.advanceTimersByTimeAsync(4999)); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => (f.container.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement).click());
    act(() => f.root.render(<OfficialHooksPanel locale="en" latestId={5} />)); await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(f.container.textContent).toContain('metadata may be stale'); await click(f.container, 'Refresh metadata'); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('keeps cancelled configuration uncertain, suppresses late secrets and requires explicit status reconciliation', async () => {
    let release: (value: Response) => void = () => undefined; let signal: AbortSignal | null | undefined;
    const base = transport(), fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('/configure') ? new Promise<Response>(resolve => { release = resolve; signal = init?.signal; }) : base(url, init));
    vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true); await ack(f.container); await click(f.container, 'Enable and generate settings'); await click(f.container, 'Cancel waiting');
    expect(signal?.aborted).toBe(true); await act(async () => release(response({ status: { ...status, enabled: true, revision: 1 }, settings: { secret: 'LATE_SECRET' } })));
    expect(f.container.textContent).toContain('Command result unknown'); expect(f.container.querySelector('textarea')).toBeNull();
    expect([...f.container.querySelectorAll('button')].find(button => button.textContent === 'Enable and generate settings')!.disabled).toBe(true);
    await click(f.container, 'Refresh metadata'); expect(f.container.textContent).not.toContain('Command result unknown');
  });
  it('times out reads and configuration, aborts selected reads on collapse and never auto-retries failures', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | null | undefined; let stall = 'metadata'; const base = transport();
    const fetcher = vi.fn((url: string, init?: RequestInit) => (stall === 'metadata' || url.endsWith('/events/2') || url.endsWith('/configure')) ? new Promise<Response>(() => { signal = init?.signal; }) : base(url, init));
    vi.stubGlobal('fetch', fetcher); const f = render(); await toggle(f.container, true); await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(signal?.aborted).toBe(true); expect(f.container.textContent).toContain('HOOK_TIMEOUT');
    act(() => f.root.render(<OfficialHooksPanel locale="en" latestId={10} />)); await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(fetcher).toHaveBeenCalledTimes(1);
    stall = 'body'; await click(f.container, 'Refresh metadata'); await ack(f.container); await click(f.container, 'Enable and generate settings');
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(f.container.textContent).toContain('Command result unknown'); expect(signal?.aborted).toBe(true);
    await click(f.container, 'Refresh metadata'); await click(f.container, 'Inspect payload #2'); expect(signal?.aborted).toBe(false);
    await toggle(f.container, false); expect(signal?.aborted).toBe(true); expect(f.container.querySelector('[role=dialog]')).toBeNull();
  });
});
