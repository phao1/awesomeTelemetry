import type { IncomingMessage } from 'node:http';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { AlertThresholds } from '../../src/core/task-types.js';
import type { ModelPrice } from '../../src/core/pricing.js';
import { DEFAULT_MODEL_PRICES, normalizeModelId, setModelPriceOverrides } from '../../src/core/pricing.js';
import { DEFAULT_ALERT_THRESHOLDS } from '../../src/core/task-alerts.js';
import { defaultUserConfigPath } from '../../local-sessions/config.js';
export class LocalSettingsError extends Error { readonly code='BAD_REQUEST'; readonly status=400; } 
import { parseHealthJson } from './task-health-routes.js';
const bad=()=>new LocalSettingsError('Invalid local settings');
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw bad();return v as Record<string,unknown>;};
export function validatePrices(value:unknown):Record<string,ModelPrice>{
  const v=object(value),out:Record<string,ModelPrice>=Object.create(null) as Record<string,ModelPrice>;
  if(Object.keys(v).length>256)throw bad();
  for(const [name,raw] of Object.entries(v)){
    const key=normalizeModelId(name),p=object(raw);
    if(!key||key.length>256||key.startsWith('_')||Object.hasOwn(out,key)||Object.keys(p).length!==7||Object.keys(p).some(k=>!['input','output','cacheRead','cacheWrite','contextWindow','source','currency'].includes(k)))throw bad();
    for(const k of ['input','output','cacheRead','cacheWrite'])if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0)throw bad();
    if(!Number.isSafeInteger(p.contextWindow)||(p.contextWindow as number)<=0||typeof p.source!=='string'||!p.source.trim()||p.source.length>2048||!['USD','CNY'].includes(p.currency as string))throw bad();
    out[key]={...p,source:p.source.trim()} as unknown as ModelPrice;
  }return out;
}
export function validateAlerts(value:unknown):AlertThresholds{
  const v=object(value),keys=Object.keys(DEFAULT_ALERT_THRESHOLDS);
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))throw bad();
  for(const k of keys){const n=v[k];if(n===null)continue;if(typeof n!=='number'||!Number.isFinite(n)||n<0||(k.endsWith('Pct')&&n>100)||(['errors','durationMs','tokens'].includes(k)&&!Number.isSafeInteger(n)))throw bad();}
  return {...v} as unknown as AlertThresholds;
}
async function read(path:string):Promise<unknown|null>{
  try{const f=await open(path,'r');try{if((await f.stat()).size>262144)throw bad();return parseHealthJson(await f.readFile('utf8'));}finally{await f.close();}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
async function atomic(path:string,value:unknown){
  await mkdir(dirname(path),{recursive:true});const tmp=path+'.'+randomUUID()+'.tmp';
  try{const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2),'utf8');await f.sync();}finally{await f.close();}await rename(tmp,path);}finally{await unlink(tmp).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});}
}
/** Per-server serialized config ownership. No synchronous request-path file IO. */
export function createLocalSettings(userPath=defaultUserConfigPath(),projectRoot=process.cwd()){
  const root=dirname(userPath),pricePath=join(root,'model-pricing.json'),alertPath=join(root,'alert-thresholds.json');
  let prices:Record<string,ModelPrice>={},project:Record<string,ModelPrice>={},alerts={...DEFAULT_ALERT_THRESHOLDS};
  // Old hand-written layers may omit currency; keep their USD default and metadata keys.
  const layer=(v:unknown)=>Object.fromEntries(Object.entries(object(v)).filter(([k])=>!k.startsWith('_')).map(([k,p])=>[k,{...object(p),currency:object(p).currency??'USD'}]));
  let loading:Promise<void>|undefined;
  const ready=()=>loading??=(async()=>{const [p,u,a]=await Promise.all([read(join(projectRoot,'config','model-pricing.json')),read(pricePath),read(alertPath)]);project=p===null?{}:validatePrices(layer(p));prices=u===null?{}:validatePrices(layer(u));alerts=a===null?{...DEFAULT_ALERT_THRESHOLDS}:validateAlerts(a);setModelPriceOverrides({...project,...prices});})().catch(error=>{loading=undefined;throw error;});
  let queue:Promise<unknown>=Promise.resolve();
  const serialize=<T>(run:()=>Promise<T>):Promise<T>=>{const next=queue.then(run);queue=next.catch(()=>{});return next;};
  return {
    async prices(){await ready();return structuredClone(Object.fromEntries(Object.entries({...DEFAULT_MODEL_PRICES,...project,...prices}).map(([k,p])=>[k,{...p,currency:p.currency??'USD'}])));},
    async alerts(){await ready();return {...alerts};},
    savePrices(value:unknown){return serialize(async()=>{await ready();const current=await read(pricePath);const next=validatePrices({...(current===null?{}:validatePrices(layer(current))),...validatePrices(value)});await atomic(pricePath,next);prices=next;setModelPriceOverrides({...project,...prices});return structuredClone(Object.fromEntries(Object.entries({...DEFAULT_MODEL_PRICES,...project,...prices}).map(([k,p])=>[k,{...p,currency:p.currency??'USD'}])));});},
    saveAlerts(value:unknown){return serialize(async()=>{await ready();const next=validateAlerts(value);const current=await read(alertPath);if(current!==null)validateAlerts(current);await atomic(alertPath,next);alerts=next;return {...alerts};});},
  };
}
export async function readSettingsBody(req:IncomingMessage):Promise<unknown>{
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw bad();
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const b=Buffer.from(chunk as Uint8Array);size+=b.length;if(size>262144)throw bad();chunks.push(b);}
  try{return parseHealthJson(Buffer.concat(chunks).toString('utf8'));}catch{throw bad();}
}
