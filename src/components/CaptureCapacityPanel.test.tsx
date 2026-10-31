import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureMetadataCapacity, CaptureStorageStatus, ProxyRuntimeStatus } from '../core/trace-types.js';
import { CaptureCapacityPanel } from './CaptureCapacityPanel.js';

const capacity: CaptureMetadataCapacity = { databaseBytes: 2000, walBytes: 1000, combinedLimitBytes: 200_000_000, walLimitBytes: 20_000_000,
  combinedAdmissionBytes: 180_000_000, walAdmissionBytes: 8_000_000, state: 'ready', reason: null, checkedAt: '2026-10-16T00:00:00.000Z' };
const storage: CaptureStorageStatus = { usedBytes: 4, quotaBytes: 10, pendingBytes: 2, maxBodyBytes: 8, maxPendingBytes: 6, activeBodies: 1, exhausted: false };
const status: ProxyRuntimeStatus = { running: false, starting: false, port: null, requestCount: 0, startedAt: null };
const roots: Root[] = [];
function response(value: unknown, code = 200): Response { return { ok: code < 400, status: code, text: async () => JSON.stringify(value) } as Response; }
const isCapacity = (url: string): boolean => url.endsWith('/capacity');
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function button(container: HTMLElement): HTMLButtonElement { const result = container.querySelector('button'); if (result === null) throw new Error('Missing refresh control'); return result; }
function mount(runtimeStatus: ProxyRuntimeStatus | null = status) {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  act(() => root.render(<CaptureCapacityPanel locale="en" runtimeStatus={runtimeStatus} />)); return { container, root };
}
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('explicit capture capacity snapshots', () => {
  it('returns a keyboard refresh focus but never steals initial or subsequently moved focus', async () => {
    let delayed = false; const finish: Array<(value: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => delayed ? new Promise<Response>(resolve => finish.push(resolve)) : response(isCapacity(url) ? capacity : storage)));
    const { container } = mount(); await flush(); expect(document.activeElement).not.toBe(button(container));
    delayed = true; act(() => { button(container).focus(); button(container).click(); button(container).blur(); });
    await act(async () => { finish.shift()!(response(capacity)); finish.shift()!(response(storage)); }); expect(document.activeElement).toBe(button(container));
    const other = document.createElement('button'); document.body.appendChild(other);
    act(() => { button(container).click(); other.focus(); });
    await act(async () => { finish.shift()!(response(capacity)); finish.shift()!(response(storage)); }); expect(document.activeElement).toBe(other);
  });
  it('loads exactly two bounded GETs and distinguishes original quota from DB/WAL and free disk space', async () => {
    const fetcher = vi.fn(async (url: string) => response(isCapacity(url) ? capacity : storage)); vi.stubGlobal('fetch', fetcher);
    const { container } = mount(); await flush();
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(['/api/proxy/capacity', '/api/proxy/storage']);
    expect(container.textContent).toContain('Remaining quota (not free disk)'); expect(container.textContent).toContain('6 B');
    expect(container.textContent).toContain('3,000 B'); expect(container.textContent).toContain('180,000,000 B');
    expect(container.textContent).toContain('200,000,000 B'); expect(container.querySelector('time')?.dateTime).toBe(capacity.checkedAt);
    expect(container.textContent).toContain('previously confirmed pending deletions'); expect(container.textContent).toContain('physical free disk space was not checked');
    expect(container.querySelectorAll('h3')).toHaveLength(2); expect(button(container).disabled).toBe(false);
  });
  it('clamps an exhausted original quota at zero without declaring the independent metadata store full', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(isCapacity(url) ? capacity : { ...storage, usedBytes: 12, exhausted: true })));
    const { container } = mount(); await flush();
    expect(container.textContent).toContain('Original quota exhausted'); expect(container.textContent).toContain('0 B'); expect(container.textContent).not.toContain('-2 B');
    expect(container.textContent).toContain('Metadata is below admission watermarks'); expect(container.textContent).toContain('Stop monitoring, then explicitly choose body cleanup');
  });
  it('shows WAL pressure and its reader guidance independently from original quota availability', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(isCapacity(url) ? { ...capacity, walBytes: 12_000_000, state: 'limited', reason: 'wal_limit' } : storage)));
    const { container } = mount(); await flush(); expect(container.textContent).toContain('Metadata admission is limited');
    expect(container.textContent).toContain('inspect long-lived readers'); expect(container.textContent).toContain('Original quota has room');
  });
  it('shows combined pressure without recommending direct DB/WAL or scan deletion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(isCapacity(url) ? { ...capacity, databaseBytes: 180_000_000, state: 'limited', reason: 'database_limit' } : storage)));
    const { container } = mount(); await flush(); expect(container.textContent).toContain('plan a database split');
    expect(container.textContent).toContain('do not directly delete DB/WAL or scan data');
  });
  it('distinguishes unknown metadata sizes from actual zero originals', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(isCapacity(url) ? { ...capacity, databaseBytes: null, walBytes: null, state: 'unavailable', reason: 'stat_error' } : { ...storage, usedBytes: 0 })));
    const { container } = mount(); await flush();
    const sections = container.querySelectorAll('section'); expect(sections[0]?.textContent).toContain('0 B'); expect(sections[1]?.textContent).toContain('capacity is unknown');
    expect(sections[1]?.querySelectorAll('dd')[0]?.textContent).toBe('—'); expect(sections[1]?.textContent).not.toContain('below admission');
  });
  it('preserves a successful independent snapshot when the other endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => isCapacity(url) ? response(capacity) : response({ error: { code: 'CAPTURE_RECOVERY_FAILED', message: 'not rendered upstream detail' } }, 503)));
    const { container } = mount(); await flush(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('CAPTURE_RECOVERY_FAILED');
    expect(container.textContent).toContain('Metadata is below admission'); expect(container.textContent).not.toContain('not rendered upstream detail'); expect(container.textContent).not.toContain('Original quota has room');
  });
  it('rejects contradictory, malformed and unsafe snapshots instead of inventing availability', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(isCapacity(url) ? { ...capacity, walBytes: 13_000_000 } : { ...storage, usedBytes: -1 })));
    const { container } = mount(); await flush(); expect(container.textContent).toContain('INVALID_METADATA_CAPACITY'); expect(container.textContent).toContain('INVALID_ORIGINAL_STORAGE');
    expect(container.textContent).not.toContain('below admission'); expect(container.textContent).not.toContain('Original quota has room');
  });
  it('clears old snapshots before refresh, prevents duplicate refreshes and only reads', async () => {
    const deferred: Array<(value: Response) => void> = []; let count = 0;
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => ++count <= 2 ? response(isCapacity(url) ? capacity : storage) : new Promise<Response>(resolve => deferred.push(resolve))); vi.stubGlobal('fetch', fetcher);
    const { container } = mount(); await flush();
    act(() => { button(container).click(); button(container).click(); }); expect(fetcher).toHaveBeenCalledTimes(4); expect(button(container).disabled).toBe(true);
    expect(container.textContent).not.toContain('below admission'); expect(container.textContent).not.toContain('3,000 B');
    await act(async () => { deferred[0]!(response(capacity)); deferred[1]!(response(storage)); });
    expect(button(container).disabled).toBe(false); expect(fetcher.mock.calls.every(([, init]) => init?.method === undefined && init?.signal instanceof AbortSignal)).toBe(true);
  });
  it('times out an abort-ignoring transport, keeps completed evidence and rejects its late result', async () => {
    vi.useFakeTimers(); let finish!: (value: Response) => void; const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { signals.push(init!.signal as AbortSignal); return isCapacity(url) ? response(capacity) : new Promise<Response>(resolve => { finish = resolve; }); }));
    const { container } = mount(); await flush(); expect(container.textContent).toContain('below admission');
    await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(container.textContent).toContain('CAPACITY_TIMEOUT'); expect(button(container).disabled).toBe(false); expect(signals.every(signal => signal.aborted)).toBe(true);
    await act(async () => { finish(response(storage)); }); expect(container.textContent).not.toContain('Original quota has room'); expect(container.textContent).toContain('below admission');
  });
  it('aborts owned requests and drops callbacks after unmount', async () => {
    const signals: AbortSignal[] = [], finish: Array<(value: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { signals.push(init!.signal as AbortSignal); return new Promise<Response>(resolve => finish.push(resolve)); }));
    const { container, root } = mount(); act(() => root.unmount()); roots.splice(roots.indexOf(root), 1);
    expect(signals.every(signal => signal.aborted)).toBe(true); await act(async () => { finish[0]!(response(capacity)); finish[1]!(response(storage)); }); expect(container.textContent).toBe('');
  });
  it('marks semantic runtime changes stale without polling, but ignores key ordering and locale-only rerenders', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async (url: string) => response(isCapacity(url) ? capacity : storage)); vi.stubGlobal('fetch', fetcher);
    const { container, root } = mount(); await flush();
    act(() => root.render(<CaptureCapacityPanel locale="zh" runtimeStatus={{ requestCount: 0, startedAt: null, port: null, starting: false, running: false }} />));
    expect(container.textContent).not.toContain('快照可能过时'); expect(container.textContent).toContain('原文文件配额');
    act(() => root.render(<CaptureCapacityPanel locale="en" runtimeStatus={{ ...status, requestCount: 1 }} />));
    expect(container.textContent).toContain('snapshot may be stale'); await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => button(container).click()); expect(fetcher).toHaveBeenCalledTimes(4); expect(container.textContent).not.toContain('snapshot may be stale');
  });
  it('does not let nominal file capacity hide a recent native SQLite-full capture failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(isCapacity(url) ? capacity : storage)));
    const runtime: ProxyRuntimeStatus = { ...status, diagnostics: { phase: 'idle', runId: null, cleanupPending: false, listening: false,
      observedRequests: 1, activeRequests: 0, pendingWrites: 0, persistedRequests: 0, interruptedRequests: 0, captureErrors: 1, lastRequestAt: capacity.checkedAt, lastError: 'CAPTURE_METADATA_SQLITE_FULL' } };
    const { container } = mount(runtime); await flush(); expect(container.textContent).toContain('below admission');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Normal file watermarks do not prove physical space is sufficient');
    expect(container.textContent).toContain('Recent capture error (not a current capacity verdict)');
  });
});
