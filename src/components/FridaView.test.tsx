import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FridaView} from './FridaView.js';
import {api,ApiError} from '../api/client.js';
import {t} from '../i18n.js';

const cleanup:Array<()=>void>=[];
const stopped={running:false,starting:false,pid:null};
const empty={items:[],nextCursor:null,hasMore:false};
const flush=async()=>{await act(async()=>{for(let i=0;i<6;i++)await Promise.resolve();});};
function mount(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);act(()=>root.render(<FridaView locale="en"/>));const stop=()=>{act(()=>root.unmount());host.remove();};cleanup.push(stop);return {host,render:()=>act(()=>root.render(<FridaView locale="zh"/>)),unmount:()=>{cleanup.splice(cleanup.indexOf(stop),1);stop();}};}
const button=(host:Element,key:Parameters<typeof t>[0]):HTMLButtonElement=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===t(key,'en'))!;
function reads(){vi.spyOn(api,'fridaStatus').mockResolvedValue(stopped);vi.spyOn(api,'fridaCaptures').mockResolvedValue(empty);}
afterEach(()=>{while(cleanup.length)cleanup.pop()!();vi.restoreAllMocks();vi.useRealTimers();});

describe('Frida experimental workflow',()=>{
  it('uses one status/history read, does not infer installation from empty history or start automatically',async()=>{
    reads();const start=vi.spyOn(api,'fridaStart');const view=mount();await flush();
    expect(api.fridaStatus).toHaveBeenCalledTimes(1);expect(api.fridaCaptures).toHaveBeenCalledTimes(1);expect(start).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain(t('frida.experimental','en'));expect(view.host.textContent).toContain(t('frida.empty','en'));
    expect(view.host.textContent).not.toContain('Frida not installed or no Trae target found');expect(button(view.host,'frida.start').disabled).toBe(true);
    view.render();await flush();expect(api.fridaStatus).toHaveBeenCalledTimes(1);expect(api.fridaCaptures).toHaveBeenCalledTimes(1);
  });

  it('requires explicit acknowledgement and a positive integer PID, preserving the explicit request',async()=>{
    reads();const start=vi.spyOn(api,'fridaStart').mockResolvedValue({running:false,starting:true,pid:123});const view=mount();await flush();
    const pid=view.host.querySelector<HTMLInputElement>('[data-frida-pid]')!,ack=view.host.querySelector<HTMLInputElement>('[data-frida-ack]')!;
    act(()=>ack.click());expect(button(view.host,'frida.start').disabled).toBe(false);
    for(const value of ['0','-1','1.5','1e3','9007199254740992']){act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(pid,value);pid.dispatchEvent(new Event('input',{bubbles:true}));});expect(button(view.host,'frida.start').disabled).toBe(true);expect(pid.getAttribute('aria-invalid')).toBe('true');}
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(pid,'123');pid.dispatchEvent(new Event('input',{bubbles:true}));});
    act(()=>{button(view.host,'frida.start').click();button(view.host,'frida.start').click();});await flush();
    expect(start).toHaveBeenCalledExactlyOnceWith(123,expect.any(AbortSignal));expect(view.host.textContent).toContain(t('frida.status.starting','en'));expect(api.fridaStatus).toHaveBeenCalledTimes(1);
  });

  it('status failure has a bounded explicit retry while successful history stays available',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);reads();vi.mocked(api.fridaStatus).mockRejectedValueOnce(new ApiError('SYNTHETIC_STATUS','failure',500));
    vi.mocked(api.fridaCaptures).mockResolvedValue({items:[{id:42,capturedAt:'2026-10-18T01:00:00.000Z',captureType:'synthetic-type',model:'synthetic-model'}],nextCursor:null,hasMore:false});
    const view=mount();await flush();expect(view.host.textContent).toContain('SYNTHETIC_STATUS');expect(view.host.textContent).toContain('synthetic-model');expect(button(view.host,'frida.start').disabled).toBe(true);
    act(()=>button(view.host,'frida.refreshStatus').click());await flush();expect(api.fridaStatus).toHaveBeenCalledTimes(2);expect(api.fridaCaptures).toHaveBeenCalledTimes(1);expect(view.host.textContent).not.toContain('SYNTHETIC_STATUS');
  });

  it('history failure does not relabel a known runtime as absent and retries only history',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);reads();vi.mocked(api.fridaCaptures).mockRejectedValueOnce(new ApiError('SYNTHETIC_HISTORY','failure',500));const view=mount();await flush();
    expect(view.host.textContent).toContain('SYNTHETIC_HISTORY');expect(view.host.textContent).toContain(t('frida.status.stopped','en'));
    act(()=>button(view.host,'frida.refreshHistory').click());await flush();expect(api.fridaStatus).toHaveBeenCalledTimes(1);expect(api.fridaCaptures).toHaveBeenCalledTimes(2);expect(view.host.textContent).not.toContain('SYNTHETIC_HISTORY');
  });

  it('times out a noncooperative status read and ignores its late result',async()=>{
    vi.useFakeTimers();reads();let resolve!:(v:typeof stopped)=>void;let signal:AbortSignal|undefined;
    vi.mocked(api.fridaStatus).mockImplementation(owner=>{signal=owner;return new Promise(done=>{resolve=done;});});const view=mount();await flush();
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(signal?.aborted).toBe(true);expect(view.host.textContent).toContain('FRIDA_READ_TIMEOUT');
    await act(async()=>{resolve(stopped);await Promise.resolve();});expect(view.host.textContent).toContain(t('frida.status.unknown','en'));expect(api.fridaStatus).toHaveBeenCalledTimes(1);
  });

  it('requires stop confirmation and restores focus when cancelled',async()=>{
    reads();vi.mocked(api.fridaStatus).mockResolvedValue({running:true,starting:false,pid:123});const stop=vi.spyOn(api,'fridaStop').mockResolvedValue(stopped);const view=mount();await flush();const trigger=button(view.host,'frida.stop');
    act(()=>{trigger.focus();trigger.click();});expect(stop).not.toHaveBeenCalled();expect(view.host.querySelector('[role="dialog"]')).not.toBeNull();
    act(()=>button(view.host,'common.cancel').click());expect(stop).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger);
    act(()=>trigger.click());act(()=>button(view.host,'frida.confirmStop').click());await flush();expect(stop).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));expect(view.host.textContent).toContain(t('frida.status.stopped','en'));
  });

  it('does not optimistically stop after a rejected command or automatically retry it',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);reads();vi.mocked(api.fridaStatus).mockResolvedValue({running:true,starting:false,pid:123});const stop=vi.spyOn(api,'fridaStop').mockRejectedValue(new ApiError('SYNTHETIC_STOP','failure',500));const view=mount();await flush();
    act(()=>button(view.host,'frida.stop').click());act(()=>button(view.host,'frida.confirmStop').click());await flush();
    expect(view.host.textContent).toContain('SYNTHETIC_STOP');expect(view.host.textContent).toContain(t('frida.uncertain','en'));expect(view.host.textContent).toContain(t('frida.status.unknown','en'));expect(stop).toHaveBeenCalledTimes(1);
  });

  it('action timeout cancels only local waiting, blocks repetition and ignores late success',async()=>{
    vi.useFakeTimers();reads();let resolve!:(v:typeof stopped)=>void;let signal:AbortSignal|undefined;
    const start=vi.spyOn(api,'fridaStart').mockImplementation((_pid,owner)=>{signal=owner;return new Promise(done=>{resolve=done;});});const view=mount();await flush();
    act(()=>view.host.querySelector<HTMLInputElement>('[data-frida-ack]')!.click());act(()=>button(view.host,'frida.start').click());
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(signal?.aborted).toBe(true);expect(view.host.textContent).toContain('FRIDA_ACTION_TIMEOUT');expect(view.host.textContent).toContain(t('frida.uncertain','en'));
    expect(button(view.host,'frida.start').disabled).toBe(true);await act(async()=>{resolve(stopped);await Promise.resolve();});expect(view.host.textContent).toContain(t('frida.status.unknown','en'));expect(start).toHaveBeenCalledTimes(1);
  });

  it('unmount aborts both owned reads without triggering an action',async()=>{
    const signals:AbortSignal[]=[];reads();vi.mocked(api.fridaStatus).mockImplementation(signal=>{signals.push(signal!);return new Promise(()=>undefined);});vi.mocked(api.fridaCaptures).mockImplementation(signal=>{signals.push(signal!);return new Promise(()=>undefined);});const start=vi.spyOn(api,'fridaStart');const view=mount();view.unmount();expect(signals).toHaveLength(2);expect(signals.every(s=>s.aborted)).toBe(true);expect(start).not.toHaveBeenCalled();
  });

  it('explicit wait cancellation is uncertain and does not send stop or repeat start',async()=>{
    reads();let signal:AbortSignal|undefined;const start=vi.spyOn(api,'fridaStart').mockImplementation((_pid,owner)=>{signal=owner;return new Promise(()=>undefined);});const stop=vi.spyOn(api,'fridaStop');const view=mount();await flush();
    act(()=>view.host.querySelector<HTMLInputElement>('[data-frida-ack]')!.click());act(()=>button(view.host,'frida.start').click());act(()=>button(view.host,'frida.cancelWait').click());
    expect(signal?.aborted).toBe(true);expect(view.host.textContent).toContain('FRIDA_WAIT_CANCELLED');expect(view.host.textContent).toContain(t('frida.uncertain','en'));expect(start).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();
  });

  it('invalid status/history responses remain errors with no fake stopped/empty state',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);reads();vi.mocked(api.fridaStatus).mockResolvedValue({} as Awaited<ReturnType<typeof api.fridaStatus>>);vi.mocked(api.fridaCaptures).mockResolvedValue({items:null} as unknown as Awaited<ReturnType<typeof api.fridaCaptures>>);const view=mount();await flush();
    expect(view.host.textContent).toContain('FRIDA_RESPONSE_INVALID');expect(view.host.textContent).toContain(t('frida.status.unknown','en'));expect(view.host.textContent).not.toContain(t('frida.empty','en'));expect(button(view.host,'frida.start').disabled).toBe(true);expect(view.host.querySelector('.ui-skeleton')).toBeNull();
  });
});

describe('Frida saved capture entry',()=>{
  it('live notifications remain separate from uncertain control state and locale/freshness changes perform no IO',async()=>{
    reads();const start=vi.spyOn(api,'fridaStart').mockRejectedValue(new ApiError('SYNTHETIC_START','failure',500));vi.spyOn(console,'error').mockImplementation(()=>undefined);
    const fetch=vi.spyOn(globalThis,'fetch');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    cleanup.push(()=>{act(()=>root.unmount());host.remove();});
    act(()=>root.render(<FridaView locale="en"/>));await flush();
    act(()=>host.querySelector<HTMLInputElement>('[data-frida-ack]')!.click());act(()=>button(host,'frida.start').click());await flush();
    expect(host.textContent).toContain(t('frida.uncertain','en'));
    act(()=>root.render(<FridaView locale="en" liveStatus={{running:true,pid:456}} savedNotifications={[{id:42}]} connected={false}/>));
    expect(host.textContent).toContain('PID 456');expect(host.textContent).toContain('notifications may be missing');
    expect(host.textContent).toContain(t('frida.uncertain','en'));expect(button(host,'frida.start').disabled).toBe(true);
    act(()=>root.render(<FridaView locale="zh" liveStatus={{running:false}} savedNotifications={[{id:42}]} connected/>));
    expect(host.textContent).toContain('进程停止');expect(host.textContent).toContain(t('frida.uncertain','zh'));
    expect(api.fridaStatus).toHaveBeenCalledTimes(1);expect(api.fridaCaptures).toHaveBeenCalledTimes(1);expect(start).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="打开新保存捕获 #42"]')).not.toBeNull();
  });
  it('opens exactly one full detail only on explicit saved row selection and refresh closes it',async()=>{
    reads();vi.mocked(api.fridaCaptures).mockResolvedValue({items:[{id:42,capturedAt:'2026-10-20T00:00:00.000Z',captureType:'chat',model:null}],nextCursor:null,hasMore:false});
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:42,pid:12,capturedAt:'2026-10-20T00:00:00.000Z',captureType:'chat',jsonData:'{"saved":true}',model:null,sessionId:null,captureSessionId:null,messageCount:null,tokens:null}),{headers:{'content-type':'application/json'}}));
    const view=mount();await flush();expect(fetch).not.toHaveBeenCalled();
    act(()=>view.host.querySelector<HTMLButtonElement>('[aria-label="Open capture #42"]')!.click());await flush();expect(fetch).toHaveBeenCalledTimes(1);expect(view.host.querySelector('pre')?.textContent).toBe('{"saved":true}');
    act(()=>button(view.host,'frida.refreshHistory').click());await flush();expect(view.host.querySelector('.frida-capture-inspector')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('pages explicitly and keeps window-rendered rows bounded without per-row detail IO',async()=>{
    reads();vi.mocked(api.fridaCaptures).mockResolvedValue({items:Array.from({length:50},(_,i)=>({id:i+1,capturedAt:'2026-10-20T00:00:00.000Z',captureType:'chat',model:null})),nextCursor:'["2026-10-20T00:00:00.000Z",1]',hasMore:true});
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({items:Array.from({length:50},(_,i)=>({id:i+51,capturedAt:'2026-10-19T00:00:00.000Z',captureType:'chat',model:null})),nextCursor:null,hasMore:false}),{headers:{'content-type':'application/json'}}));
    const view=mount();await flush();expect(view.host.querySelectorAll('tbody button').length).toBeLessThanOrEqual(40);expect(fetch).not.toHaveBeenCalled();
    act(()=>[...view.host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Load next page')!.click());await flush();expect(fetch).toHaveBeenCalledTimes(1);expect(String(fetch.mock.calls[0]?.[0])).toContain('limit=50');expect(view.host.querySelectorAll('tbody button').length).toBeLessThanOrEqual(40);
  });
});
