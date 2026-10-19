import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from './core/trace-types.js';
import {PROVIDER_KEYS} from './core/trace-types.js';
import type { SessionDetailResponse, TraceEvent, TraceEventSlim, TraceSession } from './core/trace-types.js';
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
      const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => /^(代理|Proxy)$/.test(node.textContent ?? ''))!;
      expect(tab).toBeDefined();act(() => tab.click());
      await act(async () => { await import('./components/ProxyView.js');await Promise.resolve(); });
      expect(paths.filter(path => path.includes('/proxy/')).sort()).toEqual(['/api/proxy/requests?limit=50', '/api/proxy/status']);
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
      if (path === '/api/compare') { pairs.push(JSON.parse(String(init?.body)) as { leftKey: string; rightKey: string });return new Promise<never>(() => undefined); }
      const body = path.includes('/agent-overview') ? { rows: [group('Group A'), group(matching ? 'Group B' : 'Not loaded')], stamp: '2026-10-18T00:00:00.000Z', cached: false }
        : path.includes('/sessions?') ? { items: indexed, total: indexed.length, hasMore: false, nextCursor: null } : { groups: [] };
      return { ok: true, text: async () => JSON.stringify(body) };
    }));
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await Promise.resolve();history.replaceState(null, '', '#/compare?left=s-3&right=s-2');window.dispatchEvent(new Event('hashchange'));await import('./components/CompareBoard.js'); });
      await act(async () => { for (let i = 0; i < 30 && pairs.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(pairs).toEqual([{ leftKey: 's-3', rightKey: 's-2' }]);
      act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => /Agent 概览|Agent Overview/.test(button.textContent ?? ''))!.click());
      await act(async () => { for (let i = 0; i < 30 && !container.querySelector('.overview tbody input'); i++) await new Promise(resolve => setTimeout(resolve, 10)); });
      const boxes = container.querySelectorAll<HTMLInputElement>('.overview tbody input');
      act(() => boxes[0]!.click());act(() => boxes[1]!.click());
      await act(async () => { container.querySelector<HTMLButtonElement>('.compare-float-btn')!.click();await Promise.resolve(); });
      expect(window.location.hash).toContain('left=s-1');
      if (matching) {
        expect(pairs).toEqual([{ leftKey: 's-3', rightKey: 's-2' }, { leftKey: 's-1', rightKey: 's-2' }]);
      } else {
        expect(pairs).toHaveLength(1);expect(window.location.hash).not.toContain('right=');
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
      const tab=[...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button=>button.textContent==='Frida')!;act(()=>tab.click());
      await act(async()=>{for(let i=0;i<30&&!paths.some(path=>path.endsWith('/frida/status'));i++)await new Promise(resolve=>setTimeout(resolve,10));});
      expect(paths.filter(path=>path.includes('/frida/')).sort()).toEqual(['/api/frida/captures','/api/frida/status']);
      expect(container.querySelector('[data-frida-ack]')).not.toBeNull();expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    } finally {unmount();}
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
      const tab=[...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button=>/Agent 概览|Agent Overview/.test(button.textContent??''))!;
      expect(tab).toBeDefined();act(()=>tab.click());
      await act(async()=>{for(let i=0;i<30&&!paths.some(path=>path.includes('/agent-overview'));i++)await new Promise(resolve=>setTimeout(resolve,10));});
      expect(paths.filter(path=>path.includes('/agent-overview'))).toHaveLength(1);
      expect(paths.filter(path=>/\/sessions\/[^?]/.test(path))).toHaveLength(0);
      expect(container.querySelector('[role="tablist"]')).not.toBeNull();
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
  return container;
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
  return { container, unmount: () => act(() => { root.unmount(); appRoots.delete(root); }) };
}

beforeEach(() => {
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
      if(path==='/api/compare')return Promise.resolve({ok:true,text:async()=>JSON.stringify(pair)}as Response);
      if(path.includes('/api/session-groups'))return Promise.resolve({ok:true,text:async()=>JSON.stringify({groups:[]})}as Response);
      if(path.includes('/api/sessions/s-1?'))return Promise.resolve({ok:true,text:async()=>JSON.stringify(selected)}as Response);
      return fallback(input,init);
    });
    vi.stubGlobal('fetch',fetcher);recordCache.clear();eventDetailCache.clear();recordCache.set('s-1:slim',cached);
    const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{history.replaceState(null,'','#/compare?left=s-1&right=s-2');window.dispatchEvent(new Event('hashchange'));await import('./components/CompareBoard.js');});
      await act(async()=>{for(let i=0;i<30&&!container.querySelector('.cmp-run-evidence');i++)await new Promise(resolve=>setTimeout(resolve,10));});
      const left=container.querySelector('.cmp-evidence-side')!;
      act(()=>left.querySelector('summary')!.click());
      await act(async()=>{left.querySelector<HTMLButtonElement>('.cmp-evidence-errors button')!.click();for(let i=0;i<10;i++)await Promise.resolve();});
      expect(fetcher.mock.calls.filter(([path])=>String(path).includes('/api/sessions/s-1?')&&String(path).includes('limit=5000'))).toHaveLength(1);
      expect(container.querySelector('.session-toolbar-id')?.textContent).toBe('s-1');
      expect(container.querySelector('.record-inspector')?.textContent).toContain('beyond-first-page');
      expect(container.querySelector('.record-inspector')?.textContent).toContain('SYNTHETIC_SELECTED_ERROR');
    } finally {unmount();recordCache.clear();eventDetailCache.clear();history.replaceState(null,'',previousUrl);}
  });
  it('WB-002: switching runs clears the previous Turn and event focus, even when event IDs repeat', async () => {
    const previousUrl=window.location.href;
    const detailFor=(id:string):SessionDetailResponse=>({session:makeSession(id,{eventCount:2}),
      events:[1,2].map(sequence=>({...makeEvent(makeMessage(`shared-${sequence}`,sequence,{role:'assistant',kind:'llm',tool:null,hasInput:false,hasOutput:false,hasRaw:false})),sessionId:id})),
      mode:'slim',eventTotal:2,eventOffset:0,eventLimit:2000,hasMore:false,pending:false});
    const original=fetch;
    vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);
      if(path.includes('/api/session-groups')) return Promise.resolve({ok:true,text:async()=>JSON.stringify({groups:[]})} as Response);
      if(path.includes('/api/sessions/s-1?')||path.includes('/api/sessions/s-2?')) return Promise.resolve({ok:true,text:async()=>JSON.stringify(detailFor(path.includes('s-1?')?'s-1':'s-2'))} as Response);
      return original(input,init);
    }));
    recordCache.clear(); eventDetailCache.clear();
    const {container,unmount}=renderAppWithUnmount();
    try {
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
      await act(async()=>{(container.querySelectorAll('.session-row')[0] as HTMLElement).click();await Promise.resolve();});
      await act(async()=>{(container.querySelector('.app-header-search') as HTMLButtonElement).click();await import('./components/CommandPalette.js');});
      const input=container.querySelector('[role="dialog"] input') as HTMLInputElement;
      act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'/goto 2');input.dispatchEvent(new Event('input',{bubbles:true}));});
      await act(async()=>{(container.querySelector('.palette-row') as HTMLButtonElement).click();await Promise.resolve();});
      expect(container.querySelector('.record-inspector')).not.toBeNull();
      expect(window.location.hash).toContain('turn=2');
      act(()=>(container.querySelector('[aria-label="关闭记录证据"]') as HTMLButtonElement).click());
      await act(async()=>{(container.querySelector('.app-header-search') as HTMLButtonElement).click();await Promise.resolve();});
      const repeat=container.querySelector('[role="dialog"] input') as HTMLInputElement;
      act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(repeat,'/goto 2');repeat.dispatchEvent(new Event('input',{bubbles:true}));});
      await act(async()=>{(container.querySelector('.palette-row') as HTMLButtonElement).click();await Promise.resolve();});
      expect(container.querySelector('.record-inspector')).not.toBeNull();
      await act(async()=>{(container.querySelectorAll('.session-row')[1] as HTMLElement).click();await Promise.resolve();});
      expect(container.querySelector('.session-toolbar-id')?.textContent).toBe('s-2');
      expect(container.querySelector('.record-inspector')).toBeNull();
      expect(container.querySelector('.turn-row-on')).toBeNull();
      expect(window.location.hash).not.toContain('turn=');
    } finally {unmount();history.replaceState(null,'',previousUrl);}
  });
  it('WB-002: first paint is loading, not an empty successful list', () => {
    const { container, unmount } = renderAppWithUnmount();
    try {
      expect(container.querySelector('.rail .ui-empty')).toBeNull();
      expect(container.querySelector('.rail [role="status"]')).not.toBeNull();
    } finally { unmount(); }
  });

  it('WB-002: slash can reopen a collapsed list and focus its search field', () => {
    const previous = localStorage.getItem(LAYOUT_KEYS.railCollapsed);
    localStorage.setItem(LAYOUT_KEYS.railCollapsed, 'true');
    const { container, unmount } = renderAppWithUnmount();
    try {
      expect(container.querySelector('.session-filters input')).toBeNull();
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(container.querySelector('.session-filters input'));
      expect(container.querySelector('.session-filters input')).not.toBeNull();
    } finally {
      unmount();
      if (previous === null) localStorage.removeItem(LAYOUT_KEYS.railCollapsed);
      else localStorage.setItem(LAYOUT_KEYS.railCollapsed, previous);
    }
  });

  it('WB-002: a late old search response cannot replace a newer result or its URL scope', async () => {
    type Result = { ok: boolean; text: () => Promise<string> };
    const result = (items: SessionIndexEntry[]): Result => ({ ok: true, text: async () => JSON.stringify({ items, total: items.length, hasMore: false, nextCursor: null }) });
    let finishOld: ((value: Result) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes('/api/sessions?') && !path.includes('q=')) return new Promise<Result>(resolve => { finishOld = resolve; });
      if (path.includes('/api/sessions?') && path.includes('q=LATEST')) return Promise.resolve(result([{ ...THREE_SESSIONS[1]!, title: 'LATEST query result' }]));
      return Promise.resolve({ ok: true, text: async () => '{}' });
    }));
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
      expect(finishOld).toBeDefined();
      const search = container.querySelector('.session-filters input') as HTMLInputElement;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'LATEST');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
      expect(container.querySelector('.session-row-title')?.textContent).toBe('LATEST query result');
      await act(async () => { finishOld!(result([{ ...THREE_SESSIONS[0]!, title: 'STALE initial query' }])); });
      expect(container.textContent).not.toContain('STALE initial query');
      expect(container.querySelector('.session-row-title')?.textContent).toBe('LATEST query result');
      expect(window.location.hash).toContain('q=LATEST');
      expect(container.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('false');
    } finally { unmount(); }
  });

  it('WB-002: the Tasks-scoped Team link reaches existing runs while global navigation stays at six views', async () => {
    const previousUrl = window.location.href;
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/api/team-runs')
      ? Promise.resolve({ ok: true, text: async () => JSON.stringify({ items: [], total: 0, hasMore: false, nextCursor: null }) } as Response)
      : originalFetch(input, init)));
    const { container, unmount } = renderAppWithUnmount();
    try {
      const entry = container.querySelector('.rail a[href="#/team"]') as HTMLAnchorElement;
      expect(entry).not.toBeNull();
      expect(container.querySelectorAll('.view-tabs [role="tab"]')).toHaveLength(6);
      expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/team-runs'))).toHaveLength(0);
      await act(async () => { entry.click(); await import('./components/team/TeamShell.js'); });
      expect(container.querySelector('.team-shell')).not.toBeNull();
      expect(window.location.hash).toMatch(/^#\/team/);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/team-runs'))).toHaveLength(1);
      expect(vi.mocked(fetch).mock.calls.some(([input]) => /\/api\/team-runs\/[^/?]+/.test(String(input)))).toBe(false);
    } finally { unmount(); history.replaceState(null, '', previousUrl); }
  });

  it('WB-001: visible global search opens the real lazy palette without detail fan-out and restores focus', async () => {
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      const before = vi.mocked(fetch).mock.calls.length;
      const trigger = container.querySelector('.app-header-search') as HTMLButtonElement;
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
      expect(paths).toHaveLength(1);
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
    const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) });
    type Result = ReturnType<typeof response>;
    let finishPatch: ((result: Result) => void) | undefined;
    let finishDetail: ((result: Result) => void) | undefined;
    recordCache.clear();
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes('keys=')) return new Promise<Result>(resolve => { finishPatch = resolve; });
      if (path.includes('/api/sessions/s-1?')) return new Promise<Result>(resolve => { finishDetail = resolve; });
      if (path.includes('/api/sessions?')) return Promise.resolve(response({ items: THREE_SESSIONS, total: 3, hasMore: false, nextCursor: null }));
      return Promise.resolve(response({}));
    }));
    const { container, unmount } = renderAppWithUnmount();
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      act(() => (container.querySelector('.session-row') as HTMLElement).click());
      act(() => EventSourceStub.instances[0]!.emit('sessions_changed', { keys: ['s-1'], count: 1 }, 'old:1'));
      expect(finishPatch).toBeDefined(); expect(finishDetail).toBeDefined();
      await act(async () => EventSourceStub.instances[0]!.emit('connected', { resume: 'reset' }, 'old:1'));
      await act(async () => {
        finishPatch!(response({ items: [{ ...THREE_SESSIONS[0], title: 'STALE EPOCH TITLE' }], hasMore: false, nextCursor: null }));
        finishDetail!(response({ session: { id: 's-1' }, events: [], hasMore: false }));
      });
      expect(container.textContent).not.toContain('STALE EPOCH TITLE');
      expect(recordCache.get('s-1:slim')).toBeUndefined();
      expect(container.querySelector('.session-toolbar')).toBeNull();
    } finally { unmount(); }
  });
  it('1.1 启动后直接切 compare：两个选择器各含全部 3 个会话', async () => {
    const container = renderApp();
    await act(async () => {
      // 会话列表首帧拉取带 250ms 防抖（服务端过滤），等它完成
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const compareTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('对比'),
    );
    expect(compareTab).toBeDefined();
    await act(async () => {
      compareTab!.click();
      await import('./components/CompareBoard.js');
    });

    // REQ-019：MUST NOT 用原生 select（7.1）——选择器是 Popover 搜索按钮
    expect(container.querySelectorAll('select')).toHaveLength(0);
    const pickers = Array.from(container.querySelectorAll('.compare-picker'));
    expect(pickers).toHaveLength(2);
    act(() => (pickers[0] as HTMLButtonElement).click());
    const items = Array.from(container.querySelectorAll('.compare-picker-item'));
    expect(items.length).toBe(3);
    const titles = items.map((el) => el.textContent ?? '');
    expect(titles.some((t) => t.includes('fix build'))).toBe(true);
    expect(titles.some((t) => t.includes('refactor api'))).toBe(true);
    expect(titles.some((t) => t.includes('debug login'))).toBe(true);
  });

  it('REQ-023：/api/health 只请求一次，不轮询', async () => {
    const container = renderApp();
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
    container.remove();
  });

  it('会话视图 IA：粘性工具条 + findings 折叠 + turn 表面（统计条 + 色带 + 回合列表）', async () => {
    const sessionDetail: SessionDetailResponse = {
      session: {
        id: 's-1',
        provider: 'codex',
        sourceAgent: 'Codex',
        title: 'fix build',
        startedAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:01:00.000Z',
        status: 'success',
        cwd: '/tmp',
        messageCount: 2,
        eventCount: 2,
        tokenUsage: {
          input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2, netInput: 7, total: 38,
        },
        costUsd: 0.01,
        systemPrompt: null,
        dataSource: 'scan',
        sourcePath: '/tmp/s-1.jsonl',
        totalDurationMs: 1000,
        isSubagent: false,
      } satisfies TraceSession,
      events: [
        {
          id: 'e1', sessionId: 's-1', sequence: 1, turnKey: null, kind: 'llm', phase: 'implement',
          title: 'step one', startedAt: '2026-08-05T00:00:00.000Z', durationMs: 100,
          status: 'success', actor: 'assistant', tool: null, tokens: null, error: null,
          hasInput: true, hasOutput: false, hasRaw: false,
        },
        {
          id: 'e2', sessionId: 's-1', sequence: 2, turnKey: null, kind: 'llm', phase: 'debug',
          title: 'step two', startedAt: '2026-08-05T00:00:05.000Z', durationMs: 50,
          status: 'error', actor: 'assistant', tool: null, tokens: null, error: 'boom',
          hasInput: false, hasOutput: true, hasRaw: false,
        },
      ] satisfies TraceEventSlim[],
      mode: 'slim',
      eventTotal: 2,
      eventOffset: 0,
      eventLimit: 2,
      hasMore: false,
      pending: false,
    };
    const okJson = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      }) as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/session-groups')) {
          return okJson({ groups: [] });
        }
        if (url.includes('/api/sessions/s-1/events/')) {
          return okJson({ ...sessionDetail.events[0], inputSummary: null, outputSummary: 'step one' });
        }
        if (url.includes('/api/sessions/s-1/team-run')) {
          return okJson({ runIds: [] });
        }
        if (url.includes('/api/sessions/s-1/capture-links')) {
          return okJson({ sessionKey: 's-1', items: [], confirmedCount: 0, candidateCount: 0, nextCursor: null, hasMore: false });
        }
        if (url.includes('/api/sessions/s-1/parents')) {
          return okJson({ sessionKey: 's-1', items: [{ identity: { id: 'a'.repeat(64), source: 'scan', sourceKey: 's-1', namespace: 'agent:codex', kind: 'parent_session', value: 'parent-native', scope: 'child-native', eventId: null, sourcePath: 'session_meta.payload.parent_thread_id' },
            state: 'resolved', matches: [{ id: 's-2', provider: 'claude', sourceAgent: 'Claude', title: 'Synthetic resolved owner', startedAt: '2026-08-02T00:00:00.000Z' }], matchesTruncated: false }],
            nextCursor: null, hasMore: false, completeness: { complete: true, omittedCount: 0, reasons: [] } });
        }
        if (url.includes('/api/sessions/s-1')) {
          return okJson(sessionDetail);
        }
        if (url.includes('/api/sessions?')) {
          return okJson({ items: THREE_SESSIONS, nextCursor: null, hasMore: false, total: 3 });
        }
        if (url.includes('/api/health')) {
          return okJson({ ok: true, dbSizeBytes: 1, walSizeBytes: 1 });
        }
        return okJson({});
      }),
    );

    const container = renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const rows = Array.from(container.querySelectorAll('.session-row'));
    expect(rows.length).toBe(3);
    act(() => (rows[0] as HTMLElement).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.session-toolbar')).not.toBeNull();
    expect(container.querySelector('.session-toolbar-title')?.textContent).toContain('fix build');
    expect(container.querySelector('.session-findings-panel')).not.toBeNull();
    // 单行等宽回合导航；统计与分析在正文下方按需展开。
    expect(container.querySelector('.gantt-wrap')).toBeNull();
    expect(container.querySelector('.timeline-phase-axis')).toBeNull();
    expect(container.querySelector('.trajectory-pane')).not.toBeNull();
    expect(container.querySelector('.trajectory-statbar')).not.toBeNull();
    expect(container.querySelectorAll('.trajectory-overview')).toHaveLength(1);
    expect(container.querySelector('.trajectory-overview .session-signals')).toBeNull();
    expect(container.querySelector('.turn-navigation')).toBeNull();
    expect(container.querySelector('.session-summary')).toBeNull();
    expect(container.querySelector('.turn-ribbon')).toBeNull();
    expect(container.querySelector('.turn-navigator')).not.toBeNull();
    expect(container.querySelector('.turn-list')).not.toBeNull();
    // llm_boundary：两个 llm 事件 → 两个回合行
    expect(container.querySelectorAll('.turn-row').length).toBe(2);
    // 点击第一行展开 → 消息卡出现（assistant 卡）
    act(() => {
      (container.querySelector('.turn-row') as HTMLButtonElement).click();
    });
    expect(container.querySelectorAll('.message-card').length).toBeGreaterThan(0);
    expect(container.querySelector('.message-card-role-assistant')).not.toBeNull();

    // D16：detail 打开 = slim；不逐回合/逐消息拉取
    const fetchMock = vi.mocked(fetch);
    const detailCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes('/api/sessions/s-1') && !url.includes('events/') && !url.includes('team-run');
    });
    expect(detailCalls).toHaveLength(1);

    const callsBeforeLinks = fetchMock.mock.calls.length;
    await act(async () => {
      EventSourceStub.instances.at(-1)?.emit('trace_links_changed', { sessionKeys: ['s-1'], proxyIds: [1], truncated: false });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetchMock.mock.calls).toHaveLength(callsBeforeLinks);
    expect(container.querySelectorAll('.turn-row')).toHaveLength(2);

    // Another native owner can make the open child's exact parent ambiguous.
    // Invalidate locally before the batched index read; never re-read parents.
    await act(async () => {
      const details = [...container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent === '关联 Trace')!;
      details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    await act(async () => { [...container.querySelectorAll('button')].find(node => node.textContent === '原生父会话引用')!.click(); await import('./components/NativeSessionParentsPanel.js'); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-native-parent-reference]')!.click(); });
    expect(container.textContent).toContain('Synthetic resolved owner');
    const parentReads = fetchMock.mock.calls.filter(([input]) => String(input).includes('/parents')).length;
    expect(parentReads).toBe(1);
    await act(async () => {
      EventSourceStub.instances.at(-1)!.emit('sessions_changed', { keys: ['s-2'], count: 1 });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('父级依据已变化');
    expect(container.textContent).not.toContain('Synthetic resolved owner');
    expect([...container.querySelectorAll('button')].some(node => node.textContent === '打开已解析父级会话')).toBe(false);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/parents'))).toHaveLength(1);

    sessionDetail.events.push({
      id: 'e3', sessionId: 's-1', sequence: 3, turnKey: null, kind: 'llm', phase: 'implement',
      title: 'live update', startedAt: '2026-08-05T00:00:06.000Z', durationMs: 10,
      status: 'success', actor: 'assistant', tool: null, tokens: null, error: null,
      hasInput: false, hasOutput: true, hasRaw: false,
      inputSummary: null, outputSummary: 'live update',
    });
    sessionDetail.eventTotal = 3;
    sessionDetail.session.eventCount = 3;
    await act(async () => {
      EventSourceStub.instances.at(-1)?.emit('sessions_changed', { keys: ['s-1'], count: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // SSE 后 detail 刷新 → 第三个回合行出现
    expect(container.querySelectorAll('.turn-row').length).toBe(3);
    container.remove();
  });
});

describe('Compare 端到端（UI-TASKS 2 回归）', () => {
  it('真实 API 形状（speed 含 null）：切对比 → 选左右会话 → verdict/speed/charts 渲染且不崩溃', async () => {
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });
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
      await import('./components/CompareBoard.js');
    });

    act(() => {
      (container.querySelectorAll('.compare-picker')[0] as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const leftItems = container.querySelectorAll('.compare-picker-item');
    expect(leftItems.length).toBeGreaterThan(0);
    act(() => {
      (leftItems[0] as HTMLButtonElement).click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    act(() => {
      (container.querySelectorAll('.compare-picker')[1] as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const rightItems = container.querySelectorAll('.compare-picker-item');
    act(() => {
      (rightItems[1] as HTMLButtonElement).click();
    });

    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (container.querySelector('.compare-verdict') !== null) {
          break;
        }
      }
    });

    expect(container.querySelector('.compare-verdict')).not.toBeNull();
    expect(container.querySelector('.compare-speed-grid')).not.toBeNull();
    expect(container.querySelector('.compare-charts')).not.toBeNull();
    expect(container.textContent).not.toContain('COMPARE_FAILED');
    expect(container.textContent).not.toContain('NaN');
    expect(container.querySelector('.ui-error-boundary')).toBeNull();
    container.remove();
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
    window.location.hash = originalHash;
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
    const event = (sequence: number): TraceEventSlim => ({
      id: `paged-${sequence}`, sessionId: 'page-only', sequence, turnKey: `turn-${sequence}`,
      kind: 'llm', phase: 'implement', title: `page ${sequence}`,
      startedAt: '2026-08-05T00:00:00.000Z', durationMs: 10,
      status: 'success', actor: 'assistant', tool: null, tokens: null, error: null,
      hasInput: false, hasOutput: true, hasRaw: false,
    });
    const first: SessionDetailResponse = {
      session: {
        ...THREE_SESSIONS[0]!, id: 'page-only', systemPrompt: null, isSubagent: false,
        tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 0 },
        totalDurationMs: 30,
      },
      events: [event(1)], mode: 'slim', eventTotal: 2, eventOffset: 0,
      eventLimit: 1, hasMore: true, pending: false,
    };
    const json = (body: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response;
    let attempts = 0;
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sessions/page-only?')) {
        if (!url.includes('offset=')) return json(first);
        attempts += 1;
        if (attempts === 1) throw new Error('temporary page failure');
        return new Promise<Response>((resolve) => { finish = resolve; });
      }
      if (url.includes('/api/sessions?')) return json({ items: [{ ...THREE_SESSIONS[0]!, id: 'page-only' }], hasMore: false, total: 1, nextCursor: null });
      if (url.includes('/api/session-groups')) return json({ groups: [] });
      if (url.includes('/api/health')) return json({ ok: true, dbSizeBytes: 1, walSizeBytes: 1 });
      return json({});
    }));
    const { container, unmount } = renderAppWithUnmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    act(() => (container.querySelector('.session-row') as HTMLElement).click());
    await act(async () => { await Promise.resolve(); });
    const more = (): HTMLButtonElement => container.querySelector('.turn-list-banner button')!;
    expect(container.querySelectorAll('.turn-row')).toHaveLength(1);
    await act(async () => { more().click(); });
    expect(container.querySelector('.turn-list-banner')?.textContent).toContain('temporary page failure');
    expect(container.querySelectorAll('.turn-row')).toHaveLength(1);
    await act(async () => { more().click(); more().click(); });
    expect(attempts).toBe(2);
    expect(more().disabled).toBe(true);
    await act(async () => { finish!(json({ ...first, events: [event(2)], eventOffset: 1, hasMore: false })); });
    expect(container.querySelectorAll('.turn-row')).toHaveLength(2);
    expect(container.querySelector('.turn-list-banner')).toBeNull();
    const pages = vi.mocked(fetch).mock.calls.map((call) => String(call[0])).filter((url) => url.includes('offset='));
    expect(pages).toHaveLength(2);
    expect(pages.every((url) => url.includes('mode=slim') && url.includes('offset=1') && url.includes('limit=2000'))).toBe(true);
    unmount();
  });
});
