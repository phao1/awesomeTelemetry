import {useCallback,useEffect,useRef,useState} from 'react';
import {t,type Locale} from '../i18n.js';
import {PROVIDER_KEYS,type LocalSessionConfig,type ProviderKey} from '../core/trace-types.js';
import {api,ApiError} from '../api/client.js';
import {Skeleton} from './ui/States.js';
import {Modal} from './ui/Modal.js';
import {isDesensitizationEnabled,setDesensitizationEnabled} from './inspector-text.js';

export interface SettingsModalProps {
  locale:Locale;onClose:()=>void;
  load?:(signal?:AbortSignal)=>Promise<unknown>;
  save?:(config:unknown,signal?:AbortSignal)=>Promise<unknown>;
}
const defaultLoad=(signal?:AbortSignal):Promise<unknown>=>api.configProviders(signal);
const defaultSave=(config:unknown,signal?:AbortSignal):Promise<unknown>=>api.saveConfigProviders(config,signal);
function validConfig(value:unknown):value is LocalSessionConfig {
  if(typeof value!=='object'||value===null)return false;
  const record=value as Record<string,unknown>;
  if(typeof record.providers!=='object'||record.providers===null||!Number.isFinite(record.prewarmRecent)
    ||!(record.traeKeyPath===null||typeof record.traeKeyPath==='string'))return false;
  return PROVIDER_KEYS.every(key=>{
    const provider=(record.providers as Record<string,unknown>)[key];
    if(typeof provider!=='object'||provider===null)return false;
    const item=provider as Record<string,unknown>;
    return item.key===key&&typeof item.enabled==='boolean'&&typeof item.path==='string'&&typeof item.label==='string'
      &&typeof item.sourceKind==='string'&&['jsonl','json','sqlite','sqlcipher','otel'].includes(item.sourceKind)
      &&(item.watchStrategy==='chokidar'||item.watchStrategy==='poll')&&Number.isFinite(item.pollIntervalMs);
  });
}
interface Operation {kind:'load'|'save';controller:AbortController;timer:ReturnType<typeof setTimeout>}

/** Settings edits only the existing local scanner contract; never launches an Agent. */
export function SettingsModal({locale,onClose,load=defaultLoad,save=defaultSave}:SettingsModalProps):React.JSX.Element {
  const [draft,setDraft]=useState<LocalSessionConfig|null>(null),[baseline,setBaseline]=useState<LocalSessionConfig|null>(null);
  const [busy,setBusy]=useState<'load'|'save'|null>('load'),[error,setError]=useState<string|null>(null);
  const [errorKind,setErrorKind]=useState<'load'|'save'>('load');
  const [saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
  const [prompt,setPrompt]=useState<'close'|'reload'|null>(null);
  const [desensitize,setDesensitize]=useState(isDesensitizationEnabled);
  const loadRef=useRef(load),saveRef=useRef(save),closeRef=useRef(onClose);
  const owner=useRef<Operation|null>(null),keepRef=useRef<HTMLButtonElement|null>(null),returnRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{loadRef.current=load;saveRef.current=save;closeRef.current=onClose;},[load,save,onClose]);
  const cancel=useCallback(()=>{const active=owner.current;owner.current=null;if(active){clearTimeout(active.timer);active.controller.abort();}},[]);
  const dirty=draft!==null&&JSON.stringify(draft)!==JSON.stringify(baseline);
  const run=useCallback(async(kind:'load'|'save',value?:LocalSessionConfig)=>{
    if(kind==='save'&&owner.current!==null)return;
    cancel();setError(null);setErrorKind(kind);setSaved(false);setBusy(kind);
    if(kind==='load'){setDraft(null);setBaseline(null);}
    const controller=new AbortController();
    const active:Operation={kind,controller,timer:setTimeout(()=>{
      if(owner.current!==active)return;
      owner.current=null;controller.abort();setBusy(null);setError(kind==='load'?'CONFIG_READ_TIMEOUT':'CONFIG_SAVE_TIMEOUT');
      if(kind==='save')setUncertain(true);
    },kind==='load'?5000:10000)};
    owner.current=active;
    try {
      const response=await(kind==='load'?loadRef.current(controller.signal):saveRef.current(value,controller.signal));
      if(owner.current!==active)return;
      if(!validConfig(response))throw new Error('CONFIG_RESPONSE_INVALID');
      setDraft(response);setBaseline(response);setUncertain(false);setSaved(kind==='save');
    } catch(caught) {
      if(owner.current!==active)return;
      console.error('[settings] '+kind+' failed',caught);
      setError(caught instanceof ApiError?caught.code:caught instanceof Error&&caught.message==='CONFIG_RESPONSE_INVALID'?'CONFIG_RESPONSE_INVALID':kind==='load'?'CONFIG_LOAD_FAILED':'CONFIG_SAVE_FAILED');
      if(kind==='save'&&!(caught instanceof ApiError))setUncertain(true);
    } finally {clearTimeout(active.timer);if(owner.current===active){owner.current=null;setBusy(null);}}
  },[cancel]);
  useEffect(()=>{void run('load');return cancel;},[run,cancel]);
  useEffect(()=>{
    if(prompt!==null)keepRef.current?.focus();
    else if(returnRef.current?.isConnected){returnRef.current.focus();returnRef.current=null;}
  },[prompt]);
  const request=(intent:'close'|'reload'):void=>{
    if(dirty||busy==='save'){
      returnRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPrompt(intent);return;
    }
    if(intent==='close')closeRef.current();else void run('load');
  };
  const edit=(key:ProviderKey,patch:{enabled?:boolean;path?:string}):void=>{
    setDraft(previous=>previous===null?previous:{...previous,providers:{...previous.providers,[key]:{...previous.providers[key],...patch}}});setSaved(false);
  };
  const disabled=busy!==null||prompt!==null;
  return <Modal title={t('settings.title',locale)} onClose={()=>request('close')} size="lg" footer={<div className="settings-actions">
    <span role="status" className="hint">{t(busy==='save'?'settings.saving':saved?'settings.saved':dirty?'settings.unsaved':'settings.noChanges',locale)}</span>
    <span className="spacer"/>
    <button type="button" className="btn" disabled={busy!==null||prompt!==null} onClick={()=>request('reload')}>{t('settings.reload',locale)}</button>
    <button type="button" className="btn ui-btn-primary" disabled={draft===null||!dirty||disabled||uncertain} onClick={()=>{if(draft!==null)void run('save',draft);}}>{t('settings.save',locale)}</button>
  </div>}>
    <div className="settings-workbench">
      <p>{t('settings.scope',locale)}</p>
      {prompt!==null&&<section className="settings-confirm" role="alert">
        <p>{t(busy==='save'?'settings.closeSaving':'settings.discardHint',locale)}</p>
        <div className="toolbar"><button ref={keepRef} type="button" className="btn" onClick={()=>setPrompt(null)}>{t('settings.keepEditing',locale)}</button>
          <button type="button" className="btn ui-btn-danger" onClick={()=>{const intent=prompt;setPrompt(null);returnRef.current=null;if(intent==='close')closeRef.current();else void run('load');}}>{t(busy==='save'?'settings.closeWithoutRollback':'settings.discard',locale)}</button></div>
      </section>}
      {uncertain&&<p role="alert">{t('settings.uncertain',locale)}</p>}
      {error!==null&&<section className="ui-error" role="alert"><span className="mono">{error}</span><p>{t(error==='CONFIG_RESPONSE_INVALID'?'settings.invalidResponse':errorKind==='load'?'settings.loadFailed':'settings.saveFailed',locale)}</p></section>}
      <section aria-labelledby="settings-providers"><h3 id="settings-providers">{t('settings.providers',locale)}</h3>
        <p className="hint">{t('settings.providerHint',locale)}</p>
        {busy==='load'&&<Skeleton variant="row" count={5}/>}
        {draft!==null&&<div className="settings-provider-list">{PROVIDER_KEYS.map(key=>{
          const provider=draft.providers[key],label=provider.label||key;
          return <div className="settings-provider" key={key}>
            <label className="settings-provider-toggle"><input type="checkbox" data-provider-enabled={key} aria-label={label+' · '+t('settings.enabled',locale)} checked={provider.enabled} disabled={disabled} onChange={event=>edit(key,{enabled:event.currentTarget.checked})}/><strong>{label}</strong></label>
            <label className="settings-provider-path"><span>{t('settings.path',locale)}</span><input type="text" className="ui-input" data-provider-path={key} aria-label={label+' · '+t('settings.path',locale)} value={provider.path} disabled={disabled} onChange={event=>edit(key,{path:event.currentTarget.value})}/></label>
            <span className="hint settings-provider-meta">{provider.sourceKind} · {provider.watchStrategy}{provider.watchStrategy==='poll'?' · '+provider.pollIntervalMs+' ms':''}</span>
          </div>;
        })}</div>}
      </section>
      <details><summary>{t('settings.localDisplay',locale)}</summary>
        <p className="hint">{t('settings.localDisplayHint',locale)}</p>
        <label className="settings-provider-toggle"><input type="checkbox" checked={desensitize} disabled={prompt!==null} onChange={event=>{setDesensitize(event.currentTarget.checked);setDesensitizationEnabled(event.currentTarget.checked);}}/><span>{t('settings.desensitize',locale)}</span></label>
        <p className="hint">{t('settings.desensitizeHint',locale)}</p>
      </details>
    </div>
  </Modal>;
}
