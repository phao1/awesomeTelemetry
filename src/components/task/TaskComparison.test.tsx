import { act } from 'react';
import type { TaskSummary } from '../../core/task-types.js';
import type { HealthInput } from '../../core/task-health/types.js';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ComparisonMetricTable } from './TaskComparison.js';
import { comparisonRow } from '../../core/task-comparison.js';
import { readFileSync } from 'node:fs';
it('collapses only all-unknown rows, displays median alone and exposes samples on hover', async () => {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  try {
    act(() => root.render(<ComparisonMetricTable locale="zh" rows={[comparisonRow('known', 'known', 'ms', [1, 9, 2], [4]), comparisonRow('one', 'one side', '', [null], [3]), comparisonRow('unknown', 'unknown row', '', [null], [null])]} />));
    const unknown = host.querySelector('.task-compare-unknown .ui-accordion')!;
    expect(unknown.querySelector('button')!.getAttribute('aria-expanded')).toBe('false'); expect(unknown.querySelector('button')!.textContent).toBe('未知指标（1）'); expect(host.textContent).not.toContain('unknown row'); act(()=>unknown.querySelector('button')!.click()); expect(host.textContent).toContain('unknown row');
    expect(host.querySelector('tbody')!.querySelectorAll('tr')).toHaveLength(2);
    expect(host.querySelector('tbody td span[tabindex]')!.textContent).toBe('2 ms');
    expect(host.querySelector('tbody td span[tabindex]')!.getAttribute('title')).toBe('2 ms');
    const cell=host.querySelector<HTMLElement>('tbody td span[tabindex]')!; act(()=>cell.focus());
    await act(async()=>new Promise(resolve=>setTimeout(resolve,320)));
    const tooltip=document.querySelector('[role=tooltip]')!.textContent;expect(tooltip).toContain('n=3 · 均值 4');expect(tooltip).toContain('1 ms–9 ms');expect(tooltip).toContain('CV');
    expect(host.textContent).toContain('不可比');
  } finally { act(() => root.unmount()); host.remove(); }
});
it('keeps375-width selectors and conclusions in intrinsic single columns and table overflow local', () => {
  const css = readFileSync('src/styles/components/task-comparison.css', 'utf8');
  expect(css).toContain('minmax(min(100%, calc(var(--space-6) * 12)), 1fr)');
  expect(css).toContain('.task-compare-table { min-width: 0; max-width: 100%; overflow-x: auto; }');
  expect(css).toContain('.task-comparison .compare-timeline { min-width: 0; }');
  expect(css.match(/\b\d+px\b/g)?.filter(v => !['0px', '1px'].includes(v)) ?? []).toEqual([]);
});

it('reads standard health reports only on explicit action, sequentially, and preserves results across locale changes', async () => {
  const { TaskComparison } = await import('./TaskComparison.js');
  const { vi } = await import('vitest');
  const { analyzeTaskHealth } = await import('../../core/task-health/report.js');
  const input = (await import('../../core/__fixtures__/task-health/g1-serial.input.json')).default;
  const { DEFAULT_TASK_ROUTE } = await import('../../task-route.js');
  const tasks = ['a', 'b'].map(id => ({ id: 'imported:' + id, origin: 'imported', title: id, provider: 'codex', rootSessionKey: null }));
  const paths: string[] = [], bodies: unknown[] = []; let active = 0, maxActive = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url); paths.push(path);
    let body: unknown;
    if (path === '/api/task-comparison') body = { a: [tasks[0]], b: [tasks[1]] };
    else if (path.includes('/health-reports')) {
      active++; maxActive = Math.max(maxActive, active); bodies.push(JSON.parse(String(init?.body)));
      await Promise.resolve();
      const taskId = decodeURIComponent(path.split('/')[3]!);
      const report = analyzeTaskHealth(input as HealthInput, undefined, { id: taskId, generatedAt: '2026-10-30T00:00:00.000Z' });
      report.taskId = taskId; report.scope = { member: 'all', from: null, to: null }; body = report; active--;
    } else body = { items: tasks, total: 2, offset: 0, limit: 50, hasMore: false };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
  }));
  const route = { ...DEFAULT_TASK_ROUTE, compareA: ['imported:a'], compareB: ['imported:b'] };
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskComparison route={route} onRoute={() => {}} locale="zh" onLocate={() => {}} />));
    await vi.waitFor(() => expect(host.querySelector('.task-compare-conclusions')).not.toBeNull());
    expect(paths.some(p => p.includes('health-reports'))).toBe(false);
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === '为两侧生成/读取标准健康报告')!.click());
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    await act(async () => { await Promise.resolve(); });
    expect(maxActive).toBe(1); expect(bodies).toEqual([{ mode: 'standard', member: 'all' }, { mode: 'standard', member: 'all' }]);
    expect(host.textContent).toContain('仍存在 (2)'); act(()=>[...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b=>b.textContent==='仍存在 (2)')!.click()); expect(host.querySelectorAll('.task-compare-table tbody tr').length).toBeGreaterThan(1);
    const count = paths.length;
    await act(async () => root.render(<TaskComparison route={route} onRoute={() => {}} locale="en" onLocate={() => {}} />));
    expect(paths).toHaveLength(count); expect(host.textContent).toContain('Persisting');
    expect(paths.some(p => p.includes('/deep') || p.includes('/preview') || p === '/api/compare')).toBe(false);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('retires a pending health group when URL selection changes and suppresses late report results', async () => {
  const { TaskComparison } = await import('./TaskComparison.js');
  const { vi } = await import('vitest');
  const { DEFAULT_TASK_ROUTE } = await import('../../task-route.js');
  let finish: ((response: Response) => void) | undefined, healthSignal: AbortSignal | null = null;
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url); requests.push(path);
    if (path.includes('/health-reports')) { healthSignal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }
    const selection = path === '/api/task-comparison' ? JSON.parse(String(init?.body)) as { a: string[]; b: string[] } : null;
    const task = (id: string) => ({ id, origin: 'imported', title: id, provider: 'codex', rootSessionKey: null });
    return { ok: true, status: 200, text: async () => JSON.stringify(selection ? { a: selection.a.map(task), b: selection.b.map(task) } : { items: [], total: 0, offset: 0, limit: 50, hasMore: false }) } as Response;
  }));
  const route = { ...DEFAULT_TASK_ROUTE, compareA: ['imported:a'], compareB: ['imported:b'] };
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskComparison route={route} onRoute={() => {}} locale="en" onLocate={() => {}} />));
    await vi.waitFor(() => expect(host.querySelector('.task-compare-conclusions')).not.toBeNull());
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === 'Generate / read standard health reports for both sides')!.click());
    await vi.waitFor(() => expect(finish).toBeDefined());
    await act(async () => root.render(<TaskComparison route={{ ...route, compareA: ['imported:new'] }} onRoute={() => {}} locale="en" onLocate={() => {}} />));
    expect((healthSignal as unknown as AbortSignal).aborted).toBe(true);
    await act(async () => finish!({ ok: true, status: 200, text: async () => JSON.stringify({ version: 1, mode: 'standard', taskId: 'imported:a', findings: [], evidence: [], metrics: [], coverage: {}, dimensions: {}, scope: { member: 'all', from: null, to: null } }) } as Response));
    expect(requests.filter(p => p.includes('/health-reports'))).toHaveLength(1);
    expect(host.textContent).not.toContain('Persisting (');
    expect(host.textContent).toContain('Read complete standard health reports');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('hides system/bookkeeping rows by default, restores them without IO and preserves original tool evidence',async()=>{
 const {ComparisonProcess}=await import('./TaskComparison.js');
 const {makeEvent,makeResult}=await import('../compare-test-fixtures.js');
 const {vi}=await import('vitest');
 const technical=['System prompt','app-context','multi_agent_role','environment_context','world_state','turn_context','thread_settings_applied','item_completed'];
 const events=[...technical.map((title,i)=>makeEvent({id:'sys-'+i,title,kind:'message',hasInput:false,hasOutput:true})),makeEvent({id:'prompt',title:'REAL QUESTION',kind:'user_prompt'}),makeEvent({id:'output',title:'REAL MODEL OUTPUT',kind:'llm'}),makeEvent({id:'tool',title:'REAL TOOL CALL',tool:'read',kind:'tool'})];
 const payload=makeResult({left:{...makeResult().left,events,eventTotal:events.length},right:{...makeResult().right,events:[],eventTotal:0}});
 const fetcher=vi.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify(payload)}) as Response);vi.stubGlobal('fetch',fetcher);
 const {DEFAULT_TASK_ROUTE}=await import('../../task-route.js');
 const task=(id:string)=>({id:'collected:'+id,rootSessionKey:id,origin:DEFAULT_TASK_ROUTE.origin}) as TaskSummary;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ComparisonProcess a={task('left')} b={task('right')} locale="zh" scope="test" onLocate={()=>{}}/>));
  await vi.waitFor(()=>expect(host.querySelector('.compare-timelines')).not.toBeNull());
  const timeline=()=>host.querySelector('.compare-timelines')!.textContent;
  for(const title of technical)expect(timeline()).not.toContain(title);
  for(const title of ['REAL QUESTION','REAL MODEL OUTPUT','REAL TOOL CALL'])expect(timeline()).toContain(title);
  expect(host.querySelector('.compare-tools')!.textContent).toContain('read');
  const toggle=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;expect(toggle.checked).toBe(false);
  act(()=>toggle.click());for(const title of technical)expect(timeline()).toContain(title);
  expect(fetcher).toHaveBeenCalledTimes(1);
  act(()=>toggle.click());expect(timeline()).not.toContain('item_completed');expect(fetcher).toHaveBeenCalledTimes(1);
 }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});

it('formats table values and deltas readably while keeping exact values on hover',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 try{act(()=>root.render(<ComparisonMetricTable locale="zh" rows={[comparisonRow('duration','时长','ms',[1000],[1203344364]),comparisonRow('rate','失败率','%',[0],[17.5417]),comparisonRow('tokens','Token','',[1000],[1234567])]} />));
 const rows=host.querySelectorAll('tbody tr');expect(rows[0]!.textContent).toContain('+13.9 天');expect(rows[1]!.textContent).toContain('17.5%');expect(rows[2]!.textContent).toContain('1.2M');expect(rows[2]!.querySelectorAll('td')[1]!.querySelector('span[tabindex]')!.getAttribute('title')).toBe('1234567');
 expect(rows[0]!.querySelectorAll('td')[2]!.title).toBe('1203343364 ms');expect(rows[1]!.querySelector<HTMLElement>('td span[tabindex]')!.title).toBe('0 %');
 expect(rows[2]!.querySelectorAll('td')[3]!.textContent).toBe('1,234.57×');
 }finally{act(()=>root.unmount());}
});
it('sends request references to the process comparison API and labels the root-page boundary',async()=>{
 const {ComparisonProcess}=await import('./TaskComparison.js');const {makeResult}=await import('../compare-test-fixtures.js');const {vi}=await import('vitest');
 const result=makeResult();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(result),{status:200})));
 const host=document.createElement('div'),root=createRoot(host);
 const task=(id:string)=>({id:'collected:'+id,rootSessionKey:id,title:id} as TaskSummary);
 try{
   act(()=>root.render(<ComparisonProcess a={task('left')} b={task('right')} requestA="request:left:event:p1" requestB="request:right:event:p2" locale="en" scope="requests" onLocate={()=>{}}/>));
   await act(async()=>{for(let n=0;n<20;n++)await Promise.resolve();});
   expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({leftKey:'left',rightKey:'right',leftRequest:'request:left:event:p1',rightRequest:'request:right:event:p2'});
   act(()=>[...host.querySelectorAll<HTMLButtonElement>('.ui-accordion > button')].find(b=>b.textContent==='Calculation basis')!.click());expect(host.textContent).toContain('Request window');expect(host.textContent).toContain('loaded root-session page only');
 }finally{act(()=>root.unmount());vi.unstubAllGlobals();}
});
it('keeps numeric alignment local, token values compact and metric row headers unfilled',()=>{
 const css=readFileSync('src/styles/components/task-comparison.css','utf8');expect(css).toContain('.comparison-metric-table td:nth-child(n+2):nth-child(-n+5)');expect(css).toContain('text-align: right; font-variant-numeric: tabular-nums');expect(css).toContain('.task-compare-table tbody th { background: transparent; }');
});
