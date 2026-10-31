import type { TaskRequestList } from '../../core/task-types.js';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const integer=(v:unknown)=>number(v)&&Number.isSafeInteger(v);
const nullable=(v:unknown)=>v===null||number(v);
const strings=(v:unknown)=>Array.isArray(v)&&v.every(n=>typeof n==='string');
const date=(v:unknown)=>typeof v==='string'&&v.endsWith('Z')&&Number.isFinite(Date.parse(v));
function metrics(v:unknown):boolean{
  if(!object(v)||!['durationMs','toolCalls','errors','input','output','cacheRead','correctedTotal','costUsd'].every(k=>nullable(v[k]))||!strings(v.models))return false;
  if(!['toolResults','toolFailures','contextPressurePct'].every(k=>v[k]===undefined||nullable(v[k])))return false;
  if(v.coverage!==undefined){
    if(!object(v.coverage))return false;
    for(const key of ['input','output','cacheRead','correctedTotal','models']){
      const c=v.coverage[key];
      if(!object(c)||!integer(c.known)||!integer(c.total)||!Array.isArray(c.missing)||!c.missing.every(m=>object(m)&&typeof m.memberId==='string'&&typeof m.name==='string'&&typeof m.reason==='string'))return false;
    }
  }
  if(v.costs!==undefined){
    const c=v.costs;
    if(!object(c)||!integer(c.known)||!integer(c.total)||!Array.isArray(c.amounts)||!c.amounts.every(a=>object(a)&&['USD','CNY'].includes(String(a.currency))&&number(a.amount)&&['reported','estimated','mixed'].includes(String(a.source))))return false;
    if(c.missingPrices!==undefined&&!strings(c.missingPrices)||c.missingReasons!==undefined&&!strings(c.missingReasons))return false;
  }
  return true;
}
/** Validate the shared transport boundary before any consumer renders nested fields. */
export function isTaskRequestList(value:unknown):value is TaskRequestList{
  if(!object(value)||typeof value.taskId!=='string'||!value.taskId||typeof value.revision!=='string'||!Array.isArray(value.items))return false;
  const ids=new Set<string>();
  return value.items.every(r=>{
    if(!object(r)||typeof r.id!=='string'||!r.id||ids.has(r.id)||!integer(r.ordinal)||r.ordinal===0||typeof r.title!=='string'||!date(r.startedAt)||!date(r.endedAt)||(r.nextStartedAt!==null&&!date(r.nextStartedAt))||!integer(r.eventCount)||!metrics(r.metrics)||!Array.isArray(r.alerts))return false;
    if(!r.alerts.every(a=>object(a)&&typeof a.rule==='string'&&number(a.threshold)&&number(a.actual)&&(a.currency===undefined||a.currency==='USD'||a.currency==='CNY')))return false;
    ids.add(r.id);return true;
  });
}
