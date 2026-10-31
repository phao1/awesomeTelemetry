import {compareTokenRows} from './compare-token-model.js';
import {formatComparisonRatio} from '../../core/task-comparison.js';
import type { Locale } from '../../i18n.js';
import type { TaskComparisonSnapshot } from '../../core/task-types.js';
import type { CompareResult } from '../compare-types.js';
import { foldingSummary, type FoldingMetricRun } from '../../core/agent-folding-metrics.js';
import { formatPercent, formatTokens, formatDuration } from '../../core/format.js';
/** Same retained snapshot/medians as the visible cards; no extra IO or bodies. */
export function comparisonExportLines(snapshot:TaskComparisonSnapshot,locale:Locale,process:CompareResult|null,runs:{a:FoldingMetricRun[];b:FoldingMetricRun[]}|null,toolProcess:CompareResult|null=process):string[] {
 const zh=locale==='zh',rows=compareTokenRows(snapshot,runs,locale),lines=[zh?'Token 构成（中位数，已知分量归一化）':'Token composition (median, known components normalized)'];
 for(const side of ['a','b'] as const){
  const total=rows.reduce((n,r)=>n+(r[side]??0),0);
  for(const r of rows)lines.push(`${side.toUpperCase()} · ${r.label}: ${formatTokens(r[side])} · ${formatPercent(total&&r[side]!=null?r[side]/total:null)}`);
  const cache=foldingSummary(snapshot[side].map(t=>t.metrics?.cacheHitRate??null)),complete=cache.n===snapshot[side].length&&snapshot[side].every(t=>{const c=t.metrics?.coverage?.cacheHitRate;return c&&c.total>0&&c.known===c.total;});lines.push(`${side.toUpperCase()} · ${zh?'缓存命中率':'Cache hit rate'}: ${formatPercent(complete?cache.median:null)}`);
 }
 for(const r of rows)lines.push(`${r.label}: Δ ${formatTokens(r.delta)}; B/A ${formatComparisonRatio(r.ratio)}`);
 lines.push(zh?'过程对照：所选根会话的已加载事件页；记录区间不代表实测执行。':'Process comparison: loaded event pages of selected root sessions; recorded intervals are not measured execution.');
 if(process){for(const side of ['left','right'] as const){const data=process[side],name=side==='left'?'A':'B';lines.push(`${name} · ${data.session.title} · ${data.events.length}/${data.eventTotal}`);for(const e of data.events)lines.push(`${name} · ${e.title} · ${e.kind} · ${formatDuration(e.durationMs,locale)}`);
 const tools=new Map<string,{calls:number;failures:number;duration:number}>();for(const e of (toolProcess??process)[side].events)if(e.tool){const item=tools.get(e.tool)??{calls:0,failures:0,duration:0};item.calls++;item.failures+=e.status==='error'?1:0;item.duration+=e.durationMs;tools.set(e.tool,item);}for(const [tool,t] of tools)lines.push(`${name} · ${tool} · ${zh?'调用':'Calls'} ${t.calls} · ${zh?'失败':'Failures'} ${t.failures} · ${zh?'平均记录区间':'Mean recorded interval'} ${formatDuration(t.duration/t.calls,locale)}`);}}
 else lines.push(zh?'过程不可用或尚未读取':'Process unavailable or not read');
 return lines;
}
