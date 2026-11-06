import type { RsiTraceUsage } from '../../core/rsi-api-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { rsiApi } from '../../core/rsi-api-client.js';
import { Sheet } from '../ui/Modal.js';
import { Card, CardBody, Accordion, Callout } from '../ui/Display.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { SegmentedControl } from '../ui/Controls.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { EmptyState } from '../ui/States.js';
import { IconMessage } from '../icons/index.js';
import { ReadError, Numeric } from './Shared.js';
import { copy } from './copy.js';
interface TraceStep { role:string; content:string; tools:{name:string;arguments:string}[];tokens:number|null;cache:number|null }
function content(value:unknown):string {return typeof value==='string'?value:typeof value==='object'&&value!==null?JSON.stringify(value,null,2):'';}
function partialMessages(text:string):unknown[] {
  const field=text.indexOf('"messages"'),start=field<0?-1:text.indexOf('[',field);if(start<0)return [];
  const result:unknown[]=[];let depth=0,quoted=false,escaped=false,from=-1;
  for(let i=start+1;i<text.length;i++){
    const ch=text[i];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
    if(ch==='"'){quoted=true;continue;}if(ch==='{' ){if(depth++===0)from=i;}
    else if(ch==='}'&&depth>0&&--depth===0&&from>=0){try{result.push(JSON.parse(text.slice(from,i+1)));}catch{return result;}}
    else if(ch===']'&&depth===0)break;
  }
  return result;
}
export function traceSteps(text:string,file:'responses'|'last-request',complete:boolean,usage:RsiTraceUsage[]|null=null):TraceStep[] {
  const values:unknown[]=[];
  if(file==='last-request'){try {values.push(JSON.parse(text));}catch {if(complete)return [];values.push({messages:partialMessages(text)});}}
  else {const lines=text.split('\n');if(!complete)lines.pop();for(const line of lines)if(line.trim())try{values.push(JSON.parse(line));}catch{values.push({assistant:[{text:line}]});}}
  return values.flatMap(value=>{
    if(!value||typeof value!=='object')return [];
    const v=value as {requestId?:string;messages?:{role:string;content?:unknown;tool_calls?:unknown[]}[];assistant?:{text?:string;tool_calls?:unknown[]}[]};
    return (file==='last-request'?(Array.isArray(v.messages)?v.messages:[]):(Array.isArray(v.assistant)?v.assistant:[]).map(a=>({role:'assistant',content:a.text,tool_calls:a.tool_calls}))).map(message=>({role:message.role,content:content(message.content),tools:(Array.isArray(message.tool_calls)?message.tool_calls:[]).map(t=>{const tool=t as {function?:{name?:string;arguments?:string};name?:string;arguments?:unknown};return {name:tool.function?.name??tool.name??'',arguments:content(tool.function?.arguments??tool.arguments)};}),tokens:usage?.find(u=>u.requestId===v.requestId)?.tokens??null,cache:usage?.find(u=>u.requestId===v.requestId)?.cacheHitRate??null}));
  });
}
export function Trajectory({taskId,entity,kind,file,locale,onFile,onClose,sessionTokens}:{taskId:string;entity:string;kind:'runs'|'sessions';file:'responses'|'last-request';locale:Locale;onFile:(file:'responses'|'last-request')=>void;onClose:()=>void;sessionTokens?:number|null}) {
  const [state,setState]=useState<{key:string;text:string;next:number|null;truncated:boolean;busy:boolean;error:unknown;usage:RsiTraceUsage[]|null;sessionTokens:number|null}>({key:'',text:'',next:null,truncated:false,busy:true,error:null,usage:null,sessionTokens:null});
  const [visible,setVisible]=useState(100);
  const key=`${taskId}:${entity}:${kind}:${file}`,controller=useRef<AbortController|null>(null),busy=useRef(false);
  const read=async(offset=0)=>{
    if(busy.current)return;busy.current=true;const owned=new AbortController();controller.current=owned;
    setState(old=>({key,text:offset?old.text:'',next:offset?old.next:null,truncated:offset?old.truncated:false,busy:true,error:null,usage:offset?old.usage:null,sessionTokens:offset?old.sessionTokens:null}));
    try{const page=await rsiApi.trajectory(taskId,kind,entity,file,offset,owned.signal);if(!owned.signal.aborted)setState(old=>({key,text:(offset?old.text:'')+page.content,next:page.nextOffset,truncated:old.truncated||page.truncated,busy:false,error:null,usage:page.usage,sessionTokens:page.sessionTokens}));}
    catch(error){if(!owned.signal.aborted)setState(old=>({...old,key,busy:false,error}));}
    finally{if(controller.current===owned)busy.current=false;}
  };
  useEffect(()=>{setVisible(100);busy.current=false;void read();return ()=>{controller.current?.abort();busy.current=false;};},[key]);
  const current=state.key===key?state:null,steps=useMemo(()=>traceSteps(current?.text??'',file,current?.next===null,current?.usage),[current?.text,current?.next,current?.usage,file]);
  return <Sheet open title={copy(locale,kind==='sessions'?'优化者轨迹':'执行轨迹',kind==='sessions'?'Optimizer trajectory':'Run trajectory')} onClose={onClose} className="rsi-sheet"><div className="rsi-stack"><SegmentedControl activeId={file} onChange={v=>onFile(v as typeof file)} items={[{id:'responses',label:copy(locale,'回答和工具','Responses & tools')},{id:'last-request',label:copy(locale,'输入消息','Input messages')}]}/>
    {(current?.sessionTokens??sessionTokens)!=null&&<Callout title={copy(locale,'会话库 Token 对账','Session-library token accounting')}><Numeric value={current?.sessionTokens??sessionTokens} kind="tokens"/></Callout>}
    {(!current||current.busy&&!current.text)&&<PageSkeleton compact/>}{Boolean(current?.error)&&<ReadError error={current?.error} locale={locale} retry={()=>void read(current?.next??0)}/>}
    {current?.next!==null&&current?.text&&<Callout title={copy(locale,'当前仅显示已加载的轨迹，继续加载可查看后续内容','Only loaded trajectory content is shown; load more to continue')}/>}
    {current?.truncated&&<Callout tone="attention" title={copy(locale,'轨迹已截断，以上不是完整会话','Trajectory was truncated; this is not the complete session')}/>}
    {!current?.busy&&!current?.error&&!steps.length&&current?.next===null&&<EmptyState icon={<IconMessage/>} title={copy(locale,'尚无可读取的轨迹','No readable trajectory available')}/>}
    {steps.slice(0,visible).map((s,index)=>{const body=<div className="rsi-trace-step"><div className="rsi-inline"><Badge>{['system','user','assistant','tool'].includes(s.role)?copy(locale,{system:'系统',user:'用户',assistant:'助手',tool:'工具'}[s.role]!,s.role):copy(locale,'消息','Message')}</Badge><span className="num">#{index+1}</span><span className="rsi-muted">Token <Numeric value={s.tokens} kind="tokens"/> · {copy(locale,'缓存','Cache')} <Numeric value={s.cache} kind="percent"/></span></div><pre className="rsi-prose">{s.content}</pre>{s.tools.map((tool,j)=><Accordion key={j} title={tool.name||copy(locale,'工具调用','Tool call')}><pre className="rsi-prose">{tool.arguments}</pre></Accordion>)}</div>;return s.role==='system'||s.role==='user'?<Accordion key={index} title={`${copy(locale,s.role==='system'?'系统消息':'用户消息',s.role==='system'?'System message':'User message')} · ${index+1}`}>{body}</Accordion>:<Card key={index}><CardBody>{body}</CardBody></Card>;})}
    {steps.length>visible&&<Button onClick={()=>setVisible(n=>n+100)}>{copy(locale,'显示更多步骤','Show more steps')}</Button>}
    {current?.next!==null&&current?.next!==undefined&&<Button loading={current.busy} onClick={()=>void read(current.next!)}>{copy(locale,'加载更多','Load more')}</Button>}
  </div></Sheet>;
}
