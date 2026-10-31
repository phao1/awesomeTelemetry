import Database from 'better-sqlite3';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { mkdtemp, readFile, rm, stat, truncate, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import { createAgentObservabilityServer } from '../server.js';
import { checkpointWal, openReadonly } from '../storage/db.js';
import { readCaptureCapacity, withCaptureCapacity } from '../proxy/capture-capacity.js';
import type { HealthReport } from '../../src/core/task-health/types.js';
import { initSchema } from '../storage/schema.js';
import { collectTaskHealth } from '../task-health/collector.js';
import { analyzeTaskHealth } from '../../src/core/task-health/report.js';
import { taskComparisonSnapshot } from '../storage/task-home.js';
import { DEFAULT_ALERT_THRESHOLDS } from '../../src/core/task-alerts.js';
import type { TelemetryStatus, TelemetryImportResult } from '../../src/core/telemetry-types.js';
import type { TaskContext, TaskPage, TaskRecordPage } from '../../src/core/task-types.js';
import { batch, span } from './test-fixtures.js';

async function fixture(file = false, bundled = false) {
  const directory = await mkdtemp(join(tmpdir(),'phase-d-')), path=join(directory,'state.sqlite'), db = new Database(file?path:':memory:');db.pragma('foreign_keys=ON');if(file)db.pragma('journal_mode=WAL');initSchema(db);
  const config=structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);for(const p of Object.values(config.providers)){p.enabled=false;p.path=join(directory,'none');}
  const options={db,config,enableMonitoring:false,userConfigPath:join(directory,'user.json'),captureDirectory:join(directory,'bodies'),caDirectory:join(directory,'ca')};
  let factory=createAgentObservabilityServer;
  if(bundled){
    const output=join(directory,'build');
    await build({configFile:false,logLevel:'silent',build:{ssr:true,outDir:output,target:'node20',rollupOptions:{input:{server:resolve('server/server.ts'),'telemetry-worker':resolve('server/telemetry/worker.ts')},external:['better-sqlite3','chokidar','http-mitm-proxy','node-forge'],output:{entryFileNames:'[name].js',chunkFileNames:'[name]-[hash].js'}}}});
    await symlink(resolve('node_modules'),join(output,'node_modules'),'dir');await writeFile(join(output,'package.json'),JSON.stringify({type:'module'}));
    factory=(await import(pathToFileURL(join(output,'server.js')).href) as {createAgentObservabilityServer:typeof createAgentObservabilityServer}).createAgentObservabilityServer;
  }
  let server=factory(options);
  // Real Node HTTP message/response and router, with an in-memory transport:
  // this sandbox forbids listen(2), so TCP binding remains coordinator validation.
  const call=(path:string,body?:unknown,method=body===undefined?'GET':'POST',headers:Record<string,string>={})=>new Promise<{status:number;json:unknown;body:string}>((resolve,reject)=>{
    const bytes=Buffer.isBuffer(body)?body:body===undefined?undefined:Buffer.from(JSON.stringify(body));
    const socket=new Socket();Object.defineProperty(socket,'remoteAddress',{value:'127.0.0.1',configurable:true});Object.defineProperty(socket,'localPort',{value:4173,configurable:true});
    const req=new IncomingMessage(socket);req.method=method;req.url=path;req.headers={host:'127.0.0.1:4173',...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{}),...headers};req.complete=true;
    const chunks:Buffer[]=[];const transport=new Duplex({read(){return;},write(chunk:Buffer,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
    const res=new ServerResponse(req);res.assignSocket(transport as Socket);
    res.once('error',reject);res.once('finish',()=>{try{const raw=Buffer.concat(chunks),start=raw.indexOf('\r\n\r\n')+4;const text=raw.subarray(start).toString();resolve({status:res.statusCode,json:JSON.parse(text) as unknown,body:text});}catch(error){reject(error);}finally{res.detachSocket(transport as Socket);transport.destroy();socket.destroy();}});
    if(bytes)req.push(bytes);req.push(null);server.emit('request',req,res);
  });
  const stop=()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  return {db,directory,path,call,get server(){return server;},enable:(requireToken=false)=>call('/api/telemetry',{enabled:true,requireToken},'PUT'),async restart(){await stop();server=factory(options);},async close(){await stop();db.close();await rm(directory,{recursive:true,force:true});}};
}
describe('local OTLP receiver and file import',()=>{
  it('defaults off, explicitly enables, returns OTLP response and exposes tasks/details/summary/health/comparison/export',async()=>{
    const f=await fixture();try{
      expect((await f.call('/v1/traces',batch([span()]))).status).toBe(403);
      expect((await f.enable()).status).toBe(200);
      const input=batch([span('1',{'gen_ai.operation.name':'invoke_agent','gen_ai.conversation.id':'conversation','gen_ai.agent.name':'main'}),span('2',{'gen_ai.operation.name':'chat','gen_ai.usage.input_tokens':4,'gen_ai.usage.output_tokens':6,'llm.token_count.total':10},'1'),span('3',{'gen_ai.operation.name':'invoke_agent','gen_ai.agent.name':'child'},'1'),span('4',{'gen_ai.operation.name':'execute_tool','gen_ai.tool.name':'search','input.value':'hello','output.value':'result'},'3')]);
      expect(await f.call('/v1/traces',input)).toMatchObject({status:200,json:{}});
      const listed=await f.call('/api/tasks?range=all&summary=1');expect(listed.status).toBe(200);const page=listed.json as TaskPage;expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({provider:'OpenTelemetry',memberCount:2,eventCount:4,provenanceKnown:true,metrics:{input:4,output:6,correctedTotal:10,toolCalls:1,costUsd:null}});
      const id=page.items[0]!.id, context=(await f.call('/api/tasks/'+encodeURIComponent(id))).json as TaskContext;
      expect(context.members).toHaveLength(2);expect(context.members.find(m=>m.role==='subagent')?.parentId).toBe(context.task.rootSessionKey);
      const records=(await f.call('/api/tasks/'+encodeURIComponent(id)+'/records?member=all&offset=0')).json as TaskRecordPage;expect(records.items).toHaveLength(4);expect(records.items.find(r=>r.event?.kind==='tool')?.event?.telemetry).toMatchObject({parentSpanId:'3'.padStart(16,'0'),durationMs:1000});expect(JSON.stringify(records)).not.toContain('inputSummary');
      const tool=records.items.find(r=>r.event?.kind==='tool')!;
      const detail=await f.call(`/api/sessions/${encodeURIComponent(tool.sessionKey!)}/events/${tool.event!.id}`);expect(detail.status).toBe(200);expect(detail.json).toMatchObject({inputSummary:'hello',outputSummary:'result',telemetry:{toolName:'search'}});
      const health=await collectTaskHealth(f.db,id);expect(health.records).toHaveLength(4);expect(health.members).toHaveLength(2);
      const report=analyzeTaskHealth(health,undefined,{id:'synthetic-otel-health',generatedAt:'2026-11-01T00:00:02.000Z'});expect(report.spans.filter(s=>s.kind==='model')).toHaveLength(1);expect(report.spans.find(s=>s.kind==='tool')).toMatchObject({timing:'observed',capped:false});expect(report.spans.find(s=>s.kind==='model')).toMatchObject({timing:'observed',firstContentMs:null});
      const exported=await f.call(`/api/sessions/${encodeURIComponent(context.task.rootSessionKey!)}/trace-export`);expect(exported.status).toBe(200);
      const imported=await f.call('/api/telemetry/import',exported.json);expect(imported.status).toBe(200);expect((imported.json as TelemetryImportResult).spanCount).toBe(4);
      const compare=await taskComparisonSnapshot(f.db,[id],[(imported.json as TelemetryImportResult).taskIds[0]!],DEFAULT_ALERT_THRESHOLDS);expect(compare.a[0]?.metrics?.input).toBe(4);expect(compare.b[0]?.metrics?.toolCalls).toBe(1);
      const historical=(await f.call('/api/tasks?origin=imported&range=all&summary=1')).json as TaskPage;expect(historical.items).toHaveLength(1);expect(historical.items[0]).toMatchObject({origin:'imported',memberCount:2,eventCount:4});
      const count=f.db.prepare('SELECT COUNT(1) AS n FROM events').get();expect((await f.call('/v1/traces',input)).status).toBe(200);expect(f.db.prepare('SELECT COUNT(1) AS n FROM events').get()).toEqual(count);
      const stats=(await f.call('/api/telemetry')).json as TelemetryStatus;expect(stats).toMatchObject({spanCount:8,traceCount:2,rejectedCount:1,reasons:{TELEMETRY_DISABLED:1}});
    }finally{await f.close();}
  });
  it('accepts gzip OTLP and vendor imports with a 667MB native DB, while capture remains blocked; verifies task summary and standard health APIs',async()=>{
    const f=await fixture(true,true);try{
      checkpointWal(f.db);await truncate(f.path,667000000);
      expect(await readCaptureCapacity(f.db)).toMatchObject({databaseBytes:667000000,state:'limited',reason:'database_limit'});
      await expect(withCaptureCapacity(f.db,()=>{throw new Error('capture must remain blocked');})).rejects.toMatchObject({code:'CAPTURE_METADATA_LIMIT'});
      await f.enable(true);const token=((await f.call('/api/telemetry',{enabled:true,requireToken:true},'PUT')).json as {token:string}).token;
      const input=batch([span('1',{'gen_ai.operation.name':'invoke_agent','gen_ai.conversation.id':'large-native-db','gen_ai.agent.name':'planner'}),span('2',{'gen_ai.operation.name':'invoke_agent','gen_ai.agent.name':'researcher'},'1'),span('3',{'gen_ai.operation.name':'chat'},'2')]);
      expect((await f.call('/v1/traces',gzipSync(JSON.stringify(input)),'POST',{'content-encoding':'gzip',authorization:'Bearer '+token})).status).toBe(200);
      const collected=(await f.call('/api/tasks?origin=collected&range=all')).json as TaskPage;
      expect(collected.items).toHaveLength(1);expect(collected.items[0]?.origin).toBe('collected');
      expect(((await f.call('/api/tasks?origin=imported&range=all')).json as TaskPage).items).toHaveLength(0);
      const lf=await f.call('/api/telemetry/import',{traces:[{id:'trace',sessionId:'lf-session'}],observations:[{id:'planner',traceId:'trace',type:'AGENT',name:'planner'},{id:'researcher',traceId:'trace',type:'AGENT',name:'researcher',parentObservationId:'planner'}]});
      expect(lf.status).toBe(200);
      const ls=await f.call('/api/telemetry/import',Buffer.from(JSON.stringify({id:'run',trace_id:'ls-trace',run_type:'llm',start_time:'2026-11-01T00:00:00',end_time:'2026-11-01T00:00:01'})),'POST',{'content-type':'application/x-ndjson'});
      expect(ls.status).toBe(200);
      const imported=(await f.call('/api/tasks?origin=imported&range=all')).json as TaskPage;expect(imported.items).toHaveLength(2);expect(imported.items.every(t=>t.origin==='imported')).toBe(true);
      for(const id of [collected.items[0]!.id,(lf.json as TelemetryImportResult).taskIds[0]!, (ls.json as TelemetryImportResult).taskIds[0]!]){
        const context=await f.call('/api/tasks/'+encodeURIComponent(id));expect(context.status).toBe(200);
        if(id!==(ls.json as TelemetryImportResult).taskIds[0]!)expect((context.json as TaskContext).members.map(m=>m.name).sort()).toEqual(['planner','researcher']);
        const summary=await f.call('/api/tasks/'+encodeURIComponent(id)+'/summary');expect(summary.status).toBe(200);expect(summary.json).toMatchObject({id,metrics:{costUsd:null},latestHealth:null});expect(summary.body).not.toMatch(/span_json|inputSummary|outputSummary/);
        if(id===(ls.json as TelemetryImportResult).taskIds[0]!)expect(summary.json).toMatchObject({metrics:{durationMs:1000}});
        const report=await f.call('/api/tasks/'+encodeURIComponent(id)+'/health-reports',{mode:'standard',member:'all'});expect(report.status,report.body).toBe(200);expect(report.json).toMatchObject({taskId:id,mode:'standard'});
        const saved=report.json as HealthReport;expect(saved.coverage.members.loaded).toBe((context.json as TaskContext).members.length);
        expect((await f.call('/api/tasks/'+encodeURIComponent(id)+'/summary')).json).toMatchObject({latestHealth:{id:saved.id}});
      }
      expect((await stat(f.path)).size).toBeGreaterThan(180000000);
      await expect(withCaptureCapacity(f.db,()=>{throw new Error('capture still must remain blocked');})).rejects.toMatchObject({code:'CAPTURE_METADATA_LIMIT'});
    }finally{await f.close();}
  });
  it.each([{column:'span_count',maximum:20000,message:'20000'},{column:'bytes',maximum:33554432,message:'33554432'}])('rejects only the full telemetry ledger quota: $column',async({column,maximum,message})=>{
    const f=await fixture();try{
      await f.enable();f.db.prepare(`UPDATE telemetry_quota SET ${column}=? WHERE id=1`).run(maximum);
      const before=f.db.prepare('SELECT span_count,bytes FROM telemetry_quota WHERE id=1').get();
      for(const path of ['/v1/traces','/api/telemetry/import']){
        const result=await f.call(path,batch([span()]));expect(result.status).toBe(413);expect(result.json).toMatchObject({error:{code:'TELEMETRY_QUOTA',message:expect.stringContaining('Telemetry quota full')}});expect(result.body).toContain(message);expect(result.body).not.toContain('WAL too large');
      }
      expect(f.db.prepare('SELECT span_count,bytes FROM telemetry_quota WHERE id=1').get()).toEqual(before);expect(f.db.prepare('SELECT COUNT(1) AS n FROM telemetry_spans').get()).toEqual({n:0});
    }finally{await f.close();}
  });
  it('reports pinned WAL separately from telemetry quotas, preserves data and resumes after release',async()=>{
    const f=await fixture(true);let reader:Database.Database|undefined;try{
      await f.enable();checkpointWal(f.db);f.db.pragma('wal_autocheckpoint=0');
      reader=openReadonly(f.path);reader.exec('BEGIN');reader.prepare('SELECT value FROM _meta WHERE key=?').get('schema_version');
      const insert=f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(393216))');
      for(let i=0;(await stat(f.path+'-wal')).size<9000000;i++)insert.run('wal-fixture-'+i);
      const before=f.db.prepare('SELECT span_count,bytes FROM telemetry_quota WHERE id=1').get();
      for(const path of ['/v1/traces','/api/telemetry/import']){
        const result=await f.call(path,batch([span()]));expect(result.status).toBe(413);expect(result.json).toMatchObject({error:{code:'TELEMETRY_WAL_LIMIT',message:expect.stringContaining('Telemetry WAL too large')}});expect(result.body).not.toContain('Telemetry quota full');
      }
      expect(f.db.prepare('SELECT span_count,bytes FROM telemetry_quota WHERE id=1').get()).toEqual(before);expect(f.db.prepare('SELECT COUNT(1) AS n FROM telemetry_spans').get()).toEqual({n:0});
      reader.exec('ROLLBACK');expect((await f.call('/v1/traces',batch([span()]))).status).toBe(200);
      expect((await stat(f.path+'-wal')).size).toBeLessThan(8000000);
    }finally{if(reader?.inTransaction)reader.exec('ROLLBACK');reader?.close();await f.close();}
  });
  it('persists an optional token privately, never exposes it on GET, rejects wrong auth and restarts off',async()=>{
    const f=await fixture();try{
      const configured=await f.enable(true), token=(configured.json as {token:string}).token;expect(token).toMatch(/^[a-f\d]{64}$/);
      expect((await stat(join(f.directory,'opentelemetry.json'))).mode&0o777).toBe(0o600);expect(await readFile(join(f.directory,'opentelemetry.json'),'utf8')).toContain(token);
      expect((await f.call('/api/telemetry')).body).not.toContain(token);
      expect((await f.call('/v1/traces',batch([span()]))).status).toBe(401);expect((await f.call('/v1/traces',batch([span()]),'POST',{authorization:'Bearer wrong'})).status).toBe(401);
      expect((await f.call('/v1/traces',batch([span()]),'POST',{authorization:'Bearer '+token})).status).toBe(200);
      await f.restart();expect((await f.call('/api/telemetry')).json).toMatchObject({enabled:false,requireToken:true});expect((await f.call('/v1/traces',batch([span()]),'POST',{authorization:'Bearer '+token})).status).toBe(403);
      const next=(await f.enable(true)).json as {token:string};expect(next.token).not.toBe(token);
    }finally{await f.close();}
  });
  it('accepts gzip, rejects protobuf/invalid gzip and enforces compressed, expanded, attribute and span limits with counters',async()=>{
    const f=await fixture();try{
      await f.enable();expect((await f.call('/v1/traces',gzipSync(JSON.stringify(batch([span()]))),'POST',{'content-encoding':'gzip'})).status).toBe(200);
      const protobuf=await f.call('/v1/traces',Buffer.from([1,2]),'POST',{'content-type':'application/x-protobuf'});expect(protobuf.status).toBe(415);expect(protobuf.body).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
      expect((await f.call('/v1/traces',Buffer.from('invalid'),'POST',{'content-encoding':'gzip'})).status).toBe(400);
      expect((await f.call('/v1/traces',Buffer.from('a'.repeat(8*1024*1024+1)))).status).toBe(413);
      expect((await f.call('/v1/traces',gzipSync('a'.repeat(8*1024*1024+1)),'POST',{'content-encoding':'gzip'})).status).toBe(413);
      expect((await f.call('/v1/traces',batch([span('2',{x:'x'.repeat(65537)})]))).status).toBe(413);
      expect((await f.call('/v1/traces',batch(Array.from({length:1001},()=>span())))).status).toBe(413);
      const stats=(await f.call('/api/telemetry')).json as TelemetryStatus;expect(stats).toMatchObject({spanCount:1,rejectedCount:6,reasons:{TELEMETRY_LIMIT:4,TELEMETRY_MEDIA_TYPE:1,TELEMETRY_INVALID:1}});
      expect(f.db.prepare('SELECT COUNT(1) AS n FROM events').get()).toEqual({n:1});
    }finally{await f.close();}
  });
  it('bounds concurrent admission and counts a rejected busy batch',async()=>{
    const f=await fixture();try{await f.enable();const results=await Promise.all([f.call('/v1/traces',batch([span()])),f.call('/v1/traces',batch([span('2')]))]);expect(results.map(r=>r.status).sort()).toEqual([200,429]);expect((await f.call('/api/telemetry')).json).toMatchObject({spanCount:1,rejectedCount:1,reasons:{TELEMETRY_BUSY:1}});expect(f.db.prepare('SELECT COUNT(1) AS n FROM events').get()).toEqual({n:1});}finally{await f.close();}
  });
  it.each<Record<string,string>>([{host:'evil.example'},{origin:'https://evil.example'}])('guards receiver and controls using existing Host/Origin protection %j',async headers=>{
    const f=await fixture();try{await f.enable();for(const path of ['/api/telemetry','/v1/traces','/api/telemetry/import'])expect((await f.call(path,path.includes('traces')||path.endsWith('import')?batch([span()]):undefined,undefined,headers)).status).toBe(400);expect((await f.call('/api/telemetry')).json).toMatchObject({rejectedCount:1,reasons:{TELEMETRY_GUARD:1}});}finally{await f.close();}
  });
  it('rejects a nonloopback peer before reading/committing a batch',async()=>{
    const f=await fixture();try{await f.enable();f.server.prependOnceListener('request',req=>Object.defineProperty(req.socket,'remoteAddress',{value:'203.0.113.1',configurable:true}));expect((await f.call('/v1/traces',batch([span()]))).status).toBe(400);expect(f.db.prepare('SELECT COUNT(1) AS n FROM events').get()).toEqual({n:0});}finally{await f.close();}
  });
  it.each(['Langfuse','LangSmith'])('imports documented %s JSONL, preserves parent rows and unknowns, deduplicates and rejects unrecognized input',async format=>{
    const f=await fixture();try{
      const rows=format==='Langfuse'?[{id:'root',traceId:'trace',type:'AGENT',sessionId:'session',name:'parent'},{id:'child',traceId:'trace',type:'GENERATION',parentObservationId:'root',model:'test',usage:{input:0,output:8,total:8}}]:[{id:'root',trace_id:'trace',run_type:'chain',extra:{metadata:{thread_id:'session'}}},{id:'child',trace_id:'trace',run_type:'llm',parent_run_id:'root',prompt_tokens:0,completion_tokens:8}];
      const bytes=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n'));
      const uploaded=await f.call('/api/telemetry/import',bytes,'POST',{'content-type':'application/x-ndjson'});expect(uploaded.status).toBe(200);expect(uploaded.json).toMatchObject({format,spanCount:2});
      const taskId=(uploaded.json as TelemetryImportResult).taskIds[0]!;
      const context=(await f.call('/api/tasks/'+encodeURIComponent(taskId))).json as TaskContext;expect(context.task).toMatchObject({origin:'imported',provider:format,startedAt:null});expect(context.metrics?.input).toBe(0);expect(context.metrics?.output).toBe(8);expect(context.metrics?.costUsd).toBeNull();expect(context.metrics?.durationMs).toBeNull();
      const before=f.db.prepare('SELECT total_changes() AS n').get();await f.call('/api/telemetry/import',bytes,'POST',{'content-type':'application/x-ndjson'});expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      const invalid=await f.call('/api/telemetry/import',{arbitrary:true});expect(invalid.status).toBe(400);expect(invalid.body).toContain('Unrecognized format');expect((await f.call('/api/telemetry/import',Buffer.from('\n'),'POST',{'content-type':'application/x-ndjson'})).status).toBe(400);
      expect((await f.call('/api/tasks?origin=imported&range=all')).json).toMatchObject({total:1});
    }finally{await f.close();}
  });
});
