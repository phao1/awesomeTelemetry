import { DEFAULT_ALERT_THRESHOLDS } from './core/task-alerts.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from './core/trace-types.js';
import {PROVIDER_KEYS} from './core/trace-types.js';
import type { SessionDetailResponse, TraceEvent } from './core/trace-types.js';
import App from './App.js';
import { recordCache, eventDetailCache } from './cache/caches.js';
import { LAYOUT_KEYS } from './layout.js';
import { makeSession, makeResult } from './components/compare-test-fixtures.js';
import { makeEvent, makeMessage } from './components/trajectory/investigation-test-fixtures.js';

function session(id: string, provider: 'codex' | 'claude', title: string): SessionIndexEntry {
  return {
    id,
    provider,
    sourceAgent: provider,
    title,
    startedAt: `2026-08-0${id.slice(-1)}T00:00:00.000Z`,
    updatedAt: `2026-08-0${id.slice(-1)}T00:01:00.000Z`,
    status: 'success',
    cwd: '/tmp',
    eventCount: 10,
    messageCount: 3,
    tokenTotal: 100,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
    tags: [],
  };
}

const THREE_SESSIONS = [
  session('s-1', 'codex', 'fix build'),
  session('s-2', 'claude', 'refactor api'),
  session('s-3', 'codex', 'debug login'),
];


async function navigateHash(hash:string){await act(async()=>{history.replaceState(null,'',hash);window.dispatchEvent(new Event('hashchange'));await new Promise(resolve=>setTimeout(resolve,10));});}
async function openAgentGroup(container:HTMLElement){await navigateHash('#/overview');await act(async()=>{const tab=[...container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b=>b.textContent==='Agent 视角')!;expect(tab).toBeDefined();tab.click();await import('./components/AgentOverview.js');});}

const TASK_FIXTURES=THREE_SESSIONS.map(session=>({id:'collected:'+session.id,origin:'collected' as const,provenanceKnown:true,rootSessionKey:session.id,runId:null,title:session.title,provider:session.provider,startedAt:session.startedAt,updatedAt:session.updatedAt,recordedStatus:session.status,memberCount:1,eventCount:2,loadedMemberCount:1}));
const OVERVIEW_POINT={day:'2026-11-01T00:00:00.000Z',tasks:3,statusKnownTasks:3,toolKnownTasks:3,failedTasks:0,failurePct:0,toolFailurePct:0,tokens:null,tokenKnownTasks:0,cacheHitRate:null,cacheKnownMembers:0,cacheTotalMembers:3,alerts:0,input:null,output:null,cacheRead:null,cacheWrite:null};
const OVERVIEW_FIXTURE={range:'7d',provider:'',generatedAt:OVERVIEW_POINT.day,current:OVERVIEW_POINT,previous:null,daily:[],providers:[],models:[],tools:[],alerts:[],criteria:{zh:'任务口径',en:'Task basis'}};
function taskContext(id:string){const task=TASK_FIXTURES.find(t=>t.id===id)??TASK_FIXTURES[0]!;return {task,members:[{id:task.rootSessionKey,name:task.provider,role:'main',sessionKey:task.rootSessionKey,parentId:null,detailLoaded:true,eventCount:2}],importSession:null,warnings:[]};}
function taskPage(id:string){const context=taskContext(id),key=context.task.rootSessionKey;return {context,items:[1,2].map(sequence=>({id:key+':event:shared-'+sequence,memberId:key,memberName:context.task.provider,sessionKey:key,event:{...makeEvent(makeMessage('shared-'+sequence,sequence,{kind:'llm',role:'assistant',title:'Result '+sequence,hasInput:false,hasOutput:true})),sessionId:key},importedTurn:null})),total:2,offset:0,limit:200,hasMore:false,hasPrevious:false,window:'fixed',warnings:[]};}
const apiResponse=(value:unknown)=>({ok:true,status:200,text:async()=>JSON.stringify(value)}) as Response;
function taskResponse(path:string):Response {
 if(path.startsWith('/api/task-kpis'))return apiResponse(OVERVIEW_FIXTURE);
 if(path.startsWith('/api/tasks?'))return apiResponse({items:TASK_FIXTURES,total:3,offset:0,limit:50,hasMore:false});
 const taskMatch=/\/api\/tasks\/([^/?]+)/.exec(path);const id=taskMatch?decodeURIComponent(taskMatch[1]!):TASK_FIXTURES[0]!.id;
 if(path.includes('/records?'))return apiResponse(taskPage(id));
 if(path.includes('/timeline?')){const q=new URL(path,'http://localhost').searchParams;return apiResponse({taskId:id,member:q.get('member'),window:q.get('window'),bins:160,total:2,untimed:0,lanes:[],from:null,to:null,coverage:{loadedMembers:1,totalMembers:1}});}
 if(taskMatch)return apiResponse(taskContext(id));
 if(path.includes('/events/'))return apiResponse({...taskPage(id).items[0]!.event,inputSummary:'input',outputSummary:'SELECTED PUBLIC OUTPUT'});
 if(path.includes('/sessions?'))return apiResponse({items:THREE_SESSIONS,total:3,hasMore:false,nextCursor:null});
 if(path.includes('/session-groups'))return apiResponse({groups:[]});
 return apiResponse({});
}
function installTaskApi(){vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>taskResponse(String(input))));}
async function readyTasks(container:HTMLElement){for(let i=0;i<100&&container.querySelectorAll('.task-health-title').length!==3;i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});expect(container.querySelectorAll('.task-health-title')).toHaveLength(3);}

describe('WB-007 lazy Agent overview entry',()=>{
  it('loads capture metadata only on entry and active sources only on explicit live expansion, never row bodies', async () => {
    const previousUrl = window.location.href;
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);paths.push(path);
      const body = path.endsWith('/proxy/status') ? { running: false, starting: false, port: null, startedAt: null, requestCount: 0 }
        : path.startsWith('/api/proxy/requests?') ? { items: [], nextCursor: null, hasMore: false }
        : path.endsWith('/proxy/live') ? { items: [] }
        : path.includes('/sessions?') ? { items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 } : { groups: [] };
      return { ok: true, text: async () => JSON.stringify(body) };
    }));
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await Promise.resolve(); });expect(paths.filter(path => path.includes('/proxy/'))).toHaveLength(0);
      const tab = container.querySelector<HTMLButtonElement>('.app-sidebar nav [aria-label=数据接入]')!;
      expect(tab).toBeDefined();await navigateHash('#/proxy');
      await act(async () => { await import('./components/ProxyView.js');await Promise.resolve(); });
      expect(paths.filter(path => path.includes('/proxy/')).sort()).toEqual(['/api/proxy/requests?limit=50', '/api/proxy/status']);
      await vi.waitFor(()=>expect(container.querySelector('.capture-live')).not.toBeNull());
      const live = container.querySelector<HTMLDetailsElement>('.capture-live')!;expect(live.open).toBe(false);
      await act(async () => { live.open = true;live.dispatchEvent(new Event('toggle'));await import('./components/ProxyLivePanel.js'); });
      expect(paths.filter(path => path.endsWith('/proxy/live'))).toHaveLength(1);
      expect(paths.some(path => /\/requests\/\d+/.test(path))).toBe(false);
      expect(EventSourceStub.instances).toHaveLength(1); // The shared shell SSE only; no selected-body subscription.
    } finally { unmount();history.replaceState(null, '', previousUrl); }
  });
  it.each([true, false])('WB-003 exact source-group preselection, matching second group=%s; no substitution or stale compare key', async matching => {
    const previousUrl = window.location.href;
    const previousMode = localStorage.getItem('awesome-telemetry.agentViewMode');
    localStorage.setItem('awesome-telemetry.agentViewMode', 'table');
    const indexed = [
      { ...session('s-1', 'codex', 'Group A original'), sourceAgent: 'Group A' },
      { ...session('s-2', 'codex', 'Group B original'), sourceAgent: 'Group B' },
      { ...session('s-3', 'codex', 'Newer but unrelated'), sourceAgent: 'Unrelated' },
    ];
    const group = (sourceAgent: string) => ({ provider: 'codex', sourceAgent, sessionCount: 1, eventCount: 10,
      tokenInput: 10, tokenOutput: 20, tokenTotal: 30, costUsd: 0, pricedSessionCount: 0, avgWallClockMs: 1000,
      latestUpdatedAt: '2026-10-18T00:00:00.000Z', avgToolDurationMs: null, errorRate: null, verificationCoverage: null,
      debugEntryRate: null, durationByPhase: { understand: 0, plan: 0, implement: 0, debug: 0, verify: 0, report: 0 } });
    const pairs: Array<{ leftKey: string; rightKey: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/task-comparison') { const selection=JSON.parse(String(init?.body)) as {a:string[];b:string[]};return apiResponse({a:selection.a.map(id=>TASK_FIXTURES.find(t=>t.id===id)),b:selection.b.map(id=>TASK_FIXTURES.find(t=>t.id===id))}); }
      if (path === '/api/compare') { pairs.push(JSON.parse(String(init?.body)) as { leftKey: string; rightKey: string });return new Promise<never>(() => undefined); }
      const body = path.includes('/agent-overview') ? { rows: [group('Group A'), group(matching ? 'Group B' : 'Not loaded')], stamp: '2026-10-18T00:00:00.000Z', cached: false }
        : path.includes('/sessions?') ? { items: indexed, total: indexed.length, hasMore: false, nextCursor: null } : { groups: [] };
      return { ok: true, text: async () => JSON.stringify(body) };
    }));
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await Promise.resolve();history.replaceState(null, '', '#/compare?left=s-3&right=s-2');window.dispatchEvent(new Event('hashchange'));await import('./components/task/TaskComparison.js'); });
      await act(async () => { for (let i = 0; i < 30 && pairs.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(pairs).toEqual([{ leftKey: 's-3', rightKey: 's-2' }]);
      await openAgentGroup(container);
      await act(async () => { for (let i = 0; i < 30 && !container.querySelector('.overview tbody input'); i++) await new Promise(resolve => setTimeout(resolve, 10)); });
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
      const boxes = container.querySelectorAll<HTMLInputElement>('.overview tbody input');
      act(() => boxes[0]!.click());act(() => boxes[1]!.click());
      await act(async () => { container.querySelector<HTMLButtonElement>('.compare-float-btn')!.click();await Promise.resolve(); });
      expect(window.location.hash).toContain('a=collected%3As-1');
      if (matching) {
        expect(pairs).toEqual([{ leftKey: 's-3', rightKey: 's-2' }, { leftKey: 's-1', rightKey: 's-2' }]);
      } else {
        expect(pairs).toHaveLength(1);expect(window.location.hash).not.toContain('b=');
        expect(container.querySelector('.compare-float-btn')).toBeNull();
      }
    } finally {
      unmount();history.replaceState(null, '', previousUrl);
      if (previousMode === null) localStorage.removeItem('awesome-telemetry.agentViewMode');else localStorage.setItem('awesome-telemetry.agentViewMode', previousMode);
    }
  });
  it('lazy settings remains a closable dialog, reads config once on opening and never saves on close',async()=>{
    const paths:Array<{path:string;method:string}>=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);paths.push({path,method:init?.method??'GET'});
      const body=path.endsWith('/config/providers')?{providers:Object.fromEntries(PROVIDER_KEYS.map(key=>[key,{key,enabled:true,path:'/synthetic/'+key,label:key,sourceKind:'jsonl',watchStrategy:'chokidar',pollIntervalMs:0}])),traeKeyPath:null,prewarmRecent:0}
        :path.includes('/sessions?')?{items:THREE_SESSIONS,nextCursor:null,hasMore:false,total:3}:{};
      return {ok:true,text:async()=>JSON.stringify(body)};
    }));const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{await Promise.resolve();});expect(paths.some(item=>item.path.endsWith('/config/providers'))).toBe(false);
      const trigger=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='设置')!;act(()=>{trigger.focus();trigger.click();});
      await act(async()=>{for(let i=0;i<30&&!container.querySelector('[data-provider-path]');i++)await new Promise(resolve=>setTimeout(resolve,10));});
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();expect(container.querySelector('[data-provider-path="codex"]')).not.toBeNull();
      act(()=>container.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="关闭"]')!.click());expect(container.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger);
      expect(paths.filter(item=>item.path.endsWith('/config/providers'))).toEqual([{path:'/api/config/providers',method:'GET'}]);
    } finally {unmount();}
  });
  it('lazy Frida navigation reads status/history once and performs no start/stop or detail calls',async()=>{
    const paths:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);paths.push(path);
      const body=path.endsWith('/frida/status')?{running:false,starting:false,pid:null}
        :path.endsWith('/frida/captures')?{items:[],nextCursor:null,hasMore:false}
        :path.includes('/sessions?')?{items:THREE_SESSIONS,nextCursor:null,hasMore:false,total:3}:{};
      return {ok:true,text:async()=>JSON.stringify(body)};
    }));const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{await Promise.resolve();});expect(paths.filter(path=>path.includes('/frida/'))).toHaveLength(0);
      await navigateHash('#/frida');
      await act(async()=>{for(let i=0;i<30&&!paths.some(path=>path.endsWith('/frida/status'));i++)await new Promise(resolve=>setTimeout(resolve,10));});
      expect(paths.filter(path=>path.includes('/frida/')).sort()).toEqual(['/api/frida/captures','/api/frida/status']);
      expect(container.querySelector('[data-frida-ack]')).not.toBeNull();expect(container.querySelector('.task-channel-list')).not.toBeNull();
    } finally {unmount();}
  });
  it('retains bounded unique Frida save notifications with zero hidden reads and opens only the selected text',async()=>{
    const previousUrl=window.location.href;history.replaceState(null,'','#/session');
    const paths:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);paths.push(path);
      const body=path.endsWith('/frida/status')?{running:false,starting:false,pid:null}
        :path.endsWith('/frida/captures')?{items:[],nextCursor:null,hasMore:false}
        :path.endsWith('/frida/captures/64')?{id:64,pid:123,capturedAt:'2026-10-20T00:00:00.000Z',captureType:'chat',jsonData:'{"synthetic":true}',model:null,sessionId:null,captureSessionId:null,messageCount:null,tokens:null}
        :path.includes('/sessions?')?{items:THREE_SESSIONS,nextCursor:null,hasMore:false,total:3}:{};
      return {ok:true,text:async()=>JSON.stringify(body)};
    }));const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{await Promise.resolve();});
      const es=EventSourceStub.instances[0]!;
      act(()=>{
        for(let id=1;id<=64;id++)es.emit('frida_capture',{id,model:'MUST_NOT_RETAIN',sessionId:'MUST_NOT_RETAIN'});
        es.emit('frida_capture',{id:64});es.emit('frida_capture',{id:0});es.emit('frida_capture',{id:'65'});
        es.emit('frida_capture',{id:Number.MAX_SAFE_INTEGER+1});es.emit('frida_capture',null);
        es.emit('frida_status',{running:true,pid:123});es.emit('frida_status',{running:'false',pid:0});
        for(const listener of es.listeners.get('frida_capture')??[])listener({data:'{broken'});
      });
      expect(paths.filter(path=>path.includes('/frida/'))).toHaveLength(0);
      await navigateHash('#/frida');
      await act(async()=>{await import('./components/FridaView.js');for(let i=0;i<30&&!container.querySelector('[aria-label="新保存捕获通知"]');i++)await new Promise(resolve=>setTimeout(resolve,10));});
      const buttons=container.querySelectorAll<HTMLButtonElement>('[aria-label="新保存捕获通知"] button');
      expect([...buttons].map(item=>item.textContent)).toEqual(Array.from({length:20},(_,i)=>'#'+(45+i)));
      expect(container.textContent).not.toContain('MUST_NOT_RETAIN');expect(container.textContent).toContain('PID 123');
      expect(paths.filter(path=>path.includes('/frida/')).sort()).toEqual(['/api/frida/captures','/api/frida/status']);
      await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="打开新保存捕获 #64"]')!.click();await Promise.resolve();});
      expect(container.querySelector('pre')?.textContent).toBe('{"synthetic":true}');
      expect(paths.filter(path=>/\/frida\/captures\/\d+/.test(path))).toEqual(['/api/frida/captures/64']);
      expect(EventSourceStub.instances).toHaveLength(1);expect(paths.some(path=>/\/frida\/(start|stop)/.test(path))).toBe(false);
    } finally {unmount();history.replaceState(null,'',previousUrl);}
  });
  it('reset clears Frida notices and selected text, reloads only the mounted bounded snapshot and ignores old detail completion',async()=>{
    const previousUrl=window.location.href;history.replaceState(null,'','#/frida');
    const paths:string[]=[];let resolveDetail!: (value:{ok:boolean;text:()=>Promise<string>})=>void;let detailSignal:AbortSignal|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);paths.push(path);
      if(path.endsWith('/frida/captures/9')){detailSignal=init?.signal??undefined;return new Promise<{ok:boolean;text:()=>Promise<string>}>(resolve=>{resolveDetail=resolve;});}
      const body=path.endsWith('/frida/status')?{running:false,starting:false,pid:null}
        :path.endsWith('/frida/captures')?{items:[],nextCursor:null,hasMore:false}
        :path.includes('/sessions?')?{items:[],nextCursor:null,hasMore:false,total:0}:{};
      return {ok:true,text:async()=>JSON.stringify(body)};
    }));const {container,unmount}=renderAppWithUnmount();
    try {
      await navigateHash('#/frida');
      await act(async()=>{await import('./components/FridaView.js');for(let i=0;i<30&&!container.querySelector('[data-frida-ack]');i++)await new Promise(resolve=>setTimeout(resolve,10));});
      act(()=>{EventSourceStub.instances[0]!.emit('frida_capture',{id:9});EventSourceStub.instances[0]!.emit('frida_status',{running:true,pid:12});});
      act(()=>container.querySelector<HTMLButtonElement>('[aria-label="打开新保存捕获 #9"]')!.click());
      expect(detailSignal?.aborted).toBe(false);
      await act(async()=>{EventSourceStub.instances[0]!.emit('connected',{resume:'reset'});await Promise.resolve();});
      expect(detailSignal?.aborted).toBe(true);expect(container.querySelector('.frida-capture-inspector')).toBeNull();
      expect(container.querySelector('[aria-label="新保存捕获通知"]')).toBeNull();expect(container.querySelector('[aria-label="最近 Frida 运行通知"]')).toBeNull();
      await act(async()=>{resolveDetail({ok:true,text:async()=>JSON.stringify({id:9,pid:12,capturedAt:'2026-10-20T00:00:00.000Z',captureType:'chat',jsonData:'OLD_LATE_BODY'})});await Promise.resolve();});
      expect(container.textContent).not.toContain('OLD_LATE_BODY');
      expect(paths.filter(path=>path==='/api/frida/status')).toHaveLength(2);expect(paths.filter(path=>path==='/api/frida/captures')).toHaveLength(2);
      expect(paths.filter(path=>/\/frida\/captures\/\d+/.test(path))).toEqual(['/api/frida/captures/9']);
      expect(EventSourceStub.instances).toHaveLength(1);
    } finally {unmount();history.replaceState(null,'',previousUrl);}
  });
  it('keeps navigation available and issues one aggregate read, never a detail fan-out',async()=>{
    const paths:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);paths.push(path);
      const body=path.includes('/agent-overview')?{rows:[],stamp:'2026-10-18T00:00:00.000Z',cached:false}
        :path.includes('/sessions?')?{items:THREE_SESSIONS,nextCursor:null,hasMore:false,total:3}
        :path.includes('/session-groups')?[]:{};
      return {ok:true,text:async()=>JSON.stringify(body)};
    }));
    const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{await Promise.resolve();});
      expect(paths.filter(path=>path.includes('/agent-overview'))).toHaveLength(0);
      await openAgentGroup(container);
      await act(async()=>{for(let i=0;i<30&&!paths.some(path=>path.includes('/agent-overview'));i++)await new Promise(resolve=>setTimeout(resolve,10));});
      expect(paths.filter(path=>path.includes('/agent-overview'))).toHaveLength(1);
      expect(paths.filter(path=>/\/sessions\/[^?]/.test(path))).toHaveLength(0);
      expect(container.querySelectorAll('.app-sidebar nav button')).toHaveLength(7);
    } finally {unmount();}
  });
});

/** jsdom 无 EventSource：补最小桩（SSE 订阅能力，不 mock 被测逻辑）。 */
class EventSourceStub {
  static readonly instances: EventSourceStub[] = [];
  readonly onopen: (() => void) | null = null;
  readonly onerror: (() => void) | null = null;
  readonly listeners = new Map<string, Array<(event: { data: string; lastEventId?: string }) => void>>();

  constructor(_url: string) {
    EventSourceStub.instances.push(this);
  }

  addEventListener(type: string, cb: (event: { data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }

  close(): void {
    // noop
  }

  emit(type: string, data: unknown, lastEventId?: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data), lastEventId });
    }
  }
}

const appRoots = new Set<ReturnType<typeof createRoot>>();

function renderApp(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  appRoots.add(root);
  act(() => { root.render(<App />); });
  return document.body as unknown as HTMLDivElement;
}

/** team 测试专用：返回 container + unmount，确保组件正确卸载避免 hash 残留。 */
function renderAppWithUnmount(): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  appRoots.add(root);
  act(() => {
    root.render(<App />);
  });
  return { container:document.body as unknown as HTMLDivElement, unmount: () => act(() => { root.unmount(); appRoots.delete(root); }) };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,top:0,left:0,right:1200,bottom:600,width:1200,height:600,toJSON(){}});
  history.replaceState(null, '', '#/session');
  EventSourceStub.instances.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 }),
  })));
  vi.stubGlobal('EventSource', EventSourceStub);
});

afterEach(() => {
  act(() => { for (const root of appRoots) root.unmount(); appRoots.clear(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('REQ-015 共享会话 store（G7.6）', () => {
  it('WB-003: comparison evidence beyond the cached first page opens its exact record through one bounded selected read',async()=>{
    const previousUrl=window.location.href;
    const first={...makeEvent(makeMessage('first-page',1,{role:'assistant',kind:'llm',tool:null,hasInput:false,hasOutput:false,hasRaw:false})),sessionId:'s-1'};
    const target={...makeEvent(makeMessage('beyond-first-page',3001,{role:'tool',kind:'tool',tool:'read',hasInput:false,hasOutput:false,hasRaw:false,status:'error',error:'SYNTHETIC_SELECTED_ERROR'})),sessionId:'s-1'};
    const cached:SessionDetailResponse={session:makeSession('s-1',{eventCount:6000}),events:[first],mode:'slim',eventTotal:6000,eventOffset:0,eventLimit:2000,hasMore:true,pending:false};
    const selected:SessionDetailResponse={...cached,events:[first,target],eventLimit:5000};
    const pair=makeResult({left:selected,right:{...makeResult().right,session:makeSession('s-2')}});
    const fallback=fetch;
    const fetcher=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);
      if(path.startsWith('/api/tasks/collected%3As-1/records?')) return Promise.resolve({ok:true,text:async()=>JSON.stringify({context:{task:{id:'collected:s-1',origin:'collected',provenanceKnown:true,rootSessionKey:'s-1',runId:null,title:'Fix build',provider:'codex',startedAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:00.000Z',recordedStatus:'error',memberCount:1,eventCount:6000,loadedMemberCount:1},members:[{id:'main',name:'Codex',role:'main',sessionKey:'s-1',parentId:null,detailLoaded:true,eventCount:6000}],importSession:null,warnings:[]},items:[{id:'s-1:event:beyond-first-page',memberId:'main',memberName:'Codex',sessionKey:'s-1',event:target,importedTurn:null}],total:6000,offset:2960,limit:200,hasMore:true,hasPrevious:true,window:'fixed-window',warnings:[]})} as Response);
      if(path==='/api/tasks/collected%3As-1') return Promise.resolve({ok:true,text:async()=>JSON.stringify({task:{id:'collected:s-1',origin:'collected',provenanceKnown:true,rootSessionKey:'s-1',runId:null,title:'Fix build',provider:'codex',startedAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:00.000Z',recordedStatus:'error',memberCount:1,eventCount:6000,loadedMemberCount:1},members:[{id:'main',name:'Codex',role:'main',sessionKey:'s-1',parentId:null,detailLoaded:true,eventCount:6000}],importSession:null,warnings:[]})} as Response);
      if(path==='/api/task-comparison')return Promise.resolve(apiResponse({a:[TASK_FIXTURES[0]],b:[TASK_FIXTURES[1]]}));
      if(path==='/api/compare')return Promise.resolve({ok:true,text:async()=>JSON.stringify(pair)}as Response);
      if(path.includes('/api/session-groups'))return Promise.resolve({ok:true,text:async()=>JSON.stringify({groups:[]})}as Response);
      if(path.includes('/api/sessions/s-1?'))return Promise.resolve({ok:true,text:async()=>JSON.stringify(selected)}as Response);
      return fallback(input,init);
    });
    vi.stubGlobal('fetch',fetcher);recordCache.clear();eventDetailCache.clear();recordCache.set('s-1:slim',cached);
    const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{history.replaceState(null,'','#/compare?left=s-1&right=s-2');window.dispatchEvent(new Event('hashchange'));await import('./components/task/TaskComparison.js');});
      await act(async()=>{for(let i=0;i<30&&!container.querySelector('.cmp-run-evidence');i++)await new Promise(resolve=>setTimeout(resolve,10));});
      act(()=>[...container.querySelectorAll<HTMLButtonElement>('.ui-accordion > button')].find(b=>b.textContent==='调查入口')!.click());
      const left=container.querySelector('.cmp-evidence-side')!;
      act(()=>left.querySelector('summary')!.click());
      await act(async()=>{left.querySelector<HTMLButtonElement>('.cmp-evidence-errors button')!.click();for(let i=0;i<10;i++)await Promise.resolve();});
      for(let i=0;i<100&&!container.querySelector('.task-evidence')?.textContent?.includes('SYNTHETIC_SELECTED_ERROR');i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
      expect(fetcher.mock.calls.filter(([path])=>String(path).includes('/api/tasks/collected%3As-1/records?')&&String(path).includes('anchor=s-1%3Aevent%3Abeyond-first-page'))).toHaveLength(1);
      expect(fetcher.mock.calls.some(([path])=>String(path).includes('limit=5000'))).toBe(false);
      expect(window.location.hash).toContain('task=collected%3As-1');
      expect(container.querySelector('.task-evidence')?.textContent).toContain('beyond-first-page');
      expect(container.querySelector('.task-evidence')?.textContent).toContain('SYNTHETIC_SELECTED_ERROR');
    } finally {unmount();recordCache.clear();eventDetailCache.clear();history.replaceState(null,'',previousUrl);}
  });
  it('WB-002: switching runs clears the previous Turn and event focus, even when event IDs repeat', async () => {
    installTaskApi();const {container,unmount}=renderAppWithUnmount();try{
      await readyTasks(container);act(()=>container.querySelector<HTMLButtonElement>('.task-health-title')!.click());
      await vi.waitFor(()=>expect(container.querySelectorAll('.process-record-button')).toHaveLength(2));
      act(()=>container.querySelector<HTMLButtonElement>('.process-record-button')!.click());await vi.waitFor(()=>expect(container.querySelector('.task-evidence')).not.toBeNull());
      expect(window.location.hash).toContain('event=s-1%3Aevent%3Ashared-1');
      await navigateHash('#/task?task=collected%3As-2');await vi.waitFor(()=>expect(container.querySelector('.task-context-header')?.textContent).toContain('refactor api'));
      expect(container.querySelector('.task-evidence')).toBeNull();expect(window.location.hash).not.toContain('event=');expect(container.querySelector('.process-record-on')).toBeNull();
    }finally{unmount();}
  });
  it('WB-002: first paint is loading, not an empty successful list', () => {
    const {container,unmount}=renderAppWithUnmount();try{expect(container.querySelector('.task-sidebar .task-empty')).toBeNull();expect(container.querySelector('[role="status"]')).not.toBeNull();expect(container.querySelector('.task-empty')).toBeNull();}finally{unmount();}
  });

  it('WB-002: slash can reopen a collapsed list and focus its search field', async () => {
    const previous=localStorage.getItem(LAYOUT_KEYS.railCollapsed);localStorage.setItem(LAYOUT_KEYS.railCollapsed,'true');
    const {container,unmount}=renderAppWithUnmount();try{
      expect(container.querySelector('.task-workbench')?.classList.contains('task-list-collapsed')).toBe(true);
      await act(async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,10));});
      expect(container.querySelector('.task-workbench')?.classList.contains('task-list-collapsed')).toBe(false);expect(document.activeElement).toBe(container.querySelector('.task-list-filters input'));
    }finally{unmount();if(previous===null)localStorage.removeItem(LAYOUT_KEYS.railCollapsed);else localStorage.setItem(LAYOUT_KEYS.railCollapsed,previous);}
  });

  it('WB-002: a late old search response cannot replace a newer result or its URL scope', async () => {
    let finishOld:((response:Response)=>void)|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);if(path.startsWith('/api/tasks?')){if(!path.includes('q='))return new Promise<Response>(r=>{finishOld=r;});return apiResponse({items:[{...TASK_FIXTURES[1],title:'LATEST query result'}],total:1,offset:0,limit:50,hasMore:false});}return taskResponse(path);}));
    const {container,unmount}=renderAppWithUnmount();try{
      await act(async()=>{await new Promise(r=>setTimeout(r,10));});expect(finishOld).toBeDefined();
      act(()=>{const search=container.querySelector<HTMLInputElement>('.task-list-filters input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'LATEST');search.dispatchEvent(new Event('input',{bubbles:true}));});
      await vi.waitFor(()=>expect(container.querySelector('.task-health-title')?.textContent).toContain('LATEST query result'));
      await act(async()=>finishOld!(apiResponse({items:[{...TASK_FIXTURES[0],title:'STALE initial query'}],total:1,offset:0,limit:50,hasMore:false})));
      expect(container.textContent).not.toContain('STALE initial query');expect(container.querySelector('.task-health-title')?.textContent).toContain('LATEST query result');expect(window.location.hash).toContain('q=LATEST');expect(container.querySelector('.task-sidebar')?.getAttribute('aria-busy')).toBe('false');
    }finally{unmount();}
  });

  it('WB-002: the Tasks-scoped Team link reaches existing runs while global navigation stays at six views', async () => {
    installTaskApi();const original=fetch;vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>String(input).includes('/api/team-runs')?Promise.resolve(apiResponse({items:[],total:0,hasMore:false,nextCursor:null})):original(input,init)));
    const {container,unmount}=renderAppWithUnmount();try{await readyTasks(container);expect(container.querySelectorAll('.app-sidebar nav button')).toHaveLength(7);expect(container.querySelector('.app-sidebar nav details')).toBeNull();expect(vi.mocked(fetch).mock.calls.some(([i])=>String(i).includes('/api/team-runs'))).toBe(false);await navigateHash('#/team');await act(async()=>{await import('./components/team/TeamShell.js');});await act(async()=>{await new Promise(r=>setTimeout(r,350));});expect(container.querySelector('.team-shell')).not.toBeNull();expect(window.location.hash).toMatch(/^#\/team/);expect(vi.mocked(fetch).mock.calls.filter(([i])=>String(i).includes('/api/team-runs'))).toHaveLength(1);expect(vi.mocked(fetch).mock.calls.some(([i])=>/\/api\/team-runs\/[^/?]+/.test(String(i)))).toBe(false);}finally{unmount();}
  });

  it('WB-001: visible global search opens the real lazy palette without detail fan-out and restores focus', async () => {
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      const before = vi.mocked(fetch).mock.calls.length;
      const trigger = container.querySelector('.page-search') as HTMLButtonElement;
      expect(trigger).not.toBeNull();
      await act(async () => {
        trigger.focus(); trigger.click();
        await import('./components/CommandPalette.js');
      });
      const dialog = container.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(document.activeElement).toBe(dialog.querySelector('input[type="search"]'));
      expect(vi.mocked(fetch).mock.calls.length).toBe(before);
      act(() => (dialog.querySelector('[aria-label="关闭"]') as HTMLButtonElement).click());
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally { unmount(); }
  });

  it('metadata reset invalidates caches and refreshes one bounded page, never original bodies', async () => {
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      const before = vi.mocked(fetch).mock.calls.length;
      recordCache.set('stale:slim', {} as SessionDetailResponse);
      eventDetailCache.set('stale:event', {} as TraceEvent);
      // Native EventSource's id-less connected control inherits the last id.
      await act(async () => {
        EventSourceStub.instances[0]!.emit('scan_completed', { provider: 'all', count: 1 }, 'old-epoch:6');
        EventSourceStub.instances[0]!.emit('connected', { resume: 'reset', cursor: 'epoch:7' }, 'old-epoch:6');
      });
      expect(recordCache.size).toBe(0); expect(eventDetailCache.size).toBe(0);
      const paths = vi.mocked(fetch).mock.calls.slice(before).map(call => String(call[0]));
      expect(paths).toHaveLength(2);
      expect(paths.filter(path=>path.startsWith('/api/tasks?'))).toHaveLength(1);
      expect(paths[0]).toContain('/api/sessions?');
      expect(paths[0]).toContain('limit=50');
      expect(paths[0]).not.toContain('/events/');
      expect(container.textContent).toContain('实时恢复窗口已重置');
    } finally { unmount(); }
  });

  it('repeated replay cursors trigger one key patch, not duplicate requests', async () => {
    const { unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      const before = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        EventSourceStub.instances[0]!.emit('sessions_changed', { keys: ['s-1'], count: 1 }, 'epoch:1');
        EventSourceStub.instances[0]!.emit('sessions_changed', { keys: ['s-1'], count: 1 }, 'epoch:1');
      });
      const paths = vi.mocked(fetch).mock.calls.slice(before).map(call => String(call[0]));
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('keys=s-1');
      expect(paths[0]).not.toContain('limit=50');
    } finally { unmount(); }
  });

  it('late pre-reset detail and key patches cannot restore old caches or overwrite the new metadata snapshot', async () => {
    let finishPatch:((response:Response)=>void)|undefined;let finishDetail:((response:Response)=>void)|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);if(path.includes('keys='))return new Promise<Response>(r=>{finishPatch=r;});if(path==='/api/tasks/collected%3As-1')return new Promise<Response>(r=>{finishDetail=r;});return taskResponse(path);}));
    const {container,unmount}=renderAppWithUnmount();try{await readyTasks(container);act(()=>container.querySelector<HTMLButtonElement>('.task-health-title')!.click());act(()=>EventSourceStub.instances[0]!.emit('sessions_changed',{keys:['s-1'],count:1},'old:1'));expect(finishPatch).toBeDefined();expect(finishDetail).toBeDefined();
      await act(async()=>EventSourceStub.instances[0]!.emit('connected',{resume:'reset'},'old:1'));
      await navigateHash('#/task');await readyTasks(container);
      await act(async()=>{finishPatch!(apiResponse({items:[{...THREE_SESSIONS[0],title:'STALE EPOCH TITLE'}],hasMore:false,nextCursor:null}));finishDetail!(apiResponse({...taskContext('collected:s-1'),task:{...TASK_FIXTURES[0],title:'STALE EPOCH TITLE'}}));});
      expect(container.textContent).not.toContain('STALE EPOCH TITLE');expect(recordCache.get('s-1:slim')).toBeUndefined();expect(container.querySelector('.task-context-header')).toBeNull();
    }finally{unmount();}
  });
  it('Phase C direct comparison entry loads populated baseline and improvement task pickers', async () => {
    installTaskApi();const container=renderApp();
    await readyTasks(container);
    const tab=[...container.querySelectorAll<HTMLButtonElement>('.app-sidebar nav button')].find(b=>b.textContent==='对比')!;
    expect(tab).toBeDefined();
    await act(async()=>{tab.click();await import('./components/task/TaskComparison.js');});
    await vi.waitFor(()=>expect(container.querySelectorAll('.task-compare-picker [role=combobox]')).toHaveLength(2));
    expect(container.querySelectorAll('.task-compare-picker')).toHaveLength(2);
    for(const picker of container.querySelectorAll('.task-compare-picker')){
      expect(picker.querySelector('details')).toBeNull();
      act(()=>picker.querySelector<HTMLElement>('[role=combobox]')!.click());
      await vi.waitFor(()=>expect(document.querySelectorAll('[role=option]')).toHaveLength(3));
      expect(document.querySelector('[role=listbox]')!.textContent).toContain('fix build');expect(document.querySelector('[role=listbox]')!.textContent).toContain('refactor api');expect(document.querySelector('[role=listbox]')!.textContent).toContain('debug login');
      act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    }
    expect(container.textContent).toContain('每侧选择 1–40 个任务');
    expect(vi.mocked(fetch).mock.calls.some(([path])=>String(path)==='/api/compare'||String(path)==='/api/task-comparison')).toBe(false);
  });

  it('REQ-023：/api/health 只请求一次，不轮询', async () => {
    renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const fetchMock = vi.mocked(fetch);
    const healthCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/health'),
    );
    expect(healthCalls).toHaveLength(1);

  });

  it('会话视图 IA：粘性工具条 + findings 折叠 + turn 表面（统计条 + 色带 + 回合列表）', async () => {
    installTaskApi();const {container,unmount}=renderAppWithUnmount();try{
      await readyTasks(container);act(()=>container.querySelector<HTMLButtonElement>('.task-health-title')!.click());await vi.waitFor(()=>expect(container.querySelectorAll('.process-record-button')).toHaveLength(2));
      expect(container.querySelector('.task-context-header')).not.toBeNull();expect(container.querySelector('.task-summary-bar')).not.toBeNull();expect(container.querySelector('.task-time-sticky')).not.toBeNull();expect(container.querySelector('.task-timeline-track')).not.toBeNull();
      const before=vi.mocked(fetch).mock.calls.length;await act(async()=>EventSourceStub.instances[0]!.emit('trace_links_changed',{sessionKeys:['s-1'],proxyIds:[1],truncated:false}));
      expect(vi.mocked(fetch).mock.calls).toHaveLength(before);expect(container.querySelectorAll('.process-record-button')).toHaveLength(2);
      const recordsBefore=vi.mocked(fetch).mock.calls.filter(([i])=>String(i).includes('/records?')).length;
      await act(async()=>EventSourceStub.instances[0]!.emit('sessions_changed',{keys:['s-1'],count:1}));
      expect(vi.mocked(fetch).mock.calls.filter(([i])=>String(i).includes('/records?'))).toHaveLength(recordsBefore);expect(container.textContent).toContain('有新记录');expect(container.querySelectorAll('.process-record-button')).toHaveLength(2);
      act(()=>container.querySelector<HTMLButtonElement>('.process-record-button')!.click());await vi.waitFor(()=>expect(container.textContent).toContain('SELECTED PUBLIC OUTPUT'));
      expect(vi.mocked(fetch).mock.calls.filter(([i])=>String(i).includes('/events/'))).toHaveLength(1);
    }finally{unmount();}
  });
});

describe('Compare 端到端（UI-TASKS 2 回归）', () => {
  it('Phase C real API shapes with unknown speed: task selectors, conclusions and reused process views remain readable', async () => {
    const speedWithNulls = {
      ttftMs: null, tps: null, tpotMs: null, e2eMs: 5000, turnGapMedianMs: null,
      pureInferenceMs: null, avgLlmResponseLatencyMs: null, avgLlmDurationMs: null,
      cacheHitRate: null, avgTokensPerCall: null, systemPromptTokensEstimate: null,
    };
    const detail = (id: string, events: unknown[], totalDurationMs: number, title: string) => ({
      session: {
        id,
        provider: id === 's-1' ? 'codex' : 'claude',
        sourceAgent: id === 's-1' ? 'Codex' : 'Claude',
        title,
        startedAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:01:00.000Z',
        status: 'success',
        cwd: '/tmp',
        messageCount: 3,
        eventCount: events.length,
        tokenUsage: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 100, total: 150 },
        costUsd: 0.01,
        systemPrompt: null,
        dataSource: 'scan',
        sourcePath: `/tmp/${id}.jsonl`,
        totalDurationMs,
        isSubagent: false,
      },
      events,
      mode: 'slim',
      eventTotal: events.length,
      eventOffset: 0,
      eventLimit: 2000,
      hasMore: false,
      pending: false,
    });
    const slimEvent = (id: string, sessionId: string, sequence: number, over: Record<string, unknown> = {}) => ({
      id,
      sessionId,
      sequence,
      kind: 'tool',
      phase: 'implement',
      title: 'Bash: npm test',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'error',
      actor: 'assistant',
      tool: 'Bash',
      tokens: null,
      error: 'timeout',
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      ...over,
    });
    const comparePayload = {
      left: detail('s-1', [
        slimEvent('e1', 's-1', 1),
        slimEvent('e2', 's-1', 2, { kind: 'file_write', phase: 'implement', title: 'Edit src/a.ts', status: 'success', tool: null, error: null }),
        slimEvent('e3', 's-1', 3, { kind: 'test', phase: 'verify', title: 'vitest run', status: 'success', tool: null, error: null }),
      ], 5000, 'fix build'),
      right: detail('s-2', [
        slimEvent('r1', 's-2', 1, { kind: 'llm', phase: 'implement', title: 'respond', status: 'success', tool: null, error: null }),
        slimEvent('r2', 's-2', 2, { kind: 'bash', phase: 'verify', title: 'npm test', status: 'success', tool: null, error: null }),
      ], 3000, 'refactor api'),
      speed: { left: { ...speedWithNulls, e2eMs: 5000 }, right: { ...speedWithNulls, e2eMs: 3000 } },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });
      if(url==='/api/task-comparison'){
        const selection=JSON.parse(String(init?.body)) as {a:string[];b:string[]};
        return json({a:selection.a.map(id=>TASK_FIXTURES.find(t=>t.id===id)),b:selection.b.map(id=>TASK_FIXTURES.find(t=>t.id===id))});
      }
      if(url.startsWith('/api/tasks?'))return taskResponse(url);
      if (url.includes('/api/compare')) {
        return json(comparePayload);
      }
      if (url.includes('/api/health')) {
        return json({ ok: true, schemaVersion: 1, uptimeMs: 1, dbSizeBytes: 1, walSizeBytes: 0 });
      }
      if (url.includes('/api/sessions')) {
        return json({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = renderApp();
    // 会话列表首帧拉取带 250ms 防抖（与既有用例一致）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const compareTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('对比'),
    );
    expect(compareTab).toBeDefined();
    await act(async () => {
      compareTab!.click();
      await import('./components/task/TaskComparison.js');
    });

    await vi.waitFor(()=>expect(container.querySelectorAll('.task-compare-picker [role=combobox]')).toHaveLength(2));
    act(()=>container.querySelectorAll<HTMLElement>('.task-compare-picker [role=combobox]')[0]!.click());
    await vi.waitFor(()=>expect(document.querySelectorAll('[role=option]')).toHaveLength(3));
    act(()=>document.querySelectorAll<HTMLButtonElement>('[role=option]')[0]!.click());
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    act(()=>container.querySelectorAll<HTMLElement>('.task-compare-picker .ui-multi-trigger')[1]!.click());
    await vi.waitFor(()=>expect(document.querySelectorAll('[role=option]')).toHaveLength(3));
    act(()=>document.querySelectorAll<HTMLButtonElement>('[role=option]')[1]!.click());
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    await vi.waitFor(()=>expect(container.querySelector('.compare-timelines')).not.toBeNull());
    expect(container.querySelector('.task-compare-conclusions')).not.toBeNull();
    expect(container.querySelector('.compare-tools')).not.toBeNull();
    expect(container.querySelector('.compare-token-usage')).toBeNull();expect(container.querySelectorAll('.compare-token-table tbody tr')).toHaveLength(4);expect([...container.querySelectorAll('.ui-card-header h2')].filter(n=>n.textContent==='过程对照')).toHaveLength(1);expect(container.querySelectorAll('.compare-timelines > .ui-card')).toHaveLength(2);
    expect(container.textContent).toContain('单样本，不能证明因果');
    expect(window.location.hash).toContain('a=collected%3As-1');expect(window.location.hash).toContain('b=collected%3As-2');
    expect(fetchMock.mock.calls.filter(([path])=>String(path)==='/api/compare')).toHaveLength(1);
    expect(container.textContent).not.toContain('COMPARE_FAILED');
    expect(container.textContent).not.toContain('NaN');
    expect(container.querySelector('.ui-error-boundary')).toBeNull();

  });
});

// ═══════════════════════════════════════════════════════════════════════════
// add-agent-team-observability §7.3 / §7.8 — team 视图入口 + URL restore + SSE
// ═══════════════════════════════════════════════════════════════════════════

describe('team 视图入口 + URL restore + SSE（§7.3 / §7.8）', () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
    // 强制清理前一个测试可能残留的 DOM 和 hash（team 测试对 hash 敏感）
    document.body.innerHTML = '';
    history.replaceState(null, '', '#');
    // 覆盖 fetch mock 处理 team + session + health API
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/team-runs')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ items: [], nextCursor: null, hasMore: false, total: 0 }),
          } as unknown as Response;
        }
        if (url.includes('/api/health')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, dbSizeBytes: 1, walSizeBytes: 1, sessionCount: 0, eventCount: 0 }),
          } as unknown as Response;
        }
        if (url.includes('/api/sessions')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({}) } as unknown as Response;
      }),
    );
  });

  afterEach(() => {
    history.replaceState(null, '', originalHash || '#/session');
  });

  it.each(['initial', 'hashchange'])('keeps the task mode experiment route separate from legacy teams: %s', async entry => {
    history.replaceState(null, '', entry === 'initial' ? '#/team-experiment' : '#/session');
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => {
        if (entry === 'hashchange') {
          history.replaceState(null, '', '#/team-experiment');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
        await import('./components/team-experiment/TeamExperimentCenter.js');
        await Promise.resolve();
      });
      expect(container.querySelector('.agent-folding-workbench')).not.toBeNull();
      expect(container.querySelector('.team-exp-center')).toBeNull();
      expect(container.querySelector('.team-shell')).toBeNull();
      expect(window.location.hash).toMatch(/^#\/team-experiment(?:\?|$)/);
      const paths = vi.mocked(fetch).mock.calls.map(([path]) => String(path));
      expect(paths.some(path => path.includes('/api/team-runs'))).toBe(false);
      expect(paths.some(path => path.includes('/api/team-experiments/demo'))).toBe(false);
    } finally { unmount(); }
  });

  it('§7.3 team nav 按钮已移除（UI 架构调整：Teams 页签移除，Sessions 改名为任务）', async () => {
    const { container, unmount } = renderAppWithUnmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    // 不应存在独立的 team 导航按钮
    const teamBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('团队'),
    );
    expect(teamBtn).toBeUndefined();
    act(() => { unmount(); });
  });

  it('§7.3 URL restore: #/team → team 视图', async () => {
    // 方案 A：先渲染 App（默认 session 视图），再用 hashchange 事件触发 team 视图。
    // 避免依赖 isInitialTeam（首帧 hash），防止 INITIAL_HASH 模块级常量被前序 compare 测试污染。
    const { container, unmount } = renderAppWithUnmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    // 用 hashchange 事件触发 team 视图，避免 INITIAL_HASH 污染
    act(() => {
      history.replaceState(null, '', '#/team');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(container.querySelector('.team-shell')).not.toBeNull();
    act(() => { unmount(); });
  });

  it('§7.8 team_runs_changed SSE → team 刷新（/api/team-runs 请求增加）', async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchCalls.push(url.split('?')[0] ?? url);
        if (url.includes('/api/team-runs')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ items: [], nextCursor: null, hasMore: false, total: 0 }),
          } as unknown as Response;
        }
        if (url.includes('/api/health')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, dbSizeBytes: 1, walSizeBytes: 1, sessionCount: 0, eventCount: 0 }),
          } as unknown as Response;
        }
        if (url.includes('/api/sessions')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({}) } as unknown as Response;
      }),
    );
    // 方案 A：先渲染 App（默认 session 视图），再用 hashchange 事件触发 team 视图。
    // 避免依赖 isInitialTeam（首帧 hash），防止 INITIAL_HASH 模块级常量被前序 compare 测试污染。
    const { container, unmount } = renderAppWithUnmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    // 用 hashchange 事件触发 team 视图（Teams 按钮已移除）
    act(() => {
      history.replaceState(null, '', '#/team');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(container.querySelector('.team-shell')).not.toBeNull();
    const listCallsBefore = fetchCalls.filter((c) => c === '/api/team-runs').length;
    expect(listCallsBefore).toBeGreaterThan(0);
    // 触发 team_runs_changed SSE 事件
    await act(async () => {
      EventSourceStub.instances.at(-1)?.emit('team_runs_changed', { runIds: [] });
      await new Promise((r) => setTimeout(r, 350));
    });
    const listCallsAfter = fetchCalls.filter((c) => c === '/api/team-runs').length;
    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
    act(() => { unmount(); });
  });
});

describe('Trajectory event pagination', () => {
  it('appends slim pages, prevents duplicate requests, and retries without losing loaded turns', async () => {
    let attempts=0,finish:((response:Response)=>void)|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);if(path.includes('/records?')){const q=new URL(path,'http://localhost').searchParams,base=taskPage('collected:s-1');if(q.get('offset')==='1'){attempts++;if(attempts===1)throw new Error('temporary page failure');return new Promise<Response>(r=>{finish=r;});}return apiResponse({...base,items:[base.items[0]],limit:1,hasMore:true});}return taskResponse(path);}));
    const {container,unmount}=renderAppWithUnmount();try{await readyTasks(container);act(()=>container.querySelector<HTMLButtonElement>('.task-health-title')!.click());await vi.waitFor(()=>expect(container.querySelectorAll('.process-record-button')).toHaveLength(1));
      const next=()=>container.querySelector<HTMLButtonElement>('.task-page-controls [aria-label="更新记录"]')!;
      await act(async()=>{next().click();});expect(container.textContent).toContain('temporary page failure');
      const retry=[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='重试读取')!;await act(async()=>{retry.click();retry.click();});expect(attempts).toBe(2);
      await act(async()=>finish!(apiResponse({...taskPage('collected:s-1'),items:[taskPage('collected:s-1').items[1]],offset:1,hasPrevious:true})));
      expect(container.querySelectorAll('.process-record-button')).toHaveLength(1);expect(container.textContent).toContain('Result 2');expect(container.textContent).not.toContain('temporary page failure');
      const pages=vi.mocked(fetch).mock.calls.map(([i])=>String(i)).filter(path=>path.includes('/records?')&&path.includes('offset=1'));expect(pages).toHaveLength(2);expect(pages.every(path=>path.includes('limit=200')&&path.includes('window=fixed'))).toBe(true);
    }finally{unmount();}
  });
});

it.each(['threshold','overview-threshold'])('Phase B review: %s opens and focuses its settings section without saving',async entry=>{
 const requests:Array<{path:string;method:string}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);requests.push({path,method:init?.method??'GET'});
  if(path==='/api/config/providers')return apiResponse({providers:Object.fromEntries(PROVIDER_KEYS.map(key=>[key,{key,enabled:true,path:'/fixture/'+key,label:key,sourceKind:'jsonl',watchStrategy:'chokidar',pollIntervalMs:0}])),traeKeyPath:null,prewarmRecent:0});
  if(path==='/api/config/alert-thresholds')return apiResponse(DEFAULT_ALERT_THRESHOLDS);
  if(path.startsWith('/api/task-kpis'))return apiResponse(OVERVIEW_FIXTURE);
  if(path.startsWith('/api/mission'))return apiResponse({meta:{range:'7d',generatedAt:'2026-10-31T00:00:00Z',tz:0,widgetCount:0,durationMs:0,stamp:'2026-10-31T00:00:00Z',cached:false},usage:{},quality:{},health:{}});
  if(path.startsWith('/api/tasks?'))return apiResponse({items:TASK_FIXTURES.map(t=>({...t,metrics:{durationMs:1000,toolCalls:1,errors:0,input:10,output:20,cacheRead:1,correctedTotal:31,promptInput:11,cacheHitRate:1/11,models:['test-model']}})),total:3,offset:0,limit:50,hasMore:false});
  return taskResponse(path);
 }));
 const {container,unmount}=renderAppWithUnmount();
 try{
  await readyTasks(container);
  if(entry==='overview-threshold')await navigateHash('#/overview');
  const selector=entry==='overview-threshold'?'[aria-label=配置阈值]':'.task-home-toolbar button';
  let button:HTMLButtonElement|undefined;
  for(let i=0;i<100&&!button;i++){button=[...container.querySelectorAll<HTMLButtonElement>(selector)].find(b=>b.textContent==='配置阈值'||b.getAttribute('aria-label')==='配置阈值');if(!button)await act(async()=>{await new Promise(r=>setTimeout(r,10));});}
  expect(button).toBeDefined();act(()=>button!.click());
  const section='alert-thresholds';
  for(let i=0;i<100&&!container.querySelector('#settings-'+section+' input');i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
  await act(async()=>{await new Promise(r=>setTimeout(r,30));});
  const input=container.querySelector<HTMLInputElement>('#settings-'+section+' input')!;expect(input).not.toBeNull();expect(document.activeElement).toBe(input);
  expect(container.querySelector<HTMLDetailsElement>('.settings-workbench details')!.open).toBe(true);
  expect(requests.some(r=>r.path.includes('model-pricing'))).toBe(false);
  expect(container.querySelector('.task-price-link')).toBeNull();
  expect(requests.some(r=>r.method==='PUT'||r.method==='POST')).toBe(false);
  expect(requests.filter(r=>r.path==='/api/config/providers')).toHaveLength(1);
 }finally{unmount();}
});

describe('Phase C first-paint deep links',()=>{
 it.each([
  ['#/compare?a=collected%3As-1&a=collected%3As-3&b=collected%3As-2&pa=collected%3As-3&pb=collected%3As-2',['collected:s-1','collected:s-3'],['collected:s-2'],'collected:s-3','collected:s-2',false],
  ['#/compare?compareImport=1',[],[],null,null,true],
  ['#/compare?left=s-1&right=s-2',['collected:s-1'],['collected:s-2'],null,null,false],
  ['#/task?a=collected%3As-1&b=collected%3As-2',['collected:s-1'],['collected:s-2'],null,null,false],
 ] as const)('preserves initial selection and refresh without a hashchange: %s',async(hash,a,b,pa,pb,imported)=>{
  const groups:Array<{a:string[];b:string[]}> = [],pairs:Array<{leftKey:string;rightKey:string}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);
   if(path==='/api/task-comparison'){
    const group=JSON.parse(String(init?.body)) as {a:string[];b:string[]};groups.push(group);
    return apiResponse({a:group.a.map(id=>TASK_FIXTURES.find(t=>t.id===id)),b:group.b.map(id=>TASK_FIXTURES.find(t=>t.id===id))});
   }
   if(path==='/api/compare'){pairs.push(JSON.parse(String(init?.body)) as typeof pairs[number]);return apiResponse(makeResult());}
   return taskResponse(path);
  }));
  history.replaceState(null,'',hash);
  // The module was imported before the deep link was installed. Mount and a
  // remount emulate direct entry + refresh; never dispatch hashchange here.
  const writes=vi.spyOn(history,'replaceState');
  for(let refresh=0;refresh<2;refresh++){
   const {container,unmount}=renderAppWithUnmount();
   try{
    await act(async()=>{await import('./components/task/TaskComparison.js');});
    await vi.waitFor(()=>expect(container.querySelectorAll('.task-compare-picker')).toHaveLength(2));
    const q=new URLSearchParams(window.location.hash.split('?')[1]);
    expect(window.location.hash.startsWith('#/compare')).toBe(true);
    expect(q.getAll('a')).toEqual(a);expect(q.getAll('b')).toEqual(b);expect(q.get('pa')).toBe(pa);expect(q.get('pb')).toBe(pb);
    expect(q.get('compareImport')).toBe(imported?'1':null);
    expect(container.querySelectorAll('.task-compare-picker .ui-card-header')[0]?.textContent).toContain(`${a.length}/40`);
    expect(container.querySelectorAll('.task-compare-picker .ui-card-header')[1]?.textContent).toContain(`${b.length}/40`);
    if(a.length)await vi.waitFor(()=>expect(groups.length).toBeGreaterThan(refresh));
    if(pa)await vi.waitFor(()=>expect(pairs.at(-1)).toEqual({leftKey:'s-3',rightKey:'s-2'}));
   }finally{unmount();}
  }
  for(const [, ,url] of writes.mock.calls){
   const q=new URLSearchParams(String(url).split('?')[1]);expect(q.getAll('a')).toEqual(a);expect(q.getAll('b')).toEqual(b);
   if(pa){expect(q.get('pa')).toBe(pa);expect(q.get('pb')).toBe(pb);}if(imported)expect(q.get('compareImport')).toBe('1');
  }
 });
});
