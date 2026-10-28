import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTimeNavigator } from './TaskTimeNavigator.js';
import type { TaskRecord, TaskTimeline } from '../../core/task-types.js';
import { makeEvent, makeMessage } from '../trajectory/investigation-test-fixtures.js';
let host: HTMLDivElement, root: Root;
const start = Date.UTC(2026, 9, 26), at = (ms: number) => new Date(start + ms).toISOString();
const record: TaskRecord = { id: 's:event:record', memberId: 'a', memberName: 'Agent', sessionKey: 's', event: { ...makeEvent(makeMessage('record', 1, { kind: 'tool', tool: 'Read', title: 'Exact record' })), startedAt: at(5000), durationMs: 1000 }, importedTurn: null };
const timeline: TaskTimeline = { taskId: 'collected:s', member: 'main', window: 'fixed', from: at(0), to: at(20000), bins: 160, total: 5000, untimed: 0, coverage: { loadedMembers: 1, totalMembers: 1 }, lanes: [{ memberId: 'a', name: 'Agent', total: 5000, bins: [{ index: 40, input: 0, model: 0, tool: 5000, other: 0, errors: 0 }] }] };
const earlier = { ...record, id: 'earlier', event: { ...record.event!, startedAt: at(0), durationMs: 0 } };
const latest = { ...record, id: 'latest', event: { ...record.event!, startedAt: at(20000), durationMs: 0 } };
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 100, width: 1000, height: 100, toJSON() {} });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const pointer = (node: Element, type: string, x: number, button = 0) => { const event = new MouseEvent(type, { bubbles: true, clientX: x, button }); Object.defineProperty(event, 'pointerId', { value: 1 }); node.dispatchEvent(event); };
const render = (records = [record], onSelect = vi.fn(), onRangeChange = vi.fn()) => {
  act(() => root.render(<TaskTimeNavigator timeline={timeline} loading={false} error={null} onRetry={() => {}} records={records} selected={null} range={null} onRangeChange={onRangeChange} onSelect={onSelect} locale="en" />));
  return { onSelect, onRangeChange };
};
const track = () => host.querySelector<SVGSVGElement>('.task-timeline-track')!;
const duration = () => host.querySelector<HTMLButtonElement>('.task-timeline-duration')!;
describe('compact DSH-style exact record navigation', () => {
  it('defaults to equal-width loaded records, without invented blocks for aggregated history', () => {
    render([earlier, record, latest]);
    expect(duration().getAttribute('aria-pressed')).toBe('false');
    const marks = [...host.querySelectorAll('[data-record-id]')];
    expect(marks).toHaveLength(3);
    expect(new Set(marks.map(mark => mark.getAttribute('width'))).size).toBe(1);
    expect(host.querySelector('.task-timeline-page')?.textContent).toBe('Page 3 records');
    expect(host.querySelector('.task-timeline-page')?.getAttribute('title')).toContain('5,000');
    expect(host.querySelector('.process-time-overview')).toBeNull();
    expect(host.textContent).not.toContain('Member lanes');
  });
  it('reads input, model and tool records as one colored row with text type hints', () => {
    const input = { ...earlier, event: { ...earlier.event!, kind: 'user_prompt' as const, title: 'User input' } };
    const model = { ...latest, event: { ...latest.event!, kind: 'llm' as const, title: 'Model output' } };
    render([input, model, record]);
    const marks = [...host.querySelectorAll('.task-timeline-mark')];
    expect(new Set(marks.map(mark => mark.getAttribute('y'))).size).toBe(1);
    expect(marks.map(mark => ['input', 'model', 'tool'].find(kind => mark.classList.contains(kind)))).toEqual(['input', 'model', 'tool']);
    expect(host.querySelector('.task-timeline-labels')).toBeNull();
    expect(host.querySelector('.task-timeline-legend')?.textContent).toBe('InputModelTools');
    expect(marks[0]?.getAttribute('aria-label')).toContain('Input');
    expect(marks[1]?.getAttribute('aria-label')).toContain('Model');
    expect(marks[2]?.getAttribute('aria-label')).toContain('Tools');
  });
  it('keeps every overlapping duration record selectable by exact identity in the single row', () => {
    const input = { ...record, id: 'input', event: { ...record.event!, kind: 'user_prompt' as const, title: 'User input' } };
    const model = { ...record, id: 'model', event: { ...record.event!, kind: 'llm' as const, title: 'Model output' } };
    const { onSelect } = render([input, model, record]);
    act(() => duration().click());
    const open = () => act(() => { const mark = host.querySelector('[data-record-id="s:event:record"]')!; pointer(mark, 'pointerdown', 2); pointer(mark, 'pointerup', 2); mark.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); });
    open();
    expect(onSelect).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Overlapping records here');
    expect([...host.querySelectorAll('[data-record-choice]')].map(button => button.getAttribute('data-record-choice'))).toEqual(['input', 'model', record.id]);
    act(() => host.querySelector<HTMLButtonElement>('[data-record-choice="model"]')!.click());
    expect(onSelect).toHaveBeenLastCalledWith(model);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    open(); act(() => host.querySelector<HTMLButtonElement>('[data-record-choice="input"]')!.click());
    expect(onSelect).toHaveBeenLastCalledWith(input);
    open(); act(() => host.querySelector<HTMLButtonElement>('[data-record-choice="s:event:record"]')!.click());
    expect(onSelect).toHaveBeenLastCalledWith(record);
    act(() => host.querySelector('[data-record-id="model"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith(model);
    expect(onSelect).toHaveBeenCalledTimes(4);
  });
  it('selects an exact loaded block once for pointer and accessible clicks', () => {
    const { onSelect, onRangeChange } = render();
    const mark = host.querySelector('[data-record-id]')!;
    act(() => { pointer(mark, 'pointerdown', 260); pointer(mark, 'pointerup', 260); mark.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(record); expect(onRangeChange).not.toHaveBeenCalled();
    onSelect.mockClear();
    act(() => mark.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(record);
  });
  it('keeps missing timestamps navigable in record order and discloses them in duration mode', () => {
    const untimed = { ...record, id: 'untimed', event: { ...record.event!, startedAt: '' } };
    render([untimed]);
    expect(host.querySelector('[data-record-id="untimed"]')).not.toBeNull();
    expect(host.querySelector('.task-timeline-page')?.textContent).toContain('1 without timestamps');
    act(() => duration().click());
    expect(host.querySelector('[data-record-id]')).toBeNull();
    expect(host.textContent).toContain('Turn Duration off');
  });
  it('uses inclusive retained timestamps only when duration mode commits a brush', () => {
    const { onRangeChange } = render([earlier, record, latest]);
    act(() => duration().click());
    act(() => { pointer(track(), 'pointerdown', 200); pointer(track(), 'pointermove', 400); pointer(track(), 'pointerup', 400); });
    expect(onRangeChange).toHaveBeenCalledExactlyOnceWith([start + 4000, start + 8000]);
  });
  it('zooms the local sequence without issuing a fabricated backend time filter', () => {
    const { onRangeChange, onSelect } = render([earlier, record, latest]);
    act(() => { pointer(track(), 'pointerdown', 200); pointer(track(), 'pointermove', 600); pointer(track(), 'pointerup', 600); });
    expect(Number(track().getAttribute('data-domain-end')) - Number(track().getAttribute('data-domain-start'))).toBeLessThan(3);
    expect(onRangeChange).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
  });
  it('accepts an accessible click immediately after a whitespace brush', () => {
    const records = [earlier, record, latest], { onSelect } = render(records);
    act(() => { pointer(track(), 'pointerdown', 200); pointer(track(), 'pointermove', 600); pointer(track(), 'pointerup', 600); });
    const mark = host.querySelector('[data-record-id]')!;
    const target = records.find(item => item.id === mark.getAttribute('data-record-id'))!;
    act(() => mark.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(target);
  });
  it('cancels gestures without selecting a record or filtering data; reset and keyboard navigation remain independent', () => {
    const page = Array.from({ length: 12 }, (_, index) => index === 0 ? earlier : { ...record, id: `record:${index}` });
    const { onRangeChange, onSelect } = render(page);
    act(() => { pointer(track(), 'pointerdown', 100); pointer(track(), 'pointermove', 400); pointer(track(), 'pointercancel', 400); });
    expect(onRangeChange).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
    act(() => track().dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })));
    expect(Number(track().getAttribute('data-domain-end')) - Number(track().getAttribute('data-domain-start'))).toBe(6);
    act(() => track().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(track().getAttribute('data-domain-start')).toBe('0'); expect(track().getAttribute('data-domain-end')).toBe('12');
    act(() => track().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(earlier);
  });
  it('reveals exact member, record preview and original timestamp on keyboard focus', () => {
    vi.useFakeTimers(); render();
    const mark = host.querySelector('[data-record-id]')!;
    act(() => mark.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    act(() => vi.advanceTimersByTime(250));
    const tooltip = host.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain('Agent'); expect(tooltip?.textContent).toContain('Exact record');
    expect(tooltip?.textContent).toContain(new Date(start + 5000).toLocaleString('en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }));
  });
  it('keeps point markers at the final timestamp fully inside the hit-test boundary', () => {
    render([earlier, latest]); act(() => duration().click());
    const mark = host.querySelector('[data-record-id="latest"]')!;
    expect(mark.getAttribute('data-point')).toBe('true');
    expect(Number(mark.getAttribute('x')) + Number(mark.getAttribute('width'))).toBeLessThanOrEqual(1000);
    expect(Number(mark.getAttribute('width'))).toBeGreaterThanOrEqual(5);
  });
  it('supports independently owned parent toolbar actions without fetching bodies on projection changes', () => {
    const onRetry = vi.fn(), action = vi.fn(), onSelect = vi.fn();
    act(() => root.render(<TaskTimeNavigator timeline={timeline} loading={false} error="Timeline unavailable" onRetry={onRetry} records={[record]} selected={record.id} range={null} onRangeChange={() => {}} onSelect={onSelect} locale="en" toolbar={<button onClick={action}>Earlier records</button>} />));
    act(() => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Earlier records')!.click(); duration().click(); });
    expect(action).toHaveBeenCalledOnce(); expect(onSelect).not.toHaveBeenCalled(); expect(onRetry).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('.task-timeline-error')!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-record-id]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
