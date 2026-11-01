import { expect, it } from 'vitest';
import { isSystemRecord } from './system-records.js';
import type { TraceEventSlim } from './trace-types.js';
const record=(title:string,kind:TraceEventSlim['kind']='message',hasOutput=true)=>({title,kind,hasInput:false,hasOutput});
it('hides system injections and TH-004a bookkeeping with or without retained bodies',()=>{
 for(const title of ['system','System prompt','系统提示','app-context','multi_agent_role','environment_context','world_state','turn_context','thread_settings_applied','item_completed','task_started','task_complete','token_count','<environment_context>machine context','<multi_agent_role>metadata','<app-context>context'])expect(isSystemRecord(record(title)),title).toBe(true);
 expect(isSystemRecord(record('long system prompt','system'))).toBe(true);
 expect(isSystemRecord(record('context','agent'))).toBe(true);
 expect(isSystemRecord(record('reasoning','reasoning',false))).toBe(true);
});
it('keeps real prompts, model output, reasoning and tool calls; matching is not substring-based',()=>{
 for(const [title,kind] of [['Fix a bug','user_prompt'],['Read environment_context from disk','message'],['Result','llm'],['reasoning','reasoning'],['world_state','tool']] as const)expect(isSystemRecord(record(title,kind)),title).toBe(false);
 expect(isSystemRecord(null)).toBe(false);
});
