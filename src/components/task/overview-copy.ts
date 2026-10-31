import type { Locale } from '../../i18n.js';
export const overviewCopy = (locale: Locale) => locale === 'zh' ? {
 title:'概览',agent:'Agent 视角',all:'全部',tools:'全部工具',refresh:'刷新',empty:'此范围还没有任务',reason:'调整时间范围或工具筛选后重试。',partial:'部分覆盖',previous:'较前一周期',
 labels:['任务数','Token 总量','缓存命中率','任务失败率','工具失败率','告警任务'],
 charts:['Token 用量趋势','任务与失败','缓存命中率趋势','工具失败率排行','模型 Token 分布','工具任务分布','最近告警任务'],
 descriptions:['当前任务 Token 快照按最近活动日归属；非当天增量。','任务按事件日活动计数；失败快照归属最近活动日。','按提示输入量加权，不平均各任务百分比。','已保留的终态工具结果，不代表执行生命周期。','仅包含可明确归属到单一模型的修正 Token。','当前范围内的根任务，成员不重复计数。','超过本机配置阈值的任务，点击查看详情。'],
 input:'输入',output:'输出',cacheRead:'缓存读',cacheWrite:'缓存写',failed:'失败',time:'最近活动',task:'任务',alerts:'告警',noAlerts:'没有告警任务',unknown:'缺少可靠计数或成员覆盖不完整；不将缺失值作为零。',models:'多模型任务缺少可靠的分模型 Token 归属，未计入此图。',criteria:'计算口径',
} : {
 title:'Overview',agent:'Agent perspective',all:'All',tools:'All tools',refresh:'Refresh',empty:'No tasks in this range',reason:'Change the time range or tool filter and retry.',partial:'Partial coverage',previous:'vs previous period',
 labels:['Tasks','Total tokens','Cache hit rate','Task failure rate','Tool failure rate','Tasks with alerts'],
 charts:['Token usage trend','Tasks and failures','Cache hit rate trend','Tool failure ranking','Model token distribution','Tasks by provider','Recent alerts'],
 descriptions:['Current whole-task token snapshots by last activity, not daily increments.','Tasks use event-day activity; failure snapshots use last activity.','Weighted by prompt input, rather than averaging percentages.','Retained terminal result observations, not execution lifecycles.','Corrected tokens attributed to complete single-model tasks only.','Root tasks in the active window; members are not double-counted.','Tasks exceeding local thresholds; open a row for evidence.'],
 input:'Input',output:'Output',cacheRead:'Cache read',cacheWrite:'Cache write',failed:'Failed',time:'Last activity',task:'Task',alerts:'Alerts',noAlerts:'No tasks with alerts',unknown:'Reliable counters or complete member coverage are missing; missing is never zero.',models:'Multi-model tasks lack reliable per-model token attribution and are excluded.',criteria:'Calculation basis',
};
