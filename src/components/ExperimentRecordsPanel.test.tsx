import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExperimentRecordsPanel } from './ExperimentRecordsPanel.js';
import type { ExperimentRecord, ExperimentSnapshot } from '../api/experiment-records.js';
import type { SessionIndexEntry } from '../core/trace-types.js';
const roots: Root[] = [];
const record = (): ExperimentRecord => ({ id: '00000000-0000-4000-8000-000000000001', name: 'Manual trial', task: null, inputVersion: 'v1', modelParameters: null, toolSet: null, mode: 'controlled', runs: [{ sessionKey: 'scan-a', label: 'pass', note: 'User evaluated' }, { sessionKey: 'scan-b', label: 'unrated', note: null }], createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' });
const snapshot = (records = [record()], revision = 1): ExperimentSnapshot => ({ version: 1, revision, records });
const response = (value: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) }) as Response;
const session = (id: string): SessionIndexEntry => ({ id, title: id, provider: 'codex', sourceAgent: 'Codex', startedAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', status: 'success', cwd: null, eventCount: 0, messageCount: 0, tokenTotal: 0, costUsd: 0, dataSource: 'scan', sourcePath: 'synthetic', detailLoaded: false, mergeGroupId: null, hasSystemPrompt: false, tags: [] });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function render(sessions = [session('scan-a'), session('scan-b')], locale: 'zh' | 'en' = 'en') {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  const props = { sessions, locale, onClose: vi.fn(), onCompare: vi.fn() };
  act(() => root.render(<ExperimentRecordsPanel {...props} />)); return { container, root, props };
}
async function click(c: Element, label: string, exact = true) {
  const button = [...c.querySelectorAll<HTMLButtonElement>('button')].find(b => exact ? b.textContent === label : b.textContent?.includes(label));
  expect(button, label).toBeDefined(); await act(async () => button!.click()); await flush();
}
async function setValue(c: Element, label: string, value: string) {
  const el = c.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`)!; expect(el).not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
describe('manual experiment panel', () => {
  it('creates only after explicit review and confirmation and never fetches session bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(snapshot([], 0))).mockResolvedValueOnce(response(snapshot())); vi.stubGlobal('fetch', fetchMock);
    const f = render(); await flush(); expect(f.container.textContent).toContain('No manual experiment records yet.'); await click(f.container, 'New record');
    await setValue(f.container, 'Experiment name', 'Trial A'); await setValue(f.container, 'Model and parameters declaration', 'model manual; temperature unknown');
    await click(f.container, 'Link run: scan-a'); await setValue(f.container, 'Manual result label 1', 'mixed');
    await click(f.container, 'Review save'); expect(fetchMock).toHaveBeenCalledTimes(1); await click(f.container, 'Cancel'); expect(fetchMock).toHaveBeenCalledTimes(1);
    await click(f.container, 'Review save'); await click(f.container, 'Confirm local change');
    expect(fetchMock).toHaveBeenCalledTimes(2); const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/experiment-records'); expect(init.method).toBe('POST'); expect(JSON.parse(init.body)).toMatchObject({ confirmed: true, expectedRevision: 0, record: { name: 'Trial A', modelParameters: 'model manual; temperature unknown', runs: [{ sessionKey: 'scan-a', label: 'mixed', note: null }] } });
    expect(f.container.textContent).toContain('Local change confirmed.');
  });
  it('uses the exact loaded pair for the parent comparison without an extra read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(snapshot())); vi.stubGlobal('fetch', fetchMock); const f = render(); await flush(); await click(f.container, 'Manual trial', false);
    await act(async () => { f.container.querySelector<HTMLInputElement>('[aria-label="Compare selected runs: scan-a"]')!.click(); f.container.querySelector<HTMLInputElement>('[aria-label="Compare selected runs: scan-b"]')!.click(); });
    await click(f.container, 'Compare selected runs'); expect(f.props.onCompare).toHaveBeenCalledExactlyOnceWith('scan-a', 'scan-b'); expect(fetchMock).toHaveBeenCalledTimes(1); expect(f.props.onClose).toHaveBeenCalledOnce();
  });
  it('retains an unavailable reference and manual result without enabling compare', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(snapshot()))); const f = render([session('scan-a')]); await flush(); await click(f.container, 'Manual trial', false);
    expect(f.container.textContent).toContain('scan-b'); expect(f.container.textContent).toContain('Unavailable in loaded index'); expect(f.container.querySelector<HTMLInputElement>('[aria-label="Compare selected runs: scan-b"]')!.disabled).toBe(true);
    expect(f.container.querySelector<HTMLSelectElement>('[aria-label="Manual result label 1"]')!.value).toBe('pass');
  });
  it('preserves dirty fields on close cancellation and escapes manual text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(snapshot()))); const f = render(); await flush(); await click(f.container, 'Manual trial', false);
    await setValue(f.container, 'Experiment name', '<img src=x>'); await click(f.container, 'Close panel'); expect(f.props.onClose).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain('Discard unsaved changes?'); await click(f.container, 'Cancel'); expect(f.container.querySelector<HTMLInputElement>('[aria-label="Experiment name"]')!.value).toBe('<img src=x>'); expect(f.container.querySelector('img')).toBeNull();
    await click(f.container, 'Close panel'); await click(f.container, 'Discard and continue'); expect(f.props.onClose).toHaveBeenCalledOnce();
  });
  it('requires confirmation before delete and sends the reviewed revision', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response(snapshot([], 2))); vi.stubGlobal('fetch', fetchMock);
    const f = render(); await flush(); await click(f.container, 'Manual trial', false); await click(f.container, 'Review deletion'); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).toContain('Original sessions and logs remain.'); await click(f.container, 'Confirm local change');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/experiment-records/' + record().id); expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE'); expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ confirmed: true, expectedRevision: 1 });
  });
  it('keeps draft revision on conflict and failed refresh, requiring explicit reselection after successful refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({ error: { code: 'BAD_REQUEST', details: { reason: 'CONFLICT' } } }, 409)).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response(snapshot([{ ...record(), name: 'Other edit' }], 2)));
    vi.stubGlobal('fetch', fetchMock); const f = render(); await flush(); await click(f.container, 'Manual trial', false); await setValue(f.container, 'Experiment name', 'My draft'); await click(f.container, 'Review save'); await click(f.container, 'Confirm local change');
    expect(f.container.textContent).toContain('Local write outcome is uncertain'); await click(f.container, 'Refresh local records'); expect(f.container.textContent).toContain('Local write outcome is uncertain');
    await click(f.container, 'Refresh local records'); expect(f.container.textContent).toContain('reviewed revision differs'); expect(f.container.querySelector<HTMLInputElement>('[aria-label="Experiment name"]')!.value).toBe('My draft');
    const save = [...f.container.querySelectorAll('button')].find(b => b.textContent === 'Review save')!; expect(save.disabled).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(4);
    await click(f.container, 'Other edit', false); await click(f.container, 'Discard and continue'); expect(f.container.querySelector<HTMLInputElement>('[aria-label="Experiment name"]')!.value).toBe('Other edit');
  });
  it('has bounded read timeout, late suppression and explicit retry', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; })).mockResolvedValueOnce(response(snapshot())); vi.stubGlobal('fetch', fetchMock);
    const f = render(); await act(async () => vi.advanceTimersByTime(5000)); expect(f.container.textContent).toContain('wait timed out');
    await act(async () => resolve(response(snapshot([{ ...record(), name: 'Stale value' }])))); expect(f.container.textContent).not.toContain('Stale value');
    await click(f.container, 'Retry local read'); expect(fetchMock).toHaveBeenCalledTimes(2); expect(f.container.textContent).toContain('Manual trial');
  });
  it('times out a write without retrying and suppresses a late success', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(response(snapshot())).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal('fetch', fetchMock);
    const f = render(); await flush(); await click(f.container, 'Manual trial', false); await setValue(f.container, 'Experiment name', 'Pending edit'); await click(f.container, 'Review save'); await click(f.container, 'Confirm local change');
    await act(async () => vi.advanceTimersByTime(10000)); expect(f.container.textContent).toContain('Local write outcome is uncertain');
    await act(async () => resolve(response(snapshot([{ ...record(), name: 'Pending edit' }], 2)))); expect(f.container.textContent).not.toContain('Local change confirmed.'); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(f.container.querySelector<HTMLInputElement>('[aria-label="Experiment name"]')!.value).toBe('Pending edit');
  });
  it('switches language without refetch and aborts an owned request on unmount', async () => {
    let signal: AbortSignal | undefined; const fetchMock = vi.fn((_url: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(() => {}); }); vi.stubGlobal('fetch', fetchMock);
    const f = render(); act(() => f.root.render(<ExperimentRecordsPanel {...f.props} locale="zh" />)); expect(f.container.textContent).toContain('手工实验记录'); expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => f.root.render(<div />)); expect(signal?.aborted).toBe(true);
  });
  it('supports Escape cancellation with safe focus and returns focus after unmount', async () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(snapshot()))); const f = render(); await flush();
    await click(f.container, 'Manual trial', false); await click(f.container, 'Review deletion');
    expect(document.activeElement?.textContent).not.toBe('Confirm local change');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(f.container.textContent).not.toContain('Delete only this manual record.'); expect(f.props.onClose).not.toHaveBeenCalled();
    act(() => f.root.render(<div />)); expect(document.activeElement).toBe(opener);
  });
  it('downloads only the loaded manual snapshot on an explicit click', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(snapshot())); vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:manual-records'), revokeObjectURL = vi.fn();
    const URLClass = URL; vi.stubGlobal('URL', class extends URLClass { static override createObjectURL = createObjectURL; static override revokeObjectURL = revokeObjectURL; });
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const f = render(); await flush(); expect(createObjectURL).not.toHaveBeenCalled(); await click(f.container, 'Download manual JSON');
    expect(createObjectURL).toHaveBeenCalledOnce(); expect(createObjectURL.mock.calls[0]).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(1); expect(clickDownload).toHaveBeenCalledOnce();
    clickDownload.mockRestore();
  });

});
