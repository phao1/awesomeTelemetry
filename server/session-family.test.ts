import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import type { NativeSessionFamilyPage } from '../src/core/trace-types.js';
import { normalizeCodexSample } from '../src/adapters/codex.js';
import { storeTraceRecord } from '../local-sessions/scanner-utils.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';

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
function page(result: Awaited<ReturnType<typeof call>>): NativeSessionFamilyPage {expect(result.status).toBe(200);return JSON.parse(result.text) as NativeSessionFamilyPage;}

describe('native family production HTTP', () => {
  it('exposes a complete parent/child round trip from real normalized Codex sources', async () => {
    const f = await fixture(); scan(f.db, 'parent', 'native-parent'); scan(f.db, 'child', 'native-child', 'native-parent');
    const before = f.db.prepare('SELECT total_changes() AS n').get();
    const result = await call(f.port, '/api/sessions/parent/family'); const family = page(result);
    expect(family.children[0]).toMatchObject({ session: { id: 'child' }, state: 'resolved', identity: { value: 'native-parent', scope: 'native-child', sourcePath: 'events[0].payload.parent_thread_id' } });
    const child = page(await call(f.port, '/api/sessions/child/family'));
    expect(child.parents.items[0]).toMatchObject({ state: 'resolved', matches: [{ id: 'parent' }] });
    expect(result.text).not.toContain('SYNTHETIC_BODY_NOT_IN_PARENT_LIST'); expect(result.text).not.toContain('/SYNTHETIC_SOURCE_PATH');
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('shows independent empty/unknown evidence and ambiguous parents without guessing', async () => {
    const f = await fixture(); scan(f.db, 'empty', 'e');
    expect(page(await call(f.port, '/api/sessions/empty/family'))).toMatchObject({ children: [], parents: { items: [] } });
    scan(f.db, 'a', 'duplicate'); scan(f.db, 'b', 'duplicate'); scan(f.db, 'c', 'child', 'duplicate');
    expect(page(await call(f.port, '/api/sessions/a/family')).children[0]!.state).toBe('ambiguous');
  });
  it.each(['?limit=0','?limit=51','?limit=1.5','?limit=9007199254740992','?limit=1&limit=2','?cursor=','?cursor=a&cursor=b','?cursor=%00','?unknown=1'])('returns unified400 for %s', async query => {
    const f = await fixture(); scan(f.db, 'parent', 'p'); const result = await call(f.port, '/api/sessions/parent/family' + query);
    expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
  });
  it('preserves local Host/Origin guards and missing-session404', async () => {
    const f = await fixture(); const missing = await call(f.port, '/api/sessions/missing/family');
    expect(missing.status).toBe(404); expect(JSON.parse(missing.text).error.code).toBe('SESSION_NOT_FOUND');
    scan(f.db, 'parent', 'p');
    for (const headers of [{host:'untrusted.invalid'},{origin:'https://untrusted.invalid'}] as Array<Record<string,string>>) {
      const result = await call(f.port, '/api/sessions/parent/family', headers); expect(result.status).toBe(400); expect(JSON.parse(result.text).error.code).toBe('BAD_REQUEST');
    }
  });
});
