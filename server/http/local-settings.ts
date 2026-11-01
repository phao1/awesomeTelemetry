import type { IncomingMessage } from 'node:http';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { AlertThresholds } from '../../src/core/task-types.js';
import { DEFAULT_ALERT_THRESHOLDS } from '../../src/core/task-alerts.js';
import { defaultUserConfigPath } from '../../local-sessions/config.js';
export class LocalSettingsError extends Error { readonly code='BAD_REQUEST'; readonly status=400; }
import { parseHealthJson } from './task-health-routes.js';
const bad=()=>new LocalSettingsError('Invalid local settings');
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw bad();return v as Record<string,unknown>;};
export function validateAlerts(value:unknown):AlertThresholds{
  const v=object(value),keys=Object.keys(DEFAULT_ALERT_THRESHOLDS);
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))throw bad();
  for(const k of keys){const n=v[k];if(n===null)continue;if(typeof n!=='number'||!Number.isFinite(n)||n<0||(k.endsWith('Pct')&&n>100)||(['errors','durationMs','tokens'].includes(k)&&!Number.isSafeInteger(n)))throw bad();}
  return {...v} as unknown as AlertThresholds;
}
function storedAlerts(value:unknown):AlertThresholds {
  const v={...object(value)};delete v.costUSD;delete v.costCNY;return validateAlerts(v);
}
async function read(path:string):Promise<unknown|null>{
  try{const f=await open(path,'r');try{if((await f.stat()).size>262144)throw bad();return parseHealthJson(await f.readFile('utf8'));}finally{await f.close();}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
async function atomic(path:string,value:unknown){
  await mkdir(dirname(path),{recursive:true});const tmp=path+'.'+randomUUID()+'.tmp';
  try{const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2),'utf8');await f.sync();}finally{await f.close();}await rename(tmp,path);}finally{await unlink(tmp).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});}
}
/** Per-server serialized config ownership. No synchronous request-path file IO. */
export function createLocalSettings(userPath=defaultUserConfigPath()){
  const alertPath=join(dirname(userPath),'alert-thresholds.json');
  let alerts={...DEFAULT_ALERT_THRESHOLDS};
  let loading:Promise<void>|undefined;
  const ready=()=>loading??=(async()=>{const a=await read(alertPath);alerts=a===null?{...DEFAULT_ALERT_THRESHOLDS}:storedAlerts(a);})().catch(error=>{loading=undefined;throw error;});
  let queue:Promise<unknown>=Promise.resolve();
  const serialize=<T>(run:()=>Promise<T>):Promise<T>=>{const next=queue.then(run);queue=next.catch(error=>{console.error('[local-settings] Save failed:',error);});return next;};
  return {
    async alerts(){await ready();return {...alerts};},
    saveAlerts(value:unknown){return serialize(async()=>{await ready();const next=validateAlerts(value);const current=await read(alertPath);if(current!==null)storedAlerts(current);await atomic(alertPath,next);alerts=next;return {...alerts};});},
  };
}
export async function readSettingsBody(req:IncomingMessage):Promise<unknown>{
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw bad();
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const b=Buffer.from(chunk as Uint8Array);size+=b.length;if(size>262144)throw bad();chunks.push(b);}
  try{return parseHealthJson(Buffer.concat(chunks).toString('utf8'));}catch{throw bad();}
}
