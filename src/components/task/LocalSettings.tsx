import { Accordion, Callout } from '../ui/Display.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Field } from '../ui/Field.js';
import { Skeleton, Toast } from '../ui/States.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertThresholds, LocalSettingsTarget } from '../../core/task-types.js';
import { ALERT_LABELS } from '../../core/task-alerts.js';
import { ApiError, fetchJson } from '../../api/client.js';
import type { Locale } from '../../i18n.js';
import { useTaskRead } from './task-data.js';
export function LocalSettings({locale,onSaved,onDirty,disabled=false,target}:{locale:Locale;onSaved?:()=>void;onDirty:(dirty:boolean)=>void;disabled?:boolean;target?:LocalSettingsTarget}){
  const zh=locale==='zh',[open,setOpen]=useState(Boolean(target)),[alerts,setAlerts]=useState<AlertThresholds|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);

  const owner=useRef<AbortController|null>(null);
  useEffect(()=>()=>owner.current?.abort(),[]);
  useEffect(()=>{onDirty(dirty||busy);},[dirty,busy,onDirty]);
  const read=useCallback((signal:AbortSignal)=>fetchJson<AlertThresholds>('/config/alert-thresholds',{signal}),[]);
  const data=useTaskRead(open?'local-settings':null,read,5000);
  useEffect(()=>{if(data.value){setAlerts(data.value);setDirty(false);setUncertain(false);}},[data.value]);
  const appliedTarget=useRef(''),sectionRef=useRef<HTMLDivElement>(null);
  const targetKey=target?JSON.stringify(target):'';
  useEffect(()=>{if(targetKey)setOpen(true);},[targetKey]);
  useEffect(()=>{
    if(!target||!data.value||appliedTarget.current===targetKey)return;
    appliedTarget.current=targetKey;
    const frame=requestAnimationFrame(()=>{const node=sectionRef.current?.querySelector<HTMLElement>('#settings-'+target.section);node?.scrollIntoView?.({block:'start'});node?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(frame);
  },[targetKey,data.value,target,dirty]);
  const change=()=>{setDirty(true);setSaved(false);};
  const save=async()=>{
    if(busy||disabled||uncertain)return;
    const value=alerts;
    const controller=new AbortController();owner.current=controller;setBusy(true);setError('');setSaved(false);
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const result=await fetchJson('/config/alert-thresholds',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:controller.signal});
      if(controller.signal.aborted){setUncertain(true);return;}
      setAlerts(result as AlertThresholds);setDirty(false);setSaved(true);onSaved?.();
    }catch(e){setError(e instanceof Error?e.message:String(e));setUncertain(!(e instanceof ApiError)||e.status!==400);}
    finally{clearTimeout(timer);if(owner.current===controller){owner.current=null;setBusy(false);}}
  };
  return <div ref={sectionRef}><Accordion title={zh?'告警阈值':'Alert thresholds'} open={open} onOpenChange={setOpen}>
    <p>{zh?'告警默认全部关闭，只在本地标记。':'Alerts default to off and only mark local records.'}</p>
    {(data.loading||busy)&&<Skeleton variant="row" count={2}/>}
    {(data.error||error)&&<Callout tone="danger" title={data.error||error}/>}
    {uncertain&&<p role="alert">{zh?'保存结果未确认，请重新读取配置后再编辑。':'Save outcome is uncertain. Reload before editing.'}</p>}
    {saved&&<Toast title={zh?'已保存并刷新显示':'Saved; displays refreshed'} tone="success" onDismiss={()=>setSaved(false)}/>}
    <Button disabled={busy||dirty&&!uncertain||disabled} onClick={data.retry}>{zh?'重新读取阈值':'Reload thresholds'}</Button>
    {alerts&&<fieldset id="settings-alert-thresholds" className="local-alert-editor" disabled={busy||disabled||uncertain}><legend>{zh?'告警阈值':'Alert thresholds'}</legend><p>{zh?'留空关闭；超过阈值才标记。上下文压力可设 80；未知或任务总量覆盖不全时不触发。':'Blank disables; triggers strictly above threshold. Context pressure may be set to 80. Unknown or incomplete task totals do not trigger.'}</p>
      {(Object.keys(ALERT_LABELS) as Array<keyof AlertThresholds>).map(key=><Field key={key} label={ALERT_LABELS[key][zh?0:1]}><Input aria-label={'Alert '+key} type="number" min="0" max={key.endsWith('Pct')?100:undefined} step={['errors','durationMs','tokens'].includes(key)?1:'any'} value={alerts[key]??''} placeholder={zh?'关闭':'Off'} onChange={e=>{setAlerts({...alerts,[key]:e.target.value===''?null:Number(e.target.value)});change();}}/></Field>)}
      <Button onClick={()=>void save()}>{zh?'保存告警阈值':'Save alert thresholds'}</Button>
    </fieldset>}
  </Accordion></div>;
}
