import {expect,it} from 'vitest';
import type {TaskMetrics} from './task-types.js';
import {DEFAULT_ALERT_THRESHOLDS,formatCacheHitRate,taskAlerts} from './task-alerts.js';
const metrics:TaskMetrics={durationMs:1000,toolCalls:3,errors:2,input:10,output:5,cacheRead:1,correctedTotal:16,promptInput:11,cacheHitRate:1/11,models:[],toolResults:2,toolFailures:1,contextPressurePct:81};
it('defaults off, uses strict boundaries and excludes pending calls from the failure denominator',()=>{
 expect(taskAlerts(metrics,DEFAULT_ALERT_THRESHOLDS)).toEqual([]);
 const limits={...DEFAULT_ALERT_THRESHOLDS,toolFailurePct:49,contextPressurePct:80,errors:2};
 expect(taskAlerts(metrics,limits)).toEqual([{rule:'toolFailurePct',threshold:49,actual:50},{rule:'contextPressurePct',threshold:80,actual:81}]);
 expect(taskAlerts({...metrics,toolResults:0,contextPressurePct:null,errors:null},limits)).toEqual([]);
});
it('formats cache hit with partial member coverage and preserves unknowns',()=>{
 expect(formatCacheHitRate(metrics)).toBe('9.1%');
 const coverage={known:1,total:2,missing:[]};
 const partial={...metrics,coverage:{input:coverage,output:coverage,cacheRead:coverage,correctedTotal:coverage,promptInput:coverage,cacheHitRate:coverage,models:coverage}};
 expect(formatCacheHitRate(partial,true)).toBe('9.1% · 部分（1/2 成员）');
 expect(formatCacheHitRate({...metrics,cacheHitRate:null},true)).toBe('未知');
 expect(formatCacheHitRate({...metrics,cacheHitRate:0})).toBe('0.0%');
 expect(taskAlerts(partial,{...DEFAULT_ALERT_THRESHOLDS,tokens:1})).toEqual([]);
});
