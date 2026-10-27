import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskContext, TaskRecord, TaskRecordPage } from '../../core/task-types.js';
import { makeEvent, makeMessage } from '../trajectory/investigation-test-fixtures.js';
import { DEFAULT_TASK_ROUTE, type TaskRoute } from '../../task-route.js';
import { TaskWorkbench, type TaskChanges } from './TaskWorkbench.js';

const task: TaskContext['task'] = { id: 'collected:main', origin: 'collected', provenanceKnown: true, rootSessionKey: 'main', runId: 'run', title: 'Investigate a task', provider: 'codex', startedAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', recordedStatus: 'unknown', memberCount: 2, eventCount: 2, loadedMemberCount: 2 };
const context: TaskContext = { task, members: [{ id: 'root-agent', name: 'Main', role: 'main', sessionKey: 'main', parentId: null, detailLoaded: true, eventCount: 1 }, { id: 'child-agent', name: 'Researcher', role: 'subagent', sessionKey: 'child', parentId: 'root-agent', detailLoaded: true, eventCount: 1 }], importSession: null, warnings: [] };
const main: TaskRecord = { id: 'main:event:one', memberId: 'root-agent', memberName: 'Main', sessionKey: 'main', event: { ...makeEvent(makeMessage('one', 1, { kind: 'llm', tool: null, title: 'Main result' })), sessionId: 'main' }, importedTurn: null };
const child: TaskRecord = { id: 'child:event:two', memberId: 'child-agent', memberName: 'Researcher', sessionKey: 'child', event: { ...makeEvent(makeMessage('two', 1, { title: 'Child failure', status: 'error', error: 'Recorded tool failure' })), sessionId: 'child' }, importedTurn: null };
let host: HTMLDivElement, root: Root, calls: string[];
const page = (items: TaskRecord[]): TaskRecordPage => ({ context, items, total: items.length, offset: 0, limit: 200, hasMore: false, hasPrevious: false, window: 'fixed', warnings: [] });
const json = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) }) as Response;
async function settle() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
function button(text: string) { const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text)); if (!value) throw new Error('Missing button: ' + text); return value; }
function mount(changes: TaskChanges = { version: 0, keys: [], runIds: [] }) {
  function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }); return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={changes} onIntake={() => {}} onOpenRequest={() => {}} />; }
  act(() => root.render(<Harness />));
}
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); calls = [];
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, width: 1000, height: 600, top: 0, left: 0, bottom: 600, right: 1000, toJSON() {} }));
  HTMLElement.prototype.scrollTo = function(options) { if (typeof options === 'object') this.scrollTop = options.top ?? 0; };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input); calls.push(path);
    if (path.includes('/records?')) { const member = new URL(path, 'http://localhost').searchParams.get('member'); return json(page(member === 'child-agent' ? [child] : member === 'all' ? [main, child] : [main])); }
    if (path.includes('/timeline?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ taskId: task.id, member: query.get('member'), window: query.get('window'), from: task.startedAt, to: task.updatedAt, bins: 160, total: 2, untimed: 0, lanes: [], coverage: { loadedMembers: 2, totalMembers: 2 } }); }
    if (path === '/api/tasks/collected%3Amain') return json(context);
    if (path.startsWith('/api/tasks?')) return json({ items: [task], total: 1, offset: 0, limit: 50, hasMore: false });
    if (path.includes('/events/one')) return json({ ...main.event, inputSummary: 'MAIN_INPUT', outputSummary: 'MAIN_OUTPUT', raw: '{"original":true}' });
    if (path.includes('/events/two')) return json({ ...child.event, inputSummary: 'CHILD_INPUT', outputSummary: 'CHILD_OUTPUT', raw: '{"child":true}' });
    throw new Error('Unexpected read: ' + path);
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('task process reading', () => {
  it('uses one task/member context and reads only selected evidence; mode changes preserve selection', async () => {
    mount(); await settle(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); }); expect(host.textContent).toContain('Investigate a task');
    expect(calls.filter(path => path.includes('/events/'))).toHaveLength(0);
    act(() => button('Main result').click()); await settle();
    expect(calls.filter(path => path.includes('/records?'))).toHaveLength(1);
    act(() => { const tab = [...host.querySelectorAll<HTMLButtonElement>('.task-evidence [role=tab]')].find(node => node.textContent === 'Input')!; tab.click(); }); await settle();
    expect(host.textContent).toContain('MAIN_INPUT'); expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    act(() => { const tab = [...host.querySelectorAll<HTMLButtonElement>('.task-evidence [role=tab]')].find(node => node.textContent === 'Output')!; tab.click(); }); await settle();
    expect(host.textContent).toContain('MAIN_OUTPUT'); expect(calls.filter(path => path.includes('/events/one'))).toHaveLength(1);
    act(() => { const tab = [...host.querySelectorAll<HTMLButtonElement>('.task-mode-tabs button')].find(node => node.textContent === 'Conversation')!; tab.click(); }); await settle();
    expect(host.querySelector('.task-evidence')?.textContent).toContain('Main result');
    expect(calls.filter(path => path.includes('/records?'))).toHaveLength(1);
  });
  it('loads the selected member at the server and can return to the original main record', async () => {
    mount(); await settle(); act(() => button('Main result').click()); await settle();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label=Scope]')!;
    act(() => { select.value = 'child-agent'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
    expect(calls.some(path => path.includes('member=child-agent'))).toBe(true);
    expect(host.querySelector('.task-record-scroll')?.textContent).toContain('Child failure');
    expect(host.querySelector('.task-evidence')).toBeNull();
    act(() => button('Return to original').click()); await settle();
    expect(host.querySelector('.task-evidence')?.textContent).toContain('Main result');
  });
  it('keeps a selected historical window while live hints arrive', async () => {
    let notify: ((value: TaskChanges) => void) | undefined;
    function Harness() { const [route, setRoute] = useState<TaskRoute>({ ...DEFAULT_TASK_ROUTE, task: task.id }), [changes, setChanges] = useState<TaskChanges>({ version: 0, keys: [], runIds: [] }); notify = setChanges; return <TaskWorkbench locale="en" route={route} onRoute={setRoute} changes={changes} onIntake={() => {}} onOpenRequest={() => {}} />; }
    act(() => root.render(<Harness />)); await settle(); act(() => button('Main result').click()); await settle();
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
    act(() => button('Imported').click()); await settle();
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
