import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,it,expect } from 'vitest';
import { privateWrite } from './artifacts.js';
import { trajectory,safeArtifact } from './reader.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('pages sanitized UTF8 trajectories within bounds and rejects mid-codepoint offsets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rsi-trajectory-'));dirs.push(root);
 await privateWrite(join(root,'artifacts/run/proxy/responses.jsonl'),JSON.stringify({requestId:'r',assistant:[{index:0,text:'你好世界'.repeat(50),tool_calls:[],privateEvidence:'hidden'}],dictionary:'private'})+'\n');
 let offset=0,content='';let count=0;
 do{const p=await trajectory(root,'artifacts/run',new URLSearchParams({limit:'17',offset:String(offset)}),true);expect(p.content).not.toContain('\uFFFD');expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(1048576);content+=p.content;offset=p.nextOffset??-1;count++;}while(offset>=0);
 expect(count).toBeGreaterThan(2);expect(content).toContain('你好世界');expect(content).not.toContain('hidden');expect(content).not.toContain('dictionary');
 const raw=Buffer.from(content),at=raw.indexOf(Buffer.from('你好'))+1;
 await expect(trajectory(root,'artifacts/run',new URLSearchParams({offset:String(at)}),true)).rejects.toMatchObject({status:400});
 await expect(trajectory(root,'artifacts/run',new URLSearchParams({limit:'65537'}),true)).rejects.toMatchObject({status:400});
});
it('never resolves artifact references outside the trusted root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rsi-artifact-root-'));dirs.push(root);await privateWrite(join(root,'private.json'),'{}');
 await expect(safeArtifact(join(root,'nested'),'../private.json')).rejects.toThrow();
 const empty=await trajectory(root,'artifacts/missing',new URLSearchParams(),true);expect(empty.content).toBe('');expect(empty.nextOffset).toBeNull();
});
