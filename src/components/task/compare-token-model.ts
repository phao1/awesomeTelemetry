import type {TaskComparisonSnapshot} from '../../core/task-types.js';
import type {FoldingMetricRun} from '../../core/agent-folding-metrics.js';
import {foldingRunMetrics,foldingSummary} from '../../core/agent-folding-metrics.js';
import {taskComparisonRows} from '../../core/task-comparison.js';
import type {Locale} from '../../i18n.js';
export function compareTokenRows(snapshot:TaskComparisonSnapshot,runs:{a:FoldingMetricRun[];b:FoldingMetricRun[]}|null|undefined,locale:Locale){
 const comparable=taskComparisonRows(snapshot,runs??null,null,locale).find(r=>r.key==='tokens')?.reason===null;
 return (['input','output','cacheRead','cacheWrite'] as const).map(key=>{
  const value=(side:'a'|'b')=>{
   if(key==='cacheWrite'){const group=runs?.[side];if(!group||group.length!==snapshot[side].length)return null;const values=group.map(r=>foldingRunMetrics(r).cacheWrite);return values.every(v=>v!=null)?foldingSummary(values).median:null;}
   return snapshot[side].every(t=>{const c=t.metrics?.coverage?.[key];return t.metrics?.[key]!=null&&c&&c.total>0&&c.known===c.total;})?foldingSummary(snapshot[side].map(t=>t.metrics![key])).median:null;
  };
  const a=value('a'),b=value('b'),eligible=comparable&&a!==null&&b!==null;
  return {key,label:(locale==='zh'?{input:'输入',output:'输出',cacheRead:'缓存读',cacheWrite:'缓存写'}:{input:'Input',output:'Output',cacheRead:'Cache read',cacheWrite:'Cache write'})[key],a,b,delta:eligible?b-a:null,ratio:eligible&&a!==0?b/a:null,color:`var(--token-${{input:'input',output:'output',cacheRead:'cache-read',cacheWrite:'cache-write'}[key]})`};
 });
}
