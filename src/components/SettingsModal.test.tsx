import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SettingsModal} from './SettingsModal.js';
import {PROVIDER_KEYS,type LocalSessionConfig} from '../core/trace-types.js';
import {api,ApiError} from '../api/client.js';
import {t} from '../i18n.js';

const cleanup:Array<()=>void>=[];
function config():LocalSessionConfig {
  return {providers:Object.fromEntries(PROVIDER_KEYS.map(key=>[key,{key,enabled:true,path:`/synthetic/${key}`,label:key,sourceKind:'jsonl',watchStrategy:'chokidar',pollIntervalMs:0}])) as LocalSessionConfig['providers'],traeKeyPath:'/synthetic/key',prewarmRecent:0};
}
function mount(node:React.ReactNode){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  act(()=>root.render(node));const stop=()=>{act(()=>root.unmount());host.remove();};cleanup.push(stop);
  return {host,render:(next:React.ReactNode)=>act(()=>root.render(next)),unmount:()=>{cleanup.splice(cleanup.indexOf(stop),1);stop();}};
}
const flush=async()=>{await act(async()=>{for(let i=0;i<6;i++)await Promise.resolve();});};
afterEach(()=>{while(cleanup.length)cleanup.pop()!();vi.restoreAllMocks();vi.useRealTimers();localStorage.clear();});
const button=(host:Element,text:string):HTMLButtonElement=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text)!;

describe('SettingsModal owned configuration workflow',()=>{
  it('uses the shared modal, traps focus and restores its trigger without saving',async()=>{
    const save=vi.fn(async()=>config());
    function Harness(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open settings</button>{open&&<SettingsModal locale="en" load={async()=>config()} save={save} onClose={()=>setOpen(false)}/>}</>;}
    const view=mount(<Harness/>);const trigger=view.host.querySelector<HTMLButtonElement>('button')!;
    act(()=>{trigger.focus();trigger.click();});await flush();
    const dialog=view.host.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();expect(dialog.contains(document.activeElement)).toBe(true);
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger);expect(save).not.toHaveBeenCalled();
  });

  it('default loads exactly once, and parent/locale rerenders do not overwrite an edited draft',async()=>{
    const read=vi.spyOn(api,'configProviders').mockResolvedValue(config());
    const view=mount(<SettingsModal locale="en" onClose={()=>undefined}/>);await flush();
    expect(read).toHaveBeenCalledTimes(1);
    const path=view.host.querySelector<HTMLInputElement>('[data-provider-path="codex"]')!;expect(path).not.toBeNull();
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(path,'/synthetic/new-codex');path.dispatchEvent(new Event('input',{bubbles:true}));});
    view.render(<SettingsModal locale="zh" onClose={()=>undefined}/>);await flush();
    expect(read).toHaveBeenCalledTimes(1);expect(view.host.querySelector<HTMLInputElement>('[data-provider-path="codex"]')?.value).toBe('/synthetic/new-codex');
  });

  it('load timeout aborts, rejects late data and retries only on an explicit action',async()=>{
    vi.useFakeTimers();let resolve!:(value:LocalSessionConfig)=>void;let signal:AbortSignal|undefined;
    const load=vi.fn((owner?:AbortSignal)=>{signal=owner;return new Promise<LocalSessionConfig>(done=>{resolve=done;});});
    const view=mount(<SettingsModal locale="en" load={load} onClose={()=>undefined}/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(signal?.aborted).toBe(true);expect(view.host.textContent).toContain('CONFIG_READ_TIMEOUT');expect(load).toHaveBeenCalledTimes(1);
    await act(async()=>{resolve(config());await Promise.resolve();});expect(view.host.querySelector('[data-provider-path]')).toBeNull();
    act(()=>button(view.host,t('settings.reload','en')).click());expect(load).toHaveBeenCalledTimes(2);
  });

  it('saving is explicit and single-flight, preserves all config fields and reports the returned snapshot',async()=>{
    const original=config();let done!:(value:LocalSessionConfig)=>void;
    const save=vi.fn((_value:unknown,_signal?:AbortSignal)=>new Promise<LocalSessionConfig>(resolve=>{done=resolve;}));
    const view=mount(<SettingsModal locale="en" load={async()=>original} save={save} onClose={()=>undefined}/>);await flush();
    const submit=button(view.host,'Save');expect(submit.disabled).toBe(true);
    act(()=>view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')!.click());
    act(()=>{submit.click();submit.click();});expect(save).toHaveBeenCalledTimes(1);
    const sent=save.mock.calls[0]![0] as LocalSessionConfig;
    expect(sent.providers.codex.enabled).toBe(false);expect(sent.providers.codearts).toEqual(original.providers.codearts);
    expect(sent.traeKeyPath).toBe(original.traeKeyPath);expect(sent.prewarmRecent).toBe(0);
    await act(async()=>{done(sent);await Promise.resolve();});expect(view.host.textContent).toContain(t('settings.saved','en'));expect(submit.disabled).toBe(true);
  });

  it('save rejection is visible, keeps the draft and never automatically repeats a write',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);
    const save=vi.fn(async()=>{throw new ApiError('BAD_REQUEST','synthetic failure',400);});
    const view=mount(<SettingsModal locale="en" load={async()=>config()} save={save} onClose={()=>undefined}/>);await flush();
    act(()=>view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')!.click());act(()=>button(view.host,'Save').click());await flush();
    expect(save).toHaveBeenCalledTimes(1);expect(view.host.textContent).toContain('BAD_REQUEST');
    expect(view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')?.checked).toBe(false);
  });

  it('an API read failure is explained as a read failure, never a save or retained-draft claim',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);const load=vi.fn(async()=>{throw new ApiError('SYNTHETIC_READ_ERROR','failure',500);});
    const view=mount(<SettingsModal locale="en" load={load} onClose={()=>undefined}/>);await flush();
    expect(view.host.textContent).toContain('SYNTHETIC_READ_ERROR');expect(view.host.textContent).toContain(t('settings.loadFailed','en'));expect(view.host.textContent).not.toContain(t('settings.saveFailed','en'));expect(load).toHaveBeenCalledTimes(1);
  });

  it('dirty close requires a deliberate discard, while keep-editing preserves the draft',async()=>{
    const close=vi.fn();const view=mount(<SettingsModal locale="en" load={async()=>config()} onClose={close}/>);await flush();
    act(()=>view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')!.click());
    act(()=>view.host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());expect(close).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain(t('settings.unsaved','en'));
    act(()=>button(view.host,t('settings.keepEditing','en')).click());expect(close).not.toHaveBeenCalled();
    expect(view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')?.checked).toBe(false);
    act(()=>view.host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());act(()=>button(view.host,t('settings.discard','en')).click());expect(close).toHaveBeenCalledTimes(1);
  });

  it('timed-out saving is an uncertain outcome and ignores a late success',async()=>{
    vi.useFakeTimers();let done!:(value:LocalSessionConfig)=>void;let signal:AbortSignal|undefined;
    const save=vi.fn((_value:unknown,owner?:AbortSignal)=>{signal=owner;return new Promise<LocalSessionConfig>(resolve=>{done=resolve;});});
    const view=mount(<SettingsModal locale="en" load={async()=>config()} save={save} onClose={()=>undefined}/>);await flush();
    act(()=>view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')!.click());act(()=>button(view.host,'Save').click());
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(signal?.aborted).toBe(true);expect(view.host.textContent).toContain(t('settings.uncertain','en'));
    expect(button(view.host,'Save').disabled).toBe(true);expect(save).toHaveBeenCalledTimes(1);
    await act(async()=>{done(config());await Promise.resolve();});expect(view.host.textContent).not.toContain(t('settings.saved','en'));
  });

  it('malformed configuration is an error, not a forever skeleton or an enabled save',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);
    const view=mount(<SettingsModal locale="en" load={async()=>({providers:null})} onClose={()=>undefined}/>);await flush();
    expect(view.host.textContent).toContain('CONFIG_RESPONSE_INVALID');expect(button(view.host,'Save').disabled).toBe(true);expect(view.host.querySelector('.ui-skeleton')).toBeNull();
  });

  it('closing a pending save requires confirmation and aborts only waiting on unmount',async()=>{
    let signal:AbortSignal|undefined;const save=vi.fn((_value:unknown,owner?:AbortSignal)=>{signal=owner;return new Promise(()=>undefined);});const close=vi.fn();
    const view=mount(<SettingsModal locale="en" load={async()=>config()} save={save} onClose={close}/>);await flush();
    act(()=>view.host.querySelector<HTMLInputElement>('[data-provider-enabled="codex"]')!.click());act(()=>button(view.host,'Save').click());
    act(()=>view.host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());expect(close).not.toHaveBeenCalled();expect(view.host.textContent).toContain(t('settings.closeSaving','en'));expect(signal?.aborted).toBe(false);
    act(()=>button(view.host,t('settings.closeWithoutRollback','en')).click());expect(close).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledTimes(1);view.unmount();expect(signal?.aborted).toBe(true);
  });
});
