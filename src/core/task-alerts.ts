import type { AlertThresholds, TaskAlert, TaskMetrics } from './task-types.js';
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {errors:null,toolFailurePct:null,durationMs:null,tokens:null,contextPressurePct:null};
/** Only complete trusted counters trigger task-wide thresholds. */
export function taskAlerts(m: TaskMetrics, limits: AlertThresholds): TaskAlert[] {
  const out: TaskAlert[]=[];
  const add=(rule:keyof AlertThresholds,actual:number|null|undefined)=>{const threshold=limits[rule];if(threshold!==null && actual!=null && Number.isFinite(actual) && actual>threshold)out.push({rule,threshold,actual});};
  add('errors',m.errors);add('durationMs',m.durationMs);
  if(!m.coverage || m.coverage.correctedTotal.known===m.coverage.correctedTotal.total)add('tokens',m.correctedTotal);
  add('toolFailurePct',m.toolResults && m.toolFailures!=null ? 100*m.toolFailures/m.toolResults:null);
  add('contextPressurePct',m.contextPressurePct);
  return out;
}
export function formatCacheHitRate(m: Pick<TaskMetrics,'cacheHitRate'|'coverage'> | undefined, zh=false): string {
  if(m?.cacheHitRate==null)return zh?'未知':'Unknown';
  const c=m.coverage?.cacheHitRate;
  return (m.cacheHitRate*100).toFixed(1)+'%'+(c&&c.known<c.total?(zh?` · 部分（${c.known}/${c.total} 成员）`:` · Partial (${c.known}/${c.total} members)`):'');
}
export const ALERT_LABELS: Record<keyof AlertThresholds,[string,string]>={errors:['任务错误数','Task errors'],toolFailurePct:['工具失败率 (%)','Tool failure rate (%)'],durationMs:['单任务时长 (ms)','Task duration (ms)'],tokens:['单任务 Token','Task tokens'],contextPressurePct:['上下文压力 (%)','Context pressure (%)']};
