import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRecord, TaskRecordPage } from '../../core/task-types.js';
import type { TraceEventSlim } from '../../core/trace-types.js';
import { makeEvent, makeMessage } from '../trajectory/investigation-test-fixtures.js';
import { ProcessLedger, type ProcessLedgerHandle } from './ProcessLedger.js';

const item = (id: string, sequence: number, overrides: Partial<TraceEventSlim> = {}): TaskRecord => ({ id: 's:event:' + id, memberId: 'main', memberName: 'Main', sessionKey: 's', importedTurn: null, event: { ...makeEvent(makeMessage(id, sequence)), turnKey: 'decision', ...overrides } });
const input = item('input', 1, { kind: 'user_prompt', title: 'Inspect the repository', tool: null });
const thinking = item('thinking', 2, { kind: 'reasoning', title: 'Plan the investigation', tool: null });
const call = item('call', 3, { kind: 'tool', title: 'Read the source', tool: 'Read', hasInput: true, hasOutput: false });
const result = item('result', 4, { kind: 'tool', title: 'Source read result', tool: 'Read', hasInput: false, hasOutput: true });
const output = item('output', 5, { kind: 'llm', title: 'Finished investigation', tool: null });
const page = (items: TaskRecord[]): TaskRecordPage => ({ context: { task: { id: 'collected:s', memberCount: 2 } as TaskRecordPage['context']['task'], members: [], importSession: null, warnings: [] }, items, total: items.length, offset: 0, limit: 200, hasMore: false, hasPrevious: false, window: 'fixed', warnings: [], structure: { leading: [], warnings: [], records: [call, result].filter(value => items.includes(value)).map(value => ({ recordId: value.id, round: null, attempt: null, tool: { namespace: 'codex', kind: 'tool_call', value: 'call-id', scope: 's' }, pairing: 'exact', relatedRecordIds: [call.id, result.id, 's:event:older'] })) } });
let host: HTMLDivElement, scrollRoot: HTMLDivElement, root: Root, ledgerOffset: number;
const select = vi.fn(), anchor = vi.fn();
const handle = createRef<ProcessLedgerHandle>();
const render = (value = page([input, thinking, call, result, output]), options: { selected?: string; roundsCollapsed?: boolean; callsCollapsed?: boolean; visibleRecordIds?: ReadonlySet<string> } = {}) => act(() => root.render(<ProcessLedger ref={handle} page={value} selected={options.selected ?? null} locale="en" onSelect={select} onAnchor={anchor} onUserScroll={() => {}} scrollElement={scrollRoot} stickyOffset={100} roundsCollapsed={options.roundsCollapsed} callsCollapsed={options.callsCollapsed} visibleRecordIds={options.visibleRecordIds} />));
const rows = () => [...host.querySelectorAll<HTMLButtonElement>('.process-record-button')];
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
beforeEach(() => {
  ledgerOffset = 160;
  scrollRoot = document.createElement('div'); scrollRoot.dataset.scrollRoot = 'true'; host = document.createElement('div'); scrollRoot.append(host); document.body.append(scrollRoot); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return this === scrollRoot ? 400 : this.classList.contains('process-stream-row') ? this.classList.contains('process-round') ? 24 : 34 : 400; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(10000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { const top = this === scrollRoot ? 0 : ledgerOffset - scrollRoot.scrollTop, height = this.offsetHeight; return { x: 0, y: top, width: 1000, height, top, left: 0, right: 1000, bottom: top + height, toJSON() {} }; });
  scrollRoot.scrollTo = ((options?: ScrollToOptions | number, y?: number) => { scrollRoot.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0; queueMicrotask(() => scrollRoot.dispatchEvent(new Event('scroll'))); }) as typeof scrollRoot.scrollTo;
  select.mockClear(); anchor.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Ledger must not fetch'))));
});
afterEach(() => { act(() => root.unmount()); scrollRoot.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('DSH-style task process ledger', () => {
  it('shows every original observation by default with compact kind/member chips and no extra group-header rows', async () => {
    render(); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input, thinking, call, result, output].map(item => item.id));
    expect(host.querySelectorAll('.process-round-line')).toHaveLength(1);
    expect(host.querySelector('.process-ledger-summary')).toBeNull();
    expect([...host.querySelectorAll('.process-kind-chip')].map(node => node.textContent)).toEqual(['User', 'Thinking', 'Tool', 'Tool', 'Assistant']);
    expect(host.querySelectorAll('.process-member-chip').length).toBeGreaterThan(4);
    expect(scrollRoot.scrollTop).toBe(0);
    act(() => rows()[3]!.click()); expect(select).toHaveBeenLastCalledWith(result);
  });
  it('expands metadata and exact off-page evidence without fetching any body', async () => {
    render(); await settle();
    const disclosure = [...host.querySelectorAll<HTMLButtonElement>('.process-disclosure')].find(node => node.getAttribute('aria-label')?.includes('Record information: Read the source'))!;
    act(() => disclosure.click()); await settle();
    expect(host.textContent).toContain('call-id');
    expect(host.textContent).toContain('Page-local step 1');
    act(() => host.querySelector<HTMLButtonElement>('.process-original-link')!.click());
    expect(anchor).toHaveBeenCalledWith('s:event:older'); expect(fetch).not.toHaveBeenCalled();
  });
  it('collapses only confirmed call groups and reveals the exact input when the diagram locates it', async () => {
    render(undefined, { callsCollapsed: true }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input, thinking, result, output].map(item => item.id));
    expect(host.textContent).toContain('2 original records');
    act(() => { expect(handle.current!.locate(call.id)).toBe(true); }); await settle();
    expect(rows().some(row => row.dataset.recordId === call.id)).toBe(true);
    expect(rows().some(row => row.dataset.recordId === result.id)).toBe(true);
    expect(scrollRoot.scrollTop).toBeGreaterThan(0);
    act(() => { expect(handle.current!.locate('s:event:missing')).toBe(false); });
  });
  it('uses the task scroll root and keeps a selected record visible below its sticky heading and diagram', async () => {
    const items = [input, ...Array.from({ length: 190 }, (_, index) => item('large-' + index, index + 2, { title: 'Original record ' + index, kind: 'llm', tool: null }))], value = page(items);
    render(value); await settle();
    expect(rows().length).toBeLessThan(30); expect(host.querySelector('.process-ledger')?.getAttribute('data-external-scroll')).toBe('true');
    const target = items[120]!;
    render(value, { selected: target.id }); await settle();
    expect(rows().some(row => row.dataset.recordId === target.id)).toBe(true);
    expect(scrollRoot.scrollTop).toBeGreaterThan(2000);
    expect(rows().find(row => row.dataset.recordId === target.id)?.getAttribute('aria-current')).toBe('true');
  });
  it('remeasures position-only layout shifts when locating the same selected record after manual scrolling', async () => {
    const items = [input, ...Array.from({ length: 150 }, (_, index) => item('shifted-' + index, index + 2, { title: 'Original record ' + index, kind: 'llm', tool: null }))], value = page(items), target = items[100]!;
    render(value, { selected: target.id }); await settle();
    const originalScroll = scrollRoot.scrollTop;
    expect(originalScroll).toBeGreaterThan(2000);
    act(() => { scrollRoot.scrollTop = 0; scrollRoot.dispatchEvent(new Event('scroll')); }); await settle();
    expect(scrollRoot.scrollTop).toBe(0);
    // An expanded member strip/warning shifts the ledger; both observed node
    // sizes stay unchanged, so no ResizeObserver notification is emitted.
    ledgerOffset += 300;
    act(() => { expect(handle.current!.locate(target.id)).toBe(true); }); await settle();
    expect(scrollRoot.scrollTop).toBeCloseTo(originalScroll + 300, 0);
    expect(rows().find(row => row.dataset.recordId === target.id)?.getAttribute('aria-current')).toBe('true');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('updates virtual offsets on a root scroll after preceding content changes without forcing selection navigation', async () => {
    const items = [input, ...Array.from({ length: 150 }, (_, index) => item('scrolled-' + index, index + 2, { kind: 'llm', tool: null }))];
    render(page(items)); await settle();
    ledgerOffset += 240;
    act(() => { scrollRoot.scrollTop = 2200; scrollRoot.dispatchEvent(new Event('scroll')); }); await settle();
    expect(scrollRoot.scrollTop).toBe(2200);
    const first = host.querySelector<HTMLElement>('.process-stream-row')!;
    const match = /^translateY\(([-\d.]+)px\)$/.exec(first.style.transform);
    expect(match).not.toBeNull();
    // Rendered row transforms are ledger-local, rather than retaining the
    // additional 240px from the obsolete external scroll margin.
    const index = Number(first.dataset.index), expected = index === 0 ? 0 : 24 + (index - 1) * 34;
    expect(Number(match![1])).toBeCloseTo(expected, 0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('hides filtered technical records and empty rounds without changing native step and tool identities', async () => {
    const carrier = item('carrier', 2, { kind: 'system', title: 'item_completed', hasInput: false, hasOutput: false });
    const other = { ...item('only-noise', 1, { kind: 'system', title: 'token_count' }), memberId: 'other', memberName: 'Only technical records' };
    const value = page([input, carrier, call, result, output, other]);
    render(value, { visibleRecordIds: new Set([input.id, call.id, result.id, output.id]) }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input.id, call.id, result.id, output.id]);
    expect(host.querySelectorAll('.process-round-line')).toHaveLength(1);
    expect(host.textContent).not.toContain('Only technical records');
    const disclosure = [...host.querySelectorAll<HTMLButtonElement>('.process-disclosure')].find(node => node.getAttribute('aria-label')?.includes('Record information: Read the source'))!;
    act(() => disclosure.click()); await settle();
    expect(host.textContent).toContain('call-id');
    expect(host.textContent).toContain('Page-local step 1');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves a hidden identity carrier for attempt grouping but chooses a visible collapsed-call representative', async () => {
    const carrier = item('attempt-carrier', 6, { kind: 'system', title: 'token_count', hasInput: false, hasOutput: true });
    const value = page([input, thinking, output, carrier]);
    value.structure!.records.push({ recordId: carrier.id, round: null, attempt: { namespace: 'codex', kind: 'response', value: 'response-id', scope: 's' }, tool: null, pairing: 'unavailable', relatedRecordIds: [] });
    render(value, { callsCollapsed: true, visibleRecordIds: new Set([input.id, thinking.id, output.id]) }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input.id, output.id]);
    expect(rows().some(row => row.dataset.recordId === carrier.id)).toBe(false);
    const disclosure = [...host.querySelectorAll<HTMLButtonElement>('.process-disclosure')].find(node => node.getAttribute('aria-label')?.includes('Record information: Finished investigation'))!;
    act(() => disclosure.click()); await settle();
    expect(host.textContent).toContain('response-id');
    expect(host.textContent).toContain('Step association');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('always reveals an explicitly selected or located original even when its entire round is filtered out', async () => {
    const hidden = { ...item('hidden', 1, { kind: 'system', title: 'Hidden technical evidence', startedAt: '2026-10-17T00:00:01.000Z' }), memberId: 'child', memberName: 'Hidden member' };
    const value = page([input, hidden]), visibleRecordIds = new Set([input.id]);
    render(value, { visibleRecordIds, selected: hidden.id }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input.id, hidden.id]);
    expect(host.querySelectorAll('.process-round-line')).toHaveLength(2);
    render({ ...value, window: 'next-window' }, { visibleRecordIds }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input.id]);
    act(() => { expect(handle.current!.locate(hidden.id)).toBe(true); }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([input.id, hidden.id]);
    expect(host.textContent).toContain('Hidden technical evidence');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps different member histories separately labelled and can reveal a record under collapsed rounds', async () => {
    const other = { ...item('child', 1, { kind: 'llm', title: 'Child analysis', tool: null }), memberId: 'child', memberName: 'Researcher', sessionKey: 'child' };
    render(page([input, thinking, other]), { roundsCollapsed: true }); await settle();
    expect(rows()).toHaveLength(0); expect(host.querySelectorAll('.process-round-line')).toHaveLength(2);
    act(() => { expect(handle.current!.locate(other.id)).toBe(true); }); await settle();
    expect(rows().map(row => row.dataset.recordId)).toEqual([other.id]);
    expect(host.textContent).toContain('Researcher');
    expect(fetch).not.toHaveBeenCalled();
  });
});
