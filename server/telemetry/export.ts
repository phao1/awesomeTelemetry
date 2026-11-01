import { createHash } from 'node:crypto';
import type { TelemetrySpan } from '../../src/core/telemetry-types.js';
import { isoUtcToUnixNano } from '../../src/core/trace-export.js';
const hash = (id: string, length: number) => createHash('sha256').update(id).digest('hex').slice(0,length);
/** Export retained metadata only; no prompts, credentials or fabricated missing times. */
export function exportTelemetry(spans: TelemetrySpan[], offset: number, limit: number) {
  const page=spans.slice(offset,offset+limit);
  const attr=(key:string,value:string|number)=>({key,value:typeof value==='number'?{intValue:String(value)}:{stringValue:value}});
  return {resourceSpans:[{resource:{attributes:[attr('service.name','awesome-telemetry'),attr('awesome_telemetry.page.offset',offset),attr('awesome_telemetry.page.total',spans.length)]},scopeSpans:[{scope:{name:'awesome-telemetry.telemetry-export',version:'1'},spans:page.map(s=>{
    const traceId=s.source==='OpenTelemetry'?s.traceId:hash(s.source+':'+s.traceId,32);
    const spanId=(id:string)=>s.source==='OpenTelemetry'?id:hash(s.source+':'+s.traceId+':'+id,16);
    const attributes=[attr('awesome_telemetry.source',s.source),attr('awesome_telemetry.event.kind',s.kind),attr('awesome_telemetry.event.status',s.status)];
    const operation=s.operation && ['chat','text_completion','embeddings','execute_tool','invoke_agent','create_agent'].includes(s.operation)?s.operation:s.kind==='llm'?'chat':s.kind==='tool'?'execute_tool':s.kind==='agent'?'invoke_agent':null;
    const values:Record<string,string|number|null>={'gen_ai.operation.name':operation,'gen_ai.conversation.id':s.group,'gen_ai.response.model':s.model,'gen_ai.tool.name':s.toolName,'gen_ai.tool.call.id':s.toolCallId,'gen_ai.agent.name':s.agentName,'gen_ai.agent.id':s.agentId,'gen_ai.usage.input_tokens':s.usage.input,'gen_ai.usage.output_tokens':s.usage.output,'gen_ai.usage.cache_read.input_tokens':s.usage.cacheRead,'gen_ai.usage.cache_creation.input_tokens':s.usage.cacheWrite,'gen_ai.usage.reasoning.output_tokens':s.usage.reasoning,'llm.token_count.total':s.usage.total};
    for(const [key,value]of Object.entries(values))if(value!==null)attributes.push(attr(key,value));
    return {traceId,spanId:spanId(s.spanId),...(s.parentSpanId?{parentSpanId:spanId(s.parentSpanId)}:{}),name:s.name,kind:1,startTimeUnixNano:s.start?isoUtcToUnixNano(s.start)??'0':'0',endTimeUnixNano:s.end?isoUtcToUnixNano(s.end)??'0':'0',attributes,status:{code:s.status==='error'?2:s.status==='success'?1:0}};
  })}]}]};
}
