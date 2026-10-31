import { deriveSessionKey } from '../../local-sessions/session-key.js';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {initSchema} from '../storage/schema.js';
import {createAgentObservabilityServer} from '../server.js';
import {DEFAULT_LOCAL_SESSION_CONFIG} from '../../local-sessions/config.js';
import {DEFAULT_ALERT_THRESHOLDS} from '../../src/core/task-alerts.js';
import {setModelPriceOverrides} from '../../src/core/pricing.js';
let db:Database.Database,dir:string,server:ReturnType<typeof createAgentObservabilityServer>;
class Response extends EventEmitter {
 headersSent=false;statusCode=200;headers:Record<string,unknown>={};body='';writableEnded=false;destroyed=false;
 setHeader(key:string,value:unknown){this.headers[key]=value;}
 writeHead(status:number,headers:Record<string,unknown>){this.statusCode=status;Object.assign(this.headers,headers);}
 write(value:Buffer|string){this.headersSent=true;this.body+=String(value);return true;}
 end(value:Buffer|string=''){this.body+=String(value);this.writableEnded=true;this.emit('finish');}
}
beforeEach(async()=>{
 dir=await mkdtemp(join(tmpdir(),'task-home-routes-'));db=new Database(':memory:');initSchema(db);
 db.prepare(`INSERT INTO sessions(id,provider,source_agent,source_path,started_at,updated_at,detail_loaded,token_input,token_output,token_cache_read,token_cache_write,primary_model) VALUES('s','codex','Codex','/never-read',?,?,1,60,20,30,0,'fixture')`).run(new Date().toISOString(),new Date().toISOString());
 db.prepare(`INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status,input_len,output_len) VALUES('s','failure',0,'tool','implement',?,'error',1,1)`).run(new Date().toISOString());
 server=createAgentObservabilityServer({db,dbPath:join(dir,'state.sqlite'),config:DEFAULT_LOCAL_SESSION_CONFIG,userConfigPath:join(dir,'user','agent-observe.json'),enableMonitoring:false});
});
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();setModelPriceOverrides({});await rm(dir,{recursive:true,force:true});});
async function call(path:string,method='GET',value?:unknown,headers:Record<string,string>={},remote='127.0.0.1'){
 const request=Readable.from(value===undefined?[]:[Buffer.from(typeof value==='string'?value:JSON.stringify(value))]) as IncomingMessage;
 Object.assign(request,{method,url:path,headers:{host:'127.0.0.1','content-type':'application/json',...headers},socket:{remoteAddress:remote}});
 const response=new Response();const done=new Promise<void>(resolve=>response.once('finish',resolve));
 server.emit('request',request,response as unknown as ServerResponse);await done;
 return {status:response.statusCode,headers:response.headers,body:(String(response.headers['content-type']).includes('ndjson')?{frames:response.body.trim().split('\n').map(line=>JSON.parse(line) as unknown)}:JSON.parse(response.body)) as Record<string,unknown>,text:response.body};
}
it('serves one bounded summary, persists local limits and invalidates price estimates without source IO',async()=>{
 const page=await call('/api/tasks?summary=1');expect(page.status).toBe(200);expect(page.headers['cache-control']).toBe('no-store');expect(page.text).not.toMatch(/inputSummary|outputSummary|"raw"|never-read/);
 const row=(page.body.items as Array<Record<string,unknown>>)[0]!;expect(row.latestHealth).toBeNull();expect(row.metrics).toMatchObject({correctedTotal:110,costs:{known:0},errors:1});
 const saved=await call('/api/config/alert-thresholds','PUT',{...DEFAULT_ALERT_THRESHOLDS,errors:0});expect(saved.status).toBe(200);
 expect((await call('/api/tasks?summary=1&alerts=1')).body.total).toBe(1);
 const price={input:1,output:2,cacheRead:0,cacheWrite:0,contextWindow:100,source:'fixture 2026-10-31',currency:'CNY'};
 expect((await call('/api/config/model-pricing','PUT',{fixture:price})).status).toBe(200);
 const updated=(await call('/api/tasks?summary=1')).body.items as Array<{metrics:unknown}>;expect(updated[0]!.metrics).toMatchObject({costs:{amounts:[{currency:'CNY',amount:0.0001,source:'estimated'}]}});
 expect((await call('/api/tasks/collected%3As')).body.metrics).toEqual(updated[0]!.metrics);
 const kpi=await call('/api/task-kpis');expect(kpi.status).toBe(200);expect(kpi.body).toMatchObject({tasks:1,alerts:1,toolFailurePct:100});
});
it('rejects invalid paging, query flags, duplicate JSON, prices and remote/Host/Origin requests with ApiError',async()=>{
 for(const path of ['/api/tasks?summary=1&limit=51','/api/tasks?summary=1&sort=bad','/api/tasks?summary=1&alerts=false']){const result=await call(path);expect(result.status).toBe(400);expect(result.body.error).toMatchObject({code:'BAD_REQUEST'});}
 for(const path of ['/api/config/model-pricing','/api/config/alert-thresholds','/api/task-kpis']){
  for(const headers of [{host:'attacker.example'},{origin:'https://attacker.example'}] as Record<string,string>[])expect((await call(path,'GET',undefined,headers)).status).toBe(400);
  expect((await call(path,'GET',undefined,{},'192.0.2.1')).status).toBe(400);
 }
 expect((await call('/api/config/alert-thresholds','PUT','{"errors":1,"errors":2}')).status).toBe(400);
 expect((await call('/api/config/model-pricing','PUT',{fixture:{input:1,output:2,cacheRead:0,cacheWrite:0,contextWindow:100,source:'',currency:'CNY'}})).status).toBe(400);
});

it('streams missing-source status without deleting the task, defers parsing and keeps local guards',async()=>{
 db.prepare("UPDATE sessions SET detail_loaded=0 WHERE id='s'").run();
 const source=join(dir,'missing.jsonl');db.prepare("UPDATE sessions SET source_path=? WHERE id='s'").run(source);
 const before=await call('/api/tasks?summary=1');expect((before.body.items as Array<{metrics:{errors:number|null}}>)[0]!.metrics.errors).toBeNull();
 const warmed=await call('/api/task-home/hydrate','POST',{taskIds:['collected:s']});expect(warmed.status).toBe(200);expect(warmed.headers['cache-control']).toBe('no-store');expect(warmed.body.frames).toEqual([
 {items:[{taskId:'collected:s',pending:1,loaded:0,reasons:[]}],done:false},
 {items:[{taskId:'collected:s',pending:0,loaded:0,reasons:['source_missing']}],done:true}]);
 expect(db.prepare("SELECT detail_loaded FROM sessions WHERE id='s'").get()).toEqual({detail_loaded:0});expect(warmed.text).not.toContain(source);
 expect((await call('/api/task-home/hydrate','POST',{taskIds:['collected:s']},{origin:'https://example.com'})).status).toBe(400);
 expect((await call('/api/task-home/hydrate','POST',{taskIds:['collected:s','collected:s']})).status).toBe(400);
});
it('reuses the actual Codex scanner in background and refreshes the indexed summary without opening task detail',async()=>{
 const source=join(dir,'source.jsonl');
 await writeFile(source,[
 {type:'session_meta',timestamp:'2026-10-31T00:00:00Z',payload:{id:'native-home',timestamp:'2026-10-31T00:00:00Z',source:'cli'}},
 {type:'response_item',timestamp:'2026-10-31T00:00:01Z',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Inspect a task '+ 'x'.repeat(300)+'PRIVATE_PROMPT_TAIL'}]}},
 {type:'response_item',timestamp:'2026-10-31T00:00:02Z',payload:{type:'function_call',name:'exec_command',call_id:'call-1',arguments:'{"cmd":"pwd"}'}},
 {type:'response_item',timestamp:'2026-10-31T00:00:03Z',payload:{type:'function_call_output',call_id:'call-1',output:'PRIVATE_TOOL_OUTPUT'}}
 ].map(row=>JSON.stringify(row)).join('\n')+'\n');
 db.prepare("DELETE FROM events WHERE session_id='s'").run();const key=deriveSessionKey('codex',source),taskId='collected:'+key;
 db.prepare("UPDATE sessions SET id=?,detail_loaded=0,source_path=? WHERE id='s'").run(key,source);
 const warmed=await call('/api/task-home/hydrate','POST',{taskIds:[taskId]});
 expect(warmed.body.frames).toEqual([{items:[{taskId,pending:1,loaded:0,reasons:[]}],done:false},{items:[{taskId,pending:0,loaded:1,reasons:[]}],done:true}]);
 const fresh=await call('/api/tasks?summary=1');expect((fresh.body.items as Array<{metrics:unknown}>)[0]!.metrics).toMatchObject({toolCalls:1,errors:0});
 expect(fresh.text).not.toContain('PRIVATE_PROMPT_TAIL');expect(fresh.text).not.toContain('PRIVATE_TOOL_OUTPUT');expect(fresh.text).not.toContain('inputSummary');
});
it('withdraws the page queue when the response disconnects before background admission',async()=>{
 const source=join(dir,'cancelled.jsonl');await writeFile(source,'{}\n');db.prepare("UPDATE sessions SET detail_loaded=0,source_path=? WHERE id='s'").run(source);
 const request=Readable.from([Buffer.from(JSON.stringify({taskIds:['collected:s']}))]) as IncomingMessage;
 Object.assign(request,{method:'POST',url:'/api/task-home/hydrate',headers:{host:'127.0.0.1','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
 class Disconnected extends Response {override write(value:Buffer|string){super.write(value);this.destroyed=true;this.emit('close');return false;}}
 const response=new Disconnected();server.emit('request',request,response as unknown as ServerResponse);
 await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));
 expect(response.body).toContain('"pending":1');expect(db.prepare('SELECT COUNT(1) AS n FROM sessions').get()).toEqual({n:1});expect(db.prepare('SELECT COUNT(1) AS n FROM scan_state').get()).toEqual({n:0});
});
