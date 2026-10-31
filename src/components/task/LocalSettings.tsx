import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelPrice } from '../../core/pricing.js';
import type { AlertThresholds, LocalSettingsTarget } from '../../core/task-types.js';
import { ALERT_LABELS } from '../../core/task-alerts.js';
import { ApiError, fetchJson } from '../../api/client.js';
import type { Locale } from '../../i18n.js';
import { useTaskRead } from './task-data.js';
const emptyPrice={input:'',output:'',cacheRead:'',cacheWrite:'',contextWindow:'',source:'',currency:'USD'};
export function LocalSettings({locale,onSaved,onDirty,disabled=false,target}:{locale:Locale;onSaved?:()=>void;onDirty:(dirty:boolean)=>void;disabled?:boolean;target?:LocalSettingsTarget}){
  const zh=locale==='zh',[open,setOpen]=useState(Boolean(target)),[table,setTable]=useState<Record<string,ModelPrice>|null>(null),[alerts,setAlerts]=useState<AlertThresholds|null>(null),[model,setModel]=useState(''),[price,setPrice]=useState(emptyPrice),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
  const alertBaseline=useRef<AlertThresholds|null>(null);
  const owner=useRef<AbortController|null>(null);
  useEffect(()=>()=>owner.current?.abort(),[]);
  useEffect(()=>{onDirty(dirty||busy);},[dirty,busy,onDirty]);
  const read=useCallback(async(signal:AbortSignal)=>{const [prices,thresholds]=await Promise.all([fetchJson<Record<string,ModelPrice>>('/config/model-pricing',{signal}),fetchJson<AlertThresholds>('/config/alert-thresholds',{signal})]);return {prices,thresholds};},[]);
  const data=useTaskRead(open?'local-settings':null,read,5000);
  useEffect(()=>{if(data.value){setTable(data.value.prices);setAlerts(data.value.thresholds);alertBaseline.current=data.value.thresholds;setDirty(false);setUncertain(false);}},[data.value]);
  const appliedTarget=useRef(''),sectionRef=useRef<HTMLDetailsElement>(null);
  const targetKey=target?JSON.stringify(target):'';
  useEffect(()=>{if(targetKey)setOpen(true);},[targetKey]);
  useEffect(()=>{
    if(!target||!data.value||appliedTarget.current===targetKey)return;
    appliedTarget.current=targetKey;
    if(target.section==='model-pricing'&&target.model&&!dirty){
      const p=data.value.prices[target.model];setModel(target.model);setPrice(p?Object.fromEntries(Object.entries({...p,currency:p.currency??'USD'}).map(([k,v])=>[k,String(v)])) as typeof emptyPrice:emptyPrice);
    }
    const frame=requestAnimationFrame(()=>{const node=sectionRef.current?.querySelector<HTMLElement>('#settings-'+target.section);node?.scrollIntoView?.({block:'start'});node?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(frame);
  },[targetKey,data.value,target,dirty]);
  const change=()=>{setDirty(true);setSaved(false);};
  const save=async(kind:'model-pricing'|'alert-thresholds')=>{
    if(busy||disabled||uncertain)return;
    let value:unknown=alerts;
    if(kind==='model-pricing'){
      const numbers=['input','output','cacheRead','cacheWrite','contextWindow'] as const;
      if(!model.trim()||!price.source.trim()||numbers.some(k=>price[k].trim()===''||!Number.isFinite(Number(price[k]))||Number(price[k])<0)||!Number.isSafeInteger(Number(price.contextWindow))||Number(price.contextWindow)<=0){setError(zh?'请填写模型、来源和有效非负价格及正整数窗口。':'Enter a model, source, nonnegative prices and positive integer window.');return;}
      value={[model.trim()]:{...price,...Object.fromEntries(numbers.map(k=>[k,Number(price[k])]))}};
    }
    const controller=new AbortController();owner.current=controller;setBusy(true);setError('');setSaved(false);
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const result=await fetchJson('/config/'+kind,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:controller.signal});
      if(controller.signal.aborted){setUncertain(true);return;}
      if(kind==='model-pricing'){setTable(result as Record<string,ModelPrice>);setModel('');setPrice(emptyPrice);}else {setAlerts(result as AlertThresholds);alertBaseline.current=result as AlertThresholds;}
      // Keep unsaved changes in the other section guarded.
      setDirty(kind==='model-pricing'?JSON.stringify(alerts)!==JSON.stringify(alertBaseline.current):Boolean(model));setSaved(true);onSaved?.();
    }catch(e){setError(e instanceof Error?e.message:String(e));setUncertain(!(e instanceof ApiError)||e.status!==400);}
    finally{clearTimeout(timer);if(owner.current===controller){owner.current=null;setBusy(false);}}
  };
  return <details ref={sectionRef} open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{zh?'模型价格与告警阈值':'Model prices and alert thresholds'}</summary>
    <p>{zh?'价格保留原币种，不做换汇；来源必须包含 URL 或文档名与抓取日期。告警默认全部关闭，只在本地标记。':'Prices keep their original currency. Source must include a URL or document and retrieval date. Alerts default to off and only mark local records.'}</p>
    {(data.loading||busy)&&<p role="status">{zh?'正在读取或保存…':'Reading or saving…'}</p>}
    {(data.error||error)&&<p role="alert">{data.error||error}</p>}
    {uncertain&&<p role="alert">{zh?'保存结果未确认，请重新读取配置后再编辑。':'Save outcome is uncertain. Reload before editing.'}</p>}
    {saved&&<p role="status">{zh?'已保存并刷新显示':'Saved; displays refreshed'}</p>}
    <button className="btn" disabled={busy||dirty&&!uncertain||disabled} onClick={data.retry}>{zh?'重新读取价格与阈值':'Reload prices and thresholds'}</button>
    {table&&<fieldset id="settings-model-pricing" disabled={busy||disabled||uncertain}><legend>{zh?'模型价格':'Model prices'}</legend>
      <label>{zh?'已有模型':'Existing model'}<select aria-label={zh?'已有模型':'Existing model'} value={Object.hasOwn(table,model)?model:''} onChange={e=>{const name=e.target.value,p=table[name];setModel(name);setPrice(p?Object.fromEntries(Object.entries({...p,currency:p.currency??'USD'}).map(([k,v])=>[k,String(v)])) as typeof emptyPrice:emptyPrice);change();}}><option value="">{zh?'新增模型':'New model'}</option>{Object.keys(table).map(name=><option key={name}>{name}</option>)}</select></label>
      <div className="model-price-editor"><label>{zh?'模型名':'Model ID'}<input aria-label="Model ID" value={model} maxLength={256} onChange={e=>{setModel(e.target.value);change();}}/></label><label>{zh?'币种':'Currency'}<select aria-label="Price currency" value={price.currency} onChange={e=>{setPrice({...price,currency:e.target.value});change();}}><option>USD</option><option>CNY</option></select></label>
      {(['input','output','cacheRead','cacheWrite','contextWindow','source'] as const).map(key=><label key={key}>{key}{key==='source'?(zh?'（出处与日期，必填）':' (source and date, required)'):key==='contextWindow'?' (tokens)':' / 1M tokens'}<input aria-label={'Price '+key} type={key==='source'?'text':'number'} min={key==='contextWindow'?1:0} step={key==='contextWindow'?1:'any'} value={price[key]} required onChange={e=>{setPrice({...price,[key]:e.target.value});change();}}/></label>)}</div>
      <button className="btn" onClick={()=>void save('model-pricing')}>{zh?'保存模型价格':'Save model price'}</button>
    </fieldset>}
    {alerts&&<fieldset id="settings-alert-thresholds" className="local-alert-editor" disabled={busy||disabled||uncertain}><legend>{zh?'告警阈值':'Alert thresholds'}</legend><p>{zh?'留空关闭；超过阈值才标记。上下文压力可设 80；未知或任务总量覆盖不全时不触发。':'Blank disables; triggers strictly above threshold. Context pressure may be set to 80. Unknown or incomplete task totals do not trigger.'}</p>
      {(Object.keys(ALERT_LABELS) as Array<keyof AlertThresholds>).map(key=><label key={key}>{ALERT_LABELS[key][zh?0:1]}<input aria-label={'Alert '+key} type="number" min="0" max={key.endsWith('Pct')?100:undefined} step={['errors','durationMs','tokens'].includes(key)?1:'any'} value={alerts[key]??''} placeholder={zh?'关闭':'Off'} onChange={e=>{setAlerts({...alerts,[key]:e.target.value===''?null:Number(e.target.value)});change();}}/></label>)}
      <button className="btn" onClick={()=>void save('alert-thresholds')}>{zh?'保存告警阈值':'Save alert thresholds'}</button>
    </fieldset>}
  </details>;
}
