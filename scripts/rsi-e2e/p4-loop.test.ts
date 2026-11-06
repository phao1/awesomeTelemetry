import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe,it,expect} from 'vitest';
const {argumentsFor,fakeMonitorReply,fakeTargetRepairCommand}=await import(pathToFileURL(resolve('scripts/rsi-e2e/p4-loop.mjs')).href);
describe('optional real AgentReviewProvider E2E fixture',()=>{
 it('keeps the option opt-in and validates flags',()=>{
  expect(argumentsFor([])).toEqual({});expect(argumentsFor(['--fake-monitor','--root','/tmp/check'])).toEqual({'--fake-monitor':true,'--root':'/tmp/check'});
  expect(()=>argumentsFor(['--fake-monitor','--fake-monitor'])).toThrow();expect(()=>argumentsFor(['--fake-monitor','--report'])).toThrow();
 });
 it('returns tool-free monitor/process JSON and fresh multi-language adversarial tests',()=>{
  const input=(system:string,user='data')=>({messages:[{role:'system',content:system},{role:'user',content:user}]});
  expect(JSON.parse(fakeMonitorReply(input('monitor')).response.choices[0].message.content)).toEqual({conclusions:[]});
  expect(JSON.parse(fakeMonitorReply(input('Compare the optimizer explanation')).response.choices[0].message.content)).toEqual({evidence:[]});
  for(const language of ['javascript','python','go']){
   const result=fakeMonitorReply(input('Create one equivalent',JSON.stringify({untrustedTrainingData:{language}})));
   const draft=JSON.parse(result.response.choices[0].message.content);expect(result.kind).toBe('adversary');expect(draft.expectedTests).toBe(1);expect(draft.hiddenTests[0].content).toContain(language==='go'?'TestVariant':language==='python'?'test_variant':'variant');expect(result.response.usage).toEqual({prompt_tokens:20,completion_tokens:10,total_tokens:30});
  }
  expect(()=>fakeMonitorReply({...input('monitor'),tools:[{}]})).toThrow();
 });
});

it('runs the generic fake target repair on arbitrary source filenames without question-name dispatch',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{runProcess}=await import('../../server/rsi/docker.js');
 const root=await mkdtemp(join(tmpdir(),'p5-fake-repair-'));
 try{
  await writeFile(join(root,'unrelated.mjs'),'export const result=()=> 0;');await writeFile(join(root,'arbitrary.py'),'def calculate():\n    return 0\n');
  const result=await runProcess('sh',['-c',fakeTargetRepairCommand()],{cwd:root});expect(result.code).toBe(0);
  expect(await readFile(join(root,'unrelated.mjs'),'utf8')).toContain('=> 3');expect(await readFile(join(root,'arbitrary.py'),'utf8')).toContain('return 3');
 }finally{await rm(root,{recursive:true,force:true});}
});
