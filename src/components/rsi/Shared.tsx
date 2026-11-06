import { useEffect, useState, type ReactNode } from 'react';
import type { Locale } from '../../i18n.js';
import type { RsiWorkerStatus } from '../../core/rsi-api-client.js';
import { rsiApi, RsiApiError } from '../../core/rsi-api-client.js';
import { formatCount, formatTokens, formatPercent, formatDuration, formatRelativeTime, formatAbsoluteTime } from '../../core/format.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Callout, CopyField } from '../ui/Display.js';
import { Tooltip, Popover } from '../ui/Overlay.js';
import { IconPlay } from '../icons/index.js';
import { copy, reasonLabel, reasonText, RSI_COPY, statusTone } from './copy.js';
export function Reason({code,locale}:{code:string;locale:Locale}) { const known=Object.hasOwn(RSI_COPY,code);return <Tooltip label={known?reasonLabel(code,locale):code}><span tabIndex={0}>{reasonLabel(code,locale)}{known?'':' ⓘ'}</span></Tooltip>; }
export function Status({value,locale}:{value:string;locale:Locale}) {return <Badge tone={statusTone(value)} dot={['running','calibrating','training','reviewing'].includes(value)}><Reason code={value==='sealed'?'evaluating_sealed':value} locale={locale}/></Badge>;}
export function Numeric({value,kind='count',locale='zh',children}:{value:number|null|undefined;kind?:'count'|'tokens'|'percent'|'duration'|'bytes';locale?:Locale;children?:ReactNode}) {
  const display=kind==='tokens'?formatTokens(value):kind==='percent'?formatPercent(value):kind==='duration'?formatDuration(value,locale):kind==='bytes'?(value==null?'—':`${formatTokens(value)} B`):formatCount(value,locale);
  return <Tooltip label={value==null?copy(locale,'没有可核实的计数','No verified counter available'):kind==='percent'?`${value*100}%`:(Number.isInteger(value)?formatCount(value,locale):String(value))+(kind==='duration'?' ms':kind==='bytes'?' B':'')}><span className="num" tabIndex={0}>{children??display}</span></Tooltip>;
}
export function Time({at,locale}:{at:string;locale:Locale}) {return <Tooltip label={formatAbsoluteTime(at,locale)}><time className="num rsi-nowrap" dateTime={at} tabIndex={0}>{formatRelativeTime(at,locale)}</time></Tooltip>;}
export function ReadError({error,locale,retry}:{error:unknown;locale:Locale;retry:()=>void}) {
  const code=error instanceof RsiApiError?error.details?.reason??error.code:'network_error';
  return <Callout tone="danger" title={reasonText(code,locale)}>{!Object.hasOwn(RSI_COPY,code)&&<Reason code={code} locale={locale}/>}<Button size="sm" onClick={retry}>{copy(locale,'重试','Retry')}</Button></Callout>;
}
export function WorkerPill({status,taskId,locale}:{status:RsiWorkerStatus|null;taskId:string|null;locale:Locale}) {
  const [open,setOpen]=useState(false),[observed,setObserved]=useState<{task:string;status:RsiWorkerStatus}|null>(null),[unavailable,setUnavailable]=useState(false);
  useEffect(()=>{if(!taskId)return;let controller:AbortController|null=null;const timer=setInterval(()=>{controller?.abort();const owned=new AbortController();controller=owned;void rsiApi.worker(taskId,owned.signal).then(value=>{if(!owned.signal.aborted){setObserved({task:taskId,status:value});setUnavailable(false);}}).catch(()=>{if(!owned.signal.aborted)setUnavailable(true);});},5000);return()=>{clearInterval(timer);controller?.abort();};},[taskId]);
  status=observed?.task===taskId?observed.status:status;
  const running=!unavailable&&status?.running===true;
  const label=unavailable?copy(locale,'执行器状态未确认','Executor status unavailable'):copy(locale,running?'执行器运行中':'执行器未运行',running?'Executor running':'Executor offline');
  if(running&&status)return <Tooltip label={`${status.phase?reasonLabel(status.phase,locale)+(Object.hasOwn(RSI_COPY,status.phase)?'':` (${status.phase})`):'—'} · ${status.at?formatAbsoluteTime(status.at,locale):'—'}`}><span className="rsi-worker" role="status" aria-label={label} tabIndex={0}><Badge tone="success" dot><span className="rsi-worker-label">{label}</span></Badge></span></Tooltip>;
  return <Popover open={open} onOpenChange={setOpen} trigger={props=><Button {...props} aria-label={label} title={label} size="sm" variant="ghost" className="rsi-worker"><Badge tone="neutral" dot><span className="rsi-worker-label">{label}</span></Badge></Button>}><div className="rsi-popover"><p>{copy(locale,'页面操作只会进入队列，执行器启动后才会执行','Page actions enter the queue and execute after the executor starts.')}</p><CopyField locale={locale} label={copy(locale,'启动执行器','Start executor')} value={`node bin/rsi.js worker --execute --watch --task ${taskId??'<id>'}`}/></div></Popover>;
}
export function EmptyIcon(){return <span className="rsi-empty-icon"><IconPlay size={24}/></span>;}
export function WriteError({error,locale}:{error:unknown;locale:Locale}) {const code=error instanceof RsiApiError?error.details?.reason??error.code:'network_error';return <Callout tone="danger" title={reasonLabel(code,locale)}>{!Object.hasOwn(RSI_COPY,code)&&<Reason code={code} locale={locale}/>}</Callout>;}
