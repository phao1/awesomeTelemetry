import {useCallback,useEffect,useRef,useState} from 'react';
import {t,type Locale} from '../i18n.js';
import {api,ApiError} from '../api/client.js';
import {EmptyState,Skeleton} from './ui/States.js';
import {Modal} from './ui/Modal.js';
import {FridaCaptureInspector} from './FridaCaptureInspector.js';
import {fetchFridaCapturePage} from '../api/frida-captures.js';
import {IconFrida} from './icons/index.js';
import type {BusEvents} from '../core/trace-types.js';

export interface FridaViewProps {locale:Locale;liveStatus?:BusEvents['frida_status']|null;savedNotifications?:readonly BusEvents['frida_capture'][];connected?:boolean}
type FridaStatus=Awaited<ReturnType<typeof api.fridaStatus>>;
type History=Awaited<ReturnType<typeof api.fridaCaptures>>;
type Channel='status'|'history';
interface Owner {controller:AbortController;timer:ReturnType<typeof setTimeout>}
function cancel(owner:Owner|null):void {if(owner!==null){clearTimeout(owner.timer);owner.controller.abort();}}
function validStatus(value:unknown):value is FridaStatus {
  if(typeof value!=='object'||value===null)return false;
  const status=value as Record<string,unknown>;
  return typeof status.running==='boolean'&&typeof status.starting==='boolean'
    &&(status.pid===null||(typeof status.pid==='number'&&Number.isSafeInteger(status.pid)&&status.pid>0));
}
function validHistory(value:unknown):value is History {
  if(typeof value!=='object'||value===null)return false;
  const page=value as Record<string,unknown>;
  return Array.isArray(page.items)&&typeof page.hasMore==='boolean'&&(page.nextCursor===null||typeof page.nextCursor==='string')
    &&page.items.every((item:unknown)=>{if(typeof item!=='object'||item===null)return false;const row=item as Record<string,unknown>;
      return typeof row.id==='number'&&Number.isSafeInteger(row.id)&&row.id>0&&typeof row.capturedAt==='string'
        &&typeof row.captureType==='string'&&(row.model===null||typeof row.model==='string');});
}

/** REQ-021: explicit experimental controls, never installation or full-chain certification. */
export function FridaView({locale,liveStatus=null,savedNotifications=[],connected=true}:FridaViewProps):React.JSX.Element {
  const [scrollTop,setScrollTop]=useState(0);
  const [selected,setSelected]=useState<number|null>(null);
  const [status,setStatus]=useState<FridaStatus|null>(null),[history,setHistory]=useState<History|null>(null);
  const [loading,setLoading]=useState<Record<Channel,boolean>>({status:true,history:true});
  const [errors,setErrors]=useState<Record<Channel,string|null>>({status:null,history:null});
  const [pid,setPid]=useState(''),[acknowledged,setAcknowledged]=useState(false),[confirmStop,setConfirmStop]=useState(false);
  const [action,setAction]=useState<'start'|'stop'|null>(null),[actionError,setActionError]=useState<string|null>(null);
  const [uncertain,setUncertain]=useState(false),[received,setReceived]=useState(false);
  const reads=useRef<Record<Channel,Owner|null>>({status:null,history:null}),command=useRef<Owner|null>(null);
  const read=useCallback(async(channel:Channel,cursor?:string)=>{
    cancel(reads.current[channel]);setLoading(prev=>({...prev,[channel]:true}));setErrors(prev=>({...prev,[channel]:null}));
    if(channel==='status')setStatus(null);else {setSelected(null);if(cursor===undefined){setHistory(null);setScrollTop(0);}}
    const controller=new AbortController();
    const owner:Owner={controller,timer:setTimeout(()=>{
      if(reads.current[channel]!==owner)return;
      reads.current[channel]=null;controller.abort();setLoading(prev=>({...prev,[channel]:false}));
      setErrors(prev=>({...prev,[channel]:'FRIDA_READ_TIMEOUT'}));
    },5000)};
    reads.current[channel]=owner;
    try {
      const value=await(channel==='status'?api.fridaStatus(controller.signal):cursor===undefined?api.fridaCaptures(controller.signal):fetchFridaCapturePage(cursor,controller.signal));
      if(reads.current[channel]!==owner)return;
      if(channel==='status'){if(!validStatus(value))throw new Error('FRIDA_RESPONSE_INVALID');setStatus(value);setUncertain(false);setActionError(null);setReceived(false);}
      else {if(!validHistory(value))throw new Error('FRIDA_RESPONSE_INVALID');setHistory(previous=>cursor!==undefined&&previous!==null?{...value,items:[...previous.items,...value.items.filter(item=>!previous.items.some(old=>old.id===item.id))]}:value);}
    } catch(error) {
      if(reads.current[channel]!==owner)return;
      console.error('[frida] '+channel+' read failed',error);
      setErrors(prev=>({...prev,[channel]:error instanceof ApiError?error.code:error instanceof Error&&error.message==='FRIDA_RESPONSE_INVALID'?'FRIDA_RESPONSE_INVALID':'FRIDA_READ_FAILED'}));
    } finally {clearTimeout(owner.timer);if(reads.current[channel]===owner){reads.current[channel]=null;setLoading(prev=>({...prev,[channel]:false}));}}
  },[]);
  useEffect(()=>{void read('status');void read('history');const current=reads.current;return()=>{cancel(current.status);cancel(current.history);current.status=null;current.history=null;cancel(command.current);command.current=null;};},[read]);
  const abandon=useCallback((code:string)=>{
    const owner=command.current;if(owner===null)return;
    command.current=null;cancel(owner);setAction(null);setActionError(code);setStatus(null);setUncertain(true);setReceived(false);
  },[]);
  const run=async(kind:'start'|'stop'):Promise<void>=>{
    if(command.current!==null||status===null||loading.status||uncertain)return;
    setAction(kind);setActionError(null);setReceived(false);
    const controller=new AbortController();
    const owner:Owner={controller,timer:setTimeout(()=>{if(command.current===owner)abandon('FRIDA_ACTION_TIMEOUT');},10000)};
    command.current=owner;
    try {
      const value=await(kind==='start'?api.fridaStart(pid.trim()===''?undefined:Number(pid.trim()),controller.signal):api.fridaStop(controller.signal));
      if(command.current!==owner)return;
      if(!validStatus(value))throw new Error('FRIDA_RESPONSE_INVALID');
      setStatus(value);setUncertain(false);setReceived(true);
    } catch(error) {
      if(command.current!==owner)return;
      console.error('[frida] '+kind+' failed',error);
      setActionError(error instanceof ApiError?error.code:error instanceof Error&&error.message==='FRIDA_RESPONSE_INVALID'?'FRIDA_RESPONSE_INVALID':'FRIDA_ACTION_FAILED');
      setStatus(null);setUncertain(true);
    } finally {clearTimeout(owner.timer);if(command.current===owner){command.current=null;setAction(null);}}
  };
  const input=pid.trim(),validPid=input===''||(/^\d+$/.test(input)&&Number.isSafeInteger(Number(input))&&Number(input)>0);
  const active=status!==null&&(status.running||status.starting),busy=action!==null;
  const windowStart=Math.max(0,Math.floor(scrollTop/28)-10),windowEnd=windowStart+40;
  const label=status===null?'frida.status.unknown':status.starting?'frida.status.starting':status.running?'frida.status.running':'frida.status.stopped';
  return <section className="view admin-workbench frida-workbench" aria-label={t('view.frida',locale)}>
    <header className="admin-heading"><div><span className="workbench-source">{t('frida.experimental',locale)}</span><h1>{t('frida.title',locale)}</h1><p className="hint">{t('frida.scope',locale)}</p></div>
      <button type="button" className="btn" disabled={busy||loading.status||loading.history} onClick={()=>{void read('status');void read('history');}}>{t('common.refresh',locale)}</button>
    </header>
    <section className="admin-surface" aria-labelledby="frida-runtime">
      <div className="admin-section-heading"><h2 id="frida-runtime">{t('frida.runtime',locale)}</h2><span role="status">{t(label,locale)}{status?.pid!==null&&status?.pid!==undefined?' · PID '+status.pid:''}</span></div>
      <p className="hint">{t('frida.snapshotHint',locale)}</p>
      {liveStatus!==null&&<div role="status" aria-label={locale==='zh'?'最近 Frida 运行通知':'Latest Frida runtime notification'}>
        <p>{locale==='zh'?'最近收到的运行通知：':'Last received runtime notification: '}{liveStatus.running?(locale==='zh'?'进程运行':'Process running'):(locale==='zh'?'进程停止':'Process stopped')}{liveStatus.pid!==undefined?' · PID '+liveStatus.pid:''}</p>
        <p className="hint">{locale==='zh'?'通知不替代控制状态快照，也不证明 hook 就绪或捕获成功。':'A notification does not replace the control snapshot or prove hook readiness or successful capture.'}</p>
      </div>}
      {loading.status&&<Skeleton variant="row" count={1}/>}
      {errors.status!==null&&<div className="ui-error" role="alert"><code>{errors.status}</code><p>{t('frida.readFailed',locale)}</p></div>}
      {uncertain&&<p role="alert">{t('frida.uncertain',locale)}</p>}
      {actionError!==null&&<div className="ui-error" role="alert"><code>{actionError}</code><p>{t('frida.actionFailed',locale)}</p></div>}
      {received&&<p role="status">{t('frida.received',locale)}</p>}
      <div className="admin-toolbar">
        <button type="button" className="btn" disabled={busy||loading.status} onClick={()=>void read('status')}>{t('frida.refreshStatus',locale)}</button>
        {active&&<button type="button" className="btn ui-btn-danger" disabled={busy||loading.status} onClick={()=>setConfirmStop(true)}>{t('frida.stop',locale)}</button>}
        {busy&&<><span role="status">{t(action==='start'?'frida.startPending':'frida.stopPending',locale)}</span><button type="button" className="btn" onClick={()=>abandon('FRIDA_WAIT_CANCELLED')}>{t('frida.cancelWait',locale)}</button></>}
      </div>
    </section>
    <section className="admin-surface" aria-labelledby="frida-prerequisites">
      <h2 id="frida-prerequisites">{t('frida.prereq',locale)}</h2>
      <p>{t('frida.prereqHint',locale)}</p>
      <details><summary>{t('frida.limitations',locale)}</summary><p className="hint">{locale==='zh'?'完整且有效的帧可保存并按需查看。当前随包脚本仍是骨架，启动会明确失败；Windows / Trae 真机尚未验证。':'Complete valid frames can be saved and inspected on demand. The packaged script is still a skeleton and start fails explicitly; Windows / Trae device capture remains unverified.'}</p></details>
      <label className="settings-provider-toggle"><input type="checkbox" data-frida-ack checked={acknowledged} disabled={busy||active} onChange={event=>setAcknowledged(event.currentTarget.checked)}/><span>{t('frida.acknowledge',locale)}</span></label>
      <div className="admin-toolbar"><label className="frida-pid"><span>{t('frida.pid',locale)}</span><input type="text" className="ui-input mono" inputMode="numeric" data-frida-pid value={pid} disabled={busy||active} aria-invalid={!validPid} aria-describedby={!validPid?'frida-pid-error':'frida-pid-hint'} onChange={event=>setPid(event.currentTarget.value)}/></label>
        <button type="button" className="btn ui-btn-primary" disabled={busy||active||loading.status||status===null||uncertain||!acknowledged||!validPid} onClick={()=>void run('start')}>{t('frida.start',locale)}</button></div>
      <p id="frida-pid-hint" className="hint">{t('frida.pidHint',locale)}</p>
      {!validPid&&<p id="frida-pid-error" role="alert">{t('frida.pidInvalid',locale)}</p>}
    </section>
    <section className="admin-surface" aria-labelledby="frida-history">
      <div className="admin-section-heading"><h2 id="frida-history">{t('frida.history',locale)}{history!==null?' · '+history.items.length:''}</h2>
        <button type="button" className="btn" disabled={busy||loading.history} onClick={()=>void read('history')}>{t('frida.refreshHistory',locale)}</button></div>
      <p className="hint">{t('frida.historyHint',locale)}</p>
      {(liveStatus!==null||savedNotifications.length>0)&&!connected&&<p role="status">{locale==='zh'?'实时连接已断开；通知可能缺失，当前状态未知。':'Live connection is disconnected; notifications may be missing and current state is unknown.'}</p>}
      {savedNotifications.length>0&&<section aria-label={locale==='zh'?'新保存捕获通知':'New saved capture notifications'}>
        <p className="hint">{locale==='zh'?'最近最多 20 条保存通知；与历史快照独立，不代表全部捕获或完整时间顺序。点击后才读取原文。':'At most 20 recent save notifications, separate from the history snapshot; not all captures or a complete time order. Text loads only on selection.'}</p>
        <div className="admin-toolbar">{savedNotifications.slice(-20).map(item=><button key={item.id} type="button" className="btn" aria-label={(locale==='zh'?'打开新保存捕获 #':'Open newly saved capture #')+item.id} onClick={()=>setSelected(item.id)}>#{item.id}</button>)}</div>
      </section>}
      {loading.history&&<Skeleton variant="row" count={3}/>}
      {errors.history!==null&&<div className="ui-error" role="alert"><code>{errors.history}</code><p>{t('frida.readFailed',locale)}</p></div>}
      {history!==null&&history.items.length===0&&<EmptyState icon={<IconFrida/>} title={t('frida.empty',locale)} description={t('frida.emptyHint',locale)}/>}
      {history!==null&&history.items.length>0&&<div className="admin-table frida-history-scroll" onScroll={event=>setScrollTop(event.currentTarget.scrollTop)}><table className="ui-table ui-table-compact"><thead><tr><th>ID</th><th>{t('frida.type',locale)}</th><th>{t('frida.model',locale)}</th><th>{t('proxy.time',locale)}</th></tr></thead><tbody>{windowStart>0&&<tr aria-hidden="true" style={{height:windowStart*28}}><td colSpan={4}/></tr>}{history.items.slice(windowStart,windowEnd).map(item=><tr key={item.id}><td className="mono"><button type="button" className="btn" aria-label={(locale==='zh'?'打开捕获 #':'Open capture #')+item.id} onClick={()=>setSelected(item.id)}>{item.id}</button></td><td>{item.captureType}</td><td className="mono">{item.model??'—'}</td><td className="mono"><time dateTime={item.capturedAt} title={item.capturedAt}>{Number.isFinite(Date.parse(item.capturedAt))?new Date(item.capturedAt).toLocaleString(locale==='zh'?'zh-CN':'en-US'):item.capturedAt}</time></td></tr>)}{history.items.length>windowEnd&&<tr aria-hidden="true" style={{height:(history.items.length-windowEnd)*28}}><td colSpan={4}/></tr>}</tbody></table></div>}
      {history?.hasMore&&<><p role="status">{t('frida.partialHistory',locale)}</p><button type="button" className="btn" disabled={loading.history||history.nextCursor===null} onClick={()=>{if(history.nextCursor!==null)void read('history',history.nextCursor);}}>{locale==='zh'?'加载下一页':'Load next page'}</button></>}
    </section>
    {selected!==null&&<FridaCaptureInspector key={selected} id={selected} locale={locale} onClose={()=>setSelected(null)}/>}
    {confirmStop&&<Modal title={t('frida.confirmStop',locale)} onClose={()=>setConfirmStop(false)} size="sm" footer={<div className="admin-toolbar"><button type="button" className="btn" onClick={()=>setConfirmStop(false)}>{t('common.cancel',locale)}</button><button type="button" className="btn ui-btn-danger" onClick={()=>{setConfirmStop(false);void run('stop');}}>{t('frida.confirmStop',locale)}</button></div>}><p>{t('frida.stopHint',locale)}</p></Modal>}
  </section>;
}
