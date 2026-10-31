import type { AlertThresholds, TaskAlert, TaskMetrics } from './task-types.js';
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {errors:null,toolFailurePct:null,durationMs:null,tokens:null,costUSD:null,costCNY:null,contextPressurePct:null};
/** Only complete trusted counters trigger task-wide thresholds. */
export function taskAlerts(m: TaskMetrics, limits: AlertThresholds): TaskAlert[] {
  const out: TaskAlert[]=[];
  const add=(rule:keyof AlertThresholds,actual:number|null|undefined,currency?:'USD'|'CNY')=>{const threshold=limits[rule];if(threshold!==null && actual!=null && Number.isFinite(actual) && actual>threshold)out.push({rule,threshold,actual,...(currency?{currency}:{})});};
  add('errors',m.errors);add('durationMs',m.durationMs);
  if(!m.coverage || m.coverage.correctedTotal.known===m.coverage.correctedTotal.total)add('tokens',m.correctedTotal);
  add('toolFailurePct',m.toolResults && m.toolFailures!=null ? 100*m.toolFailures/m.toolResults:null);
  add('contextPressurePct',m.contextPressurePct);
  if(m.costs && m.costs.known===m.costs.total)for(const c of m.costs.amounts)add(c.currency==='USD'?'costUSD':'costCNY',c.amount,c.currency);
  return out;
}
export function formatTaskCosts(m: TaskMetrics | undefined, zh=false): string {
  if(!m?.costs)return m?.costUsd==null ? (zh?'未知':'Unknown') : '$'+m.costUsd.toFixed(4);
  const c=m.costs;if(!c.known)return zh?'未知':'Unknown';
  return c.amounts.map(a=>`${a.currency} ${a.amount.toFixed(4)}${a.source==='reported'?'':zh?'（估算）':' (estimated)'}`).join(' / ')+(c.known<c.total?(zh?` · 部分（${c.known}/${c.total} 成员）`:` · Partial (${c.known}/${c.total} members)`):'');
}
export const ALERT_LABELS: Record<keyof AlertThresholds,[string,string]>={errors:['任务错误数','Task errors'],toolFailurePct:['工具失败率 (%)','Tool failure rate (%)'],durationMs:['单任务时长 (ms)','Task duration (ms)'],tokens:['单任务 Token','Task tokens'],costUSD:['单任务费用 (USD)','Task cost (USD)'],costCNY:['单任务费用 (CNY)','Task cost (CNY)'],contextPressurePct:['上下文压力 (%)','Context pressure (%)']};
