import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import type { NativeIdentitySet, NativeSessionParentPage } from '../src/core/trace-types.js';
import { normalizeCodexSample } from '../src/adapters/codex.js';
import { storeTraceRecord } from '../local-sessions/scanner-utils.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';
import { writeNativeIdentities } from './storage/trace-links.js';

const resources: Array<{ db: Database.Database; server: Server; directory: string }> = [];
afterEach(async () => { for (const f of resources.splice(0)) { try { await new Promise<void>((resolve, reject) => f.server.close(err => err ? reject(err) : resolve())); }
  finally { f.db.close(); rmSync(f.directory, { recursive: true, force: true }); } } });
async function call(port: number, path: string, headers: Record<string,string> = {}): Promise<{status:number;text:string}> {
  return new Promise((resolve, reject) => { const req = request({ host:'127.0.0.1',port,path,headers }, res => {
    const parts: Buffer[] = []; res.on('data',(part:Buffer)=>parts.push(part)); res.once('error',reject);
    res.once('end',()=>resolve({status:res.statusCode??0,text:Buffer.concat(parts).toString('utf8')}));
  }); req.once('error',reject); req.setTimeout(5000,()=>req.destroy(new Error('Synthetic parent HTTP timeout'))); req.end(); });
}
async function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'native-parents-http-')); const db=new Database(':memory:');db.pragma('foreign_keys=ON');initSchema(db);
  const config=structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);Object.values(config.providers).forEach(provider=>{provider.enabled=false;provider.path=join(directory,'no-sources');});
  const server=createAgentObservabilityServer({db,config,caDirectory:join(directory,'ca'),userConfigPath:join(directory,'config.json')});resources.push({db,server,directory});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return{db,port:(server.address() as AddressInfo).port};
}
const stamp='2026-10-16T00:00:00.000Z';
function scan(db: Database.Database, key: string, nativeId: string, parent?: string) {
  const record=normalizeCodexSample({sourceAgent:'Codex',session:{},events:[
    {type:'session_meta',timestamp:stamp,payload:{id:nativeId,...(parent===undefined?{}:{parent_thread_id:parent}),cwd:'/SYNTHETIC_SOURCE_PATH'}},
    {type:'event_msg',timestamp:stamp,payload:{type:'user_message',message:'SYNTHETIC_BODY_NOT_IN_PARENT_LIST'}},
  ]},'fixture://'+key);storeTraceRecord(db,record,'fixture://'+key,key);
}
function page(result: Awaited<ReturnType<typeof call>>): NativeSessionParentPage {expect(result.status).toBe(200);return JSON.parse(result.text) as NativeSessionParentPage;}

describe('native parent references production HTTP/SQLite',()=>{
  it('resolves real adapter-retained parent IDs without source IO/body/DB mutation',async()=>{
    const f=await fixture();scan(f.db,'parent','native-parent');scan(f.db,'child','native-child','native-parent');
    const before=f.db.prepare('SELECT total_changes() AS n').get();const result=await call(f.port,'/api/sessions/child/parents');const data=page(result);
    expect(data.sessionKey).toBe('child');expect(data.items).toHaveLength(1);expect(data.items[0]).toMatchObject({state:'resolved',matchesTruncated:false,
      identity:{kind:'parent_session',namespace:'agent:codex',value:'native-parent',scope:'native-child',sourcePath:'events[0].payload.parent_thread_id'}});
    expect(data.items[0]!.matches.map(x=>x.id)).toEqual(['parent']);expect(data.hasMore).toBe(false);
    expect(result.text).not.toContain('SYNTHETIC_BODY_NOT_IN_PARENT_LIST');expect(result.text).not.toContain('/SYNTHETIC_SOURCE_PATH');
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    for(const forbidden of ['systemPrompt','events','raw','inputSummary','outputSummary','sourcePath']) expect(data.items[0]!.matches[0]).not.toHaveProperty(forbidden);
  });
  it('keeps duplicate owners ambiguous and a missing parent unresolved, not a spawn/communication edge',async()=>{
    const f=await fixture();scan(f.db,'parent-a','same-native-parent');scan(f.db,'parent-b','same-native-parent');scan(f.db,'child','child-native','same-native-parent');
    let data=page(await call(f.port,'/api/sessions/child/parents'));expect(data.items[0]?.state).toBe('ambiguous');expect(data.items[0]?.matches).toHaveLength(2);
    scan(f.db,'missing-child','missing-child-native','not-retained');data=page(await call(f.port,'/api/sessions/missing-child/parents'));expect(data.items[0]?.state).toBe('unresolved');expect(data.items[0]?.matches).toEqual([]);
  });
  it('pages actual native parent identity claims without gaps',async()=>{
    const f=await fixture();scan(f.db,'child','native-child');
    const manifest:NativeIdentitySet={parserVersion:1,completeness:{complete:true,omittedCount:0,reasons:[]},items:[
      {namespace:'agent:codex',kind:'session',value:'native-child',scope:null,eventId:null,sourcePath:'session.id'},
      ...Array.from({length:3},(_,index)=>({namespace:'agent:codex',kind:'parent_session' as const,value:'not-retained-'+index,scope:'native-child',eventId:null,sourcePath:'session.parent'+index})),
    ]};writeNativeIdentities(f.db,{source:'scan',key:'child'},manifest,stamp);
    const first=page(await call(f.port,'/api/sessions/child/parents?limit=2'));expect(first.items).toHaveLength(2);expect(first.hasMore).toBe(true);expect(first.nextCursor).toBe(first.items[1]!.identity.id);
    const second=page(await call(f.port,'/api/sessions/child/parents?limit=2&cursor='+first.nextCursor));expect(second.items).toHaveLength(1);expect(second.hasMore).toBe(false);
    expect(new Set([...first.items,...second.items].map(x=>x.identity.id)).size).toBe(3);
  });
  it.each(['?limit=0','?limit=51','?limit=-1','?limit=1.5','?limit=9007199254740992','?limit=1&limit=2','?cursor=','?cursor=not-hex','?unknown=1','?cursor='+ 'a'.repeat(64)+'&cursor='+ 'b'.repeat(64)])('strictly validates parent query %s',async query=>{
    const f=await fixture();scan(f.db,'child','native-child');const result=await call(f.port,'/api/sessions/child/parents'+query);expect(result.status).toBe(400);expect(JSON.parse(result.text)).toEqual({error:{code:'BAD_REQUEST',message:expect.any(String)}});
  });
  it('uses unified404 and local Host/Origin guards',async()=>{
    const f=await fixture();const missing=await call(f.port,'/api/sessions/missing/parents');expect(missing.status).toBe(404);expect(JSON.parse(missing.text).error.code).toBe('SESSION_NOT_FOUND');
    scan(f.db,'child','native-child');for(const headers of [{host:'untrusted.invalid'},{origin:'https://untrusted.invalid'}] as Array<Record<string,string>>){const result=await call(f.port,'/api/sessions/child/parents',headers);expect(result.status).toBe(400);expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');}
  });
});
