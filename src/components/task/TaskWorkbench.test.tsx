import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskContext, TaskRecord, TaskRecordPage } from '../../core/task-types.js';
import { makeEvent, makeMessage } from '../trajectory/investigation-test-fixtures.js';
import { DEFAULT_TASK_ROUTE, type TaskRoute } from '../../task-route.js';
import { TaskWorkbench, type TaskChanges } from './TaskWorkbench.js';
import { DEFAULT_ARCHITECTURE_THRESHOLDS } from '../../core/architecture-diagnosis-analysis.js';

const task: TaskContext['task'] = { id: 'collected:main', origin: 'collected', provenanceKnown: true, rootSessionKey: 'main', runId: 'run', title: 'Investigate a task', provider: 'codex', startedAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', recordedStatus: 'unknown', memberCount: 2, eventCount: 2, loadedMemberCount: 2 };
const context: TaskContext = { task, members: [{ id: 'root-agent', name: 'Main', role: 'main', sessionKey: 'main', parentId: null, detailLoaded: true, eventCount: 1 }, { id: 'child-agent', name: 'Researcher', role: 'subagent', sessionKey: 'child', parentId: 'root-agent', detailLoaded: true, eventCount: 1 }], importSession: null, warnings: [] };
const main: TaskRecord = { id: 'main:event:one', memberId: 'root-agent', memberName: 'Main', sessionKey: 'main', event: { ...makeEvent(makeMessage('one', 1, { kind: 'llm', tool: null, title: 'Main result' })), sessionId: 'main' }, importedTurn: null };
const child: TaskRecord = { id: 'child:event:two', memberId: 'child-agent', memberName: 'Researcher', sessionKey: 'child', event: { ...makeEvent(makeMessage('two', 1, { title: 'Child failure', status: 'error', error: 'Recorded tool failure' })), sessionId: 'child' }, importedTurn: null };
let host: HTMLDivElement, root: Root, calls: string[];
const page = (items: TaskRecord[]): TaskRecordPage => ({ context, items, total: items.length, offset: 0, limit: 200, hasMore: false, hasPrevious: false, window: 'fixed', warnings: [] });
const json = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) }) as Response;
async function settle() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
function button(text: string) { const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]; const value = buttons.find(node => node.textContent?.includes(text)) ?? buttons.find(node => node.getAttribute('aria-label')?.includes(text)); if (!value) throw new Error('Missing button: ' + text); return value; }
function evidenceTab(name: string) { const value = [...host.querySelectorAll<HTMLButtonElement>('.task-evidence [role=tab]')].find(node => node.textContent === name); if (!value) throw new Error('Missing evidence tab: ' + name); return value; }
function mark(id: string) { const value = [...host.querySelectorAll<SVGRectElement>('.task-timeline-track [data-record-id]')].find(node => node.getAttribute('data-record-id') === id); if (!value) throw new Error('Missing diagram record: ' + id); return value; }
function metadataReads() { return calls.filter(path => path.includes('/records?') || path.includes('/timeline?')); }
async function readyTimeline() { await vi.waitFor(async () => { await settle(); expect(host.querySelector('.task-timeline-track')).not.toBeNull(); }, { timeout: 2000, interval: 10 }); }
async function readyEvidence(text?: string) { await vi.waitFor(async () => { await settle(); const panel = host.querySelector('.task-evidence [role=tabpanel]'); expect(panel).not.toBeNull(); if (text) expect(panel?.textContent).toContain(text); }, { timeout: 2000, interval: 10 }); }
function mount(changes: TaskChanges = { version: 0, keys: [], runIds: [] }) {
  function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }); return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={changes} onIntake={() => {}} onOpenRequest={() => {}} />; }
  act(() => root.render(<Harness />));
}
function playbackFixture() {
  const noise: TaskRecord = { ...main, id: 'main:event:noise', event: { ...main.event!, id: 'noise', sequence: 2, kind: 'llm', title: 'system', hasInput: false, hasOutput: false } };
  const after: TaskRecord = { ...main, id: 'main:event:after', event: { ...main.event!, id: 'after', sequence: 3, title: 'Result after technical record' } };
  const original = fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes('/records?')) { calls.push(path); return Promise.resolve(json(page([main, noise, after]))); }
    if (path.includes('/events/noise')) { calls.push(path); return Promise.resolve(json({ ...noise.event, inputSummary: null, outputSummary: null })); }
    if (path.includes('/events/after')) { calls.push(path); return Promise.resolve(json({ ...after.event, inputSummary: null, outputSummary: 'AFTER_OUTPUT' })); }
    return original(input, init);
  }));
  return { noise, after };
}
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); calls = [];
  const height = (node: HTMLElement) => node.classList.contains('task-context-header') ? 40 : node.classList.contains('task-time-sticky') ? 80 : node.classList.contains('process-stream-row') ? node.classList.contains('process-round') ? 24 : 34 : 600;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) { const canvas = this.querySelector<HTMLElement>('.process-ledger-canvas'); return Math.max(600, 200 + Number.parseFloat(canvas?.style.height ?? '0')); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { const scroller = this.closest<HTMLElement>('.task-process'), top = this.classList.contains('task-time-sticky') ? 76 : this.classList.contains('process-ledger') || this.classList.contains('task-record-scroll') ? 156 - (scroller?.scrollTop ?? 0) : 0, size = height(this); return { x: 0, y: top, width: 1000, height: size, top, left: 0, bottom: top + size, right: 1000, toJSON() {} }; });
  HTMLElement.prototype.scrollTo = function(options) { if (typeof options === 'object') { this.scrollTop = Math.max(0, Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight)); queueMicrotask(() => this.dispatchEvent(new Event('scroll'))); } };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input); calls.push(path);
    if (path.includes('/records?')) { const member = new URL(path, 'http://localhost').searchParams.get('member'); return json(page(member === 'child-agent' ? [child] : member === 'all' ? [main, child] : [main])); }
    if (path.includes('/timeline?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ taskId: task.id, member: query.get('member'), window: query.get('window'), from: task.startedAt, to: task.updatedAt, bins: 160, total: 2, untimed: 0, lanes: [], coverage: { loadedMembers: 2, totalMembers: 2 } }); }
    if (path === '/api/tasks/collected%3Amain') return json(context);
    if (path.startsWith('/api/tasks?')) return json({ items: [task], total: 1, offset: 0, limit: 50, hasMore: false });
    const raw = new URL(path, 'http://localhost').searchParams.get('include') === 'raw';
    if (path.includes('/events/one')) return json({ ...main.event, inputSummary: 'MAIN_INPUT', outputSummary: 'MAIN_OUTPUT', ...(raw ? { raw: '{"original":true}' } : {}) });
    if (path.includes('/events/two')) return json({ ...child.event, inputSummary: 'CHILD_INPUT', outputSummary: 'CHILD_OUTPUT', ...(raw ? { raw: '{"child":true}' } : {}) });
    throw new Error('Unexpected read: ' + path);
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('task process reading', () => {
  it('uses one task/member context and reads only selected evidence; mode changes preserve selection', async () => {
    mount(); await readyTimeline(); expect(host.textContent).toContain('Investigate a task');
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    expect(calls.filter(path => path.includes('/records?'))).toHaveLength(1);
    act(() => { const tab = [...host.querySelectorAll<HTMLButtonElement>('.task-evidence [role=tab]')].find(node => node.textContent === 'Input')!; tab.click(); }); await settle();
    expect(host.textContent).toContain('MAIN_INPUT'); expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    act(() => { const tab = [...host.querySelectorAll<HTMLButtonElement>('.task-evidence [role=tab]')].find(node => node.textContent === 'Output')!; tab.click(); }); await settle();
    expect(host.textContent).toContain('MAIN_OUTPUT'); expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    act(() => { const tab = [...host.querySelectorAll<HTMLButtonElement>('.task-mode-tabs button')].find(node => node.textContent === 'Conversation')!; tab.click(); }); await settle();
    expect(host.querySelector('.task-evidence')?.textContent).toContain('Main result');
    expect(calls.filter(path => path.includes('/records?'))).toHaveLength(1);
  });
  it('shares exact diagram/list selection without reloading the metadata window or another member body', async () => {
    mount(); await readyTimeline();
    const initialReads = metadataReads();
    expect(initialReads).toHaveLength(2);
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    expect(host.querySelector('.task-evidence')).toBeNull();
    act(() => mark(main.id).dispatchEvent(new MouseEvent('click', { bubbles: true }))); await readyEvidence('MAIN_OUTPUT');
    expect(host.querySelector('.task-evidence')?.textContent).toContain('MAIN_OUTPUT');
    expect(host.querySelector<HTMLButtonElement>(`.process-record-button[data-record-id="${main.id}"]`)?.getAttribute('aria-current')).toBe('true');
    expect(mark(main.id).getAttribute('aria-pressed')).toBe('true');
    expect(metadataReads()).toEqual(initialReads);
    expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    expect(calls.some(path => path.includes('/events/two'))).toBe(false);
    act(() => host.querySelector<HTMLButtonElement>(`.process-record-button[data-record-id="${main.id}"]`)!.click()); await settle();
    act(() => host.querySelector<HTMLButtonElement>('.process-round-line .process-disclosure')!.click()); await settle();
    expect(host.querySelector(`.process-record-button[data-record-id="${main.id}"]`)).toBeNull();
    act(() => mark(main.id).dispatchEvent(new MouseEvent('click', { bubbles: true }))); await readyEvidence('MAIN_OUTPUT');
    expect(host.querySelector(`.process-record-button[data-record-id="${main.id}"]`)).not.toBeNull();
    expect(metadataReads()).toEqual(initialReads);
    expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    expect(host.querySelector('.task-evidence')?.textContent).toContain('MAIN_OUTPUT');
  });
  it('opens useful output on explicit selection and reads original raw only after its own tab is chosen', async () => {
    mount(); await readyTimeline();
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    expect(host.querySelector('.task-evidence [role=tabpanel]')?.textContent).toContain('MAIN_OUTPUT');
    expect(calls.filter(path => path.includes('/events/one'))).toEqual(['/api/sessions/main/events/one']);
    expect(host.querySelector('.task-evidence')?.textContent).not.toContain('"original":true');
    act(() => evidenceTab('Input').click()); await settle();
    act(() => evidenceTab('Output').click()); await settle();
    expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    act(() => evidenceTab('Original').click()); await settle();
    expect(calls.filter(path => path.includes('/events/one'))).toEqual(['/api/sessions/main/events/one', '/api/sessions/main/events/one?include=raw']);
    expect(host.querySelector('.task-evidence')?.textContent).toContain('"original":true');
    expect(calls.some(path => path.includes('/events/two'))).toBe(false);
  });
  it('reads whole-task member metadata without fetching member bodies until their exact record is selected', async () => {
    mount(); await readyTimeline();
    expect(calls.filter(path => path.includes('/records?')).map(path => new URL(path, 'http://localhost').searchParams.get('member'))).toEqual(['main']);
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    act(()=>host.querySelector<HTMLButtonElement>('[role=combobox][aria-label=Scope]')!.click());
    act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(b=>b.textContent?.startsWith('All members'))!.click()); await readyTimeline();
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    expect(mark(main.id)).toBeTruthy(); expect(mark(child.id)).toBeTruthy();
    const before = metadataReads();
    act(() => mark(main.id).dispatchEvent(new MouseEvent('click', { bubbles: true }))); await readyEvidence('MAIN_OUTPUT');
    expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    expect(calls.some(path => path.includes('/events/two'))).toBe(false);
    act(() => mark(child.id).dispatchEvent(new MouseEvent('click', { bubbles: true }))); await readyEvidence('CHILD_OUTPUT');
    expect(host.querySelector('.task-evidence')?.textContent).toContain('CHILD_OUTPUT');
    expect(host.querySelector('.task-evidence')?.textContent).not.toContain('MAIN_OUTPUT');
    expect(calls.filter(path => path.includes('/events/two'))).toHaveLength(1);
    expect(metadataReads()).toEqual(before);
  });
  it('toggles system-record presentation without fetching metadata or bodies and retains the selected original', async () => {
    const system: TaskRecord = { ...main, id: 'main:event:noise', event: { ...main.event!, id: 'noise', sequence: 2, kind: 'system', title: 'item_completed', hasInput: false, hasOutput: false } };
    const original = fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/records?')) { calls.push(path); return Promise.resolve(json(page([main, system]))); }
      if (path.includes('/events/noise')) { calls.push(path); return Promise.resolve(json({ ...system.event, inputSummary: null, outputSummary: null })); }
      return original(input, init);
    }));
    mount(); await readyTimeline();
    const toggle = host.querySelector<HTMLInputElement>('.task-system-filter input')!;
    expect(toggle.checked).toBe(false);
    expect(host.querySelector(`.process-record-button[data-record-id="${system.id}"]`)).toBeNull();
    expect(host.querySelector(`.task-timeline-mark[data-record-id="${system.id}"]`)).toBeNull();
    const initial = [...calls], initialMetadata = metadataReads();
    act(() => toggle.click()); await settle();
    expect(toggle.checked).toBe(true);
    expect(host.querySelector(`.process-record-button[data-record-id="${system.id}"]`)).not.toBeNull();
    expect(mark(system.id)).toBeTruthy();
    expect(calls).toEqual(initial);
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    act(() => mark(system.id).dispatchEvent(new MouseEvent('click', { bubbles: true }))); await readyEvidence();
    expect(calls.filter(path => path.includes('/events/noise'))).toHaveLength(1);
    const afterSelection = [...calls];
    act(() => toggle.click()); await settle();
    expect(toggle.checked).toBe(false);
    expect(host.querySelector<HTMLButtonElement>(`.process-record-button[data-record-id="${system.id}"]`)?.getAttribute('aria-current')).toBe('true');
    expect(mark(system.id).getAttribute('aria-pressed')).toBe('true');
    expect(calls).toEqual(afterSelection); expect(metadataReads()).toEqual(initialMetadata);
  });
  it('advances to the next visible trajectory record without selecting or reading hidden bookkeeping', async () => {
    const { noise, after } = playbackFixture();
    mount(); await readyTimeline();
    expect(host.querySelector(`.task-timeline-mark[data-record-id="${noise.id}"]`)).toBeNull();
    act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    const initialMetadata = metadataReads();
    act(() => button('Next step').click()); await readyEvidence('AFTER_OUTPUT');
    expect(mark(after.id).getAttribute('aria-pressed')).toBe('true');
    expect(calls.some(path => path.includes('/events/noise'))).toBe(false);
    expect(metadataReads()).toEqual(initialMetadata);
    expect(host.querySelector(`.process-record-button[data-record-id="${noise.id}"]`)).toBeNull();
  });
  it('replays only visible trajectory records while the system-record switch is off', async () => {
    const { noise, after } = playbackFixture();
    mount(); await readyTimeline(); act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.useFakeTimers();
    act(() => button('Step replay').click());
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); }); await settle();
    expect(mark(after.id).getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.task-evidence [role=tabpanel]')?.textContent).toContain('AFTER_OUTPUT');
    expect(calls.some(path => path.includes('/events/noise'))).toBe(false);
    expect(host.querySelector(`.task-timeline-mark[data-record-id="${noise.id}"]`)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(button('Step replay')).toBeTruthy();
  });
  it('continues after a hidden record opened by an exact shared anchor', async () => {
    const { noise, after } = playbackFixture();
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id, event: noise.id }); return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={{ version: 0, keys: [], runIds: [] }} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await readyTimeline(); await readyEvidence();
    expect(mark(noise.id).getAttribute('aria-pressed')).toBe('true');
    expect(calls.filter(path => path.includes('/events/noise'))).toHaveLength(1);
    act(() => button('Next step').click()); await readyEvidence('AFTER_OUTPUT');
    expect(mark(after.id).getAttribute('aria-pressed')).toBe('true');
    expect(calls.filter(path => path.includes('/events/noise'))).toHaveLength(1);
    expect(host.querySelector(`.task-timeline-mark[data-record-id="${noise.id}"]`)).toBeNull();
  });
  it('retains a selected original tab and body cache on ordinary hints after a journal reset', async () => {
    let notify: ((value: TaskChanges) => void) | undefined;
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }), [changes, setChanges] = useState<TaskChanges>({ version: 0, keys: [], runIds: [] }); notify = setChanges; return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={changes} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await readyTimeline();
    act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    act(() => evidenceTab('Original').click()); await readyEvidence('"original":true');
    act(() => notify!({ version: 5, keys: [], runIds: [], reset: true })); await readyEvidence('MAIN_OUTPUT');
    expect(host.querySelector('.task-evidence [aria-selected=true]')?.textContent).toBe('Summary');
    act(() => evidenceTab('Original').click()); await readyEvidence('"original":true');
    const inspector = host.querySelector('.task-evidence'), afterReset = [...calls];
    act(() => notify!({ version: 6, keys: ['main'], runIds: [] })); await settle();
    expect(host.querySelector('.task-evidence')).toBe(inspector);
    expect(host.querySelector('.task-evidence [aria-selected=true]')?.textContent).toBe('Original');
    expect(host.querySelector('.task-evidence [role=tabpanel]')?.textContent).toContain('"original":true');
    expect(calls).toEqual(afterReset);
  });
  it('loads the selected member at the server and can return to the original main record', async () => {
    mount(); await settle(); act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    act(()=>host.querySelector<HTMLButtonElement>('[role=combobox][aria-label=Scope]')!.click());
    act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(b=>b.textContent==='Researcher')!.click()); await settle();
    expect(calls.some(path => path.includes('member=child-agent'))).toBe(true);
    expect(host.querySelector('.task-record-scroll')?.textContent).toContain('Child failure');
    expect(host.querySelector('.task-evidence')).toBeNull();
    act(() => button('Return to original').click()); await readyEvidence('MAIN_OUTPUT');
    expect(host.querySelector('.task-evidence')?.textContent).toContain('Main result');
  });
  it('keeps a selected historical window while live hints arrive', async () => {
    let notify: ((value: TaskChanges) => void) | undefined;
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }), [changes, setChanges] = useState<TaskChanges>({ version: 0, keys: [], runIds: [] }); notify = setChanges; return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={changes} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await settle(); act(() => button('Main result').click()); await readyEvidence('MAIN_OUTPUT');
    const before = calls.filter(path => path.includes('/records?')).length;
    act(() => notify!({ version: 1, keys: ['main'], runIds: [] })); await settle();
    expect(host.textContent).toContain('New records are available');
    expect(calls.filter(path => path.includes('/records?'))).toHaveLength(before);
    expect(host.querySelector('.task-evidence')?.textContent).toContain('Main result');
  });
});

describe('task context restoration', () => {
  it('retires a paged window when browser navigation restores a different time filter', async () => {
    const original=fetch;let change:((route:TaskRoute)=>void)|undefined;
    vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{if(String(input).includes('/records?')){calls.push(String(input));return Promise.resolve(json({...page([main]),total:500,offset:300,hasPrevious:true}));}return original(input,init);}));
    function Harness(){const[route,setRoute]=useState<TaskRoute>({...DEFAULT_TASK_ROUTE,task:task.id});change=setRoute;return<TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={{version:0,keys:[],runIds:[]}} onIntake={()=>{}} onOpenRequest={()=>{}}/>;}
    act(()=>root.render(<Harness/>));await settle();act(()=>button('Earlier records').click());await settle();
    expect(new URL(calls.filter(path=>path.includes('/records?')).at(-1)!,'http://localhost').searchParams.get('window')).toBe('fixed');
    act(()=>change!({...DEFAULT_TASK_ROUTE,task:task.id,from:'2026-10-25T00:00:00.000Z',to:'2026-10-25T01:00:00.000Z'}));await settle();
    const final=new URL(calls.filter(path=>path.includes('/records?')).at(-1)!,'http://localhost').searchParams;
    expect(final.get('window')).toBeNull();expect(final.get('offset')).toBeNull();expect(final.get('from')).toBe('2026-10-25T00:00:00.000Z');
  });
  it('restores shared filters and clears their time window when moving to the latest records', async () => {
    let current: TaskRoute | undefined;
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id, q: 'Main', errors: true, from: '2026-10-25T00:00:00.000Z', to: '2026-10-25T01:00:00.000Z' }); current = route; return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={{ version: 0, keys: [], runIds: [] }} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await settle();
    const request = new URL(calls.find(path => path.includes('/records?'))!, 'http://localhost');
    expect(request.searchParams.get('q')).toBe('Main'); expect(request.searchParams.get('status')).toBe('error');
    expect(host.querySelector<HTMLInputElement>('.task-record-filters input[type=checkbox]')?.checked).toBe(true);
    act(() => button('Back to latest').click()); await settle();
    expect(current?.from).toBeUndefined(); expect(current?.to).toBeUndefined();
    expect(current?.q).toBe('Main'); expect(current?.errors).toBe(true);
    act(() => button('Tasks').click()); await settle(); act(() => button('Imported').click()); await settle();
    expect(current?.task).toBeNull(); expect(current?.q).toBeUndefined(); expect(current?.errors).toBeUndefined();
  });
  it('opens a legacy child session directly in its member scope instead of loading the root history', async () => {
    const original = fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/tasks/collected%3Achild' ? Promise.resolve(json(context)) : original(input, init)));
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: 'collected:child' }); return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={{ version: 0, keys: [], runIds: [] }} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await settle();
    const scopes = calls.filter(path => path.includes('/records?')).map(path => new URL(path, 'http://localhost').searchParams.get('member'));
    expect(scopes).toEqual(['child-agent']);
    expect(host.querySelector('.task-record-scroll')?.textContent).toContain('Child failure');
  });
  it('ignores a late old task response even when its transport ignores cancellation', async () => {
    const original = fetch; let finish: ((value: Response) => void) | undefined, change: ((value: TaskRoute) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/tasks/collected%3Amain') return new Promise<Response>(resolve => { finish = resolve; });
      if (path === '/api/tasks/collected%3Aother') return Promise.resolve(json({ ...context, task: { ...task, id: 'collected:other', title: 'Second task' } }));
      if (path.startsWith('/api/tasks/collected%3Aother/records?')) return Promise.resolve(json({ ...page([]), context: { ...context, task: { ...task, id: 'collected:other', title: 'Second task' } } }));
      return original(input, init);
    }));
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }); change = setRoute; return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={{ version: 0, keys: [], runIds: [] }} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await settle();
    act(() => change!({ ...DEFAULT_TASK_ROUTE, task: 'collected:other' })); await settle();
    expect(host.querySelector('.task-context-header h1')?.textContent).toBe('Second task');
    await act(async () => finish!(json(context))); await settle();
    expect(host.querySelector('.task-context-header h1')?.textContent).toBe('Second task');
  });
});

describe('real task architecture analysis', () => {
  it('analyzes only the selected scope on request and invalidates on relevant source hints or capture changes', async () => {
    const original = fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/architecture-diagnosis?')) { calls.push(path); return Promise.resolve(json({ version: 1, taskId: task.id, member: 'main', title: 'Bounded actual task analysis', origin: 'collected', revision: 'source-v1', analyzedAt: '2026-10-29T00:00:00.000Z', thresholds: DEFAULT_ARCHITECTURE_THRESHOLDS, coverage: { context: 'partial', tools: 'partial', handoffs: 'unavailable', nativeEvents: 2, nativeEventTotal: 2, captures: 0, logicalCalls: 0, omitted: 0, reasons: ['communication_unavailable'] }, categories: { context_bloat: 'insufficient', tool_conflict: 'insufficient', handoff_loss: 'insufficient' }, findings: [], evidence: [], limitations: [] })); }
      return original(input, init);
    }));
    let notify!: (value: TaskChanges) => void, invalidate!: (value: number) => void;
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }), [changes, setChanges] = useState<TaskChanges>({ version: 0, keys: [], runIds: [] }), [captureVersion, setCaptureVersion] = useState(0); notify = setChanges; invalidate = setCaptureVersion; return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={changes} diagnosisInvalidateKey={captureVersion} onIntake={() => {}} onOpenRequest={() => {}}/>; }
    act(() => root.render(<Harness/>)); await readyTimeline();
    expect(calls.some(path => path.includes('architecture-diagnosis'))).toBe(false);
    expect(host.textContent).not.toContain('Analyze split and merge');
    act(() => button('Architecture').click()); await settle();
    act(() => button('Analyze split and merge').click()); await settle(); expect(host.textContent).toContain('Bounded actual task analysis');
    expect(calls.filter(path => path.includes('architecture-diagnosis'))).toHaveLength(1);
    act(() => notify({ version: 1, keys: ['other'], runIds: [] })); await settle(); expect(host.textContent).toContain('Bounded actual task analysis');
    act(() => notify({ version: 2, keys: ['main'], runIds: [] })); await settle(); expect(host.textContent).not.toContain('Bounded actual task analysis');
    expect(calls.filter(path => path.includes('architecture-diagnosis'))).toHaveLength(1);
    act(() => button('Analyze split and merge').click()); await settle(); expect(host.textContent).toContain('Bounded actual task analysis');
    act(() => invalidate(1)); await settle(); expect(host.textContent).not.toContain('Bounded actual task analysis');
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0); expect(calls.every(path => !path.includes('/start'))).toBe(true);
  });
});

it.each([
  ['SOURCE_CHANGED', 'Local records changed', '读取期间本地记录发生变化'],
  ['UNINDEXED', 'execution trajectory to load details', '执行轨迹加载详情'],
  ['TOO_LARGE', 'Select fewer', '减少任务数量'],
  ['NO_MATCH', 'collected root tasks', '已采集根任务'],
] as const)('localizes architecture tab failure %s without raw server text', async (reason, en, zh) => {
  const original = fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/agent-folding/scope')
    ? Promise.resolve({ ok: false, status: 422, text: async () => JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'SECRET_SERVER_ENGLISH', details: { reason } } }) } as Response)
    : original(input, init)));
  for (const locale of ['en', 'zh'] as const) {
    act(() => root.render(<TaskWorkbench locale={locale} route={{ ...DEFAULT_TASK_ROUTE, task: task.id, mode: 'architecture' }} onRoute={() => {}} changes={{ version: 0, keys: [], runIds: [] }} onIntake={() => {}} onOpenRequest={() => {}} />));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(locale === 'zh' ? zh : en);
    expect(host.textContent).not.toContain('SECRET_SERVER_ENGLISH');
  }
});

it('Phase B home shares one page, A/B checks and server sorting/filtering with the sidebar',async()=>{
  function Home(){const [route,onRoute]=useState<TaskRoute>(DEFAULT_TASK_ROUTE);return <TaskWorkbench locale="en" route={route} onRoute={onRoute} changes={{version:0,keys:[],runIds:[]}} onIntake={()=>{}} onOpenRequest={()=>{}}/>;}
  act(()=>root.render(<Home/>));
  await vi.waitFor(async()=>{await settle();expect(host.querySelector('.task-health-list')).not.toBeNull();});
  expect(calls.filter(path=>path.startsWith('/api/tasks?'))).toHaveLength(1);
  expect(calls.find(path=>path.startsWith('/api/tasks?'))).toContain('summary=1');
  act(()=>host.querySelector<HTMLInputElement>('tbody input')!.click());
  expect(host.querySelector('.task-sidebar')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('tbody input')!.checked).toBe(true);
  act(()=>button('Set as Baseline').click());
  expect(host.querySelector<HTMLInputElement>('tbody input')!.checked).toBe(false);
  act(()=>host.querySelector<HTMLButtonElement>('[role=combobox][aria-label=Sort]')!.click());
  act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(b=>b.textContent==='Token')!.click());await settle();
  expect(calls.filter(path=>path.startsWith('/api/tasks?'))).toHaveLength(2);expect(calls.at(-1)).toContain('sort=tokens');
  act(()=>button('Filter').click());act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(b=>b.textContent==='With alerts')!.click());await settle();
  expect(calls.filter(path=>path.startsWith('/api/tasks?'))).toHaveLength(3);expect(calls.at(-1)).toContain('alerts=1');
  expect(calls.some(path=>path.includes('/events/')||path.includes('/health-reports'))).toBe(false);
});
it('Phase B health entry selects the same task and opens its drawer without generating a report',async()=>{
 let selected:TaskRoute|undefined;
 function Home(){const [route,onRoute]=useState<TaskRoute>(DEFAULT_TASK_ROUTE);selected=route;return <TaskWorkbench locale="en" route={route} onRoute={onRoute} changes={{version:0,keys:[],runIds:[]}} onIntake={()=>{}} onOpenRequest={()=>{}}/>;}
 act(()=>root.render(<Home/>));await vi.waitFor(async()=>{await settle();expect(host.querySelector('.task-health-list')).not.toBeNull();});
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('tbody button')].find(b=>b.getAttribute('aria-label')==='Health monitoring')!.click());
 await readyTimeline();expect(selected).toMatchObject({task:task.id,member:'all',health:'new'});expect(document.querySelector('#task-health-drawer')).not.toBeNull();
 expect(vi.mocked(fetch).mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});

it('Phase B review refreshes the shared retained page after background hydration and SSE without restarting the lease or losing checks',async()=>{
 const original=fetch;let controller!:ReadableStreamDefaultController<Uint8Array>,reads=0;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  if(path==='/api/task-home/hydrate')return new Response(new ReadableStream<Uint8Array>({start(value){controller=value;}}));
  if(path.startsWith('/api/tasks?')){reads++;return json({items:[{...task,loadedMemberCount:reads>1?2:0,metrics:reads>1?{durationMs:2000,toolCalls:8,errors:1,input:60,output:20,cacheRead:30,correctedTotal:110,promptInput:90,cacheHitRate:1/3,models:[]}:undefined}],total:1,offset:0,limit:50,hasMore:false});}
  return original(input,init);
 }));
 let notify!:(changes:TaskChanges)=>void;
 function Home(){const [route,onRoute]=useState<TaskRoute>(DEFAULT_TASK_ROUTE),[changes,setChanges]=useState<TaskChanges>({version:0,keys:[],runIds:[]});notify=setChanges;return <TaskWorkbench locale="en" route={route} onRoute={onRoute} changes={changes} onIntake={()=>{}} onOpenRequest={()=>{}}/>;}
 act(()=>root.render(<Home/>));await vi.waitFor(async()=>{await settle();expect(host.querySelector('tbody [role=status]')).not.toBeNull();});
 const scroll=host.querySelector('.ui-table-wrap');act(()=>host.querySelector<HTMLInputElement>('tbody input')!.click());
 await act(async()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({items:[{taskId:task.id,pending:0,loaded:2,reasons:[]}],done:true})+'\n'));notify({version:1,keys:['main','child'],runIds:[]});await new Promise(r=>setTimeout(r,230));});
 expect(reads).toBe(2);expect(host.querySelector('.ui-table-wrap')).toBe(scroll);expect(host.querySelector('tbody [role=status]')).toBeNull();expect(host.querySelector('tr[data-table-row]')?.textContent).toContain('110');
 expect(host.querySelector<HTMLInputElement>('tbody input')!.checked).toBe(true);expect(vi.mocked(fetch).mock.calls.filter(([path])=>String(path)==='/api/task-home/hydrate')).toHaveLength(1);
});

it('always labels all-member scope for a single-member task and gives the return action text',async()=>{
 const original=fetch;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/tasks/collected%3Amain'?json({...context,task:{...task,memberCount:1,loadedMemberCount:1},members:context.members.slice(0,1)}):original(input,init)));
 const onRoute=vi.fn();act(()=>root.render(<TaskWorkbench locale="en" route={{...DEFAULT_TASK_ROUTE,task:task.id,member:'all'}} onRoute={onRoute} changes={{version:0,keys:[],runIds:[]}} onIntake={()=>{}} onOpenRequest={()=>{}}/>));await readyTimeline();
 expect(host.querySelector('.task-member-select [role=combobox]')!.textContent).toContain('All members');expect(host.querySelector('.task-member-select [role=combobox]')!.textContent).not.toContain('Select…');const back=host.querySelector<HTMLButtonElement>('.task-return-main')!;expect(back.textContent).toBe('Return to main session');act(()=>back.click());expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({member:'main'}));
});
